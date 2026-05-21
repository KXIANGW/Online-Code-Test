# 新增 sandbox 語言環境（SOP）

> 新增一個評測語言（例如 Java 17、Go 1.21、Rust 1.75）的標準作業流程。整個流程在**本機**完成驗證，不需 push 或等 CI；`make -C worker verify-language LANG=<id>` 就是 pre-push 的閘門。
>
> 先了解的前提：
> - Sandbox engine = **isolate + oct-seccomp-wrapper**（舊的 DockerEngine 已在 [`ac6298e`](#) commit 中砍掉）。dev / prod 用同一個 engine、同一個 image、同一條程式碼路徑，差別只在 rootfs 怎麼到 host 上（本機 `docker export` vs K8s DaemonSet 的 `skopeo + umoci`）。
> - 慣例：`worker/sandbox/<id>/` 是 `<id>` 這個語言的所有檔案的家。
> - Image 分發：CI 用 Dockerfile build 出 per-language image 推到 GHCR；K8s 端的 DaemonSet 把它解到 hostPath 供 Worker chroot 用。

---

## 一眼看完

```bash
# 1. 放好四個檔案
worker/sandbox/<id>/Dockerfile              # 怎麼 build 該語言的環境
worker/sandbox/<id>/smoke/<source-file>     # hello world
worker/sandbox/<id>/smoke/expected.txt      # 期望的 stdout
# + 在 worker/sandbox/languages.yaml 加一條目

# 2. 驗證（在 repo 根目錄執行）
make -C worker verify-language LANG=<id>    # smoke 透過 isolate 跑一次
make -C worker test-integration-isolate     # 完整 12-case 安全 e2e

# 3. 推上去
git add worker/sandbox/<id>/ worker/sandbox/languages.yaml
git commit -m "feat(sandbox): add <id> language environment"
git push   # CI build + push GHCR；K8s DaemonSet 自動接手
```

---

## 詳細步驟（範例：Java 17）

### Step 1 — 寫語言環境的 Dockerfile

```bash
mkdir -p worker/sandbox/java17
cat > worker/sandbox/java17/Dockerfile <<'EOF'
FROM eclipse-temurin:17-jdk-jammy

# Non-root user UID 1000（呼應 SANDBOX_USER 慣例；isolate 自己會再切到
# 60000+ 範圍的 box uid，但留個正常 user 可以讓 /home 不會空蕩蕩）。
RUN useradd -u 1000 -m -d /home/runner -s /usr/sbin/nologin runner \
 && mkdir -p /code \
 && chown runner:runner /code

WORKDIR /code
USER runner
ENTRYPOINT []
EOF
```

**幾條經驗法則**
- 挑**最小**的上游 image，只要含你需要的 compiler / runtime / library 即可。Image 大小直接 = 每個 K8s Node 上的 rootfs 磁碟用量。
- 一定要 non-root（`USER runner` 之類）並 `ENTRYPOINT []`，這樣候選人指令可以任意呼叫。
- 不需要預先準備 `/code` 的內容——isolate 會在執行時 bind-mount work dir 到 `/code` 上。

### Step 2 — 在 languages.yaml 加條目

```yaml
# worker/sandbox/languages.yaml
- id: java17
  image: oct-sandbox-java:17
  source:
    filename: Main.java
  compile:
    # IsolateEngine 呼叫 execve()，所以必須給絕對路徑。
    # 技巧：`docker run --rm <image> which javac` 可以找出真實路徑。
    cmd: ["/opt/java/openjdk/bin/javac", "Main.java"]
  run:
    cmd: ["/opt/java/openjdk/bin/java", "Main"]
  enabled: true
```

**Optional 欄位**
- `dockerfileContext: <dir>` — 當多個語言版本共用一個 Dockerfile（例如 `cpp17` + `cpp20` 都指向 `cpp/`）時用。
- `rootfsPath: /var/lib/oct/rootfs/<custom>` — 改 Node 上 rootfs 的位置。預設 = `${ROOTFS_BASE_DIR}/${id}`。
- `run.entrypointPath: /opt/.../bin/java` — 額外告訴工具鏈解譯器路徑（給不想 parse `run.cmd` 的下游程式用）。
- `run.env: { KEY: value, ... }` — 給候選人程式追加的環境變數。（`PATH` IsolateEngine 已自動設好，不必重複。）

### Step 3 — 放 smoke fixture

Smoke fixture 是 `make verify-language` 用來確認這個語言環境真的能在 isolate 內 compile + run 的最小範例。source 檔名必須跟 `spec.source.filename` 一致。

```bash
mkdir -p worker/sandbox/java17/smoke
cat > worker/sandbox/java17/smoke/Main.java <<'EOF'
public class Main {
    public static void main(String[] args) {
        System.out.println("hello java17");
    }
}
EOF
cat > worker/sandbox/java17/smoke/expected.txt <<'EOF'
hello java17
EOF
```

**慣例**
- 印 exactly `hello <id>\n`，這樣未來新增語言時這一段可以複製貼上不用想。
- 5 行內結束。Smoke 是確認「toolchain 至少能跑」，不是測語言語意正確性。

### Step 4 — 跑本機 pre-push 閘門

在 **repo 根目錄**（含 `worker/` 的那層）執行：

```bash
make -C worker verify-language LANG=java17
```

這條指令端到端做了：
1. 讀 `languages.yaml`，發現 `image: oct-sandbox-java:17`、`dockerfileContext: java17`（沒寫就預設 = id）。
2. `docker build -t oct-sandbox-java:17 worker/sandbox/java17/`。
3. `docker create + docker export` → 解出 rootfs 到 `$(HOST_ROOTFS_DIR)/java17/`（預設 `/tmp/oct-rootfs/java17/`）。
4. Build worker container image（`oct-worker:test`）。
5. `docker run --privileged --cgroupns=host` 起 worker image，把解好的 rootfs 掛到 `/var/lib/oct/rootfs/`，跑 `scripts/verify-language.mjs`：
   - 用 `loadLanguages("/app/sandbox/languages.yaml")` 載入 spec。
   - 從 mount 進來的 `worker/sandbox/java17/smoke/` 讀 `Main.java` 與 `expected.txt`。
   - 呼叫 `IsolateEngine.compile()` 然後 `IsolateEngine.runOne()`。
   - 斷言 `verdict === "AC"` 且 `stdout === expected`。
6. 任何不一致就 exit 1。

成功的輸出像這樣：

```
[verify-java17] compile…
[verify-java17] run…
---
verdict   : AC
runtimeMs : 87
memoryKb  : 65232
stdout    : "hello java17\n"
expected  : "hello java17\n"
---
PASS [java17]
```

### Step 5 —（建議）跑完整 e2e regression

12-case 的 `isolate-e2e.mjs` 確認新增的語言沒有讓跨語言不變量崩掉（安全測試不依語言，但 meta 解析 / stdout 擷取的程式碼路徑是共用的）。

```bash
make -C worker test-integration-isolate
```

預期 `12/12 passed`。

### Step 6 — Commit + push

```bash
git add worker/sandbox/java17/ worker/sandbox/languages.yaml
git commit -m "feat(sandbox): add java17 language environment"
git push
```

CI 會觸發 `.github/workflows/ci.yml` 的 `build-sandbox-images` matrix，build 新 image 並推到 GHCR：`ghcr.io/<owner>/oct-sandbox-java:<sha>` + `:latest`。

> **注意**：matrix 目前只有 `cpp` 與 `python`。要讓 CI 自動 build 新語言，還需要在 `build-sandbox-images` job 的 matrix 多加一筆。（後續會把 CI 也改成 data-driven 直接讀 languages.yaml。）

K8s 上的 `language-rootfs-puller` 每 5 分鐘 poll GHCR 一次（或 webhook 立即觸發），用 `skopeo` 拉新 image、atomic 切 symlink，Worker Pod 下一個 testcase 就會看到新 rootfs。

---

## 本機 SOP 跟 production 怎麼對齊

| 階段 | 本機（`make verify-language`） | Production（K8s） |
| --- | --- | --- |
| Build image | host 上 `docker build` | GitHub Actions runner 上 `docker build` |
| 把 image 鋪到每個 Node | `docker export` + tar → hostPath | `skopeo copy + umoci unpack`（puller DaemonSet） |
| 掛進 worker | `--volume /tmp/oct-rootfs:/var/lib/oct/rootfs:ro` | hostPath volume `/var/lib/oct/rootfs` |
| 跑 sandbox | worker container 內 `isolate` | Worker Pod 內 `isolate` |
| 套 seccomp | `oct-seccomp-wrapper /etc/oct/seccomp.policy --` | 一樣 |

候選人在 isolate 內走的 code path 在這兩個 setup 上完全一樣，所以**本機 verify-language PASS 等於 production 會 AC**。

---

## 常見地雷

### 「Compilation failed」但 stderr 是空的

IsolateEngine 的 compile() 把 stderr 寫到 sandbox 內 `/code/stderr.txt`。stderr 空通常表示 isolate 本身在候選人開跑前就掛了。看 engine 打到 console.error 的 `[isolate] exit=…` 那一行，常見原因：

- **`compile.cmd[0]` 不是絕對路徑**。isolate 的 `execve()` 不做 PATH lookup。`which <cmd>` 進 image 裡看一下真實位置。
- **rootfs 少了某個 library**。對照上游 image，可能需要在 Dockerfile 多 `apt-get install -y libX`。
- **檔名沒對齊**。`spec.source.filename` 要跟編譯器期望的吻合（例如 Java 需要 `Main.java`，不能是 `solution.java`）。

### `make verify-language` 回報 `Cannot find module '/app/dist/...'`

Worker dist 沒重 build。Make target 每次跑都會重 `docker build`，這狀況通常是 build 失敗。獨立跑 `docker build -t oct-worker:test worker/` 看真實錯誤。

### Image 太大

Rootfs 會整份鋪到每個 Worker Node。目標 < 500 MB。技巧：

- 能用 `-slim` / `-alpine` base 就用（Alpine 有時要解 glibc 相容性問題——用 `make verify-language` 驗證）。
- `RUN apt-get install --no-install-recommends` 並在同一層 `rm -rf /var/lib/apt/lists/*`。
- `dpkg --purge` 拔掉純文件 / 純 man page 的套件。

### Smoke 很單純卻拿到 TLE / RE

通常是 JVM / CLR 類語言 cold-start 太重。在 `verify-language.mjs` 把 smoke 的 `timeLimitMs` / `memoryLimitMb` 預設拉高，**並**在 `languages.yaml` 給該語言寫合理的預設（語言級預設目前還沒做，列為未來增強）。

---

## 參考：所有相關檔案

| 檔案 | 做什麼 |
| --- | --- |
| `worker/sandbox/<id>/Dockerfile` | Build 該語言的 OCI image |
| `worker/sandbox/<id>/smoke/<source>` | `verify-language` 用的 hello-world |
| `worker/sandbox/<id>/smoke/expected.txt` | smoke 期望的 stdout |
| `worker/sandbox/languages.yaml` | 語言清單的唯一 source of truth |
| `worker/scripts/list-languages.mjs` | 為 Makefile 列出所有 enabled 語言 |
| `worker/scripts/verify-language.mjs` | 在 worker container 內透過 `IsolateEngine` 跑 smoke |
| `worker/Makefile` | `verify-language` / `build-language-images` / `build-isolate-rootfs` |
| `worker/src/engine/languages.ts` | Zod schema + `loadLanguages()` |
| `worker/src/engine/engines/isolate-engine.ts` | 唯一的 sandbox engine |
| `.github/workflows/ci.yml` | `build-sandbox-images` matrix → GHCR |
| `k8s/08a-language-puller.yaml` | 從 GHCR 拉 image 鋪到 hostPath 的 DaemonSet |
