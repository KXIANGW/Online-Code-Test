import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { describe, expect, it } from "vitest";

describe("sandbox image build contract", () => {
  it("builds the same sandbox image tags that the worker loads at runtime", () => {
    // After the Makefile became data-driven (reads languages.yaml via
    // scripts/list-languages.mjs), there are no per-language hardcoded
    // `docker build` lines. The contract we still want to enforce:
    //   1. languages.yaml's image tags match the legacy expected values
    //      (so anything else still consuming those tags keeps working).
    //   2. The root Makefile delegates to the worker's build target.
    //   3. The worker Makefile's data-driven target exists and uses the
    //      list-languages.mjs helper to enumerate images.
    //   4. The legacy alias `build-sandbox-images` still resolves so the
    //      root Makefile / CI workflow / docs that reference it work.
    const repoRoot = path.resolve(__dirname, "../../..");
    const rootMakefile = fs.readFileSync(path.join(repoRoot, "Makefile"), "utf8");
    const workerMakefile = fs.readFileSync(path.join(repoRoot, "worker/Makefile"), "utf8");
    const languagesYaml = fs.readFileSync(
      path.join(repoRoot, "worker/sandbox/languages.yaml"),
      "utf8",
    );

    const runtimeImages = [...languagesYaml.matchAll(/^\s+image:\s+(.+)$/gm)].map(
      ([, image]) => image,
    );

    expect(runtimeImages).toEqual(["oct-sandbox-cpp:12", "oct-sandbox-python:3.11"]);
    expect(rootMakefile).toContain("$(MAKE) -C worker build-sandbox-images");
    expect(rootMakefile).toContain("up: bootstrap sandbox-images");
    expect(workerMakefile).toMatch(/^build-language-images:/m);
    expect(workerMakefile).toContain("scripts/list-languages.mjs");
    // Legacy alias still resolves so existing callers don't break.
    expect(workerMakefile).toMatch(/^build-sandbox-images:\s+build-language-images$/m);
  });

  it("waits for the DaemonSet-managed language rootfs before the Kubernetes worker starts", () => {
    // Post-Phase-4: the Worker no longer pulls sandbox images itself.
    // Per-language rootfs is unpacked onto hostPath by the
    // language-rootfs-puller DaemonSet (k8s/08a-language-puller.yaml).
    // The Worker just waits for the symlinks to appear before consuming.
    const repoRoot = path.resolve(__dirname, "../../..");
    const workerManifest = fs.readFileSync(path.join(repoRoot, "k8s/08-worker.yaml"), "utf8");
    const [deployment] = yaml.loadAll(workerManifest) as Array<Record<string, any>>;
    const podSpec = deployment.spec.template.spec;
    const initContainers = podSpec.initContainers as Array<Record<string, any>>;
    const volumes = podSpec.volumes as Array<Record<string, any>>;
    const workerContainer = podSpec.containers.find(
      (c: Record<string, any>) => c.name === "worker",
    );
    const workerEnv = (workerContainer.env as Array<Record<string, any>>).reduce(
      (acc, e) => ({ ...acc, [e.name]: e.value ?? e.valueFrom }),
      {} as Record<string, any>,
    );

    // The legacy initContainer must be gone.
    expect(
      initContainers.find((c) => c.name === "prepare-sandbox-images"),
    ).toBeUndefined();
    // docker.sock must not be mounted anywhere on the Worker any more.
    const mountsAndVolumes = [
      ...(workerContainer.volumeMounts ?? []),
      ...volumes,
    ];
    for (const item of mountsAndVolumes) {
      expect(JSON.stringify(item)).not.toContain("/var/run/docker.sock");
    }

    // Worker is wired to use IsolateEngine reading from the hostPath rootfs.
    expect(workerEnv["SANDBOX_ENGINE"]).toBe("isolate");
    expect(workerEnv["ROOTFS_BASE_DIR"]).toBe("/var/lib/oct/rootfs");

    // wait-rootfs initContainer blocks until the DaemonSet has unpacked at
    // least the two seed languages.
    const waitRootfs = initContainers.find((c) => c.name === "wait-rootfs");
    expect(waitRootfs).toBeTruthy();
    const waitArgs = waitRootfs?.command?.join("\n") ?? "";
    expect(waitArgs).toContain("/var/lib/oct/rootfs/$lang");
    expect(waitArgs).toContain("cpp17");
    expect(waitArgs).toContain("python3");

    // The hostPath the DaemonSet writes to is mounted readonly into the Worker.
    const rootfsMount = (workerContainer.volumeMounts as Array<Record<string, any>>)
      .find((m) => m.name === "rootfs-cache");
    expect(rootfsMount).toEqual(
      expect.objectContaining({ mountPath: "/var/lib/oct/rootfs", readOnly: true }),
    );
  });

  it("ships a corresponding language-rootfs-puller DaemonSet manifest", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const manifest = fs.readFileSync(
      path.join(repoRoot, "k8s/08a-language-puller.yaml"),
      "utf8",
    );
    const docs = yaml.loadAll(manifest) as Array<Record<string, any>>;
    const kinds = docs.map((d) => d.kind);
    expect(kinds).toContain("ConfigMap");
    expect(kinds).toContain("DaemonSet");
    expect(kinds).toContain("Service");

    const daemonSet = docs.find((d) => d.kind === "DaemonSet");
    const podSpec = daemonSet?.spec?.template?.spec;
    const volumes = podSpec?.volumes as Array<Record<string, any>>;
    const rootfsHost = volumes.find((v) => v.name === "rootfs-cache");
    expect(rootfsHost?.hostPath?.path).toBe("/var/lib/oct/rootfs");
  });

  it("keeps Docker Compose and Kubernetes worker host work directories separate", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const composeYaml = fs.readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8");
    const workerManifest = fs.readFileSync(path.join(repoRoot, "k8s/08-worker.yaml"), "utf8");
    const compose = yaml.load(composeYaml) as Record<string, any>;
    const [deployment] = yaml.loadAll(workerManifest) as Array<Record<string, any>>;

    const composeWorkDir = compose.services.worker.environment.HOST_WORK_DIR.match(/\{HOST_WORK_DIR:-(.+)\}/)?.[1];
    const k8sWorker = deployment.spec.template.spec.containers.find(
      (container: Record<string, any>) => container.name === "worker",
    );
    const k8sWorkDir = k8sWorker.env.find((env: Record<string, any>) => env.name === "HOST_WORK_DIR").value;
    const judgeWorkHostPath = deployment.spec.template.spec.volumes.find(
      (volume: Record<string, any>) => volume.name === "judge-work",
    ).hostPath.path;

    expect(composeWorkDir).toBe("/tmp/judge");
    expect(k8sWorkDir).toBe("/tmp/oct-k8s-judge");
    expect(judgeWorkHostPath).toBe(k8sWorkDir);
    expect(k8sWorkDir).not.toBe(composeWorkDir);
  });
});
