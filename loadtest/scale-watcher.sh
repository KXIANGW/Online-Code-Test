#!/usr/bin/env bash
#
# loadtest/scale-watcher.sh
#
# A docker-compose stand-in for KEDA. Polls Prometheus every 5s for
# - sum(judge_in_flight)
# - sum(rabbitmq_queue_messages{queue="judge.tasks"})
# - avg CPU% across oct-worker-* containers (cAdvisor)
# and runs `docker compose up -d --scale worker=N --no-recreate` to
# track desired replicas (1 <= N <= MAX, default MAX=5).
#
# Scale-up rule:   queue_depth > UP_QUEUE   OR   cpu_avg > UP_CPU
# Scale-down rule: queue_depth = 0   AND   cpu_avg < DOWN_CPU
#                  for at least DOWN_QUIET_SECS consecutive ticks
#
# Phase D will replace this with a real KEDA ScaledObject backed by the
# same Prometheus metrics; the algorithm here mirrors the trigger rules
# we plan to ship to k8s.
#
# Usage:
#   ./loadtest/scale-watcher.sh            # tail -f style, Ctrl-C to stop
#   MAX=3 UP_CPU=70 ./loadtest/scale-watcher.sh
#
set -euo pipefail

PROM="${PROM:-http://localhost:9090}"
MAX="${MAX:-5}"
MIN="${MIN:-1}"
UP_QUEUE="${UP_QUEUE:-5}"
UP_CPU="${UP_CPU:-80}"
DOWN_CPU="${DOWN_CPU:-20}"
DOWN_QUIET_TICKS="${DOWN_QUIET_TICKS:-4}"      # 4 ticks * 5s = 20s quiet
COOLDOWN_SECS="${COOLDOWN_SECS:-30}"
INTERVAL="${INTERVAL:-5}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-oct}"

quiet_count=0
last_change=0
current=$(docker compose -p "$COMPOSE_PROJECT" ps worker --status running -q | wc -l)
if [[ "$current" -lt "$MIN" ]]; then current="$MIN"; fi

query() {
  local q="$1"
  # jq returns "null" string if the result is empty; coerce to 0.
  local raw
  raw=$(curl -sf --get --data-urlencode "query=${q}" "${PROM}/api/v1/query" || echo '{}')
  echo "$raw" | jq -r '.data.result[0].value[1] // "0"' 2>/dev/null || echo "0"
}

echo "[watcher] start  current=${current}  MIN=${MIN} MAX=${MAX} UP(queue>${UP_QUEUE} OR cpu>${UP_CPU}%)  DOWN(queue=0 AND cpu<${DOWN_CPU}% for ${DOWN_QUIET_TICKS}t)"

while true; do
  in_flight=$(query 'sum(judge_in_flight)')
  queue=$(query 'sum(rabbitmq_queue_messages{queue="judge.tasks"})')
  cpu=$(query 'avg(rate(container_cpu_usage_seconds_total{name=~"oct-worker.*"}[30s]))*100')

  # Float -> int (round) for shell comparisons.
  queue_i=$(printf "%.0f" "$queue" 2>/dev/null || echo 0)
  cpu_i=$(printf "%.0f" "$cpu" 2>/dev/null || echo 0)

  ts=$(date +%H:%M:%S)
  printf "[%s] in_flight=%-4s queue=%-4s cpu=%-5s%% current=%d quiet=%d\n" \
    "$ts" "$in_flight" "$queue_i" "$cpu_i" "$current" "$quiet_count"

  now=$(date +%s)
  on_cooldown=$((now - last_change < COOLDOWN_SECS))

  desired=$current

  # Scale up?
  if (( queue_i > UP_QUEUE )) || (( cpu_i > UP_CPU )); then
    quiet_count=0
    if (( current < MAX )) && (( on_cooldown == 0 )); then
      desired=$((current + 1))
    fi
  # Scale down candidate?
  elif (( queue_i == 0 )) && (( cpu_i < DOWN_CPU )); then
    quiet_count=$((quiet_count + 1))
    if (( quiet_count >= DOWN_QUIET_TICKS )) \
       && (( current > MIN )) \
       && (( on_cooldown == 0 )); then
      desired=$((current - 1))
      quiet_count=0
    fi
  else
    quiet_count=0
  fi

  if (( desired != current )); then
    echo "[watcher] scaling worker: ${current} -> ${desired}"
    docker compose -p "$COMPOSE_PROJECT" up -d --scale "worker=${desired}" --no-recreate worker
    current=$desired
    last_change=$now
  fi

  sleep "$INTERVAL"
done
