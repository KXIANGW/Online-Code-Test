# Online Code Test — M5 Observability & Demo

NTHU 1142 雲原生 HW2 / Team 12。M1 → M5 累進疊加：非同步判題（M2）→ Ownership 強化（M3）→ Redis cache + draft auto-save（M4）→ Sandbox 強化 + Prometheus / Grafana 可觀測性 + 100 並發 demo（M5）。

各 component 詳細說明與測試指南：

- [Testing_README.md](./Testing_README.md) — 完整測試指南（環境建置、各 component 自動/手動測試）
- [backend/README.md](./backend/README.md) — Backend API 設計、endpoints 規格、測試覆蓋
- [frontend/README.md](./frontend/README.md) — Frontend 架構與開發環境設定
- [worker/README.md](./worker/README.md) — Judge worker 架構、RabbitMQ 協定、gVisor sandbox 設計、Prometheus metrics
- [infra/postgres/README.md](./infra/postgres/README.md) — Database schema、init scripts、RBAC 設計
- [infra/redis/README.md](./infra/redis/README.md) — Redis cache key 規格、TTL、降級行為
- [loadtest/README.md](./loadtest/README.md) — 100 並發 demo 操作手冊（seed / k6 / scale-watcher）

## 一鍵部署

需求：

- Docker Engine >= 24
- Docker Compose v2
- 正式沙箱隔離需在 host 安裝並設定 gVisor `runsc` runtime

```bash
cp .env.example .env
make up
make ps
```

啟動後服務入口：

| 服務 | 入口 |
|------|------|
| 前端 | <http://localhost:5173> |
| 後端健康檢查 | <http://localhost:3000/api/health> |
| 後端 Prometheus metrics | <http://localhost:3000/api/metrics> |
| RabbitMQ Management UI | <http://localhost:15672> (`oct` / `oct_dev_password`) |
| PostgreSQL | `localhost:5432` |
| Prometheus | <http://localhost:9090> |
| Grafana | <http://localhost:3001> (`admin` / `oct_dev_grafana`；匿名 viewer 已開放）|
| cAdvisor | <http://localhost:8081> |

如果本機尚未安裝 gVisor，可在 `.env` 暫時改用普通 Docker runtime：

```bash
SANDBOX_RUNTIME=runc
```

`runc` 只適合本機開發驗證，不提供 gVisor 的隔離效果。

## 常用 Makefile 指令

```bash
# 基本操作
make bootstrap       # 產生 .env
make sandbox-images  # 重建 oct-sandbox-cpp:12 / oct-sandbox-python:3.11
make up              # docker compose up -d --build（含 prometheus / grafana / cadvisor）
make ps              # 查看所有服務健康狀態
make logs            # 追蹤所有服務 log
make down            # 停止服務
make clean           # 停止服務並刪除 volumes
make rebuild         # clean + up
make psql            # 進入 psql shell

# 100 並發 demo（需先 make up）
make demo-seed       # 建立 100 個 candidate 帳號 + session（需要 Node.js 20+）
make demo-load       # k6 burst：100 VU 同時送出 submission
make demo-watch      # 啟動 scale-watcher：依 Prometheus 指標自動調整 worker 數量
make demo-100        # 上述三步驟一次完成
make demo-down       # 停止並清除 demo 資料
make demo-urls       # 列出 Grafana / Prometheus / RabbitMQ 等入口
```

## 服務一覽

| Service | 說明 | Host port |
|---------|------|-----------|
| `postgres` | PostgreSQL 16 | 5432 |
| `rabbitmq` | RabbitMQ + Management UI + Prometheus exporter | 5672 / 15672 / 15692 |
| `redis` | 快取（語言/題目/使用者）+ 考試草稿儲存 | 6379 |
| `backend` | Fastify API、WebSocket、RabbitMQ consumer、`/api/metrics` | 3000 |
| `worker` | Judge worker（Docker/gVisor sandbox）、`/metrics`、`/healthz` | internal (8080) |
| `frontend` | Vite build，由 nginx 提供靜態檔 | 5173 |
| `prometheus` | 抓取 backend / worker / cadvisor / rabbitmq metrics | 9090 |
| `grafana` | 自動載入「OCT Demo — 100 concurrent」13-panel dashboard | 3001 |
| `cadvisor` | Container CPU / memory 即時監控（供 KEDA scaling 用） | 8081 |

## 判題流程

1. Candidate 呼叫 `POST /api/exam-sessions/:id/submissions`。
2. Backend 建立 `submissions` row，初始狀態為 `pending`，並寫入 `submission_type`。
3. Backend 發布任務到 RabbitMQ `judge.tasks` queue。
4. Worker 一次消費一個任務：`simple` 只跑公開測資，`formal` 跑公開 + hidden 測資。
5. Worker 使用 Docker/gVisor 執行程式，將 testcase results 與 submission verdict 寫回 PostgreSQL。
6. Worker 發布 `judge.results`，backend 收到後透過 `/api/ws` 推送 `judge_result`。
7. 只有 `formal` 且 verdict 為 `AC` 時，才會更新 `exam_session_problems.score` 與 `exam_sessions.total_score`。

## 環境變數

`.env.example` 是範本，`.env` 是實際執行值。

| 變數 | 預設 | 說明 |
|------|------|------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `oct` / `oct_dev_password_change_me` / `oct` | PostgreSQL 帳號、密碼與 DB 名稱 |
| `DATABASE_URL` | `postgres://oct:...@postgres:5432/oct` | Backend / worker 使用的 DB 連線字串 |
| `JWT_SECRET` | dev secret | JWT 簽章密鑰，正式部署必改 |
| `RABBITMQ_USER` / `RABBITMQ_PASS` | `oct` / `oct_dev_password` | RabbitMQ 帳號與密碼 |
| `RABBITMQ_URL` | `amqp://oct:oct_dev_password@rabbitmq:5672` | Backend / worker 使用的 RabbitMQ 連線字串 |
| `REDIS_URL` | `redis://redis:6379` | Backend Redis 連線字串（cache + draft）|
| `HOST_WORK_DIR` | `/tmp/judge` | Worker 與 host Docker 共用的工作目錄 |
| `SANDBOX_RUNTIME` | `runsc` | 沙箱 runtime；本機無 gVisor 時可暫改 `runc` |
| `HOST_PROMETHEUS_PORT` | `9090` | Prometheus host port |
| `HOST_GRAFANA_PORT` | `3001` | Grafana host port |
| `HOST_CADVISOR_PORT` | `8081` | cAdvisor host port |
| `GRAFANA_PASSWORD` | `oct_dev_grafana` | Grafana admin 密碼 |
| `HOST_*_PORT` | 見 `.env.example` | 其餘 host port mapping |

## 測試與排錯

測試流程、自動測試指令、手動測試案例、常見問題請參閱 [Testing_README.md](./Testing_README.md)。

---

## Deployment（Kubernetes / k3s）

本章節說明如何將系統部署至 Kubernetes cluster，適合第一次接觸 k8s 的讀者。

### 基本概念

| 詞彙 | 白話說明 |
|------|---------|
| **Cluster** | 一群電腦組成的運算資源池，k8s 統一管理 |
| **Node** | Cluster 裡的每一台電腦（Master 負責排程，Worker 負責跑 container）|
| **Pod** | k8s 最小部署單位，一個 Pod 跑一個（或多個）container |
| **Deployment** | 告訴 k8s「我要跑幾個這個 Pod、用哪個 image」的設定檔 |
| **Service** | 讓 Pod 可以被其他 Pod 或外部存取的網路入口 |
| **Helm Chart** | 把多個 k8s yaml 打包成一個可重複部署的套件（類似 npm package）|
| **KEDA** | 根據 Queue 長度自動調整 Worker Pod 數量的 k8s 擴充套件 |

---

### 前置需求

在你的本機安裝以下工具：

```bash
# macOS
brew install kubectl   # 下指令給 cluster 的 CLI
brew install helm      # 部署 Helm Chart 用
brew install orbstack  # 在 Mac 上跑 Linux VM（用來當 k8s Node）
```

Windows 請改用 WSL2 + Ubuntu，再於 Ubuntu 內安裝 kubectl 與 helm。

---

### 建立 k3s Cluster

k3s 是輕量版 k8s，適合本機與實驗室環境，API 與標準 k8s 完全相容。

#### Step 1 — 建立 Linux VM（Mac 用 OrbStack）

```bash
# 建立名為 k3s-master 的 Ubuntu VM
orb create ubuntu k3s-master
```

#### Step 2 — 進入 VM

```bash
ssh k3s-master@orb
```

#### Step 3 — 在 VM 內安裝 k3s（Master Node）

```bash
curl -sfL https://get.k3s.io | sh -
```

安裝完成後驗證：

```bash
sudo kubectl get nodes
# 預期輸出：
# NAME         STATUS   ROLES           AGE   VERSION
# k3s-master   Ready    control-plane   ...   v1.35.x+k3s1
```

#### Step 4 — 讓本機 kubectl 連上 cluster

離開 VM（`exit`），回到 Mac terminal 執行：

```bash
mkdir -p ~/.kube

# 從 VM 複製 kubeconfig，並將 IP 從 VM 內部位址改為 VM 的實際 IP
ssh k3s-master@orb "sudo cat /etc/rancher/k3s/k3s.yaml" | \
  sed 's/127\.0\.0\.1/<VM_IP>/' > ~/.kube/config

chmod 600 ~/.kube/config
```

> `<VM_IP>` 請替換為 `orb list` 顯示的 IP（例如 `192.168.139.230`）

驗證本機連線：

```bash
kubectl get nodes
# 預期輸出：k3s-master   Ready   control-plane
```

---

### 加入更多 Node（多台電腦）

每台加入 cluster 的電腦都需要先跑一個 Linux 環境（Mac 用 OrbStack、Windows 用 WSL2）。

#### 取得 Master 的 Token（在 Master VM 內執行）

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

#### 在每台 Worker 電腦的 Linux 環境內執行

```bash
curl -sfL https://get.k3s.io | \
  K3S_URL=https://<MASTER_IP>:6443 \
  K3S_TOKEN=<上面的 token> \
  sh -
```

加入後在 Master 確認：

```bash
kubectl get nodes
# 預期看到所有加入的機器都顯示 Ready
```

---

### 常用 kubectl 指令

```bash
# 查看 cluster 狀態
kubectl get nodes                    # 所有 Node 與狀態
kubectl get pods                     # 所有 Pod
kubectl get pods -n <namespace>      # 指定 namespace 的 Pod
kubectl get services                 # 所有 Service

# 部署 / 更新
kubectl apply -f <file.yaml>         # 套用一個 yaml 設定
kubectl delete -f <file.yaml>        # 刪除一個 yaml 設定

# 除錯
kubectl logs <pod-name>              # 查看 Pod 的 log
kubectl logs -f <pod-name>           # 持續追蹤 log（類似 tail -f）
kubectl describe pod <pod-name>      # 查看 Pod 詳細狀態（排錯用）
kubectl exec -it <pod-name> -- bash  # 進入 Pod 的 shell
```

---

### 安裝 KEDA（Worker 自動擴縮需要）

KEDA（Kubernetes Event-Driven Autoscaling）讓 Worker Pod 可以根據 RabbitMQ Queue 長度自動增減。

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda --namespace keda --create-namespace
```

驗證安裝：

```bash
kubectl get pods -n keda
# 預期看到 keda-operator 與 keda-metrics-apiserver 都是 Running
```

---

---

### 部署前置作業：配置 GitHub 私有倉庫通行證

由於專案的 Docker Image 託管於 GitHub Container Registry (GHCR) 的私有倉庫，K3s 部署前必須先建立下載憑證（ImagePullSecret），否則會噴 ImagePullBackOff 錯誤。

1. 請先至 GitHub 申請一個具備 read:packages 權限的 Personal Access Token (Classic)。

2. 在 K3s 環境內執行以下指令建立憑證（名稱必須與 Chart 內的 imagePullSecrets 一致）：

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=https://ghcr.io \
  --docker-username="你的 GitHub 帳號" \
  --docker-password="你的 GitHub ghp_開頭Token" \
  --docker-email="你的電子信箱"
```

---

### 部署 Worker（Helm Chart）

1. 部署前，請先打開 ./charts/common-worker/values.yaml，確認或修改你的環境變數配置（如 rabbitmq.url 與 database.url）。若本地暫時無相關服務，可先填寫正確格式的虛擬網址以通過 Node.js 的開機環境變數檢查。(目前為虛擬網址)

2. 執行部署指令：

```bash
helm upgrade --install oct-worker ./charts/common-worker \
  --set image.tag=<git-sha>
```

> `<git-sha>` 為 CI 產生的 10 碼 commit SHA（例如 `012ef02923`），可從 ghcr.io 的 package 頁面或 CI log 取得。

查看部署狀態：

```bash
kubectl get pods          # 查看 Worker Pod 是否 Running
kubectl get scaledobject  # 查看 KEDA 自動擴縮設定
```

---

### CI/CD 流程總覽

```
開發者 push 到 develop（或任意分支）
        ↓
CI（.github/workflows/ci.yml）自動觸發
  frontend:            lint → test → build
  backend:             lint → test（含 DB integration）
  build-images:        build & push backend / frontend / worker → ghcr.io (SHA tag)
  build-sandbox-images: build & push oct-sandbox-cpp / oct-sandbox-python → ghcr.io (SHA tag)
        ↓
開發者開 PR，目標分支為 release/x.y.z
        ↓
Branch Protection 檢查：CI 所有 job 必須通過才允許 merge
        ↓
PR merge → 觸發 CD（.github/workflows/cd.yml）
  build & push image 到 ghcr.io（tag: x.y.z）
        ↓
（手動）helm upgrade → k8s Rolling Update → 零停機換版
```

> **Branch Protection 說明**：`release/**` 分支已啟用保護，禁止直接 push，所有變更必須透過 PR，且 CI 全部通過後才可 merge。這確保進入 CD 的程式碼一定經過測試。

Image 存放位置：`ghcr.io/kxiangw/oct-{frontend,backend,worker}:{tag}`
