#!/usr/bin/env bash
#
# Runs role-based deployment API load tests one role at a time and writes a
# Markdown report plus per-role k6 summary JSON files.
#
# Example:
#   DURATION=3m ./loadtest/run-role-api-tests.sh
#   ROLES="candidate interviewer" CANDIDATE_RPS=20 ./loadtest/run-role-api-tests.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/loadtest/k6-roles.js"
REPORT_DIR="${REPORT_DIR:-${ROOT_DIR}/loadtest/reports/$(date +%Y%m%d-%H%M%S)}"
REPORT_PATH="${REPORT_PATH:-${REPORT_DIR}/role-api-report.md}"
ROLES="${ROLES:-anonymous candidate interviewer problemSetter admin}"
DURATION="${DURATION:-5m}"
PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-50}"
MAX_VUS="${MAX_VUS:-500}"
DRY_RUN="${DRY_RUN:-false}"

mkdir -p "$REPORT_DIR"

SUMMARY_TMP="${REPORT_DIR}/.summary-rows.tmp"
DETAILS_TMP="${REPORT_DIR}/.details.tmp"
> "$SUMMARY_TMP"
> "$DETAILS_TMP"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is required. Install with: brew install k6" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to summarize k6 JSON output." >&2
  exit 1
fi

role_rps() {
  case "$1" in
    anonymous) echo "${ANON_RPS:-20}" ;;
    candidate) echo "${CANDIDATE_RPS:-5}" ;;
    interviewer) echo "${INTERVIEWER_RPS:-2}" ;;
    problemSetter) echo "${PROBLEM_SETTER_RPS:-2}" ;;
    admin) echo "${ADMIN_RPS:-1}" ;;
    *)
      echo "Unknown role: $1" >&2
      exit 1
      ;;
  esac
}

role_env_name() {
  case "$1" in
    anonymous) echo "ANON_RPS" ;;
    candidate) echo "CANDIDATE_RPS" ;;
    interviewer) echo "INTERVIEWER_RPS" ;;
    problemSetter) echo "PROBLEM_SETTER_RPS" ;;
    admin) echo "ADMIN_RPS" ;;
    *)
      echo "Unknown role: $1" >&2
      exit 1
      ;;
  esac
}

write_report_header() {
  local app_url="${APP_URL:-https://ikmlab.cs.nthu.edu.tw/online_code_test/}"
  local api_url="${API_URL:-${app_url%/}/api}"

  {
    echo "# Role API Load Test Report"
    echo
    echo "- Generated at: $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "- APP_URL: ${app_url}"
    echo "- API_URL: ${api_url}"
    echo "- Duration per role: ${DURATION}"
    echo "- Roles: ${ROLES}"
    echo "- Report directory: ${REPORT_DIR}"
    echo
    echo "## Summary"
    echo
    echo "| Role | Target RPS | Actual RPS | Requests | Failed (n) | Failed % | Avg ms | p95 ms | p99 ms | Check failures | Dropped iterations | Result |"
    echo "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
  } >"$REPORT_PATH"
}

append_summary_row() {
  local role="$1"
  local target_rps="$2"
  local summary_json="$3"
  local exit_code="$4"

  node - "$role" "$target_rps" "$summary_json" "$exit_code" >>"$SUMMARY_TMP" <<'NODE'
const fs = require("node:fs");

const [role, targetRps, summaryPath, exitCodeText] = process.argv.slice(2);
const exitCode = Number(exitCodeText);
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const metrics = summary.metrics ?? {};

function value(metricName, key) {
  const metric = metrics[metricName];
  if (!metric) return 0;
  return Number(metric[key] ?? 0);
}

function fixed(number, digits) {
  return Number.isFinite(number) ? number.toFixed(digits) : "0";
}

const requests = value("http_reqs", "count");
const actualRps = value("http_reqs", "rate");
// http_req_failed is a Rate metric: "passes" = failed requests count, "value" = rate (0-1)
const failedCount = value("http_req_failed", "passes");
const failedRate = value("http_req_failed", "value") * 100;
const avgMs = value("http_req_duration", "avg");
const p95 = value("http_req_duration", "p(95)");
const p99 = value("http_req_duration", "p(99)");
const checkFailures = value("role_check_failures", "count") || value("checks_failed", "count");
const dropped = value("dropped_iterations", "count");
const result = exitCode === 0 ? "PASS" : "FAIL";

console.log(
  `| ${role} | ${targetRps} | ${fixed(actualRps, 2)} | ${requests} | ${failedCount} | ${fixed(failedRate, 2)} | ${fixed(avgMs, 2)} | ${fixed(p95, 2)} | ${fixed(p99, 2)} | ${checkFailures} | ${dropped} | ${result} |`,
);
NODE
}

append_detail_section() {
  local role="$1"
  local target_rps="$2"
  local summary_json="$3"
  local log_path="$4"
  local exit_code="$5"

  {
    echo
    echo "## ${role}"
    echo
    echo "- Target RPS: ${target_rps}"
    echo "- k6 summary: ${summary_json}"
    echo "- k6 log: ${log_path}"
    echo "- Exit code: ${exit_code}"
    echo
  } >>"$DETAILS_TMP"

  # Per-check failure breakdown
  node - "$summary_json" >>"$DETAILS_TMP" <<'NODE'
const fs = require("node:fs");
const [summaryPath] = process.argv.slice(2);
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

function collectChecks(group, rows) {
  for (const check of Object.values(group.checks ?? {})) {
    const total = (check.passes ?? 0) + (check.fails ?? 0);
    if (total > 0) rows.push({ name: check.name, passes: check.passes ?? 0, fails: check.fails ?? 0, total });
  }
  for (const sub of Object.values(group.groups ?? {})) collectChecks(sub, rows);
}

const rows = [];
collectChecks(summary.root_group ?? {}, rows);
if (rows.length === 0) process.exit(0);

console.log("### Check results\n");
console.log("| Check | Pass | Fail | Pass % |");
console.log("| --- | ---: | ---: | ---: |");
for (const r of rows) {
  const pct = ((r.passes / r.total) * 100).toFixed(1);
  const mark = r.fails > 0 ? "✗" : "✓";
  console.log(`| ${mark} ${r.name} | ${r.passes} | ${r.fails} | ${pct}% |`);
}
console.log();
NODE

  # Error type summary from log (top 10, only if errors exist)
  local error_summary
  error_summary=$(grep 'Request Failed' "$log_path" 2>/dev/null \
    | sed 's/.*error="\(.*\)"/\1/' \
    | sed 's/\\"/"/g' \
    | sed 's/Get "http[^"]*": //' \
    | sort | uniq -c | sort -rn | head -10 || true)

  if [[ -n "$error_summary" ]]; then
    {
      echo "### Request error breakdown"
      echo
      echo "\`\`\`"
      echo "  count  error"
      echo "$error_summary"
      echo "\`\`\`"
      echo
    } >>"$DETAILS_TMP"
  fi
}

write_report_header

overall_exit=0

for role in $ROLES; do
  rps="$(role_rps "$role")"
  rps_env="$(role_env_name "$role")"
  summary_json="${REPORT_DIR}/${role}-summary.json"
  log_path="${REPORT_DIR}/${role}.log"

  echo "[loadtest] role=${role} target_rps=${rps} duration=${DURATION}"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[loadtest] dry-run: ROLE_SCENARIOS=${role} ${rps_env}=${rps} DURATION=${DURATION}"
    continue
  fi

  set +e
  env \
    ROLE_SCENARIOS="$role" \
    DURATION="$DURATION" \
    PRE_ALLOCATED_VUS="$PRE_ALLOCATED_VUS" \
    MAX_VUS="$MAX_VUS" \
    "$rps_env=$rps" \
    k6 run \
      --summary-trend-stats "avg,min,med,max,p(90),p(95),p(99)" \
      --summary-export "$summary_json" \
      "$SCRIPT_PATH" 2>&1 | tee "$log_path"
  exit_code=${PIPESTATUS[0]}
  set -e

  append_summary_row "$role" "$rps" "$summary_json" "$exit_code"
  append_detail_section "$role" "$rps" "$summary_json" "$log_path" "$exit_code"

  if [[ "$exit_code" -ne 0 ]]; then
    overall_exit=1
  fi
done

# Assemble: header (already in REPORT_PATH) → all summary rows → all detail sections
cat "$SUMMARY_TMP" >> "$REPORT_PATH"
cat "$DETAILS_TMP" >> "$REPORT_PATH"
rm -f "$SUMMARY_TMP" "$DETAILS_TMP"

cat >>"$REPORT_PATH" <<'EOF'

## Pass Criteria

- `Failed % < 1`
- `p95 ms < 1000`
- `p99 ms < 2000`
- `Check failures = 0`
- `Dropped iterations = 0`

If a role fails, open its log file first. Use `DEBUG_FAILURES=true` to print failed HTTP status/body snippets on the next run.
EOF

echo "[loadtest] report written: ${REPORT_PATH}"
exit "$overall_exit"
