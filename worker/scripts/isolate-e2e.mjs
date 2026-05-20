// Local E2E test for IsolateEngine + oct-seccomp-wrapper.
//
// Runs the same scenarios as src/__tests__/sandbox.integration.test.ts but
// through IsolateEngine instead of DockerEngine, plus a dedicated case that
// verifies the seccomp wrapper actually blocks namespaced syscalls.
//
// Designed to run inside the worker container (which has the isolate binary
// + oct-seccomp-wrapper + /etc/oct/seccomp.policy baked in). The host
// counterpart is `make test-integration-isolate`.
//
// Invocation:
//   docker run --rm --privileged --cgroupns=host \
//     -v /tmp/oct-rootfs:/var/lib/oct/rootfs:ro \
//     -v $PWD/scripts/isolate-e2e.mjs:/e2e.mjs:ro \
//     oct-worker:latest \
//     sh -c "mkdir -p /tmp/judge && node /e2e.mjs"

import { mkdir, writeFile, chmod } from "node:fs/promises";
import { IsolateEngine } from "/app/dist/engine/engines/isolate-engine.js";
import { RootfsResolver } from "/app/dist/engine/rootfs-resolver.js";

const cppSpec = {
  id: "cpp17",
  image: "oct-sandbox-cpp:12",
  source: { filename: "solution.cpp" },
  compile: {
    cmd: ["/usr/local/bin/g++", "solution.cpp", "-O2", "-std=c++17", "-o", "solution", "-lm"],
  },
  run: { cmd: ["/code/solution"] },
  enabled: true,
};

const pySpec = {
  id: "python3",
  image: "oct-sandbox-python:3.11",
  source: { filename: "solution.py" },
  run: {
    cmd: ["/usr/local/bin/python3", "/code/solution.py"],
    env: { PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" },
  },
  enabled: true,
};

const cases = [
  // ─── verdict correctness (mirrors sandbox.integration.test.ts) ────────
  {
    label: "cpp17_add",
    spec: cppSpec,
    source: `#include <iostream>
int main(){ int a,b; std::cin>>a>>b; std::cout<<a+b<<std::endl; return 0; }`,
    stdin: "3 4\n",
    expect: { verdict: "AC", stdoutEq: "7\n" },
  },
  {
    label: "python3_add",
    spec: pySpec,
    source: "a,b = map(int, input().split())\nprint(a+b)",
    stdin: "10 20\n",
    expect: { verdict: "AC", stdoutEq: "30\n" },
  },
  {
    label: "python3_tle",
    spec: pySpec,
    source: "while True: pass",
    stdin: "",
    timeLimitMs: 500,
    expect: { verdict: "TLE" },
  },
  {
    label: "python3_re_divzero",
    spec: pySpec,
    source: "1/0",
    stdin: "",
    expect: { verdict: "RE", stderrIncludes: "ZeroDivisionError" },
  },
  // ─── security suite (mirrors "Sandbox Security" describe block) ──────
  {
    label: "security_fork-bomb",
    spec: pySpec,
    source: `import os
while True:
    os.fork()`,
    stdin: "",
    timeLimitMs: 3000,
    // PidsLimit/--processes stops new forks; existing process either
    // exhausts memory or hits an unhandled OSError → RE or MLE.
    expect: { verdictIn: ["RE", "MLE"] },
  },
  {
    label: "security_try-network",
    spec: pySpec,
    source: `import urllib.request
try:
    urllib.request.urlopen('http://example.com', timeout=2)
    print("Connected!")
except Exception as e:
    print(f"Network blocked: {e}")`,
    stdin: "",
    timeLimitMs: 5000,
    expect: {
      verdict: "AC",
      stdoutDoesNotContain: ["Connected!"],
      stdoutContains: ["Network blocked"],
    },
  },
  {
    label: "security_read-passwd",
    spec: pySpec,
    source: `try:
    with open("/etc/passwd") as f:
        print(f.readline().strip())
except Exception as e:
    print(f"Error: {e}")`,
    stdin: "",
    expect: {
      verdict: "AC",
      // First line of the sandbox image's /etc/passwd is "root:..." — must
      // never contain the host user (we run as a non-host user inside the
      // chroot).
      stdoutDoesNotContain: [process.env.USER ?? process.env.LOGNAME ?? "kk"],
      stdoutContainsAny: ["root", "nobody"],
    },
  },
  {
    label: "security_write-to-rootfs",
    spec: pySpec,
    source: `import os
results = []
targets = ["/etc/owned", "/usr/owned", "/bin/owned", "/owned"]
for path in targets:
    try:
        with open(path, "w") as f:
            f.write("owned")
        results.append(f"WRITE_SUCCEEDED:{path}")
    except OSError:
        results.append(f"write_blocked:{path}")
try:
    with open("/tmp/allowed", "w") as f:
        f.write("ok")
    results.append("tmp_write_ok")
except OSError:
    results.append("tmp_write_also_blocked")
print("\\n".join(results))`,
    stdin: "",
    timeLimitMs: 5000,
    expect: {
      verdict: "AC",
      stdoutDoesNotContain: ["WRITE_SUCCEEDED"],
      stdoutContains: ["tmp_write_ok"],
    },
  },
  {
    label: "security_cap-check",
    spec: pySpec,
    source: `import socket
results = []
try:
    socket.sethostname("hacked")
    results.append("SETHOSTNAME_SUCCEEDED")
except (PermissionError, OSError):
    results.append("sethostname_blocked")
try:
    s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0800))
    s.close()
    results.append("RAW_SOCKET_SUCCEEDED")
except (PermissionError, OSError):
    results.append("raw_socket_blocked")
print("\\n".join(results))`,
    stdin: "",
    timeLimitMs: 5000,
    expect: {
      verdict: "AC",
      stdoutDoesNotContain: ["SUCCEEDED"],
      stdoutContains: ["sethostname_blocked", "raw_socket_blocked"],
    },
  },
  {
    label: "security_env-leak",
    spec: pySpec,
    source: `import os
sensitive = ["DATABASE_URL", "RABBITMQ_URL", "JWT_SECRET", "REDIS_URL",
             "POSTGRES_PASSWORD", "RABBITMQ_PASS"]
for key in sensitive:
    if key in os.environ:
        print(f"LEAKED:{key}={os.environ[key][:8]}...")
    else:
        print(f"safe:{key}")`,
    stdin: "",
    timeLimitMs: 5000,
    expect: {
      verdict: "AC",
      stdoutDoesNotContain: ["LEAKED:"],
      stdoutContains: ["safe:DATABASE_URL", "safe:JWT_SECRET"],
    },
  },
  {
    label: "security_whoami",
    spec: pySpec,
    source: `import os
uid = os.getuid()
gid = os.getgid()
print(f"uid={uid}")
print(f"gid={gid}")
print(f"is_root={'YES' if uid == 0 else 'NO'}")`,
    stdin: "",
    timeLimitMs: 5000,
    expect: {
      verdict: "AC",
      // IsolateEngine runs each box under a UID in the 60000+ range
      // (first_uid in /usr/local/etc/isolate). The Docker test pins
      // uid=1000; here we just require non-root.
      stdoutContains: ["is_root=NO"],
      stdoutDoesNotContain: ["uid=0\n", "is_root=YES"],
    },
  },
  // ─── seccomp wrapper verification ──────────────────────────────────
  {
    label: "seccomp_unshare-blocked",
    spec: pySpec,
    source: `import ctypes, ctypes.util, errno
libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
# unshare(CLONE_NEWUSER) — without seccomp would still hit EPERM (no cap),
# but with our wrapper it short-circuits to ENOSYS before kernel cap check.
rc = libc.unshare(0x10000000)
e = ctypes.get_errno()
print(f"unshare rc={rc} errno={e}")
if e == errno.ENOSYS:
    print("BLOCKED_BY_SECCOMP")
elif e == errno.EPERM:
    print("BLOCKED_BY_CAPABILITY_ONLY")
else:
    print(f"UNEXPECTED errno={e}")`,
    stdin: "",
    timeLimitMs: 5000,
    expect: {
      verdict: "AC",
      // The presence of BLOCKED_BY_SECCOMP proves the wrapper is in effect.
      // (BLOCKED_BY_CAPABILITY_ONLY would mean the wrapper isn't running.)
      stdoutContains: ["BLOCKED_BY_SECCOMP"],
      stdoutDoesNotContain: ["UNEXPECTED", "BLOCKED_BY_CAPABILITY_ONLY"],
    },
  },
];

function check(run, expect) {
  const errors = [];
  if (expect.verdict !== undefined && run.verdict !== expect.verdict) {
    errors.push(`verdict ${run.verdict} != ${expect.verdict}`);
  }
  if (expect.verdictIn !== undefined && !expect.verdictIn.includes(run.verdict)) {
    errors.push(`verdict ${run.verdict} not in [${expect.verdictIn.join(",")}]`);
  }
  if (expect.stdoutEq !== undefined && run.stdout !== expect.stdoutEq) {
    errors.push(`stdout ${JSON.stringify(run.stdout)} != ${JSON.stringify(expect.stdoutEq)}`);
  }
  for (const s of expect.stdoutContains ?? []) {
    if (!run.stdout.includes(s)) errors.push(`stdout missing ${JSON.stringify(s)}`);
  }
  for (const s of expect.stdoutDoesNotContain ?? []) {
    if (run.stdout.includes(s)) errors.push(`stdout has forbidden ${JSON.stringify(s)}`);
  }
  if (expect.stdoutContainsAny !== undefined) {
    const ok = expect.stdoutContainsAny.some((s) => run.stdout.includes(s));
    if (!ok)
      errors.push(`stdout missing any of [${expect.stdoutContainsAny.map((s) => JSON.stringify(s)).join(",")}]`);
  }
  if (expect.stderrIncludes !== undefined && !run.stderr.includes(expect.stderrIncludes)) {
    errors.push(`stderr missing ${JSON.stringify(expect.stderrIncludes)}`);
  }
  return errors;
}

const engine = new IsolateEngine({
  rootfsResolver: new RootfsResolver({
    baseDir: process.env.ROOTFS_BASE_DIR ?? "/var/lib/oct/rootfs",
  }),
  seccomp: process.env.SECCOMP_BUNDLE_DIR
    ? { bundleDir: process.env.SECCOMP_BUNDLE_DIR }
    : undefined,
});

let failures = 0;
for (const c of cases) {
  const workDir = `/tmp/judge/${c.label}`;
  await mkdir(workDir, { recursive: true });
  await chmod(workDir, 0o777);
  await writeFile(`${workDir}/${c.spec.source.filename}`, c.source);

  process.stdout.write(`[${c.label}] `);

  const compileResult = await engine.compile({ spec: c.spec, hostWorkDir: workDir });
  if (!compileResult.success) {
    console.log(`FAIL — compile: ${(compileResult.errorLog ?? "").slice(0, 120)}`);
    failures++;
    continue;
  }

  const run = await engine.runOne({
    spec: c.spec,
    hostWorkDir: workDir,
    inputData: c.stdin,
    timeLimitMs: c.timeLimitMs ?? 2000,
    memoryLimitMb: c.memoryLimitMb ?? 128,
    outputLimitKb: 64,
  });

  const errors = check(run, c.expect);
  if (errors.length === 0) {
    console.log(`OK (verdict=${run.verdict} runtimeMs=${run.runtimeMs} memoryKb=${run.memoryKb})`);
  } else {
    console.log(`FAIL — ${errors.join("; ")}`);
    if (run.stdout) console.log(`        stdout: ${JSON.stringify(run.stdout.slice(0, 200))}`);
    if (run.stderr) console.log(`        stderr: ${JSON.stringify(run.stderr.slice(0, 200))}`);
    failures++;
  }
}

console.log(`\n${cases.length - failures}/${cases.length} passed`);
process.exit(failures === 0 ? 0 : 1);
