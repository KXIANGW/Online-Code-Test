/**
 * Maps the backend language identifier to the Monaco Editor language mode.
 * Add new entries here when a new language is added to the judge system.
 */
export const LANGUAGE_MONACO_MAP: Record<string, string> = {
  python3: "python",
  cpp17: "cpp",
  java21: "java",
};

export function getMonacoMode(languageId: string): string {
  return LANGUAGE_MONACO_MAP[languageId] ?? "plaintext";
}
