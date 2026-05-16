import fs from "fs";
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
});
