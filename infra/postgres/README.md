# PostgreSQL 綱要

PostgreSQL 是使用者、角色、題目、考試範本、考試 Session、提交、測試案例結果、分數與防作弊違規的系統記錄來源。此目錄中的 SQL 檔案依檔名順序套用，用於本地與 CI 的資料庫設定。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `00-extensions.sql` | PostgreSQL 擴充套件 |
| `01-enums.sql` | 共用列舉型別 |
| `02-iam.sql` | 使用者、角色、權限、角色對應 |
| `03-problems.sql` | 題目、測試案例、語言預設值、語言限制 |
| `04-exam.sql` | 考試範本、Session 與已分配題目 |
| `05-submissions.sql` | 提交紀錄 |
| `06-str.sql` | 每個測試案例的提交結果 |
| `07-alter-esp.sql` | 考試題目至最終提交的延遲外鍵 |
| `08-indexes.sql` | 效能索引 |
| `09-seed.sql` | 靜態角色、權限與語言預設值 |
| `10-scenarios.sql` | 開發用的情境使用者、題目、考試、提交 |
| `11-submission-type.sql` | 簡單/正式提交類型遷移 |
| `14-violations.sql` | 防作弊違規資料表 |
| `15-violation-scenarios.sql` | 情境違規資料 |
| `50-create-testdb.sql` | 本地/CI 測試資料庫建立 |

`backend/src/db/schema.ts` 對應這些資料表以供 Drizzle 查詢使用。

## 主要資料區塊

| 區塊 | 資料表 |
| --- | --- |
| IAM | `users`、`roles`、`permissions`、`user_roles`、`role_permissions` |
| 題目 | `problems`、`problem_testcases`、`language_defaults`、`problem_language_limits` |
| 考試 | `exam_templates`、`exam_template_problems`、`exam_template_random_rules`、`exam_sessions`、`exam_session_problems` |
| 提交 | `submissions`、`submission_testcase_results` |
| 防作弊 | `exam_violations` |

## 重要規則

- `users.deleted_at` 實作軟刪除。
- `users.created_by` 支援面試官對應試者帳號的擁有權。
- `exam_sessions` 追蹤生命週期狀態、計畫時間、實際開始時間、到期時間、提交、取消與應試者密碼恢復資料。
- `exam_session_problems.score_weight` 儲存分配的分數值。
- `exam_session_problems.final_submission_id` 指向最終計分的提交，並使用延遲外鍵（因為提交也會參照考試 Session 題目）。
- `submissions.submission_type` 為 `simple` 或 `formal`。
- 正式 `AC` 提交更新分數；簡單提交僅供回饋。
- 隱藏測試案例的輸出會被儲存，但在客戶端回應前過濾。
- `exam_violations` 記錄防作弊事件，例如離開全螢幕、貼上嘗試與其他客戶端回報的考試事件。

## 測試與情境資料

`09-seed.sql` 包含穩定的參考資料。`10-scenarios.sql` 與 `15-violation-scenarios.sql` 包含用於示範與手動驗證的開發固定資料。

CI 在執行後端測試前，會依序套用所有 `infra/postgres/[0-9]*.sql` 檔案。本地測試可使用以下方式指向產生的測試資料庫：

```bash
TEST_DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct_test npm test
```

## 遷移注意事項

這些檔案是此專案設定的初始化/遷移式 SQL 腳本。新資料庫應依排序順序套用它們。若需要生產環境的回滾流程，請引入專用的遷移工具，避免就地編輯已套用的 SQL。
