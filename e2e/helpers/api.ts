// BASE_URL is reserved by Vite (defaults to "/"); use E2E_API_URL instead
export const BASE_URL =
  (process.env["E2E_API_URL"] ?? "http://localhost:3000") + "/api";

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  expectedStatus?: number,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (expectedStatus !== undefined && res.status !== expectedStatus) {
    const text = await res.text();
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${res.status}: ${text}`,
    );
  }
  if (expectedStatus === undefined && !res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function login(
  username: string,
  password: string,
): Promise<string> {
  const out = await api<{ token: string }>(
    "POST",
    "/auth/login",
    { username, password },
    undefined,
    200,
  );
  return out.token;
}
