# Backend API 現況 — IAM / Problem / Exam / Language / Submission 模組

## 目前狀態

目前專案已完成 PostgreSQL schema/seed/scenario data 與 Backend API M1，包括 JWT auth、IAM、Problem、Exam、Language、RBAC 與 112 筆 integration tests；M2 已完成 RabbitMQ 非同步判題整合（移除 mock judge）與 WebSocket 即時推播，前端仍維持健康狀態頁，正式前端功能留待後續實作。M3 新增 `users.created_by` 欄位，interviewer 僅能管理自己建立的 candidate，並補上 `PUT /api/users/:id` 端點。

Database schema 已完整建置（見 `infra/postgres/` 下的 00-11 SQL 腳本，以及對應的 Drizzle ORM schema `backend/src/db/schema.ts`）。Backend 以 Routes（HTTP 薄層）+ Services（業務邏輯、RBAC）分層實作，M2 新增 MQ 發布/消費與 WebSocket hub；M3 新增 ownership 欄位與 idempotent migration。

---

## 目錄結構

```text
backend/src/
├── server.ts              # Fastify app 主入口，註冊 plugins、routes、WebSocket 路由
├── env.ts                 # Zod 驗證環境變數（DATABASE_URL、JWT_SECRET、RABBITMQ_URL 等）
├── errors.ts              # 401/403/404/409/400 response 共用 helper
├── types.d.ts             # Fastify request.user 型別擴充（augments FastifyRequest）
│
├── plugins/
│   └── jwt.ts             # 註冊 @fastify/jwt plugin
│
├── hooks/
│   └── authenticate.ts    # 驗證 Authorization Bearer token，設定 request.user
│
├── db/                    # 數據存取層
│   ├── schema.ts          # Drizzle ORM schema，與 infra/postgres/ SQL 一對一對齊
│   ├── client.ts          # PostgreSQL 連線 pool（Drizzle + node-postgres）
│   └── migrate.ts         # Migration runner，啟動時執行 SQL 腳本
│
├── mq/                    # RabbitMQ 整合
│   ├── client.ts          # 連線管理（含斷線指數退避重連），export getChannel()
│   ├── publisher.ts       # publishJudgeTask({ submissionId, type }) → judge.tasks queue
│   └── consumer.ts        # 消費 judge.results.backend，過濾 hidden output，推送 WebSocket
│
├── ws/
│   └── hub.ts             # WebSocket 連線 Map（sessionId → Set<WebSocket>），broadcast helper
│
├── routes/                # HTTP 薄層：Zod body validation、呼叫 service、回傳 status code
│   ├── auth.ts            # POST /api/auth/login
│   ├── users.ts           # /api/users CRUD
│   ├── problems.ts        # /api/problems CRUD + testcase + language limits
│   ├── exams.ts           # /api/exam-sessions：建立、查詢、start、cancel、problems
│   ├── submissions.ts     # /api/exam-sessions/:id/submissions + result；POST 接收 type 欄位
│   ├── languages.ts       # GET /api/languages
│   ├── health.ts          # GET /api/health
│   └── ping.ts            # GET /api/ping
│
├── services/              # 業務邏輯、RBAC、ownership check、DB transaction
│   ├── auth.service.ts       # 登入驗證、JWT payload 建立、roles/permissions 查詢
│   ├── user.service.ts       # 使用者 CRUD、軟刪除、批次建帳號（回傳明文密碼一次）
│   ├── problem.service.ts    # 題目 CRUD、測資管理、語言倍率覆寫
│   ├── exam.service.ts       # Session 建立（手動/隨機派題）、visibility、狀態轉換
│   ├── submission.service.ts # Submission 建立（publish MQ 任務）、結果查詢（直接讀 DB）
│   └── language.service.ts  # 語言列表查詢（is_enabled = true）
│
└── __tests__/
    ├── helpers/
    │   ├── app.ts            # 建立測試用 Fastify app，seed 9 位使用者 / 8 題 / 6 場考試
    │   ├── db.ts             # DB truncate / 重新 seed 工具函式（含 setupSchema、seedUser 支援 createdBy）
    │   └── global-setup.ts   # Vitest globalSetup：執行 ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by
    ├── auth.test.ts        # 7 tests
    ├── users.test.ts       # 24 tests
    ├── problems.test.ts    # 30 tests
    ├── exams.test.ts       # 24 tests
    ├── submissions.test.ts # 11 tests
    └── system.test.ts      # 3 tests
```

**分層設計理由：**
- `routes/` 保持薄層（只做 HTTP binding），讓 service 可以在不啟動 HTTP server 的情況下被測試或重用。
- `services/` 集中所有 RBAC / ownership 判斷，避免權限邏輯散落在 routes 中。
- `db/schema.ts` 與 `infra/postgres/` SQL 保持一對一對齊，Drizzle 提供型別安全的查詢，migration 則以 raw SQL 為準（方便 DBA 審查）。
- `mq/` 與 `ws/` 獨立於 routes/services，方便未來替換 broker 或升級 WebSocket 實作。

---

## API Endpoints

### Auth / IAM

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| POST | `/api/auth/login` | public | 登入，回傳 JWT |
| GET | `/api/users` | superuser / `exam:manage` | superuser 看所有未刪除使用者；interviewer 只看自己建立（`created_by`）的 candidate |
| POST | `/api/users` | superuser 或 `exam:manage` | superuser 可建任意角色；interviewer 只能建 candidate（自動設 `created_by`）|
| POST | `/api/users/batch` | `exam:manage` / superuser | 批次建 candidate，回傳一次性明文密碼；非 superuser 自動設 `created_by` |
| GET | `/api/users/:id` | 本人或 superuser | 查使用者資料 |
| PUT | `/api/users/:id` | superuser / `exam:manage`（ownership）| 更新 `displayName` 或重設密碼；interviewer 只能更新自己建立的 candidate |
| DELETE | `/api/users/:id` | superuser / `exam:manage`（ownership）| 軟刪除（`deleted_at`）；interviewer 只能刪除自己建立的 candidate，不可刪 superuser |

### Problem

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| GET | `/api/problems` | `problem:manage` / `exam:manage` / superuser | 列題目摘要 |
| POST | `/api/problems` | `problem:manage` | 建題，可同時帶 testcases 與 languageLimits |
| GET | `/api/problems/:id` | `problem:manage` / `exam:manage` / superuser | 題目詳情；非出題權限不回傳 hidden testcase input/output |
| PUT | `/api/problems/:id` | `problem:manage` | 更新題目基本資料 |
| DELETE | `/api/problems/:id` | `problem:manage` | 軟刪除；若已被 exam session 引用則回 409 |
| POST | `/api/problems/:id/testcases` | `problem:manage` | 新增測資 |
| PUT | `/api/problems/:id/testcases/:tcId` | `problem:manage` | 更新測資 |
| DELETE | `/api/problems/:id/testcases/:tcId` | `problem:manage` | 刪除測資 |
| PUT | `/api/problems/:id/languages` | `problem:manage` | 覆寫此題的語言時間/記憶體倍率；空陣列代表清除覆寫 |

### Exam

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| POST | `/api/exam-sessions` | `exam:manage` | 建 session 並派題；body 可為手動 `problems` 或隨機 `distribution` |
| GET | `/api/exam-sessions` | `exam:manage` / `exam:take` / superuser | superuser 看全部；interviewer 看自己建立；candidate 看自己的 |
| GET | `/api/exam-sessions/:id` | ownership check | Session 詳情 |
| POST | `/api/exam-sessions/:id/start` | `exam:take`（本人）| 面試者開始考試，寫入 `actual_start_at`、`expires_at` |
| POST | `/api/exam-sessions/:id/submit` | `exam:take`（本人）| 面試者提前交卷，寫入 `submitted_at` |
| POST | `/api/exam-sessions/:id/cancel` | `exam:manage` | 面試主管取消 |
| GET | `/api/exam-sessions/:id/problems` | ownership check | 本場派題清單，包含題目基本資料與 `languageLimits` |

### Submission / Result

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| POST | `/api/exam-sessions/:sessionId/submissions` | `exam:take`（本人）| 建立 submission，publish 到 MQ，回 202 |
| GET | `/api/exam-sessions/:sessionId/submissions` | ownership check | 查本場 submission history；不回傳 `sourceCode` |
| GET | `/api/exam-sessions/:sessionId/submissions/:submissionId` | ownership check | 查單筆 submission detail，包含 `sourceCode` 與 testcase results |
| GET | `/api/exam-sessions/:sessionId/result` | ownership check | 查 session result summary、每題最新狀態與分數 |

### Language / WebSocket

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| GET | `/api/languages` | 任一有效 JWT | 列出 `language_defaults.is_enabled = true` 的支援語言 |
| GET | `/api/ws` | JWT（query string `?token=<JWT>`）| WebSocket 升級；連線後 subscribe sessionId 即可收 `judge_result` 推播 |

`GET /api/problems/:id` 與 `GET /api/exam-sessions/:id/problems` 會回傳該題 `languageLimits`。沒有覆寫資料時，評測端應使用 `GET /api/languages` 回傳的全域預設倍率。

---

## 測試覆蓋現況

目前共有 6 個 test files、112 筆 integration tests。這些測試不是只驗證「happy path」，而是刻意依角色覆蓋 RBAC、ownership、資料隔離、錯誤狀態與關鍵業務規則。

| Test file | 測試數 | 覆蓋重點 |
|-----------|--------|----------|
| `auth.test.ts` | 7 | 登入成功/失敗、軟刪除帳號、body validation、未認證與 malformed JWT 401 |
| `users.test.ts` | 37 | superuser / interviewer / candidate 的 IAM 權限、`created_by` ownership（只看/改/刪自己建立的 candidate）、重複 username、未知 role、batch bounds 與軟刪除 |
| `problems.test.ts` | 30 | 題目 CRUD、測資 CRUD、hidden testcase sanitization、Language API、languageLimits、deleted problem guards、constraint conflicts |
| `exams.test.ts` | 24 | 手動/隨機派題、歷史題目排除、session visibility、start/cancel ownership、session problems、random pool conflicts |
| `submissions.test.ts` | 11 | async judge 狀態、submission history/result、source code visibility、RBAC/ownership、session 狀態 guard、final formal scoring |
| `system.test.ts` | 3 | `/api/ping`、`/api/health`、`/api/ws` authentication/error behavior |

### 通用測試

這些測試不綁定特定角色，主要驗證認證機制與通用保護行為。

| 測試目標 | 驗證內容 |
|----------|----------|
| 登入成功 | 有效帳密可取得三段式 JWT token |
| 登入失敗 | 錯誤密碼、帳號不存在、軟刪除帳號皆回 401 |
| Request validation | login body 缺少必要欄位時回 400 |
| Protected route | 未帶 Authorization header 存取受保護端點時回 401 |
| Language auth | `GET /api/languages` 需要有效 JWT，未認證回 401 |

### Superuser 測試

Superuser 代表平台最高權限，測試重點是「不受一般 RBAC 限制」與「可執行管理操作」。

| 模組 | 測試目標 |
|------|----------|
| IAM | 可列出所有未刪除使用者 |
| IAM | 可建立 candidate 使用者 |
| IAM | 可建立 interviewer 角色使用者 |
| IAM | 可批次建立 candidate，並回傳一次性明文密碼 |
| IAM | 可查詢自己的 profile |
| IAM | 可查詢任意其他使用者 profile |
| IAM | 可軟刪除使用者，且被刪除者後續無法登入 |
| Exam | 可看到所有 interviewer 建立的 exam sessions |
| Exam | 可手動派題建立 exam session |

### Interviewer 測試

Interviewer 具備 `exam:manage`，測試重點是「可建立候選人與考試」、「不可越權管理題目/其他 interviewer 的 session」。

| 模組 | 測試目標 |
|------|----------|
| IAM | `GET /api/users` 回 200，只看到自己建立（`created_by`）的 candidate；無建立紀錄時回空陣列 |
| IAM | 可建立單一 candidate 帳號（自動設 `created_by = interviewer.id`）|
| IAM | 建立使用者時省略 `roleNames` 會預設為 candidate |
| IAM | 嘗試建立 interviewer 角色帳號回 403 |
| IAM | 嘗試建立 problem_setter 角色帳號回 403 |
| IAM | 可批次建立 candidate 帳號 |
| IAM | 可查詢自己的 profile |
| IAM | 查詢他人 profile 回 403 |
| IAM | 可更新自己建立的 candidate 的 displayName 或密碼 → 200 |
| IAM | 更新非自己建立的 candidate → 403 |
| IAM | 更新 superuser → 403 |
| IAM | 可軟刪除自己建立的 candidate → 204 |
| IAM | 刪除非自己建立的 candidate → 403 |
| IAM | 刪除 superuser → 403 |
| Problem | 可列出題目，供派題選用 |
| Problem | 可查詢單一題目，但 hidden testcase 不回傳 `inputData` / `expectedOutput` |
| Problem | 嘗試建立、更新、刪除題目皆回 403 |
| Problem | 可列出支援語言 |
| Problem | 嘗試設定題目 languageLimits 回 403 |
| Exam | 可手動派題建立 session |
| Exam | 可隨機派題建立 session |
| Exam | 隨機派題會排除同候選人歷史題目；題庫不足時回 409 |
| Exam | 列表只看得到自己建立的 sessions |
| Exam | 可查詢自己建立的 session detail |
| Exam | 查詢其他 interviewer 建立的 session 回 403 |
| Exam | 可取消自己建立的 session |
| Exam | 可查詢自己建立 session 的題目列表 |
| Exam | 查詢其他 interviewer session 的題目列表回 403 |

### Problem Setter 測試

Problem setter 具備 `problem:manage`，測試重點是完整題目管理能力，以及不能操作 Exam/IAM 管理功能。

| 模組 | 測試目標 |
|------|----------|
| Problem | 可建立題目與 testcases |
| Problem | 可列出題目 |
| Problem | 軟刪除後題目不再出現在 list |
| Problem | 查詢單一題目時可看到 hidden testcase 的完整 input/output |
| Problem | 可更新題目基本欄位，例如 title、timeLimitMs |
| Problem | 可新增 testcase |
| Problem | 可更新 testcase 的 `isPublic` / `inputData` 等欄位 |
| Problem | 可刪除 testcase |
| Problem | 刪除已被 exam session 引用的題目會回 409 |
| Language | 可列出支援語言 |
| Language | 建題時可帶 `languageLimits`，查詢 detail 時可看到設定 |
| Language | 可用 `PUT /api/problems/:id/languages` 覆寫語言倍率 |
| Language | 傳空陣列可清除題目的 languageLimits |
| Exam | 嘗試查詢 exam sessions 回 403，因為沒有 `exam:manage` / `exam:take` |
| IAM | 可查詢自己的 profile |

### Candidate 測試

Candidate 具備 `exam:take`，測試重點是「只能參加自己的考試」，不可管理使用者、題目或他人 session。

| 模組 | 測試目標 |
|------|----------|
| IAM | 嘗試建立使用者回 403 |
| IAM | 嘗試批次建立 candidate 回 403 |
| IAM | 可查詢自己的 profile |
| IAM | 查詢他人 profile 回 403 |
| Problem | 嘗試建立題目回 403 |
| Problem | 嘗試列出題目回 403 |
| Exam | 嘗試建立 exam session 回 403 |
| Exam | 列表只看得到自己作為 candidate 的 sessions |
| Exam | 可查詢自己的 session detail |
| Exam | 查詢其他 candidate 的 session detail 回 403 |
| Exam | 可開始自己的 `not_started` session，狀態變為 `in_progress` 並寫入 `actualStartAt` / `expiresAt` |
| Exam | 已開始的 session 再次 start 回 409 |
| Exam | 嘗試取消考試回 403 |
| Exam | 可查詢自己 session 的題目列表 |
| Exam | 查詢其他 candidate session 的題目列表回 403 |
| Submission | 可在自己的 `in_progress` session 建立 submission，初始狀態為 `pending` |
| Submission | 讀取 detail / history / result 不會 lazy 推進狀態，worker result consumer 才能寫入 `judging` / `done` |
| Submission | 最新 `formal` 提交決定 `final_submission_id`；AC 得滿分，非 AC 得 0，`simple` 不影響分數 |
| Submission | 可查自己的 submission detail 與 testcase results，但 hidden testcase 不揭露 `actualOutput` |
| Submission | 查詢其他 candidate 的 result / history 回 403 |

### 關鍵業務規則覆蓋

| 規則 | 測試涵蓋 |
|------|----------|
| JWT auth | 有效 token、錯誤帳密、未認證、軟刪除帳號 |
| RBAC | superuser、`exam:manage`、`problem:manage`、`exam:take` 的允許與拒絕路徑 |
| Ownership | interviewer 只能看自己建立的 sessions；candidate 只能看自己的 sessions |
| Hidden testcase sanitization | problem_setter 可看 hidden input/output；interviewer 看不到 hidden input/output |
| Problem delete safety | 題目若已被 exam session 引用，刪除回 409 |
| Random assignment | 隨機派題排除 candidate 歷史題目，也處理題庫不足 |
| Exam state transition | `not_started` → `in_progress`，重複 start 回 409 |
| Language limits | 建題、查詢、覆寫、清空 languageLimits |
| Submission state transition | API 建立 `pending`，worker result consumer 寫入 `judging` / `done` / `system_error` |
| Submission scoring | 最新完成的 `formal` 提交寫入 `final_submission_id`，AC 給該題滿分、非 AC 歸 0，並更新 session `total_score`；`simple` 不影響分數 |
| Source code visibility | history / result 不回傳 `sourceCode`；detail 可供 candidate 本人與建立該 session 的 interviewer 查看 |
| Hidden testcase result safety | hidden testcase 不回傳 `actualOutput` |
| Submission guards | 未開始、取消、已提交、過期 session 皆不可提交；過期 session 會 lazy 標記為 `expired` |

測試會連到真實 PostgreSQL，並在每個 case 前 truncate 測試資料後重新 seed helper data。若本機 PostgreSQL 未啟動，`npm test` 會在連線 `127.0.0.1:5432` / `::1:5432` 時失敗。

---

## 剩餘工作

- 補上考試送出與逾時處理：`in_progress` → `submitted`，以及 cron/lazy update 策略。
- 補齊前端：登入、面試主管管理、出題、考試作答、結果頁。
- 規劃正式 migration 流程：目前已有 init SQL 與 Drizzle schema，後續需要版本化 migration 策略。
