import { create } from "zustand";
import { login as apiLogin } from "../api/client";

const TOKEN_KEY = "oct_token";
const USERNAME_KEY = "oct_username";

function decodeJwt(token: string): { isSuperuser: boolean; permissions: string[] } {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!)) as {
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

const storedToken = localStorage.getItem(TOKEN_KEY);
const decoded = storedToken
  ? decodeJwt(storedToken)
  : { isSuperuser: false, permissions: [] as string[] };

interface AuthState {
  token: string | null;
  username: string | null;
  isSuperuser: boolean;
  permissions: string[];
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  token: storedToken,
  username: localStorage.getItem(USERNAME_KEY),
  isSuperuser: decoded.isSuperuser,
  permissions: decoded.permissions,

  login: async (username, password) => {
    const { token } = await apiLogin({ username, password });
    const { isSuperuser, permissions } = decodeJwt(token);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, username);
    set({ token, username, isSuperuser, permissions });
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    set({ token: null, username: null, isSuperuser: false, permissions: [] });
  },
}));
