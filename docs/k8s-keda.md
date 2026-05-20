# K8s + KEDA 部署（Phase D）

> Phase A/B/C 的 docker-compose demo 一旦穩定，把同一套 metrics +
> dashboard + scaling rules 搬到 K8s 上用真 KEDA 自動擴縮。本文是
> Phase 2 操作手冊；chart 已寫在 `charts/common-worker/`。

## 前置：cluster + 兩個必裝 operator

```bash
# 1. 起 k3s（也可用 Kind / minikube；任何 v1.28+ 都行）
curl -sfL https://get.k3s.io | sh -

# 2. KEDA — 提供 ScaledObject CRD + Prometheus trigger
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda \
  -n keda --create-namespace

# 3. kube-prometheus-stack — 含 Prometheus + Grafana + cAdvisor scrape
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install kps prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace
```

驗證：

```bash
kubectl get pods -n keda                   # keda-operator + keda-metrics-apiserver Running
kubectl get pods -n monitoring             # prom + grafana + node-exporter + ...
kubectl get scaledobjects.keda.sh -A       # CRD 已註冊
```

## 部署 worker chart

```bash
# 假設 image 已 push 到 ghcr.io（見 Phase E1）
SHA=$(git rev-parse --short=10 HEAD)

helm upgrade --install oct-worker ./charts/common-worker \
  --set image.tag=$SHA \
  --set keda.prometheusAddress=http://kps-kube-prometheus-stack-prometheus.monitoring.svc:9090 \
  --set env.RABBITMQ_URL=amqp://oct:<password>@oct-rabbitmq.default.svc:5672 \
  --set env.DATABASE_URL=postgres://oct:<password>@oct-postgres.default.svc:5432/oct
```

## ScaledObject = scale-watcher.sh

Phase C 的 `loadtest/scale-watcher.sh` 跟 chart 內的 ScaledObject **規則一致**，只是執行載體不同：

| 條件 | docker-compose 版（watcher） | K8s 版（KEDA） |
|---|---|---|
| 觸發來源 | bash `curl` 拉 Prometheus | KEDA operator 拉 Prometheus |
| 動作 | `docker compose up --scale worker=N` | 改 Deployment.replicas |
| 規則：擴 | `queue > 5` OR `cpu > 80%` | 同上（兩條 prometheus trigger）|
| 規則：縮 | `queue = 0 AND cpu < 20%` 連續 20 s | KEDA `cooldownPeriod: 30` |
| Min / Max | env `MIN / MAX` | `keda.minReplicaCount / maxReplicaCount` |
| Polling | `INTERVAL: 5` | `keda.pollingInterval: 5` |

PromQL 查詢相同（依 cAdvisor / RabbitMQ exporter 的 label 命名為準）。

## 驗證自動擴縮

```bash
# 1. 灌 100 並發（從外部 LoadBalancer / port-forward 對 backend）
kubectl port-forward svc/oct-backend 3000:3000 &
docker run --rm --network host \
  -v $(pwd)/loadtest:/scripts \
  grafana/k6 run -e BASE_URL=http://localhost:3000/api /scripts/k6-submit.js

# 2. 觀察 worker pods 數量
kubectl get pods -l app.kubernetes.io/name=common-worker -w

# 3. 看 ScaledObject 狀態
kubectl describe scaledobject oct-worker
# Events 應該會出現：
#   ScaledObjectActive       True
#   ScaleTarget              oct-worker (Deployment)
#   Triggers fired           prometheus(judge_cpu_avg)
```

## 已知 limitation（Phase D 未完）

| 項目 | 為什麼 |
|---|---|
| Umbrella chart `charts/oct/`（backend / frontend / postgres / rabbitmq / redis） | 還沒寫；目前 backend / frontend / DB 假設用 bitnami subchart 或外部 manifest 部署，worker chart 只負責 worker 本身 |
| Ingress + TLS | 沒寫；先 port-forward 即可驗 demo |
| RuntimeClass=gvisor | values.yaml 預留 `runtimeClassName` 欄位但預設空字串；正式環境要先在 cluster 裝 gVisor + RuntimeClass 後再 `--set runtimeClassName=gvisor` |
| Docker socket mount | 假設 cluster 用 Docker shim（k3s 預設用 containerd，需要改用 dind sidecar 或換成 CRI-O socket）。單機 k3s + `--docker` flag 可保留現狀 |
