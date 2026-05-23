# AppArmor profile for the OCT Worker container when SANDBOX_ENGINE=isolate.
#
# Apply via Pod annotation:
#   container.apparmor.security.beta.kubernetes.io/worker: localhost/oct-isolate
#
# Production rollout:
#   1. Install this file into /etc/apparmor.d/oct-isolate on every Worker Node
#   2. Run `apparmor_parser -r /etc/apparmor.d/oct-isolate` once per Node
#   3. Add the Pod annotation above to the Worker Deployment
#
# This is defence-in-depth on top of Isolate's own namespace/cgroup/seccomp.
# Goal: even if the Worker process itself is compromised, it can read only the
# pulled language rootfs, write only the per-judge work directory and the
# isolate box state, and call only Node.js + isolate.

#include <tunables/global>

profile oct-isolate flags=(attach_disconnected, mediate_deleted) {
  #include <abstractions/base>
  #include <abstractions/nameservice>

  # --- Node.js runtime ----------------------------------------------------
  /usr/local/bin/node ix,
  /app/** r,
  /app/dist/** r,

  # --- Isolate binary (setuid) -------------------------------------------
  /usr/local/bin/isolate Ux,
  /var/local/lib/isolate/** rwlk,

  # --- Language rootfs (readonly) ----------------------------------------
  /var/lib/oct/rootfs/ r,
  /var/lib/oct/rootfs/** r,

  # --- Per-judge work directory (read/write) -----------------------------
  /tmp/judge/ rw,
  /tmp/judge/** rwlk,

  # --- Pod-level paths ----------------------------------------------------
  /tmp/ rw,
  /proc/*/status r,
  /proc/sys/kernel/random/uuid r,

  # --- Network (RabbitMQ, Postgres, Prometheus scrape, K8s API) ----------
  network inet stream,
  network inet6 stream,
  network unix stream,

  # --- Capabilities -------------------------------------------------------
  # Drop everything; isolate manages its own privilege via setuid.
  deny capability,

  # --- Explicit denials ---------------------------------------------------
  # Block direct access to host root paths beyond what we allowed above.
  deny /etc/shadow r,
  deny /etc/sudoers r,
  deny /root/** r,
  deny /var/run/docker.sock rw,
  deny /run/containerd/containerd.sock rw,
}
