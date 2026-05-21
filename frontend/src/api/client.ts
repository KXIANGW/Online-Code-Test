import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
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
  UpdateExamTemplateRequest,
  CreateSubmissionRequest,
  CandidatePasswordResponse,
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

export async function createUser(req: CreateUserRequest): Promise<CreateUserResponse> {
  const { data } = await api.post<CreateUserResponse>("/users", req);

  return data;
}

export async function createUsersBatch(
  count: number,
): Promise<{ username: string; password: string }[]> {
  const { data } = await api.post<{ username: string; password: string }[]>("/users/batch", {
    count,
  });
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

export async function addTestcase(
  problemId: number,
  req: CreateTestcaseRequest,
): Promise<Testcase> {
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

export async function updateExamTemplate(
  id: number,
  req: UpdateExamTemplateRequest,
): Promise<ExamTemplate> {
  const { data } = await api.put<ExamTemplate>(`/exam-sessions/templates/${id}`, req);
  return data;
}

export async function deleteExamTemplate(id: number): Promise<void> {
  await api.delete(`/exam-sessions/templates/${id}`);
}

export async function listExamTemplates(): Promise<ExamTemplate[]> {
  const { data } = await api.get<ExamTemplate[]>("/exam-sessions/templates");
  return data;
}

export async function assignExamToCandidates(
  templateId: number,
  candidateIds: number[],
): Promise<ExamSession[]> {
  const { data } = await api.post<ExamSession[]>(`/exam-sessions/templates/${templateId}/assign`, {
    candidateIds,
  });
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

export async function listSessionSubmissions(sessionId: number): Promise<SubmissionSummary[]> {
  const { data } = await api.get<SubmissionSummary[]>(`/exam-sessions/${sessionId}/submissions`);
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

// Auto-save draft to Redis via backend (keyed by problem + language)
export async function saveExamDraft(
  sessionId: number,
  problemId: number,
  language: string,
  draft: { code: string },
): Promise<void> {
  await api.put(`/exam-sessions/${sessionId}/drafts/${problemId}/${language}`, draft);
}

// Get all drafts for a session (restore from Redis on page load)
// Returns Record<"problemId:language", code>
export async function getExamDrafts(sessionId: number): Promise<Record<string, string>> {
  const { data } = await api.get<Record<string, string>>(`/exam-sessions/${sessionId}/drafts`);
  return data;
}

export async function getCandidatePassword(sessionId: number): Promise<CandidatePasswordResponse> {
  const { data } = await api.get<CandidatePasswordResponse>(
    `/exam-sessions/${sessionId}/candidate-password`,
  );
  return data;
}

export async function getUserPassword(userId: number): Promise<CandidatePasswordResponse> {
  const { data } = await api.get<CandidatePasswordResponse>(`/users/${userId}/password`);
  return data;
}

// ── Response error interceptor ────────────────────────────────────────────────

interface RetryConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
}

export interface ApiErrorData {
  message?: string;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export function isRetryableError(error: AxiosError): boolean {
  if (!error.response) return true; // network / timeout — no HTTP response received
  return error.response.status === 429 || error.response.status === 503;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function logApiError(error: AxiosError<ApiErrorData>): void {
  const method = (error.config?.method ?? "UNKNOWN").toUpperCase();
  const url = error.config?.url ?? "UNKNOWN";
  const status = error.response?.status ?? "NETWORK_ERROR";
  const message = error.response?.data?.message ?? error.message;
  const requestId = error.response?.headers?.["x-request-id"] as string | undefined;

  const lines = [`[API Error] ${method} ${url} → ${status}`, `message: ${message}`];
  if (requestId) lines.push(`request-id: ${requestId}`);
  console.error(lines.join("\n"));
}

api.interceptors.response.use(undefined, async (rawError: unknown) => {
  if (!axios.isAxiosError(rawError)) {
    console.error("[API Error] Unexpected non-Axios error:", rawError);
    return Promise.reject(rawError as Error);
  }

  const error = rawError as AxiosError<ApiErrorData>;
  const config = error.config as RetryConfig | undefined;

  if (config && isRetryableError(error) && (config._retryCount ?? 0) < MAX_RETRIES) {
    config._retryCount = (config._retryCount ?? 0) + 1;
    const delay = BASE_DELAY_MS * Math.pow(2, config._retryCount - 1);
    await sleep(delay);
    return api(config);
  }

  logApiError(error);
  return Promise.reject(error);
});
