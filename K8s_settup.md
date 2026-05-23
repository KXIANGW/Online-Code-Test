# Online Code Test 單機 Kubernetes 安裝流程

> 目標：在一台乾淨 Ubuntu 22.04 / 24.04 上，一次安裝並驗證 **k3s + Argo CD + KEDA + Online Code Test (OCT)**。
>
> 本文件整合 `K8S_SETUP_Ubuntu.md` 與 `K8S_SETUP.md`，並以目前專案內容為準：
>
> - Worker 使用 `sio2project/isolate` + `oct-seccomp-wrapper`，不再使用 `docker.sock`。
> - 語言 rootfs 由 `language-rootfs-puller` DaemonSet 從 GHCR sandbox image 解到 hostPath `/var/lib/oct/rootfs`。
> - `k8s/13-autoscaling.yaml` 會同時建立 backend/frontend HPA 與 worker KEDA `ScaledObject`。
> - `k8s/argocd/application.yaml` 會讓 Argo CD 同步 `k8s/` 目錄。

---

## 0. 架構與部署路徑

單台 Ubuntu 同時扮演 k3s control-plane 與 worker node：

```text
Ubuntu host
  k3s/containerd
    argocd namespace
      Argo CD
      Argo CD Image Updater
    keda namespace
      KEDA operator
    oct namespace
      frontend / backend / worker
      postgres / rabbitmq / redis
      prometheus / grafana / cadvisor
      language-rootfs-puller DaemonSet
  hostPath
    /var/lib/oct/rootfs/{cpp17,python3}
```

本文主流程採用 GitOps：

1. 安裝 k3s。
2. 安裝 KEDA，避免 Argo CD sync `ScaledObject` 時 CRD 不存在。
3. 安裝 Argo CD 與 Image Updater。
4. 建立 GitHub / GHCR credentials。
5. 套用 `k8s/argocd/application.yaml`，由 Argo CD 部署 OCT。
6. 驗證 Pod、rootfs、KEDA、API、真實 submission。

---

## 1. 先決條件

### 硬體建議

| 項目 | 建議 |
| --- | --- |
| CPU | 4 cores 以上 |
| RAM | 8 GB 以上 |
| Disk | 30 GB 以上 |

### GitHub token

需要一組 GitHub classic PAT，至少包含：

| 用途 | Scope |
| --- | --- |
| Argo CD 讀取 repo | `repo` |
| Pod / Image Updater 拉 GHCR image | `read:packages` |

下方流程會用到 `GITHUB_USER` 與 `GITHUB_PAT`。建議持久化到只有目前使用者可讀的獨立檔案，再由 `~/.bashrc` 載入，避免每次開 terminal 都要重設：

```bash
cat > ~/.oct-ghcr-env <<'EOF'
export GITHUB_USER="UserName"
export GITHUB_PAT="<github-classic-pat-with-repo-and-read-packages>"
EOF

chmod 600 ~/.oct-ghcr-env

grep -qxF 'source ~/.oct-ghcr-env' ~/.bashrc || echo 'source ~/.oct-ghcr-env' >> ~/.bashrc
source ~/.oct-ghcr-env
```

確認變數已載入：

```bash
echo "$GITHUB_USER"
test -n "$GITHUB_PAT" && echo "GITHUB_PAT loaded"
```

> 不要把真實 PAT 寫進 repo 或 commit。若 repo 與 GHCR package 都是 public，仍建議建立 secret，避免 pull rate / 權限差異造成 `ImagePullBackOff`。

---

## 2. Ubuntu 基礎套件

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg lsb-release jq git socat
```

確認 cgroup v2：

```bash
stat -fc %T /sys/fs/cgroup
# 預期：cgroup2fs
```

---

## 3. 安裝 k3s

k3s 使用預設 containerd runtime。Worker 的 isolate `--cg` 需要 systemd cgroup driver，所以先寫入 k3s config：

```bash
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/config.yaml >/dev/null <<'EOF'
kubelet-arg:
  - cgroup-driver=systemd
EOF
```

安裝 k3s：

```bash
curl -sfL https://get.k3s.io | sudo INSTALL_K3S_EXEC="--disable=traefik --write-kubeconfig-mode=644" sh -
```

設定 kubectl：

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> ~/.bashrc
```

驗證：

```bash
systemctl is-active k3s
kubectl get nodes
kubectl get pods -A
```

---

## 4. 安裝 Helm

```bash
sudo apt install -y apt-transport-https

curl -fsSL https://packages.buildkite.com/helm-linux/helm-debian/gpgkey \
  | gpg --dearmor \
  | sudo tee /usr/share/keyrings/helm.gpg >/dev/null

echo "deb [signed-by=/usr/share/keyrings/helm.gpg] https://packages.buildkite.com/helm-linux/helm-debian/any/ any main" \
  | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list

sudo apt update
sudo apt install -y helm
helm version
```

---

## 5. 安裝 KEDA

`k8s/kustomization.yaml` 會套用 `k8s/13-autoscaling.yaml`，其中包含 `keda.sh/v1alpha1` 的 `ScaledObject`。因此 KEDA 要先裝。

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm upgrade --install keda kedacore/keda \
  --namespace keda \
  --create-namespace

kubectl -n keda rollout status deployment/keda-operator --timeout=180s
kubectl get crd scaledobjects.keda.sh
```

---

## 6. 安裝 Argo CD

```bash
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml \
  --server-side --force-conflicts

kubectl wait --for=condition=available --timeout=180s deployment/argocd-server -n argocd
```

取得 Argo CD admin 初始密碼：

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d && echo
```

---

## 7. 安裝 Argo CD Image Updater

```bash
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v1.2.0/config/install.yaml
kubectl -n argocd rollout status deployment/argocd-image-updater-controller --timeout=180s
```

套用本專案的 Image Updater 設定：

```bash
kubectl apply -f k8s/argocd/image-updater-config.yaml
kubectl apply -f k8s/argocd/image-updater.yaml
```

---

## 8. 建立 namespace 與 credentials

先建立 OCT namespace：

```bash
kubectl create namespace oct --dry-run=client -o yaml | kubectl apply -f -
```

### 8.1 GHCR imagePullSecret

讓 OCT Pod 可以從 GHCR pull backend/frontend/worker/rootfs-puller/sandbox images：

```bash
kubectl -n oct create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username="$GITHUB_USER" \
  --docker-password="$GITHUB_PAT" \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 8.2 Image Updater registry credentials

讓 Image Updater 可以查詢 GHCR tags：

```bash
kubectl -n argocd create secret generic ghcr-creds \
  --from-literal=creds="$GITHUB_USER:$GITHUB_PAT" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/argocd-image-updater-controller -n argocd
```

### 8.3 Argo CD Git repo credentials

`k8s/argocd/application.yaml` 目前指向：

```text
https://github.com/kxiangw/Online-Code-Test
targetRevision: main
path: k8s
```

建立 Argo CD repository secret：

```bash
kubectl create secret generic oct-repo-creds \
  --from-literal=type=git \
  --from-literal=url=https://github.com/kxiangw/Online-Code-Test \
  --from-literal=username="$GITHUB_USER" \
  --from-literal=password="$GITHUB_PAT" \
  -n argocd \
  --dry-run=client -o yaml \
  | kubectl label --local -f - argocd.argoproj.io/secret-type=repository -o yaml \
  | kubectl apply -f -
```

> 如果你要測自己的 fork 或分支，請先修改 `k8s/argocd/application.yaml` 的 `repoURL` / `targetRevision`，或用 `kubectl patch application` 調整。

---

## 9. 透過 Argo CD 部署 OCT

在專案根目錄執行：

```bash
kubectl apply -f k8s/argocd/application.yaml
```

觀察 Argo CD Application：

```bash
kubectl get application oct-app -n argocd -w
```

等待 `SYNC STATUS=Synced`、`HEALTH STATUS=Healthy`。若欄位未顯示完整，可看詳細狀態：

```bash
kubectl describe application oct-app -n argocd
```

觀察 OCT Pod：

```bash
kubectl get pods -n oct -w
```

預期主要 Pod 都會 Running / Ready：

```text
backend
frontend
worker
postgres-0
rabbitmq-0
redis
prometheus
grafana
cadvisor
language-rootfs-puller
```

`language-rootfs-puller` 第一次啟動會從 GHCR 拉 `oct-sandbox-cpp:latest` 與 `oct-sandbox-python:latest`，再解到 `/var/lib/oct/rootfs`。Worker 的 `wait-rootfs` initContainer 會等 rootfs 存在才啟動。

---

## 10. 部署驗證

### 10.1 Kubernetes 狀態

```bash
kubectl get pods -n oct
kubectl get svc -n oct
kubectl get hpa -n oct
kubectl get scaledobject -n oct
```

KEDA worker ScaledObject 應存在：

```bash
kubectl describe scaledobject worker -n oct
```

### 10.2 Worker isolate / rootfs

```bash
kubectl -n oct logs deploy/worker | grep -E "sandbox engine|judge consumer"
```

預期看到類似：

```text
[worker] sandbox engine = isolate
[worker] judge consumer started
```

檢查 worker Pod 內的 isolate、seccomp wrapper、rootfs：

```bash
kubectl -n oct exec deploy/worker -- sh -c '
  isolate --version | head -1
  ls /etc/oct
  ls /var/lib/oct/rootfs
'
```

預期 rootfs 至少包含：

```text
cpp17
python3
```

### 10.3 Backend health

```bash
kubectl -n oct port-forward svc/backend 3000:3000 >/tmp/oct-backend-pf.log 2>&1 &
curl http://localhost:3000/api/health
```

預期：

```json
{"status":"ok"}
```

---

## 11. UI 與觀測服務

```bash
# Frontend
kubectl -n oct port-forward svc/frontend 5173:80 >/tmp/oct-frontend-pf.log 2>&1 &

# Grafana: admin / oct_dev_grafana
kubectl -n oct port-forward svc/grafana 3001:3000 >/tmp/oct-grafana-pf.log 2>&1 &

# Prometheus
kubectl -n oct port-forward svc/prometheus 9090:9090 >/tmp/oct-prometheus-pf.log 2>&1 &

# RabbitMQ management: oct / oct_dev_password
kubectl -n oct port-forward svc/rabbitmq 15672:15672 >/tmp/oct-rabbitmq-pf.log 2>&1 &

# Argo CD UI: admin / 第 6 章取得的初始密碼
kubectl -n argocd port-forward svc/argocd-server 8080:443 >/tmp/oct-argocd-pf.log 2>&1 &
```

打開：

| 服務 | URL |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000/api/health |
| Grafana | http://localhost:3001/d/oct-demo |
| Prometheus | http://localhost:9090 |
| RabbitMQ | http://localhost:15672 |
| Argo CD | https://localhost:8080 |

Frontend 也可以直接用 NodePort：

```bash
curl -I http://localhost:30173
```

---

## 12. 端到端真實 submission 測試

這段會直接寫入一筆 pending submission，送 RabbitMQ message，確認 worker 評測後更新 DB。seed data 中 `exam_session_problem_id=1` 是 P1「Two Sum」，所以提交程式要輸出兩個 index，不是 a+b。

```bash
# 0. 確認 exam_session_problem_id=1 目前對應哪一題
kubectl -n oct exec postgres-0 -- psql -U oct -d oct -c "
SELECT esp.id AS esp_id, p.title, tc.order_index, tc.input_data, tc.expected_output
FROM exam_session_problems esp
JOIN problems p ON p.id = esp.problem_id
JOIN problem_testcases tc ON tc.problem_id = p.id
WHERE esp.id = 1
ORDER BY tc.order_index;
"

# 1. Insert a simple Two Sum submission for seed problem P1
SID=$(kubectl -n oct exec -i postgres-0 -- psql -U oct -d oct -Atqc "
INSERT INTO submissions(exam_session_problem_id, candidate_id, language, source_code, submission_type, status)
SELECT esp.id, es.candidate_id, 'python3',
  E'n = int(input())\nnums = list(map(int, input().split()))\ntarget = int(input())\nfor i in range(n):\n    for j in range(i + 1, n):\n        if nums[i] + nums[j] == target:\n            print(i, j)\n            raise SystemExit',
  'simple', 'pending'
FROM exam_session_problems esp
JOIN exam_sessions es ON es.id = esp.exam_session_id
WHERE esp.id = 1
RETURNING submissions.id;
" | tr -cd '0-9')

echo "submission id: $SID"
```

推送 judge task：

```bash
kubectl -n oct exec rabbitmq-0 -- rabbitmqadmin -u oct -p oct_dev_password \
  publish exchange=amq.default routing_key=judge.tasks \
  payload="{\"submissionId\":$SID,\"type\":\"simple\"}"
```

等待並查結果：

```bash
sleep 3
kubectl -n oct exec postgres-0 -- psql -U oct -d oct -c "
SELECT id, status, verdict, runtime_ms, memory_kb
FROM submissions
WHERE id=$SID;

SELECT testcase_id, verdict, actual_output
FROM submission_testcase_results
WHERE submission_id=$SID
ORDER BY testcase_id;
"
```

預期：

```text
status = done
verdict = AC
```

Prometheus 驗證：

```bash
kubectl -n oct exec deploy/prometheus -- wget -qO- \
  'http://localhost:9090/api/v1/query?query=sum%20by%20(verdict)%20(judge_verdicts_total)' \
  | jq -r '.data.result[] | "verdict=\(.metric.verdict): \(.value[1])"'
```

---

## 13. KEDA 擴縮驗證

目前 `k8s/13-autoscaling.yaml` 設定：

| Target | 機制 | 範圍 |
| --- | --- | --- |
| worker | KEDA RabbitMQ queue length `judge.tasks` | 1-5 |
| backend | HPA CPU 70% / memory 80% | 1-3 |
| frontend | HPA CPU 70% | 1-3 |

檢查：

```bash
kubectl get hpa -n oct
kubectl get scaledobject -n oct
kubectl describe scaledobject worker -n oct
```

觀察 worker replicas：

```bash
kubectl get deploy worker -n oct -w
```

如果要手動製造 queue depth，可連續建立多筆 submission 並 publish task；KEDA polling interval 是 5 秒，queue 大於 5 時會開始擴 worker。

---

## 14. Image Updater 驗證

Application annotation 目前追蹤：

```text
ghcr.io/kxiangw/oct-backend
ghcr.io/kxiangw/oct-frontend
ghcr.io/kxiangw/oct-worker
```

允許 tag 格式：

```text
^[0-9a-f]{10}$
```

查看 Image Updater log：

```bash
kubectl -n argocd logs deploy/argocd-image-updater-controller --tail=100
```

手動要求掃描：

```bash
kubectl annotate application oct-app -n argocd \
  argocd-image-updater.argoproj.io/force-update=true --overwrite
```

手動觸發 Argo CD sync：

```bash
kubectl patch application oct-app -n argocd \
  --type merge -p '{"operation":{"sync":{}}}'
```

---

## 15. 本機 build/import 備援流程

如果 GHCR image 還沒推好，或你想測本機改動，可以用此流程把 image 匯入 k3s containerd。這條路適合整合測試，但不是標準 GitOps，因為 Argo CD 仍會讀 GitHub 上的 manifests。

先安裝 Docker：

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

在專案根目錄 build：

```bash
make bootstrap
make sandbox-images
docker compose build backend frontend worker
docker build -t oct-language-rootfs-puller:latest ./worker/puller
```

Tag 成 manifests 目前使用的 image 名稱：

```bash
docker tag oct-backend:latest ghcr.io/kxiangw/oct-backend:791678336e
docker tag oct-frontend:latest ghcr.io/kxiangw/oct-frontend:791678336e
docker tag oct-worker:latest ghcr.io/kxiangw/oct-worker:791678336e
docker tag oct-language-rootfs-puller:latest ghcr.io/kxiangw/oct-language-rootfs-puller:latest
docker tag oct-sandbox-cpp:12 ghcr.io/kxiangw/oct-sandbox-cpp:latest
docker tag oct-sandbox-python:3.11 ghcr.io/kxiangw/oct-sandbox-python:latest
```

匯入 k3s containerd：

```bash
mkdir -p /tmp/k3s-images
docker save \
  ghcr.io/kxiangw/oct-backend:791678336e \
  ghcr.io/kxiangw/oct-frontend:791678336e \
  ghcr.io/kxiangw/oct-worker:791678336e \
  ghcr.io/kxiangw/oct-language-rootfs-puller:latest \
  ghcr.io/kxiangw/oct-sandbox-cpp:latest \
  ghcr.io/kxiangw/oct-sandbox-python:latest \
  -o /tmp/k3s-images/oct-all.tar

sudo k3s ctr images import /tmp/k3s-images/oct-all.tar
sudo k3s crictl images | grep oct-
```

準備 rootfs hostPath：

```bash
make -C worker build-isolate-rootfs
sudo mkdir -p /var/lib/oct/rootfs
sudo cp -a /tmp/oct-rootfs/. /var/lib/oct/rootfs/
sudo chmod -R a+rX /var/lib/oct/rootfs
ls /var/lib/oct/rootfs
```

若不用 Argo CD、只想直接套本機 manifests，請用 local overlay 把 app images 改成 `IfNotPresent`：

```bash
mkdir -p /tmp/oct-local-overlay
cp -r k8s /tmp/oct-local-overlay/k8s-src

cat >/tmp/oct-local-overlay/kustomization.yaml <<'EOF'
namespace: oct
resources:
  - ./k8s-src
patches:
  - target: { kind: Deployment, name: worker }
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/imagePullPolicy
        value: IfNotPresent
  - target: { kind: Deployment, name: backend }
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/imagePullPolicy
        value: IfNotPresent
  - target: { kind: Deployment, name: frontend }
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/imagePullPolicy
        value: IfNotPresent
EOF

kubectl apply -k /tmp/oct-local-overlay
```

---

## 16. 常見問題

### `ScaledObject` CRD 找不到

代表 KEDA 尚未安裝或尚未 ready：

```bash
kubectl get pods -n keda
kubectl get crd scaledobjects.keda.sh
```

修復：

```bash
helm upgrade --install keda kedacore/keda -n keda --create-namespace
```

### Worker 卡在 `Init:wait-rootfs`

檢查 rootfs puller：

```bash
kubectl -n oct logs daemonset/language-rootfs-puller --tail=100
kubectl -n oct describe pod -l app=language-rootfs-puller
```

若 log 出現：

```text
unable to retrieve auth token: invalid username/password: unauthorized
```

先確認 `ghcr-secret` 是用正確 GitHub user / PAT 建立，且 PAT 有 `read:packages` 權限：

```bash
kubectl -n oct delete secret ghcr-secret --ignore-not-found
kubectl -n oct create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username="$GITHUB_USER" \
  --docker-password="$GITHUB_PAT"

kubectl -n oct rollout restart daemonset/language-rootfs-puller
kubectl -n oct logs -f daemonset/language-rootfs-puller
```

`language-rootfs-puller` 需要在容器內執行 `skopeo inspect/copy`，所以 `k8s/08a-language-puller.yaml` 會把 `ghcr-secret` mount 到 `/root/.docker/config.json`。只設定 `imagePullSecrets` 不夠，因為那只給 kubelet 拉 puller image 使用。

常見原因：

| 原因 | 解法 |
| --- | --- |
| GHCR token 無效 | 重建 `oct/ghcr-secret` 後重啟 `language-rootfs-puller` |
| puller 容器內沒有 `/root/.docker/config.json` | 套用新版 `k8s/08a-language-puller.yaml`，或用 live patch 補 mount |
| sandbox image 不存在或 private | 確認 GHCR package 與 PAT `read:packages` |
| 離線環境 | 用第 15 章本機 build/import 並手動準備 `/var/lib/oct/rootfs` |

### Worker log 出現 `Cannot mount /var/lib/oct/rootfs/<lang>/bin`

這代表語言 rootfs symlink 指到了 umoci 解包目錄的上一層，而不是實際 rootfs。新版 `language-rootfs-puller` 會把 symlink 指到 `<digest-dir>/rootfs`。

若剛 push puller 修正，等 CI 推出 `ghcr.io/kxiangw/oct-language-rootfs-puller:latest` 後重啟 DaemonSet：

```bash
kubectl -n oct rollout restart daemonset/language-rootfs-puller
kubectl -n oct logs -f daemonset/language-rootfs-puller
```

已經下載舊 rootfs、想先在現有單機環境臨時校正 symlink，可執行：

```bash
kubectl -n oct exec daemonset/language-rootfs-puller -- sh -c '
set -eu
cd /var/lib/oct/rootfs
for lang in cpp17 python3; do
  target=$(readlink "$lang")
  case "$target" in
    */rootfs) echo "$lang already ok" ;;
    *) test -d "$target/rootfs/bin" && ln -sfn "$target/rootfs" "$lang.new" && mv -Tf "$lang.new" "$lang" ;;
  esac
done
'
```

### Pod `ImagePullBackOff`

```bash
kubectl -n oct describe pod <pod-name>
kubectl -n oct get secret ghcr-secret
```

若使用本機匯入 image，確認該 Deployment 的 `imagePullPolicy` 已改成 `IfNotPresent`，或 image 已能從 GHCR pull。

### isolate cgroup 錯誤

若 worker log 出現類似：

```text
Failed to create control group /sys/fs/cgroup/box-0
```

確認 k3s config：

```bash
cat /etc/rancher/k3s/config.yaml
```

應包含：

```yaml
kubelet-arg:
  - cgroup-driver=systemd
```

重啟：

```bash
sudo systemctl restart k3s
kubectl -n oct rollout restart deploy/worker
```

### Argo CD Application sync 失敗

```bash
kubectl describe application oct-app -n argocd
kubectl -n argocd logs deploy/argocd-repo-server --tail=100
kubectl -n argocd logs deploy/argocd-application-controller --tail=100
```

常見原因是 repo credential 不正確、`repoURL`/`targetRevision` 寫錯，或 KEDA CRD 尚未安裝。

---

## 17. 清理與重裝

停止 port-forward：

```bash
pkill -f 'kubectl.*port-forward' || true
```

刪除 OCT application 與 namespace：

```bash
kubectl delete application oct-app -n argocd --ignore-not-found
kubectl delete namespace oct --ignore-not-found
sudo rm -rf /var/lib/oct/rootfs /tmp/oct-k8s-judge /tmp/oct-rootfs /tmp/oct-local-overlay
```

刪除 Argo CD / KEDA：

```bash
kubectl delete namespace argocd --ignore-not-found
kubectl delete namespace keda --ignore-not-found
```

完全卸載 k3s：

```bash
sudo /usr/local/bin/k3s-uninstall.sh
```

---

## 18. Quick Reference

```bash
# Persistent variables
cat > ~/.oct-ghcr-env <<'EOF'
export GITHUB_USER="ChiaPin-Yi"
export GITHUB_PAT="<github-classic-pat-with-repo-and-read-packages>"
EOF
chmod 600 ~/.oct-ghcr-env
grep -qxF 'source ~/.oct-ghcr-env' ~/.bashrc || echo 'source ~/.oct-ghcr-env' >> ~/.bashrc
source ~/.oct-ghcr-env

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Base packages
sudo apt update
sudo apt install -y curl ca-certificates gnupg lsb-release jq git socat

# k3s
sudo mkdir -p /etc/rancher/k3s
printf 'kubelet-arg:\n  - cgroup-driver=systemd\n' | sudo tee /etc/rancher/k3s/config.yaml
curl -sfL https://get.k3s.io | sudo INSTALL_K3S_EXEC="--disable=traefik --write-kubeconfig-mode=644" sh -

# Helm
sudo apt install -y apt-transport-https
curl -fsSL https://packages.buildkite.com/helm-linux/helm-debian/gpgkey \
  | gpg --dearmor \
  | sudo tee /usr/share/keyrings/helm.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/helm.gpg] https://packages.buildkite.com/helm-linux/helm-debian/any/ any main" \
  | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list
sudo apt update && sudo apt install -y helm

# KEDA
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm upgrade --install keda kedacore/keda -n keda --create-namespace
kubectl -n keda rollout status deployment/keda-operator --timeout=180s

# Argo CD
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml \
  --server-side --force-conflicts
kubectl wait --for=condition=available --timeout=180s deployment/argocd-server -n argocd

# Image Updater
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v1.2.0/config/install.yaml
kubectl -n argocd rollout status deployment/argocd-image-updater-controller --timeout=180s
kubectl apply -f k8s/argocd/image-updater-config.yaml
kubectl apply -f k8s/argocd/image-updater.yaml

# Credentials
kubectl create namespace oct --dry-run=client -o yaml | kubectl apply -f -
kubectl -n oct create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username="$GITHUB_USER" \
  --docker-password="$GITHUB_PAT" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n argocd create secret generic ghcr-creds \
  --from-literal=creds="$GITHUB_USER:$GITHUB_PAT" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic oct-repo-creds \
  --from-literal=type=git \
  --from-literal=url=https://github.com/kxiangw/Online-Code-Test \
  --from-literal=username="$GITHUB_USER" \
  --from-literal=password="$GITHUB_PAT" \
  -n argocd \
  --dry-run=client -o yaml \
  | kubectl label --local -f - argocd.argoproj.io/secret-type=repository -o yaml \
  | kubectl apply -f -
kubectl rollout restart deployment/argocd-image-updater-controller -n argocd

# Deploy
kubectl apply -f k8s/argocd/application.yaml
kubectl get application oct-app -n argocd -w

# Verify
kubectl get pods -n oct
kubectl get hpa,scaledobject -n oct
kubectl -n oct logs deploy/worker | grep -E "sandbox engine|judge consumer"
kubectl -n oct port-forward svc/frontend 5173:80
```
