import axios from "axios";
import type {
  LoginRequest,
  LoginResponse,
  ExamSession,
  SessionResult,
  CreateUserRequest,
  CreateUserResponse,
  UserSummary,
  ProblemSummary,
  Problem,
  CreateProblemRequest,
  UpdateProblemRequest,
  Testcase,
  CreateTestcaseRequest,
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
