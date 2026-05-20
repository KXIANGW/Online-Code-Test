# OCT 叢集架設完整教學

> Online Code Test (OCT) 平台有兩種架設方式：**Docker Compose**（適合本地開發）與 **k3s + Argo CD**（模擬正式 Kubernetes 環境，映像自動更新）。兩種方式均可透過 `http://localhost:5173` 進行真實 End-to-End 測試。

---

## 目錄

1. [架構概覽](#架構概覽)
2. [Method 1 — Docker Compose](#method-1--docker-compose)
3. [Method 2 — k3s + Argo CD](#method-2--k3s--argo-cd)
   - [一、安裝 k3s 環境](#一安裝-k3s-環境)
   - [二、安裝 Argo CD](#二安裝-argo-cd)
   - [三、安裝 Argo CD Image Updater](#三安裝-argo-cd-image-updater)
   - [四、設定 GHCR 存取憑證](#四設定-ghcr-存取憑證)
   - [五、部署至 k3s](#五部署至-k3s)
   - [六、準備 Sandbox 映像](#六準備-sandbox-映像)
   - [七（選用）— KEDA 自動擴縮 Worker](#七選用keda-自動擴縮-worker)
4. [觀測性儀表板](#觀測性儀表板)
5. [常見問題排除](#常見問題排除)

---

## 架構概覽

```
瀏覽器 localhost:5173
        │
        ▼
  ┌─────────────┐
  │  frontend   │  nginx:1.27-alpine  port 80
  │  (React SPA)│  /api/* → proxy → backend:3000
  └──────┬──────┘
         │ http://backend:3000
         ▼
  ┌─────────────┐       ┌──────────┐       ┌────────┐
  │   backend   │──────▶│ rabbitmq │◀──────│ worker │
  │  (Fastify)  │       │  :5672   │       │ :8080  │
  │   port 3000 │       └──────────┘       └───┬────┘
  └──────┬──────┘                              │
         │                            spawns Docker containers
  ┌──────┴──────┐              ┌──────────────┴──────────────┐
  │  postgres   │              │  oct-sandbox-cpp / python   │
  │   :5432     │              │  (run submitted code)       │
  └─────────────┘              └─────────────────────────────┘
  ┌─────────────┐
  │    redis    │
  │   :6379     │
  └─────────────┘
```

### 服務一覽

| 服務 | 映像 | Host Port | 說明 |
|------|------|-----------|------|
| frontend | ghcr.io/kxiangw/oct-frontend | **5173** | React SPA + nginx reverse proxy |
| backend | ghcr.io/kxiangw/oct-backend | 3000 | Fastify REST API + WebSocket |
| worker | ghcr.io/kxiangw/oct-worker | — | Judge service（需掛 Docker socket） |
| postgres | postgres:16-alpine | 5432 | 主資料庫 |
| rabbitmq | rabbitmq:3.13-mgmt | 5672, 15672, 15692 | 任務佇列 |
| redis | redis:7-alpine | 6379 | Session & 快取 |
| prometheus | prom/prometheus | 9090 | 指標收集 |
| grafana | grafana/grafana | 3001 | 視覺化儀表板 |
| cadvisor | gcr.io/cadvisor | 8081 | 容器資源指標 |

---

## Method 1 — Docker Compose

### 先決條件

| 工具 | 最低版本 | 安裝 |
|------|---------|------|
| Docker Engine | 24.x | https://docs.docker.com/get-docker/ |
| Docker Compose | v2.x | 已內建於 Docker Desktop |
| Docker socket | — | `/var/run/docker.sock` 必須可存取 |

```bash
# 確認版本
docker --version          # Docker version 24+
docker compose version    # Docker Compose version v2+
```

### 步驟 1 — 環境設定

```bash
cd /path/to/Online-Code-Test

# 複製環境變數範本
cp .env.example .env
```

> `.env` 預設值已可直接開發使用，無需修改。若有 port 衝突，調整 `HOST_*_PORT` 變數即可。

### 步驟 2 — 建置 Sandbox 映像

Worker 執行提交的程式碼時，會在本地 Docker daemon 啟動沙盒容器，需先建置：

```bash
# C++17 沙盒映像
docker build -t oct-sandbox-cpp:12 ./worker/sandbox/cpp/

# Python 3.11 沙盒映像
docker build -t oct-sandbox-python:3.11 ./worker/sandbox/python/

# 確認映像存在
docker images | grep oct-sandbox
```

### 步驟 3 — 啟動全部服務

```bash
docker compose up --build -d
```

### 步驟 4 — 等待健康檢查

```bash
# 觀察各服務狀態（等到所有 STATUS 都是 healthy）
watch docker compose ps

# 或一次性查詢
docker compose ps
```

啟動順序：postgres → rabbitmq → redis → backend → worker → frontend → prometheus → grafana

> 初次啟動約需 **60–90 秒**（資料庫初始化 + 映像建置）。

### 步驟 5 — 驗證

```bash
# API 健康檢查
curl http://localhost:3000/api/health
# 預期: {"status":"ok"}

# 前端
open http://localhost:5173       # macOS
xdg-open http://localhost:5173   # Linux
```

瀏覽器應顯示 OCT 登入頁面，可使用 seed 資料帳號：

```
帳號: admin（或查看 infra/postgres/09-seed.sql）
```

### 常用指令

```bash
# 查看特定服務 log
docker compose logs -f backend
docker compose logs -f worker

# 擴充 worker 副本（測試 autoscaling）
docker compose up --scale worker=3 -d

# 重新建置特定服務（不停其他服務）
docker compose up --build backend -d

# 進入 container 除錯
docker compose exec postgres psql -U oct -d oct
docker compose exec redis redis-cli

# 查看所有指標
curl http://localhost:3000/api/metrics
```

### 停止與清理

```bash
# 停止（保留資料 volume）
docker compose down

# 完整清理（含 volume、重置資料庫）
docker compose down -v
```

---

## Method 2 — k3s + Argo CD

> k3s 是輕量化 Kubernetes 發行版。應用映像（backend、frontend、worker）直接從 GHCR pull，由 **Argo CD** 管理部署狀態，**Argo CD Image Updater** 自動偵測 CI 推上的新 image 並觸發 rolling update。
>
> **整體流程：** 一、安裝 k3s → 二～四、安裝 Argo CD + 設定憑證 → 五、deploy → 之後 CI push 自動更新

### 一、安裝 k3s 環境

#### macOS — OrbStack + Ubuntu VM（推薦）

k3s 需要 Linux kernel，無法在 macOS 上直接執行。使用 **OrbStack** 建立輕量 Ubuntu VM，在 VM 內跑 k3s + Docker，本機 `kubectl` 透過 kubeconfig 遠端連線。

**Step 1 — 建立 Ubuntu VM**

```bash
# 需先安裝 OrbStack：https://orbstack.dev/
orb create ubuntu k3s-master
```

**Step 2 — 進入 VM，安裝 Docker + k3s**

```bash
ssh k3s-master@orb
```

在 VM 內執行：

```bash
# 安裝 Docker（worker pod 需要 docker.sock）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# 安裝 k3s，指定使用 Docker 作為 container runtime
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--docker" sh -

# kubectl port-forward 需要 socat
sudo apt update
sudo apt install -y socat

# 驗證節點 Ready
sudo kubectl get nodes
# NAME         STATUS   ROLES           AGE   VERSION
# k3s-master   Ready    control-plane   ...   v1.35.x+k3s1

exit  # 回到 Mac terminal
```

**Step 3 — 讓本機 kubectl 連上 VM 內的 cluster**

先開一個 terminal 建立 SSH tunnel，這個 terminal 需要保持開啟：

```bash
ssh -N -L 6443:127.0.0.1:6443 k3s-master@orb
```

再開另一個 terminal，把 k3s kubeconfig 複製到本機：

```bash
mkdir -p ~/.kube

ssh k3s-master@orb "sudo cat /etc/rancher/k3s/k3s.yaml" > ~/.kube/config
chmod 600 ~/.kube/config

# 驗證本機連線
kubectl get nodes
# 預期輸出：k3s-master   Ready   control-plane
```

---

### 二、安裝 Argo CD

```bash
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace oct --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml \
  --server-side --force-conflicts
```

> `argocd` namespace 用於安裝 Argo CD；`oct` namespace 用於部署 OCT 應用與建立 GHCR imagePullSecret。

> **K3S 注意事項：** 加上 `--server-side --force-conflicts` 可避免 K3S 上 Argo CD CRD 的 annotation 超過 262144 bytes 的錯誤。

```bash
# 等待 Argo CD 就緒（約 60 秒）
kubectl wait --for=condition=available --timeout=120s deployment/argocd-server -n argocd

# 取得初始 admin 密碼
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d && echo
```

---

### 三、安裝 Argo CD Image Updater

```bash
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v1.2.0/config/install.yaml
```

---

### 四、設定 GHCR 存取憑證

需要兩種 PAT，可以用同一個 token（同時含兩種 scope）或兩個分開的 token：

| 用途 | Scope | 建立位置 |
|------|-------|----------|
| Pull GHCR images（pods + Image Updater） | `read:packages` | Settings → Developer settings → Tokens (classic) |
| 讀取 Git repo（Argo CD sync） | `repo` | 同上，勾選 `repo` |

> **共同開發 repo 注意：** Fine-grained PAT 只能選自己帳號的 repo；若 repo 屬於他人，使用 **Classic PAT** with `repo` scope，它會自動套用到你有 collaborator 權限的所有 repo。

#### 4.1 GHCR imagePullSecret（oct namespace）

讓 K3S pods 從 GHCR pull 應用映像：

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=ChiaPin-Yi \
  --docker-password=<github-pat-read-packages> \
  -n oct \
  --dry-run=client -o yaml | kubectl apply -f -
```

#### 4.2 GHCR registry credentials（argocd namespace）

讓 Image Updater 查詢 GHCR registry API：

```bash
kubectl create secret generic ghcr-creds \
  --from-literal=creds=$(echo -n "ChiaPin-Yi:<github-pat-read-packages>" | base64) \
  -n argocd \
  --dry-run=client -o yaml | kubectl apply -f -
```

套用 Image Updater registry 設定並重啟：

```bash
kubectl apply -f k8s/argocd/image-updater-config.yaml
kubectl rollout restart deployment/argocd-image-updater-controller -n argocd
```

#### 4.3 Git repo credentials（argocd namespace）

讓 Argo CD 讀取 Git repo 的 k8s manifests：

```bash
kubectl create secret generic oct-repo-creds \
  --from-literal=type=git \
  --from-literal=url=https://github.com/kxiangw/Online-Code-Test \
  --from-literal=username=ChiaPin-Yi \
  --from-literal=password=<github-pat-repo-scope> \
  -n argocd \
  --dry-run=client -o yaml \
  | kubectl label --local -f - argocd.argoproj.io/secret-type=repository -o yaml \
  | kubectl apply -f -
```

---

### 五、部署至 k3s

Argo CD 會自動 sync `k8s/` 目錄下所有 manifests，無需逐一 apply：

```bash
kubectl apply -f k8s/argocd/application.yaml
```

觀察 Application 狀態（等待 `Synced` + `Healthy`）：

```bash
kubectl get application oct-app -n argocd
```

確認所有 Pod 正常啟動：

```bash
kubectl get pods -n oct -w
```

#### 存取前端（localhost:5173）

```bash
kubectl port-forward -n oct svc/frontend 5173:80 &
open http://localhost:5173       # macOS
xdg-open http://localhost:5173   # Linux
```

或直接使用 NodePort（不需 port-forward）：

```bash
open http://localhost:30173
```

#### 存取其他服務

```bash
# Backend API
kubectl port-forward -n oct svc/backend 3000:3000 &
curl http://localhost:3000/api/health

# Prometheus
kubectl port-forward -n oct svc/prometheus 9090:9090 &
open http://localhost:9090

# Grafana（帳號 admin / oct_dev_grafana）
kubectl port-forward -n oct svc/grafana 3001:3000 &
open http://localhost:3001

# RabbitMQ Management UI（帳號 oct / oct_dev_password）
kubectl port-forward -n oct svc/rabbitmq 15672:15672 &
open http://localhost:15672

# Argo CD Web UI（帳號 admin / 初始密碼見上方）
kubectl port-forward svc/argocd-server -n argocd 8080:443 &
open https://localhost:8080
```

#### 映像自動更新流程

CI push 新 image 後，**不需要任何手動操作**，Argo CD Image Updater 會自動偵測並觸發 rolling update。若需要立即觸發：

```bash
# 強制 Image Updater 立即掃描
kubectl annotate application oct-app -n argocd \
  argocd-image-updater.argoproj.io/force-update=true --overwrite

# 或手動 sync
kubectl patch application oct-app -n argocd \
  --type merge -p '{"operation":{"sync":{}}}'
```

---

### 六、準備 Sandbox 映像

Sandbox images 雖然也在 GHCR，但 worker 透過 `/var/run/docker.sock` 以短名稱（`oct-sandbox-cpp:12`）啟動 container，Docker daemon 不會自動去 GHCR 找，因此仍需在 VM 內手動 pull + tag（只需做一次）：

```bash
ssh k3s-master@orb

# 登入 GHCR（read:packages 的 PAT 即可）
echo "<github-pat-read-packages>" | docker login ghcr.io -u "ChiaPin-Yi" --password-stdin

docker pull ghcr.io/kxiangw/oct-sandbox-cpp:12
docker pull ghcr.io/kxiangw/oct-sandbox-python:3.11
docker tag ghcr.io/kxiangw/oct-sandbox-cpp:12 oct-sandbox-cpp:12
docker tag ghcr.io/kxiangw/oct-sandbox-python:3.11 oct-sandbox-python:3.11

# 確認
docker images | grep oct-sandbox

exit
```

---

### 七（選用）— KEDA 自動擴縮 Worker

KEDA 根據 RabbitMQ 佇列深度、CPU 使用率、in-flight task 數量自動調整 worker 副本數（1–5 個）。Worker 有現成的 Helm Chart（`charts/common-worker`），包含 KEDA ScaledObject。

#### 安裝 KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace

# 等待 KEDA Ready
kubectl wait --for=condition=ready pod -l app=keda-operator -n keda --timeout=60s
```

#### 部署 Worker via Helm Chart

```bash
# 先移除 Argo CD 管理的 worker（若已存在）
kubectl delete deployment worker -n oct --ignore-not-found

helm upgrade --install oct-worker ./charts/common-worker \
  --namespace oct \
  --set image.repository=ghcr.io/kxiangw/oct-worker \
  --set image.pullPolicy=Always \
  --set env.RABBITMQ_URL="amqp://oct:oct_dev_password@rabbitmq:5672" \
  --set env.DATABASE_URL="postgres://oct:oct_dev_password_change_me@postgres:5432/oct" \
  --set keda.prometheusAddress="http://prometheus.oct.svc:9090"
```

#### 驗證 KEDA 狀態

```bash
kubectl get scaledobject -n oct
kubectl get hpa -n oct
# READY=True 表示 KEDA 已接管 worker 副本數控制
```

---

### 停止與清理

```bash
# 停止所有 port-forward
kill $(lsof -ti:5173,3000,9090,3001,15672,8080) 2>/dev/null || true

# 暫停整個 k3s VM（保留 Kubernetes resources 和資料）
orb stop k3s-master

# 重新啟動 VM
orb start k3s-master
```

若要刪除部署資源：

```bash
# 清除應用 namespace（Argo CD 會在下次 sync 時自動重建）
kubectl delete namespace oct

# 手動觸發 Argo CD 重新 sync
kubectl patch application oct-app -n argocd \
  --type merge -p '{"operation":{"sync":{}}}'

# 完全移除 Argo CD（選用）
kubectl delete namespace argocd
```

---

## 觀測性儀表板

| 服務 | URL（Docker Compose） | URL（k3s port-forward） | 帳號 |
|------|---------------------|------------------------|------|
| Frontend | http://localhost:5173 | http://localhost:5173 | — |
| Backend API | http://localhost:3000/api/health | http://localhost:3000/api/health | — |
| Prometheus | http://localhost:9090 | http://localhost:9090 | — |
| Grafana | http://localhost:3001 | http://localhost:3001 | admin / oct_dev_grafana |
| RabbitMQ | http://localhost:15672 | http://localhost:15672 | oct / oct_dev_password |
| Prometheus Metrics | http://localhost:3000/api/metrics | http://localhost:3000/api/metrics | — |
| Argo CD UI | — | https://localhost:8080 | admin / 見安裝步驟 |

Grafana 預建儀表板「OCT Demo — 100 concurrent」包含：
- 系統整體吞吐量
- Judge in-flight task 數量
- Worker CPU / Memory
- RabbitMQ 佇列深度
- API 回應時間

---

## 常見問題排除

### Worker 無法啟動（docker.sock permission denied）

```bash
# Docker Compose
docker compose logs worker
# 若看到 "permission denied /var/run/docker.sock"

# 解法：確認 Docker socket 權限
ls -la /var/run/docker.sock
sudo chmod 666 /var/run/docker.sock

# 或將使用者加入 docker group
sudo usermod -aG docker $USER && newgrp docker
```

### k3s Worker Pod 無法掛載 docker.sock

```bash
kubectl describe pod -l app=worker -n oct
# 若看到 "hostPath type check failed"
# 表示 k3s node 上沒有 Docker daemon，確認安裝時使用了 --docker flag

# Linux 確認
systemctl status docker
systemctl status k3s
```

### Frontend 顯示 API 連線失敗

```bash
# Docker Compose：確認 backend service 健康
docker compose ps backend
docker compose logs backend --tail 20

# k3s：確認 port-forward 是否還在執行
ps aux | grep port-forward

# 測試 backend 是否可達（在 k8s 內部）
kubectl run curl-test --image=curlimages/curl --rm -it --restart=Never \
  -n oct -- curl http://backend:3000/api/health
```

### PostgreSQL 初始化失敗

```bash
# Docker Compose
docker compose logs postgres --tail 50

# k3s
kubectl logs -l app=postgres -n oct --tail 50

# 若看到 SQL 語法錯誤，確認 ConfigMap 中 SQL 文件順序
kubectl describe configmap postgres-init -n oct
```

### Argo CD Application 顯示 Unknown（sync 失敗）

```bash
# 查看詳細錯誤
kubectl describe application oct-app -n argocd | grep -A 5 "Message:"
```

**authentication required: Repository not found** → 需要建立 Git repo 憑證（見「四、設定 GHCR 存取憑證 → 4.3」）。

**Secret 更新（若 PAT 過期需換新）：**

```bash
# 更新任意 secret 的通用方式（加 --dry-run=client 可避免 already exists 錯誤）
kubectl create secret generic oct-repo-creds \
  --from-literal=type=git \
  --from-literal=url=https://github.com/kxiangw/Online-Code-Test \
  --from-literal=username=ChiaPin-Yi \
  --from-literal=password=<new-pat> \
  -n argocd \
  --dry-run=client -o yaml \
  | kubectl label --local -f - argocd.argoproj.io/secret-type=repository -o yaml \
  | kubectl apply -f -

# 重啟 repo-server 強制重新讀取憑證
kubectl rollout restart deployment/argocd-repo-server -n argocd
```

### Argo CD 安裝時 CRD annotation 超大錯誤（K3S）

```
The CustomResourceDefinition "applicationsets.argoproj.io" is invalid:
metadata.annotations: Too long: may not be more than 262144 bytes
```

使用 `--server-side` flag 重新套用：

```bash
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml \
  --server-side --force-conflicts
```

### Sandbox 映像不存在（Judge 失敗）

Worker 透過 host Docker socket 執行沙盒，映像必須存在於 **host Docker daemon**：

```bash
ssh k3s-master@orb
docker images | grep oct-sandbox

# 若不存在，從 GHCR pull 並 tag
echo "<github-pat>" | docker login ghcr.io -u "ChiaPin-Yi" --password-stdin
docker pull ghcr.io/kxiangw/oct-sandbox-cpp:12
docker pull ghcr.io/kxiangw/oct-sandbox-python:3.11
docker tag ghcr.io/kxiangw/oct-sandbox-cpp:12 oct-sandbox-cpp:12
docker tag ghcr.io/kxiangw/oct-sandbox-python:3.11 oct-sandbox-python:3.11
exit
```

### RabbitMQ Prometheus Plugin 未啟用

```bash
# 確認 management UI 中 plugins 列表
curl -u oct:oct_dev_password http://localhost:15672/api/plugins

# 若 rabbitmq_prometheus 不在列表中
# k3s：重建 rabbitmq pod
kubectl rollout restart statefulset/rabbitmq -n oct
```
