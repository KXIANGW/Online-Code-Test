# 部署環境負載測試

`loadtest/` 目前用於測試部署站：

```txt
https://ikmlab.cs.nthu.edu.tw/online_code_test/
```

壓測可能影響真實服務。請先確認測試時間、通知使用者，並從小流量開始逐步加壓。

## 檔案

| 檔案                    | 用途                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `k6-homepage.js`        | 測部署站首頁 RPS，適合找 Ingress / frontend 靜態路徑的基準吞吐量。                 |
| `k6-roles.js`           | 依角色拆分 anonymous / candidate / interviewer / problem-setter / admin 壓測場景。 |
| `run-role-api-tests.sh` | 依序跑各角色 API 壓測，輸出 k6 JSON 與 Markdown 報告。                             |

其他檔案如 `seed.ts`、`k6-submit.js`、`scale-watcher.sh` 屬於本地 demo / worker 提交流程，不是本部署壓測 README 的主要範圍。

## 安裝 k6

macOS：

```bash
brew install k6
```

其他平台請參考 <https://grafana.com/docs/k6/latest/set-up/install-k6/>。

## 首頁 RPS 測試

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

保守測試：

```bash
MAX_RPS=50 k6 run loadtest/k6-homepage.js
```

固定 RPS hold，適合確認某個 RPS 是否能穩定撐住：

```bash
TARGET_URL=https://ikmlab.cs.nthu.edu.tw/online_code_test/ \
START_RPS=300 \
MAX_RPS=300 \
RAMP_DURATION=30s \
HOLD_DURATION=5m \
PRE_ALLOCATED_VUS=150 \
MAX_VUS=1500 \
k6 run loadtest/k6-homepage.js
```

如果要看失敗請求的 status：

```bash
DEBUG_FAILURES=true MAX_RPS=50 k6 run loadtest/k6-homepage.js
```

## 依角色壓測

`k6-roles.js` 會把不同角色拆成獨立 k6 scenario，讓結果可以依 `role` tag 區分。

預設流程以讀取為主：

- 不新增題目
- 不新增使用者
- 不提交程式碼
- 不查詢考生密碼
- 不寫入草稿

預設角色與流量：

| 角色            | 預設 RPS | 主要測試內容                                         |
| --------------- | -------- | ---------------------------------------------------- |
| `anonymous`     | `20`     | 首頁與首頁引用的 JS/CSS/assets。                     |
| `candidate`     | `5`      | 場次列表、場次詳情、題目、草稿、提交紀錄、公開測資。 |
| `interviewer`   | `2`      | 使用者列表、考試場次、考卷模板、題目、違規紀錄。     |
| `problemSetter` | `2`      | 題目列表、題目詳情、語言列表。                       |
| `admin`         | `1`      | Root dashboard 常用讀取 API。                        |

先跑 30 秒 smoke，確認帳號與 API 都可用：

```bash
DURATION=30s \
ANON_RPS=1 \
CANDIDATE_RPS=1 \
INTERVIEWER_RPS=1 \
PROBLEM_SETTER_RPS=1 \
ADMIN_RPS=1 \
k6 run loadtest/k6-roles.js
```

跑全部角色：

```bash
k6 run loadtest/k6-roles.js
```

只跑特定角色：

```bash
ROLE_SCENARIOS=candidate CANDIDATE_RPS=20 DURATION=5m k6 run loadtest/k6-roles.js
```

```bash
ROLE_SCENARIOS=interviewer,problemSetter \
INTERVIEWER_RPS=10 \
PROBLEM_SETTER_RPS=10 \
DURATION=5m \
k6 run loadtest/k6-roles.js
```

指定部署 URL 與帳密：

```bash
APP_URL=https://ikmlab.cs.nthu.edu.tw/online_code_test/ \
CANDIDATE_USERNAME=candidate_20260509_001 \
CANDIDATE_PASSWORD='Cand@1234' \
INTERVIEWER_USERNAME=alice \
INTERVIEWER_PASSWORD='Test@1234' \
PROBLEM_SETTER_USERNAME=carol \
PROBLEM_SETTER_PASSWORD='Test@1234' \
ADMIN_USERNAME=root \
ADMIN_PASSWORD='Root@1234' \
k6 run loadtest/k6-roles.js
```

如果 API 不在 `APP_URL/api`，可直接覆蓋：

```bash
API_URL=https://ikmlab.cs.nthu.edu.tw/online_code_test/api k6 run loadtest/k6-roles.js
```

可選的寫入/敏感讀取開關預設關閉：

```bash
CANDIDATE_WRITE_DRAFTS=true ROLE_SCENARIOS=candidate k6 run loadtest/k6-roles.js
INCLUDE_PASSWORD_LOOKUPS=true ROLE_SCENARIOS=interviewer k6 run loadtest/k6-roles.js
```

## 逐一測試角色並產生報告

`run-role-api-tests.sh` 會依序執行每個角色，將每次 k6 output 存成 log、summary JSON，最後彙整成 Markdown。

最小 smoke：

```bash
DURATION=30s \
ANON_RPS=1 \
CANDIDATE_RPS=1 \
INTERVIEWER_RPS=1 \
PROBLEM_SETTER_RPS=1 \
ADMIN_RPS=1 \
./loadtest/run-role-api-tests.sh
```

只測指定角色：

```bash
ROLES="candidate interviewer" \
DURATION=5m \
CANDIDATE_RPS=20 \
INTERVIEWER_RPS=10 \
./loadtest/run-role-api-tests.sh
```

指定報告輸出位置：

```bash
REPORT_DIR=loadtest/reports/api-roles-$(date +%Y%m%d-%H%M%S) \
./loadtest/run-role-api-tests.sh
```

報告會寫在：

```txt
loadtest/reports/<timestamp>/role-api-report.md
```

只檢查腳本會如何展開角色與 RPS，不真的執行 k6：

```bash
DRY_RUN=true ./loadtest/run-role-api-tests.sh
```

## 如何判斷極限

以「可穩定承受」為準，不是瞬間最高值。建議把極限定義為：

- `http_req_failed < 1%`
- `http_req_duration p95 < 1000ms`
- `http_req_duration p99 < 2000ms`
- 沒有持續出現 `429 / 500 / 502 / 503 / 504`
- k6 沒有明顯 `dropped_iterations`
- 伺服器 CPU、Memory、Ingress latency 沒有持續飽和
- 在該 RPS 至少 hold `3 到 10 分鐘`

k6 結果中最重要的欄位：

| 指標                 | 意義                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `http_reqs`          | 總請求數與平均 request rate，可用來看實際 RPS。                               |
| `http_req_failed`    | HTTP 層錯誤率，超過 1% 通常代表已不穩。                                       |
| `http_req_duration`  | latency；重點看 p95 / p99，不只看平均。                                       |
| `dropped_iterations` | k6 client 送不出目標 RPS；若增加 `MAX_VUS` 後仍出現，可能是壓測端先成為瓶頸。 |
| `checks_failed`      | 腳本定義的業務檢查失敗數，例如 status 不是 2xx/3xx。                          |

## 沒有 Grafana 時怎麼監視

壓測同時開另一個 terminal 觀察 Kubernetes：

```bash
kubectl top pods -n <namespace>
kubectl top nodes
kubectl get hpa -n <namespace> -w
kubectl get pods -n <namespace> -w
```

如果不知道 namespace：

```bash
kubectl get ns
kubectl get pods -A | grep online
```

同步看 logs：

```bash
kubectl logs -n <namespace> deploy/<frontend-deploy-name> -f
kubectl logs -n <namespace> deploy/<backend-deploy-name> -f
```

如果有 ingress-nginx：

```bash
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller -f
```

## 有 Prometheus / Grafana 時建議看

| 層級             | 觀察項目                                                      |
| ---------------- | ------------------------------------------------------------- |
| Ingress / Nginx  | RPS、4xx/5xx rate、upstream latency、active connections。     |
| Frontend Pod     | CPU、Memory、replica 數、restart count。                      |
| Backend Pod      | CPU、Memory、request duration、5xx rate。                     |
| PostgreSQL       | active connections、CPU、slow queries、lock。                 |
| Redis / RabbitMQ | queue depth、publish/consume rate、memory。                   |
| Worker           | queue depth、judge duration、system error rate、CPU、Memory。 |

## 環境變數

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

`k6-roles.js`：

| 變數                       | 預設值                                                |
| -------------------------- | ----------------------------------------------------- |
| `APP_URL`                  | `https://ikmlab.cs.nthu.edu.tw/online_code_test/`     |
| `API_URL`                  | `${APP_URL}/api`                                      |
| `ROLE_SCENARIOS`           | `anonymous,candidate,interviewer,problemSetter,admin` |
| `DURATION`                 | `5m`                                                  |
| `ANON_RPS`                 | `20`                                                  |
| `CANDIDATE_RPS`            | `5`                                                   |
| `INTERVIEWER_RPS`          | `2`                                                   |
| `PROBLEM_SETTER_RPS`       | `2`                                                   |
| `ADMIN_RPS`                | `1`                                                   |
| `PRE_ALLOCATED_VUS`        | `50`                                                  |
| `MAX_VUS`                  | `500`                                                 |
| `FETCH_ASSETS`             | `true`                                                |
| `DEBUG_FAILURES`           | `false`                                               |
| `CANDIDATE_WRITE_DRAFTS`   | `false`                                               |
| `INCLUDE_PASSWORD_LOOKUPS` | `false`                                               |
| `CANDIDATE_USERNAME`       | `candidate_20260509_001`                              |
| `CANDIDATE_PASSWORD`       | `Cand@1234`                                           |
| `INTERVIEWER_USERNAME`     | `alice`                                               |
| `INTERVIEWER_PASSWORD`     | `Test@1234`                                           |
| `PROBLEM_SETTER_USERNAME`  | `carol`                                               |
| `PROBLEM_SETTER_PASSWORD`  | `Test@1234`                                           |
| `ADMIN_USERNAME`           | `root`                                                |
| `ADMIN_PASSWORD`           | `Root@1234`                                           |

---

## 本地 Docker 監控環境

Prometheus、Grafana、cAdvisor 已內建在 `docker-compose.yml`，不需要額外安裝。

### 服務 URL

| 服務 | URL | 帳密 |
| --- | --- | --- |
| Grafana | http://localhost:3001 | admin / oct_dev_grafana |
| Prometheus | http://localhost:9090 | — |
| RabbitMQ Management | http://localhost:15672 | oct / oct_dev_password |
| cAdvisor | http://localhost:8081 | — |
| Backend API | http://localhost:3000/api | — |

### 啟動完整 stack（含監控）

```bash
docker compose up -d
```

等所有服務 healthy（約 30–60 秒）：

```bash
docker compose ps
```

### 預建 Grafana Dashboard

開啟 http://localhost:3001 登入後，側欄 → Dashboards → **OCT Demo — 100 concurrent**

已有的 panel：

| Panel | 壓測時觀察什麼 |
| --- | --- |
| Queue depth (judge.tasks) | Submit / Run 後是否快速清空，或持續堆積 |
| Judge in-flight | 同時執行中的 judge 數量，反映 Worker 飽和度 |
| Submit API p95 (s) | HTTP enqueue 延遲，MQ 連線瓶頸會先反映在這裡 |
| Verdict rate (per second) | Worker 實際吞吐量（AC/WA/TLE 各佔比） |
| Worker replicas | 觀察 scale-watcher 是否觸發擴縮 |
| Worker pool CPU % | Worker container CPU 使用率 |
| Worker pool memory (MB) | Worker 記憶體使用量 |
| Judge p50/p95/p99 by language | 各語言 end-to-end judge 延遲分佈 |
| Submission created vs completed | 送入速率 vs 完成速率，gap 代表 queue 積壓 |

### 壓測同時開監控的 workflow

**Terminal 1** — 監視 stack 狀態：

```bash
docker compose ps -a
docker compose logs -f backend worker
```

**Terminal 2** — 啟動 scale-watcher（可選，自動擴縮 Worker）：

```bash
./loadtest/scale-watcher.sh
```

**Terminal 3** — 執行 k6 壓測：

```bash
# 範例：100 VU 同時正式提交
VUS=100 k6 run loadtest/k6-submit.js
```

**Browser** — 開 Grafana http://localhost:3001，切到 **OCT Demo** dashboard，右上角改成 **Last 5 minutes / auto refresh 5s**。

### 各瓶頸場景的觀察重點

#### 場景一（同時進入考場）— `k6-start.js`

此路徑不走 MQ，Grafana 上的 Worker panel 不會有明顯變化。  
改用 Prometheus 直接查 HTTP 延遲：

```
# 進入考場端點 p95 latency（秒）
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{route=~".*start.*"}[30s])) by (le))
```

若 p95 持續上升 → DB connection pool 飽和；查 backend log 找 `Connection pool exhausted` 或 `deadlock`。

#### 場景二（同時 Run）/ 場景三（同時正式提交）— `k6-submit.js`

重點 panel 組合：

```
Queue depth spike → Worker in-flight 上升 → Verdict rate 追上 → Queue drain
```

異常訊號：
- Queue depth 持續增長，不清空 → Worker 數量不足，調高 `MAX` 後重跑 scale-watcher
- Submit API p95 > 1s 但 Queue depth 沒漲 → backend 到 MQ 連線瓶頸
- Judge p99 極高（> 30s）+ Worker CPU 100% → Worker CPU 是瓶頸

補充 Prometheus raw query（無 Grafana 時用）：

```promql
# RabbitMQ judge queue 深度
rabbitmq_queue_messages{queue="judge.tasks"}

# Backend HTTP error rate（5xx）
sum(rate(http_requests_total{status=~"5.."}[1m]))

# Worker CPU %（cAdvisor）
rate(container_cpu_usage_seconds_total{name=~".*worker.*"}[30s]) * 100
```

---

## 瓶頸壓測

系統最可能的三個寫入瓶頸，對應不同的後端路徑：

| 場景 | 端點 | 後端路徑 | 腳本 |
| --- | --- | --- | --- |
| 同時進入考場 | `POST /exam-sessions/:id/start` | DB 狀態機轉換（no MQ） | `k6-start.js` |
| 同時 Run 公開測資 | `POST /exam-sessions/:id/submissions` (type=simple) | DB write + MQ publish + Worker | `k6-submit.js` |
| 同時正式提交 | `POST /exam-sessions/:id/submissions` (type=formal) | DB write + MQ publish + Worker + scoring | `k6-submit.js` |

---

### 場景一：同時進入考場（`k6-start.js`）

測試所有考生同時觸發 `/start` 時，DB 狀態機在高併發下的事務隔離能力。
此路徑不走 RabbitMQ，瓶頸純粹在 PostgreSQL 寫入吞吐量。

**重要：每個 session 只能 start 一次（狀態轉換不可逆），每次測試前必須重新 seed。**

Step 1：產生 `not_started` sessions

```bash
cd loadtest
npx tsx seed-start.ts          # 預設 N=100
N=200 npx tsx seed-start.ts    # 調整並發數
```

Step 2：執行突發壓測

```bash
k6 run loadtest/k6-start.js
```

調整並發數（VUS 須 <= seed 時的 N）：

```bash
VUS=200 k6 run loadtest/k6-start.js
```

本地 docker compose 環境：

```bash
VUS=100 BASE_URL=http://localhost:3000/api k6 run loadtest/k6-start.js
```

**如何判斷瓶頸**：若 `p95 > 2000ms` 或 `start_failures > 0`，代表 DB connection pool 或 row lock 已飽和。
同時觀察：

```bash
kubectl top pods -n <namespace>    # 看 backend pod CPU/Memory
kubectl logs -n <namespace> deploy/<backend> -f  # 看 connection pool 錯誤
```

---

### 場景二：同時 Run 公開測資（`k6-submit.js` with `SUBMISSION_TYPE=simple`）

測試考生在考試中頻繁按「Run」時的系統吞吐量。
type=simple 只跑公開測資、不更新分數，session 狀態維持 `in_progress`，**可重複觸發**。

Step 1：seed（與 formal submit 共用，已有 session 可跳過）

```bash
cd loadtest
npx tsx seed.ts          # 預設 N=100
```

Step 2：執行突發壓測

```bash
SUBMISSION_TYPE=simple k6 run loadtest/k6-submit.js
```

高並發變體：

```bash
VUS=200 SUBMISSION_TYPE=simple k6 run loadtest/k6-submit.js
```

模擬 TLE 工作負載（讓 Worker 持續 busy，觀察 scale-watcher 是否觸發）：

```bash
VUS=50 SUBMISSION_TYPE=simple FIXTURE=tle.py k6 run loadtest/k6-submit.js
```

**如何判斷瓶頸**：`http_req_duration{name:submit}` p95 反映 MQ enqueue 延遲（後端到 RabbitMQ）；
judge 端到端延遲需另外觀察 Prometheus `judge_duration_seconds` 或 WebSocket 事件。

---

### 場景三：同時正式提交（`k6-submit.js` with `SUBMISSION_TYPE=formal`）

測試考試結束前所有考生同時正式提交的峰值壓力。
走完整路徑：DB write → RabbitMQ → Worker judge → scoring update。

Step 1：seed（與場景二共用同一批 sessions）

```bash
cd loadtest
npx tsx seed.ts
```

Step 2：執行突發壓測

```bash
k6 run loadtest/k6-submit.js                 # 預設 SUBMISSION_TYPE=formal
```

觀察 Worker 自動擴縮（需啟動 scale-watcher）：

```bash
# terminal 1
./loadtest/scale-watcher.sh

# terminal 2
VUS=100 FIXTURE=tle.py k6 run loadtest/k6-submit.js
```

**如何判斷瓶頸**：
- `submit_failures` 高 → backend → MQ 連線或 DB write 飽和
- `http_req_duration{name:submit}` p95 正常但 judge 慢 → Worker 數量不足，Queue depth 持續增長
- Worker CPU 持續 100% → CPU 是瓶頸，需增加 Worker 副本上限

---

### 建議測試順序

```
1. smoke (讀取確認)       DURATION=30s 各角色 RPS=1  → k6-roles.js
2. 進入考場峰值測試        VUS=100 → k6-start.js         (DB 狀態機)
3. Run 公開測資吞吐量       VUS=100 SUBMISSION_TYPE=simple → k6-submit.js  (MQ path)
4. 正式提交峰值測試        VUS=100 SUBMISSION_TYPE=formal → k6-submit.js  (full path)
5. TLE 高負載長跑          VUS=50  FIXTURE=tle.py          → 觀察 scale-watcher
```

`k6-submit.js` 環境變數：

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000/api` | API base |
| `VUS` | `100` | 並發數（需 <= seed N） |
| `SUBMISSION_TYPE` | `formal` | `formal` 或 `simple` |
| `FIXTURE` | `ac.py` | 提交的程式碼：`ac.py` / `wa.py` / `tle.py` |

`k6-start.js` 環境變數：

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000/api` | API base |
| `VUS` | `100` | 並發數（需 <= seed-start.ts 的 N） |
