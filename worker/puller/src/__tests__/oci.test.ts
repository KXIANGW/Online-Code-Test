import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { describe, expect, it, vi } from "vitest";
import { RealOciClient, type ProcSpawner } from "../oci";

interface SpawnResult {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

function fakeSpawner(results: SpawnResult[]): {
  spawner: ProcSpawner;
  calls: Array<{ cmd: string; args: string[] }>;
} {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const spawner = vi.fn((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const result = results.shift();
    if (!result) {
      throw new Error(`unexpected process spawn: ${cmd} ${args.join(" ")}`);
    }

    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as Partial<ChildProcess> & EventEmitter;
    child.stdout = stdout as never;
    child.stderr = stderr as never;

    queueMicrotask(() => {
      if (result.stdout) stdout.emit("data", Buffer.from(result.stdout, "utf8"));
      if (result.stderr) stderr.emit("data", Buffer.from(result.stderr, "utf8"));
      child.emit("close", result.exitCode);
    });

    return child as ChildProcess;
  });

  return { spawner, calls };
}

describe("RealOciClient", () => {
  it("returns trimmed digest from skopeo inspect", async () => {
    const { spawner, calls } = fakeSpawner([{ stdout: "sha256:abc123\n", exitCode: 0 }]);
    const client = new RealOciClient({ spawner });

    await expect(client.inspectDigest("ghcr.io/example/python:latest")).resolves.toBe(
      "sha256:abc123"
    );
    expect(calls).toEqual([
      {
        cmd: "skopeo",
        args: [
          "inspect",
          "--format",
          "{{.Digest}}",
          "docker://ghcr.io/example/python:latest",
        ],
      },
    ]);
  });

  it("rejects inspect failures with stderr context", async () => {
    const { spawner } = fakeSpawner([{ stderr: "unauthorized\n", exitCode: 1 }]);
    const client = new RealOciClient({ spawner });

    await expect(client.inspectDigest("private/image:latest")).rejects.toThrow(
      "skopeo inspect failed for private/image:latest: unauthorized"
    );
  });

  it("copies image to OCI layout before unpacking with umoci", async () => {
    const { spawner, calls } = fakeSpawner([{ exitCode: 0 }, { exitCode: 0 }]);
    const client = new RealOciClient({ spawner });

    await expect(
      client.pullAndUnpack("ghcr.io/example/cpp:17", "/var/rootfs/cpp17-sha256_abc")
    ).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        cmd: "skopeo",
        args: [
          "copy",
          "docker://ghcr.io/example/cpp:17",
          "oci:/var/rootfs/cpp17-sha256_abc.oci:latest",
        ],
      },
      {
        cmd: "umoci",
        args: [
          "unpack",
          "--rootless",
          "--image",
          "/var/rootfs/cpp17-sha256_abc.oci:latest",
          "/var/rootfs/cpp17-sha256_abc",
        ],
      },
    ]);
  });

  it("stops before unpack when skopeo copy fails", async () => {
    const { spawner, calls } = fakeSpawner([{ stderr: "registry timeout\n", exitCode: 2 }]);
    const client = new RealOciClient({ spawner });

    await expect(client.pullAndUnpack("ghcr.io/example/cpp:17", "/tmp/cpp")).rejects.toThrow(
      "skopeo copy failed for ghcr.io/example/cpp:17: registry timeout"
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe("skopeo");
  });

  it("rejects umoci unpack failures with stderr context", async () => {
    const { spawner } = fakeSpawner([
      { exitCode: 0 },
      { stderr: "invalid layer\n", exitCode: 3 },
    ]);
    const client = new RealOciClient({ spawner });

    await expect(client.pullAndUnpack("ghcr.io/example/cpp:17", "/tmp/cpp")).rejects.toThrow(
      "umoci unpack failed for ghcr.io/example/cpp:17: invalid layer"
    );
  });
});
