# Online Code Test — M2 非同步判題

NTHU 1142 雲原生 HW2 / Team 12。本版本已從 M1 mock judge 升級為 M2 非同步判題架構：frontend、backend、PostgreSQL、RabbitMQ、judge worker，以及 Docker/gVisor 沙箱執行流程。

各 component 詳細說明與測試指南：

- [Testing_README.md](./Testing_README.md) — 完整測試指南（環境建置、各 component 自動/手動測試）
- [backend/README.md](./backend/README.md) — Backend API 設計、endpoints 規格、測試覆蓋
- [frontend/README.md](./frontend/README.md) — Frontend 架構與開發環境設定
- [worker/README.md](./worker/README.md) — Judge worker 架構、RabbitMQ 協定、gVisor sandbox 設計
- [infra/postgres/README.md](./infra/postgres/README.md) — Database schema、init scripts、RBAC 設計

## 一鍵部署

需求：

- Docker Engine >= 24
- Docker Compose v2
- 正式沙箱隔離需在 host 安裝並設定 gVisor `runsc` runtime

```bash
cp .env.example .env
make sandbox-images
make up
make ps
```

啟動後服務入口：

| 服務 | 入口 |
|------|------|
| 前端 | <http://localhost:5173> |
| 後端健康檢查 | <http://localhost:3000/api/health> |
| RabbitMQ Management UI | <http://localhost:15672> (`oct` / `oct_dev_password`) |
| PostgreSQL | `localhost:5432` |

如果本機尚未安裝 gVisor，可在 `.env` 暫時改用普通 Docker runtime：

```bash
SANDBOX_RUNTIME=runc
```

`runc` 只適合本機開發驗證，不提供 gVisor 的隔離效果。

## 常用 Makefile 指令

```bash
make bootstrap       # 產生 .env
make sandbox-images  # 建立 oj-sandbox-cpp / oj-sandbox-python
make up              # docker compose up -d --build
make ps              # 查看服務健康狀態
make logs            # 追蹤所有服務 log
make down            # 停止服務
make clean           # 停止服務並刪除 volumes
make rebuild         # clean + up
make psql            # 進入 psql shell
```

## 服務一覽

| Service | 說明 | Host port |
|---------|------|-----------|
| `postgres` | PostgreSQL 16 | 5432 |
| `rabbitmq` | RabbitMQ + Management UI | 5672 / 15672 |
| `backend` | Fastify API、WebSocket、RabbitMQ result consumer | 3000 |
| `worker` | Judge worker，透過 Docker/gVisor 執行判題 | internal |
| `frontend` | Vite build，由 nginx 提供靜態檔 | 5173 |

## 判題流程

1. Candidate 呼叫 `POST /api/exam-sessions/:id/submissions`。
2. Backend 建立 `submissions` row，初始狀態為 `pending`，並寫入 `submission_type`。
3. Backend 發布任務到 RabbitMQ `judge.tasks` queue。
4. Worker 一次消費一個任務：`simple` 只跑公開測資，`formal` 跑公開 + hidden 測資。
5. Worker 使用 Docker/gVisor 執行程式，將 testcase results 與 submission verdict 寫回 PostgreSQL。
6. Worker 發布 `judge.results`，backend 收到後透過 `/api/ws` 推送 `judge_result`。
7. 只有 `formal` 且 verdict 為 `AC` 時，才會更新 `exam_session_problems.score` 與 `exam_sessions.total_score`。

## 環境變數

`.env.example` 是範本，`.env` 是實際執行值。

| 變數 | 預設 | 說明 |
|------|------|------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `oct` / `oct_dev_password_change_me` / `oct` | PostgreSQL 帳號、密碼與 DB 名稱 |
| `DATABASE_URL` | `postgres://oct:...@postgres:5432/oct` | Backend / worker 使用的 DB 連線字串 |
| `JWT_SECRET` | dev secret | JWT 簽章密鑰，正式部署必改 |
| `RABBITMQ_USER` / `RABBITMQ_PASS` | `oct` / `oct_dev_password` | RabbitMQ 帳號與密碼 |
| `RABBITMQ_URL` | `amqp://oct:oct_dev_password@rabbitmq:5672` | Backend / worker 使用的 RabbitMQ 連線字串 |
| `HOST_WORK_DIR` | `/tmp/judge` | Worker 與 host Docker 共用的工作目錄 |
| `SANDBOX_RUNTIME` | `runsc` | 沙箱 runtime；本機無 gVisor 時可暫改 `runc` |
| `HOST_*_PORT` | 見 `.env.example` | Host port mapping |

## 測試與排錯

測試流程、自動測試指令、手動測試案例、常見問題請參閱 [Testing_README.md](./Testing_README.md)。
