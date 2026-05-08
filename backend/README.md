# Backend — Online Code Test (M1)

Fastify + TypeScript API。M1 只提供兩支端點，作為 frontend ↔ DB 整條鏈路的存活驗證。實際業務 endpoint（auth / problems / submissions）會在 M2+ 補上。

## 技術棧

- **Runtime**：Node 20
- **Framework**：[Fastify 4](https://fastify.dev) + `@fastify/sensible`
- **DB**：PostgreSQL 16，透過 `pg` + [`drizzle-orm`](https://orm.drizzle.team/) 操作
- **Validation**：`zod`（驗 env，未來 routes 用）
- **Logger**：Fastify 內建 `pino`（dev 模式走 `pino-pretty`）

## Scripts

```bash
npm install                # 安裝依賴
npm run dev                # tsx watch 模式（自動 reload）
npm run build              # tsc → dist/
npm start                  # 跑 dist/server.js（容器內就是這條）
npm run migrate            # 跑 dist/db/migrate.js（容器啟動時會自動跑）
npm run migrate:dev        # 直接用 tsx 跑 migration（dev 用）
npm test                   # vitest run（M1 還沒寫測試）
npm run lint               # tsc --noEmit
```

## 本機（不靠 compose）開發

需要先有一個 Postgres 跑著，最方便是只起 compose 的 postgres：

```bash
cd ..
docker compose up -d postgres
cd backend
DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct \
  npm run migrate:dev
DATABASE_URL=postgres://oct:oct_dev_password_change_me@localhost:5432/oct \
  npm run dev
# → http://localhost:3000/api/health
```

## API endpoints

| Method | Path           | 說明                                                                |
|--------|----------------|---------------------------------------------------------------------|
| GET    | `/api/health`  | 連 DB 跑 `SELECT 1`，回 `{status, dbLatencyMs, uptimeSec}`           |
| GET    | `/api/ping`    | 應用層存活，不碰 DB，回 `{pong: true, ts}`                          |

> M2+ 會新增 `/api/auth/*`、`/api/users`、`/api/problems`、`/api/submissions`、`/api/exams`，schema 已在 `src/db/schema.ts` 預留 `users` 與 `problems` 兩張表。

## 環境變數

| 變數          | 必填 | 預設            | 說明                              |
|---------------|------|-----------------|-----------------------------------|
| `DATABASE_URL`| ✅   | —               | Postgres 連線字串                 |
| `PORT`        |      | `3000`          | HTTP 監聽 port                    |
| `NODE_ENV`    |      | `development`   | `development` 啟用 pino-pretty    |
| `LOG_LEVEL`   |      | `info`          | pino log level                    |

## DB migration

M1 把 schema 寫成單一冪等 SQL 在 `src/db/migrate.ts`（`CREATE TABLE IF NOT EXISTS …`）。容器 `CMD` 會在 server 啟動前先跑一次，乾淨 Postgres volume 直接可用。

M2 開始 schema 變動會頻繁，會切到 `drizzle-kit` 產生的 SQL（`./drizzle/*.sql`）+ `drizzle-orm/node-postgres/migrator` 的 `migrate()`。`drizzle.config.ts` 已就位。

## 與 docker-compose 的關係

- Build context = `./backend`（Dockerfile 自帶多階段 build）
- 對外 port `${HOST_BACKEND_PORT}:${BACKEND_PORT}`，預設 3000:3000
- 啟動依賴：`postgres` 變 healthy 才啟動
- 容器內由 `node:20-alpine` 跑，非 root user (`node`, uid 1000)
- Healthcheck 直接打 `/api/health`，frontend 透過 service-healthy 條件 depends_on

## 目錄結構

```
backend/
├── Dockerfile
├── drizzle.config.ts        # drizzle-kit（M2 起用）
├── package.json
├── tsconfig.json
└── src/
    ├── server.ts            # Fastify 入口、graceful shutdown
    ├── env.ts               # zod 驗 env
    ├── db/
    │   ├── client.ts        # pg pool + drizzle instance
    │   ├── schema.ts        # users / problems
    │   └── migrate.ts       # bootstrap SQL（容器啟動時跑）
    └── routes/
        ├── health.ts
        └── ping.ts
```
