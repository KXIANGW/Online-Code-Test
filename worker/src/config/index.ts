import "dotenv/config";
import os from "node:os";

const DEFAULT_HOST_WORK_DIR = "/var/lib/oct/judge";
const DEFAULT_ISOLATE_BIN_PATH = "/usr/local/bin/isolate";

// Each isolate box maps to a host cgroup /sys/fs/cgroup/box-<id>. Because the
// worker Pod runs `privileged: true`, that cgroup lives in the *node's* shared
// hierarchy — so two co-located worker Pods using the same box-id race on
// --init/--cleanup of the same cgroup:
//   "Cannot remove control group /sys/fs/cgroup/box-0: Device or resource busy"
// which surfaces as spurious CE / system_error once KEDA scales the pool > 1.
//
// Fix: each Pod must own a distinct box-id. Precedence:
//   1) explicit ISOLATE_BOX_ID (operator override / single-box dev)
//   2) last octet of POD_IP — unique within a node's /24 Pod CIDR, so
//      co-located Pods never collide (requires Downward API env; see
//      k8s/08-worker.yaml). Range 0-255 fits num_boxes=256 in the image.
//   3) hostname hash — fallback for docker-compose / bare runs.
function resolveIsolateBoxId(): number {
  const explicit = process.env["ISOLATE_BOX_ID"];
  if (explicit && explicit.trim() !== "") return Number(explicit);

  const podIp = process.env["POD_IP"];
  if (podIp) {
    const lastOctet = Number(podIp.trim().split(".").pop());
    if (Number.isInteger(lastOctet) && lastOctet >= 0 && lastOctet <= 255) {
      return lastOctet;
    }
  }

  let hash = 0;
  for (const ch of os.hostname()) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return hash % 256;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalAbsolutePathEnv(name: string, fallback: string): string {
  const rawValue = process.env[name] ?? fallback;
  const trimmedValue = rawValue.trim();
  const value = trimmedValue.length > 0 ? trimmedValue : fallback;
  if (!value.startsWith("/")) {
    throw new Error(`${name} must be an absolute path`);
  }
  return value;
}

export const config = {
  rabbitmqUrl: requireEnv("RABBITMQ_URL"),
  databaseUrl: requireEnv("DATABASE_URL"),
  hostWorkDir: optionalAbsolutePathEnv("HOST_WORK_DIR", DEFAULT_HOST_WORK_DIR),
  isolateBinPath: optionalAbsolutePathEnv("ISOLATE_BIN_PATH", DEFAULT_ISOLATE_BIN_PATH),
  // IsolateEngine config. The legacy DockerEngine + SANDBOX_ENGINE knob were
  // dropped in Step B; the only engine now is isolate.
  rootfsBaseDir: process.env["ROOTFS_BASE_DIR"],
  // Per-Pod-unique box-id (see resolveIsolateBoxId) — prevents the shared
  // /sys/fs/cgroup/box-0 collision when KEDA runs multiple workers per node.
  isolateBoxId: resolveIsolateBoxId(),
  // Directory containing the seccomp wrapper + policy. Defaults to the path
  // baked into the worker image; set to empty string to disable seccomp
  // (only safe in trusted local dev).
  seccompBundleDir: process.env["SECCOMP_BUNDLE_DIR"] ?? "/etc/oct",
};
