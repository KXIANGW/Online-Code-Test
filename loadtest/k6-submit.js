// loadtest/k6-submit.js
//
// Fires N concurrent POST /api/exam-sessions/:sid/submissions, one per
// pre-seeded candidate token (see seed.ts). The judge work then runs
// asynchronously through RabbitMQ -> worker -> Postgres -> WebSocket;
// k6 only measures the HTTP submit latency, not end-to-end judge time.
//
// Run with:
//   docker run --rm --network oct_default \
//     -v $(pwd)/loadtest:/scripts \
//     -e BASE_URL=http://backend:3000/api \
//     grafana/k6 run /scripts/k6-submit.js

import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";
import { Counter } from "k6/metrics";

const submissionsTotal = new Counter("submissions_total");
const submitFailures = new Counter("submit_failures");

// Loaded once on the test bootstrap, shared between every VU.
const sessions = new SharedArray("sessions", () => {
  return JSON.parse(open("./.session-tokens.json"));
});

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:3000/api";
const SUBMISSION_TYPE = __ENV.SUBMISSION_TYPE ?? "formal";
const SOURCE = open("./fixtures/ac.py");

export const options = {
  scenarios: {
    burst: {
      // Each VU executes exactly once -> exact N concurrent submits.
      executor: "per-vu-iterations",
      vus: Number(__ENV.VUS ?? 100),
      iterations: 1,
      maxDuration: "60s",
    },
  },
  thresholds: {
    "http_req_failed": ["rate<0.02"],
    "http_req_duration{name:submit}": ["p(95)<2000"],
    submit_failures: ["count<10"],
  },
};

export default function () {
  const idx = (__VU - 1) % sessions.length;
  const s = sessions[idx];

  const url = `${BASE_URL}/exam-sessions/${s.sessionId}/submissions`;
  const payload = JSON.stringify({
    examSessionProblemId: s.examSessionProblemId,
    language: "python3",
    sourceCode: SOURCE,
    type: SUBMISSION_TYPE,
  });

  const res = http.post(url, payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.token}`,
    },
    tags: { name: "submit" },
  });

  submissionsTotal.add(1);
  const ok = check(res, {
    "status is 202 or 201": (r) => r.status === 202 || r.status === 201,
  });
  if (!ok) submitFailures.add(1);
}
