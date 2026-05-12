import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import path from "path";

const LanguageSpecSchema = z.object({
  id: z.string().min(1),
  image: z.string().min(1),
  source: z.object({ filename: z.string().min(1) }),
  compile: z
    .object({
      cmd: z.array(z.string()).min(1),
    })
    .optional(),
  run: z.object({
    cmd: z.array(z.string()).min(1),
    env: z.record(z.string(), z.string()).optional(),
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
