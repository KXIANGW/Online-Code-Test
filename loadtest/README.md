# 負載測試示範

`loadtest/` 包含部署站首頁 RPS 測試、本地 100 個並發提交示範與 Docker Compose 自動擴縮容監視器。這些檔案用於示範流量，而非 Worker 單元測試的固定資料。

壓測可能影響真實服務。請先確認測試時間、通知使用者，並從小流量開始逐步加壓。

## 檔案

| 檔案               | 用途                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- |
| `k6-homepage.js`   | 對部署站首頁做 ramping RPS 測試，用來找可穩定承受的 request per second。            |
| `seed.ts`          | 以面試官身份登入，建立應試者帳號與進行中的 Session，並寫入 `.session-tokens.json`。 |
| `k6-submit.js`     | 執行 k6 爆量測試，每個虛擬使用者提交一次。                                          |
| `scale-watcher.sh` | 輪詢 Prometheus 並調整 Docker Compose Worker 副本數量。                             |
| `fixtures/ac.py`   | Echo 風格的 Accepted 解答。                                                         |
| `fixtures/wa.py`   | Wrong Answer 解答。                                                                 |
| `fixtures/tle.py`  | 無限迴圈解答（TLE）。                                                               |

## 部署站首頁 RPS 測試

### 安裝 k6

macOS：

```bash
brew install k6
```

其他平台請參考 <https://grafana.com/docs/k6/latest/set-up/install-k6/>。

### 快速執行

預設會打部署站首頁，從 `10 RPS` 緩慢加到 `200 RPS`，持續觀察 p95/p99 latency 與錯誤率。

```bash
k6 run loadtest/k6-homepage.js
```

指定較低上限先試水溫：

```bash
MAX_RPS=50 k6 run loadtest/k6-homepage.js
```

最小煙霧測試，只確認部署站可連線與腳本可執行：

```bash
START_RPS=1 \
MAX_RPS=1 \
RAMP_DURATION=1s \
HOLD_DURATION=1s \
PRE_ALLOCATED_VUS=1 \
MAX_VUS=5 \
k6 run loadtest/k6-homepage.js
```

指定完整參數：

```bash
TARGET_URL=https://ikmlab.cs.nthu.edu.tw/online_code_test/ \
START_RPS=20 \
MAX_RPS=300 \
RAMP_DURATION=10m \
HOLD_DURATION=5m \
PRE_ALLOCATED_VUS=150 \
MAX_VUS=1500 \
k6 run loadtest/k6-homepage.js
```

### 如何判斷 RPS 極限

以「可穩定承受」為準，不是瞬間最高值。建議把極限定義為：

- `http_req_failed < 1%`
- `http_req_duration p95 < 1000ms`
- `http_req_duration p99 < 2000ms`
- 沒有持續出現 `429 / 500 / 502 / 503 / 504`
- 伺服器 CPU、Memory、Ingress latency 沒有持續飽和
- 在該 RPS 至少 hold `3 到 10 分鐘`

k6 結果中最重要的欄位：

| 指標                      | 意義                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `http_reqs`               | 總請求數與平均 request rate，可用來看實際 RPS。                               |
| `http_req_failed`         | HTTP 層錯誤率，超過 1% 通常代表已不穩。                                       |
| `http_req_duration`       | latency；重點看 p95 / p99，不只看平均。                                       |
| `dropped_iterations`      | k6 client 送不出目標 RPS；若增加 `MAX_VUS` 後仍出現，可能是壓測端先成為瓶頸。 |
| `homepage_check_failures` | status/body check 失敗次數。                                                  |

如果需要看失敗請求的 status：

```bash
DEBUG_FAILURES=true MAX_RPS=50 k6 run loadtest/k6-homepage.js
```

### 監視方式

如果部署在 Kubernetes，壓測同時開另一個 terminal 觀察：

```bash
kubectl top pods -n <namespace>
kubectl top nodes
kubectl get hpa -n <namespace> -w
kubectl get pods -n <namespace> -w
```

如果有 Prometheus / Grafana，建議同時看：

| 層級             | 觀察項目                                                      |
| ---------------- | ------------------------------------------------------------- |
| Ingress / Nginx  | RPS、4xx/5xx rate、upstream latency、active connections。     |
| Frontend Pod     | CPU、Memory、replica 數、restart count。                      |
| Backend Pod      | CPU、Memory、request duration、5xx rate。                     |
| PostgreSQL       | active connections、CPU、slow queries、lock。                 |
| Redis / RabbitMQ | queue depth、publish/consume rate、memory。                   |
| Worker           | queue depth、judge duration、system error rate、CPU、Memory。 |

首頁測試主要壓到 Ingress 與 frontend 靜態資源路徑。若要測登入、API 查詢或程式碼提交，請另外建立獨立腳本，避免把不同瓶頸混在同一個 RPS 數字裡。

## 一鍵示範

```bash
make demo-100
make demo-urls
make demo-down
```

`make demo-100` 啟動堆疊、產生應試者/Session 種子資料、在背景啟動監視器，並執行 k6 爆量測試。

## 手動流程

```bash
make demo-up
make demo-seed
make demo-watch
make demo-load
make demo-urls
```

常用覆蓋變數：

```bash
DEMO_N=30 DEMO_VUS=30 make demo-100
DEMO_FIXTURE=wa.py make demo-load
WORKER_REPLICAS=2 make demo-up
```

## 環境變數

`seed.ts`：

| 變數                    | 預設值                      |
| ----------------------- | --------------------------- |
| `BASE_URL`              | `http://localhost:3000/api` |
| `N`                     | `100`                       |
| `SEED_PROBLEM_ID`       | `1`                         |
| `SEED_DURATION_MINUTES` | `120`                       |
| `INTERVIEWER_USERNAME`  | `alice`                     |
| `INTERVIEWER_PASSWORD`  | `Test@1234`                 |

`k6-submit.js`：

| 變數              | 預設值                      |
| ----------------- | --------------------------- |
| `BASE_URL`        | `http://localhost:3000/api` |
| `VUS`             | `100`                       |
| `SUBMISSION_TYPE` | `formal`                    |
| `FIXTURE`         | `ac.py`                     |

`k6-homepage.js`：

| 變數                | 預設值                                            |
| ------------------- | ------------------------------------------------- |
| `TARGET_URL`        | `https://ikmlab.cs.nthu.edu.tw/online_code_test/` |
| `START_RPS`         | `10`                                              |
| `MAX_RPS`           | `200`                                             |
| `RAMP_DURATION`     | `5m`                                              |
| `HOLD_DURATION`     | `3m`                                              |
| `PRE_ALLOCATED_VUS` | `100`                                             |
| `MAX_VUS`           | `1000`                                            |
| `DEBUG_FAILURES`    | `false`                                           |

`scale-watcher.sh`：

| 變數               | 預設值                  |
| ------------------ | ----------------------- |
| `MAX`              | `5`                     |
| `MIN`              | `1`                     |
| `UP_QUEUE`         | `5`                     |
| `UP_CPU`           | `80`                    |
| `DOWN_CPU`         | `20`                    |
| `DOWN_QUIET_TICKS` | `4`                     |
| `COOLDOWN_SECS`    | `30`                    |
| `INTERVAL`         | `5`                     |
| `PROM`             | `http://localhost:9090` |

## 預期可觀測性行為

爆量測試期間，Grafana 與 Prometheus 應顯示佇列深度上升、Worker 擴展、評測進行中數量大致跟隨 Worker 數量，以及評測流量流經後端與 Worker 指標。

## 清理

```bash
make demo-down
```

此指令停止 Compose 服務、刪除 Volume、移除 `.session-tokens.json`，並停止任何背景監視器程序。
