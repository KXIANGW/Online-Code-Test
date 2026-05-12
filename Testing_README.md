# 測試指南 (Testing Guide)

本文件整合所有 component 的測試流程：環境建置、Frontend、Backend、Worker、Database。每個 component 分「自動測試」與「手動測試案例」兩節，手動測試案例提供一條快速驗證環境是否正常的完整流程。

所有指令皆從 repo 根目錄執行。

---

## 0. 前置需求

| 工具 | 說明 |
|------|------|
| Docker Engine >= 24 + Docker Compose v2 | 所有服務容器化 |
| Node.js 20+ 與 npm | Backend / Worker 自動測試 |
| `curl` + `jq` | Backend / Worker 手動測試 API 呼叫 |
| `wscat` | Worker 手動測試 WebSocket 連線（`npm install -g wscat`）|
| `psql` client（選用）| Database 手動測試；若無，可改用 `docker compose exec postgres psql ...` |

---

## 1. 測試模式與 Container 狀態

請先決定你要跑哪一種測試。不同測試模式需要的 container 不同；不要一律全開，否則 E2E 可能會被 compose 裡的 `worker` 搶走 RabbitMQ queue。

| 目的 | 需要開的 container | 不要開的 container | 指令入口 |
|------|-------------------|--------------------|----------|
| Backend 一般自動測試 | `postgres` | `rabbitmq`、`backend`、`worker`、`frontend` | `cd backend && npm test` |
| Worker 自動測試 | `postgres`（跑 DB integration 時） | `backend`、`worker`、`frontend` | `cd worker && npm test` |
| Backend + Worker E2E | `postgres`、`rabbitmq` | `backend`、`worker`、`frontend` | `cd backend && npm run test:e2e` |
| 手動測試 | `postgres`、`rabbitmq`、`backend`、`worker`、`frontend` | 無 | `make up` 後用 curl / frontend 操作 |
| Database 手動檢查 | `postgres` | 其他都不需要 | `make psql` |

建議心法：

- 跑自動測試前，先用 `docker compose down -v` 清掉舊資料與舊 container，讓結果可重現。
- 跑 E2E 時，只開 `postgres rabbitmq`。E2E 會在測試程序內自己啟動 backend app 與 worker consumer。
- 跑手動測試時，才全開完整 stack。
- 如果你剛跑完手動測試又要跑 E2E，請先關掉完整 stack，或至少停掉 `backend worker frontend`。

### 1.1 推薦執行順序

從乾淨狀態完整驗證一次，建議照這個順序：

```bash
# 1. Backend 一般自動測試：只開 postgres
docker compose down -v
docker compose up -d postgres
cd backend
npm install
TEST_DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct npm test
npm run lint
cd ..

# 2. Worker 自動測試：仍只需要 postgres
cd worker
npm install
TEST_DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct npm test
npm run lint
cd ..

# 3. Backend + Worker E2E：重置後只開 postgres + rabbitmq
docker compose down -v
make sandbox-images
docker compose up -d postgres rabbitmq
cd backend
TEST_DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct \
SANDBOX_RUNTIME=runc \
npm run test:e2e
cd ..

# 4. 手動測試：重置後全開完整 stack
docker compose down -v
make sandbox-images
make up
make ps
```

如果只想跑其中一種測試，直接跳到對應章節即可。

### 1.2 完整手動測試環境

完整堆疊是給手動測試用的，包含 postgres + rabbitmq + backend + worker + frontend：

```bash
cp .env.example .env
make sandbox-images   # 建立 oj-sandbox-cpp / oj-sandbox-python 沙箱 image
make up               # docker compose up -d --build
make ps               # 確認所有服務健康
```

預期看到五個服務全部 healthy/running：`postgres`、`rabbitmq`、`backend`、`worker`、`frontend`。

**服務入口**：

| 服務 | 入口 |
|------|------|
| 前端 | <http://localhost:5173> |
| 後端 API | <http://localhost:3000/api/health> |
| RabbitMQ Management UI | <http://localhost:15672>（帳號 `oct` / 密碼 `oct_dev_password`）|
| PostgreSQL | `localhost:5432` |

> 本機沒有 gVisor 時，在 `.env` 設定 `SANDBOX_RUNTIME=runc`（僅供本機開發，不提供 gVisor 隔離效果）。

**常用 Makefile 指令**：

```bash
make bootstrap       # 產生 .env
make sandbox-images  # 建立沙箱 image
make up              # 啟動服務
make ps              # 查看服務狀態
make logs            # 追蹤所有服務 log
make down            # 停止服務（保留 volumes）
make clean           # 停止服務並刪除 volumes
make rebuild         # clean + up
make psql            # 進入 psql shell
```

---

## 2. 測試帳號

以下帳號由 `infra/postgres/10-scenarios.sql` 建立，供所有手動測試使用。

| 帳號 | 密碼 | 角色 |
|------|------|------|
| `root` | `Root@1234` | superuser |
| `alice` | `Test@1234` | interviewer |
| `bob` | `Test@1234` | interviewer + problem_setter |
| `carol` | `Test@1234` | problem_setter |
| `candidate_20260509_001` | `Cand@1234` | candidate（David Chang）|
| `candidate_20260509_002` | `Cand@1234` | candidate（Emma Lin）|
| `candidate_20260509_003` | `Cand@1234` | candidate（Frank Wu）|
| `candidate_20260509_004` | `Cand@1234` | candidate（Grace Lee）|
| `candidate_20260509_005` | `Cand@1234` | candidate（Henry Huang）|

---

## 3. Frontend 測試

### 3.1 自動測試

> **目前尚未實作，待 M3 補充。**
>
> 預計加入：Vitest + React Testing Library 元件測試、E2E 測試（Playwright 或 Cypress）。

### 3.2 手動測試案例

> **目前尚未實作，待 M3 補充。**
>
> 預計加入：登入流程、考試列表、題目瀏覽、程式碼提交、即時判題結果顯示。

---

## 4. Backend 測試

Backend 測試分三種：

- 一般自動測試：只需要 `postgres` container，不需要 RabbitMQ、backend container、worker container。
- E2E async judge：只需要 `postgres` + `rabbitmq` containers，不要開 compose 的 `backend` / `worker` / `frontend`。
- 手動測試：需要完整 stack 全開。

### 4.1 自動測試

#### Step 1：清掉舊資料，只啟動 PostgreSQL

```bash
docker compose down -v
docker compose up -d postgres
docker compose ps
```

OK 條件：

- `postgres` 狀態為 `healthy`。
- `backend`、`worker`、`frontend` 沒有 running。一般 backend tests 會用 `app.inject()` 在測試程序內跑 backend，不需要 backend container。

#### Step 2：安裝依賴

```bash
cd backend && npm install && cd ..
```

#### Step 3：TypeScript type check

```bash
cd backend && npm run lint && cd ..
```

OK 條件：結尾沒有 TypeScript error。

#### Step 4：Integration tests（99 tests）

```bash
cd backend
TEST_DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct npm test
cd ..
```

若未設定 `TEST_DATABASE_URL`，測試會 fallback 使用 `DATABASE_URL`。這批測試會連到真實 PostgreSQL，並直接驗證 API 對 DB 欄位、FK/unique/check constraint、RBAC 與 worker result 寫入後狀態的整合行為。

OK 條件：

```text
Test Files  6 passed (6)
Tests       99 passed (99)
```

若看到 `ECONNREFUSED 127.0.0.1:5432`、`connect EPERM localhost:5432`，或其他 PostgreSQL 連線錯誤，回到 Step 1 確認 PostgreSQL 狀態與 `TEST_DATABASE_URL` / `DATABASE_URL`。

一般 `npm test` 不會執行 `src/__e2e__`，因為 E2E 需要 RabbitMQ、sandbox images、較長 timeout，請用下一節的 `npm run test:e2e` 單獨執行。

### 4.1.1 End-to-End async judge tests

這批測試會連真實 PostgreSQL、RabbitMQ，並在測試程序內啟動 backend app、backend judge result consumer、worker judge consumer；提交會真的進 `judge.tasks` queue，worker 會用 Docker sandbox 跑 `oj-sandbox-python` / `oj-sandbox-cpp`，再寫回 PostgreSQL。

#### Step 1：清掉舊資料，只啟動 PostgreSQL + RabbitMQ

請不要讓 compose 裡的 `worker` 同時消費 queue，否則 FIFO / pending / worker restart 相關 E2E 會不穩。最穩定的做法是先完整關掉再只開基礎服務：

```bash
docker compose down -v
make sandbox-images
docker compose up -d postgres rabbitmq
docker compose ps
```

OK 條件：

- `postgres` 狀態為 `healthy`。
- `rabbitmq` 狀態為 `healthy`。
- `backend`、`worker`、`frontend` 沒有 running。

如果你不想刪 volume，也可以用下面方式從完整 stack 切到 E2E 模式：

```bash
docker compose stop backend worker frontend
docker compose up -d postgres rabbitmq
docker compose ps
```

#### Step 2：執行 E2E

```bash
cd backend
TEST_DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct \
SANDBOX_RUNTIME=runc \
npm run test:e2e
cd ..
```

OK 條件：

```text
Test Files  1 passed (1)
Tests       10 passed (10)
```

目前涵蓋：

- 從 API 建立全新的 interviewer、problem setter、四位 candidate。
- problem setter 建立 3 題，每題含 public 與 hidden testcase。
- interviewer 建立多個 3 題 session，考試時間 3 分鐘。
- candidate 情境：一次滿分、多次提交後滿分、三題全錯、只對一題。
- 每個 session 的 3 題都送進 RabbitMQ，由 worker 跑 sandbox 後回寫結果。
- interviewer 與 candidate 都能透過 API 查看 final result。
- 兩位 candidate 近乎同時提交時，慢任務 judging 期間，後提交任務仍維持 pending；完成時間也符合 worker `prefetch(1)` 的一筆一筆處理順序。
- simple submission 不會更新 formal score 或 final submission。
- formal AC 後再 formal WA，最後分數會歸零且 final submission 會更新到最新 formal。
- session 過期後拒絕提交，result status 會標成 `expired`。
- 另一位 interviewer 不能查看非自己建立的 session result。
- sandbox verdict 覆蓋 `TLE`、`RE`、C++ `CE`。
- worker 暫停消費時任務會留在 RabbitMQ，worker 重啟後仍能處理 pending submission。

若看到這個錯誤：

```text
Expected 0 judge.tasks consumer(s) before starting the in-process E2E worker, but found 1.
Stop any external worker first, for example: docker compose stop worker
```

代表 compose 的 `worker` 或其他 worker process 還在消費 RabbitMQ。請執行：

```bash
docker compose stop worker
npm run test:e2e
```

---

### 4.2 手動測試：完整環境驗證流程

手動測試需要完整 stack 全開。因為前面的自動測試會清空資料，開始手動測試前請重建 scenario data：

```bash
docker compose down -v
make sandbox-images
make up
make ps
```

OK 條件：`postgres`、`rabbitmq`、`backend`、`worker`、`frontend` 全部 healthy/running。

以下所有指令從 repo 根目錄執行。

#### Health Check

```bash
curl -s http://localhost:3000/api/health | jq .
```

OK 條件：`"status": "ok"`。

#### 登入取得 Token

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

echo "$ROOT_TOKEN" | awk -F. '{print NF}'
```

OK 條件：輸出為 `3`（JWT 三段式格式）。

#### RBAC 驗證

```bash
# superuser 可列使用者
curl -s http://localhost:3000/api/users \
  -H "Authorization: Bearer $ROOT_TOKEN" | jq 'length'
# OK: 輸出 >= 9

# interviewer 不可列全部使用者
curl -s http://localhost:3000/api/users \
  -H "Authorization: Bearer $ALICE_TOKEN" | jq .statusCode
# OK: 403
```

#### 建立題目

```bash
PROBLEM_ID=$(curl -s -X POST http://localhost:3000/api/problems \
  -H "Authorization: Bearer $CAROL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Smoke Test Problem",
    "descriptionMd": "Print OK",
    "difficulty": "easy",
    "timeLimitMs": 1000,
    "memoryLimitMb": 128,
    "testcases": [
      {"orderIndex": 1, "isPublic": true, "inputData": "1 2", "expectedOutput": "3"},
      {"orderIndex": 2, "isPublic": false, "inputData": "10 20", "expectedOutput": "30"}
    ],
    "languageLimits": [
      {"language": "python3", "timeMultiplier": 3.0, "memoryMultiplier": 2.0}
    ]
  }' | jq -r .id)

echo "PROBLEM_ID=$PROBLEM_ID"
```

OK 條件：輸出是數字 id。

#### 建立 Exam Session 並開始

```bash
CANDIDATE_ID=$(curl -s http://localhost:3000/api/users \
  -H "Authorization: Bearer $ROOT_TOKEN" \
  | jq -r '.[] | select(.username=="candidate_20260509_001") | .id')

SESSION_ID=$(curl -s -X POST http://localhost:3000/api/exam-sessions \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"candidateId\": $CANDIDATE_ID,
    \"durationMinutes\": 90,
    \"problems\": [{\"problemId\": $PROBLEM_ID, \"scoreWeight\": 100, \"orderIndex\": 1}]
  }" | jq -r .id)

echo "SESSION_ID=$SESSION_ID"

# candidate 開始 session
curl -s -X POST "http://localhost:3000/api/exam-sessions/$SESSION_ID/start" \
  -H "Authorization: Bearer $CAND_TOKEN" | jq '{status, actualStartAt}'
```

OK 條件：`"status": "in_progress"`。

#### 提交程式碼（會由 Worker 判題）

```bash
ESP_ID=$(curl -s "http://localhost:3000/api/exam-sessions/$SESSION_ID/problems" \
  -H "Authorization: Bearer $CAND_TOKEN" | jq -r '.[0].id')

# Simple 提交
SUBMISSION_1=$(curl -s -X POST "http://localhost:3000/api/exam-sessions/$SESSION_ID/submissions" \
  -H "Authorization: Bearer $CAND_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"examSessionProblemId\": $ESP_ID,
    \"language\": \"python3\",
    \"sourceCode\": \"a,b=map(int,input().split()); print(a+b)\",
    \"type\": \"simple\"
  }" | jq -r .id)

echo "SUBMISSION_1=$SUBMISSION_1"
# OK: API 回傳 202，初始 status 為 pending；worker 會接著從 RabbitMQ 消費並判題
```

> 完整的 Worker + WebSocket + 判題結果驗證請接著執行第 5 節 Worker 手動測試。

---

## 5. Worker 測試

Worker 測試也分兩種：

- 自動測試：只需要 `postgres`。不需要 RabbitMQ，也不需要 compose 的 `worker` container。
- 手動測試：需要完整 stack，因為要真的從 backend 發任務、worker container 消費 RabbitMQ、sandbox 判題。

### 5.1 自動測試

Worker tests 覆蓋 compiler、runner、checker、consumer mock，以及 `db/queries` 的 PostgreSQL integration tests（17 tests）。RabbitMQ 不需要啟動；DB integration tests 需要 `TEST_DATABASE_URL` 或 `DATABASE_URL` 指向真實 PostgreSQL：

```bash
docker compose down -v
docker compose up -d postgres
cd worker
npm install
TEST_DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct npm test
npm run lint
cd ..
```

只想跑不碰 DB 的 worker unit tests 時，可指定非 integration 檔案：

```bash
cd worker
npm test -- src/engine src/consumers
cd ..
```

OK 條件：所有 tests passed，lint 無 error。

---

### 5.2 手動測試：完整環境驗證流程

確認完整 stack 已啟動（`make ps` 顯示全部 healthy）。如果你剛跑完自動測試，請先重建完整 stack：

```bash
docker compose down -v
make sandbox-images
make up
make ps
```

#### 確認 RabbitMQ queue 狀態

```bash
curl -u oct:oct_dev_password \
  http://localhost:15672/api/queues/%2F/judge.tasks | jq '{name, messages, consumers}'
```

OK 條件：`consumers` >= 1，`messages` 不會持續累積。

#### WebSocket 連線並訂閱 Session

```bash
# 取得 candidate JWT（使用已有 in_progress session 的帳號）
CAND_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"candidate_20260509_002","password":"Cand@1234"}' | jq -r .token)

echo "$CAND_TOKEN" | awk -F. '{print NF}'

# 連線 WebSocket（另開 terminal）
wscat -c "ws://localhost:3000/api/ws?token=$CAND_TOKEN"
```

連線後送出訂閱訊息：

```json
{"type":"subscribe","sessionId":2}
```

OK 條件：收到 `{"type":"subscribed","sessionId":2}`。判題完成後 server 推送 `judge_result`。

#### 取得 exam session problem id

```bash
ESP_ID=$(curl -s "http://localhost:3000/api/exam-sessions/2/problems" \
  -H "Authorization: Bearer $CAND_TOKEN" | jq -r '.[0].id')
```

#### Simple Python AC

```bash
curl -s -X POST http://localhost:3000/api/exam-sessions/2/submissions \
  -H "Authorization: Bearer $CAND_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"examSessionProblemId\": $ESP_ID,
    \"language\": \"python3\",
    \"sourceCode\": \"n=int(input())\na,b=0,1\nfor _ in range(n): a,b=b,a+b\nprint(a)\",
    \"type\": \"simple\"
  }" | jq .
```

OK 條件：API 回傳 202，WebSocket 後續收到 `verdict: "AC"`，`GET /result` 正式分數不更新（simple 不計分）。

#### C++ Compile Error

```bash
curl -s -X POST http://localhost:3000/api/exam-sessions/2/submissions \
  -H "Authorization: Bearer $CAND_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"examSessionProblemId\": $ESP_ID,
    \"language\": \"cpp17\",
    \"sourceCode\": \"int main() { syntax error }\",
    \"type\": \"simple\"
  }" | jq .
```

OK 條件：WebSocket / detail 查詢看到 `verdict: "CE"`。

#### Python TLE

```bash
curl -s -X POST http://localhost:3000/api/exam-sessions/2/submissions \
  -H "Authorization: Bearer $CAND_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"examSessionProblemId\": $ESP_ID,
    \"language\": \"python3\",
    \"sourceCode\": \"while True: pass\",
    \"type\": \"simple\"
  }" | jq .
```

OK 條件：Worker timeout 後停止 container，`verdict: "TLE"`。

#### Formal Python AC（更新正式分數）

```bash
curl -s -X POST http://localhost:3000/api/exam-sessions/2/submissions \
  -H "Authorization: Bearer $CAND_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"examSessionProblemId\": $ESP_ID,
    \"language\": \"python3\",
    \"sourceCode\": \"n=int(input())\na,b=0,1\nfor _ in range(n): a,b=b,a+b\nprint(a)\",
    \"type\": \"formal\"
  }" | jq .

# 查詢分數
curl -s http://localhost:3000/api/exam-sessions/2/result \
  -H "Authorization: Bearer $CAND_TOKEN" | jq '{totalScore, problems}'
```

OK 條件：`verdict: "AC"` 後 `totalScore` 與該題 `score` 更新。Public testcase 有 `actualOutput`；hidden testcase 不回傳 `actualOutput`。

---

## 6. Database 測試

Database 手動測試只需要 PostgreSQL，不需要完整 stack。

### 6.1 自動測試

> **目前沒有純 SQL / per-column 的 Database unit tests。**
>
> Database schema、RBAC 規則、seed data 正確性目前由 **Backend integration tests**（第 4.1 節）與 **Worker DB integration tests**（第 5.1 節）覆蓋。這是本專案目前比較合理的做法：不為每個 DB 欄位寫孤立測試，而是透過 API/worker 流程證明重要欄位真的影響 Online Code Test 行為，例如 testcase order uniqueness、session problem uniqueness、language references、hidden testcase redaction、`output_limit_kb`、final submission FK 與 score 更新。
>
> 預計 M3 補充：獨立的 schema migration 驗證腳本。

---

### 6.2 手動測試：完整環境驗證流程

#### 啟動 PostgreSQL

```bash
docker compose down -v
docker compose up -d postgres
docker compose ps
```

OK 條件：`postgres` 狀態為 `healthy`。

#### 連線方式

```bash
# 進入 container psql
docker compose exec postgres psql -U oct -d oct

# 從 host 連線
psql "postgres://oct:oct_dev_password_change_me@localhost:5432/oct"

# 使用 Makefile
make psql
```

OK 條件：看到 `oct=#` prompt。

#### Schema 驗證：Tables 數量

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT count(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
"
```

OK 條件：`table_count = 13`。

#### Schema 驗證：Enum Types

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT typname FROM pg_type
WHERE typname IN (
  'difficulty_level','exam_status','submission_status',
  'verdict_type','testcase_verdict_type'
)
ORDER BY typname;
"
```

OK 條件：回傳 5 筆 enum type。

#### Schema 驗證：FK DEFERRABLE 設定

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT conname, condeferrable, condeferred
FROM pg_constraint
WHERE conrelid = 'exam_session_problems'::regclass
  AND conname LIKE '%final_submission%';
"
```

OK 條件：`condeferrable = t`，`condeferred = t`。

#### Seed Data 驗證

```bash
# Roles
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT name FROM roles ORDER BY name;
"
# OK: candidate, interviewer, problem_setter

# Permissions
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT code FROM permissions ORDER BY code;
"
# OK: exam:manage, exam:take, problem:manage（不應出現 user:manage）

# Language defaults
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT language, time_multiplier, memory_multiplier, is_enabled
FROM language_defaults ORDER BY language;
"
# OK: cpp17（1.00/1.00）、python3（3.00/2.00），兩者 is_enabled = t
```

#### Scenario Data 驗證：使用者

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT u.username, u.is_superuser,
       COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE u.deleted_at IS NULL
GROUP BY u.id ORDER BY u.id;
"
```

OK 條件：9 位使用者，`root` 的 `is_superuser = t`，`bob` 同時有 `interviewer` 與 `problem_setter`。

#### Scenario Data 驗證：題目與考試

```bash
# 題目難度分佈（easy:3, medium:3, hard:2）
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT difficulty, count(*) FROM problems
WHERE deleted_at IS NULL GROUP BY difficulty ORDER BY difficulty;
"

# Exam sessions 狀態（總數 6，含 not_started/in_progress/submitted/cancelled）
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT status, count(*) FROM exam_sessions GROUP BY status ORDER BY status;
"
```

#### Scenario Data 驗證：Frank Wu 提交情境

Frank Wu（`candidate_20260509_003`）的 submitted session：P1 Two Sum 三次提交最終 AC；P4 Binary Search 最終 WA；P7 Longest Common Subsequence 最終 CE。

```bash
# 提交記錄
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT p.title, s.id, s.status, s.verdict
FROM submissions s
JOIN exam_session_problems esp ON esp.id = s.exam_session_problem_id
JOIN exam_sessions es ON es.id = esp.exam_session_id
JOIN users u ON u.id = es.candidate_id
JOIN problems p ON p.id = esp.problem_id
WHERE u.username = 'candidate_20260509_003' AND es.status = 'submitted'
ORDER BY s.submitted_at;
"
# OK: 6 筆，status 都是 done

# 最終分數（total_score=30, max_score=100）
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT es.id, u.username, es.total_score, es.max_score
FROM exam_sessions es
JOIN users u ON u.id = es.candidate_id
WHERE u.username = 'candidate_20260509_003' AND es.status = 'submitted';
"
```

---

## 7. 關閉服務

停止服務並保留 DB volume：

```bash
docker compose down
```

完全清除（刪除 volumes）：

```bash
docker compose down -v
# 或使用 Makefile
make clean
```

確認：

```bash
docker compose ps
```

OK 條件：沒有 service 處於 running。

---

## 8. 常見問題

| 現象 | 原因 | 處理 |
|------|------|------|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL 未啟動或 port 不對 | `docker compose ps` 確認 postgres healthy |
| `JWT_SECRET validation failed` | Backend 啟動時沒帶 JWT_SECRET | 確認第 4.2 節啟動指令有帶 `JWT_SECRET=...` |
| `401 Unauthorized` | token 沒帶、格式錯或登入失敗 | 重新執行登入步驟取得新 token |
| `403 Forbidden` | 角色權限不足 | 換成符合權限的測試帳號（見第 2 節）|
| `409 Conflict` | 狀態不允許（如重複 start exam）| 查詢 session 狀態確認是否符合預期 |
| 修改 SQL 後資料沒有變 | 舊 volume 還在，init SQL 不重跑 | `docker compose down -v` 後重啟 postgres |
| `psql: command not found` | 本機沒有 psql | 改用 `docker compose exec postgres psql -U oct -d oct` |
| `unknown or invalid runtime name: runsc` | gVisor 未安裝 | 本機開發可在 `.env` 改 `SANDBOX_RUNTIME=runc` |
| Worker sandbox image not found | sandbox image 未建立 | 執行 `make sandbox-images` |
| `judge.tasks` messages 持續累積 | worker 消費異常 | `docker compose logs worker` 查看錯誤 |
| WebSocket 連線後沒收到判題結果 | 未送出 subscribe 訊息，或 JWT 無該 session 權限 | 確認已送 `{"type":"subscribe","sessionId":...}` |
| 想完全重建環境 | volumes 狀態不一致 | `make clean && make up`（會刪除所有 volumes）|
