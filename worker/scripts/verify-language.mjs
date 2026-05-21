#!/usr/bin/env node
// Runs a single language's smoke fixture through IsolateEngine and verifies
// stdout matches the expected output.
//
// Designed to run *inside* the worker container (see Makefile target
// `verify-language`). The worker image bundles the engine code under
// /app/dist, the isolate binary, and the seccomp wrapper. We mount:
//   - /var/lib/oct/rootfs       host's extracted rootfs (read-only)
//   - /app/sandbox/languages.yaml  host's languages.yaml so newly added
//                                  entries are visible without rebuild
//   - /host-sandbox             host's worker/sandbox/ tree so we can read
//                               the smoke fixture for the target language
//
// Usage:
//   VERIFY_LANG=<id> node scripts/verify-language.mjs

import { mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import path from "node:path";
import { IsolateEngine } from "/app/dist/engine/engines/isolate-engine.js";
import { RootfsResolver } from "/app/dist/engine/rootfs-resolver.js";
import { loadLanguages } from "/app/dist/engine/languages.js";

const langId = process.env.VERIFY_LANG;
if (!langId) {
  console.error("VERIFY_LANG env var is required (e.g. VERIFY_LANG=cpp17)");
  process.exit(2);
}

const langs = loadLanguages("/app/sandbox/languages.yaml");
const spec = langs.find((l) => l.id === langId);
if (!spec) {
  console.error(`language id "${langId}" not found in languages.yaml`);
  console.error(`available: ${langs.map((l) => l.id).join(", ")}`);
  process.exit(2);
}

const ctx = spec.dockerfileContext || spec.id;
const smokeDir = path.join("/host-sandbox", ctx, "smoke");
let source;
let expected;
try {
  source = await readFile(path.join(smokeDir, spec.source.filename), "utf8");
  expected = await readFile(path.join(smokeDir, "expected.txt"), "utf8");
} catch (err) {
  console.error(`missing smoke fixture under worker/sandbox/${ctx}/smoke/`);
  console.error(`required files: ${spec.source.filename}, expected.txt`);
  console.error(`error: ${err.message ?? err}`);
  process.exit(2);
}

const workDir = `/tmp/judge/verify-${langId}`;
await mkdir(workDir, { recursive: true });
await chmod(workDir, 0o777);
await writeFile(path.join(workDir, spec.source.filename), source);

const engine = new IsolateEngine({
  rootfsResolver: new RootfsResolver({
    baseDir: process.env.ROOTFS_BASE_DIR ?? "/var/lib/oct/rootfs",
  }),
  seccomp: process.env.SECCOMP_BUNDLE_DIR
    ? { bundleDir: process.env.SECCOMP_BUNDLE_DIR }
    : undefined,
});

console.log(`[verify-${langId}] compile…`);
const compile = await engine.compile({ spec, hostWorkDir: workDir });
if (!compile.success) {
  console.error(`FAIL — compile: ${(compile.errorLog ?? "").slice(0, 400)}`);
  process.exit(1);
}

console.log(`[verify-${langId}] run…`);
const run = await engine.runOne({
  spec,
  hostWorkDir: workDir,
  inputData: "",
  timeLimitMs: 5000,
  memoryLimitMb: 256,
  outputLimitKb: 64,
});

const norm = (s) => s.replace(/\r\n/g, "\n");
const ok = run.verdict === "AC" && norm(run.stdout) === norm(expected);

console.log("---");
console.log(`verdict   : ${run.verdict}`);
console.log(`runtimeMs : ${run.runtimeMs}`);
console.log(`memoryKb  : ${run.memoryKb}`);
console.log(`stdout    : ${JSON.stringify(run.stdout)}`);
if (run.stderr) console.log(`stderr    : ${JSON.stringify(run.stderr.slice(0, 200))}`);
console.log(`expected  : ${JSON.stringify(expected)}`);
console.log("---");

if (ok) {
  console.log(`PASS [${langId}]`);
  process.exit(0);
}

console.log(`FAIL [${langId}]`);
process.exit(1);
