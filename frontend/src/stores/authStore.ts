import { create } from "zustand";
import { login as apiLogin } from "../api/client";

const TOKEN_KEY = "oct_token";
const USERNAME_KEY = "oct_username";

interface AuthState {
  token: string | null;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  username: localStorage.getItem(USERNAME_KEY),

  login: async (username, password) => {
    const { token } = await apiLogin({ username, password });
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USERNAME_KEY, username);
    set({ token, username });
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    set({ token: null, username: null });
  },
}));
