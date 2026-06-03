# 負載測試

壓測目標預設為**本地 Docker**（`http://localhost:3000/api`）。  
打 Production 需手動傳 `BASE_URL` / `APP_URL`，會建立真實資料，請確認時間窗口。

## 前置

```bash
brew install k6   # 其他平台：https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## 腳本對照

| 腳本 | 測什麼 | 目標 |
| --- | --- | --- |
| `k6-homepage.js` | 首頁 RPS | Production |
| `k6-roles.js` / `run-role-api-tests.sh` | 各角色 API 讀取 | Production |
| `run-bottleneck-tests.sh` | 三個寫入瓶頸（一鍵） | **Local** |
| `k6-start.js` | 同時進入考場（DB 狀態機） | Local |
| `k6-submit.js` | 同時 Run / Submit（MQ + Worker） | Local |

---

## 首頁 RPS（`k6-homepage.js`）

```bash
# smoke
MAX_RPS=1 RAMP_DURATION=1s HOLD_DURATION=1s k6 run loadtest/k6-homepage.js

# 找極限（從 10 爬升到 200 RPS）
k6 run loadtest/k6-homepage.js

# 固定 RPS hold
START_RPS=300 MAX_RPS=300 RAMP_DURATION=30s HOLD_DURATION=5m \
  k6 run loadtest/k6-homepage.js
```

---

## 角色 API 讀取（`k6-roles.js`）

```bash
# smoke（30 秒，各角色 1 RPS）
DURATION=30s ANON_RPS=1 CANDIDATE_RPS=1 INTERVIEWER_RPS=1 \
  PROBLEM_SETTER_RPS=1 ADMIN_RPS=1 \
  k6 run loadtest/k6-roles.js

# 全部角色預設流量（5 分鐘）
k6 run loadtest/k6-roles.js

# 只測特定角色
ROLE_SCENARIOS=candidate CANDIDATE_RPS=20 DURATION=5m k6 run loadtest/k6-roles.js
```

### 產生 Markdown 報告

```bash
# 全部角色
./loadtest/run-role-api-tests.sh

# 指定角色與 RPS
ROLES="candidate interviewer" CANDIDATE_RPS=20 INTERVIEWER_RPS=10 \
  ./loadtest/run-role-api-tests.sh

# 確認展開邏輯但不執行
DRY_RUN=true ./loadtest/run-role-api-tests.sh
```

報告輸出：`loadtest/reports/<timestamp>/role-api-report.md`

---

## 瓶頸寫入（`run-bottleneck-tests.sh`）

三個場景依序執行：`start` → `submit_simple` → `submit_formal`，自動 seed，輸出單一報告。

```bash
# 一鍵跑全部（Local，VUS=100）
./loadtest/run-bottleneck-tests.sh

# 調整並發數
VUS=200 ./loadtest/run-bottleneck-tests.sh

# 只跑指定場景
SCENARIOS="submit_simple submit_formal" ./loadtest/run-bottleneck-tests.sh

# TLE 工作負載
FIXTURE=tle.py VUS=50 ./loadtest/run-bottleneck-tests.sh

# 確認展開邏輯但不執行
DRY_RUN=true ./loadtest/run-bottleneck-tests.sh
```

報告輸出：`loadtest/reports/<timestamp>/bottleneck-report.md`

> **注意**：`start` 場景的 session 是一次性的（狀態機不可逆），每次都會自動重新 seed。

### 單獨執行各場景

**進入考場（start）**

```bash
# 1. seed（每次必跑，N 需 >= VUS）
cd loadtest && N=100 npx tsx seed-start.ts

# 2. k6
VUS=100 k6 run loadtest/k6-start.js
```

**Run 公開測資（submit_simple）**

```bash
# 1. seed（可重複使用同一批 session）
cd loadtest && npx tsx seed.ts

# 2. k6
SUBMISSION_TYPE=simple VUS=100 k6 run loadtest/k6-submit.js
```

**正式提交（submit_formal）**

```bash
# 1. seed（與 submit_simple 共用，已 seed 可跳過）
cd loadtest && npx tsx seed.ts

# 2. k6
VUS=100 k6 run loadtest/k6-submit.js
```

---

## 本地監控

`docker compose up -d` 已包含 Prometheus + Grafana + cAdvisor。

| 服務 | URL | 帳密 |
| --- | --- | --- |
| Grafana | http://localhost:3001 | admin / oct_dev_grafana |
| Prometheus | http://localhost:9090 | — |
| RabbitMQ | http://localhost:15672 | oct / oct_dev_password |
| cAdvisor | http://localhost:8081 | — |

Dashboard：http://localhost:3001/d/oct-demo/oct-demo-e28094-100-concurrent

壓測時把右上角改成 **Last 5 minutes / auto refresh 5s**，觀察：

- **Queue depth** — submit 後是否清空
- **Verdict rate** — Worker 吞吐量
- **Submit API p95** — MQ enqueue 延遲
- **Worker pool CPU %** — Worker 是否飽和

---

## 環境變數

### `run-bottleneck-tests.sh`

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000/api` | API 位址 |
| `VUS` | `100` | 並發數（需 <= seed N） |
| `SCENARIOS` | `start submit_simple submit_formal` | 執行的場景 |
| `FIXTURE` | `ac.py` | 提交程式碼：`ac.py` / `wa.py` / `tle.py` |
| `DRY_RUN` | `false` | `true` 只印指令不執行 |

### `k6-homepage.js`

| 變數 | 預設值 |
| --- | --- |
| `TARGET_URL` | `https://ikmlab.cs.nthu.edu.tw/online_code_test/` |
| `START_RPS` | `10` |
| `MAX_RPS` | `200` |
| `RAMP_DURATION` | `5m` |
| `HOLD_DURATION` | `3m` |

### `k6-roles.js`

| 變數 | 預設值 |
| --- | --- |
| `APP_URL` | `https://ikmlab.cs.nthu.edu.tw/online_code_test/` |
| `DURATION` | `5m` |
| `ANON_RPS` | `20` |
| `CANDIDATE_RPS` | `5` |
| `INTERVIEWER_RPS` | `2` |
| `PROBLEM_SETTER_RPS` | `2` |
| `ADMIN_RPS` | `1` |
| `CANDIDATE_WRITE_DRAFTS` | `false` |
| `INCLUDE_PASSWORD_LOOKUPS` | `false` |
