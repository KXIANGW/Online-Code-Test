# M3 DB & Backend 更動摘要

---

## 1. Database Schema — `users` 表新增 `created_by` 欄位

**欄位定義：**
```sql
created_by BIGINT REFERENCES users(id)
```
- **Nullable** — root 或 superuser 建立的帳號值為 `NULL`
- **Self-referential FK** — 指向同張表的 `id`

**異動檔案：**
- `infra/postgres/02-iam.sql` — fresh DB 直接建表時就含此欄位
- `backend/src/db/migrate.ts` — 現有 DB 以 `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id)` 升級（idempotent，重複執行安全）
- `backend/src/db/schema.ts` — Drizzle ORM 新增對應欄位

---

## 2. 業務邏輯變更 — `user.service.ts`

### `createUser` / `batchCreateCandidates`
- **新增**：建立 candidate 時自動寫入 `created_by`
  - 呼叫者為 interviewer → `created_by = currentUser.id`
  - 呼叫者為 superuser → `created_by = NULL`

### `listUsers`（`GET /api/users`）
- **Before**：僅 superuser 可呼叫（其他人 403）
- **After**：
  - superuser → 看所有未刪除使用者（行為不變）
  - interviewer（`exam:manage`）→ **新增可呼叫，但只回傳 `created_by = currentUser.id` 且 `is_superuser = false` 的帳號**

### `updateUser`（`PUT /api/users/:id`，全新端點）
- **新增**：interviewer 可修改 `displayName` 或重設密碼
- **Ownership check**：
  - 目標為 superuser → 403
  - `created_by ≠ currentUser.id` → 403
- superuser 不受限制

### `deleteUser`（`DELETE /api/users/:id`）
- **Before**：僅 superuser 可呼叫（其他人 403）
- **After**：
  - interviewer 新增可呼叫，但同樣受 ownership check 限制：
    - 目標為 superuser → 403
    - `created_by ≠ currentUser.id` → 403
  - superuser 不受限制

---

## 3. 新增 API 端點 — `routes/users.ts`

| Method | Path | 說明 |
|--------|------|------|
| `PUT` | `/api/users/:id` | 更新 `displayName` 或密碼；body: `{ displayName?, password? }` |

---

## 4. 權限矩陣對照（異動前後）

| 操作 | Before | After |
|------|--------|-------|
| `GET /api/users` | superuser only | superuser（全部）/ interviewer（只看自己建的） |
| `PUT /api/users/:id` | 不存在 | superuser（無限制）/ interviewer（只改自己建的）|
| `DELETE /api/users/:id` | superuser only | superuser（無限制）/ interviewer（只刪自己建的）|

---

## 5. 測試異動 — `users.test.ts`（24 → 37 筆）

新增測試涵蓋：
- interviewer 只看到自己建立的 candidate（空清單 edge case）
- interviewer 無法看到非自己建立的 candidate
- interviewer 可更新/刪除自己建立的 candidate
- interviewer 更新/刪除非自己建立的 candidate → 403
- interviewer 更新/刪除 superuser → 403
- `PUT` 密碼重設後，舊密碼失效、新密碼可登入

**測試基礎設施：**
- `helpers/global-setup.ts`（新增）— Vitest `globalSetup`，在所有 test file 執行前跑一次 `ALTER TABLE`，確保各 test file 都能使用 `created_by` 欄位
- `helpers/db.ts` — `seedUser()` 新增 `createdBy` 參數
