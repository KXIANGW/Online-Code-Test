# Online Code Test

![Version](https://img.shields.io/badge/version-v0.1.0-blue.svg)
![Frontend](https://img.shields.io/badge/frontend-React%2018%20%2B%20Vite-111827.svg)
![Backend](https://img.shields.io/badge/backend-Fastify%20%2B%20TypeScript-059669.svg)
![Judge](https://img.shields.io/badge/judge-isolate%20sandbox%20%2B%20RabbitMQ-f97316.svg)
![Tests](https://img.shields.io/badge/tests-Vitest%20%7C%20Playwright%20%7C%20k6-7c3aed.svg)

> Cloud-Native Online Programming Exam and Judge Platform.

Online Code Test 是一套雲端原生程式考試平台，涵蓋應試者作答、面試官監考、題庫與考卷管理、正式與簡單提交、即時評測結果、違規事件、草稿保存、可觀測性儀表板與 100 人並發提交示範。系統採前後端分離與容器化部署，透過 PostgreSQL、Redis、RabbitMQ、isolate sandbox、Prometheus、Grafana、Docker Compose、Kubernetes 與 Argo CD 串起本地開發、評測工作流與部署路徑。

- Frontend README: [frontend/README.md](frontend/README.md)
- Backend README: [backend/README.md](backend/README.md)
- Worker README: [worker/README.md](worker/README.md)
- Rootfs Puller README: [worker/puller/README.md](worker/puller/README.md)
- Load Test README: [loadtest/README.md](loadtest/README.md)
- SonarQube Guide: [docs/Sonar_RUN.md](docs/Sonar_RUN.md)

## 系統架構

```text
Browser
  |
  v
Frontend: React 18 + Vite + Zustand + Monaco Editor
  |
  v
Backend API: Fastify + JWT auth + RBAC + WebSocket
  |
  +--> PostgreSQL: users, problems, exams, sessions, submissions, violations
  +--> Redis: candidate drafts, cache, WebSocket pub/sub fallback data
  +--> RabbitMQ: judge.tasks / judge.results message pipeline
  +--> Worker: isolate sandbox, seccomp, language rootfs, verdict checker
  +--> Prometheus / Grafana / cAdvisor: metrics and observability dashboards
```

部署與開發支援三種主要情境：

| 情境 | 用途 | 入口 |
| --- | --- | --- |
| Docker Compose | 快速啟動完整本地 stack | [docker-compose.yml](docker-compose.yml) |
| 本地開發 | 分別修改前端、後端與 Worker，方便 debug | [Makefile](Makefile) |
| Kubernetes / Argo CD | 雲原生部署、Worker autoscaling 與 GitOps 推進 | [k8s](k8s), [k8s/argocd](k8s/argocd) |

## Tech Stack

| 層 | 技術 |
| --- | --- |
| Frontend | TypeScript, React 18, Vite, React Router, Zustand, Monaco Editor, Tailwind CSS |
| Backend | TypeScript, Fastify, Zod, Drizzle ORM, JWT, WebSocket, Prometheus metrics |
| Database | PostgreSQL, SQL migration scripts, seed and scenario data |
| Cache / Queue | Redis, RabbitMQ |
| Judge Worker | TypeScript, isolate, seccomp policy, AppArmor profile, language rootfs images |
| Observability | Prometheus, Grafana dashboards, cAdvisor, RabbitMQ Management UI |
| Tests | Vitest, Testing Library, Playwright, k6, coverage-v8 |
| Quality / Deploy | SonarQube, Docker Compose, Kubernetes manifests, KEDA, Argo CD |

## 專案結構

```text
Online-Code-Test/
├── README.md                     # 專案總覽
├── Makefile                      # bootstrap/dev/test/demo 常用指令
├── docker-compose.yml            # 完整本地 stack
├── docker-compose.sonar.yml      # SonarQube 本地品質分析 stack
├── backend/                      # Fastify API, auth, exams, submissions, WebSocket
├── frontend/                     # React SPA, role-based pages, Monaco coding UI
├── worker/                       # RabbitMQ judge consumer and isolate execution engine
│   └── puller/                   # Kubernetes node-level language rootfs puller
├── infra/                        # PostgreSQL, Redis, Prometheus, Grafana 設定
├── loadtest/                     # k6 burst tests and 100-candidate demo seed
├── e2e/                          # API and browser end-to-end tests
├── k8s/                          # Kubernetes manifests, autoscaling, Argo CD app
├── charts/                       # Helm charts for worker and rootfs puller
└── docs/                         # Kubernetes, SonarQube and requirement notes
```

## 快速啟動

### Mode A: Docker 完整堆疊

適合 reviewer、展示或第一次快速跑完整系統。

```bash
# 1. 若 .env 不存在，從 .env.example 建立
make bootstrap

# 2. 建置 sandbox image，並在 /tmp/oct-rootfs 準備 isolate 語言 rootfs
make -C worker build-isolate-rootfs

# 3. 啟動完整 stack
make up

# 4. 查看服務狀態
make ps
```

`make up` 會建置服務映像與 sandbox 映像，但 Worker 在本地執行評測前仍需要 `/tmp/oct-rootfs` 下的語言 rootfs 目錄。若要提交程式碼給 judge，請先執行 `make -C worker build-isolate-rootfs`。

啟動後：

| Service | URL / Port | 說明 |
| --- | --- | --- |
| Frontend | <http://localhost:5173> | 應試者、面試官與管理介面 |
| Backend health | <http://localhost:3000/api/health> | API 健康檢查 |
| Backend metrics | <http://localhost:3000/api/metrics> | Prometheus metrics |
| RabbitMQ UI | <http://localhost:15672> | `oct` / `oct_dev_password` |
| PostgreSQL | `localhost:5432` | 主要資料庫 |
| Adminer | <http://localhost:8082> | 資料庫瀏覽工具 |
| Prometheus | <http://localhost:9090> | Metrics target and query |
| Grafana | <http://localhost:3001> | `admin` / `oct_dev_grafana` |
| cAdvisor | <http://localhost:8081> | Container resource metrics |

## 預設帳號與密碼

以下帳號來自 [infra/postgres/10-scenarios.sql](infra/postgres/10-scenarios.sql)，僅供本地開發、展示與測試使用。正式環境請更換所有密碼、secret 與 token。

### 應用程式登入

| Username | Password | 角色 | 顯示名稱 / 用途 |
| --- | --- | --- | --- |
| `root` | `Root@1234` | Superuser | System Root，系統最高權限 |
| `alice` | `Test@1234` | Interviewer | Alice Chen，建立/管理應試者與考試 |
| `bob` | `Test@1234` | Interviewer, Problem Setter | Bob Wang，面試官與出題者 |
| `carol` | `Test@1234` | Problem Setter | Carol Liu，建立與管理題目 |
| `candidate_20260509_001` | `Cand@1234` | Candidate | David Chang，未開始考試情境 |
| `candidate_20260509_002` | `Cand@1234` | Candidate | Emma Lin，進行中考試情境 |
| `candidate_20260509_003` | `Cand@1234` | Candidate | Frank Wu，已提交考試情境 |
| `candidate_20260509_004` | `Cand@1234` | Candidate | Grace Lee，已取消考試情境 |
| `candidate_20260509_005` | `Cand@1234` | Candidate | Henry Huang，重考與多 session 情境 |

### 本地服務帳密

| 服務 | URL / Host | Username | Password / Secret | 來源 |
| --- | --- | --- | --- | --- |
| PostgreSQL | `localhost:5432` | `oct` | `oct_dev_password_change_me` | `.env.example`, [docker-compose.yml](docker-compose.yml) |
| RabbitMQ UI | <http://localhost:15672> | `oct` | `oct_dev_password` | `.env.example`, [docker-compose.yml](docker-compose.yml) |
| Grafana | <http://localhost:3001> | `admin` | `oct_dev_grafana` | [docker-compose.yml](docker-compose.yml) |
| SonarQube | <http://localhost:9000> | `admin` | `admin` | 首次登入會要求修改，見 [docs/Sonar_RUN.md](docs/Sonar_RUN.md) |
| JWT secret | backend env | - | `oct_dev_jwt_secret_change_me_32_chars` | `.env.example`, [docker-compose.yml](docker-compose.yml) |

### Mode B: 核心服務開發

適合只啟動開發所需的核心服務，不包含完整監控堆疊。

```bash
make dev
make logs
```

### Mode C: Kubernetes / Argo CD

Kubernetes 節點與部署文件入口：

- [docs/K8s_settup_node1.md](docs/K8s_settup_node1.md)
- [docs/K8s_settup_node2.md](docs/K8s_settup_node2.md)
- [docs/K8s_settup_node3.md](docs/K8s_settup_node3.md)
- [k8s](k8s)
- [k8s/argocd](k8s/argocd)

## 核心功能

| 模組 | 功能 |
| --- | --- |
| 帳號 / 權限 | JWT 登入、角色權限、使用者管理與受保護 API |
| 題庫 / 考卷 | 題目建立、測資設定、考卷樣板、考試指派 |
| 應試流程 | 考試頁、倒數計時、程式碼編輯器、草稿保存、提交結果 |
| 監考 / 結果 | 面試官 dashboard、考試狀態、提交紀錄、WebSocket 即時更新 |
| 評測 Worker | RabbitMQ 任務消費、isolate 編譯與執行、公開/隱藏測資 verdict |
| 安全限制 | seccomp、AppArmor、rootfs 隔離、資源限制、違規事件紀錄 |
| 可觀測性 | API metrics、judge pipeline dashboard、RabbitMQ queue、container metrics |
| 負載示範 | 100 位應試者 seed、k6 burst submission、Worker scale watcher |

正式提交會執行公開與隱藏測試案例，只有 `AC` 時更新分數。簡單提交只執行公開測試案例，用於提供即時回饋，不更新分數。應試者草稿儲存在 Redis，並同步到瀏覽器 localStorage，讓 Redis 暫時不可用時考試流程仍可降級運作。

## 常用指令

```bash
make bootstrap       # 若 .env 不存在，從 .env.example 建立
make dev             # 啟動核心服務，不含完整監控堆疊
make up              # 建置並啟動完整 Docker Compose stack
make down            # 停止 stack
make clean           # 停止 stack 並刪除 volumes
make ps              # 顯示服務健康狀態
make logs            # 追蹤所有服務 logs

make test            # 格式化檢查、lint、測試與 build
make coverage        # backend、frontend、worker、puller 覆蓋率

make -C worker build-isolate-rootfs
make -C worker verify-language LANG=cpp17
make -C worker test-integration-isolate
make -C worker list-languages
```

每個子專案對陳述式、分支、函式與行數的測試覆蓋率要求至少達到 85%。

## 測試與品質

| 類型 | 指令 / 文件 | 說明 |
| --- | --- | --- |
| Monorepo CI mirror | `make test` | backend、frontend、worker、puller 的 format check、lint、test、build |
| Coverage | `make coverage` | 產生各模組 coverage report |
| API + Browser E2E | `make EndtoEnd` | 需先啟動 Docker services，執行 Vitest API E2E 與 Playwright browser tests |
| SonarQube | [docs/Sonar_RUN.md](docs/Sonar_RUN.md) | 本地 SonarQube 10.7、coverage 匯入與 quality gate |
| Load test | [loadtest/README.md](loadtest/README.md) | k6 並發提交與 autoscaling 觀測示範 |

SonarQube 本地三步驟摘要：

```bash
docker compose -f docker-compose.sonar.yml up -d sonarqube
make coverage
docker compose -f docker-compose.sonar.yml --profile scan run --rm scanner
```

執行 scanner 前需要先在 SonarQube UI 產生 `SONAR_TOKEN`。完整流程請看 [docs/Sonar_RUN.md](docs/Sonar_RUN.md)。

## 示範與壓測（實體 demo runbook）

對應需求三項 Advanced Requirement。每段可**直接複製**;**📊** 標的是該打開的 Grafana 板與要指的 panel。指令集中在 `loadtest/Makefile`（`make -C loadtest help`）。

**生產 Grafana**（demo 對象 = 已部署的 k3s）：`https://ikmlab.cs.nthu.edu.tw/online_code_test/grafana/`
三張板：`d/oct-api-red`（系統健康）、`d/oct-judge-pipeline`（佇列+擴縮）、`d/oct-lb-resilience`（跨節點分布）。每張板右上角設 **Last 15 min / refresh 5s**。

**前置（打 k3s 生產一次即可）**：
```bash
export OCT_ADMIN_PASSWORD='<root 密碼>'
```

### Demo A — 惡意 / 濫用程式碼被沙箱隔離
> 證明：上傳的惡意程式（無限迴圈 / 記憶體炸彈 / fork bomb / 對外連線 / 讀主機檔 / 提權 syscall）全被 isolate + seccomp 關住，回 TLE/MLE/RE/WA，**主系統不受影響、不外洩**。
```bash
make demo-malicious ENV=prod          # 本地去掉 ENV=prod
```
📊 **API RED**（`d/oct-api-red`）：提交期間 **Global error ratio (5xx) 維持 0%**、**Global p95** 不飆 → 壞 code 被關在判題沙箱，污染不到 BFF。腳本另印 `fixture → verdict` 對照表（全非 AC）。

### Demo B — 高並發提交不塞車（KEDA 自動擴縮）
> 證明：60 人同時提交，靠 RabbitMQ 緩衝 + KEDA 把 worker **1→5** 消化，submit API 維持可用。
```bash
make -C loadtest demo-seed ENV=prod DEMO_N=60
make -C loadtest demo-load ENV=prod DEMO_VUS=60 DEMO_FIXTURE=tle.py
```
📊 **Judge Pipeline & Scaling**（`d/oct-judge-pipeline`）：
- **Queue depth (judge.tasks)**：衝到 ~60 → 被吃回 0
- **Worker replicas** / **Worker desired vs current (KEDA / HPA)**：**1 → 5**
- **Submit API p95 (s)**：維持低 ·  **Verdict rate**：上升

### Demo C — 耗資源程式碼的整體韌性
> 證明：上一段那批 TLE 程式跑滿時限、worker CPU 飽和，但 backend / 前端**完全不受影響** → 判題重負載被隔離在 worker pool。（沿用 Demo B 同一次壓測,切到另一張板看即可。）

📊 **Load Balancing & Resilience**（`d/oct-lb-resilience`）：
- **5xx error ratio by node**：全程 **0%**
- **Backend request rate by node / by pod**：照常服務 ·  **Global p95 latency**：穩定

📊 **Judge Pipeline** 的 **Worker pool CPU %** 飽和、**Verdict totals** 全進 TLE。

### 收尾清理（務必）
```bash
make clean-accounts-apply ENV=prod INCLUDE_LOADTEST=1   # 只刪本次建立的帳號（軟刪除）
```
> 只依 manifest 比對,**不會誤刪先前殘留帳號**。`DELETE` 為軟刪除;壓測產生的提交資料列仍留 DB,需 server 端進 postgres 才能物理清除。

> 更深入的本地 docker-compose 流程與變數在 [loadtest/README.md](loadtest/README.md#安全與穩定性示範demo-abc)。

## 元件文件

| 文件 | 內容 |
| --- | --- |
| [frontend/README.md](frontend/README.md) | React SPA 路由、狀態管理、測試與建置流程 |
| [backend/README.md](backend/README.md) | Fastify API、驗證/RBAC、題目、考試、提交、草稿、違規、指標與 WebSocket 事件 |
| [worker/README.md](worker/README.md) | 評測 Worker、RabbitMQ 協定、isolate sandbox、seccomp、語言 rootfs 與指標 |
| [worker/puller/README.md](worker/puller/README.md) | Kubernetes Worker 使用的每節點語言 rootfs 拉取器 |
| [infra/postgres/README.md](infra/postgres/README.md) | PostgreSQL schema、seed data、scenario data 與測試資料庫設定 |
| [infra/redis/README.md](infra/redis/README.md) | Redis cache、草稿與 WebSocket pub/sub 行為 |
| [loadtest/README.md](loadtest/README.md) | 示範與壓測：Demo A 惡意程式碼隔離、Demo B/C 本地與 k3s 壓測、KEDA 監視器、測試帳號清理 |
| [docs/Sonar_RUN.md](docs/Sonar_RUN.md) | SonarQube 環境架設、coverage 匯入、scanner 與 quality gate |
