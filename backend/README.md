# 後端 API

後端是一個 Fastify + TypeScript 服務。它負責驗證、RBAC、題目與考試管理、提交、草稿、防作弊違規、WebSocket 廣播、RabbitMQ 整合、Redis 快取/草稿儲存與 Prometheus 指標。

## 目錄結構

```text
backend/src/
├── server.ts
├── env.ts
├── errors.ts
├── db/
├── hooks/
├── mq/
├── plugins/
├── routes/
├── services/
└── ws/
```

重要模組：

- `server.ts` 註冊 Fastify 外掛、`/api/*` 路由、`/api/ws`、指標 Hook、Redis 與 RabbitMQ 消費者。
- `db/schema.ts` 對應 `infra/postgres/` 下的 SQL 綱要。
- `routes/` 處理 HTTP 綁定與請求驗證。
- `services/` 包含 RBAC、擁有權檢查、交易與業務邏輯規則。
- `mq/` 發布評測任務並消費評測結果。
- `ws/hub.ts` 追蹤本地 WebSocket 訂閱者。
- `ws/session-events.ts` 使用 Redis pub/sub 在後端實例間廣播 Session 事件。
- `metrics.ts` 註冊 HTTP、提交、MQ 與 WebSocket 的 Prometheus 指標。

## API 介面

所有路由掛載於 `/api` 下。

| 功能區塊 | 路由 |
| --- | --- |
| 健康/指標 | `GET /health`、`GET /ping`、`GET /metrics` |
| 驗證 | `POST /auth/login` |
| 使用者 | `GET/POST /users`、`POST /users/batch`、`GET/PUT/DELETE /users/:id`、`PUT /users/:id/roles`、`GET /users/:id/password` |
| 題目 | `GET/POST /problems`、`GET/PUT/DELETE /problems/:id`、測試案例 CRUD、語言限制更新 |
| 考試範本 | `GET /exam-sessions/templates`、`POST /exam-sessions/templates/manual`、`POST /exam-sessions/templates/random`、`PUT/DELETE /exam-sessions/templates/:id`、`POST /exam-sessions/templates/:id/assign` |
| 考試 Session | `GET /exam-sessions`、`GET /exam-sessions/:id`、`POST /exam-sessions/:id/start`、`POST /exam-sessions/:id/submit`、`POST /exam-sessions/:id/cancel`、`GET /exam-sessions/:id/problems`、`GET /exam-sessions/:id/candidate-password` |
| 草稿 | `PUT /exam-sessions/:id/drafts/:problemId/:language`、`GET /exam-sessions/:id/drafts` |
| 提交 | `POST /exam-sessions/:sessionId/submissions`、`GET /exam-sessions/:sessionId/submissions`、`GET /exam-sessions/:sessionId/submissions/:submissionId`、`GET /exam-sessions/:sessionId/result` |
| 語言 | `GET /languages` |
| 違規 | `POST /exam-sessions/:id/violations`、`GET /exam-sessions/:id/violations` |
| WebSocket | `GET /ws?token=<JWT>` |

## 行為說明

- 超級使用者可繞過一般角色檢查。
- 面試官可管理其擁有的考試與應試者。
- 出題者可管理題目與測試案例。
- 應試者可開始考試、儲存草稿、提交程式碼，以及查看自身結果。
- 正式提交僅在最終評測結果為 `AC` 時更新分數。
- 簡單提交僅執行公開測試案例，不更新分數。
- 草稿寫入使用 Redis 並設有基於考試到期時間的 TTL；Redis 失敗為非致命錯誤。
- 後端 WebSocket 事件在本地傳遞，並透過 Redis 發布，讓其他後端實例也能通知各自的訂閱者。
- 隱藏測試案例的輸出在傳送至客戶端前會被過濾。

## 環境變數

| 變數 | 用途 |
| --- | --- |
| `PORT` | HTTP 埠號，預設值定義於 `env.ts` |
| `DATABASE_URL` | PostgreSQL 連線字串 |
| `JWT_SECRET` | JWT 簽署金鑰 |
| `RABBITMQ_URL` | RabbitMQ 連線字串 |
| `REDIS_URL` | Redis 快取/草稿/pubsub 連線字串 |
| `LOG_LEVEL` | Fastify Logger 等級 |

## 開發

```bash
npm install
npm run dev          # tsx watch src/server.ts
npm run lint         # TypeScript 檢查
npm test             # Vitest 單元/整合測試套件
npm run coverage     # Vitest 覆蓋率報告
npm run build        # 編譯至 dist/
```

陳述式、分支、函式與行數的測試覆蓋率須維持在 85% 以上。

後端測試需要 PostgreSQL 與 Redis。Vitest 設定會將 `TEST_DATABASE_URL` 對應至 `DATABASE_URL` 以供本地主機執行。

CI 在執行後端測試前，會依序套用 `infra/postgres/[0-9]*.sql` 的 SQL 檔案。使用根目錄閘門執行完整的儲存庫檢查：

```bash
make test
make coverage
```

## 指標

`GET /api/metrics` 公開 prom-client 指標，涵蓋 HTTP 延遲、提交生命週期、RabbitMQ 發布錯誤、評測結果廣播與活躍 WebSocket 訂閱者數量。
