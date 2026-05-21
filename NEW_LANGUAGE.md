# Adding a New Sandbox Language

> Step-by-step SOP for adding a new judge language (e.g. Java 17, Go 1.21,
> Rust 1.75). The whole flow runs **locally** before any push — `make
> verify-language LANG=<id>` is the pre-push gate.
>
> Worth knowing first:
> - Sandbox engine = **isolate + oct-seccomp-wrapper** (the legacy Docker
>   engine was removed in [`ac6298e`](#)). One engine in dev, one in prod;
>   the only difference is where the rootfs comes from (local
>   `docker export` vs DaemonSet `skopeo + umoci`).
> - Convention: `worker/sandbox/<id>/` houses everything for language `<id>`.
> - Image distribution: CI builds the per-language image and pushes it to
>   GHCR; the K8s DaemonSet pulls and unpacks it into hostPath.

---

## At a glance

```bash
# 1. drop the four artifacts
worker/sandbox/<id>/Dockerfile              # how to build the language env
worker/sandbox/<id>/smoke/<source-file>     # hello world
worker/sandbox/<id>/smoke/expected.txt      # what stdout should equal
# + one entry in worker/sandbox/languages.yaml

# 2. validate
make -C worker verify-language LANG=<id>    # smoke through isolate
make -C worker test-integration-isolate     # full 12-case e2e

# 3. ship
git add worker/sandbox/<id>/ worker/sandbox/languages.yaml
git commit -m "feat(sandbox): add <id> language environment"
git push   # CI builds + pushes the image; DaemonSet picks it up
```

---

## Step-by-step (worked example: Java 17)

### 1. Write the language environment Dockerfile

```bash
mkdir -p worker/sandbox/java17
cat > worker/sandbox/java17/Dockerfile <<'EOF'
FROM eclipse-temurin:17-jdk-jammy

# Non-root user UID 1000 (matches SANDBOX_USER convention; isolate itself
# remaps to a 60000+ box uid, but having a real user keeps /home tidy).
RUN useradd -u 1000 -m -d /home/runner -s /usr/sbin/nologin runner \
 && mkdir -p /code \
 && chown runner:runner /code

WORKDIR /code
USER runner
ENTRYPOINT []
EOF
```

**Rules of thumb**
- Pick the **smallest** upstream image that has the compiler + libs you
  need. Image size becomes the per-Node rootfs disk usage.
- Always non-root (`USER runner` or similar) and `ENTRYPOINT []` so the
  candidate command can be invoked freely.
- Don't pre-create the `/code` content — isolate bind-mounts the work dir
  on top at runtime.

### 2. Add the languages.yaml entry

```yaml
# worker/sandbox/languages.yaml
- id: java17
  image: oct-sandbox-java:17
  source:
    filename: Main.java
  compile:
    # IsolateEngine calls execve(); absolute paths are required.
    # Tip: `docker run --rm <image> which javac` to discover the path.
    cmd: ["/opt/java/openjdk/bin/javac", "Main.java"]
  run:
    cmd: ["/opt/java/openjdk/bin/java", "Main"]
  enabled: true
```

**Optional fields**
- `dockerfileContext: <dir>` — override the dir that hosts the Dockerfile
  when multiple language versions share one (e.g. `cpp17` + `cpp20` both
  pointing at `cpp/`).
- `rootfsPath: /var/lib/oct/rootfs/<custom>` — override the per-Node
  rootfs location. Default = `${ROOTFS_BASE_DIR}/${id}`.
- `run.entrypointPath: /opt/.../bin/java` — separately advertise the
  interpreter path for tooling that wants to find it without parsing
  `run.cmd`.
- `run.env: { KEY: value, ... }` — extra env vars for the candidate.
  (`PATH` is already set by IsolateEngine; only add what's truly needed.)

### 3. Drop the smoke fixture

The smoke fixture is what `make verify-language` runs to prove the
language toolchain works inside isolate end-to-end. Source filename must
match `spec.source.filename`.

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

**Convention**
- Print exactly `hello <id>\n` so we can copy-paste this section for
  every future language.
- Keep it 5 lines or fewer. The smoke test is "does the toolchain even
  work", not "is the language semantically correct".

### 4. Run the local gate

```bash
make -C worker verify-language LANG=java17
```

What this does, end-to-end:
1. Reads `languages.yaml` to discover `image: oct-sandbox-java:17` and
   `dockerfileContext: java17` (defaulted from id).
2. `docker build -t oct-sandbox-java:17 worker/sandbox/java17/`.
3. `docker create + docker export` → extracts rootfs to
   `$(HOST_ROOTFS_DIR)/java17/` (default `/tmp/oct-rootfs/java17/`).
4. Builds the worker container image (`oct-worker:test`).
5. `docker run --privileged --cgroupns=host` the worker image, mounts
   the extracted rootfs at `/var/lib/oct/rootfs/`, and runs
   `scripts/verify-language.mjs`:
   - Loads the spec via `loadLanguages("/app/sandbox/languages.yaml")`.
   - Reads `smoke/Main.java` + `smoke/expected.txt` from the bound
     `worker/sandbox/java17/smoke/`.
   - Calls `IsolateEngine.compile()` then `IsolateEngine.runOne()`.
   - Asserts `verdict === "AC"` and `stdout === expected`.
6. Exits non-zero on any mismatch.

A successful run looks like:

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

### 5. (Recommended) Run the full e2e regression

The 12-case `isolate-e2e.mjs` suite confirms the new language doesn't
regress any cross-language invariants (security tests don't depend on the
language, but the meta parsing / output capture path is shared).

```bash
make -C worker test-integration-isolate
```

Expect `12/12 passed`.

### 6. Commit + push

```bash
git add worker/sandbox/java17/ worker/sandbox/languages.yaml
git commit -m "feat(sandbox): add java17 language environment"
git push
```

CI fires `.github/workflows/ci.yml` → `build-sandbox-images` matrix
builds the new image and pushes it to GHCR:
`ghcr.io/<owner>/oct-sandbox-java:<sha>` + `:latest`.

> **Heads up:** the matrix is currently `cpp` + `python` only. To wire a
> new language into CI you'll also need to add it to the matrix in the
> `build-sandbox-images` job. (A follow-up will make CI data-driven too.)

In K8s, `language-rootfs-puller` polls GHCR every 5 min (or immediately
on webhook), pulls the new image via `skopeo`, atomically swaps the
symlink, and Worker Pods see the new rootfs on the next testcase.

---

## How the local SOP mirrors production

| Stage | Local (`make verify-language`) | Production (K8s) |
| --- | --- | --- |
| Build image | `docker build` on the host | `docker build` on a GitHub Actions runner |
| Distribute to nodes | `docker export` + tar → hostPath | `skopeo copy + umoci unpack` (puller DaemonSet) |
| Mount into worker | `--volume /tmp/oct-rootfs:/var/lib/oct/rootfs:ro` | hostPath volume `/var/lib/oct/rootfs` |
| Run sandbox | `isolate` inside the worker container | `isolate` inside the worker Pod |
| Apply seccomp | `oct-seccomp-wrapper /etc/oct/seccomp.policy --` | same |

The path the candidate takes through isolate is byte-for-byte identical
in both setups, so a local `verify-language` PASS reliably predicts a
production AC.

---

## Common pitfalls

### "Compilation failed" with empty stderr

IsolateEngine's compile() flow writes stderr to `/code/stderr.txt`
inside the sandbox. Empty stderr usually means isolate itself errored
before the candidate ran. Check the `[isolate] exit=…` line that the
engine logs to console.error — typical causes:

- **Wrong absolute path** in `compile.cmd[0]`. isolate's `execve()`
  doesn't do PATH lookup; `which <cmd>` inside the image reveals the
  correct path.
- **Missing library in the rootfs**. Compare against the language's
  upstream image — sometimes you need an extra `apt-get install -y libX`
  in the Dockerfile.
- **Wrong filename.** `spec.source.filename` must match what the
  compiler expects (e.g. Java needs `Main.java`, not `solution.java`).

### `make verify-language` reports `Cannot find module '/app/dist/...'`

The worker dist wasn't rebuilt. The make target rebuilds it via
`docker build` each time, so this usually means the build itself failed.
Run `docker build -t oct-worker:test worker/` standalone to see the real
error.

### Image too large

The rootfs is shipped wholesale to every Worker Node. Aim for < 500 MB.
Tips:

- Use `-slim` / `-alpine` base where available (Alpine sometimes needs
  glibc workarounds — verify with `make verify-language`).
- `RUN apt-get install --no-install-recommends` and clean up
  `/var/lib/apt/lists/*` in the same layer.
- Strip docs / man pages with `dpkg --purge` of doc-only packages where
  possible.

### Verdict TLE/RE on smoke despite the program being trivial

Probably the new image takes a lot of cold-start memory (JVM/CLR
languages). Bump the smoke's `timeLimitMs` / `memoryLimitMb` defaults in
`verify-language.mjs`, **and** set saner defaults in `languages.yaml`
per language (we don't have language-level defaults yet — track as a
future enhancement).

---

## Reference: the moving parts

| File | What it does |
| --- | --- |
| `worker/sandbox/<id>/Dockerfile` | Builds the language OCI image |
| `worker/sandbox/<id>/smoke/<source>` | Hello-world used by `verify-language` |
| `worker/sandbox/<id>/smoke/expected.txt` | Expected stdout for the smoke |
| `worker/sandbox/languages.yaml` | Single source of truth for the inventory |
| `worker/scripts/list-languages.mjs` | Enumerates enabled languages for the Makefile |
| `worker/scripts/verify-language.mjs` | Runs a smoke through `IsolateEngine` inside the worker container |
| `worker/Makefile` | `verify-language` / `build-language-images` / `build-isolate-rootfs` |
| `worker/src/engine/languages.ts` | Zod schema + `loadLanguages()` |
| `worker/src/engine/engines/isolate-engine.ts` | The one and only sandbox engine |
| `.github/workflows/ci.yml` | `build-sandbox-images` matrix → GHCR |
| `k8s/08a-language-puller.yaml` | DaemonSet that fetches images and writes them to hostPath |
