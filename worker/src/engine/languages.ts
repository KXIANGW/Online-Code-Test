import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import path from "path";

const LanguageSpecSchema = z.object({
  id: z.string().min(1),
  // OCI image reference used by:
  //   * DockerEngine — directly via dockerode
  //   * IsolateEngine — only by the language-rootfs-puller DaemonSet to pull and
  //     unpack a rootfs onto the Node; Worker itself reads from rootfsPath.
  image: z.string().min(1),
  // Optional override for the Node-local rootfs directory. Defaults to
  // `${RootfsResolver.baseDir}/${id}` if omitted.
  rootfsPath: z.string().optional(),
  // Optional override for the host directory that contains the language's
  // Dockerfile. Defaults to `id` — i.e. `worker/sandbox/<id>/Dockerfile`.
  // Set explicitly when several language versions share one Dockerfile.
  dockerfileContext: z.string().optional(),
  source: z.object({ filename: z.string().min(1) }),
  compile: z
    .object({
      cmd: z.array(z.string()).min(1),
      // Overrides COMPILE_MEM_MB for this language. isolate --mem sets both
      // cgroup memory.max AND RLIMIT_AS; JVM/CLR runtimes need >768 MB of
      // virtual address space to start even though physical RSS stays ~80 MB.
      memoryLimitMb: z.number().int().positive().optional(),
    })
    .optional(),
  run: z.object({
    cmd: z.array(z.string()).min(1),
    env: z.record(z.string(), z.string()).optional(),
    // Absolute path of the interpreter/binary inside the rootfs, used by
    // IsolateEngine to avoid PATH-dependent lookups. Falls back to the first
    // element of cmd when not given.
    entrypointPath: z.string().optional(),
    // Floor memory limit used by verify-language smoke tests. Production
    // memory limits come from per-problem config and override this value.
    memoryLimitMb: z.number().int().positive().optional(),
  }),
  enabled: z.boolean(),
});

const LanguagesFileSchema = z.object({
  version: z.literal(1),
  languages: z.array(LanguageSpecSchema),
});

export type LanguageSpec = z.infer<typeof LanguageSpecSchema>;

export const LANGUAGES_FILE =
  process.env["LANGUAGES_FILE"] ??
  path.resolve(process.cwd(), "sandbox/languages.yaml");

export function loadLanguages(filePath = LANGUAGES_FILE): LanguageSpec[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = yaml.load(raw);
  const validated = LanguagesFileSchema.parse(parsed);
  return validated.languages;
}

export function findLanguage(languages: LanguageSpec[], id: string): LanguageSpec {
  const spec = languages.find((l) => l.id === id && l.enabled);
  if (!spec) throw new Error(`Language not found or disabled: "${id}"`);
  return spec;
}
