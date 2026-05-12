# Database — Online Code Test

## 目前狀態

所有資料統一存於單一 PostgreSQL 實例，依模組邏輯切分 table，未來拆微服務時邊界清楚。M1 已完成 init SQL（00–10）、Drizzle ORM schema 對齊、seed data 與 scenario data；M2 新增 `submission_type` 欄位（11）。`backend/src/db/schema.ts` 已對應所有 tables 與 enums。

---

## 目錄結構

```text
infra/postgres/
├── 00-extensions.sql     # 啟用 PostgreSQL extensions（如 pgcrypto）
├── 01-enums.sql          # 所有 ENUM type 定義（difficulty_level、exam_status 等）
├── 02-iam.sql            # IAM 模組：users、roles、permissions、user_roles、role_permissions
├── 03-problems.sql       # Problem 模組：problems、problem_testcases、language_defaults、problem_language_limits
├── 04-exam.sql           # Exam 模組：exam_sessions、exam_session_problems（FK 僅正向）
├── 05-submissions.sql    # Submission 模組：submissions 主表
├── 06-str.sql            # submission_testcase_results 表（per-testcase 結果）
├── 07-alter-esp.sql      # ALTER exam_session_problems：加入 final_submission_id FK（循環 FK 需分開建）
├── 08-indexes.sql        # 所有額外 index（PK/UNIQUE 之外）
├── 09-seed.sql           # 靜態參考資料：roles、permissions、role_permissions、language_defaults
├── 10-scenarios.sql      # 情境測試資料：9 使用者、8 題、6 場考試、多筆 submission
└── 11-submission-type.sql # M2 migration：新增 submission_type enum 與 submissions 欄位
```

**設計邏輯：** 每支 SQL 腳本負責單一層次，按編號順序執行（後面的腳本可能依賴前面建立的 type 或 table）。`07-alter-esp.sql` 獨立出來是因為 `exam_session_problems.final_submission_id` 與 `submissions` 之間存在循環外鍵，必須在兩張表都存在後才能建立。

---

## Schema 參考

### Enum 定義

| Enum                    | 值                                                                | 說明                                                   |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| `difficulty_level`      | `easy`, `medium`, `hard`                                          | 題目難度                                               |
| `exam_status`           | `not_started`, `in_progress`, `submitted`, `expired`, `cancelled` | 考試 session 狀態機                                    |
| `submission_status`     | `pending`, `judging`, `done`, `system_error`                      | Submission 生命週期                                    |
| `verdict_type`          | `AC`, `WA`, `TLE`, `MLE`, `RE`, `CE`                              | Submission 整體評測結果                                |
| `testcase_verdict_type` | `AC`, `WA`, `TLE`, `MLE`, `RE`, `skipped`                         | 單筆測資結果（不含 CE，CE 為 submission 層級）         |
| `submission_type`       | `simple`, `formal`                                                | 提交類型：simple 僅跑公開測資，formal 跑全部並更新分數 |

### IAM 模組

| Table              | 用途                                                     |
| ------------------ | -------------------------------------------------------- |
| `users`            | 使用者主表，含 `is_superuser` flag 與軟刪除 `deleted_at` |
| `roles`            | 角色定義（interviewer、problem_setter、candidate）       |
| `permissions`      | 權限代碼（problem:manage、exam:manage、exam:take）       |
| `user_roles`       | 使用者 ↔ 角色 N:N 關聯                                   |
| `role_permissions` | 角色 ↔ 權限 N:N 關聯                                     |

**`users` 關鍵欄位：**

| 欄位            | 說明                                                          |
| --------------- | ------------------------------------------------------------- |
| `username`      | 登入帳號；批次匯入時由系統產生（如 `candidate_20260509_001`） |
| `password_hash` | bcrypt hash；明文密碼僅在建立當下回傳給面試主管，不儲存       |
| `is_superuser`  | Root 標記；service 層 RBAC 直接 short-circuit 放行            |
| `deleted_at`    | 軟刪除；查詢時 `WHERE deleted_at IS NULL`                     |

**角色與權限預設綁定：**

| 角色             | 權限             |
| ---------------- | ---------------- |
| `interviewer`    | `exam:manage`    |
| `problem_setter` | `problem:manage` |
| `candidate`      | `exam:take`      |

> Root 不在 roles 表中，以 `users.is_superuser=TRUE` 表示。ownership 規則（面試者只能看自己的資料）不進 RBAC，由 service 層業務邏輯處理。

### Problem 模組

| Table                     | 用途                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| `problems`                | 題目主表，含 Markdown 描述、難度、時間/記憶體/輸出限制，支援軟刪除 |
| `problem_testcases`       | 測資，一題多筆；區分 `is_public`（公開）與隱藏                     |
| `language_defaults`       | 全域語言倍率（cpp17 1.0x / python3 3.0x time, 2.0x memory）        |
| `problem_language_limits` | 題目層級的語言倍率覆寫；無 row 則用 `language_defaults` 預設值     |

**關鍵設計：**

- `time_limit_ms` / `memory_limit_mb` 為 C++ baseline；其他語言的有效限制 = baseline × 語言倍率
- `output_limit_kb` 預設 64KB，防止暴力輸出灌爆系統
- 已被 `exam_session_problems` 引用的題目不可刪除（回 409），避免破壞歷史考試資料

**`problem_testcases` 關鍵欄位：**

| 欄位          | 說明                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `order_index` | 同題內測資順序（從 1 開始）                                                                     |
| `is_public`   | TRUE = 面試者可看 input/expected output，失敗時可看 actual output；FALSE = 隱藏測資，僅用來判分 |

### Exam 模組

| Table                   | 用途                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| `exam_sessions`         | 某面試者的某次考試實例；每次重考都是新的 row                        |
| `exam_session_problems` | 考試中派的每一題，含 `score_weight`、`score`、`final_submission_id` |

**`exam_sessions` 狀態機：**

```
not_started ──[面試者點「開始考試」]──> in_progress
in_progress ──[面試者提交 / 時間到]──> submitted
not_started ──[面試主管取消]──────────> cancelled
in_progress ──[面試主管取消]──────────> cancelled
```

**`exam_session_problems` 關鍵欄位：**

| 欄位                  | 說明                                                       |
| --------------------- | ---------------------------------------------------------- |
| `score_weight`        | 這題在本場考試的滿分配額，派題時固定                       |
| `final_submission_id` | 指向「最後一次提交」；每次新提交評測完成後更新             |
| `score`               | 實際得分：全 AC（public + hidden）= `score_weight`，否則 0 |

**`DEFERRABLE INITIALLY DEFERRED` 設計：** `final_submission_id` 與 `submissions.exam_session_problem_id` 存在循環外鍵，DEFERRABLE 讓 transaction commit 時才檢查，避免新增 submission 時的順序問題。

### Submission 模組

| Table                         | 用途                                                                |
| ----------------------------- | ------------------------------------------------------------------- |
| `submissions`                 | 每次提交一筆，含 `submission_type`（simple/formal）與評測狀態       |
| `submission_testcase_results` | per-testcase 評測結果，`is_public=FALSE` 的 `actual_output` 存 NULL |

**`submissions` 關鍵欄位：**

| 欄位                       | 說明                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `exam_session_problem_id`  | 綁定到「哪場考試的哪題」（不直接綁 problem_id）               |
| `candidate_id`             | 冗餘欄位，避免每次 join 兩層；查詢個人歷史時很方便            |
| `submission_type`          | `simple`（public 測資）或 `formal`（全部測資，AC 才更新分數） |
| `verdict`                  | `status='done'` 時才有意義                                    |
| `runtime_ms` / `memory_kb` | 取所有測資中最大值                                            |

**不可變欄位（application 層強制）：** `exam_session_problem_id`、`candidate_id`、`language`、`source_code`、`submitted_at`；`status`、`verdict`、`runtime_ms`、`memory_kb`、`judged_at` 由 worker 寫入一次。

### Index 策略

| Index                                                                        | 主要查詢場景                               |
| ---------------------------------------------------------------------------- | ------------------------------------------ |
| `idx_users_deleted_at`（partial, `WHERE deleted_at IS NULL`）                | 查詢有效使用者                             |
| `idx_problems_difficulty`（partial, `WHERE deleted_at IS NULL`）             | 隨機派題按難度篩選                         |
| `idx_exam_sessions_candidate`（`candidate_id, created_at DESC`）             | 派題避重複：撈某面試者所有歷史 session     |
| `idx_submissions_esp`（`exam_session_problem_id, submitted_at DESC`）        | 查某題最後一次提交 / 提交歷史              |
| `idx_submissions_status`（partial, `WHERE status IN ('pending','judging')`） | Worker 撈待處理任務（作為 MQ 的 fallback） |

---

## 情境資料覆蓋

### 靜態參考資料（`09-seed.sql`）

| 類型 | 內容                                                                    |
| ---- | ----------------------------------------------------------------------- |
| 角色 | interviewer、problem_setter、candidate                                  |
| 權限 | problem:manage、exam:manage、exam:take                                  |
| 語言 | cpp17（C++17, 1.0x/1.0x）、python3（Python 3, 3.0x time / 2.0x memory） |

### 情境測試資料（`10-scenarios.sql`）

| 類型   | 內容                                                                                                                                | 可驗證的功能              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 使用者 | 9 位：`root`（superuser）、`alice`（interviewer）、`bob`（interviewer + problem_setter）、`carol`（problem_setter）、5 位 candidate | RBAC / 多角色             |
| 題庫   | 8 題，涵蓋 easy / medium / hard，含 public / hidden testcases                                                                       | 難度篩選、hidden 過濾     |
| 考試   | 6 場，涵蓋 `not_started`、`in_progress`、`submitted`、`cancelled`                                                                   | 狀態機覆蓋                |
| 提交   | 多次提交，含 AC / WA / TLE / CE 等 verdict 與 per-testcase results                                                                  | Mock judge 推進、分數計算 |
| 重考   | Henry 有兩場考試，題目不重複                                                                                                        | 隨機派題排除歷史題目      |

> `09-seed.sql` 只放靜態參考資料；使用者、題目、考試與提交情境集中在 `10-scenarios.sql`，方便未來拆成 dev / test seed。

### 測試角色資料

| username | password | role |
|---|---|---|
| `root` | `Root@1234` | superuser |
| `alice` | `Test@1234` | interviewer |
| `bob` | `Test@1234` | interviewer + problem_setter |
| `carol` | `Test@1234` | problem_setter |
| `candidate_20260509_001` | `Cand@1234` | candidate |
| `candidate_20260509_002` | `Cand@1234` | candidate |
| `candidate_20260509_003` | `Cand@1234` | candidate |
| `candidate_20260509_004` | `Cand@1234` | candidate |
| `candidate_20260509_005` | `Cand@1234` | candidate |

---

## 剩餘工作

- **版本化 migration 策略**：目前 00–11 SQL 是 init scripts（`docker-entrypoint-initdb.d/` 風格），生產環境需要可回滾的版本化 migration（如 Flyway、golang-migrate）。
- **考試過期處理**：`expired` 狀態目前保留但未啟用；需要 cron job 或 lazy update 將到期的 `in_progress` session 標記為 `submitted`。
- **未來 schema 演進**（視需求觸發）：
  - 測資搬到 MinIO/S3（`input_data` → object_key）
  - 程式碼搬到 MinIO（`source_code` → object_key）
  - 題目版本化（`exam_session_problems` FK 改到版本表）
  - 反作弊事件表（`anticheat_events`）
