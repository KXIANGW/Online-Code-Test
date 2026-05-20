import axios from "axios";
import type {
  LoginRequest,
  LoginResponse,
  ExamSession,
  ExamTemplate,
  ExamSessionProblem,
  Language,
  PublicTestcase,
  SessionResult,
  SubmissionCreated,
  SubmissionSummary,
  SubmissionDetail,
  CreateUserRequest,
  CreateUserResponse,
  UserSummary,
  ProblemSummary,
  Problem,
  CreateProblemRequest,
  UpdateProblemRequest,
  Testcase,
  CreateTestcaseRequest,
  CreateExamTemplateManualRequest,
  CreateExamTemplateRandomRequest,
  CreateSubmissionRequest,
} from "../types";

const baseURL = import.meta.env.VITE_API_BASE ?? "/api";

export const api = axios.create({
  baseURL,
  timeout: 5000,
});

// Attach stored token to every request
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("oct_token");
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

export interface HealthResponse {
  status: "ok" | "degraded";
  dbLatencyMs?: number;
  uptimeSec?: number;
  error?: string;
}

export interface PingResponse {
  pong: boolean;
  ts: string;
}

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>("/health");
  return data;
}

export async function getPing(): Promise<PingResponse> {
  const { data } = await api.get<PingResponse>("/ping");
  return data;
}

export async function login(req: LoginRequest): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>("/auth/login", req);
  return data;
}

export async function getExamSessions(): Promise<ExamSession[]> {
  const { data } = await api.get<ExamSession[]>("/exam-sessions");
  return data;
}

export async function startExamSession(id: number): Promise<ExamSession> {
  const { data } = await api.post<ExamSession>(`/exam-sessions/${id}/start`);
  return data;
}

export async function submitExamSession(id: number): Promise<ExamSession> {
  const { data } = await api.post<ExamSession>(`/exam-sessions/${id}/submit`);
  return data;
}

export async function getSessionResult(id: number): Promise<SessionResult> {
  const { data } = await api.get<SessionResult>(`/exam-sessions/${id}/result`);
  return data;
}

export async function getUsers(): Promise<UserSummary[]> {
  const { data } = await api.get<UserSummary[]>("/users");
  return data;
}

export async function createUser(
  req: CreateUserRequest,
): Promise<CreateUserResponse> {
  const { data } = await api.post<CreateUserResponse>("/users", req);

  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}

export async function updateUserRoles(id: number, roleNames: string[]): Promise<void> {
  await api.put(`/users/${id}/roles`, { roleNames });
}

export async function getProblems(): Promise<ProblemSummary[]> {
  const { data } = await api.get<ProblemSummary[]>("/problems");
  return data;
}

export async function getProblemById(id: number): Promise<Problem> {
  const { data } = await api.get<Problem>(`/problems/${id}`);
  return data;
}

export async function createProblem(req: CreateProblemRequest): Promise<Problem> {
  const { data } = await api.post<Problem>("/problems", req);
  return data;
}

export async function updateProblem(id: number, req: UpdateProblemRequest): Promise<Problem> {
  const { data } = await api.put<Problem>(`/problems/${id}`, req);
  return data;
}

export async function deleteProblem(id: number): Promise<void> {
  await api.delete(`/problems/${id}`);
}

export async function addTestcase(problemId: number, req: CreateTestcaseRequest): Promise<Testcase> {
  const { data } = await api.post<Testcase>(`/problems/${problemId}/testcases`, req);
  return data;
}

export async function updateTestcase(
  problemId: number,
  tcId: number,
  req: Partial<CreateTestcaseRequest>,
): Promise<Testcase> {
  const { data } = await api.put<Testcase>(`/problems/${problemId}/testcases/${tcId}`, req);
  return data;
}

export async function deleteTestcase(problemId: number, tcId: number): Promise<void> {
  await api.delete(`/problems/${problemId}/testcases/${tcId}`);
}

export async function createExamTemplateManual(
  req: CreateExamTemplateManualRequest,
): Promise<ExamTemplate> {
  const { data } = await api.post<ExamTemplate>("/exam-sessions/templates/manual", req);
  return data;
}

export async function createExamTemplateRandom(
  req: CreateExamTemplateRandomRequest,
): Promise<ExamTemplate> {
  const { data } = await api.post<ExamTemplate>("/exam-sessions/templates/random", req);
  return data;
}

export async function listExamTemplates(): Promise<ExamTemplate[]> {
  const { data } = await api.get<ExamTemplate[]>("/exam-sessions/templates");
  return data;
}

export async function assignExamToCandidates(
  templateId: number,
  candidateIds: number[],
): Promise<ExamSession[]> {
  const { data } = await api.post<ExamSession[]>(
    `/exam-sessions/templates/${templateId}/assign`,
    { candidateIds },
  );
  return data;
}

export async function getSubmissionDetail(
  sessionId: number,
  submissionId: number,
): Promise<SubmissionDetail> {
  const { data } = await api.get<SubmissionDetail>(
    `/exam-sessions/${sessionId}/submissions/${submissionId}`,
  );
  return data;
}

export async function createSubmission(
  sessionId: number,
  req: CreateSubmissionRequest,
): Promise<SubmissionCreated> {
  const { data } = await api.post<SubmissionCreated>(
    `/exam-sessions/${sessionId}/submissions`,
    req,
  );
  return data;
}

export async function listSessionSubmissions(
  sessionId: number,
): Promise<SubmissionSummary[]> {
  const { data } = await api.get<SubmissionSummary[]>(
    `/exam-sessions/${sessionId}/submissions`,
  );
  return data;
}

// Get single exam session (for expires_at)
export async function getExamSession(id: number): Promise<ExamSession> {
  const { data } = await api.get<ExamSession>(`/exam-sessions/${id}`);
  return data;
}

// Get problems for an exam session (with descriptionMd, languageLimits)
export async function getExamSessionProblems(id: number): Promise<ExamSessionProblem[]> {
  const { data } = await api.get<ExamSessionProblem[]>(`/exam-sessions/${id}/problems`);
  return data;
}

// Get public testcases for an exam session problem
export async function getPublicTestcases(
  sessionId: number,
  espId: number,
): Promise<PublicTestcase[]> {
  const { data } = await api.get<PublicTestcase[]>(
    `/exam-sessions/${sessionId}/problems/${espId}/testcases`,
  );
  return data;
}

// Get enabled languages (served from Redis cache on backend)
export async function getLanguages(): Promise<Language[]> {
  const { data } = await api.get<Language[]>("/languages");
  return data;
}

// Auto-save draft to Redis via backend
export async function saveExamDraft(
  sessionId: number,
  problemId: number,
  draft: { code: string; language: string },
): Promise<void> {
  await api.put(`/exam-sessions/${sessionId}/drafts/${problemId}`, draft);
}

// Get all drafts for a session (restore from Redis on page load)
export async function getExamDrafts(
  sessionId: number,
): Promise<Record<string, { code: string; language: string }>> {
  const { data } = await api.get<Record<number, { code: string; language: string }>>(
    `/exam-sessions/${sessionId}/drafts`,
  );
  return data;
}
