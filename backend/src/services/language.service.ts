import { db } from "../db/client";
import { languageDefaults } from "../db/schema";
import { eq } from "drizzle-orm";

export async function listLanguages() {
  return db
    .select({
      language: languageDefaults.language,
      displayName: languageDefaults.displayName,
      timeMultiplier: languageDefaults.timeMultiplier,
      memoryMultiplier: languageDefaults.memoryMultiplier,
    })
    .from(languageDefaults)
    .where(eq(languageDefaults.isEnabled, true));
}
