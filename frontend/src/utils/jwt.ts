export function decodeJwt(token: string): { isSuperuser: boolean; permissions: string[] } {
  try {
    const payload = JSON.parse(atob(token.split(".")[1] ?? "")) as {
      isSuperuser?: boolean;
      permissions?: string[];
    };
    return {
      isSuperuser: Boolean(payload.isSuperuser),
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    };
  } catch {
    return { isSuperuser: false, permissions: [] };
  }
}
