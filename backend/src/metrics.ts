import os from "node:os";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import { countActiveSubscribers } from "./ws/hub";

// Single Registry per backend instance. Shared by /api/metrics and unit tests.
export const registry = new Registry();
registry.setDefaultLabels({ instance: os.hostname() });

// Node-level CPU / memory / GC / event-loop lag.
collectDefaultMetrics({ register: registry });

// ── HTTP RED metrics ────────────────────────────────────────────────────────

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration grouped by route, method, and status class.",
  labelNames: ["route", "method", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

// ── Submission lifecycle ────────────────────────────────────────────────────

export const submissionCreatedTotal = new Counter({
  name: "submission_created_total",
  help: "Submissions accepted by POST /api/exam-sessions/:sid/submissions.",
  labelNames: ["type", "language"] as const,
  registers: [registry],
});

export const submissionCompletedTotal = new Counter({
  name: "submission_completed_total",
  help: "Submissions whose final verdict has been written by the worker result consumer.",
  labelNames: ["type", "verdict"] as const,
  registers: [registry],
});

export const judgeResultPublishTotal = new Counter({
  name: "judge_result_publish_total",
  help: "judge.results messages consumed from RabbitMQ and broadcast to WebSocket subscribers.",
  labelNames: ["verdict"] as const,
  registers: [registry],
});

export const mqPublishErrorsTotal = new Counter({
  name: "mq_publish_errors_total",
  help: "Failures while publishing judge.tasks to RabbitMQ.",
  registers: [registry],
});

// ── WebSocket hub gauge ─────────────────────────────────────────────────────
//
// Reflects countActiveSubscribers() on every scrape (collect callback) so we
// don't have to inc/dec at every subscribe/unsubscribe call site.

export const wsActiveConnections = new Gauge({
  name: "ws_active_connections",
  help: "Active WebSocket subscribers across all exam sessions.",
  registers: [registry],
  collect() {
    this.set(countActiveSubscribers());
  },
});

// Initialise label combinations at zero so Prometheus sees the time series
// before the first burst arrives. Without this, prom-client only emits the
// series after the first .inc(), so rate() over the burst window has only
// one sample (the post-burst value) and resolves to 0 — the visible symptom
// being a flat "Submission created vs completed (per s)" panel.
for (const type of ["simple", "formal"] as const) {
  for (const lang of ["cpp17", "python3"]) {
    submissionCreatedTotal.labels(type, lang).inc(0);
  }
  for (const verdict of ["AC", "WA", "TLE", "MLE", "RE", "CE", "system_error"]) {
    submissionCompletedTotal.labels(type, verdict).inc(0);
  }
}
