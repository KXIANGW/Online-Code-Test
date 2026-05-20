# language-rootfs-puller

Per-Node DaemonSet that pulls language OCI images and unpacks them as flat
rootfs trees under `/var/lib/oct/rootfs/<lang>/`. Worker Pods on the same
Node mount this hostPath read-only and invoke
`isolate --chroot=/var/lib/oct/rootfs/<lang>` against it.

## How it works

```
[GitHub Actions]
       │ push OCI image
       ▼
[ghcr.io/oct-rootfs-<lang>:vX]
       │ skopeo copy + umoci unpack
       ▼
[DaemonSet on every Worker Node]
   /var/lib/oct/rootfs/cpp17-<digest>/   ← versioned dir
   /var/lib/oct/rootfs/cpp17     → symlink to current version
       │ readonly hostPath mount
       ▼
[Worker Pod] → isolate --chroot=/var/lib/oct/rootfs/cpp17
```

The puller reconciles in three modes:

| Mode | Trigger | Latency |
| --- | --- | --- |
| **Eager** | DaemonSet Pod start | n/a |
| **Poll** | every `POLL_INTERVAL_MS` (default 5 min) | ≤ 5 min |
| **Reload** | `POST /reload` from CI/CD | seconds |

## Atomic, no-downtime updates

The puller never overwrites the directory a Worker is reading. New rootfs goes
to `cpp17-<new-digest>/`; a `mv -T` atomically swaps the symlink. Already-open
file descriptors continue to point at the old inode (Linux ref counting), so
in-flight isolate processes finish on the old version. Subsequent isolate
invocations use the new version. GC removes obsolete directories on the next
reconcile cycle.

## Environment variables

| Var | Default | Notes |
| --- | --- | --- |
| `LANGUAGES_FILE` | `/config/languages.yaml` | ConfigMap-mounted |
| `ROOTFS_BASE_DIR` | `/var/lib/oct/rootfs` | hostPath target |
| `PORT` | `8081` | HTTP port |
| `POLL_INTERVAL_MS` | `300000` | 0 disables polling |
| `RELOAD_TOKEN` | unset | optional `X-Reload-Token` shared secret |

## Endpoints

- `GET  /healthz` — readiness/liveness probe target
- `POST /reload` — trigger immediate reconcile (requires token if configured)

## Local development

```bash
cd worker/puller
npm install
npm test           # 10 unit tests (no skopeo/umoci needed — mocked)
npm run lint
npm run build
```

## Deployment

Via the `charts/language-rootfs-puller` Helm chart. See its `values.yaml` for
configurable knobs.
