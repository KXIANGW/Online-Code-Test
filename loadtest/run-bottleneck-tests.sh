#!/usr/bin/env bash
#
# loadtest/run-bottleneck-tests.sh
#
# Seeds test data and runs the three write bottleneck scenarios in sequence,
# then consolidates all results into a single Markdown report.
#
# Scenarios (default order):
#   start          POST /exam-sessions/:id/start   — DB state machine burst
#   submit_simple  POST /submissions type=simple   — MQ + Worker (repeatable)
#   submit_formal  POST /submissions type=formal   — full judge path + scoring
#
# Usage:
#   ./loadtest/run-bottleneck-tests.sh
#   VUS=200 ./loadtest/run-bottleneck-tests.sh
#   SCENARIOS="start submit_simple" ./loadtest/run-bottleneck-tests.sh
#   BASE_URL=http://localhost:3000/api VUS=50 FIXTURE=tle.py \
#     ./loadtest/run-bottleneck-tests.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOADTEST_DIR="${ROOT_DIR}/loadtest"
REPORT_DIR="${REPORT_DIR:-${LOADTEST_DIR}/reports/$(date +%Y%m%d-%H%M%S)}"
REPORT_PATH="${REPORT_DIR}/bottleneck-report.md"
SCENARIOS="${SCENARIOS:-start submit_simple submit_formal}"
VUS="${VUS:-100}"
BASE_URL="${BASE_URL:-http://localhost:3000/api}"
FIXTURE="${FIXTURE:-ac.py}"
DRY_RUN="${DRY_RUN:-false}"

mkdir -p "$REPORT_DIR"

SUMMARY_TMP="${REPORT_DIR}/.summary-rows.tmp"
DETAILS_TMP="${REPORT_DIR}/.details.tmp"
> "$SUMMARY_TMP"
> "$DETAILS_TMP"

# ── Prerequisite checks ──────────────────────────────────────────────────────

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is required. Install with: brew install k6" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required (comes with Node.js)." >&2
  exit 1
fi

# ── Seed helpers ─────────────────────────────────────────────────────────────

seed_submit() {
  echo "[bottleneck] seeding submit tokens via seed.ts ..."
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[bottleneck] dry-run: BASE_URL=${BASE_URL} npx tsx seed.ts"
    return
  fi
  ( cd "${LOADTEST_DIR}" && BASE_URL="$BASE_URL" npx tsx seed.ts )
  echo "[bottleneck] submit seed complete → ${LOADTEST_DIR}/.session-tokens.json"
}

seed_start() {
  echo "[bottleneck] seeding start tokens via seed-start.ts ..."
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[bottleneck] dry-run: BASE_URL=${BASE_URL} npx tsx seed-start.ts"
    return
  fi
  ( cd "${LOADTEST_DIR}" && BASE_URL="$BASE_URL" npx tsx seed-start.ts )
  echo "[bottleneck] start seed complete → ${LOADTEST_DIR}/.start-tokens.json"
}

# ── k6 runner ────────────────────────────────────────────────────────────────

run_scenario() {
  local name="$1"       # scenario label
  local script="$2"     # absolute path to k6 script
  local extra_env="$3"  # extra KEY=VAL pairs (space-separated), may be empty
  local summary_json="${REPORT_DIR}/${name}-summary.json"
  local log_path="${REPORT_DIR}/${name}.log"

  echo "[bottleneck] running scenario=${name} vus=${VUS} base_url=${BASE_URL}"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[bottleneck] dry-run: VUS=${VUS} BASE_URL=${BASE_URL} ${extra_env} k6 run ${script}"
    return
  fi

  set +e
  # shellcheck disable=SC2086
  env VUS="$VUS" BASE_URL="$BASE_URL" $extra_env \
    k6 run \
      --summary-trend-stats "avg,min,med,max,p(90),p(95),p(99)" \
      --summary-export "$summary_json" \
      "$script" 2>&1 | tee "$log_path"
  local exit_code=${PIPESTATUS[0]}
  set -e

  append_summary_row "$name" "$summary_json" "$exit_code"
  append_detail_section "$name" "$summary_json" "$log_path" "$exit_code"

  [[ "$exit_code" -ne 0 ]] && return 1 || return 0
}

# ── Report helpers ────────────────────────────────────────────────────────────

write_report_header() {
  {
    echo "# Bottleneck Load Test Report"
    echo
    echo "- Generated at: $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "- BASE_URL: ${BASE_URL}"
    echo "- VUS per scenario: ${VUS}"
    echo "- Fixture: ${FIXTURE}"
    echo "- Scenarios: ${SCENARIOS}"
    echo "- Report directory: \`${REPORT_DIR}\`"
    echo
    echo "## Summary"
    echo
    echo "| Scenario | VUS | Requests | Failed (n) | Failed % | Avg ms | p95 ms | p99 ms | Custom failures | Result |"
    echo "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
  } >"$REPORT_PATH"
}

append_summary_row() {
  local name="$1"
  local summary_json="$2"
  local exit_code="$3"

  node - "$name" "$summary_json" "$exit_code" "$VUS" >>"$SUMMARY_TMP" <<'NODE'
const fs = require("node:fs");
const [name, summaryPath, exitCodeText, vusText] = process.argv.slice(2);
const exitCode = Number(exitCodeText);
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const metrics = summary.metrics ?? {};

function value(metricName, key) {
  const m = metrics[metricName];
  if (!m) return 0;
  return Number(m[key] ?? 0);
}
function fixed(n, d) { return Number.isFinite(n) ? n.toFixed(d) : "0"; }

const requests   = value("http_reqs", "count");
const failedN    = value("http_req_failed", "passes");
const failedRate = value("http_req_failed", "value") * 100;
const avgMs      = value("http_req_duration", "avg");
const p95        = value("http_req_duration", "p(95)");
const p99        = value("http_req_duration", "p(99)");
const custom     = value("start_failures", "count") || value("submit_failures", "count");
const result     = exitCode === 0 ? "✅ PASS" : "❌ FAIL";

console.log(
  `| ${name} | ${vusText} | ${requests} | ${failedN} | ${fixed(failedRate,2)} | ${fixed(avgMs,2)} | ${fixed(p95,2)} | ${fixed(p99,2)} | ${custom} | ${result} |`
);
NODE
}

append_detail_section() {
  local name="$1"
  local summary_json="$2"
  local log_path="$3"
  local exit_code="$4"

  {
    echo
    echo "## ${name}"
    echo
    echo "- k6 summary: \`${summary_json}\`"
    echo "- k6 log:     \`${log_path}\`"
    echo "- Exit code:  ${exit_code}"
    echo
  } >>"$DETAILS_TMP"

  # Tagged latency + check results
  node - "$name" "$summary_json" >>"$DETAILS_TMP" <<'NODE'
const fs = require("node:fs");
const [name, summaryPath] = process.argv.slice(2);
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const metrics = summary.metrics ?? {};

const taggedKey = name === "start"
  ? "http_req_duration{name:start}"
  : "http_req_duration{name:submit}";

function value(metricName, key) {
  const m = metrics[metricName];
  if (!m) return 0;
  return Number(m[key] ?? 0);
}
function fixed(n, d) { return n > 0 ? n.toFixed(d) : "—"; }

const p95t = value(taggedKey, "p(95)");
const p99t = value(taggedKey, "p(99)");
if (p95t > 0 || p99t > 0) {
  console.log(`### Endpoint latency (\`${taggedKey}\`)\n`);
  console.log("| p95 ms | p99 ms |");
  console.log("| ---: | ---: |");
  console.log(`| ${fixed(p95t,2)} | ${fixed(p99t,2)} |\n`);
}

function collectChecks(group, rows) {
  for (const c of Object.values(group.checks ?? {})) {
    const total = (c.passes ?? 0) + (c.fails ?? 0);
    if (total > 0) rows.push({ name: c.name, passes: c.passes ?? 0, fails: c.fails ?? 0, total });
  }
  for (const sub of Object.values(group.groups ?? {})) collectChecks(sub, rows);
}
const rows = [];
collectChecks(summary.root_group ?? {}, rows);
if (!rows.length) process.exit(0);

console.log("### Check results\n");
console.log("| Check | Pass | Fail | Pass % |");
console.log("| --- | ---: | ---: | ---: |");
for (const r of rows) {
  const pct = ((r.passes / r.total) * 100).toFixed(1);
  console.log(`| ${r.fails > 0 ? "✗" : "✓"} ${r.name} | ${r.passes} | ${r.fails} | ${pct}% |`);
}
console.log();
NODE

  # HTTP error breakdown from log
  local errs
  errs=$(grep 'Request Failed' "$log_path" 2>/dev/null \
    | sed 's/.*error="\(.*\)"/\1/' \
    | sed 's/\\"/"/g' \
    | sed -E 's/(Get|Post|Put) "http[^"]*": //' \
    | sort | uniq -c | sort -rn | head -10 || true)

  if [[ -n "$errs" ]]; then
    {
      echo "### HTTP error breakdown"
      echo
      echo '```'
      echo "  count  error"
      echo "$errs"
      echo '```'
      echo
    } >>"$DETAILS_TMP"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

echo "[bottleneck] scenarios=${SCENARIOS} vus=${VUS} base_url=${BASE_URL}"
write_report_header
overall_exit=0

# Seed submit tokens once before the loop if any submit scenario is enabled.
needs_submit_seed=false
for s in $SCENARIOS; do
  [[ "$s" == "submit_simple" || "$s" == "submit_formal" ]] && needs_submit_seed=true
done
[[ "$needs_submit_seed" == "true" ]] && seed_submit

for scenario in $SCENARIOS; do
  case "$scenario" in
    start)
      # Each start test consumes all sessions (state machine is one-way),
      # so we always re-seed before running.
      seed_start
      run_scenario "start" \
        "${LOADTEST_DIR}/k6-start.js" \
        "" || overall_exit=1
      ;;
    submit_simple)
      run_scenario "submit_simple" \
        "${LOADTEST_DIR}/k6-submit.js" \
        "SUBMISSION_TYPE=simple FIXTURE=${FIXTURE}" || overall_exit=1
      ;;
    submit_formal)
      run_scenario "submit_formal" \
        "${LOADTEST_DIR}/k6-submit.js" \
        "SUBMISSION_TYPE=formal FIXTURE=${FIXTURE}" || overall_exit=1
      ;;
    *)
      echo "[bottleneck] unknown scenario: ${scenario}" >&2
      overall_exit=1
      ;;
  esac
done

cat "$SUMMARY_TMP" >>"$REPORT_PATH"
cat "$DETAILS_TMP" >>"$REPORT_PATH"
rm -f "$SUMMARY_TMP" "$DETAILS_TMP"

cat >>"$REPORT_PATH" <<'EOF'

## Pass Criteria

| Metric | Threshold |
| --- | --- |
| Failed % | < 2 |
| p95 ms | < 2000 |
| p99 ms | < 5000 |
| Custom failures | = 0 |

If a scenario fails, open its log file for the raw k6 output.
EOF

echo "[bottleneck] report written: ${REPORT_PATH}"
exit "$overall_exit"
