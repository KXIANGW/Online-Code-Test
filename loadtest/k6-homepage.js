// loadtest/k6-homepage.js
//
// Ramps requests per second against the deployed OCT homepage so you can find
// the highest stable RPS before latency or errors break the target thresholds.
//
// Run with:
//   k6 run loadtest/k6-homepage.js
//
// Useful overrides:
//   TARGET_URL=https://ikmlab.cs.nthu.edu.tw/online_code_test/ MAX_RPS=300 k6 run loadtest/k6-homepage.js

import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const requestFailures = new Counter("homepage_check_failures");

const TARGET_URL = __ENV.TARGET_URL ?? "https://ikmlab.cs.nthu.edu.tw/online_code_test/";
const START_RPS = Number(__ENV.START_RPS ?? 10);
const MAX_RPS = Number(__ENV.MAX_RPS ?? 200);
const RAMP_DURATION = __ENV.RAMP_DURATION ?? "5m";
const HOLD_DURATION = __ENV.HOLD_DURATION ?? "3m";
const PRE_ALLOCATED_VUS = Number(__ENV.PRE_ALLOCATED_VUS ?? 100);
const MAX_VUS = Number(__ENV.MAX_VUS ?? 1000);
const DEBUG_FAILURES = __ENV.DEBUG_FAILURES === "true";

export const options = {
  scenarios: {
    homepage_capacity: {
      executor: "ramping-arrival-rate",
      timeUnit: "1s",
      startRate: START_RPS,
      preAllocatedVUs: PRE_ALLOCATED_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { duration: RAMP_DURATION, target: MAX_RPS },
        { duration: HOLD_DURATION, target: MAX_RPS },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:homepage}": ["p(95)<1000", "p(99)<2000"],
    homepage_check_failures: ["count<10"],
  },
};

export default function () {
  const res = http.get(TARGET_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "OCT-k6-load-test/1.0",
    },
    tags: { name: "homepage" },
  });

  const ok = check(res, {
    "homepage returns 2xx or 3xx": (r) => r.status >= 200 && r.status < 400,
    "homepage has a response body": (r) => r.body !== null && r.body.length > 0,
  });

  if (!ok) {
    requestFailures.add(1);
    if (DEBUG_FAILURES) {
      console.warn(`homepage check failed: status=${res.status} url=${TARGET_URL}`);
    }
  }
}
