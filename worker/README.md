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

| Test file | 測試數 | 覆蓋重點 |
|-----------|--------|----------|
| `engine/checker.test.ts` | 約 5 | AC/WA 比對含尾端空白/換行邊界 |
| `engine/compiler.test.ts` | 約 10 | 編譯成功、CE 回傳 errorLog |
| `engine/runner.test.ts` | 約 15 | TLE（timeout）、MLE（exit 137）、RE（非零 exit）、AC |
| `consumers/judge.consumer.test.ts` | 約 20 | 完整判題流程 mock（DB queries、Docker mocked） |

測試使用 Vitest，`db/queries` 與 Dockerode 在 consumer 測試中以 `vi.mock` 替換，engine 測試依賴 Docker 環境（需本機 Docker 運行）。

---

## 剩餘工作

- **Worker 整合測試**：目前為 unit/mock 測試；補充端到端整合測試（真實 DB + RabbitMQ + Docker sandbox），驗證 formal 提交分數更新。
- **gVisor CI 安裝策略**：gVisor 需在 host 安裝，CI runner 需要支援巢狀虛擬化；目前 CI 用 `SANDBOX_RUNTIME=runc`，需評估是否引入 gVisor 專屬 CI 環境。
- **Sandbox image 版本管理**：`oj-sandbox-cpp` / `oj-sandbox-python` 目前需手動 build；整合進 docker-compose build 或 registry push 流程。
