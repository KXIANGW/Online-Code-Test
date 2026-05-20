import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { describe, expect, it } from "vitest";

describe("sandbox image build contract", () => {
  it("builds the same sandbox image tags that the worker loads at runtime", () => {
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
    for (const image of runtimeImages) {
      expect(workerMakefile).toContain(`docker build -t ${image}`);
    }
  });

  it("prepares sandbox image tags before the Kubernetes worker starts", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const workerManifest = fs.readFileSync(path.join(repoRoot, "k8s/08-worker.yaml"), "utf8");
    const [deployment] = yaml.loadAll(workerManifest) as Array<Record<string, any>>;
    const initContainers = deployment.spec.template.spec.initContainers as Array<Record<string, any>>;
    const volumes = deployment.spec.template.spec.volumes as Array<Record<string, any>>;

    const prepare = initContainers.find((container) => container.name === "prepare-sandbox-images");
    const command = prepare?.command?.join(" ") ?? "";
    const args = prepare?.args?.join(" ") ?? "";

    expect(prepare).toBeTruthy();
    expect(prepare?.image).toBe("docker:27-cli");
    expect(command).toContain("sh -c");
    expect(args).toContain("docker pull ghcr.io/kxiangw/oct-sandbox-cpp:latest");
    expect(args).toContain("docker pull ghcr.io/kxiangw/oct-sandbox-python:latest");
    expect(args).toContain("docker tag ghcr.io/kxiangw/oct-sandbox-cpp:latest oct-sandbox-cpp:12");
    expect(args).toContain(
      "docker tag ghcr.io/kxiangw/oct-sandbox-python:latest oct-sandbox-python:3.11",
    );
    expect(args).toContain("docker ps --format '{{.Image}}'");
    expect(args).toContain("docker ps -a --filter status=exited --format '{{.ID}} {{.Image}}'");
    expect(args).toContain("docker rm \"$container_id\"");
    expect(args).toContain("awk '$1 ~ /^ghcr.io\\/kxiangw\\/oct-/ {print $2}'");
    expect(args).toContain("docker image rm \"$image_id\"");
    expect(prepare?.volumeMounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "docker-sock", mountPath: "/var/run/docker.sock" }),
        expect.objectContaining({ name: "ghcr-docker-config", mountPath: "/root/.docker" }),
      ]),
    );
    expect(volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ghcr-docker-config",
          secret: expect.objectContaining({ secretName: "ghcr-secret" }),
        }),
      ]),
    );
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
