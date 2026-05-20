export const ROUTES = {
  ADMIN: "/admin",
  INTERVIEWER: "/interviewer",
  INTERVIEWER_NEW: "/interviewer/new",
  CANDIDATE: "/candidate",
  DASHBOARD: "/dashboard",
  PROBLEM_SETTER: "/problem-setter",
  PROBLEM_SETTER_NEW: "/problem-setter/new",
  examPage: (sessionId: number) => `/exam/${sessionId}`,
  resultPage: (sessionId: number) => `/result/${sessionId}`,
  problemEdit: (problemId: number) => `/problem-setter/${problemId}/edit`,
} as const;
