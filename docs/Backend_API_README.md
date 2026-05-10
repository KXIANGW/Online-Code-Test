# Backend API 驗證指南

本文件是 Backend API 的完整驗證流程。請一律從 repo 根目錄開始執行，流程包含：清掉舊資料、啟動 PostgreSQL、執行自動測試、啟動本機 backend 做手動 API 測試、觀察結果、最後關閉 Docker Compose。

> 架構與設計細節請看 [Backend_API_PLAN.md](./Backend_API_PLAN.md)。本文件只放實際操作與驗證指令。

---

## 0. 前置需求

- Docker Engine + Docker Compose v2
- Node.js 20+
- npm
- `curl`
- `jq`（手動測試會用來解析 JSON）

所有指令都從 repo 根目錄執行：

```bash
cd /path/to/Online-Code-Test
```

---

## 1. 清掉舊資料

這一步會停止 compose services 並刪除 Postgres volume，確保 init SQL、seed data、scenario data 都從乾淨狀態重建。

```bash
docker compose down -v
```

觀察結果：

```bash
docker compose ps
```

OK 條件：
- 沒有任何 service 還在 running。
- 後續 `docker compose up -d postgres` 會重新建立 `oct_pgdata` volume。

---

## 2. 啟動 PostgreSQL

Backend integration tests 與本機 backend 都需要 PostgreSQL。先只啟動 `postgres` service：

```bash
docker compose up -d postgres
```

確認狀態：

```bash
docker compose ps
```

OK 條件：
- `postgres` 狀態為 `healthy`。
- port 顯示 `0.0.0.0:5432->5432/tcp`（若你在 `.env` 改過 `HOST_POSTGRES_PORT`，請以實際 port 為準）。

若還在 `starting`，等幾秒再查一次：

```bash
docker compose ps
```

---

## 3. 安裝 Backend 依賴

```bash
cd backend
npm install
cd ..
```

OK 條件：
- 指令結束時沒有 npm error。
- `backend/node_modules/` 已建立。

---

## 4. 自動測試

### 4.1 TypeScript type check

```bash
cd backend
npm run lint
cd ..
```

OK 條件：
- 結尾沒有 TypeScript error。
- 預期會看到：

```text
> @oct/backend@0.0.1 lint
> tsc --noEmit
```

### 4.2 Integration tests

測試會使用 PostgreSQL，並在每個 test case 前清理測試資料再重建 helper data。

```bash
cd backend
DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct npm test
cd ..
```

OK 條件：

```text
Test Files  4 passed (4)
Tests       71 passed (71)
```

如果看到 `ECONNREFUSED 127.0.0.1:5432` 或 `ECONNREFUSED ::1:5432`，代表 PostgreSQL 沒有啟動或 host port 不對。先回到第 2 步確認 `docker compose ps`。

### 4.3 重置 DB 給手動測試使用

Integration tests 會清掉 scenario data 並留下測試用資料。手動測試會使用 `10-scenarios.sql` 的固定帳號與考試情境，所以跑完自動測試後，請重新建立一次 Postgres volume：

```bash
docker compose down -v
docker compose up -d postgres
docker compose ps
```

OK 條件：
- `postgres` 回到 `healthy`。
- `root`、`alice`、`carol`、`candidate_20260509_001` 等 scenario 帳號會重新建立。

---

## 5. 手動測試：啟動本機 Backend

另開一個 terminal，從 repo 根目錄啟動 backend：

```bash
cd backend
DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct \
JWT_SECRET=my-super-secret-key-at-least-32-chars-long \
PORT=3000 \
NODE_ENV=development \
LOG_LEVEL=info \
npm run dev
```

OK 條件：
- backend process 持續 running。
- 沒有 `JWT_SECRET validation failed`。
- 沒有 database connection error。

> 下面的手動測試請在另一個 terminal 從 repo 根目錄執行。

---

## 6. 手動測試：Health Check

```bash
curl -s http://localhost:3000/api/health | jq .
```

OK 條件：

```json
{
  "status": "ok",
  "dbLatencyMs": 1,
  "uptimeSec": 10
}
```

`dbLatencyMs` 與 `uptimeSec` 的數字會依機器不同而改變。重點是 `status` 必須是 `ok`。

---

## 7. 手動測試：Auth / IAM

### 7.1 登入取得 token

```bash
ROOT_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"root","password":"Root@1234"}' | jq -r .token)

ALICE_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"Test@1234"}' | jq -r .token)

CAROL_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"carol","password":"Test@1234"}' | jq -r .token)

CAND_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"candidate_20260509_001","password":"Cand@1234"}' | jq -r .token)
```

觀察 token：

```bash
echo "$ROOT_TOKEN" | awk -F. '{print NF}'
```

OK 條件：
- 輸出為 `3`，代表 JWT 是三段式格式。

### 7.2 superuser 可列使用者

```bash
curl -s http://localhost:3000/api/users \
  -H "Authorization: Bearer $ROOT_TOKEN" | jq 'length'
```

OK 條件：
- 輸出大於或等於 `9`。

### 7.3 interviewer 不可列全部使用者

```bash
curl -s http://localhost:3000/api/users \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq .
```

OK 條件：

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "Forbidden"
}
```

---

## 8. 手動測試：Language / Problem

### 8.1 列出支援語言

```bash
curl -s http://localhost:3000/api/languages \
  -H "Authorization: Bearer $CAROL_TOKEN" | jq .
```

OK 條件：
- 回傳陣列包含 `cpp17` 與 `python3`。
- `python3` 的 `timeMultiplier` 預期為 `3.00`。

### 8.2 建立題目

```bash
PROBLEM_ID=$(curl -s -X POST http://localhost:3000/api/problems \
  -H "Authorization: Bearer $CAROL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "README Smoke Test",
    "descriptionMd": "Print OK",
    "difficulty": "easy",
    "timeLimitMs": 1000,
    "memoryLimitMb": 128,
    "testcases": [
      {"orderIndex": 1, "isPublic": true, "inputData": "", "expectedOutput": "OK"},
      {"orderIndex": 2, "isPublic": false, "inputData": "", "expectedOutput": "OK"}
    ],
    "languageLimits": [
      {"language": "python3", "timeMultiplier": 3.0, "memoryMultiplier": 2.0}
    ]
  }' | jq -r .id)

echo "$PROBLEM_ID"
```

OK 條件:
- 輸出是一個數字 id。

### 8.3 查詢題目 detail

```bash
curl -s "http://localhost:3000/api/problems/$PROBLEM_ID" \
  -H "Authorization: Bearer $CAROL_TOKEN" | jq '{id, title, testcases, languageLimits}'
```

OK 條件：
- `title` 是 `README Smoke Test`。
- `testcases` 有 2 筆。
- `languageLimits` 有 `python3`。

### 8.4 candidate 不可列題目

```bash
curl -s http://localhost:3000/api/problems \
  -H "Authorization: Bearer $CAND_TOKEN" | jq .
```

OK 條件：
- 回傳 `403 Forbidden`。

---

## 9. 手動測試：Exam

### 9.1 interviewer 建立手動派題 session

先查 candidate id：

```bash
CANDIDATE_ID=$(curl -s http://localhost:3000/api/users \
  -H "Authorization: Bearer $ROOT_TOKEN" \
  | jq -r '.[] | select(.username=="candidate_20260509_001") | .id')

echo "$CANDIDATE_ID"
```

建立 session：

```bash
SESSION_ID=$(curl -s -X POST http://localhost:3000/api/exam-sessions \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"candidateId\": $CANDIDATE_ID,
    \"durationMinutes\": 90,
    \"problems\": [
      {\"problemId\": $PROBLEM_ID, \"scoreWeight\": 100, \"orderIndex\": 1}
    ]
  }" | jq -r .id)

echo "$SESSION_ID"
```

OK 條件：
- 輸出是一個數字 session id。

### 9.2 candidate 查看自己的 sessions

```bash
curl -s http://localhost:3000/api/exam-sessions \
  -H "Authorization: Bearer $CAND_TOKEN" | jq 'map({id, candidateId, status, maxScore})'
```

OK 條件：
- 回傳陣列。
- 其中包含剛建立的 `SESSION_ID`。

### 9.3 candidate 開始新 session

```bash
curl -s -X POST "http://localhost:3000/api/exam-sessions/$SESSION_ID/start" \
  -H "Authorization: Bearer $CAND_TOKEN" | jq '{id, status, actualStartAt, expiresAt}'
```

OK 條件：
- `status` 是 `in_progress`。
- `actualStartAt` 與 `expiresAt` 不是 `null`。

### 9.4 重複 start 應回 409

```bash
curl -s -X POST "http://localhost:3000/api/exam-sessions/$SESSION_ID/start" \
  -H "Authorization: Bearer $CAND_TOKEN" | jq .
```

OK 條件：
- 回傳 `409 Conflict`。

### 9.5 查詢 session 題目

```bash
curl -s "http://localhost:3000/api/exam-sessions/$SESSION_ID/problems" \
  -H "Authorization: Bearer $CAND_TOKEN" | jq .
```

OK 條件：
- 回傳陣列長度為 `1`。
- 題目 title 是 `README Smoke Test`。
- 每題包含 `languageLimits` 欄位。

---

## 10. 測完後關閉 Docker Compose

先到啟動 backend 的 terminal 按 `Ctrl+C` 停止 `npm run dev`。

如果只想停止 container、保留 DB volume：

```bash
docker compose down
```

如果想回到完全乾淨狀態，連 DB volume 一起刪除：

```bash
docker compose down -v
```

確認已停止：

```bash
docker compose ps
```

OK 條件：
- 沒有 service 處於 running。

---

## 11. 測試帳號

| 帳號 | 密碼 | 角色 |
|------|------|------|
| `root` | `Root@1234` | superuser |
| `alice` | `Test@1234` | interviewer |
| `bob` | `Test@1234` | interviewer + problem_setter |
| `carol` | `Test@1234` | problem_setter |
| `candidate_20260509_001` | `Cand@1234` | candidate（David Chang） |
| `candidate_20260509_002` | `Cand@1234` | candidate（Emma Lin） |
| `candidate_20260509_003` | `Cand@1234` | candidate（Frank Wu） |
| `candidate_20260509_004` | `Cand@1234` | candidate（Grace Lee） |
| `candidate_20260509_005` | `Cand@1234` | candidate（Henry Huang） |

---

## 12. 常見問題

| 現象 | 原因 | 處理 |
|------|------|------|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL 未啟動或 port 不對 | 回到第 2 步確認 `docker compose ps` |
| `JWT_SECRET validation failed` | 啟動 backend 時沒有設定 JWT secret | 確認第 5 步有帶 `JWT_SECRET=...` |
| `401 Unauthorized` | token 沒帶、格式錯或登入失敗 | 重新執行第 7.1 步取得 token |
| `403 Forbidden` | 角色權限不足 | 換成符合權限的測試帳號 |
| `409 Conflict` | 狀態不允許，例如重複 start exam | 查詢 session 狀態確認是否符合預期 |
