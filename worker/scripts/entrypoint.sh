#!/bin/sh
# Delegates cgroup v2 controllers so isolate's `box-N` sub-cgroup has
# memory.events / pids / etc. Skips silently on hosts where /sys/fs/cgroup
# is read-only (running without --privileged).

set -e

if [ -w /sys/fs/cgroup/cgroup.subtree_control ] 2>/dev/null; then
  mkdir -p /sys/fs/cgroup/init
  if [ -f /sys/fs/cgroup/cgroup.procs ]; then
    while IFS= read -r pid; do
      [ -z "$pid" ] && continue
      echo "$pid" > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
    done < /sys/fs/cgroup/cgroup.procs
  fi
  for ctrl in memory pids cpu cpuset io; do
    echo "+${ctrl}" > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
  done
fi

exec "$@"
