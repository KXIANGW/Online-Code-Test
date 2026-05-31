# 評測 Worker

評測 Worker 從 RabbitMQ 消費 `judge.tasks`，在 `isolate` 中編譯並執行提交，將評測結果寫入 PostgreSQL，發布 `judge.results`，並公開健康/指標端點。

## 目前沙箱架構

目前的引擎為 `sio2project/isolate`，配合每語言的 rootfs 目錄樹與可選的 seccomp 包裝器。舊版 Docker/gVisor 執行路徑已不再是生產程式碼的一部分。

| 項目 | 目前行為 |
| --- | --- |
| 引擎 | `createSandboxEngine()` 回傳 `IsolateEngine` |
| Rootfs | `RootfsResolver` 預設解析 `/var/lib/oct/rootfs/<language>` |
| 本地 Rootfs | `make build-isolate-rootfs` 在 `/tmp/oct-rootfs` 下提取已啟用的語言映像 |
| Kubernetes Rootfs | `worker/puller` 在每個節點解包 OCI 映像並原子性地交換符號連結 |
| 隔離 | isolate cgroups、chroot、box ID、每次執行的工作目錄 |
| Seccomp | `oct-seccomp-wrapper` + `isolate-seccomp.policy`，從 `SECCOMP_BUNDLE_DIR` 掛載 |
| 並發 | RabbitMQ `prefetch=1`；透過增加 Worker 程序/Pod 進行水平擴展 |
| 可觀測性 | `HEALTH_PORT`（預設 `8080`）上的 `/healthz` 與 `/metrics` |

## 目錄結構

```text
worker/
├── Dockerfile
├── Makefile
├── sandbox/
│   ├── languages.yaml
│   ├── cpp17/
│   ├── python3/
│   ├── apparmor/
│   └── seccomp-wrapper/
├── scripts/
└── src/
    ├── index.ts
    ├── healthcheck.ts
    ├── metrics.ts
    ├── config/
    ├── consumers/
    ├── db/
    └── engine/
```

重要模組：

- `src/index.ts` 連接 RabbitMQ、宣告佇列/交換器、建立沙箱引擎並啟動消費者。
- `src/consumers/judge.consumer.ts` 協調每個提交的編譯/執行/寫入/發布流程。
- `src/engine/sandbox-engine.ts` 定義引擎介面與 isolate 工廠。
- `src/engine/engines/isolate-engine.ts` 建構 isolate 指令列、讀取 meta/stdout/stderr、分類編譯失敗，並處理沙箱設定錯誤。
- `src/engine/rootfs-resolver.ts` 檢查語言 rootfs 的可用性。
- `src/engine/meta-parser.ts` 將 isolate meta 輸出解析為評測輸入。
- `src/engine/checker.ts` 比對實際輸出與預期輸出。
- `src/engine/languages.ts` 驗證 `sandbox/languages.yaml`。
- `src/db/queries.ts` 載入提交/測試案例，並寫入評測結果、測試案例結果與分數。

## RabbitMQ 協定

| 名稱 | 類型 | 用途 |
| --- | --- | --- |
| `judge.tasks` | durable queue | 後端至 Worker 的任務佇列 |
| `judge.results` | fanout exchange | Worker 至後端的結果事件 |
| `judge.results.backend` | durable queue | 後端消費者綁定 |
| `judge.dlq` | durable queue | 任務傳遞失敗的死信佇列 |

任務訊息：

```json
{ "submissionId": 123, "type": "formal" }
```

結果訊息：

```json
{
  "submissionId": 123,
  "sessionId": 456,
  "examSessionProblemId": 789,
  "type": "formal",
  "verdict": "AC",
  "runtimeMs": 42,
  "memoryKb": 8192
}
```

## 語言設定

語言定義於 `sandbox/languages.yaml`。每個已啟用的語言定義了原始檔名、OCI 映像、可選的 rootfs 路徑、編譯指令、執行指令、記憶體下限與環境變數。Worker 在啟動時讀取此檔案。

常用指令：

```bash
make -C worker list-languages
make -C worker build-language-images
make -C worker build-isolate-rootfs
make -C worker verify-language LANG=cpp17
```

## 開發

```bash
npm install
npm run lint         # TypeScript 檢查
npm test             # 單元測試
npm run coverage     # 單元覆蓋率報告
npm run build        # 編譯至 dist/
```

陳述式、分支、函式與行數的測試覆蓋率須維持在 85% 以上。

額外的整合閘門：

```bash
npm run test:integration
make test-integration-isolate
make verify-language LANG=python3
```

`test-integration-isolate` 與 `verify-language` 需要 Docker 與特權容器執行，因為它們會在 Worker 映像內執行 isolate。

## 環境變數

| 變數 | 用途 |
| --- | --- |
| `RABBITMQ_URL` | RabbitMQ 連線字串 |
| `DATABASE_URL` | PostgreSQL 連線字串 |
| `HOST_WORK_DIR` | 用於編譯與測試案例檔案的主機/工作目錄 |
| `ROOTFS_BASE_DIR` | 語言 rootfs 目錄樹的根目錄 |
| `SECCOMP_BUNDLE_DIR` | 包含 `seccomp-wrapper` 與 `seccomp.policy` 的目錄 |
| `ISOLATE_BOX_ID` | 可選的 isolate box ID 覆蓋值 |
| `HEALTH_PORT` | 健康/指標 HTTP 埠號 |

## 指標

`/metrics` 輸出評測進行中數量、評測結果統計、評測時間、編譯時間、最大記憶體、錯誤計數器與 Worker 資訊。
