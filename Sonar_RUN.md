# SonarQube 環境架設與執行流程

> 在本地端起一座 SonarQube Community 10.7，對 OCT monorepo 的 frontend / backend / worker
> 三個模組做靜態品質分析（bugs、code smells、duplications、coverage）。

---

## 目錄

1. [架構概覽](#架構概覽)
2. [前置需求](#前置需求)
3. [TL;DR — 三步驟跑完一輪](#tldr--三步驟跑完一輪)
4. [詳細流程](#詳細流程)
   - [① 啟動 SonarQube 容器](#-啟動-sonarqube-容器)
   - [② 首次登入 + 產 token](#-首次登入--產-token)
   - [③ 產 coverage（三個 tree）](#-產-coverage三個-tree)
   - [④ 執行 SonarScanner](#-執行-sonarscanner)
   - [⑤ 查看 Dashboard](#-查看-dashboard)
5. [日常維護](#日常維護)
6. [模組結構](#模組結構sonar-project-properties-怎麼配)
7. [Quality Gate](#quality-gate)
8. [常見問題排除](#常見問題排除)
9. [CI / CD 整合](#ci--cd-整合)
10. [相關檔案](#相關檔案)

---

## 架構概覽

```
                ┌─────────────────────────────────┐
                │  docker-compose.sonar.yml       │
                │                                 │
   localhost ◀──┤  oct-sonarqube   :9000         │
                │      ▲                          │
                │      │ JDBC                     │
                │  oct-sonar-db (postgres 16.4)  │
                │                                 │
                │  oct-sonar-scanner (profile)   │
                │    ↳ 跑完即退出，讀 lcov 上傳   │
                └─────────────────────────────────┘
                          ▲
                          │ reads from host fs
                          │
            ┌─────────────┼─────────────┐
            │             │             │
   frontend/coverage   backend/coverage   worker/coverage
        lcov.info        lcov.info         lcov.info
```

跟主 `docker-compose.yml` 完全隔離（獨立 network、獨立 Postgres、port 9000 不衝突），可以同時跑、互不干擾。

---

## 前置需求

| 工具 | 版本 | 驗證 |
|------|------|------|
| Docker Engine | ≥ 24 | `docker --version` |
| Docker Compose | v2 | `docker compose version` |
| Node.js | 22+ | `node --version` |
| Postgres (主 docker-compose 內) | 16 | 跑 backend coverage 時需要 |

主 `docker-compose.yml` 內的 `oct-postgres-1` 必須處於 healthy（backend 整合測試會連 `oct_test` DB）。

```bash
docker compose ps postgres
# 應顯示 healthy；若沒起就 `make up` 或 `docker compose up -d postgres`
```

---

## TL;DR — 三步驟跑完一輪

```bash
# 1. 起 SonarQube（首次 ~90 秒）
docker compose -f docker-compose.sonar.yml up -d sonarqube

# 2. 產 coverage
(cd frontend && npx vitest run --coverage) && \
(cd backend  && npx vitest run --coverage) && \
(cd worker   && npx vitest run --coverage)

# 3. 跑 scanner（需要先去 UI 拿 token，見下文）
export SONAR_TOKEN=sqp_xxxxxxxxxxxxxxxx
docker compose -f docker-compose.sonar.yml --profile scan run --rm scanner

# 結果
open http://localhost:9000/dashboard?id=oct
```

---

## 詳細流程

### ① 啟動 SonarQube 容器

```bash
docker compose -f docker-compose.sonar.yml up -d sonarqube
```

這會起：
- `oct-sonar-db`（Postgres 16.4，存 SonarQube 分析歷史）
- `oct-sonarqube`（SonarQube 10.7 community，web UI + 分析引擎）

兩個容器都有 healthcheck。第一次 boot 約需 **90–120 秒**（Elasticsearch 啟動）。

等待 ready：

```bash
until curl -sf http://localhost:9000/api/system/status | grep -q '"status":"UP"'; do
  printf "."; sleep 5
done; echo " UP"
```

或直接打開 <http://localhost:9000>，看到登入頁就 OK。

### ② 首次登入 + 產 token

```
帳號：admin
密碼：admin   ← 首次登入會強制改密碼
```

改完密碼後：

1. 右上角頭像 → **My Account → Security**
2. 在 **Generate Tokens** 區：
   - Name：`oct-local`（隨意）
   - Type：**User Token**
   - Expires：**No expiration**（local dev）
3. 點 **Generate**
4. 跳出 `sqp_xxxxxxxxxxxxxxxx` 字串 → **馬上複製**（離開頁面後再也看不到）
5. 存進 env：

```bash
export SONAR_TOKEN=sqp_xxxxxxxxxxxxxxxx
# 想長久存在，加進 ~/.zshrc 或 ~/.bashrc
```

> ⚠️ token 等同密碼，**不要 commit 進 repo**，不要分享。
> 之後需要在 CI 跑時，會在 GitHub Settings → Secrets 加一支不同的 token。

### ③ 產 coverage（三個 tree）

`vitest run --coverage` 會 emit `coverage/lcov.info`，是 SonarScanner 唯一吃的格式。

```bash
# Frontend（純 node，無外部依賴）
(cd frontend && npx vitest run --coverage)

# Backend（需要 oct-postgres-1 healthy + oct_test DB）
(cd backend  && npx vitest run --coverage)

# Worker（純 unit，無外部依賴；不含 integration test）
(cd worker   && npx vitest run --coverage)
```

驗證：

```bash
ls -la frontend/coverage/lcov.info backend/coverage/lcov.info worker/coverage/lcov.info
```

> ℹ️ Sonar 的 **Bugs / Code Smells / Duplications** 來自靜態分析，**不依賴 lcov**；
> 只有 **Coverage 欄位**會反映 lcov 新鮮度。
> 所以「忘了重跑 coverage 還是可以掃」，只是 coverage 數字會是舊的。

### ④ 執行 SonarScanner

```bash
docker compose -f docker-compose.sonar.yml --profile scan run --rm scanner
```

這條指令：
- 起一個一次性的 `sonarsource/sonar-scanner-cli:11.1` container
- 透過 compose network 連到 `http://sonarqube:9000`
- 把 repo 整個 mount 進 `/usr/src`
- 讀 `sonar-project.properties` → 分析三個模組 → 上傳結果 → 自我銷毀

預期輸出最後幾行：

```
INFO  EXECUTION SUCCESS
INFO  Total time: 1:37.452s
INFO  Final Memory: 18M/76M
```

若看到 **EXECUTION FAILURE**，往上拉看錯誤訊息（多半是 token 無效 / coverage 路徑找不到 / sources 路徑寫錯）。

### ⑤ 查看 Dashboard

```
http://localhost:9000/dashboard?id=oct
```

會看到四個主要區塊：

| 區塊 | 解讀 |
|------|------|
| **Quality Gate** | Passed / Failed — 預設套用「Sonar way」（new code 要 ≥ 80% coverage、0 bugs）|
| **Reliability** | Bugs 數量與 rating（A–E）|
| **Security** | Vulnerabilities + Security Hotspots |
| **Maintainability** | Code Smells + Technical Debt（小時數估算）|
| **Coverage** | 三個模組各自的覆蓋率 |
| **Duplications** | 重複程式碼比例 |

點任一指標可以下鑽到檔案層級，看具體哪幾行被標。

---

## 日常維護

### 重新掃描（最常用）

```bash
# 程式碼有改動 → 重產 coverage + 重新 scan
(cd frontend && npx vitest run --coverage)
(cd backend  && npx vitest run --coverage)
(cd worker   && npx vitest run --coverage)
docker compose -f docker-compose.sonar.yml --profile scan run --rm scanner
```

每次 scan 都會疊加到 SonarQube 的歷史，可以從 Dashboard 看 trend。

### 暫停（保留分析歷史）

```bash
docker compose -f docker-compose.sonar.yml down
```

下次 `up -d` 再起來，所有歷史都還在（資料在 `sonar_db` volume）。

### 完全重置（清掉 DB + 歷史）

```bash
docker compose -f docker-compose.sonar.yml down -v
```

重來時 admin 密碼也回到 `admin`。

### 看 SonarQube log（疑難排解時）

```bash
docker compose -f docker-compose.sonar.yml logs -f sonarqube
```

---

## 模組結構（`sonar-project.properties` 怎麼配）

OCT 是 monorepo，三個 tree 都有獨立 `package.json` 與 `tsconfig.json`，因此宣告為三個獨立 module：

```properties
sonar.projectKey=oct
sonar.modules=frontend,backend,worker
```

每個 module 各自設定（範例為 frontend）：

| Property | 值 | 為什麼 |
|----------|-----|--------|
| `sonar.projectBaseDir` | `frontend` | 後續所有路徑都相對於這 |
| `sonar.sources` | `src` | 只分析業務碼 |
| `sonar.tests` | `src/__test__` | 標為 test code（不算 LoC、不算 duplication）|
| `sonar.exclusions` | `node_modules/**, dist/**, coverage/**, *.test.*, src/main.tsx` | 排掉 build 產物與 test 檔避免噪音 |
| `sonar.coverage.exclusions` | 同上加 `__test__/**` | 計算 coverage 時排掉 |
| `sonar.javascript.lcov.reportPaths` | `coverage/lcov.info` | 相對於 baseDir，由 vitest emit |
| `sonar.typescript.tsconfigPath` | `tsconfig.json` | 給 Sonar 解析 TS module resolution，否則會噴一堆假陽性 |

backend / worker 的設定結構相同，只是檔名路徑各自不同。

---

## Quality Gate

### 預設

第一次掃描自動套用 **Sonar way**：

| 條件 | 門檻 |
|------|------|
| New Code 覆蓋率 | ≥ 80% |
| New Code 重複率 | ≤ 3% |
| New Code Bugs | 0 |
| New Code Vulnerabilities | 0 |
| New Code Security Hotspots Reviewed | 100% |
| New Code Maintainability Rating | A |
| New Code Reliability Rating | A |
| New Code Security Rating | A |

「New Code」= 上次 scan 後新增 / 修改的程式碼。**歷史包袱不會算**，所以剛接手的舊 repo 也能過。

### 自訂門檻

UI → **Quality Gates → Create**，可以複製「Sonar way」改條件（例如把 80% coverage 放寬到 70%）。
建好後在 **Projects → Project Settings → Quality Gate** 指派給 `oct`。

---

## 常見問題排除

### `EXECUTION FAILURE` + `Not authorized`

token 沒設或無效。

```bash
echo "$SONAR_TOKEN"   # 應顯示 sqp_...
```

若是空的，回 ② 重產 token。

### `Coverage report not found`

```
WARN  Could not resolve 1 file paths in [coverage/lcov.info]
```

coverage 沒產出。檢查：

```bash
ls -la <module>/coverage/lcov.info
```

不存在就回 ③ 跑 `npx vitest run --coverage`。

### Backend 跑 coverage 卡在連線錯誤

backend 整合測試需要 `oct-postgres-1` healthy 且 `oct_test` DB 存在。

```bash
docker ps --filter "name=postgres" --format "{{.Names}} {{.Status}}"
# 看不到 healthy 就先 `docker compose up -d postgres`

docker exec oct-postgres-1 psql -U oct -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='oct_test';"
# 應回 1；不是就跑 infra/postgres/50-create-testdb.sql
```

### SonarQube 起不來 / 一直 unhealthy

第一次 boot Elasticsearch 慢，至少等 2 分鐘。仍掛掉看 log：

```bash
docker compose -f docker-compose.sonar.yml logs sonarqube | tail -50
```

常見：
- **memory map count 限制**（Linux）：`sudo sysctl -w vm.max_map_count=262144`
- **記憶體不足**：SonarQube 最少 2GB RAM，Docker Desktop 預設常常不夠

### Dashboard 顯示「No measures」

Scan 跑了但結果沒上去。確認：
1. `sonar.projectKey=oct` 跟 URL 一致（`/dashboard?id=oct`）
2. scanner log 最後是 `EXECUTION SUCCESS`
3. 重整瀏覽器（分析結果是非同步處理，可能要等幾秒）

### 改了 `sonar-project.properties` 後沒生效

scanner image 是讀 host 上的檔案，但容器內可能有 cache。砍掉重跑：

```bash
docker compose -f docker-compose.sonar.yml --profile scan run --rm scanner
# scanner 用 --rm，每次都是新 container，不會 cache
```

如果還是怪，就重啟 sonarqube：

```bash
docker compose -f docker-compose.sonar.yml restart sonarqube
```

---

## CI / CD 整合

已實裝於 [`.github/workflows/sonar.yml`](.github/workflows/sonar.yml)。
**Quality Gate 不過 → PR 不能 merge**。

### 觸發條件

| 事件 | 分支 | 為什麼這樣設 |
|------|------|--------------|
| `pull_request` | `main` / `develop` / `release/**` | PR 入長壽分支時擋掉 |
| `push` | `main` / `develop` | 合入後重跑一次當作 post-merge audit |

feature branch 一般 push 不會觸發（每次跑 ~5–8 分鐘太貴），仍由 [`ci.yml`](.github/workflows/ci.yml) 跑 lint + test + build。

### 設計亮點

1. **不依賴外部 SonarQube** — 整個 workflow 用 GitHub Actions services 把 `sonarqube:10.7.0-community` + `postgres:16.4-alpine` 與既有 OCT 服務（postgres / redis）一起拉起來，沒有 `SONAR_HOST_URL` secret 要管。
2. **Token 在 job 內動態產生** — 用 SonarQube 預設的 `admin:admin` 呼叫 `/api/user_tokens/generate`，每次 run 產生獨立 token（透過 `::add-mask::` 在 log 中遮罩）。GitHub Secrets 不需要任何 Sonar 相關設定。
3. **走兩支官方 action** — [`SonarSource/sonarqube-scan-action@v3.1.0`](https://github.com/SonarSource/sonarqube-scan-action) 跑掃描、[`SonarSource/sonarqube-quality-gate-action@v1.1.0`](https://github.com/SonarSource/sonarqube-quality-gate-action) 輪詢 Quality Gate 並回傳 exit code。
4. **失敗時自動 dump QG breakdown** — `if: failure()` 那步呼叫 `qualitygates/project_status` 把每條 condition 印出，PR reviewer 不用點進 CI artifact。

### Trade-off

| 維度 | 數字 |
|------|------|
| 每次 run 時間 | ~5–8 分鐘（SonarQube boot ~90s + analysis ~2–3 分鐘 + QG poll）|
| Runner RAM 占用 | ~3 GB（SonarQube 2 GB + vitest 0.5 GB + headroom）|
| 歷史趨勢 | ❌ 每次 SonarQube DB 都是新的，看不到跨 run 的 trend；要看趨勢請跑本地 `docker compose -f docker-compose.sonar.yml up -d` |
| 跨 module 隔離 | ✅ 三個 module 各自分析、各自的 coverage / hotspot 列表 |

### 想看更詳細

直接讀 [`.github/workflows/sonar.yml`](.github/workflows/sonar.yml) — 約 130 行，每段都有 comment 說明為什麼這樣寫（例如為什麼要再額外 wait SonarQube fully ready，為什麼用 admin/admin 而不是 Secrets 帶 token）。

---

## 相關檔案

| 檔案 | 用途 |
|------|------|
| [docker-compose.sonar.yml](./docker-compose.sonar.yml) | SonarQube + Postgres + scanner 編排（本地用）|
| [sonar-project.properties](./sonar-project.properties) | monorepo 三模組設定 |
| [.github/workflows/sonar.yml](./.github/workflows/sonar.yml) | PR-blocking Quality Gate workflow |
| [frontend/vite.config.ts](./frontend/vite.config.ts) | frontend vitest 含 lcov reporter |
| [backend/vitest.config.ts](./backend/vitest.config.ts) | backend vitest 含 lcov reporter |
| [worker/vitest.config.ts](./worker/vitest.config.ts) | worker vitest 含 lcov reporter |
| [RequirementConverting.md](./RequirementConverting.md) | AC 與測試對映（Sonar coverage 數字的「為什麼」）|
