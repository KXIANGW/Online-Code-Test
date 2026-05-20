import type Docker from "dockerode";
import { compileInSandbox, type CompileResult } from "../compiler";
import { runOneTestcase, type RunOneResult } from "../runner";
import type { CompileTask, RunTask, SandboxEngine } from "../sandbox-engine";

export interface DockerSandboxEngineOptions {
  sandboxRuntime: string;
  dockerClient?: Docker;
}

export class DockerSandboxEngine implements SandboxEngine {
  readonly name = "docker";

  constructor(private readonly options: DockerSandboxEngineOptions) {}

  async compile(task: CompileTask): Promise<CompileResult> {
    return compileInSandbox({ ...task, dockerClient: this.options.dockerClient });
  }

  async runOne(task: RunTask): Promise<RunOneResult> {
    return runOneTestcase({
      ...task,
      sandboxRuntime: this.options.sandboxRuntime,
      dockerClient: this.options.dockerClient,
    });
  }
}
