# loadtest — Demo 100 concurrent

> Phase A+B+C 的 demo 流量產生器與「KEDA 模擬器」。
> 與 `worker/src/__tests__/fixtures/` **不同用途**：那邊是 vitest unit
> test 的攻擊樣本（fork-bomb / read-passwd / etc.），這裡是 demo 用的
> HTTP load generator。

## 一句話 demo

```bash
make demo-100      # 起 stack -> seed 100 candidate -> 背景 watcher -> k6 burst
make demo-urls     # 看 Grafana / Prometheus / RabbitMQ / cAdvisor URL
make demo-down     # 收尾：清 volume + kill watcher + 刪 session token
```

預期看到的（5 分鐘窗口）：

| Grafana panel | 預期 |
|---|---|
| Queue depth (judge.tasks) | 0 → 飆到 ~50-100 → 隨 worker scale 回落 |
| Worker replicas | 1 → 2 → 3 → … → 5（單機 cap） |
| Judge in-flight | 持平在 worker 數附近（prefetch=1）|
| Verdict rate | AC 為主，可能有少數 RE/TLE |
| Sandbox memory p95 by language | python3 ~ 16–32 MB |
| Judge p50/p95/p99 by language | python3 p95 < 5s |
| Worker pool CPU% | 各 worker 接近 100%（cgroups cap 1 core）|

## 元件對照

| 檔案 | 角色 |
|---|---|
| `seed.ts` | 一次性 setup：用 alice (interviewer) 帳號 batch 建 N candidates、為每人 create 一場 in_progress session、寫 `loadtest/.session-tokens.json` |
| `k6-submit.js` | k6 burst：每個 VU 從 SharedArray 讀一筆 token，POST 一次 submission；100 VU × 1 iteration = 100 並發 |
| `scale-watcher.sh` | docker-compose 版 KEDA 模擬器：每 5 s poll Prometheus（in-flight / queue depth / worker CPU），規則命中就 `docker compose up -d --scale worker=N` |
| `fixtures/ac.py` | `print(sys.stdin.read(), end="")`，對應 seed problem PROBLEM_ID=1 echo testcases |
| `fixtures/wa.py` | 印固定錯字串，用來測 WA verdict |
| `fixtures/tle.py` | `while True: pass`，用來測 TLE verdict |

## 環境變數

`seed.ts`：

| Env | Default | 說明 |
|---|---|---|
| `BASE_URL` | `http://localhost:3000/api` | backend API 入口 |
| `N` | 100 | 要建的 candidate 數 |
| `SEED_PROBLEM_ID` | 1 | 全部 session 都派這題 |
| `SEED_DURATION_MINUTES` | 120 | session 時長 |
| `INTERVIEWER_USERNAME` | `alice` | 派題者 |
| `INTERVIEWER_PASSWORD` | `Test@1234` | （見 `infra/postgres/10-scenarios.sql`）|

`k6-submit.js`：

| Env | Default | 說明 |
|---|---|---|
| `BASE_URL` | `http://localhost:3000/api` | 跑在 `oct_default` network 內時設 `http://backend:3000/api` |
| `VUS` | 100 | 並發 user 數 = 並發 submission 數 |
| `SUBMISSION_TYPE` | `formal` | `simple` / `formal` |

`scale-watcher.sh`：

| Env | Default | 說明 |
|---|---|---|
| `MAX` | 5 | replicas 上限（單機保護）|
| `MIN` | 1 | replicas 下限 |
| `UP_QUEUE` | 5 | queue depth > 此值 → 擴 |
| `UP_CPU` | 80 | worker 平均 CPU% > 此值 → 擴 |
| `DOWN_CPU` | 20 | queue=0 且 CPU < 此值 連續 `DOWN_QUIET_TICKS` 次才縮 |
| `DOWN_QUIET_TICKS` | 4 | 4 × 5s = 20s 持續安靜才縮 |
| `COOLDOWN_SECS` | 30 | 改 replica 後 30 s 內不再動 |
| `INTERVAL` | 5 | poll 間隔（s）|
| `PROM` | `http://localhost:9090` | Prometheus URL |

## 跟 KEDA 的對應

Phase D 會把 watcher 換成真 KEDA `ScaledObject`，trigger 規則相同：

```yaml
triggers:
  - type: prometheus
    metadata:
      metricName: judge_cpu_avg
      query: avg(rate(container_cpu_usage_seconds_total{pod=~"oct-worker.*"}[30s]))*100
      threshold: "80"
  - type: prometheus
    metadata:
      metricName: judge_queue_depth
      query: sum(rabbitmq_queue_messages{queue="judge.tasks"})
      threshold: "5"
```

`cooldownPeriod: 30` / `pollingInterval: 5` / `minReplicaCount: 1` / `maxReplicaCount: 5`。

## 手動跑

不想用 `make demo-100` 的時候：

```bash
# 1. 起 stack（含 prometheus / grafana / cadvisor）
make demo-up

# 2. 等 backend healthy（會 ~10 s）
docker compose ps backend

# 3. seed 100 候選人 + session
make demo-seed
# 或自訂：cd loadtest && N=30 npx tsx seed.ts

# 4. 開新分頁跑 watcher
make demo-watch
# 或自訂：MAX=3 UP_CPU=70 ./loadtest/scale-watcher.sh

# 5. 開另一個分頁灌流量
make demo-load
# 或自訂：cd loadtest && VUS=50 docker run --rm --network oct_default \
#   -v $(pwd):/scripts -e VUS=50 grafana/k6 run /scripts/k6-submit.js

# 6. 看 Grafana dashboard
xdg-open http://localhost:3001/d/oct-demo
```
