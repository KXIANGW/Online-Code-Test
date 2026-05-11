# Judge Worker — Online Code Test

## 目前狀態

M2 已完成：Backend Mock Judge 已移除，替換為真實非同步判題系統。Backend 收到 submission 後發布到 RabbitMQ，立即回傳 202；Judge Worker 非同步消費任務，在 gVisor sandbox 執行程式碼，結果透過 RabbitMQ 回傳給 Backend，再由 WebSocket 推送到前端。

**已確認的設計決策：**
- 沙箱隔離：gVisor runtime（`--runtime=runsc`），Worker 掛載 Docker socket
- C++ 編譯：普通 Docker container（無 gVisor），執行才用 gVisor；編譯失敗立即回傳 CE
- Worker 並發：單一 Worker container，一次一個 task（RabbitMQ prefetch=1）
- 提交類型：`simple`（public 測資）/ `formal`（全部測資，AC 才更新分數）
- 無 gVisor 環境：設 `SANDBOX_RUNTIME=runc` 退回普通 Docker（僅限開發）

---

## 整體架構

```
┌─────────────┐  POST /submissions    ┌─────────────────────────────────────────┐
│  Frontend   │ ──────────────────▶  │              Backend (Fastify)           │
│             │  WebSocket ws://...   │                                           │
│             │ ◀─────────────────── │  ┌─────────────┐  ┌────────────────────┐ │
└─────────────┘                      │  │  HTTP Routes │  │  WS /api/ws        │ │
                                     │  └──────┬──────┘  └─────────┬──────────┘ │
                                     │         │ publish            ▲ push        │
                                     │         ▼                    │             │
                                     │  ┌──────────────────────────┴──────────┐  │
                                     │  │       RabbitMQ Consumer              │  │
                                     │  └──────────────────────────────────────┘  │
                                     └───────────┬──────────────────┬─────────────┘
                                       judge.tasks queue    judge.results exchange
                                                 │                  ▲
                                                 ▼                  │
                                     ┌───────────────────────────────────────────┐
                                     │         Judge Worker (Node.js)            │
                                     │                                           │
                                     │  judge.consumer → db/queries              │
                                     │       │                                   │
                                     │       ├──▶ compiler.ts (普通 Docker)       │
                                     │       │     └─ g++ solution.cpp           │
                                     │       │     └─ CE? → 立即結束              │
                                     │       │                                   │
                                     │       └──▶ runner.ts（每個 testcase）      │
                                     │             └─ --runtime=runsc (gVisor)   │
                                     │             └─ stdin < input.txt          │
                                     │             └─ checker.ts 比對            │
                                     └───────────┬───────────────────────────────┘
                                                 │ /var/run/docker.sock
                                                 ▼
                                     ┌───────────────────────────────────────────┐
                                     │              Docker Engine (Host)          │
                                     │  ┌──────────────┐  ┌───────────────────┐  │
                                     │  │ compiler ctr  │  │  sandbox ctr      │  │
                                     │  │ oj-sandbox-cpp│  │  oj-sandbox-cpp   │  │
                                     │  │ (普通 runtime) │  │  (runsc / gVisor) │  │
                                     │  └──────────────┘  └───────────────────┘  │
                                     └───────────────────────────────────────────┘
```

---

## 目錄結構

```text
worker/
├── Dockerfile                  # node:20-alpine + docker-cli（偵錯用）；執行 dist/index.js
├── sandbox/
│   ├── cpp/Dockerfile          # oj-sandbox-cpp image（ubuntu:22.04 + g++）
│   └── python/Dockerfile       # oj-sandbox-python image（python:3.11-slim）
└── src/
    ├── index.ts                # 入口：連線 RabbitMQ、assert exchange/queue、設定 prefetch=1、啟動 consumer
    ├── config/
    │   └── index.ts            # 環境變數（RABBITMQ_URL、DATABASE_URL、HOST_WORK_DIR、SANDBOX_RUNTIME）
    ├── providers/
    │   ├── docker.ts           # Dockerode client（連接 /var/run/docker.sock）
    │   └── storage.ts          # 佔位（未來物件儲存整合）
    ├── db/
    │   ├── client.ts           # PostgreSQL Pool（node-postgres）
    │   └── queries.ts          # getSubmissionById、getTestcases、updateSubmissionJudging、writeJudgeResults
    ├── engine/
    │   ├── compiler.ts         # C++ 編譯：在普通 Docker container 執行 g++，回傳成功/CE errorLog
    │   ├── runner.ts           # 單一 testcase 執行：gVisor sandbox，監控 TLE/MLE/RE，回傳 verdict + stdout
    │   └── checker.ts          # 輸出比對：去除尾端空白/換行差異，回傳 AC 或 WA
    └── consumers/
        └── judge.consumer.ts   # 主要判題邏輯：消費 MQ → compiler → runner × testcases → DB transaction → publish results
```

**分層設計理由：**
- `consumers/` 只負責 MQ 消費與整體判題流程編排，不直接操作 Docker 或 DB。
- `engine/` 隔離沙箱執行細節（compiler / runner / checker），每個模組可獨立測試。
- `db/queries.ts` 集中所有 DB 操作，judge consumer 不直接寫 SQL。
- `providers/docker.ts` 統一 Dockerode 初始化，方便在測試中替換成 mock。

---

## 訊息協定

### RabbitMQ 設計

| 名稱 | 類型 | 用途 |
|------|------|------|
| `judge.tasks` | Direct Queue | Backend → Worker（任務分發） |
| `judge.results` | Fanout Exchange | Worker → Backend（結果推播） |
| `judge.results.backend` | Queue（綁定到 exchange） | Backend consumer 消費用 |
| `judge.dlq` | Dead Letter Queue | 失敗任務存放 |

**judge.tasks 訊息格式（Backend 發布）：**
```json
{ "submissionId": 123, "type": "simple" }
```

**judge.results 訊息格式（Worker 發布）：**
```json
{
  "submissionId": 123,
  "sessionId": 456,
  "examSessionProblemId": 789,
  "type": "simple",
  "verdict": "AC",
  "runtimeMs": 42,
  "memoryKb": 8192
}
```

### WebSocket 協議（Backend ↔ Frontend）

**連線：** `ws://localhost:3000/api/ws?token=<JWT>`

**Frontend 訂閱：**
```json
{ "type": "subscribe", "sessionId": 456 }
```

**Backend 推送（judge_result）：**
```json
{
  "type": "judge_result",
  "submissionId": 123,
  "verdict": "AC",
  "runtimeMs": 42,
  "memoryKb": 8192,
  "submissionType": "simple",
  "testcaseResults": [
    { "testcaseId": 1, "verdict": "AC", "actualOutput": "42\n", "runtimeMs": 10 }
  ]
}
```
> `formal` 提交中，hidden testcase 的 `actualOutput` 不回傳（Backend 在 MQ consumer 過濾）。

### 提交流程

**Simple 提交**（僅跑 public 測資，不更新分數）：
1. `POST /submissions` body: `{ language, sourceCode, type: 'simple' }`
2. Backend 建立 submission（status=pending）→ publish `judge.tasks`
3. 回傳 202 + `{ submissionId }`
4. Worker 執行 public testcases → 回寫 DB → publish `judge.results`
5. Backend 推送 WebSocket（含 `actualOutput`）

**Formal 提交**（跑全部測資，AC 才更新分數）：
1. `POST /submissions` body: `{ language, sourceCode, type: 'formal' }`
2. Backend 建立 submission（status=pending）→ publish `judge.tasks`
3. Worker 執行所有 testcases → 回寫 DB
4. 若 verdict='AC'：更新 `exam_session_problems.score`、`exam_sessions.total_score`
5. Backend 推送 WebSocket（hidden testcase 不含 `actualOutput`）

### 錯誤處理

| 情境 | 處理方式 |
|------|----------|
| 編譯失敗（CE） | 直接寫回 verdict='CE'，不執行任何 testcase |
| 沙箱逾時（TLE） | `container.kill()` 後記錄 TLE，後續 testcase 標記 skipped |
| OOM killed（exit 137） | 記錄 MLE |
| Runtime Error（exit ≠ 0） | 記錄 RE |
| Docker API 失敗 | submission status='system_error'，publish error，ACK message |
| RabbitMQ 斷線 | Worker 指數退避重連（1s, 2s, 4s … 最大 30s） |
| 未知例外 | 捕獲後標記 system_error，確保 message ACK（不卡隊列） |
| gVisor 未安裝 | 設 `SANDBOX_RUNTIME=runc` 退回普通 Docker（僅限開發） |

---

## 測試覆蓋現況

目前共有 5 個 test files、17 筆 tests。測試分成兩層：engine / consumer 以 mock Docker、mock DB 驗證判題流程決策；`db/queries.integration.test.ts` 則連到真實 PostgreSQL，驗證 worker 寫入 submission、testcase results、score 與 final submission 的 DB 行為。

| Test file | 測試數 | 覆蓋重點 |
|-----------|--------|----------|
| `engine/checker.test.ts` | 2 | AC/WA 比對含尾端空白/換行邊界 |
| `engine/compiler.test.ts` | 2 | 編譯失敗 CE、Python skip compile |
| `engine/runner.test.ts` | 4 | TLE（timeout）、MLE（exit 137）、RE（非零 exit）、output limit |
| `consumers/judge.consumer.test.ts` | 4 | 完整判題流程 mock（DB queries、Docker mocked）、publish/ACK、skipped |
| `db/queries.integration.test.ts` | 5 | PostgreSQL integration：submission/testcase loading、formal/simple scoring、CE/system_error 寫入 |

測試使用 Vitest。`consumers` 測試中 `db/queries` 與 Dockerode 以 `vi.mock` 替換；`db/queries.integration.test.ts` 會連到真實 PostgreSQL，需設定 `TEST_DATABASE_URL` 或 `DATABASE_URL`。

### Engine 測試

Engine 測試聚焦在「單一判題原語」是否穩定，不依賴 RabbitMQ 或 backend API。

| 模組 | 測試目標 |
|------|----------|
| Checker | 忽略尾端空白、換行與 CRLF 差異，等價輸出判為 `AC` |
| Checker | 輸出內容不同時判為 `WA`，並回傳第一個差異行的 diff |
| Compiler | C++ 編譯容器失敗時回傳 `CE` error log，不繼續執行 testcase |
| Compiler | Python 不需 compile，直接回傳 success |
| Runner | Docker exit code `137` 對應 `MLE` |
| Runner | 非 0 exit code 對應 `RE`，並保留 stderr |
| Runner | testcase timeout 時 kill container，回傳 `TLE` |
| Runner | stdout 超過 `outputLimitKb` 時回傳 `RE` 與 `Output limit exceeded` |

### Consumer 測試

Consumer 測試聚焦在 RabbitMQ message 被消費後，worker 如何串接 DB query、compiler、runner、checker 與 result publish。這層使用 mock，避免測試速度與 Docker/RabbitMQ 狀態耦合。

| 測試目標 | 驗證內容 |
|----------|----------|
| Queue concurrency | `startJudgeConsumer` 會先設定 `prefetch(1)`，避免單一 worker 同時吃多個判題工作 |
| Simple submission | `simple` 只抓 public testcases，執行後寫入 `writeJudgeResults`，並 publish `judge.results` |
| Resource limits | 從 DB 載入的 `outputLimitKb` 會傳入 `runOneTestcase`，與 time/memory limit 一起參與判題 |
| Formal submission | `formal` 會抓全部 testcases，包括 hidden testcases |
| Failure short-circuit | 第一個 testcase `WA` 後，後續 testcase 會標記 `skipped` |
| Publish/ACK | 成功判題後 publish `judge.results`，並 ACK 原始 `judge.tasks` message |
| Unknown exception | DB 或判題流程丟錯時，submission 會標記 `system_error`，並 ACK message，避免 queue 卡住 |

### DB Integration 測試

這層不是純 SQL unit tests，而是用 worker 實際使用的 `db/queries` 函式連到真實 PostgreSQL。測試資料會建立 users、problem、language limits、public/hidden testcases、exam session、exam session problem 與 submissions，藉此驗證 DB 欄位在真實判題流程中的意義。

| 測試目標 | 驗證內容 |
|----------|----------|
| `getSubmissionById` | 可載入 candidate、problem、session problem、source code、submission type |
| Language limits | 題目層 `problem_language_limits` 會覆寫 `language_defaults`，例如 Python time/memory multiplier |
| Output limit | `problems.output_limit_kb` 會被載入成 `outputLimitKb`，供 runner 執行輸出限制 |
| `getTestcases` | `simple` 模式只回 public testcases；`formal` 模式回全部 testcases |
| Judge order | testcases 依 `order_index` 排序，不依 insert 順序 |
| Formal AC scoring | `formal` + `AC` 會把該 submission 寫成 `final_submission_id`，題目分數設為 `score_weight`，並更新 session `total_score` |
| Formal non-AC scoring | 後續完成的 `formal` 非 AC submission 也會成為 final submission，分數歸 0，session `total_score` 跟著歸 0 |
| Simple scoring no-op | `simple` 即使 AC，也不更新 `final_submission_id`、題目分數或 session `total_score` |
| CE behavior | `CE` 會寫入 submission verdict，但不新增任何 `submission_testcase_results` rows |
| State updates | `updateSubmissionJudging` 可將 submission 標記為 `judging`；`markSubmissionSystemError` 可標記為 `system_error` 並清空 verdict |

### 關鍵業務規則覆蓋

| 規則 | 測試涵蓋 |
|------|----------|
| Public vs hidden testcases | `simple` 只執行 public；`formal` 執行 public + hidden |
| Hidden output safety | hidden testcase 的 `actualOutput` 可由 worker 寫入為 `null`，由 backend result API 繼續保護不外洩 |
| Final submission | 每次完成的 `formal` submission 都會覆寫 `exam_session_problems.final_submission_id` |
| Score rule | `formal` AC 得 `score_weight`；`formal` 非 AC 得 0；`simple` 不影響分數 |
| Output limit | `problems.output_limit_kb` 從 DB 載入、傳入 runner，stdout 超限時判成失敗 |
| Language multiplier | 題目語言覆寫優先於全域預設，並實際影響 worker 使用的 time/memory limit |
| CE no testcase rows | 編譯失敗沒有 per-testcase result，避免產生不存在的執行結果 |
| Short-circuit | 第一個 non-AC testcase 後，後續 testcase 標記 `skipped` |
| Queue safety | 成功或例外路徑都會 ACK message，例外路徑額外標記 `system_error` |

### 測試環境需求

| 測試類型 | 需求 |
|----------|------|
| Checker / compiler / runner unit tests | 不需要 PostgreSQL 或 RabbitMQ；Docker client 已被 mock |
| Consumer tests | 不需要 PostgreSQL、RabbitMQ 或 Docker；DB / Docker / engine dependency 皆以 `vi.mock` 替換 |
| DB integration tests | 需要 PostgreSQL，透過 `TEST_DATABASE_URL` 或 `DATABASE_URL` 連線 |
| Full manual worker test | 需要 postgres + rabbitmq + backend + worker，以及可用的 sandbox runtime |

常用自動測試指令：

```bash
cd worker
TEST_DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct npm test
npm run lint
```

---

## 剩餘工作

- **Worker 端到端整合測試**：目前已有真實 PostgreSQL 的 `db/queries` integration tests；仍可補充真實 RabbitMQ + Docker sandbox 的 E2E worker 測試，驗證從 `judge.tasks` 到 `judge.results` 的完整鏈路。
- **gVisor CI 安裝策略**：gVisor 需在 host 安裝，CI runner 需要支援巢狀虛擬化；目前 CI 用 `SANDBOX_RUNTIME=runc`，需評估是否引入 gVisor 專屬 CI 環境。
- **Sandbox image 版本管理**：`oj-sandbox-cpp` / `oj-sandbox-python` 目前需手動 build；整合進 docker-compose build 或 registry push 流程。
