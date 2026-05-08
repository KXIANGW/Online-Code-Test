import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE ?? "/api";

export const api = axios.create({
  baseURL,
  timeout: 5000,
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
