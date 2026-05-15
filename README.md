# Online Code Test — M2 非同步判題

NTHU 1142 雲原生 HW2 / Team 12。本版本已從 M1 mock judge 升級為 M2 非同步判題架構：frontend、backend、PostgreSQL、RabbitMQ、judge worker，以及 Docker/gVisor 沙箱執行流程。

各 component 詳細說明與測試指南：

- [Testing_README.md](./Testing_README.md) — 完整測試指南（環境建置、各 component 自動/手動測試）
- [backend/README.md](./backend/README.md) — Backend API 設計、endpoints 規格、測試覆蓋
- [frontend/README.md](./frontend/README.md) — Frontend 架構與開發環境設定
- [worker/README.md](./worker/README.md) — Judge worker 架構、RabbitMQ 協定、gVisor sandbox 設計
- [infra/postgres/README.md](./infra/postgres/README.md) — Database schema、init scripts、RBAC 設計

## 一鍵部署

需求：

- Docker Engine >= 24
- Docker Compose v2
- 正式沙箱隔離需在 host 安裝並設定 gVisor `runsc` runtime

```bash
cp .env.example .env
make sandbox-images
make up
make ps
```

啟動後服務入口：

| 服務 | 入口 |
|------|------|
| 前端 | <http://localhost:5173> |
| 後端健康檢查 | <http://localhost:3000/api/health> |
| RabbitMQ Management UI | <http://localhost:15672> (`oct` / `oct_dev_password`) |
| PostgreSQL | `localhost:5432` |

如果本機尚未安裝 gVisor，可在 `.env` 暫時改用普通 Docker runtime：

```bash
SANDBOX_RUNTIME=runc
```

`runc` 只適合本機開發驗證，不提供 gVisor 的隔離效果。

## 常用 Makefile 指令

```bash
make bootstrap       # 產生 .env
make sandbox-images  # 建立 oj-sandbox-cpp / oj-sandbox-python
make up              # docker compose up -d --build
make ps              # 查看服務健康狀態
make logs            # 追蹤所有服務 log
make down            # 停止服務
make clean           # 停止服務並刪除 volumes
make rebuild         # clean + up
make psql            # 進入 psql shell
```

## 服務一覽

| Service | 說明 | Host port |
|---------|------|-----------|
| `postgres` | PostgreSQL 16 | 5432 |
| `rabbitmq` | RabbitMQ + Management UI | 5672 / 15672 |
| `backend` | Fastify API、WebSocket、RabbitMQ result consumer | 3000 |
| `worker` | Judge worker，透過 Docker/gVisor 執行判題 | internal |
| `frontend` | Vite build，由 nginx 提供靜態檔 | 5173 |

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
| `HOST_WORK_DIR` | `/tmp/judge` | Worker 與 host Docker 共用的工作目錄 |
| `SANDBOX_RUNTIME` | `runsc` | 沙箱 runtime；本機無 gVisor 時可暫改 `runc` |
| `HOST_*_PORT` | 見 `.env.example` | Host port mapping |

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

### 部署 Worker（Helm Chart）

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
開發者 push 到 develop
        ↓
CI（.github/workflows/ci.yml）
  lint → test → build → push image 到 ghcr.io（tag: commit SHA）
        ↓
開發者 push 到 release/x.y.z
        ↓
CD（.github/workflows/cd.yml）
  build → push image 到 ghcr.io（tag: x.y.z）
        ↓
（手動）helm upgrade → k8s Rolling Update → 零停機換版
```

Image 存放位置：`ghcr.io/kxiangw/oct-{frontend,backend,worker}:{tag}`
