# Online Code Test

Online Code Test 是一個雲端原生的程式考試平台。它包含 React 前端、Fastify 後端、PostgreSQL/Redis/RabbitMQ 服務、基於 isolate 的評測 Worker、Kubernetes 語言 rootfs 拉取器、可觀測性儀表板，以及示範用的負載測試工具。

## 元件文件

- [frontend/README.md](./frontend/README.md) - React SPA 路由、狀態、測試與建置流程。
- [backend/README.md](./backend/README.md) - Fastify API、驗證/RBAC、題目、考試、提交、草稿、違規、指標與 WebSocket 事件。
- [worker/README.md](./worker/README.md) - 評測 Worker、RabbitMQ 協定、isolate 沙箱、seccomp、語言 rootfs 與指標。
- [worker/puller/README.md](./worker/puller/README.md) - Kubernetes Worker 使用的每節點語言 rootfs 拉取器。
- [infra/postgres/README.md](./infra/postgres/README.md) - PostgreSQL 綱要、種子資料、情境資料與測試資料庫設定。
- [infra/redis/README.md](./infra/redis/README.md) - Redis 快取、草稿與 WebSocket pub/sub 行為。
- [loadtest/README.md](./loadtest/README.md) - 100 個並發提交示範與自動擴縮容監視器。
- Kubernetes 節點設定筆記位於 [docs/K8s_settup_node1.md](./docs/K8s_settup_node1.md)、[docs/K8s_settup_node2.md](./docs/K8s_settup_node2.md) 與 [docs/K8s_settup_node3.md](./docs/K8s_settup_node3.md)。

## 本地堆疊

需求：

- Docker Engine 24+
- Docker Compose v2
- Node.js 20+（用於本地套件腳本）
- cgroup v2（用於 isolate Worker 容器）

```bash
# 1. 如需要，建立 .env 檔
make bootstrap

# 2. 建置沙箱映像並為 isolate 提取語言 rootfs 目錄樹
make -C worker build-isolate-rootfs

# 3. 啟動完整堆疊
make up

# 4. 確認服務健康狀態
make ps
```

`make up` 會建置服務映像與沙箱映像，但 Worker 在本地還需要 `/tmp/oct-rootfs` 下的 rootfs 目錄。在評測提交前請先執行 `make -C worker build-isolate-rootfs`。

## 服務網址

| 服務 | 網址 / 埠號 |
| --- | --- |
| 前端 | <http://localhost:5173> |
| 後端健康檢查 | <http://localhost:3000/api/health> |
| 後端指標 | <http://localhost:3000/api/metrics> |
| RabbitMQ UI | <http://localhost:15672>（`oct` / `oct_dev_password`）|
| PostgreSQL | `localhost:5432` |
| Adminer | <http://localhost:8082> |
| Prometheus | <http://localhost:9090> |
| Grafana | <http://localhost:3001>（`admin` / `oct_dev_grafana`）|
| cAdvisor | <http://localhost:8081> |

## 常用指令

```bash
make bootstrap       # 若 .env 不存在，從 .env.example 建立
make dev             # 僅啟動核心服務，不含監控堆疊
make up              # 建置並啟動完整 Docker Compose 堆疊
make down            # 停止堆疊
make clean           # 停止堆疊並刪除 Volume
make ps              # 顯示服務健康狀態
make logs            # 追蹤所有服務的 Log

make test            # 格式化/Lint/測試/建置 backend、frontend、worker 與 puller
make coverage        # 執行 backend、frontend、worker 與 puller 的覆蓋率報告

make -C worker build-isolate-rootfs
make -C worker verify-language LANG=cpp17
make -C worker test-integration-isolate
make -C worker list-languages
```

每個子專案對陳述式、分支、函式與行數的測試覆蓋率要求至少達到 85%。

## 架構

應試者透過前端提交程式碼。後端建立提交紀錄，將 `judge.tasks` 訊息發布至 RabbitMQ，並回傳 `202`。Worker 每次消費一個任務，從 `worker/sandbox/languages.yaml` 載入語言規格，在 `isolate` 中編譯/執行提交，並將評測結果寫回 PostgreSQL。後端消費 `judge.results`，透過 `/api/ws` 廣播更新，並公開 Prometheus 指標。

正式提交（Formal Submission）會執行公開與隱藏測試案例，僅在 `AC` 時更新分數。簡單提交（Simple Submission）僅執行公開測試案例以提供回饋，不更新分數。應試者草稿儲存於 Redis，並同步至瀏覽器本地儲存（localStorage），確保 Redis 不可用時考試流程仍可正常降級運作。

## 示範負載測試

```bash
make demo-100        # 啟動堆疊、產生 100 個應試者種子資料、執行監視器、執行 k6 爆量測試
make demo-urls       # 列印可觀測性相關網址
make demo-down       # 停止堆疊、刪除 Volume、清理負載測試狀態
```

示範設定與 Grafana 預期行為請參閱 [loadtest/README.md](./loadtest/README.md)。
