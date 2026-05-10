# Database Plan — Online Code Test (Team 12)

本文件為 Online Code Test 系統的資料庫實作規劃與目前狀態說明。所有資料統一存於單一 PostgreSQL 實例，依模組邏輯切分 table，未來拆微服務時邊界清楚。

目前 database M1 已完成 init SQL、Drizzle schema、seed data 與 scenario data：`infra/postgres/00-extensions.sql` 到 `10-scenarios.sql` 可建立完整 schema、靜態參考資料與測試情境；`backend/src/db/schema.ts` 已對應主要 tables/enums。`10-scenarios.sql` 目前包含 9 位使用者、8 題、6 場考試與 submission / testcase result 測試資料，可支援 Backend API integration tests、Submission API mock judge 與後續 Judge Worker 開發。

## 目錄

1. [設計原則與整體決策](#1-設計原則與整體決策)
2. [Schema 總覽](#2-schema-總覽)
3. [Enum 定義](#3-enum-定義)
4. [IAM 模組](#4-iam-模組)
5. [Problem 模組](#5-problem-模組)
6. [Exam 模組](#6-exam-模組)
7. [Submission 模組](#7-submission-模組)
8. [Index 策略](#8-index-策略)
9. [Seed Data](#9-seed-data)
10. [核心業務流程](#10-核心業務流程)
11. [實作建議與注意事項](#11-實作建議與注意事項)

---

## 1. 設計原則與整體決策

### 1.1 全域決策

| 項目 | 決策 |
|---|---|
| 資料庫 | PostgreSQL（單一實例，邏輯分區） |
| ID 型別 | `BIGSERIAL`（自增 8-byte 整數） |
| 時間欄位 | `TIMESTAMPTZ`（一律存 UTC，前端轉時區） |
| 軟刪除 | `users` / `problems` 加 `deleted_at`，其餘表先不做 |
| 字串長度 | 短字串用 `VARCHAR(N)`，長文本用 `TEXT` |
| 密碼存儲 | bcrypt hash（`password_hash` 欄位） |
| RBAC enforcement | Service 層（每個 service function 自行檢查） |
| 字符集 | UTF-8 |

### 1.2 模組邊界

| 模組 | 職責 | Tables |
|---|---|---|
| IAM | 帳號、角色、權限 | `users`, `roles`, `permissions`, `user_roles`, `role_permissions` |
| Problem | 題目與測資 | `problems`, `problem_testcases`, `language_defaults`, `problem_language_limits` |
| Exam | 考試實例與派題 | `exam_sessions`, `exam_session_problems` |
| Submission | 提交與評測結果 | `submissions`, `submission_testcase_results` |

### 1.3 已確定的核心業務規則

- **角色**：Root（superuser flag）、面試主管、出題主管、面試者；一人可同時是多種角色（user_roles 多對多）
- **權限粒度**：粗顆粒（目前 seed `problem:manage`、`exam:manage`、`exam:take`；Root 透過 `is_superuser` 直接放行）
- **題目**：不版本化、難度三級 enum、測資存 PG `TEXT`、區分公開/隱藏
- **考試**：無「考卷模板」概念，每場考試都是獨立 session；題數預設 3 題但可彈性調整；難度組合自由（不強制 easy/medium/hard 各一）
- **派題**：建帳號時派好（手動或隨機），同一面試者所有歷史考試題目不重複，本場考試內題目也不重複
- **計分**：全 AC（公開+隱藏全過）才給該題滿分，否則 0 分；考試總分 = 各題得分總和
- **最終分數規則**：以最後一次提交為準（不取最高分）
- **歷史保留**：重考時保留所有歷史 sessions，不覆蓋

---

## 2. Schema 總覽

```
IAM 模組
├── users (使用者主表)
├── roles (角色定義)
├── permissions (權限定義)
├── user_roles (使用者-角色 N:N)
└── role_permissions (角色-權限 N:N)

Problem 模組
├── problems (題目主表)
├── problem_testcases (測資)
├── language_defaults (語言預設倍率)
└── problem_language_limits (題目語言倍率覆寫)

Exam 模組
├── exam_sessions (考試實例)
└── exam_session_problems (考試派題)

Submission 模組
├── submissions (提交紀錄)
└── submission_testcase_results (per-testcase 評測結果)
```

---

## 3. Enum 定義

統一在 schema 開頭建立，後續 table 引用：

```sql
-- 題目難度
CREATE TYPE difficulty_level AS ENUM ('easy', 'medium', 'hard');

-- 考試狀態
CREATE TYPE exam_status AS ENUM (
  'not_started',  -- 已派題,面試者尚未點開始
  'in_progress',  -- 面試者已點開始,正在作答
  'submitted',    -- 面試者主動提交或時間到自動提交
  'expired',      -- 已過期但尚未處理(保留欄位,實務上等同 submitted)
  'cancelled'     -- 面試主管手動取消
);

-- 提交生命週期狀態
CREATE TYPE submission_status AS ENUM (
  'pending',      -- 已建立紀錄,等待 worker 處理
  'judging',      -- worker 正在執行
  'done',         -- 評測完成(verdict 此時才有意義)
  'system_error'  -- 系統錯誤(沙箱故障、worker crash 等)
);

-- 評測結果
CREATE TYPE verdict_type AS ENUM (
  'AC',  -- Accepted
  'WA',  -- Wrong Answer
  'TLE', -- Time Limit Exceeded
  'MLE', -- Memory Limit Exceeded
  'RE',  -- Runtime Error
  'CE'   -- Compile Error
);

-- 單筆測資的評測結果(submission_testcase_results 用)
-- 不會出現 CE(編譯錯誤是 submission 層級的)
CREATE TYPE testcase_verdict_type AS ENUM (
  'AC', 'WA', 'TLE', 'MLE', 'RE', 'skipped'
);
```

---

## 4. IAM 模組

### 4.1 users

使用者主表,儲存所有角色的帳號資料。

```sql
CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  username        VARCHAR(64)  NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  display_name    VARCHAR(128),
  is_superuser    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
```

**欄位說明**

| 欄位 | 說明 |
|---|---|
| `username` | 登入帳號;批次匯入面試者時由系統產生(例如 `candidate_20260509_001`) |
| `password_hash` | bcrypt hash;明文密碼僅在建立當下回傳給面試主管,不儲存 |
| `display_name` | 顯示名稱,可為真實姓名;批次匯入時可為空 |
| `is_superuser` | Root 標記;為 `TRUE` 時 service 層 RBAC 檢查直接 short-circuit 放行 |
| `deleted_at` | 軟刪除;查詢時 WHERE `deleted_at IS NULL` |

### 4.2 roles

角色定義表。預期內容固定且不多,初期 seed 三筆,未來新增角色時 INSERT。

```sql
CREATE TABLE roles (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Seed 內容**(見第 9 節)

| name | 說明 |
|---|---|
| `interviewer` | 面試主管 |
| `problem_setter` | 出題主管 |
| `candidate` | 面試者 |

> Root 不在 roles 表中,以 `users.is_superuser=TRUE` 表示。

### 4.3 permissions

權限定義表。採粗顆粒設計。

```sql
CREATE TABLE permissions (
  id          BIGSERIAL PRIMARY KEY,
  code        VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Seed 內容**

| code | 說明 |
|---|---|
| `problem:manage` | 建立、編輯、刪除題目與測資 |
| `exam:manage` | 建立面試者帳號、派題、查看所有面試者結果 |
| `exam:take` | 參加考試、提交程式碼、查看自己的結果 |

> 「面試者只能看自己的東西」這類 ownership 規則**不進 RBAC**,由 service 層業務邏輯處理(例如 query 自動加 `WHERE candidate_id = current_user.id`)。

### 4.4 user_roles

使用者與角色的 N:N 關聯。

```sql
CREATE TABLE user_roles (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id      BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);
```

### 4.5 role_permissions

角色與權限的 N:N 關聯。

```sql
CREATE TABLE role_permissions (
  role_id        BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id  BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
```

**初始綁定**

| role | permissions |
|---|---|
| `interviewer` | `exam:manage` |
| `problem_setter` | `problem:manage` |
| `candidate` | `exam:take` |

---

## 5. Problem 模組

### 5.1 problems

題目主表。

```sql
CREATE TABLE problems (
  id               BIGSERIAL PRIMARY KEY,
  title            VARCHAR(255)     NOT NULL,
  description_md   TEXT             NOT NULL,
  difficulty       difficulty_level NOT NULL,
  time_limit_ms    INT              NOT NULL CHECK (time_limit_ms > 0),
  memory_limit_mb  INT              NOT NULL CHECK (memory_limit_mb > 0),
  output_limit_kb  INT              NOT NULL DEFAULT 64 CHECK (output_limit_kb > 0),
  created_by       BIGINT           NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);
```

**欄位說明**

| 欄位 | 說明 |
|---|---|
| `description_md` | Markdown 格式,前端 render |
| `time_limit_ms` | C++ baseline 執行時間上限,其他語言依倍率調整 |
| `memory_limit_mb` | C++ baseline 記憶體上限,其他語言依倍率調整 |
| `output_limit_kb` | 輸出大小上限,預設 64KB,防止暴力輸出灌爆系統 |
| `created_by` | 出題者 user_id |
| `deleted_at` | 軟刪除;有 submission 引用的題目不可硬刪 |

### 5.2 problem_testcases

題目的測資,一題多筆。

```sql
CREATE TABLE problem_testcases (
  id               BIGSERIAL PRIMARY KEY,
  problem_id       BIGINT  NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  order_index      INT     NOT NULL,
  is_public        BOOLEAN NOT NULL DEFAULT FALSE,
  input_data       TEXT    NOT NULL,
  expected_output  TEXT    NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (problem_id, order_index)
);
```

**欄位說明**

| 欄位 | 說明 |
|---|---|
| `order_index` | 同題內測資順序,從 1 開始 |
| `is_public` | `TRUE` = 公開測資,面試者可看到 input、expected output,提交後失敗時可看到 actual output;`FALSE` = 隱藏測資,只用來判分 |
| `input_data` / `expected_output` | 直接存 TEXT,MVP 不做物件儲存遷移 |

### 5.3 language_defaults

支援語言的全域預設倍率。新增語言只要 INSERT 一筆。

```sql
CREATE TABLE language_defaults (
  language           VARCHAR(32) PRIMARY KEY,
  display_name       VARCHAR(64) NOT NULL,
  time_multiplier    NUMERIC(4,2) NOT NULL DEFAULT 1.0 CHECK (time_multiplier > 0),
  memory_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.0 CHECK (memory_multiplier > 0),
  is_enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Seed 內容**

| language | display_name | time_multiplier | memory_multiplier |
|---|---|---|---|
| `cpp17` | C++17 | 1.0 | 1.0 |
| `python3` | Python 3 | 3.0 | 2.0 |

未來加 Java、Rust 只需:

```sql
INSERT INTO language_defaults (language, display_name, time_multiplier, memory_multiplier)
VALUES ('java17', 'Java 17', 2.0, 1.5),
       ('rust', 'Rust', 1.0, 1.0);
```

### 5.4 problem_language_limits

題目對特定語言的倍率覆寫。**沒有 row 就用 `language_defaults` 的預設值**。

```sql
CREATE TABLE problem_language_limits (
  problem_id         BIGINT      NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  language           VARCHAR(32) NOT NULL REFERENCES language_defaults(language),
  time_multiplier    NUMERIC(4,2) NOT NULL CHECK (time_multiplier > 0),
  memory_multiplier  NUMERIC(4,2) NOT NULL CHECK (memory_multiplier > 0),
  PRIMARY KEY (problem_id, language)
);
```

**使用時的計算邏輯**(在 worker 或 service 層做):

```
effective_time_limit = problem.time_limit_ms 
                       × COALESCE(problem_language_limits.time_multiplier,
                                  language_defaults.time_multiplier)
```

---

## 6. Exam 模組

### 6.1 exam_sessions

某面試者的某次考試實例。每次重考都是新的 row。

```sql
CREATE TABLE exam_sessions (
  id                BIGSERIAL    PRIMARY KEY,
  candidate_id      BIGINT       NOT NULL REFERENCES users(id),
  created_by        BIGINT       NOT NULL REFERENCES users(id),
  status            exam_status  NOT NULL DEFAULT 'not_started',
  duration_minutes  INT          NOT NULL CHECK (duration_minutes > 0),
  actual_start_at   TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  total_score       INT          NOT NULL DEFAULT 0,
  max_score         INT          NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**欄位說明**

| 欄位 | 說明 |
|---|---|
| `candidate_id` | 哪個面試者要考這場 |
| `created_by` | 哪個面試主管派的 |
| `status` | 狀態機,流程見下 |
| `duration_minutes` | 派題時設定;面試主管決定這場考多久 |
| `actual_start_at` | 面試者點「開始考試」時才寫入,之前為 NULL |
| `expires_at` | `actual_start_at + duration_minutes`,後端統一計算 |
| `total_score` | cache 累計得分,每筆 submission 評測完更新 |
| `max_score` | 這場考試的滿分(= 所有 exam_session_problems.score_weight 之和),派題完成時固定 |

**狀態機流轉**

```
not_started ──[面試者點「開始考試」]──> in_progress
in_progress ──[面試者主動提交 / 時間到]──> submitted
not_started ──[面試主管取消]──> cancelled
in_progress ──[面試主管取消]──> cancelled
```

> `expired` 狀態保留但實務上 not_started/in_progress 過了截止時間就直接 transition 到 submitted,由 cron job 或下次查詢時的 lazy update 處理。

### 6.2 exam_session_problems

考試中派的每一題,核心關聯表。

```sql
CREATE TABLE exam_session_problems (
  id                   BIGSERIAL PRIMARY KEY,
  exam_session_id      BIGINT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  problem_id           BIGINT NOT NULL REFERENCES problems(id),
  order_index          INT    NOT NULL,
  score_weight         INT    NOT NULL CHECK (score_weight >= 0),
  final_submission_id  BIGINT REFERENCES submissions(id) DEFERRABLE INITIALLY DEFERRED,
  score                INT    NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_session_id, order_index),
  UNIQUE (exam_session_id, problem_id)
);
```

**欄位說明**

| 欄位 | 說明 |
|---|---|
| `order_index` | 題目顯示順序,所有面試者一致(從 1 開始) |
| `score_weight` | 這題在這場考試的滿分配額,派題時設定 |
| `final_submission_id` | 指向「最後一次提交」的 submission;每次新提交評測完成後更新 |
| `score` | 這題的實際得分,`0` 或 `score_weight`(全 AC 給滿分,否則 0) |

**`UNIQUE (exam_session_id, problem_id)` 確保**:同一場考試不會派到重複題目。

**`final_submission_id` 的 `DEFERRABLE INITIALLY DEFERRED`**:因為 `submissions.exam_session_problem_id` 也指向回來,兩邊有循環 FK,DEFERRABLE 讓 transaction commit 時才檢查,避免新增 submission 時的順序問題。

---

## 7. Submission 模組

### 7.1 submissions

每次面試者按「提交」就建立一筆。

```sql
CREATE TABLE submissions (
  id                       BIGSERIAL          PRIMARY KEY,
  exam_session_problem_id  BIGINT             NOT NULL REFERENCES exam_session_problems(id) ON DELETE CASCADE,
  candidate_id             BIGINT             NOT NULL REFERENCES users(id),
  language                 VARCHAR(32)        NOT NULL REFERENCES language_defaults(language),
  source_code              TEXT               NOT NULL,
  status                   submission_status  NOT NULL DEFAULT 'pending',
  verdict                  verdict_type,
  runtime_ms               INT,
  memory_kb                INT,
  submitted_at             TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  judged_at                TIMESTAMPTZ
);
```

**欄位說明**

| 欄位 | 說明 |
|---|---|
| `exam_session_problem_id` | 綁定到「哪場考試的哪題」(不直接綁 problem_id) |
| `candidate_id` | 冗餘欄位,避免每次 join 兩層;查詢個人歷史時很方便 |
| `language` | 提交語言 |
| `source_code` | 程式碼,直接存 TEXT |
| `status` | 生命週期狀態 |
| `verdict` | 評測結果;`status='done'` 時才有意義 |
| `runtime_ms` | 取所有測資中執行時間最大值 |
| `memory_kb` | 取所有測資中記憶體用量最大值 |
| `submitted_at` | 提交時間,immutable |
| `judged_at` | 評測完成時間 |

**Immutability 慣例**

由 application 層強制(不靠 DB trigger):
- 不可變欄位:`exam_session_problem_id`、`candidate_id`、`language`、`source_code`、`submitted_at`
- 可變欄位:`status`、`verdict`、`runtime_ms`、`memory_kb`、`judged_at`(由 worker 寫入一次)

### 7.2 submission_testcase_results

per-testcase 評測結果。

```sql
CREATE TABLE submission_testcase_results (
  id              BIGSERIAL              PRIMARY KEY,
  submission_id   BIGINT                 NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  testcase_id     BIGINT                 NOT NULL REFERENCES problem_testcases(id),
  verdict         testcase_verdict_type  NOT NULL,
  runtime_ms      INT,
  memory_kb       INT,
  actual_output   TEXT,
  created_at      TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, testcase_id)
);
```

**欄位說明**

| 欄位 | 說明 |
|---|---|
| `verdict` | 該筆測資的結果;`skipped` 用於前面測資已掛、後面短路不跑的情境 |
| `actual_output` | **僅當對應 testcase `is_public=TRUE` 時才存**;隱藏測資此欄為 NULL,節省空間並避免敏感資料外洩風險 |

**actual_output 寫入邏輯(worker 實作時注意)**

```python
if testcase.is_public:
    actual_output = captured_output[:OUTPUT_DISPLAY_LIMIT]  # 額外截斷上限
else:
    actual_output = None
```

---

## 8. Index 策略

除了 PK / UNIQUE 自帶的 index,額外建立:

```sql
-- IAM
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

-- Problem
CREATE INDEX idx_problems_difficulty ON problems(difficulty) WHERE deleted_at IS NULL;
CREATE INDEX idx_problems_created_by ON problems(created_by);
CREATE INDEX idx_problem_testcases_problem ON problem_testcases(problem_id, order_index);

-- Exam
CREATE INDEX idx_exam_sessions_candidate ON exam_sessions(candidate_id, created_at DESC);
CREATE INDEX idx_exam_sessions_created_by ON exam_sessions(created_by);
CREATE INDEX idx_exam_sessions_status ON exam_sessions(status);
CREATE INDEX idx_esp_session ON exam_session_problems(exam_session_id, order_index);
CREATE INDEX idx_esp_problem ON exam_session_problems(problem_id);

-- Submission
CREATE INDEX idx_submissions_esp ON submissions(exam_session_problem_id, submitted_at DESC);
CREATE INDEX idx_submissions_candidate ON submissions(candidate_id, submitted_at DESC);
CREATE INDEX idx_submissions_status ON submissions(status) WHERE status IN ('pending', 'judging');
CREATE INDEX idx_str_submission ON submission_testcase_results(submission_id);
```

**Index 設計理由**

| Index | 主要查詢場景 |
|---|---|
| `idx_problems_difficulty` | 派題隨機抽題:`WHERE difficulty = 'easy' AND deleted_at IS NULL` |
| `idx_exam_sessions_candidate` | 派題避重複:撈出某面試者的所有歷史 sessions |
| `idx_submissions_esp` | 查某題的最後一次提交 / 提交歷史 |
| `idx_submissions_status` (partial) | Worker 撈待處理任務(雖然用 MQ 但作為 fallback 查詢) |

---

## 9. Seed Data

系統初始化時必須執行的資料填充。

```sql
-- 角色
INSERT INTO roles (name, description) VALUES
  ('interviewer',    '面試主管:建立面試者帳號、派題、查看結果'),
  ('problem_setter', '出題主管:建立與管理題目'),
  ('candidate',      '面試者:參加考試');

-- 權限
INSERT INTO permissions (code, description) VALUES
  ('problem:manage', '建立、編輯、刪除題目與測資'),
  ('exam:manage',    '建立面試者帳號、派題、查看所有面試者結果'),
  ('exam:take',      '參加考試、提交程式碼、查看自己的結果');

-- 角色權限綁定
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE (r.name = 'interviewer'    AND p.code = 'exam:manage')
   OR (r.name = 'problem_setter' AND p.code = 'problem:manage')
   OR (r.name = 'candidate'      AND p.code = 'exam:take');

-- 語言預設
INSERT INTO language_defaults (language, display_name, time_multiplier, memory_multiplier) VALUES
  ('cpp17',   'C++17',    1.0, 1.0),
  ('python3', 'Python 3', 3.0, 2.0);

-- Root 帳號(密碼請從環境變數讀取後 bcrypt hash)
-- INSERT INTO users (username, password_hash, display_name, is_superuser)
-- VALUES ('root', '$2b$12$...', 'System Root', TRUE);
```

### 9.1 Scenario Data

`infra/postgres/10-scenarios.sql` 目前提供完整測試情境，不屬於靜態參考資料，主要給本機開發、API integration tests、Submission API mock judge 與後續 Judge Worker 驗證使用。

| 類型 | 目前內容 |
|---|---|
| 使用者 | 9 位：`root`、`alice`、`bob`、`carol`、5 位 candidate |
| 角色組合 | `root` 為 superuser；`alice` interviewer；`bob` interviewer + problem_setter；`carol` problem_setter；candidate 皆為 `exam:take` |
| 題庫 | 8 題，涵蓋 easy / medium / hard 與 public / hidden testcases |
| 考試 | 6 場 sessions，涵蓋 `not_started`、`in_progress`、`submitted`、`cancelled` |
| 提交 | 含多次提交、最後提交為準、AC/WA/TLE/CE 等 verdict 與 per-testcase results |
| 重考 | Henry 的兩場考試題目不重複，可驗證隨機派題避開歷史題目 |

> `09-seed.sql` 只放 roles、permissions、role_permissions、language_defaults 這類靜態資料；使用者、題目、考試與提交情境集中在 `10-scenarios.sql`，方便未來拆成 dev/test seed。

---

## 10. 核心業務流程

以下是幾個最關鍵的業務流程在 DB 操作上的具體展開,實作時遵循這個模式。

### 10.1 批次建立面試者帳號

```
BEGIN TRANSACTION
  FOR EACH row IN 上傳的 CSV/Excel:
    1. 產生隨機密碼 → bcrypt hash
    2. INSERT INTO users (username, password_hash, display_name)
    3. INSERT INTO user_roles (user_id, role_id=candidate)
COMMIT

回傳明文密碼一次給面試主管下載(之後系統不留)
```

### 10.2 派題(手動模式)

```
BEGIN TRANSACTION
  1. INSERT INTO exam_sessions (candidate_id, created_by, duration_minutes, status='not_started')
     RETURNING id
  
  2. 對每一題:
     INSERT INTO exam_session_problems 
       (exam_session_id, problem_id, order_index, score_weight)
  
  3. UPDATE exam_sessions 
       SET max_score = SUM(score_weight)
       WHERE id = ?
COMMIT
```

### 10.3 派題(隨機模式)— 避重複邏輯

```sql
-- Step 1: 查該面試者所有歷史用過的 problem_id
WITH used_problems AS (
  SELECT DISTINCT esp.problem_id
  FROM exam_session_problems esp
  JOIN exam_sessions es ON es.id = esp.exam_session_id
  WHERE es.candidate_id = :candidate_id
)
-- Step 2: 隨機抽 N 題,排除歷史 + 排除已抽中
SELECT id FROM problems
WHERE difficulty = :target_difficulty
  AND deleted_at IS NULL
  AND id NOT IN (SELECT problem_id FROM used_problems)
  AND id NOT IN (:already_picked_in_this_session)
ORDER BY RANDOM()
LIMIT 1;
```

> 若隨機抽不到(題庫不足),回傳錯誤給面試主管,提示需要先擴充題庫。

### 10.4 面試者點「開始考試」

```sql
UPDATE exam_sessions
SET status          = 'in_progress',
    actual_start_at = NOW(),
    expires_at      = NOW() + (duration_minutes || ' minutes')::INTERVAL,
    updated_at      = NOW()
WHERE id = :session_id
  AND candidate_id = :current_user_id  -- ownership check
  AND status = 'not_started';
```

### 10.5 提交程式碼

目前 Backend API 已實作 Submission API 的 mock judge 版：API 會先新增 `pending` submission，後續讀取 submission list/detail/result 時 lazy 推進 `pending → judging → done`，並在完成時寫回 testcase results、`final_submission_id`、題目分數與 session 總分。正式 Judge Worker 上線後，步驟 3 會改由 RabbitMQ / worker 接手。

```
1. 驗證:
   - exam_session.status = 'in_progress'
   - NOW() < exam_session.expires_at
   - exam_session_problem 屬於這個 candidate

2. INSERT INTO submissions 
     (exam_session_problem_id, candidate_id, language, source_code, status='pending')
   RETURNING id

3. 目前 mock judge:
   - 查詢 submission list/detail/result 時推進 pending → judging → done
   - 同題第 1 / 2 / 3 次提交 mock verdict 依序為 WA / TLE / AC
   - 完成時直接寫回 submission_testcase_results 與分數相關欄位

   未來正式 worker:
   - 將 submission_id 推入 RabbitMQ judge.tasks queue

4. 回傳 202 Accepted + submission_id 給前端
```

### 10.6 評測完成回寫(Worker → DB)

這是最重要的流程,必須在單一 transaction 內完成,確保 final_submission_id 與 score 一致。目前 mock judge 已照這個資料寫入模式更新 DB；未來正式 Worker / sandbox judging 也應沿用同一個 transaction 邊界。

```
BEGIN TRANSACTION

  1. UPDATE submissions
       SET status = 'done',
           verdict = :overall_verdict,
           runtime_ms = :max_runtime,
           memory_kb = :max_memory,
           judged_at = NOW()
       WHERE id = :submission_id;

  2. INSERT INTO submission_testcase_results (...)
       VALUES (... 每筆測資一筆 ...)
       -- actual_output 僅 is_public=TRUE 時才填值
       -- hidden testcase 的 actual_output 維持 NULL

  3. -- 計算這題分數(全 AC 給滿分)
     SELECT score_weight FROM exam_session_problems WHERE id = :esp_id;
     IF (overall_verdict = 'AC') THEN
       new_score := score_weight;
     ELSE
       new_score := 0;
     END IF;

  4. UPDATE exam_session_problems
       SET final_submission_id = :submission_id,  -- 永遠指向最新
           score = new_score,
           updated_at = NOW()
       WHERE id = :esp_id;

  5. UPDATE exam_sessions
       SET total_score = (
             SELECT COALESCE(SUM(score), 0)
             FROM exam_session_problems
             WHERE exam_session_id = :exam_session_id
           ),
           updated_at = NOW()
       WHERE id = :exam_session_id;

COMMIT
```

> 注意:步驟 4 的 `final_submission_id` 永遠指向**最新**這筆,不管分數變高還是變低,符合「最後一次提交為準」規則。

Backend integration tests 目前已覆蓋 Submission API 對這些 DB 欄位的寫入一致性：submission 狀態推進、per-testcase results、hidden testcase output 保護、`final_submission_id`、單題 `score` 與 session `total_score`。

### 10.7 面試者查詢自己的考試結果

```sql
-- 該題目前的「最終提交」結果
SELECT 
  esp.order_index,
  p.title,
  p.difficulty,
  esp.score_weight,
  esp.score,
  s.verdict,
  s.runtime_ms,
  s.memory_kb,
  s.submitted_at
FROM exam_session_problems esp
JOIN problems p ON p.id = esp.problem_id
LEFT JOIN submissions s ON s.id = esp.final_submission_id
WHERE esp.exam_session_id = :session_id
ORDER BY esp.order_index;
```

### 10.8 面試主管查某面試者的所有 sessions

```sql
SELECT 
  es.id,
  es.status,
  es.total_score,
  es.max_score,
  es.actual_start_at,
  es.expires_at,
  es.created_at
FROM exam_sessions es
WHERE es.candidate_id = :candidate_id
ORDER BY es.created_at DESC;
```

---

## 11. 實作建議與注意事項

### 11.1 Migration 工具

建議使用 `node-pg-migrate` 或 `Prisma Migrate`(Prisma 同時當 ORM 也行)。Migration 順序:

1. `001_create_enums.sql`(所有 ENUM TYPE)
2. `002_create_iam_tables.sql`(users, roles, permissions, user_roles, role_permissions)
3. `003_create_problem_tables.sql`(problems, problem_testcases, language_defaults, problem_language_limits)
4. `004_create_submission_table.sql`(submissions — 必須先於 exam,因為 esp 會 FK 過來;但 esp 的 FK 用 DEFERRABLE)
5. `005_create_exam_tables.sql`(exam_sessions, exam_session_problems)
6. `006_create_submission_testcase_results.sql`
7. `007_create_indexes.sql`
8. `008_seed_data.sql`

> 因為 `submissions` 和 `exam_session_problems` 互相 FK,實作時可以:先建 submissions(不含 FK 到 esp,因為 esp 還沒存在,實際上 submissions 是 FK 到 esp)→ 再建 esp(`final_submission_id` FK 用 DEFERRABLE)→ 最後 ALTER TABLE 補上反向 FK。或者直接用 Prisma 讓它自己 sort 出順序。

### 11.2 RBAC 檢查的 service 層 pattern

每個 service function 開頭固定做這個檢查:

```typescript
async function someService(currentUser: User, ...args) {
  // 1. Superuser short-circuit
  if (currentUser.is_superuser) {
    // 直接放行
  } else {
    // 2. 查使用者擁有的權限
    const permissions = await getUserPermissions(currentUser.id);
    // 3. 比對所需權限
    if (!permissions.has('exam:manage')) {
      throw new ForbiddenError();
    }
  }
  
  // 4. Ownership 檢查(若需要)
  // 例如:面試者查自己的 submission
  // if (submission.candidate_id !== currentUser.id) throw new ForbiddenError();
  
  // 5. 業務邏輯
  ...
}
```

權限可以 cache 在 JWT payload 或 Redis 裡,避免每次查 DB(MVP 階段也可以每次都查,反正資料量小)。

### 11.3 一致性與 Transaction

以下操作**必須**用單一 transaction:
- 批次建立面試者帳號(users + user_roles)
- 派題(exam_sessions + N 筆 exam_session_problems + 算 max_score)
- 評測完成回寫(submissions + N 筆 testcase_results + esp + exam_session)

### 11.4 軟刪除的查詢慣例

只有 `users` 和 `problems` 有 `deleted_at`。所有相關查詢都要記得加:

```sql
WHERE deleted_at IS NULL
```

可以在 ORM 層做 default scope(例如 Prisma 的 middleware 或 Sequelize 的 paranoid)。

### 11.5 大欄位的注意

`source_code`、`input_data`、`expected_output`、`actual_output` 都是 TEXT。建議:
- 應用層加上 size limit:`source_code` ≤ 256KB、`input_data` / `expected_output` ≤ 1MB、`actual_output` ≤ 64KB(對應 problem.output_limit_kb)
- 超出就拒絕(submission)或截斷(actual_output)

PostgreSQL 內部會自動把大 TEXT 用 TOAST 機制壓縮存到外部,空間效率還行,但查詢時不要 `SELECT *`,要明確列欄位避免不必要的 IO。

### 11.6 TIMESTAMPTZ 與時區

DB 永遠存 UTC。前端傳進來的時間如果有時區,driver 會自動轉。前端顯示時用使用者瀏覽器時區。Application server 設定 `TZ=UTC` 環境變數確保一致。

### 11.7 未來演進

根據文件「演進式架構」原則,以下是未來可能的拆分點:

| 改動 | 觸發條件 | 對 schema 的影響 |
|---|---|---|
| 測資搬到 MinIO/S3 | 單筆測資 > 1MB,或總量超過數 GB | `problem_testcases` 改存 object_key 而非 input_data/expected_output |
| 程式碼搬到 MinIO | 常見提交 > 64KB | `submissions.source_code` 改存 object_key |
| 加 Redis 快取草稿 | 編輯器自動存檔頻率高 | 不影響 schema,Redis 為旁路快取 |
| 拆微服務 | DAU 超過數千 | 各模組獨立 DB schema(目前已邏輯分區,改動小) |
| 題目版本化 | 出題者頻繁修改,影響歷史成績一致性 | 新增 `problem_versions` 表,exam_session_problems 改 FK 到版本 |
| 加反作弊事件表 | UserStatus 模組正式啟動 | 新增 `anticheat_events` 表 |

---

## 附錄:DDL 完整建表順序(快速參考)

```
1. CREATE TYPE (5 個 enum)
2. CREATE TABLE users
3. CREATE TABLE roles
4. CREATE TABLE permissions
5. CREATE TABLE user_roles
6. CREATE TABLE role_permissions
7. CREATE TABLE language_defaults
8. CREATE TABLE problems
9. CREATE TABLE problem_testcases
10. CREATE TABLE problem_language_limits
11. CREATE TABLE exam_sessions
12. CREATE TABLE exam_session_problems       (final_submission_id FK 暫時不建)
13. CREATE TABLE submissions
14. CREATE TABLE submission_testcase_results
15. ALTER TABLE exam_session_problems        (補上 final_submission_id FK,DEFERRABLE)
16. CREATE INDEX (見第 8 節)
17. INSERT seed data (見第 9 節)
```
