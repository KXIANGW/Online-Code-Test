# Database 使用指南

本目錄包含 Online Code Test 的資料庫初始化腳本（按字母序自動執行）：

| 檔案 | 內容 |
|------|------|
| `00-extensions.sql` | pgcrypto 擴充 |
| `01-enums.sql` | 5 個 custom enum type |
| `02-iam.sql` | IAM 模組（users, roles, permissions, user_roles, role_permissions） |
| `03-problems.sql` | Problem 模組（language_defaults, problems, problem_testcases, problem_language_limits） |
| `04-exam.sql` | Exam 模組（exam_sessions, exam_session_problems，暫無循環 FK） |
| `05-submissions.sql` | submissions |
| `06-str.sql` | submission_testcase_results |
| `07-alter-esp.sql` | 補上 exam_session_problems ↔ submissions 循環 FK（DEFERRABLE） |
| `08-indexes.sql` | 16 個查詢索引 |
| `09-seed.sql` | 靜態參考資料（roles, permissions, language_defaults） |
| `10-scenarios.sql` | 完整測試情境（9 位使用者、8 題、6 場考試） |

資料庫 Schema 設計規格詳見 [Database_PLAN.md](./Database_PLAN.md)。

---

## 連線方式

```bash
# 方法 1：Makefile（最簡單，需先 make up）
make psql

# 方法 2：直接從 host 連（預設 port 5432）
psql "postgres://oct:oct_dev_password_change_me@localhost:5432/oct"

# 方法 3：進入容器內
docker exec -it oct-postgres-1 psql -U oct -d oct
```

## 首次啟動 / 重置資料庫

Init SQL 只在 **volume 為空時**執行一次。若要重置全部資料：

```bash
make clean   # 停容器並刪除 oct_pgdata volume
make up      # 重建並重跑全部 init SQL + seed + scenarios
```

或等效的：

```bash
docker compose down -v && docker compose up -d --build
```

## 測試帳號

| 帳號 | 密碼 | 角色 |
|------|------|------|
| `root` | `Root@1234` | superuser（所有操作直接放行） |
| `alice` | `Test@1234` | interviewer |
| `bob` | `Test@1234` | interviewer + problem_setter |
| `carol` | `Test@1234` | problem_setter |
| `candidate_20260509_001` | `Cand@1234` | candidate（David Chang） |
| `candidate_20260509_002` | `Cand@1234` | candidate（Emma Lin） |
| `candidate_20260509_003` | `Cand@1234` | candidate（Frank Wu） |
| `candidate_20260509_004` | `Cand@1234` | candidate（Grace Lee） |
| `candidate_20260509_005` | `Cand@1234` | candidate（Henry Huang） |

驗證密碼（在 psql 內執行）：

```sql
SELECT username FROM users
WHERE username = 'root'
  AND password_hash = crypt('Root@1234', password_hash);
-- 應回傳 1 筆
```

## 測試情境總覽

| Session | 面試者 | 狀態 | 題目 | 總分 | 說明 |
|---------|--------|------|------|------|------|
| 1 | David (001) | `not_started` | P1+P4+P7 | 0/100 | 已派題，未開始 |
| 2 | Emma (002) | `in_progress` | P2+P5+P8 | 0/90 | 40 分鐘前開始，90 分鐘限制 |
| 3 | Frank (003) | `submitted` | P1+P4+P7 | 30/100 | P1=AC(3次提交)、P4=WA、P7=CE |
| 4 | Grace (004) | `cancelled` | P3+P6+P8 | 0/90 | 面試主管取消 |
| 5 | Henry (005) | `submitted` | P2+P5+P6 | 60/90 | 第一場，P2=AC、P5=WA、P6=AC |
| 6 | Henry (005) | `submitted` | P1+P4+P7 | 70/100 | 重考（與 Session 5 題目不重複） |

> Session 5 用了 P2/P5/P6；Session 6 改用 P1/P4/P7 → 可驗證「派題避重複」邏輯。

## 常用查詢範例

```sql
-- 1. 查所有使用者和其角色
SELECT u.username, u.display_name, u.is_superuser,
       array_agg(r.name) AS roles
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r       ON r.id = ur.role_id
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.username, u.display_name, u.is_superuser
ORDER BY u.id;

-- 2. 查 Henry 的所有考試歷史（驗證 retake 保留）
SELECT es.id, es.status, es.total_score, es.max_score,
       es.actual_start_at, es.created_at
FROM exam_sessions es
JOIN users u ON u.id = es.candidate_id
WHERE u.username = 'candidate_20260509_005'
ORDER BY es.created_at;

-- 3. 查 Frank (Session 3) 的題目和最終提交結果
SELECT esp.order_index, p.title, p.difficulty,
       esp.score_weight, esp.score,
       s.verdict, s.runtime_ms, s.language
FROM exam_session_problems esp
JOIN problems p           ON p.id = esp.problem_id
LEFT JOIN submissions s   ON s.id = esp.final_submission_id
JOIN exam_sessions es     ON es.id = esp.exam_session_id
JOIN users u              ON u.id = es.candidate_id
WHERE u.username = 'candidate_20260509_003'
ORDER BY esp.order_index;

-- 4. 查 Frank 在 P1 的所有提交歷史（3 次：WA→TLE→AC）
SELECT s.id, s.verdict, s.runtime_ms, s.submitted_at, s.language
FROM submissions s
JOIN exam_session_problems esp ON esp.id = s.exam_session_problem_id
JOIN problems p                ON p.id = esp.problem_id
JOIN users u                   ON u.id = s.candidate_id
WHERE u.username = 'candidate_20260509_003'
  AND p.title = 'Two Sum'
ORDER BY s.submitted_at;

-- 5. 查 Frank P1 最終 AC 提交的 per-testcase 結果
--    （公開測資有 actual_output，隱藏測資為 NULL）
SELECT tc.order_index, tc.is_public, str.verdict,
       str.runtime_ms, str.actual_output
FROM submission_testcase_results str
JOIN problem_testcases tc ON tc.id = str.testcase_id
WHERE str.submission_id = (
  SELECT esp.final_submission_id
  FROM exam_session_problems esp
  JOIN exam_sessions es ON es.id = esp.exam_session_id
  JOIN users u          ON u.id = es.candidate_id
  JOIN problems p       ON p.id = esp.problem_id
  WHERE u.username = 'candidate_20260509_003'
    AND p.title = 'Two Sum'
)
ORDER BY tc.order_index;

-- 6. 驗證 Henry 重考題目不重複（應回傳 0 筆）
SELECT esp.problem_id, count(*)
FROM exam_session_problems esp
JOIN exam_sessions es ON es.id = esp.exam_session_id
JOIN users u          ON u.id = es.candidate_id
WHERE u.username = 'candidate_20260509_005'
GROUP BY esp.problem_id
HAVING count(*) > 1;

-- 7. 計算語言有效 time limit（P8 python3 有覆寫倍率）
SELECT p.title, p.time_limit_ms,
       COALESCE(pll.time_multiplier, ld.time_multiplier) AS multiplier,
       (p.time_limit_ms * COALESCE(pll.time_multiplier, ld.time_multiplier))::int AS effective_ms
FROM problems p
JOIN language_defaults ld ON ld.language = 'python3'
LEFT JOIN problem_language_limits pll
  ON pll.problem_id = p.id AND pll.language = 'python3'
WHERE p.title = 'Coin Change';

-- 8. 題目難度分佈
SELECT difficulty, count(*)
FROM problems WHERE deleted_at IS NULL
GROUP BY difficulty ORDER BY difficulty;

-- 9. 面試主管查看「由自己建立的面試者」每題答題狀況與最終成績
--    範例：bob 創建了 Frank (session 3) 和 Henry (session 5)
SELECT
  u_c.username                        AS candidate,
  u_c.display_name                    AS name,
  es.id                               AS session_id,
  es.status                           AS session_status,
  es.total_score || '/' || es.max_score AS total,
  esp.order_index,
  p.title                             AS problem,
  p.difficulty,
  esp.score_weight,
  esp.score                           AS score_earned,
  COALESCE(s.verdict::text, '（未提交）') AS verdict
FROM exam_sessions es
JOIN users u_interviewer ON u_interviewer.id = es.created_by
JOIN users u_c           ON u_c.id = es.candidate_id
JOIN exam_session_problems esp ON esp.exam_session_id = es.id
JOIN problems p                ON p.id = esp.problem_id
LEFT JOIN submissions s        ON s.id = esp.final_submission_id
WHERE u_interviewer.username = 'bob'   -- 換成其他面試主管帳號即可
ORDER BY es.id, esp.order_index;
```
