# OCT Demo runbook

對應需求三項 Advanced Requirement：**惡意程式碼隔離 / 高並發不塞車 / 耗資源不拖垮系統**。每段可直接複製;**📊** 是該打開的 Grafana 板與要指的 panel。

## 心智模型（記這 4 點就夠）
- `demo-seed` = 建考場（帳號+session），**只跑一次**；不交題、不吃 fixture。
- `demo-load` = 交題，**可對同一批 session 連跑多輪**；`DEMO_FIXTURE` 決定交什麼（`tle.py` 看擴縮 / `ac.py` 看正常解）。
- `demo-malicious` = 獨立指令，自己建 1 帳號交 6 支惡意程式，跟 seed/load 無關。
- 加 `ENV=prod` = 打生產 k3s（要先 `export OCT_ADMIN_PASSWORD`）；不加 = 本地。

## 前置（一次）
```bash
export OCT_ADMIN_PASSWORD='Root@1234'
```
Grafana（右上角設 **Last 15 min / refresh 5s**）：
- API RED `…/grafana/d/oct-api-red`
- Judge Pipeline `…/grafana/d/oct-judge-pipeline`
- LB & Resilience `…/grafana/d/oct-lb-resilience`

---

# Demo A — 惡意 / 濫用程式碼被沙箱隔離

```bash
make -C loadtest demo-malicious ENV=prod
```
腳本會自動建 1 個應試者、連續提交 6 支惡意程式、印出 `verdict / runtimeMs / memoryKb` 對照表。

📊 **API RED**（`d/oct-api-red`）：提交期間 `Global error ratio (5xx)` 維持 **0%**、`Global p95` 不飆 → 壞 code 被關在判題沙箱，污染不到 BFF。

## 6 種攻擊 + 實測數據如何佐證「擋住」

| # | 攻擊（fixture） | 擋下的那一層 | verdict | runtimeMs | memoryKb | 這組數字怎麼證明擋住 |
|---|---|---|---|---|---|---|
| 1 | `01-infinite-loop` 耗 CPU | isolate `--time` / `--wall-time` | **TLE** | 3000 | 3796 | runtimeMs 卡在 3000ms = 題目時限整數，被強制終止，沒讓它無限跑 |
| 2 | `02-memory-bomb` 吃 RAM | isolate `--mem`（cgroup）+ pod 1Gi | **RE** | 212 | 464444（≈453 MB） | 只配置到 ~453 MB、212ms 內就被殺，沒吃光節點 RAM |
| 3 | `03-fork-bomb` 程序炸彈 | isolate `--processes` | **RE** | 52 | 89868 | 52ms 觸及程序上限即 OSError 終止，worker 不崩、沒擴散 |
| 4 | `04-network-egress` 外洩資料 | 獨立 net namespace（無 `--share-net`） | **RE** | 53 | 8952 | `connect()` 53ms 內失敗（無對外網路），`LEAKED` 從未印出 |
| 5 | `05-read-host-files` 讀主機機密 | 獨立 rootfs + chroot | **RE** | 31 | 3712 | `open()` 31ms 立即失敗（讀不到 `/etc/shadow` 等），無檔案內容外流 |
| 6 | `06-dangerous-syscall` unshare 提權 | 自訂 seccomp（ENOSYS） | **WA** | 113 | 11420 | `unshare` 回 errno=38、無法建 namespace；輸出與題目不符 → WA（非 crash） |

> **鐵則：6 種全部非 AC** —— 惡意 / 濫用程式碼一個都拿不到分。

> **數據來源**：上表完整數值（verdict + runtimeMs + memoryKb）取自**本地 k3s 重現環境**那次 `demo-malicious`（單節點、與生產同拓樸）。生產那次 Demo A 的 verdict **完全一致**（TLE/RE/RE/RE/RE/WA），只是當時只擷取了 verdict 欄、沒留 runtime/memory。

---

# Demo B — 高並發提交不塞車（KEDA 自動擴縮）

```bash
make -C loadtest demo-seed ENV=prod DEMO_N=60
make -C loadtest demo-load ENV=prod DEMO_VUS=60 DEMO_FIXTURE=tle.py
```
📊 **Judge Pipeline & Scaling**（`d/oct-judge-pipeline`）：
- `Queue depth (judge.tasks)`：衝到 ~60 → 被吃回 0
- `Worker replicas` / `Worker desired vs current (KEDA / HPA)`：**1 → 5**
- `Submit API p95 (s)`：維持低　·　`Verdict rate`：上升

一句話：突發 60 人同時交，靠 RabbitMQ 緩衝 + KEDA 擴 worker 消化，不塞車不當機。
（用 `tle.py` 才看得到擴縮；`ac.py` 判太快、佇列秒空看不到。）

# Demo C — 耗資源不拖垮主系統

> 不用新指令，就是 Demo B 的 tle.py 壓測**進行中**，切到另一張板看。

📊 **Load Balancing & Resilience**（`d/oct-lb-resilience`）：
- `5xx error ratio by node`：全程 **0%**
- `Backend request rate by node`：跨節點正常分流

一句話：判題重負載被隔離在 worker pool，一個爛 code 不影響別人考試。

# （可選）正常解照樣 AC

```bash
make -C loadtest demo-load ENV=prod DEMO_VUS=60 DEMO_FIXTURE=ac.py
```
對**同一批 session** 再交一次（不用重新 seed）。預期全 `AC`、`5xx` 維持 0%。

---

# 收尾清理（務必）

```bash
make -C loadtest clean-accounts-apply ENV=prod INCLUDE_LOADTEST=1
```
只刪本次建立的帳號（依 manifest，不誤刪舊帳號）。軟刪除；submission 資料列仍留 DB。

---

## （可選）用 CLI 確認 verdict 分布
壓測後在 repo 根目錄跑，確認這次提交都判對：
```bash
python3 - <<'PY'
import json,urllib.request,collections
B="https://ikmlab.cs.nthu.edu.tw/online_code_test/api"
toks=json.load(open("loadtest/.session-tokens.json"))
def g(p,t):
    r=urllib.request.Request(B+p,headers={"Authorization":"Bearer "+t});return json.load(urllib.request.urlopen(r,timeout=20))
c=collections.Counter()
for t in toks:
    a=g(f"/exam-sessions/{t['sessionId']}/submissions",t["token"]);a=a if isinstance(a,list) else a.get("data",[])
    s=max(a,key=lambda x:x.get("id",0)) if a else None   # 取最新一筆
    c[(s.get("verdict") or s.get("status")) if s else "(none)"]+=1
print(dict(c))
PY
```
預期：tle.py 輪 → `{'TLE': 60}`；ac.py 輪 → `{'AC': 60}`。
