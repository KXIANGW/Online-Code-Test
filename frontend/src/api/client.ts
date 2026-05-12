import axios from "axios";
import type { LoginRequest, LoginResponse } from "../types";

const baseURL = import.meta.env.VITE_API_BASE ?? "/api";

export const api = axios.create({
  baseURL,
  timeout: 5000,
});

// Attach stored token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("oct_token");
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
