# 負載測試示範

`loadtest/` 包含本地 100 個並發提交示範與 Docker Compose 自動擴縮容監視器。這些檔案用於示範流量，而非 Worker 單元測試的固定資料。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `seed.ts` | 以面試官身份登入，建立應試者帳號與進行中的 Session，並寫入 `.session-tokens.json`。 |
| `k6-submit.js` | 執行 k6 爆量測試，每個虛擬使用者提交一次。 |
| `scale-watcher.sh` | 輪詢 Prometheus 並調整 Docker Compose Worker 副本數量。 |
| `fixtures/ac.py` | Echo 風格的 Accepted 解答。 |
| `fixtures/wa.py` | Wrong Answer 解答。 |
| `fixtures/tle.py` | 無限迴圈解答（TLE）。 |

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

| 變數 | 預設值 |
| --- | --- |
| `BASE_URL` | `http://localhost:3000/api` |
| `N` | `100` |
| `SEED_PROBLEM_ID` | `1` |
| `SEED_DURATION_MINUTES` | `120` |
| `INTERVIEWER_USERNAME` | `alice` |
| `INTERVIEWER_PASSWORD` | `Test@1234` |

`k6-submit.js`：

| 變數 | 預設值 |
| --- | --- |
| `BASE_URL` | `http://localhost:3000/api` |
| `VUS` | `100` |
| `SUBMISSION_TYPE` | `formal` |
| `FIXTURE` | `ac.py` |

`scale-watcher.sh`：

| 變數 | 預設值 |
| --- | --- |
| `MAX` | `5` |
| `MIN` | `1` |
| `UP_QUEUE` | `5` |
| `UP_CPU` | `80` |
| `DOWN_CPU` | `20` |
| `DOWN_QUIET_TICKS` | `4` |
| `COOLDOWN_SECS` | `30` |
| `INTERVAL` | `5` |
| `PROM` | `http://localhost:9090` |

## 預期可觀測性行為

爆量測試期間，Grafana 與 Prometheus 應顯示佇列深度上升、Worker 擴展、評測進行中數量大致跟隨 Worker 數量，以及評測流量流經後端與 Worker 指標。

## 清理

```bash
make demo-down
```

此指令停止 Compose 服務、刪除 Volume、移除 `.session-tokens.json`，並停止任何背景監視器程序。
