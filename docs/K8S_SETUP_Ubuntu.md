# OCT k3s 部署教學（Ubuntu / 原生）

> 本文件針對 **Ubuntu 22.04 / 24.04 原生環境** 部署 Online Code Test 到 k3s，採用 Phase 4 架構：
>
> - **Worker 使用 IsolateEngine** 評測（無 docker.sock 依賴）
> - **Per-language rootfs** 由 `language-rootfs-puller` DaemonSet 在每個 Node 上展開到 hostPath
> - **oct-seccomp-wrapper** 在 isolate 之前套用 syscall 黑名單，補上 isolate v2.0 缺少的 seccomp 層
>
> macOS 使用者請看 [K8S_SETUP.md](./K8S_SETUP.md)（OrbStack VM 流程）。本文件假設 Linux host，所以不需要 VM。

---

## 目錄

1. [架構與 sandbox 模式](#架構與-sandbox-模式)
2. [先決條件](#先決條件)
3. [安裝 k3s（systemd cgroup driver）](#安裝-k3s-systemd-cgroup-driver)
4. [Build + tag 本機 image](#build--tag-本機-image)
5. [匯入 image 到 k3s containerd](#匯入-image-到-k3s-containerd)
6. [預備 rootfs hostPath](#預備-rootfs-hostpath)
7. [建立 namespace + secrets](#建立-namespace--secrets)
8. [套用 manifest](#套用-manifest)
9. [驗證部署](#驗證部署)
10. [端到端真實 submission](#端到端真實-submission)
11. [清理 / 卸載](#清理--卸載)
12. [Argo CD 流程？](#argo-cd-流程)
13. [常見問題](#常見問題)

---

## 架構與 sandbox 模式

```
┌──────────────────────────────────────────────────────────────────┐
│  k3s Node                                                          │
│                                                                    │
│  ┌─────────────────────────────┐   ┌──────────────────────────┐  │
│  │ Worker Pod (privileged)      │   │ language-rootfs-puller   │  │
│  │ ┌─────────────────────────┐ │   │   DaemonSet              │  │
│  │ │ Node.js consumer        │ │   │ (skopeo + umoci)         │  │
│  │ │ IsolateEngine           │ │   └──────────────────────────┘  │
│  │ │  └─ /usr/local/bin/     │ │              │ writes            │
│  │ │     isolate + oct-      │ │              ▼                  │
│  │ │     seccomp-wrapper     │ │   ┌──────────────────────────┐  │
│  │ └─────────────────────────┘ │   │ hostPath                 │  │
│  │      │  readonly mount       │   │ /var/lib/oct/rootfs/     │  │
│  │      ▼                       │◀──│   cpp17/  python3/       │  │
│  │ /var/lib/oct/rootfs/         │   └──────────────────────────┘  │
│  │                              │                                  │
│  │ ┌─────────────────────────┐ │                                  │
│  │ │ isolate --cg \           │ │                                  │
│  │ │   --dir=/usr=rootfs/usr  │ │                                  │
│  │ │   --dir=/code=/tmp/judge │ │                                  │
│  │ │   --run -- /oct-seccomp/ │ │                                  │
│  │ │     seccomp-wrapper      │ │                                  │
│  │ │     ... -- g++/python3   │ │                                  │
│  │ └─────────────────────────┘ │                                  │
│  └─────────────────────────────┘                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Sandbox engine**：唯一引擎 = `sio2project/isolate` + `oct-seccomp-wrapper`。dev / prod 完全 parity：

| 部署方式 | 評測機制 | rootfs 來源 |
| --- | --- | --- |
| `docker compose up` | worker container 內 spawn isolate（cap_add SYS_ADMIN + cgroup: host） | `make build-isolate-rootfs` 解 docker image → `/tmp/oct-rootfs/` → bind |
| **本文件 k3s 部署** | worker Pod 內 spawn isolate（privileged: true） | `language-rootfs-puller` DaemonSet 解 GHCR image → hostPath `/var/lib/oct/rootfs/` |

兩條路執行 isolate 的命令 byte-for-byte 一樣，差別只在 rootfs 是怎麼到 host 上的（local `docker export` vs production `skopeo + umoci`）。

---

## 先決條件

| 工具 | 最低版本 | 安裝 |
| --- | --- | --- |
| Ubuntu | 22.04 / 24.04 | — |
| Docker Engine | 24.x | `curl -fsSL https://get.docker.com \| sh` |
| Linux kernel | cgroup v2 unified（systemd v243+ distro 預設都有） | 驗證：`stat -fc %T /sys/fs/cgroup` 應輸出 `cgroup2fs` |
| curl, jq | 任意 | `sudo apt install -y curl jq` |

```bash
# 確認版本
docker --version             # Docker version 24+
stat -fc %T /sys/fs/cgroup   # cgroup2fs  ← cgroup v2
```

---

## 安裝 k3s (systemd cgroup driver)

k3s 預設 cgroup driver 在某些版本上不會替 Pod delegate writable cgroup，導致 isolate `--cg` 失敗。明確指定 `cgroup-driver=systemd`：

```bash
# Step 1: 寫 k3s config
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/config.yaml >/dev/null <<'EOF'
kubelet-arg:
  - cgroup-driver=systemd
EOF

# Step 2: 安裝 k3s（disable traefik 因為我們不用、kubeconfig 讓一般 user 可讀）
curl -sfL https://get.k3s.io | sudo INSTALL_K3S_EXEC="--disable=traefik --write-kubeconfig-mode=644" sh -

# Step 3: 驗證
systemctl is-active k3s                           # active
kubectl --kubeconfig=/etc/rancher/k3s/k3s.yaml get nodes   # Ready

# Step 4: 讓本機 kubectl 預設讀 k3s kubeconfig
echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> ~/.bashrc
source ~/.bashrc
```

如果想之後加 KEDA 自動擴縮，需要 helm，請先：

```bash
curl https://baltocdn.com/helm/signing.asc | sudo gpg --dearmor -o /usr/share/keyrings/helm.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/helm.gpg] https://baltocdn.com/helm/stable/debian/ all main" | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list
sudo apt update && sudo apt install -y helm
```

---

## Build + tag 本機 image

k3s 用 containerd 當 runtime，本機 docker 的 image 預設**看不到**。我們會 build → 匯入 containerd。Tag 對齊 manifest 期望的名稱：

```bash
cd /path/to/Online-Code-Test

# 1. 確認 .env 存在
make bootstrap

# 2. Build sandbox images（cpp17 / python3）
make sandbox-images

# 3. Build worker image（含 isolate + oct-seccomp-wrapper）
docker compose build worker

# 4. Build puller image
docker build -t oct-language-rootfs-puller:latest ./worker/puller

# 5. 取得 GHCR 慣用 tag（manifest 內固定指向 ghcr.io/kxiangw/...）
docker tag oct-worker:latest                  ghcr.io/kxiangw/oct-worker:791678336e
docker tag oct-language-rootfs-puller:latest  ghcr.io/kxiangw/oct-language-rootfs-puller:latest
docker tag oct-sandbox-cpp:12                 ghcr.io/kxiangw/oct-sandbox-cpp:latest
docker tag oct-sandbox-python:3.11            ghcr.io/kxiangw/oct-sandbox-python:latest
docker tag oct-backend:latest                 ghcr.io/kxiangw/oct-backend:791678336e
docker tag oct-frontend:latest                ghcr.io/kxiangw/oct-frontend:791678336e
```

> backend / frontend image 用 `make up` 一次性產生（`docker compose build`），也可以個別 build：`docker compose build backend frontend`。

---

## 匯入 image 到 k3s containerd

```bash
# 1. 打包成 tarball
mkdir -p /tmp/k3s-images
docker save \
  ghcr.io/kxiangw/oct-worker:791678336e \
  ghcr.io/kxiangw/oct-language-rootfs-puller:latest \
  ghcr.io/kxiangw/oct-sandbox-cpp:latest \
  ghcr.io/kxiangw/oct-sandbox-python:latest \
  ghcr.io/kxiangw/oct-backend:791678336e \
  ghcr.io/kxiangw/oct-frontend:791678336e \
  -o /tmp/k3s-images/oct-all.tar

# 2. 匯入
sudo k3s ctr images import /tmp/k3s-images/oct-all.tar

# 3. 確認 image 已在 containerd
sudo k3s crictl images | grep oct-
```

匯入完成後可以刪掉 tarball（~2.7GB）：

```bash
rm -rf /tmp/k3s-images
```

---

## 預備 rootfs hostPath

`language-rootfs-puller` DaemonSet 預設會從 GHCR 拉 sandbox image（需要 PAT auth）。本機驗證沒 PAT 時，puller 會 CrashLoopBackOff，但 Worker 仍需 `/var/lib/oct/rootfs/<lang>/` 才能啟動。

兩條路：

### A. 本機驗證（推薦）：直接從本機 docker image 解壓 rootfs

```bash
make -C worker build-isolate-rootfs           # 解到 /tmp/oct-rootfs
sudo mkdir -p /var/lib/oct/rootfs
sudo cp -a /tmp/oct-rootfs/. /var/lib/oct/rootfs/
sudo chmod -R a+rX /var/lib/oct/rootfs

# 驗證
ls /var/lib/oct/rootfs/                       # cpp17  python3
test -x /var/lib/oct/rootfs/cpp17/usr/local/bin/g++ && echo "cpp17 OK"
test -x /var/lib/oct/rootfs/python3/usr/local/bin/python3 && echo "python3 OK"
```

### B. 生產：設定 GHCR auth 讓 puller 自己拉

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<your-github-username> \
  --docker-password=<github-pat-with-read-packages> \
  -n oct
```

然後 puller 第一次 reconcile 會把 image 解到 hostPath，Worker 自動 ready。

---

## 建立 namespace + secrets

```bash
# 建立 namespace
kubectl create namespace oct --dry-run=client -o yaml | kubectl apply -f -

# 本機驗證可以塞 dummy ghcr-secret（containerd 已有 image，imagePullSecret 只是讓 manifest 不報錯）
kubectl -n oct create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=local --docker-password=local \
  --dry-run=client -o yaml | kubectl apply -f -
```

`k8s/01-secrets.yaml` 已包含 DB / RabbitMQ / JWT 等密碼（dev default），不需手動建立。

---

## 套用 manifest

k8s manifest 預設 `imagePullPolicy: Always`，會優先去 GHCR 拉新版。本機驗證為了優先使用 containerd 內已匯入的 image，需要疊一層 kustomize overlay：

```bash
mkdir -p /tmp/oct-local-overlay
cp -r k8s /tmp/oct-local-overlay/k8s-src
cat > /tmp/oct-local-overlay/kustomization.yaml <<'EOF'
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

# 套用
kubectl apply -k /tmp/oct-local-overlay
```

若有 GHCR PAT 跟連得到 GHCR，可以直接 `kubectl apply -k k8s/` 不用 overlay。

> **KEDA ScaledObject 錯誤可忽略**：若沒裝 KEDA，apply 會顯示 `no matches for kind "ScaledObject"`。不影響其他資源部署。要 autoscaling 就裝 KEDA（見 [K8S_SETUP.md §六](./K8S_SETUP.md#六-pod-自動擴縮keda--hpa)）。

---

## 驗證部署

```bash
# 1. 等 Pod 全部 Ready（約 1-2 分鐘）
kubectl -n oct get pods -w
# 等所有 Pod 顯示 1/1 Running 後 Ctrl-C
```

預期狀態：

```
NAME                           READY   STATUS             RESTARTS   AGE
backend-xxx                    1/1     Running            0          90s
cadvisor-xxx                   1/1     Running            0          90s
frontend-xxx                   1/1     Running            0          90s
grafana-xxx                    1/1     Running            0          90s
language-rootfs-puller-xxx     0/1     CrashLoopBackOff   …          90s   ← 本機沒 GHCR PAT 時預期
postgres-0                     1/1     Running            0          90s
prometheus-xxx                 1/1     Running            0          90s
rabbitmq-0                     1/1     Running            0          90s
redis-xxx                      1/1     Running            0          90s
worker-xxx                     1/1     Running            0          90s
```

> **puller CrashLoopBackOff 在本機驗證時是預期的**（無 GHCR auth 拉不到 image）。Worker 不依賴 puller，hostPath rootfs 我們已預先填好。生產加上 GHCR PAT 後即綠。

```bash
# 2. Worker boot log 應該顯示 isolate engine
kubectl -n oct logs deploy/worker | grep -E "sandbox engine|judge consumer"
# [worker] sandbox engine = isolate
# [worker] judge consumer started

# 3. Worker 內 isolate + rootfs + seccomp wrapper 存在
kubectl -n oct exec deploy/worker -- sh -c '
  isolate --version | head -1
  ls /etc/oct/                # seccomp-wrapper + seccomp.policy
  ls /var/lib/oct/rootfs/     # cpp17 python3
'

# 4. Prometheus 看到 worker target up
kubectl -n oct exec deploy/prometheus -- wget -qO- \
  'http://localhost:9090/api/v1/query?query=up%7Bjob%3D%22worker%22%7D' \
  | jq -r '.data.result[] | "\(.metric.job) \(.value[1])"'
# worker 1
```

---

## 端到端真實 submission

驗證從「DB submission → RabbitMQ → Worker → IsolateEngine → 評測 → DB verdict」整條 pipeline：

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

# 2. 推 message
kubectl -n oct exec rabbitmq-0 -- rabbitmqadmin -u oct -p oct_dev_password \
  publish exchange=amq.default routing_key=judge.tasks \
  payload="{\"submissionId\":$SID,\"type\":\"simple\"}"

# 3. 等 verdict（通常 1-2 秒）
sleep 3
kubectl -n oct exec postgres-0 -- psql -U oct -d oct -c "
SELECT id, status, verdict, runtime_ms, memory_kb FROM submissions WHERE id=$SID;
SELECT testcase_id, verdict, actual_output FROM submission_testcase_results WHERE submission_id=$SID ORDER BY testcase_id;
"
```

預期看到 `status=done verdict=AC`。`simple` submission 只跑公開測資，所以隱藏測資可能顯示 `skipped`。

```bash
# 4. 看 Prometheus 統計
kubectl -n oct exec deploy/prometheus -- wget -qO- \
  'http://localhost:9090/api/v1/query?query=sum%20by%20(verdict)%20(judge_verdicts_total)' \
  | jq -r '.data.result[] | "verdict=\(.metric.verdict): \(.value[1])"'
# verdict=AC: 1
```

---

## 進一步：worker 內跑安全測試 e2e

`worker/scripts/isolate-e2e.mjs` 涵蓋 4 verdict + 7 安全測試 + 1 seccomp 驗證共 12 個 case：

```bash
POD=$(kubectl -n oct get pod -l app=worker -o jsonpath='{.items[0].metadata.name}')
kubectl -n oct cp ./worker/scripts/isolate-e2e.mjs ${POD}:/tmp/e2e.mjs
kubectl -n oct exec $POD -- sh -c '
  mkdir -p /tmp/judge && SECCOMP_BUNDLE_DIR=/etc/oct node /tmp/e2e.mjs
'
```

預期 `12/12 passed`。

---

## UI 存取

```bash
# Frontend
kubectl port-forward -n oct svc/frontend 5173:80 &
xdg-open http://localhost:5173

# Backend API
kubectl port-forward -n oct svc/backend 3000:3000 &
curl http://localhost:3000/api/health

# Grafana（admin / oct_dev_grafana）
kubectl port-forward -n oct svc/grafana 3001:3000 &
xdg-open http://localhost:3001/d/oct-demo

# Prometheus
kubectl port-forward -n oct svc/prometheus 9090:9090 &
xdg-open http://localhost:9090

# RabbitMQ management（oct / oct_dev_password）
kubectl port-forward -n oct svc/rabbitmq 15672:15672 &
xdg-open http://localhost:15672
```

關閉 port-forward：

```bash
pkill -f 'kubectl port-forward'
```

---

## 清理 / 卸載

```bash
# 拆掉 oct namespace（保留 k3s 本身）
kubectl delete namespace oct
sudo rm -rf /var/lib/oct/rootfs
rm -rf /tmp/oct-rootfs /tmp/oct-local-overlay

# 完全卸載 k3s
sudo /usr/local/bin/k3s-uninstall.sh
```

---

## Argo CD 流程？

本文件走「本機 build + 匯入」的快速驗證流程。如果要正式生產用 GitOps（CI push → Argo CD sync → Image Updater 自動 rolling update），請繼續看 [K8S_SETUP.md §二～六](./K8S_SETUP.md#二安裝-argo-cd)，其中：

- 安裝 Argo CD + Image Updater：完全照原文件做（namespace 切到 `argocd`）
- 設定 GHCR PAT：完全照原文件做
- 部署：`kubectl apply -f k8s/argocd/application.yaml`

差別：原文件用 `INSTALL_K3S_EXEC="--docker"`（k3s 用 host Docker daemon），本文件用預設 containerd（不需要 host 裝 Docker daemon）。

---

## 常見問題

### Worker Pod 一直 `Init:wait-rootfs`

`wait-rootfs` initContainer 等 `/var/lib/oct/rootfs/{cpp17,python3}` 出現。原因：
1. **本機沒準備 rootfs** → 跑 [§預備 rootfs hostPath](#預備-rootfs-hostpath) §A
2. **puller 沒成功 reconcile** → 看 puller log：
   ```bash
   kubectl -n oct logs daemonset/language-rootfs-puller
   ```
   常見錯誤：`unable to retrieve auth token: invalid username/password: unauthorized` → 補 GHCR PAT

### isolate `Failed to create control group /sys/fs/cgroup/box-0`

cgroup driver 沒切到 systemd。確認：

```bash
cat /etc/rancher/k3s/config.yaml         # 應有 cgroup-driver=systemd
sudo systemctl restart k3s
kubectl -n oct rollout restart deploy/worker
```

驗證 Pod 內 cgroup 已可寫：

```bash
kubectl -n oct exec deploy/worker -- sh -c '
  mount | grep "cgroup on /sys/fs/cgroup"
  mkdir /sys/fs/cgroup/test && echo "writable OK" && rmdir /sys/fs/cgroup/test
'
```

預期 mount 為 `rw,...` 且 mkdir 成功。

### `Application` 或 `ScaledObject` CRD 找不到

```
no matches for kind "ScaledObject" in version "keda.sh/v1alpha1"
```

→ 還沒裝 KEDA。本機驗證可忽略；要 autoscaling 就：

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda --namespace keda --create-namespace
kubectl wait --for=condition=ready pod -l app=keda-operator -n keda --timeout=60s
```

### Pod stuck 在 `ImagePullBackOff`

```bash
kubectl -n oct describe pod <pod-name> | tail -10
```

如果是「image not found」：本機驗證代表 image 沒匯入 containerd，回 [§匯入 image](#匯入-image-到-k3s-containerd) 重做。
要從 GHCR 拉就確認 ghcr-secret 是真實的 PAT。

### 改了 manifest 之後 Pod 沒換成新版

```bash
kubectl -n oct rollout restart deploy/<name>
# 或刪 Pod
kubectl -n oct delete pod -l app=<name>
```

---

## 整套 quick reference（指令連發）

```bash
# 1. 系統準備
sudo mkdir -p /etc/rancher/k3s
echo 'kubelet-arg:
  - cgroup-driver=systemd' | sudo tee /etc/rancher/k3s/config.yaml
curl -sfL https://get.k3s.io | sudo INSTALL_K3S_EXEC="--disable=traefik --write-kubeconfig-mode=644" sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# 2. Build + 匯入
cd /path/to/Online-Code-Test
make bootstrap && make sandbox-images
docker compose build worker
docker build -t oct-language-rootfs-puller:latest ./worker/puller
docker compose build backend frontend
for entry in \
  "oct-worker:latest ghcr.io/kxiangw/oct-worker:791678336e" \
  "oct-language-rootfs-puller:latest ghcr.io/kxiangw/oct-language-rootfs-puller:latest" \
  "oct-sandbox-cpp:12 ghcr.io/kxiangw/oct-sandbox-cpp:latest" \
  "oct-sandbox-python:3.11 ghcr.io/kxiangw/oct-sandbox-python:latest" \
  "oct-backend:latest ghcr.io/kxiangw/oct-backend:791678336e" \
  "oct-frontend:latest ghcr.io/kxiangw/oct-frontend:791678336e"; do
  docker tag $entry
done
mkdir -p /tmp/k3s-images
docker save \
  ghcr.io/kxiangw/oct-worker:791678336e \
  ghcr.io/kxiangw/oct-language-rootfs-puller:latest \
  ghcr.io/kxiangw/oct-sandbox-cpp:latest \
  ghcr.io/kxiangw/oct-sandbox-python:latest \
  ghcr.io/kxiangw/oct-backend:791678336e \
  ghcr.io/kxiangw/oct-frontend:791678336e \
  -o /tmp/k3s-images/oct-all.tar
sudo k3s ctr images import /tmp/k3s-images/oct-all.tar

# 3. Rootfs
make -C worker build-isolate-rootfs
sudo mkdir -p /var/lib/oct/rootfs
sudo cp -a /tmp/oct-rootfs/. /var/lib/oct/rootfs/
sudo chmod -R a+rX /var/lib/oct/rootfs

# 4. Namespace + secret + apply
kubectl create namespace oct --dry-run=client -o yaml | kubectl apply -f -
kubectl -n oct create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=local --docker-password=local \
  --dry-run=client -o yaml | kubectl apply -f -

mkdir -p /tmp/oct-local-overlay
cp -r k8s /tmp/oct-local-overlay/k8s-src
cat > /tmp/oct-local-overlay/kustomization.yaml <<'EOF'
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

# 5. 等 Pod Ready
kubectl -n oct wait --for=condition=ready pod -l app=worker --timeout=180s

# 6. 驗證
kubectl -n oct logs deploy/worker | grep "sandbox engine"
```
