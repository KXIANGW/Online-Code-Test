export const STORAGE_KEYS = {
  draftKey: (sessionId: number, problemId: number, language: string) =>
    `oct:draft:${sessionId}:${problemId}:${language}`,
  langKey: (sessionId: number, problemId: number) => `oct:lang:${sessionId}:${problemId}`,
  draftPrefix: (sessionId: number) => `oct:draft:${sessionId}:`,
  langPrefix: (sessionId: number) => `oct:lang:${sessionId}:`,
} as const;
