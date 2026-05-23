#!/usr/bin/env node
// Lists languages declared in worker/sandbox/languages.yaml.
//
// Output format (one line per language):
//   <id>\t<image>\t<dockerfileContext>
//
// `dockerfileContext` defaults to `id` when not explicitly set on the spec —
// i.e. the convention is that `worker/sandbox/<id>/Dockerfile` builds the
// image. Set `dockerfileContext` in languages.yaml to override (e.g. when
// multiple languages share a base image).
//
// Used by worker/Makefile data-driven targets:
//   build-language-images
//   build-isolate-rootfs
//   verify-language

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const here = path.dirname(new URL(import.meta.url).pathname);
const yamlPath = path.resolve(here, "..", "sandbox", "languages.yaml");

const content = fs.readFileSync(yamlPath, "utf8");
const data = yaml.load(content);
if (!data || !Array.isArray(data.languages)) {
  console.error("invalid languages.yaml: missing `languages` array");
  process.exit(2);
}

const onlyEnabled = process.argv.includes("--enabled-only");
const filterId = (process.argv.find((a) => a.startsWith("--id=")) || "").slice(5) || null;

for (const lang of data.languages) {
  if (onlyEnabled && lang.enabled === false) continue;
  if (filterId && lang.id !== filterId) continue;
  const ctx = lang.dockerfileContext || lang.id;
  process.stdout.write(`${lang.id}\t${lang.image}\t${ctx}\n`);
}
