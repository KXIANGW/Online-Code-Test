import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";

// Minimal subset of the Worker's language schema — the puller only cares about
// id (target subdir name), image (registry coordinates) and enabled flag.
// Other Worker-specific fields are tolerated but ignored.
const PullerLanguageSchema = z
  .object({
    id: z.string().min(1),
    image: z.string().min(1),
    rootfsPath: z.string().optional(),
    enabled: z.boolean(),
  })
  .passthrough();

const LanguagesFileSchema = z.object({
  version: z.literal(1),
  languages: z.array(PullerLanguageSchema),
});

export type PullerLanguageSpec = z.infer<typeof PullerLanguageSchema>;

export async function loadLanguages(filePath: string): Promise<PullerLanguageSpec[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = yaml.load(raw);
  const validated = LanguagesFileSchema.parse(parsed);
  return validated.languages;
}
