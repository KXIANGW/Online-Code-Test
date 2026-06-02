// loadtest/k6-roles.js
//
// Role-oriented k6 scenarios for the deployed OCT site. The script separates
// anonymous frontend traffic from authenticated candidate, interviewer,
// problem-setter, and admin API traffic so each role can be tuned and read
// independently in the summary.
//
// Default credentials match infra/postgres/10-scenarios.sql. Override them
// with env vars when testing another deployment.

import http from "k6/http";
import { check, group } from "k6";
import { Counter } from "k6/metrics";

const roleCheckFailures = new Counter("role_check_failures");

const APP_URL = trimTrailingSlash(
  __ENV.APP_URL ?? "https://ikmlab.cs.nthu.edu.tw/online_code_test/",
);
const API_URL = trimTrailingSlash(__ENV.API_URL ?? `${APP_URL}/api`);
const DURATION = __ENV.DURATION ?? "5m";
const PRE_ALLOCATED_VUS = Number(__ENV.PRE_ALLOCATED_VUS ?? 50);
const MAX_VUS = Number(__ENV.MAX_VUS ?? 500);
const DEBUG_FAILURES = __ENV.DEBUG_FAILURES === "true";
const FETCH_ASSETS = __ENV.FETCH_ASSETS !== "false";
const INCLUDE_PASSWORD_LOOKUPS = __ENV.INCLUDE_PASSWORD_LOOKUPS === "true";
const CANDIDATE_WRITE_DRAFTS = __ENV.CANDIDATE_WRITE_DRAFTS === "true";

const ROLE_SCENARIOS = new Set(
  (__ENV.ROLE_SCENARIOS ?? "anonymous,candidate,interviewer,problemSetter,admin")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const credentials = {
  candidate: {
    username: __ENV.CANDIDATE_USERNAME ?? "candidate_20260509_001",
    password: __ENV.CANDIDATE_PASSWORD ?? "Cand@1234",
  },
  interviewer: {
    username: __ENV.INTERVIEWER_USERNAME ?? "alice",
    password: __ENV.INTERVIEWER_PASSWORD ?? "Test@1234",
  },
  problemSetter: {
    username: __ENV.PROBLEM_SETTER_USERNAME ?? "carol",
    password: __ENV.PROBLEM_SETTER_PASSWORD ?? "Test@1234",
  },
  admin: {
    username: __ENV.ADMIN_USERNAME ?? "root",
    password: __ENV.ADMIN_PASSWORD ?? "Root@1234",
  },
};

const roleDefinitions = {
  anonymous: {
    exec: "anonymousFlow",
    rate: Number(__ENV.ANON_RPS ?? 20),
  },
  candidate: {
    exec: "candidateFlow",
    rate: Number(__ENV.CANDIDATE_RPS ?? 5),
  },
  interviewer: {
    exec: "interviewerFlow",
    rate: Number(__ENV.INTERVIEWER_RPS ?? 2),
  },
  problemSetter: {
    exec: "problemSetterFlow",
    rate: Number(__ENV.PROBLEM_SETTER_RPS ?? 2),
  },
  admin: {
    exec: "adminFlow",
    rate: Number(__ENV.ADMIN_RPS ?? 1),
  },
};

export const options = {
  scenarios: buildScenarios(),
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    role_check_failures: ["count<20"],
  },
};

export function setup() {
  const state = { appUrl: APP_URL, apiUrl: API_URL, tokens: {}, candidate: {} };

  for (const role of ["candidate", "interviewer", "problemSetter", "admin"]) {
    if (!ROLE_SCENARIOS.has(role)) continue;
    state.tokens[role] = login(role, credentials[role]);
  }

  if (ROLE_SCENARIOS.has("candidate") && state.tokens.candidate) {
    state.candidate = discoverCandidateSession(state.tokens.candidate);
  }

  return state;
}

export function anonymousFlow(data) {
  group("anonymous: frontend shell", () => {
    const res = request("anonymous", "GET", data.appUrl, undefined, undefined, {
      name: "anonymous_homepage",
    });

    if (
      FETCH_ASSETS &&
      res &&
      res.status >= 200 &&
      res.status < 400 &&
      typeof res.body === "string"
    ) {
      for (const assetUrl of extractAssetUrls(data.appUrl, res.body).slice(0, 8)) {
        request("anonymous", "GET", assetUrl, undefined, undefined, { name: "anonymous_asset" });
      }
    }
  });
}

export function candidateFlow(data) {
  const token = data.tokens.candidate;
  if (!token) return;

  group("candidate: exam taking reads", () => {
    request("candidate", "GET", `${data.apiUrl}/languages`, token, undefined, {
      name: "candidate_languages",
    });
    request("candidate", "GET", `${data.apiUrl}/exam-sessions`, token, undefined, {
      name: "candidate_sessions",
    });

    const sessionId = data.candidate.sessionId;
    if (!sessionId) return;

    request("candidate", "GET", `${data.apiUrl}/exam-sessions/${sessionId}`, token, undefined, {
      name: "candidate_session_detail",
    });
    request(
      "candidate",
      "GET",
      `${data.apiUrl}/exam-sessions/${sessionId}/drafts`,
      token,
      undefined,
      {
        name: "candidate_drafts",
      },
    );
    request(
      "candidate",
      "GET",
      `${data.apiUrl}/exam-sessions/${sessionId}/submissions`,
      token,
      undefined,
      {
        name: "candidate_submissions",
      },
    );

    const problemsRes = request(
      "candidate",
      "GET",
      `${data.apiUrl}/exam-sessions/${sessionId}/problems`,
      token,
      undefined,
      { name: "candidate_session_problems" },
    );
    const problems = parseJsonArray(problemsRes);
    const firstProblem = problems[0] ?? data.candidate.firstProblem;
    if (firstProblem?.id) {
      request(
        "candidate",
        "GET",
        `${data.apiUrl}/exam-sessions/${sessionId}/problems/${firstProblem.id}/testcases`,
        token,
        undefined,
        { name: "candidate_public_testcases" },
      );
    }

    if (CANDIDATE_WRITE_DRAFTS && firstProblem?.problemId) {
      request(
        "candidate",
        "PUT",
        `${data.apiUrl}/exam-sessions/${sessionId}/drafts/${firstProblem.problemId}/python3`,
        token,
        { code: "# k6 draft heartbeat\nprint('hello')\n" },
        { name: "candidate_save_draft" },
      );
    }
  });
}

export function interviewerFlow(data) {
  const token = data.tokens.interviewer;
  if (!token) return;

  group("interviewer: exam management reads", () => {
    request("interviewer", "GET", `${data.apiUrl}/users`, token, undefined, {
      name: "interviewer_users",
    });
    const sessionsRes = request(
      "interviewer",
      "GET",
      `${data.apiUrl}/exam-sessions`,
      token,
      undefined,
      {
        name: "interviewer_sessions",
      },
    );
    request("interviewer", "GET", `${data.apiUrl}/exam-sessions/templates`, token, undefined, {
      name: "interviewer_templates",
    });
    request("interviewer", "GET", `${data.apiUrl}/problems`, token, undefined, {
      name: "interviewer_problems",
    });

    const session = parseJsonArray(sessionsRes)[0];
    if (session?.id) {
      request(
        "interviewer",
        "GET",
        `${data.apiUrl}/exam-sessions/${session.id}`,
        token,
        undefined,
        {
          name: "interviewer_session_detail",
        },
      );
      request(
        "interviewer",
        "GET",
        `${data.apiUrl}/exam-sessions/${session.id}/violations`,
        token,
        undefined,
        {
          name: "interviewer_violations",
        },
      );
      if (INCLUDE_PASSWORD_LOOKUPS) {
        request(
          "interviewer",
          "GET",
          `${data.apiUrl}/exam-sessions/${session.id}/candidate-password`,
          token,
          undefined,
          { name: "interviewer_candidate_password" },
        );
      }
    }
  });
}

export function problemSetterFlow(data) {
  const token = data.tokens.problemSetter;
  if (!token) return;

  group("problemSetter: problem management reads", () => {
    request("problemSetter", "GET", `${data.apiUrl}/languages`, token, undefined, {
      name: "problem_setter_languages",
    });
    const problemsRes = request(
      "problemSetter",
      "GET",
      `${data.apiUrl}/problems`,
      token,
      undefined,
      {
        name: "problem_setter_problems",
      },
    );
    const problem = parseJsonArray(problemsRes)[0];
    if (problem?.id) {
      request("problemSetter", "GET", `${data.apiUrl}/problems/${problem.id}`, token, undefined, {
        name: "problem_setter_problem_detail",
      });
    }
  });
}

export function adminFlow(data) {
  const token = data.tokens.admin;
  if (!token) return;

  group("admin: root dashboard reads", () => {
    request("admin", "GET", `${data.apiUrl}/users`, token, undefined, { name: "admin_users" });
    request("admin", "GET", `${data.apiUrl}/problems`, token, undefined, {
      name: "admin_problems",
    });
    request("admin", "GET", `${data.apiUrl}/exam-sessions`, token, undefined, {
      name: "admin_sessions",
    });
    request("admin", "GET", `${data.apiUrl}/exam-sessions/templates`, token, undefined, {
      name: "admin_templates",
    });
    request("admin", "GET", `${data.apiUrl}/languages`, token, undefined, {
      name: "admin_languages",
    });
  });
}

function buildScenarios() {
  const scenarios = {};
  for (const [role, definition] of Object.entries(roleDefinitions)) {
    if (!ROLE_SCENARIOS.has(role) || definition.rate <= 0) continue;
    scenarios[role] = {
      executor: "constant-arrival-rate",
      rate: definition.rate,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: PRE_ALLOCATED_VUS,
      maxVUs: MAX_VUS,
      exec: definition.exec,
      tags: { role },
    };
  }
  return scenarios;
}

function login(role, credential) {
  const res = request(role, "POST", `${API_URL}/auth/login`, undefined, credential, {
    name: `${role}_login`,
  });
  const body = parseJsonObject(res);
  if (!body.token) {
    console.warn(`login failed for role=${role}; that role scenario will be skipped`);
    return undefined;
  }
  return body.token;
}

function discoverCandidateSession(token) {
  const sessionsRes = request("candidate", "GET", `${API_URL}/exam-sessions`, token, undefined, {
    name: "candidate_setup_sessions",
  });
  const session =
    parseJsonArray(sessionsRes).find((row) => row.status === "in_progress") ??
    parseJsonArray(sessionsRes)[0];
  if (!session?.id) return {};

  const problemsRes = request(
    "candidate",
    "GET",
    `${API_URL}/exam-sessions/${session.id}/problems`,
    token,
    undefined,
    { name: "candidate_setup_problems" },
  );

  return {
    sessionId: session.id,
    firstProblem: parseJsonArray(problemsRes)[0],
  };
}

function request(role, method, url, token, body, tags) {
  const params = {
    headers: {
      Accept: "application/json,text/html,*/*",
      "User-Agent": "OCT-k6-role-load-test/1.0",
    },
    tags: { role, ...(tags ?? {}) },
  };
  if (token) params.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) params.headers["Content-Type"] = "application/json";

  const payload = body === undefined ? undefined : JSON.stringify(body);
  const res = http.request(method, url, payload, params);
  const ok = check(res, {
    [`${role} ${method} ${tags?.name ?? url} returns 2xx/3xx`]: (r) =>
      r.status >= 200 && r.status < 400,
  });

  if (!ok) {
    roleCheckFailures.add(1, { role });
    if (DEBUG_FAILURES) {
      console.warn(
        `${role} ${method} ${url} failed: status=${res.status} body=${truncate(res.body)}`,
      );
    }
  }

  return res;
}

function parseJsonArray(res) {
  const value = parseJson(res);
  return Array.isArray(value) ? value : [];
}

function parseJsonObject(res) {
  const value = parseJson(res);
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseJson(res) {
  if (!res || !res.body) return undefined;
  try {
    return JSON.parse(res.body);
  } catch (_err) {
    return undefined;
  }
}

function extractAssetUrls(appUrl, html) {
  const matches = html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|ico|png|svg|webp))"/g);
  return [...matches].map((match) => resolveUrl(appUrl, match[1]));
}

function resolveUrl(baseUrl, href) {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  const origin = baseUrl.match(/^https?:\/\/[^/]+/)?.[0] ?? "";
  if (href.startsWith("/")) return `${origin}${href}`;
  return `${trimTrailingSlash(baseUrl)}/${href}`;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function truncate(value) {
  if (typeof value !== "string") return "";
  return value.length > 160 ? `${value.slice(0, 160)}...` : value;
}
