# Database 驗證指南

本文件說明如何從零驗證 PostgreSQL 初始化腳本、seed data 與 scenario data。請一律從 repo 根目錄開始執行，流程包含：清掉舊資料、啟動 Docker Compose、確認 schema/seed/scenario、執行自動測試、手動查詢驗證、最後關閉 Docker Compose。

> Schema 設計細節請看 [Database_PLAN.md](./Database_PLAN.md)。本文件只放實際操作與驗證指令。

---

## 0. 前置需求

- Docker Engine + Docker Compose v2
- `psql` client（若本機沒有，可用 `docker compose exec postgres psql ...`）
- Node.js 20+ 與 npm（若要跑 backend integration tests）

所有指令都從 repo 根目錄執行：

```bash
cd /path/to/Online-Code-Test
```

---

## 1. 初始化腳本內容

PostgreSQL container 第一次建立 volume 時，會依檔名順序執行 `infra/postgres/` 下的 init scripts。

| 檔案 | 內容 |
|------|------|
| `00-extensions.sql` | pgcrypto extension |
| `01-enums.sql` | 5 個 enum type |
| `02-iam.sql` | IAM tables |
| `03-problems.sql` | Problem / language tables |
| `04-exam.sql` | Exam tables |
| `05-submissions.sql` | submissions |
| `06-str.sql` | submission_testcase_results |
| `07-alter-esp.sql` | 補上 exam_session_problems → submissions 的循環 FK |
| `08-indexes.sql` | 查詢索引 |
| `09-seed.sql` | 靜態資料：roles、permissions、role_permissions、language_defaults |
| `10-scenarios.sql` | 測試情境：users、problems、exam sessions、submissions |

---

## 2. 清掉舊資料

這一步會停止 compose services 並刪除 Postgres volume。要驗證 init scripts 是否正確，一定要先做這步，否則 Docker 會沿用舊 volume，不會重跑初始化 SQL。

```bash
docker compose down -v
```

OK 條件：

```bash
docker compose ps
```

- 沒有 service 還在 running。
- 下一步啟動 postgres 時會重新建立 `oct_pgdata` volume。

---

## 3. 啟動 PostgreSQL

```bash
docker compose up -d postgres
```

確認狀態：

```bash
docker compose ps
```

OK 條件：
- `postgres` 狀態為 `healthy`。
- 預設 host port 是 `5432`。

如果狀態還是 `starting`，等幾秒再執行：

```bash
docker compose ps
```

---

## 4. 連線方式

### 4.1 進入 container psql

```bash
docker compose exec postgres psql -U oct -d oct
```

### 4.2 從 host 連線

```bash
psql "postgres://oct:oct_dev_password_change_me@localhost:5432/oct"
```

### 4.3 用 Makefile

```bash
make psql
```

OK 條件：
- 看到 `oct=#` prompt。

---

## 5. 手動測試：Schema 是否建立完成

以下指令可直接從 repo 根目錄執行，不需要進入互動式 psql。

### 5.1 確認 tables 數量

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT count(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE';
"
```

OK 條件：
- `table_count` 為 `13`。

### 5.2 確認 enum types

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT typname
FROM pg_type
WHERE typname IN (
  'difficulty_level',
  'exam_status',
  'submission_status',
  'verdict_type',
  'testcase_verdict_type'
)
ORDER BY typname;
"
```

OK 條件：
- 回傳 5 筆 enum type。

### 5.3 確認 FK / DEFERRABLE 設定

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT conname, condeferrable, condeferred
FROM pg_constraint
WHERE conrelid = 'exam_session_problems'::regclass
  AND conname LIKE '%final_submission%';
"
```

OK 條件：
- `condeferrable` 是 `t`。
- `condeferred` 是 `t`。

---

## 6. 手動測試：Seed Data

### 6.1 roles

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT name FROM roles ORDER BY name;
"
```

OK 條件：
- 回傳 `candidate`、`interviewer`、`problem_setter`。

### 6.2 permissions

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT code FROM permissions ORDER BY code;
"
```

OK 條件：
- 回傳 `exam:manage`、`exam:take`、`problem:manage`。
- 不應出現 `user:manage`。

### 6.3 language defaults

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT language, display_name, time_multiplier, memory_multiplier, is_enabled
FROM language_defaults
ORDER BY language;
"
```

OK 條件：
- `cpp17` 存在，倍率為 `1.00 / 1.00`。
- `python3` 存在，倍率為 `3.00 / 2.00`。
- 兩者 `is_enabled` 都是 `t`。

---

## 7. 手動測試：Scenario Data

### 7.1 使用者數量與角色

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT u.username, u.display_name, u.is_superuser,
       COALESCE(array_agg(r.name ORDER BY r.name)
         FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE u.deleted_at IS NULL
GROUP BY u.id
ORDER BY u.id;
"
```

OK 條件：
- 共 9 位使用者。
- `root` 的 `is_superuser` 是 `t`。
- `bob` 同時有 `interviewer` 與 `problem_setter`。
- 5 位 candidate 帳號名稱為 `candidate_20260509_001` 到 `candidate_20260509_005`。

### 7.2 題目數量與難度分佈

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT difficulty, count(*)
FROM problems
WHERE deleted_at IS NULL
GROUP BY difficulty
ORDER BY difficulty;
"
```

OK 條件：
- easy：3 題。
- medium：3 題。
- hard：2 題。

### 7.3 Exam sessions 狀態

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT status, count(*)
FROM exam_sessions
GROUP BY status
ORDER BY status;
"
```

OK 條件：
- 總數為 6 場。
- 至少包含 `not_started`、`in_progress`、`submitted`、`cancelled`。

### 7.4 Henry 重考題目不重複

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT esp.problem_id, count(*)
FROM exam_session_problems esp
JOIN exam_sessions es ON es.id = esp.exam_session_id
JOIN users u ON u.id = es.candidate_id
WHERE u.username = 'candidate_20260509_005'
GROUP BY esp.problem_id
HAVING count(*) > 1;
"
```

OK 條件：
- 回傳 0 rows，代表 Henry 的重考題目沒有重複。

### 7.5 Frank 的最後提交結果

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT esp.order_index, p.title, esp.score_weight, esp.score,
       COALESCE(s.verdict::text, 'no_submission') AS verdict,
       s.language
FROM exam_session_problems esp
JOIN problems p ON p.id = esp.problem_id
JOIN exam_sessions es ON es.id = esp.exam_session_id
JOIN users u ON u.id = es.candidate_id
LEFT JOIN submissions s ON s.id = esp.final_submission_id
WHERE u.username = 'candidate_20260509_003'
ORDER BY esp.order_index;
"
```

OK 條件：
- 回傳 3 題。
- Two Sum 最終 verdict 為 `AC`。
- 另外可看到 WA / CE 等非 AC 結果，用來驗證提交情境完整。

---

## 8. 自動測試：Backend Integration Tests

Database 的主要自動驗證目前由 backend integration tests 覆蓋，測試會實際連 PostgreSQL 並驗證 auth、RBAC、題目、語言、考試流程，以及 Submission API 的 DB 寫入、mock judge 結果與分數一致性。

```bash
cd backend
npm install
DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct npm test
cd ..
```

OK 條件：

```text
Test Files  5 passed (5)
Tests       76 passed (76)
```

若看到 `ECONNREFUSED 127.0.0.1:5432`，請回到第 3 步確認 `postgres` 是否 healthy。

---

## 9. 手動測試：Scenario Submission Data

這一節直接驗證 `10-scenarios.sql` 內建的 submission 情境，不依賴 Backend API README 或任何 shell 變數。固定使用 Frank Wu（`candidate_20260509_003`）的 submitted session：P1 Two Sum 有 3 次提交，最終 AC；P4 Binary Search 最終 WA；P7 Longest Common Subsequence 最終 CE。

### 9.1 submissions 狀態與 verdict

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT esp.order_index,
       p.title,
       s.id,
       s.language,
       s.status,
       s.verdict,
       s.runtime_ms,
       s.memory_kb
FROM submissions s
JOIN exam_session_problems esp ON esp.id = s.exam_session_problem_id
JOIN exam_sessions es ON es.id = esp.exam_session_id
JOIN users u ON u.id = es.candidate_id
JOIN problems p ON p.id = esp.problem_id
WHERE u.username = 'candidate_20260509_003'
  AND es.status = 'submitted'
ORDER BY s.submitted_at, s.id;
"
```

OK 條件：
- 回傳 6 筆。
- `status` 都是 `done`。
- Two Sum 依序有 `WA`、`TLE`、`AC` 三次提交。
- Binary Search 最終為 `WA`，Longest Common Subsequence 最終為 `RE`、`CE`。

### 9.2 testcase results 的 public / hidden output

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
WITH target_submission AS (
  SELECT esp.final_submission_id AS submission_id
  FROM exam_session_problems esp
  JOIN exam_sessions es ON es.id = esp.exam_session_id
  JOIN users u ON u.id = es.candidate_id
  JOIN problems p ON p.id = esp.problem_id
  WHERE u.username = 'candidate_20260509_003'
    AND es.status = 'submitted'
    AND p.title = 'Two Sum'
)
SELECT pt.order_index, pt.is_public, str.verdict, str.actual_output
FROM submission_testcase_results str
JOIN problem_testcases pt ON pt.id = str.testcase_id
JOIN target_submission ts ON ts.submission_id = str.submission_id
ORDER BY pt.order_index;
"
```

OK 條件：
- 回傳 Two Sum final AC submission 的 3 筆 testcase results。
- public testcases 的 `actual_output` 有值。
- hidden testcase 的 `actual_output` 是空值，避免洩漏隱藏測資輸出。

### 9.3 final submission 與單題分數

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT esp.order_index,
       p.title,
       esp.score_weight,
       esp.score,
       esp.final_submission_id,
       s.verdict AS final_verdict
FROM exam_session_problems esp
JOIN exam_sessions es ON es.id = esp.exam_session_id
JOIN users u ON u.id = es.candidate_id
JOIN problems p ON p.id = esp.problem_id
LEFT JOIN submissions s ON s.id = esp.final_submission_id
WHERE u.username = 'candidate_20260509_003'
  AND es.status = 'submitted'
ORDER BY esp.order_index;
"
```

OK 條件：
- 回傳 3 題。
- Two Sum 的 `final_verdict` 是 `AC`，`score` 是 `30`。
- Binary Search 的 `final_verdict` 是 `WA`，`score` 是 `0`。
- Longest Common Subsequence 的 `final_verdict` 是 `CE`，`score` 是 `0`。

### 9.4 session 總分

```bash
docker compose exec -T postgres psql -U oct -d oct -c "
SELECT es.id, u.username, es.status, es.total_score, es.max_score
FROM exam_sessions es
JOIN users u ON u.id = es.candidate_id
WHERE u.username = 'candidate_20260509_003'
  AND es.status = 'submitted';
"
```

OK 條件：
- `total_score` 是 `30`。
- `max_score` 是 `100`。

---

## 10. 測試帳號

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

## 11. 測完後關閉 Docker Compose

保留 DB volume，只停止 container：

```bash
docker compose down
```

完全清乾淨，連 DB volume 一起刪除：

```bash
docker compose down -v
```

確認：

```bash
docker compose ps
```

OK 條件：
- 沒有 service 處於 running。

---

## 12. 常見問題

| 現象 | 原因 | 處理 |
|------|------|------|
| 修改 SQL 後資料沒有變 | 舊 volume 還在，init SQL 不會重跑 | `docker compose down -v` 後重啟 postgres |
| `psql: command not found` | 本機沒有 psql | 使用 `docker compose exec postgres psql -U oct -d oct` |
| `connection refused` | PostgreSQL 未啟動或 port 不對 | `docker compose ps` 確認 healthy 與 port mapping |
| 查不到 seed data | init scripts 沒重跑或啟動失敗 | `docker compose logs postgres` 檢查初始化錯誤 |
| backend tests 連不到 DB | `DATABASE_URL` 指向錯誤 host/port | 本機測試使用 `localhost:5432` |
