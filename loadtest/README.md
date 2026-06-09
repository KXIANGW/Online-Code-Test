# 負載測試

壓測目標預設為**本地 Docker**（`http://localhost:3000/api`）。  
打 Production 需手動傳 `BASE_URL` / `APP_URL`，會建立真實資料，請確認時間窗口。

## 前置

```bash
brew install k6   # 其他平台：https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## 腳本對照

| 腳本 | 測什麼 | 目標 |
| --- | --- | --- |
| `k6-homepage.js` | 首頁 RPS | Production |
| `k6-roles.js` / `run-role-api-tests.sh` | 各角色 API 讀取 | Production |
| `run-bottleneck-tests.sh` | 三個寫入瓶頸（一鍵） | **Local** |
| `k6-start.js` | 同時進入考場（DB 狀態機） | Local |
| `k6-submit.js` | 同時 Run / Submit（MQ + Worker） | Local |

---

## 首頁 RPS（`k6-homepage.js`）

```bash
# smoke
MAX_RPS=1 RAMP_DURATION=1s HOLD_DURATION=1s k6 run loadtest/k6-homepage.js

# 找極限（從 10 爬升到 200 RPS）
k6 run loadtest/k6-homepage.js

# 固定 RPS hold
START_RPS=300 MAX_RPS=300 RAMP_DURATION=30s HOLD_DURATION=5m \
  k6 run loadtest/k6-homepage.js
```

---

## 角色 API 讀取（`k6-roles.js`）

```bash
# smoke（30 秒，各角色 1 RPS）
DURATION=30s ANON_RPS=1 CANDIDATE_RPS=1 INTERVIEWER_RPS=1 \
  PROBLEM_SETTER_RPS=1 ADMIN_RPS=1 \
  k6 run loadtest/k6-roles.js

# 全部角色預設流量（5 分鐘）
k6 run loadtest/k6-roles.js

# 只測特定角色
ROLE_SCENARIOS=candidate CANDIDATE_RPS=20 DURATION=5m k6 run loadtest/k6-roles.js
```

### 產生 Markdown 報告

```bash
# 全部角色
./loadtest/run-role-api-tests.sh

# 指定角色與 RPS
ROLES="candidate interviewer" CANDIDATE_RPS=20 INTERVIEWER_RPS=10 \
  ./loadtest/run-role-api-tests.sh

# 確認展開邏輯但不執行
DRY_RUN=true ./loadtest/run-role-api-tests.sh
```

報告輸出：`loadtest/reports/<timestamp>/role-api-report.md`

---

## 瓶頸寫入（`run-bottleneck-tests.sh`）

三個場景依序執行：`start` → `submit_simple` → `submit_formal`，自動 seed，輸出單一報告。

```bash
# 一鍵跑全部（Local，VUS=100）
./loadtest/run-bottleneck-tests.sh

# 調整並發數
VUS=200 ./loadtest/run-bottleneck-tests.sh

# 只跑指定場景
SCENARIOS="submit_simple submit_formal" ./loadtest/run-bottleneck-tests.sh

# TLE 工作負載
FIXTURE=tle.py VUS=50 ./loadtest/run-bottleneck-tests.sh

# 確認展開邏輯但不執行
DRY_RUN=true ./loadtest/run-bottleneck-tests.sh
```

報告輸出：`loadtest/reports/<timestamp>/bottleneck-report.md`

> **注意**：`start` 場景的 session 是一次性的（狀態機不可逆），每次都會自動重新 seed。

### 單獨執行各場景

**進入考場（start）**

```bash
# 1. seed（每次必跑，N 需 >= VUS）
cd loadtest && N=100 npx tsx seed-start.ts

# 2. k6
VUS=100 k6 run loadtest/k6-start.js
```

**Run 公開測資（submit_simple）**

```bash
# 1. seed（可重複使用同一批 session）
cd loadtest && npx tsx seed.ts

# 2. k6
SUBMISSION_TYPE=simple VUS=100 k6 run loadtest/k6-submit.js
```

**正式提交（submit_formal）**

```bash
# 1. seed（與 submit_simple 共用，已 seed 可跳過）
cd loadtest && npx tsx seed.ts

# 2. k6
VUS=100 k6 run loadtest/k6-submit.js
```

---

## 本地監控

`docker compose up -d` 已包含 Prometheus + Grafana + cAdvisor。

| 服務 | URL | 帳密 |
| --- | --- | --- |
| Grafana | http://localhost:3001 | admin / oct_dev_grafana |
| Prometheus | http://localhost:9090 | — |
| RabbitMQ | http://localhost:15672 | oct / oct_dev_password |
| cAdvisor | http://localhost:8081 | — |

Dashboard：http://localhost:3001/d/oct-demo/oct-demo-e28094-100-concurrent

壓測時把右上角改成 **Last 5 minutes / auto refresh 5s**，觀察：

- **Queue depth** — submit 後是否清空
- **Verdict rate** — Worker 吞吐量
- **Submit API p95** — MQ enqueue 延遲
- **Worker pool CPU %** — Worker 是否飽和

---

## 安全與穩定性示範（Demo A/B/C）

對應需求中的三項 Advanced Requirement。三段可獨立執行；建議 **A 直接打生產示範、B/C 在本地錄影**（B/C 會在 DB 留下大量提交資料）。

### Demo A — 惡意 / 濫用程式碼被沙箱隔離

**證明**：面試者上傳的惡意或濫用程式碼跑在 isolate sandbox 內，回 TLE/MLE/RE 等「被控制」的 verdict，主系統不受影響、不外洩。

惡意 fixtures 在 [`fixtures/malicious/`](fixtures/malicious/)，每支對應一種攻擊向量：

| Fixture | 攻擊情境 | 防護 | 預期 verdict |
| --- | --- | --- | --- |
| `01-infinite-loop.py` | 耗 CPU / 跑不完 | isolate `--time` / `--wall-time` | **TLE** |
| `02-memory-bomb.py` | 吃光記憶體 | isolate `--mem`（cgroup）+ worker `memory:1Gi` | **MLE / RE** |
| `03-fork-bomb.py` | 程序炸彈 | isolate `--processes` 上限 | **RE** |
| `04-network-egress.py` | 把資料送往外部 | 無 `--share-net`，box 只有 loopback | **RE**（連線失敗） |
| `05-read-host-files.py` | 讀主機機密 / 他人資料 | 獨立 rootfs + chroot | **RE**（讀不到主機檔） |
| `06-dangerous-syscall.py` | `unshare()` 等提權 syscall | 自訂 seccomp 政策回 ENOSYS | syscall 被拒（WA/RE） |

**執行（headless 驅動腳本，會自動建帳號、提交、輪詢 verdict）**：

```bash
make demo-malicious                                 # 本地
OCT_ADMIN_PASSWORD='...' make demo-malicious ENV=prod   # k3s 生產（root 登入）
```

腳本會印出 `fixture -> verdict` 對照表。**現場講解**：同時開 Grafana **API RED** 板，指出連續提交惡意程式期間 `Global error ratio (5xx)` 維持 0%、`Global p95` 沒飆 → 證明壞 code 被關在判題沙箱，污染不到 BFF。

> 也可改用 UI 現場操作：以 interviewer 建一個 candidate → 用 candidate 登入 → 在編輯器貼上各 fixture 提交 → 看 verdict。（superuser/root 本身不能交題，務必用 candidate 帳號提交。）UI 手動建立的帳號清理見下方 `--include-loadtest` 或手動指定。

> **統一規則**：以下測試指令不加 = 本地、加 `ENV=prod` = 打 k3s 生產 server。
> 差別只在本地需先 `make demo-up` 起 stack（或用 `make demo-100` 一鍵）；k3s 已部署、由真 KEDA 自動擴縮，直接 seed + load 即可。`ENV=prod` 須先 `export OCT_ADMIN_PASSWORD='...'`。

### Demo B — 高並發提交不塞車（KEDA 自動擴縮）

**證明**：100 人同時提交，靠 RabbitMQ 緩衝 + KEDA 把 worker 從 1 擴到 5 來消化，submit API 維持可用。

```bash
# 本地（一鍵：起 stack + seed + scale-watcher + k6 burst）
make demo-100

# k3s 生產（測試指令同上，只多 ENV=prod；無需 up/watch，KEDA 真實擴縮）
export OCT_ADMIN_PASSWORD='...'
make demo-seed ENV=prod
make demo-load ENV=prod
```

**現場講解**：開 **Judge Pipeline & Scaling** 板，指出 (1) `judge.tasks` 佇列深度先升後被吸收清空；(2) worker pod 數 1→5；(3) submit API p95 維持。結論：突發 100 人同時交沒有塞車也沒當機。

### Demo C — 耗資源程式碼的整體韌性

**證明**：把提交內容換成會 TLE 的程式，worker CPU 飽和，但 backend / 前端仍正常 → 判題負載被隔離在 worker pool。

```bash
# 沿用 Demo B 的 stack / k3s 與 seed，改灌 TLE 工作負載
make demo-load DEMO_FIXTURE=tle.py              # 本地
make demo-load ENV=prod DEMO_FIXTURE=tle.py     # k3s
```

**現場講解**：開 **Load Balancing & Resilience** 板，指出 backend / 前端服務在 worker 飽和期間仍維持回應 → 一個面試者交了耗資源的爛 code，不會拖垮別人的考試。

### 測試帳號清理（重要）

Demo A 的驅動腳本（與 `demo-seed`）建立帳號時，會把 `{id, username}` **立刻**寫進 manifest（`.demo-accounts.json` / `.session-tokens.json`）。清理腳本 [`demo-cleanup.ts`](demo-cleanup.ts) **只依此 manifest 比對**，且一個帳號要同時滿足「在 manifest 內」+「目前仍存在」+「非 superuser」才會被刪——因此**先前殘留的帳號（不在 manifest 內）永遠不會被誤刪**。

```bash
# 本地
make clean-accounts                              # dry-run：先列出會刪什麼（只看 Demo A 帳號）
make clean-accounts-apply                        # 確認無誤後才真的 DELETE /users/:id
make clean-accounts-apply INCLUDE_LOADTEST=1     # 連 seed.ts 建立的 Demo B/C 帳號一起清

# k3s 生產（統一加 ENV=prod；須先 export OCT_ADMIN_PASSWORD）
make clean-accounts ENV=prod INCLUDE_LOADTEST=1            # dry-run
make clean-accounts-apply ENV=prod INCLUDE_LOADTEST=1     # 真的刪
```

| 旗標 / 變數 | 作用 |
| --- | --- |
| `clean-accounts` vs `clean-accounts-apply` | 前者 dry-run、後者真的刪除（傳入 `--confirm`） |
| `INCLUDE_LOADTEST=1` | 額外納入 `seed.ts` 寫的 `.session-tokens.json`（清 Demo B/C 帳號用；確認該檔是本次 run 產生才加） |
| `ENV=prod` | 改打 k3s 生產 server，並以 `root` + `OCT_ADMIN_PASSWORD` 登入執行刪除 |

> **限制**：`DELETE /users/:id` 為**軟刪除**（設 `deletedAt`），帳號列表會看不到但資料列仍在 DB；壓測產生的提交 / 考場資料列同樣殘留。要物理清除需在 server 端 `kubectl exec` 進 postgres 處理（本機無生產 DB 連線）。

---

## 環境變數

### `run-bottleneck-tests.sh`

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000/api` | API 位址 |
| `VUS` | `100` | 並發數（需 <= seed N） |
| `SCENARIOS` | `start submit_simple submit_formal` | 執行的場景 |
| `FIXTURE` | `ac.py` | 提交程式碼：`ac.py` / `wa.py` / `tle.py` |
| `DRY_RUN` | `false` | `true` 只印指令不執行 |

### `k6-homepage.js`

| 變數 | 預設值 |
| --- | --- |
| `TARGET_URL` | `https://ikmlab.cs.nthu.edu.tw/online_code_test/` |
| `START_RPS` | `10` |
| `MAX_RPS` | `200` |
| `RAMP_DURATION` | `5m` |
| `HOLD_DURATION` | `3m` |

### `k6-roles.js`

| 變數 | 預設值 |
| --- | --- |
| `APP_URL` | `https://ikmlab.cs.nthu.edu.tw/online_code_test/` |
| `DURATION` | `5m` |
| `ANON_RPS` | `20` |
| `CANDIDATE_RPS` | `5` |
| `INTERVIEWER_RPS` | `2` |
| `PROBLEM_SETTER_RPS` | `2` |
| `ADMIN_RPS` | `1` |
| `CANDIDATE_WRITE_DRAFTS` | `false` |
| `INCLUDE_PASSWORD_LOOKUPS` | `false` |

### `demo-malicious.ts`

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000/api` | API 位址（生產：`https://ikmlab.cs.nthu.edu.tw/online_code_test/api`） |
| `INTERVIEWER_USERNAME` / `INTERVIEWER_PASSWORD` | `alice` / `Test@1234` | 建帳號 / 考場的身分（生產用 `root`） |
| `SEED_PROBLEM_ID` | `1` | 提交綁定的題目 |
| `DEMO_LANGUAGE` | `python3` | 提交語言 |
| `POLL_TIMEOUT_MS` | `30000` | 單支提交等待判題結果的逾時 |

### `demo-cleanup.ts`

| 變數 / 旗標 | 預設值 | 說明 |
| --- | --- | --- |
| `--confirm` / `APPLY=true` | （未設＝dry-run） | 真的執行刪除 |
| `--include-loadtest` | （未設） | 納入 `.session-tokens.json`（seed.ts 帳號） |
| `BASE_URL` | `http://localhost:3000/api` | 目標 API |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `root` / `Root@1234` | 執行刪除的 superuser |
