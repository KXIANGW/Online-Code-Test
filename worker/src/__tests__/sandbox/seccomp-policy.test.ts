import fs from "fs-extra";
import path from "path";
import { describe, expect, it } from "vitest";

// The shipped policy lives next to the Worker app; the Dockerfile copies it to
// /etc/oct/seccomp.policy at build time. This test guards the source-of-truth
// file so removing or weakening it is caught at PR time.
const POLICY_PATH = path.resolve(__dirname, "../../../sandbox/isolate-seccomp.policy");

const MUST_BLOCK_SYSCALLS = [
  // Namespace manipulation
  "unshare",
  "setns",
  // Tracing
  "ptrace",
  "process_vm_readv",
  "process_vm_writev",
  // Keyring
  "keyctl",
  "add_key",
  // eBPF / perf
  "bpf",
  "perf_event_open",
  // Kernel modules
  "init_module",
  "finit_module",
  // Filesystem bypass
  "mount",
  "pivot_root",
  "chroot",
  // Clock manipulation
  "settimeofday",
  // Personality / ABI
  "personality",
];

describe("isolate seccomp policy", () => {
  let content: string;

  it("exists at the documented path", async () => {
    expect(await fs.pathExists(POLICY_PATH)).toBe(true);
    content = await fs.readFile(POLICY_PATH, "utf8");
    expect(content.length).toBeGreaterThan(100);
  });

  it.each(MUST_BLOCK_SYSCALLS)("blocks %s", async (syscall) => {
    content ??= await fs.readFile(POLICY_PATH, "utf8");
    // A line `errno <syscall>` (with optional trailing whitespace/value)
    const pattern = new RegExp(`^(errno|kill)\\s+${syscall}(\\s|$)`, "m");
    expect(content).toMatch(pattern);
  });

  it("never `allow`s a syscall the policy is meant to block", async () => {
    content ??= await fs.readFile(POLICY_PATH, "utf8");
    for (const syscall of MUST_BLOCK_SYSCALLS) {
      const allowPattern = new RegExp(`^allow\\s+${syscall}(\\s|$)`, "m");
      expect(content).not.toMatch(allowPattern);
    }
  });
});
