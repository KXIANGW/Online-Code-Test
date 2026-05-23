import os from "node:os";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

// One registry per worker process; exported so /metrics endpoint and
// integration tests can read the same series instances.
export const registry = new Registry();

// Identify each worker replica scraped by Prometheus / KEDA.
registry.setDefaultLabels({ worker: os.hostname() });

// Process-level CPU / memory / event-loop lag — useful as a secondary
// scaling signal when cAdvisor is not available (Phase A on bare host).
collectDefaultMetrics({ register: registry });

// ── Custom judge metrics ────────────────────────────────────────────────────
//
// Naming follows Prometheus best practice: `<noun>_<unit>` + base unit.
// Buckets are chosen to keep histogram cardinality bounded while still
// surfacing the SLO thresholds we care about (p95 < 5s judge latency).

export const judgeInFlight = new Gauge({
  name: "judge_in_flight",
  help: "Number of submissions currently being judged by this worker.",
  registers: [registry],
});

export const judgeDurationSeconds = new Histogram({
  name: "judge_duration_seconds",
  help: "End-to-end judge duration per submission (compile + all testcases).",
  labelNames: ["language", "verdict"] as const,
  buckets: [0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const judgeVerdictsTotal = new Counter({
  name: "judge_verdicts_total",
  help: "Cumulative count of judge verdicts.",
  labelNames: ["language", "verdict"] as const,
  registers: [registry],
});

export const judgeMemoryMaxBytes = new Histogram({
  name: "judge_memory_max_bytes",
  help: "Peak memory observed inside the sandbox container per testcase.",
  labelNames: ["language"] as const,
  // 8MB, 16MB, 32MB, 64MB, 128MB, 256MB (matches PLAN.md sandbox 256MB cap).
  buckets: [
    8 * 1024 * 1024,
    16 * 1024 * 1024,
    32 * 1024 * 1024,
    64 * 1024 * 1024,
    128 * 1024 * 1024,
    256 * 1024 * 1024,
  ],
  registers: [registry],
});

export const judgeCompileDurationSeconds = new Histogram({
  name: "judge_compile_duration_seconds",
  help: "Compile container wall time (compiled languages only).",
  labelNames: ["language"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const judgeErrorsTotal = new Counter({
  name: "judge_errors_total",
  help: "Worker-side errors by category.",
  labelNames: ["kind"] as const,
  registers: [registry],
});

// Per-worker info gauge: scraped to count how many worker replicas exist.
export const judgeWorkerInfo = new Gauge({
  name: "judge_worker_info",
  help: "Static info per worker; value is always 1.",
  labelNames: ["version", "hostname"] as const,
  registers: [registry],
});

judgeWorkerInfo.labels(process.env["npm_package_version"] ?? "dev", os.hostname()).set(1);

// Pre-register every (language, verdict) so rate(judge_verdicts_total[1m])
// resolves to non-zero on the first burst (prom-client doesn't emit a
// counter time-series until the first .inc(), which means rate has only
// one sample within the burst window and reports 0).
const LANGUAGES = ["cpp17", "python3"];
const VERDICTS = ["AC", "WA", "TLE", "MLE", "RE", "CE"];
const ERROR_KINDS = ["system_error", "compile_timeout"];
for (const language of LANGUAGES) {
  for (const verdict of VERDICTS) {
    judgeVerdictsTotal.labels(language, verdict).inc(0);
  }
}
for (const kind of ERROR_KINDS) {
  judgeErrorsTotal.labels(kind).inc(0);
}
