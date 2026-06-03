// loadtest/k6-start.js
//
// Fires N concurrent POST /api/exam-sessions/:id/start to simulate the
// thundering-herd when all candidates enter the exam simultaneously.
// Each session must be in `not_started` state — use seed-start.ts to prepare.
//
// Bottleneck under test: DB write throughput + state-machine transaction
// isolation (not_started -> in_progress). No MQ / Worker involved.
//
// Run with:
//   npx tsx loadtest/seed-start.ts
//   k6 run loadtest/k6-start.js
//
// Override defaults:
//   VUS=200 BASE_URL=http://backend:3000/api k6 run loadtest/k6-start.js

import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";
import { Counter } from "k6/metrics";

const startsTotal = new Counter("starts_total");
const startFailures = new Counter("start_failures");

const sessions = new SharedArray("sessions", () => {
  return JSON.parse(open("./.start-tokens.json"));
});

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:3000/api";

export const options = {
  scenarios: {
    burst: {
      // Each VU runs exactly once -> N truly concurrent start requests.
      executor: "per-vu-iterations",
      vus: Number(__ENV.VUS ?? 100),
      iterations: 1,
      maxDuration: "60s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{name:start}": ["p(95)<2000"],
    start_failures: ["count<10"],
  },
};

export default function () {
  const idx = (__VU - 1) % sessions.length;
  const s = sessions[idx];

  const url = `${BASE_URL}/exam-sessions/${s.sessionId}/start`;
  const res = http.post(url, null, {
    headers: { Authorization: `Bearer ${s.token}` },
    tags: { name: "start" },
  });

  startsTotal.add(1);
  const ok = check(res, {
    "exam start returns 200 or 201": (r) => r.status === 200 || r.status === 201,
  });
  if (!ok) startFailures.add(1);
}
