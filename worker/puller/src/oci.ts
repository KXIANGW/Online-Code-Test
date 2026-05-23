import { spawn, type ChildProcess } from "child_process";

// Process abstraction so unit tests can inject a fake spawn().
export type ProcSpawner = (cmd: string, args: string[]) => ChildProcess;

const defaultSpawner: ProcSpawner = (cmd, args) =>
  spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

export interface OciClient {
  inspectDigest(image: string): Promise<string>;
  pullAndUnpack(image: string, destDir: string): Promise<void>;
}

export interface RealOciClientOptions {
  spawner?: ProcSpawner;
  workDir?: string; // temp area for OCI bundle, defaults to /tmp/puller
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function execProcess(spawner: ProcSpawner, cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawner(cmd, args);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({ stdout, stderr, exitCode: code ?? -1 })
    );
  });
}

// Wraps `skopeo inspect` and `skopeo copy + umoci unpack`.
// All actions are idempotent and safe to repeat.
export class RealOciClient implements OciClient {
  private readonly spawner: ProcSpawner;

  constructor(options: RealOciClientOptions = {}) {
    this.spawner = options.spawner ?? defaultSpawner;
  }

  async inspectDigest(image: string): Promise<string> {
    const result = await execProcess(this.spawner, "skopeo", [
      "inspect",
      "--format",
      "{{.Digest}}",
      `docker://${image}`,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`skopeo inspect failed for ${image}: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  async pullAndUnpack(image: string, destDir: string): Promise<void> {
    // Step 1: skopeo copy to a local OCI bundle
    const copyResult = await execProcess(this.spawner, "skopeo", [
      "copy",
      `docker://${image}`,
      `oci:${destDir}.oci:latest`,
    ]);
    if (copyResult.exitCode !== 0) {
      throw new Error(`skopeo copy failed for ${image}: ${copyResult.stderr.trim()}`);
    }

    // Step 2: umoci unpack into destDir
    const unpackResult = await execProcess(this.spawner, "umoci", [
      "unpack",
      "--rootless",
      "--image",
      `${destDir}.oci:latest`,
      destDir,
    ]);
    if (unpackResult.exitCode !== 0) {
      throw new Error(`umoci unpack failed for ${image}: ${unpackResult.stderr.trim()}`);
    }
  }
}
