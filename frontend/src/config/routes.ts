export const ROUTES = {
  ADMIN: "/admin",
  INTERVIEWER: "/interviewer",
  INTERVIEWER_CANDIDATES_NEW: "/interviewer/candidates/new",
  INTERVIEWER_TEMPLATES_NEW: "/interviewer/templates/new",
  CANDIDATE: "/candidate",
  DASHBOARD: "/dashboard",
  PROBLEM_SETTER: "/problem-setter",
  PROBLEM_SETTER_NEW: "/problem-setter/new",
  examPage: (sessionId: number) => `/exam/${sessionId}`,
  resultPage: (sessionId: number) => `/result/${sessionId}`,
  templateAssign: (templateId: number) => `/interviewer/templates/${templateId}/assign`,
  problemEdit: (problemId: number) => `/problem-setter/${problemId}/edit`,
} as const;
