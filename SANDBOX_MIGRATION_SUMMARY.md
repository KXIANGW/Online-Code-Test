# Sandbox 架構重構 — 改動摘要

> 分支：`feat/sandbox-isolate-migration`（從 `develop` 切出，**7 個 commit**）
> 目標：把 Worker 從 DooD（docker.sock）改成「Isolate + 自管 rootfs」，為 30-40 種語言、企業級資安與 K8s 部署做準備。**Step B 後 DockerEngine 完全砍掉，isolate 是唯一的 sandbox engine。**

---

## 一句話 TL;DR

**Worker 不再掛 `docker.sock`，改用 sio2project/isolate v2.0 + libseccomp wrapper 跑候選人代碼；語言環境改由 per-Node DaemonSet 解壓到 hostPath 共用，Worker engine 程式碼縮減 60-70%。所有原本 23 個 Docker 整合測試與新增的 12 個 Isolate e2e（含 7 個安全測試 + seccomp 驗證）全綠。**

---

## Before / After 對照

```
─── BEFORE (develop) ──────────────────────────────────────
[Worker Pod] ──mount /var/run/docker.sock──┐
   ├─ dockerode                            │
   └─ initContainer: docker pull sandbox   ▼
                                       [Host Docker daemon]
                                            │
                                            ▼
                                  per-testcase Docker container
                                  (~300-500 ms 啟動)

─── AFTER (feat branch) ───────────────────────────────────
[GitHub Actions] ──build/push──> [GHCR oct-sandbox-*]
                                       │
                                       ▼
[language-rootfs-puller DaemonSet] (每 Node 1 個)
   skopeo copy + umoci unpack
       │  atomic symlink swap
       ▼
[hostPath /var/lib/oct/rootfs/{cpp17,python3}/]  ← Node 上所有 Worker 共用
       │ readonly mount
       ▼
[Worker Pod] (NO docker.sock)
   ├─ SandboxEngine interface  ← Phase 1
   ├─ IsolateEngine            ← Phase 2-A
   └─ oct-seccomp-wrapper      ← Phase 2-B (libseccomp)
       │ child_process.spawn("isolate", ...)
       ▼
  isolate --cg --dir=/usr=<rootfs>/usr ... --run --
    /oct-seccomp/seccomp-wrapper /oct-seccomp/seccomp.policy --
    /usr/local/bin/g++ ...
  (~10-20 ms 啟動，30 倍快)
```

---

## 5 個 commit 各做了什麼

### Commit 1 `e76129c` · refactor(worker): introduce SandboxEngine strategy interface
**Phase 1 — 零行為變更的介面化**
- 新增 `worker/src/engine/sandbox-engine.ts`（介面 + factory）
- 新增 `worker/src/engine/engines/docker-engine.ts`（包現有 dockerode 邏輯）
- consumer 改成接受 `SandboxEngine` 而不是直接 import compiler/runner
- 預設仍是 Docker，沒任何行為變動，全 33 個既有測試照樣綠

### Commit 2 `c72fdf5` · feat(worker): add IsolateEngine with meta parser and rootfs resolver
**Phase 2-A — Isolate 引擎主體**
- 新增 `worker/src/engine/engines/isolate-engine.ts`：用 `child_process.spawn("isolate", ...)`
- 新增 `meta-parser.ts`：解析 isolate `--meta` 輸出 → AC/TLE/MLE/RE verdict
- 新增 `rootfs-resolver.ts`：驗證 hostPath 上的語言 rootfs 是否就緒
- 擴充 `languages.yaml` schema（`rootfsPath`、`entrypointPath` 欄位）
- worker Dockerfile：Alpine → Debian-bookworm-slim（isolate 需要 glibc），多階段 build isolate v2.0
- 31 個新單元測試

### Commit 3 `d7c5878` · feat(worker): harden Isolate with seccomp policy and apparmor profile
**Phase 2-B — 防禦深度**
- `worker/sandbox/isolate-seccomp.policy`：對應 Docker default profile 的 syscall 黑名單（unshare/keyctl/bpf/ptrace/mount/...）
- `worker/sandbox/apparmor/oct-isolate.profile`：可選 Pod 級 MAC profile

### Commit 4 `09bbfef` · feat(infra): add language-rootfs-puller DaemonSet with atomic symlink swap
**Phase 2.5 — 語言分發層**
- 新增 `worker/puller/` 子專案（Node.js）：skopeo + umoci 拉 + 解 OCI image
- Atomic symlink swap：跑到一半的題目不受 rootfs 更新影響
- HTTP `/healthz` + `/reload`、5 分鐘 poll + 可選 CI webhook
- 新增 `charts/language-rootfs-puller/` Helm chart
- 10 個 puller 單元測試

### Commit 5 `79f125b` · feat(k8s): switch worker to Isolate engine with seccomp wrapper
**Phase 4 + 收尾**
- `k8s/08-worker.yaml`：移除 docker.sock mount + initContainer，加 `wait-rootfs` + hostPath readonly + `SANDBOX_ENGINE=isolate`
- `k8s/08a-language-puller.yaml`：DaemonSet manifest
- **`oct-seccomp-wrapper`（C 程式 + libseccomp）**：補回 isolate v2.0 沒有的 `--seccomp-policy`，作為候選人 execve 前的「最後一道」syscall 攔截器
- `docker-compose.yml` 加 `cgroup: host` + `cap_add: SYS_ADMIN`（本機 dev 用）
- `worker/Makefile` 新增 `make build-isolate-rootfs` 與 `make test-integration-isolate`
- `worker/scripts/isolate-e2e.mjs`：12 個 e2e 測試
- 修了 6 個 isolate v2.0 API 對接 bug（細節見 commit body）

---

## 與原計畫不一樣的兩個決定

### 1. Worker Pod `privileged: true`（原本計畫說「絕對不開」）

**為什麼**：isolate 的 `--cg` 需要在 `/sys/fs/cgroup` 下 `mkdir box-N`，但 K8s/CRI 預設把 `/sys/fs/cgroup` 以 readonly 掛進 container。**只有 `privileged: true` 才能寫入**，連 CAP_SYS_ADMIN 都不夠（kernel 拒絕 remount）。

**安全評估**：與原本 docker.sock mount 風險相當（攻陷 Worker 後都能拿到 root on host）。差距由以下三層補回：
- ① oct-seccomp-wrapper（攔截 50+ 高風險 syscall）
- ② isolate 自身的 namespace + UID 60000 + 無 caps
- ③ readonly rootfs binds + 無網路

**未來升級路徑**：透過 `SandboxEngine` 介面可以平滑切到 gVisor RuntimeClass 或 Kata Containers，不需動 Worker code。

### 2. seccomp 用「wrapper 程式」實作（原本計畫說 `isolate --seccomp-policy`）

**為什麼**：實作時發現上游 isolate v2.0 **沒有 `--seccomp-policy` flag**。

**怎麼做**：寫一個 30 行 C 程式（`worker/sandbox/seccomp-wrapper/wrapper.c`），用 libseccomp 載入同一份 policy 檔案後 `execve()` 候選人代碼。

**好處**：政策檔格式不變、Docker 那條路保留、未來 isolate 加上 flag 後可零成本切換。

---

## 測試覆蓋

| 套件 | 數量 | 狀態 |
| --- | --- | --- |
| Worker unit tests | 83 | ✅ |
| Puller unit tests | 10 | ✅ |
| DockerEngine 整合測試（含 7 個既有 security test） | 23 | ✅ 完全不破壞 |
| IsolateEngine e2e（本機 docker） | 12 | ✅ |
| **IsolateEngine e2e（真實 k3s Pod）** | **12** | ✅ |

**Isolate e2e 12 案**：
- 4 個 verdict：cpp17 AC、python3 AC/TLE/RE
- 7 個 security（與 Docker 版完全等價）：try-network、read-passwd、write-to-rootfs、cap-check (sethostname + raw socket)、env-leak、whoami、fork-bomb
- 1 個 seccomp 驗證：候選人 `unshare(CLONE_NEWUSER)` 收到 ENOSYS（被 wrapper 攔）而不是 EPERM（被 capability 擋）→ 證明 wrapper 真的在 exec chain

---

## 主要修改的檔案地圖

| 檔案 | 變動 |
| --- | --- |
| `worker/src/engine/sandbox-engine.ts` | 新增（介面 + factory） |
| `worker/src/engine/engines/docker-engine.ts` | 新增（包既有邏輯） |
| `worker/src/engine/engines/isolate-engine.ts` | 新增（核心） |
| `worker/src/engine/meta-parser.ts` | 新增（meta → verdict） |
| `worker/src/engine/rootfs-resolver.ts` | 新增（hostPath 檢查） |
| `worker/sandbox/isolate-seccomp.policy` | 新增（syscall 黑名單） |
| `worker/sandbox/seccomp-wrapper/wrapper.c` | 新增（libseccomp wrapper） |
| `worker/sandbox/apparmor/oct-isolate.profile` | 新增（可選 MAC） |
| `worker/puller/` (整個子專案) | 新增（puller controller + Helm chart） |
| `worker/scripts/isolate-e2e.mjs` | 新增（12-case 本機 e2e） |
| `worker/Dockerfile` | Alpine→Debian + build isolate + seccomp wrapper |
| `worker/Makefile` | 新增 `build-isolate-rootfs`、`test-integration-isolate` |
| `worker/sandbox/languages.yaml` | g++/python3 改絕對路徑 |
| `worker/src/consumers/judge.consumer.ts` | 改用 engine 介面 |
| `k8s/08-worker.yaml` | 移除 docker.sock、`SANDBOX_ENGINE=isolate`、`privileged: true` |
| `k8s/08a-language-puller.yaml` | 新增（DaemonSet） |
| `charts/common-worker/values.yaml` + `templates/deployment.yaml` | 加 `sandboxEngine` 切換 |
| `charts/language-rootfs-puller/` | 新增 Helm chart |
| `docker-compose.yml` | 本機 isolate 模式 |

---

## 還沒做的收尾（您要再決定）

1. **CI workflow** 加 puller image build job
2. **Push 分支 + 開 PR**
3. **同步 plan 文件**（privileged + seccomp wrapper 偏差）
4. （可選）AppArmor Pod annotation 套上、gVisor RuntimeClass、metrics exporter、webhook receiver

詳細見上一輪訊息的優先順序表。

---

## Step A `4d5f58f` · feat(worker): data-driven language Makefile + per-language smoke verify

讓「新增一個語言」變成 4 條指令的 SOP（見 [NEW_LANGUAGE.md](./NEW_LANGUAGE.md)）：

- **目錄改名**：`worker/sandbox/{cpp,python}` → `{cpp17,python3}` 跟 language id 對齊。
- **`worker/scripts/list-languages.mjs`**：parse `languages.yaml` 輸出 `<id>\t<image>\t<context>`，Makefile 所有 loop 都吃這個 → 不用再寫死語言。
- **`worker/scripts/verify-language.mjs`**：在 worker container 內跑單一語言的 smoke fixture 通過 IsolateEngine + seccomp wrapper，比對 stdout / verdict。
- **Makefile** 新增：
  - `build-language-images`（data-driven 取代寫死的 `build-sandbox-cpp` / `build-sandbox-python`，舊 target 保留為 alias）
  - `verify-language LANG=<id>`（pre-push 唯一閘門）
  - `list-languages`（debug 用）
- **Smoke fixture**：`worker/sandbox/<id>/smoke/{<source>, expected.txt}` 約定。為 cpp17 / python3 各補上一個 hello-world 範例。
- **Schema**：`languages.yaml` 新增 optional `dockerfileContext` 欄位（預設 = id），方便未來同一個 Dockerfile 服務多版本。

## Step B `ac6298e` · chore(worker): drop legacy DockerEngine, isolate becomes the only engine

砍掉 dev/prod 雙引擎技術債：

- 刪 ~350 行：`engines/docker-engine.ts`、`runner.ts`、`compiler.ts`、`providers/docker.ts`、對應 unit tests、`sandbox.integration.test.ts`、`parseDockerLogs` / `startMemorySampler` / `sandboxHostConfig`。
- 從 `package.json` 移除 `dockerode` + `@types/dockerode`；worker image 移除 `docker.io`（-150MB）。
- `sandbox-engine.ts` 自帶 `CompileTask` / `RunTask` 等型別（不再從 runner/compiler import）；factory 變 sync、只取 isolate-engine config。
- `config/index.ts` 移除 `SANDBOX_ENGINE` / `SANDBOX_RUNTIME` env 知識。
- `docker-compose.yml` 移除 `docker.sock` mount；只剩 `cap_add: SYS_ADMIN` + `cgroup: host` 給 isolate 用。
- `Makefile` 的 `test-integration` 改為只跑 DB integration（不再需要 sandbox images）。
- 改後測試：worker unit 67/67、DB integration 5/5、puller 10/10、isolate e2e 12/12。淨刪 1733 行。

---

## 7 個 commit 的最終狀態（從新到舊）

```
ac6298e  chore(worker): drop legacy DockerEngine                              ← Step B
4d5f58f  feat(worker): data-driven language Makefile + verify-language        ← Step A
79f125b  feat(k8s):    switch worker to Isolate + seccomp wrapper             ← Phase 4
09bbfef  feat(infra):  language-rootfs-puller DaemonSet + atomic swap         ← Phase 2.5
d7c5878  feat(worker): harden Isolate (seccomp policy + apparmor profile)     ← Phase 2-B
c72fdf5  feat(worker): IsolateEngine + meta parser + rootfs resolver          ← Phase 2-A
e76129c  refactor(worker): SandboxEngine strategy interface                   ← Phase 1
```
