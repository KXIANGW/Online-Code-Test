# Online Code Test — M1 骨架

NTHU 1142 雲原生 HW2 / Team 12。本目錄是 **M1 最小可跑骨架**：frontend + backend + PostgreSQL 三個容器，一鍵 `docker compose up` 拉起全部環境。

資料庫 Schema 設計詳見 [`infra/postgres/Database_PLAN.md`](./infra/postgres/Database_PLAN.md)。本骨架對應 M1，後續 M2（真判題 + 沙箱）/ M3（K8s + 觀測性）/ M4（六種測試）會在此基礎上擴張。

---

## 一鍵部署

需求：Docker Engine ≥ 24（含 `docker compose` v2）。

```bash
cd oct
cp .env.example .env       # 或 make bootstrap
docker compose up -d --build
```

等三個 service 都 `healthy` 後（約 20–30 秒）：

- 前端：<http://localhost:5173>
- 後端 API：<http://localhost:3000/api/health>
- Postgres：`localhost:5432`（user / db / pw 在 `.env`）

也可以用 `Makefile`：

```bash
make bootstrap   # 產生 .env
make up          # 等同 docker compose up -d --build
make ps          # 看健康狀態
make logs        # tail 全部 log
make down        # 停止
make clean       # 停止並清掉 Postgres volume
make rebuild     # clean + up
make psql        # 進 psql shell
```

---

## 服務一覽

| Service  | Image                  | Host port | 容器內 port | 健康檢查                    |
|----------|------------------------|-----------|-------------|-----------------------------|
| postgres | `postgres:16-alpine`   | 5432      | 5432        | `pg_isready`                |
| backend  | 自建 (Node 20 + Fastify) | 3000      | 3000        | `GET /api/health`（含 DB ping） |
| frontend | 自建 (Vite build → nginx)| 5173      | 80          | `GET /`                     |

啟動順序透過 `depends_on: condition: service_healthy` 保證：postgres → backend → frontend。

Backend container 啟動時會先跑 DB migrations，新機器 clone 後不需手動 init schema。

---

## 目錄索引

- [`backend/`](./backend/README.md) — Fastify + Drizzle + PostgreSQL
- [`frontend/`](./frontend/README.md) — Vite + React 18 + Nginx
- [`infra/postgres/`](./infra/postgres/Database_README.md) — Postgres 初始化腳本與測試指南

---

## 環境變數

`.env.example` 是範本，`.env` 是實際值（已被 `.gitignore` 忽略）。

| 變數                | 預設                                                         | 說明                              |
|---------------------|--------------------------------------------------------------|-----------------------------------|
| `POSTGRES_USER`     | `oct`                                                        | Postgres 帳號                     |
| `POSTGRES_PASSWORD` | `oct_dev_password_change_me`                                 | **正式部署前一定要改**            |
| `POSTGRES_DB`       | `oct`                                                        | DB 名稱                           |
| `DATABASE_URL`      | `postgres://oct:...@postgres:5432/oct`                       | Backend 連線字串（compose 網段內） |
| `BACKEND_PORT`      | `3000`                                                       | Backend 容器內監聽 port           |
| `NODE_ENV`          | `development`                                                | Fastify mode                      |
| `LOG_LEVEL`         | `info`                                                       | Pino log level                    |
| `FRONTEND_PORT`     | `5173`                                                       | Host 端對外 port → frontend:80    |
| `HOST_BACKEND_PORT` | `3000`                                                       | Host 端對外 port → backend:3000   |
| `HOST_POSTGRES_PORT`| `5432`                                                       | Host 端對外 port → postgres:5432  |

---

## Troubleshooting

- **Port 衝突（5432 / 3000 / 5173 已被佔）**：改 `.env` 的 `HOST_*_PORT` 變數，例如 `HOST_POSTGRES_PORT=15432`，重跑 `make up`。
- **Backend 一直 unhealthy**：`docker compose logs backend` 看是否連 DB 失敗。確認 `DATABASE_URL` 用的是 service 名 `postgres` 而不是 `localhost`。
- **想砍掉重來**：`make clean`（會刪 `oct_pgdata` volume，所有資料消失）。
- **WSL2 / Windows 路徑問題**：確保 Docker Desktop 已開啟 WSL integration；compose volume 用 named volume 不是 bind mount，不會有 path 問題。

---

## 後續 milestone

- **M2**：加 RabbitMQ + judge-worker + 沙箱（isolate / gVisor），支援 Python + C++ 真判題
- **M3**：每 service 寫 Helm chart，OpenTelemetry + Prometheus + Loki，KEDA HPA
- **M4**：unit / integration / e2e / load / stress / performance 六種測試 + 抄襲偵測

詳見 [`infra/postgres/Database_PLAN.md`](./infra/postgres/Database_PLAN.md)。
