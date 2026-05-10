# Backend API 現況與後續計畫 — IAM / Problem / Exam / Language / Submission 模組

## Context

目前專案已完成 PostgreSQL schema/seed/scenario data 與 Backend API M1，包括 JWT auth、IAM、Problem、Exam、Language、Submission mock judge、RBAC 與 76 筆 integration tests；前端仍維持健康狀態頁，正式 Judge Worker / sandbox judging 尚未實作，本機測試需先啟動 PostgreSQL 才能完整執行。

Database schema 已完整建置（見 `infra/postgres/` 下的 00-10 SQL 腳本，以及對應的 Drizzle ORM schema `backend/src/db/schema.ts`）。Backend 已由原本的 health/ping skeleton 擴充為可運作的 Fastify API，並以 Routes（HTTP 薄層）+ Services（業務邏輯、RBAC）分層實作。

**目前狀態：**
- 已實作 `/api/health`、`/api/ping`、`/api/auth`、`/api/users`、`/api/problems`、`/api/exam-sessions`、`/api/languages`
- Submission API 已實作 mock judge 版；正式 Judge Worker、沙箱執行與真實評測留待下一階段處理
- Auth 使用 `@fastify/jwt`，token payload 含 `sub`、`isSuperuser`、`permissions`
- IAM / Problem / Exam / Language routes 已接上 service 層與 Drizzle DB access
- RBAC 以 superuser short-circuit → permission check → ownership check 為主
- Integration tests 使用 Vitest + Fastify `app.inject()`，對接真實 PostgreSQL DB

---

## 關鍵檔案

| 檔案 | 目前角色 |
|------|----------|
| `backend/src/server.ts` | 建立 Fastify app，註冊 JWT plugin 與 `/api/*` routes |
| `backend/src/env.ts` | 驗證 `DATABASE_URL`、`JWT_SECRET`、`TEST_DATABASE_URL` 等環境變數 |
| `backend/src/plugins/jwt.ts` | 註冊 `@fastify/jwt` |
| `backend/src/hooks/authenticate.ts` | 驗證 Bearer token 並設定 `request.user` |
| `backend/src/errors.ts` | 集中建立 401/403/404/409/400 helper |
| `backend/src/routes/*.ts` | HTTP endpoint、Zod body validation、status code |
| `backend/src/services/*.ts` | 業務邏輯、RBAC、ownership、transaction |
| `backend/src/db/schema.ts` | Drizzle ORM schema，對齊 `infra/postgres/` SQL |
| `infra/postgres/09-seed.sql` | roles、permissions、language_defaults |
| `infra/postgres/10-scenarios.sql` | 9 位使用者、8 題、6 場考試與 submission 情境 |
| `backend/src/routes/submissions.ts` | Submission / result HTTP endpoints |
| `backend/src/services/submission.service.ts` | Submission 建立、查詢、mock judge、結果彙總 |
| `backend/src/__tests__/*.test.ts` | 76 筆 integration tests |

---

## 已完成目錄結構

```text
backend/src/
├── plugins/
│   └── jwt.ts
├── hooks/
│   └── authenticate.ts
├── errors.ts
├── routes/
│   ├── auth.ts
│   ├── users.ts
│   ├── problems.ts
│   ├── exams.ts
│   ├── submissions.ts
│   ├── languages.ts
│   ├── health.ts
│   └── ping.ts
├── services/
│   ├── auth.service.ts
│   ├── user.service.ts
│   ├── problem.service.ts
│   ├── exam.service.ts
│   ├── submission.service.ts
│   └── language.service.ts
└── __tests__/
    ├── helpers/
    │   ├── app.ts
    │   └── db.ts
    ├── auth.test.ts
    ├── users.test.ts
    ├── problems.test.ts
    ├── exams.test.ts
    └── submissions.test.ts
```

---

## API Endpoints

### Auth / IAM

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| POST | `/api/auth/login` | public | 登入，回傳 JWT |
| GET | `/api/users` | superuser | 列所有未軟刪除使用者 |
| POST | `/api/users` | superuser 或 `exam:manage` | superuser 可建任意角色；interviewer 只能建 candidate |
| POST | `/api/users/batch` | `exam:manage` / superuser | 批次建 candidate，回傳一次性明文密碼 |
| GET | `/api/users/:id` | 本人或 superuser | 查使用者資料 |
| DELETE | `/api/users/:id` | superuser | 軟刪除（`deleted_at`）|

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
| POST | `/api/exam-sessions/:id/cancel` | `exam:manage` | 面試主管取消 |
| GET | `/api/exam-sessions/:id/problems` | ownership check | 本場派題清單，包含題目基本資料與 `languageLimits` |

### Submission / Result

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| POST | `/api/exam-sessions/:sessionId/submissions` | `exam:take`（本人）| 建立 submission，寫入 `pending`，回 202 |
| GET | `/api/exam-sessions/:sessionId/submissions` | ownership check | 查本場 submission history；不回傳 `sourceCode` |
| GET | `/api/exam-sessions/:sessionId/submissions/:submissionId` | ownership check | 查單筆 submission detail，包含 `sourceCode` 與 testcase results |
| GET | `/api/exam-sessions/:sessionId/result` | ownership check | 查 session result summary、每題最新狀態與分數 |

### Language

| Method | Path | 權限 | 說明 |
|--------|------|------|------|
| GET | `/api/languages` | 任一有效 JWT | 列出 `language_defaults.is_enabled = true` 的支援語言 |

`GET /api/problems/:id` 與 `GET /api/exam-sessions/:id/problems` 會回傳該題 `languageLimits`。沒有覆寫資料時，評測端應使用 `GET /api/languages` 回傳的全域預設倍率。

---

## 已完成實作重點

### Auth / RBAC

- `JWT_SECRET` 以 Zod 驗證至少 32 字元。
- 登入時查 `users`、`user_roles`、`role_permissions`、`permissions`，將權限碼放入 JWT payload。
- `authenticate` hook 驗證 Authorization Bearer token，失敗回 401。
- service 層負責權限與 ownership：superuser 直接放行；一般使用者依 permission 與資料歸屬限制。

### IAM

- superuser 可列出、建立、查詢、軟刪除使用者。
- `exam:manage` 可建立單一或批次 candidate，且不可建立 interviewer/problem_setter。
- candidate / interviewer / problem_setter 可查自己的 profile。
- 軟刪除使用者後不可再登入。

### Problem / Language

- `problem:manage` 可建立、更新、刪除題目與測資。
- 題目建立可同時寫入 `problem_testcases` 與 `problem_language_limits`。
- interviewer 可看題目與公開測資資訊，但 hidden testcase 的 `inputData` / `expectedOutput` 會被隱藏。
- 已被 `exam_session_problems` 引用的題目不可刪除，避免破壞歷史考試資料。
- Language API 已可列出 `cpp17`、`python3` 等 seed 語言；題目可設定語言倍率覆寫。

### Exam

- 支援手動派題與隨機派題。
- 隨機派題會排除同一 candidate 歷史考試已使用過的題目，也排除本場已抽中的題目。
- `list/get/problems` 依角色限制可見範圍：superuser 全部；interviewer 僅自己建立；candidate 僅自己的 session。
- candidate 可將 `not_started` session start 成 `in_progress`；重複 start 回 409。
- interviewer 可取消 exam session。

### Submission / Mock Judge

- candidate 只能對自己的 `in_progress` session submit；未開始、已取消、已提交或已過期 session 會回 409。
- 建立 submission 時會驗證 `examSessionProblemId` 屬於該 session，且 `language` 必須是 enabled language。
- Submission history / result 依 ownership 限制：superuser 可看全部；interviewer 只能看自己建立的 session；candidate 只能看自己的 session；problem_setter 不可查。
- 目前 mock judge 是 lazy progression：讀取 submission list/detail/result 時會推進同場 `pending → judging → done`。
- 同一題的第 1 / 2 / 3 次提交 mock verdict 依序為 `WA → TLE → AC`；完成評測時會寫入 per-testcase results、更新 `exam_session_problems.final_submission_id` / `score` 與 `exam_sessions.total_score`。
- Hidden testcase 的 `actualOutput` 不會出現在 API response；submission list/result summary 也不回傳 `sourceCode`，只有 detail endpoint 會回傳原始碼。

---

## 測試覆蓋現況

目前共有 5 個 test files、76 筆 integration tests。這些測試不是只驗證「happy path」，而是刻意依角色覆蓋 RBAC、ownership、資料隔離、錯誤狀態與關鍵業務規則。

| Test file | 測試數 | 覆蓋重點 |
|-----------|--------|----------|
| `auth.test.ts` | 6 | 登入成功/失敗、軟刪除帳號、body validation、未認證 401 |
| `users.test.ts` | 20 | superuser / interviewer / candidate 的 IAM 權限與軟刪除 |
| `problems.test.ts` | 25 | 題目 CRUD、測資 CRUD、hidden testcase sanitization、Language API、languageLimits |
| `exams.test.ts` | 20 | 手動/隨機派題、歷史題目排除、session visibility、start/cancel、session problems |
| `submissions.test.ts` | 5 | mock judge 狀態推進、submission history/result、source code visibility、RBAC/ownership、session 狀態 guard |

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
| IAM | 不可列出所有使用者，`GET /api/users` 回 403 |
| IAM | 可建立單一 candidate 帳號 |
| IAM | 建立使用者時省略 `roleNames` 會預設為 candidate |
| IAM | 嘗試建立 interviewer 角色帳號回 403 |
| IAM | 嘗試建立 problem_setter 角色帳號回 403 |
| IAM | 可批次建立 candidate 帳號 |
| IAM | 可查詢自己的 profile |
| IAM | 查詢他人 profile 回 403 |
| IAM | 嘗試刪除使用者回 403 |
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
| Submission | 多次讀取 detail / history / result 可觀察 mock judge 推進 `pending → judging → done` |
| Submission | 同一題前三次提交 verdict 依序為 `WA`、`TLE`、`AC`，第三次取得滿分 |
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
| Submission state transition | mock judge lazy 推進 `pending → judging → done` |
| Submission scoring | 最新提交寫入 `final_submission_id`，AC 給該題滿分，並更新 session `total_score` |
| Source code visibility | history / result 不回傳 `sourceCode`；detail 可供 candidate 本人與建立該 session 的 interviewer 查看 |
| Hidden testcase result safety | hidden testcase 不回傳 `actualOutput` |
| Submission guards | 未開始、取消、已提交、過期 session 皆不可提交；過期 session 會 lazy 標記為 `expired` |

測試會連到真實 PostgreSQL，並在每個 case 前 truncate 測試資料後重新 seed helper data。若本機 PostgreSQL 未啟動，`npm test` 會在連線 `127.0.0.1:5432` / `::1:5432` 時失敗。

---

## 剩餘工作

- 實作正式 Judge Worker / sandbox judging：取出待評測 submission、套用 language default / problem language override、執行沙箱、寫回 verdict 與 per-testcase results。
- 補上考試送出與逾時處理：`in_progress` → `submitted`，以及 cron/lazy update 策略。
- 補齊前端：登入、面試主管管理、出題、考試作答、結果頁。
- 規劃正式 migration 流程：目前已有 init SQL 與 Drizzle schema，後續需要版本化 migration 策略。

---

## Verification

1. 啟動 PostgreSQL：
   ```bash
   docker compose up -d postgres
   ```
2. 確認 backend type check：
   ```bash
   cd backend
   npm run lint
   ```
3. 執行 integration tests：
   ```bash
   cd backend
   npm test
   ```
   預期為 5 個 test files、76 tests passed。若 PostgreSQL 未啟動，會出現 `ECONNREFUSED 127.0.0.1:5432` 或 `ECONNREFUSED ::1:5432`。
4. 啟動服務後可用 seed 帳號登入：
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"Test@1234"}'
   ```
5. 取得 token 後測試題目或語言 API：
   ```bash
   curl -H 'Authorization: Bearer <token>' http://localhost:3000/api/problems
   curl -H 'Authorization: Bearer <token>' http://localhost:3000/api/languages
   ```
