import { db } from "../db/client";
import { languageDefaults } from "../db/schema";
import { eq } from "drizzle-orm";
import { cacheGet, cacheSet } from "../db/redis";

const LANG_KEY = "languages:list";

type LanguageRow = {
  language: string;
  displayName: string | null;
  timeMultiplier: string;
  memoryMultiplier: string;
};

export async function listLanguages() {
  const cached = await cacheGet<LanguageRow[]>(LANG_KEY).catch(() => null);
  if (cached) return cached;

  const result = await db
    .select({
      language: languageDefaults.language,
      displayName: languageDefaults.displayName,
      timeMultiplier: languageDefaults.timeMultiplier,
      memoryMultiplier: languageDefaults.memoryMultiplier,
    })
    .from(languageDefaults)
    .where(eq(languageDefaults.isEnabled, true));

  cacheSet(LANG_KEY, result, 3600).catch(() => {});
  return result;
}
