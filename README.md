# Online Code Test — M1 骨架

NTHU 1142 雲原生 HW2 / Team 12。本目錄是 **M1 最小可跑骨架**：frontend + backend + PostgreSQL 三個容器，一鍵 `docker compose up` 拉起全部環境。

完整專案規劃見上層 [`../PLAN.md`](../PLAN.md)。本骨架對應 M1，後續 M2（真判題 + 沙箱）/ M3（K8s + 觀測性）/ M4（六種測試）會在此基礎上擴張。

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
- [`infra/postgres/`](./infra/postgres/init.sql) — Postgres 初始化腳本

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

詳見 [`../PLAN.md`](../PLAN.md)。

---

## Database 測試指南

### 連線方式

```bash
# 方法 1：Makefile（最簡單，需先 make up）
make psql

# 方法 2：直接從 host 連（預設 port 5432）
psql "postgres://oct:oct_dev_password_change_me@localhost:5432/oct"

# 方法 3：進入容器內
docker exec -it oct-postgres-1 psql -U oct -d oct
```

### 首次啟動 / 重置資料庫

Init SQL 只在 **volume 為空時**執行一次。若要重置全部資料：

```bash
make clean   # 停容器並刪除 oct_pgdata volume
make up      # 重建並重跑全部 init SQL + seed + scenarios
```

或等效的：

```bash
docker compose down -v && docker compose up -d --build
```

### 測試帳號

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

### 測試情境總覽

| Session | 面試者 | 狀態 | 題目 | 總分 | 說明 |
|---------|--------|------|------|------|------|
| 1 | David (001) | `not_started` | P1+P4+P7 | 0/100 | 已派題，未開始 |
| 2 | Emma (002) | `in_progress` | P2+P5+P8 | 0/90 | 40 分鐘前開始，90 分鐘限制 |
| 3 | Frank (003) | `submitted` | P1+P4+P7 | 30/100 | P1=AC(3次提交)、P4=WA、P7=CE |
| 4 | Grace (004) | `cancelled` | P3+P6+P8 | 0/90 | 面試主管取消 |
| 5 | Henry (005) | `submitted` | P2+P5+P6 | 60/90 | 第一場，P2=AC、P5=WA、P6=AC |
| 6 | Henry (005) | `submitted` | P1+P4+P7 | 70/100 | 重考（與 Session 5 題目不重複） |

> Session 5 用了 P2/P5/P6；Session 6 改用 P1/P4/P7 → 可驗證「派題避重複」邏輯。

### 常用查詢範例

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
```
