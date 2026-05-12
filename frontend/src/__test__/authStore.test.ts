import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// vi.hoisted ensures mockApiLogin is defined before any module-level code runs,
// including the vi.mock() factory below.
const mockApiLogin = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ login: mockApiLogin }));

// ── Constants ─────────────────────────────────────────────────────────────────
const TOKEN_KEY = "oct_token";
const USERNAME_KEY = "oct_username";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeToken(payload: object): string {
  const header = btoa(JSON.stringify({ alg: "HS256" }));
  const body   = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

// ── Test suite ────────────────────────────────────────────────────────────────
//
// WHY dynamic import?
// authStore reads sessionStorage.getItem("oct_token") at module load time.
// A static top-level import triggers that code before jsdom has initialized
// sessionStorage in the Vitest worker, resulting in:
//   TypeError: sessionStorage.getItem is not a function
//
// Solution: vi.resetModules() in beforeEach clears the module registry so every
// test gets a fresh store instance, and each test dynamically imports authStore
// AFTER jsdom (and any sessionStorage setup) is ready.

describe("useAuthStore", () => {
  beforeEach(() => {
    mockApiLogin.mockReset();
    sessionStorage.clear();
    localStorage.clear(); // kept so [FIX] isolation tests start with a clean slate
    vi.resetModules(); // purge module cache → next import re-executes module-level code
  });

  // ── login() ───────────────────────────────────────────────────────────────

  describe("login()", () => {
    it("calls apiLogin with the provided username and password", async () => {
      // given
      const { useAuthStore } = await import("../stores/authStore");
      const token = makeToken({ isSuperuser: false, permissions: ["exam:take"] });
      mockApiLogin.mockResolvedValue({ token });

      // when
      await useAuthStore.getState().login("candidate01", "password");

      // expect
      expect(mockApiLogin).toHaveBeenCalledWith({ username: "candidate01", password: "password" });
    });

    it("updates token, username, isSuperuser, and permissions in state on success", async () => {
      // given
      const { useAuthStore } = await import("../stores/authStore");
      const token = makeToken({ isSuperuser: false, permissions: ["exam:manage"] });
      mockApiLogin.mockResolvedValue({ token });

      // when
      await useAuthStore.getState().login("alice", "password");

      // expect
      const state = useAuthStore.getState();
      expect(state.token).toBe(token);
      expect(state.username).toBe("alice");
      expect(state.isSuperuser).toBe(false);
      expect(state.permissions).toContain("exam:manage");
    });

    it("sets isSuperuser=true when the returned token carries the superuser flag", async () => {
      // given
      const { useAuthStore } = await import("../stores/authStore");
      const token = makeToken({ isSuperuser: true, permissions: [] });
      mockApiLogin.mockResolvedValue({ token });

      // when
      await useAuthStore.getState().login("root", "password");

      // expect
      expect(useAuthStore.getState().isSuperuser).toBe(true);
    });

    it("persists token and username to sessionStorage on success", async () => {
      // given
      const { useAuthStore } = await import("../stores/authStore");
      const token = makeToken({ isSuperuser: false, permissions: ["exam:take"] });
      mockApiLogin.mockResolvedValue({ token });

      // when
      await useAuthStore.getState().login("candidate01", "password");

      // expect
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe(token);
      expect(sessionStorage.getItem(USERNAME_KEY)).toBe("candidate01");
    });

    it("throws and leaves state unchanged when the API call fails", async () => {
      // given
      const { useAuthStore } = await import("../stores/authStore");
      mockApiLogin.mockRejectedValue(new Error("Unauthorized"));

      // when
      const act = () => useAuthStore.getState().login("wrong", "wrong");

      // expect
      await expect(act()).rejects.toThrow("Unauthorized");
      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.username).toBeNull();
    });

    it("does not write to sessionStorage when the API call fails", async () => {
      // given
      const { useAuthStore } = await import("../stores/authStore");
      mockApiLogin.mockRejectedValue(new Error("Unauthorized"));

      // when
      await useAuthStore.getState().login("wrong", "wrong").catch(() => {});

      // expect
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(sessionStorage.getItem(USERNAME_KEY)).toBeNull();
    });
  });

  // ── logout() ──────────────────────────────────────────────────────────────

  describe("logout()", () => {
    it("resets token, username, isSuperuser, and permissions in state", async () => {
      // given: a logged-in user
      const { useAuthStore } = await import("../stores/authStore");
      const token = makeToken({ isSuperuser: false, permissions: ["exam:manage"] });
      mockApiLogin.mockResolvedValue({ token });
      await useAuthStore.getState().login("alice", "password");

      // when
      useAuthStore.getState().logout();

      // expect
      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.username).toBeNull();
      expect(state.isSuperuser).toBe(false);
      expect(state.permissions).toEqual([]);
    });

    it("removes oct_token and oct_username from sessionStorage", async () => {
      // given: a logged-in user with data in sessionStorage
      const { useAuthStore } = await import("../stores/authStore");
      const token = makeToken({ isSuperuser: false, permissions: [] });
      mockApiLogin.mockResolvedValue({ token });
      await useAuthStore.getState().login("alice", "password");

      // when
      useAuthStore.getState().logout();

      // expect
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(sessionStorage.getItem(USERNAME_KEY)).toBeNull();
    });

    it("is idempotent — calling logout twice does not throw", async () => {
      // given: store in its initial logged-out state
      const { useAuthStore } = await import("../stores/authStore");

      // when & expect
      expect(() => {
        useAuthStore.getState().logout();
        useAuthStore.getState().logout();
      }).not.toThrow();
    });
  });

  // ── Initialization from sessionStorage ───────────────────────────────────
  //
  // authStore reads sessionStorage at module load time.  These tests set
  // sessionStorage BEFORE the dynamic import so the module-level code reads the
  // correct value, simulating a page reload with controlled storage state.

  describe("initialization from sessionStorage", () => {
    it("starts with null token and empty permissions when sessionStorage is empty", async () => {
      // given: sessionStorage is empty (beforeEach already cleared it)

      // when: page loads — authStore initializes
      const { useAuthStore } = await import("../stores/authStore");

      // expect
      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.username).toBeNull();
      expect(state.isSuperuser).toBe(false);
      expect(state.permissions).toEqual([]);
    });

    it("restores token, username, and permissions from a previously saved session", async () => {
      // given: a previous session stored a valid candidate token in sessionStorage
      const token = makeToken({ isSuperuser: false, permissions: ["exam:take"] });
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USERNAME_KEY, "candidate01");

      // when: page reloads — authStore re-initializes
      const { useAuthStore } = await import("../stores/authStore");

      // expect
      const state = useAuthStore.getState();
      expect(state.token).toBe(token);
      expect(state.username).toBe("candidate01");
      expect(state.isSuperuser).toBe(false);
      expect(state.permissions).toContain("exam:take");
    });

    it("restores isSuperuser=true when the stored token carries the superuser flag", async () => {
      // given: a root user token is in sessionStorage
      const token = makeToken({ isSuperuser: true, permissions: [] });
      sessionStorage.setItem(TOKEN_KEY, token);

      // when
      const { useAuthStore } = await import("../stores/authStore");

      // expect
      expect(useAuthStore.getState().isSuperuser).toBe(true);
    });

    // ── [FIX] Cross-tab isolation via sessionStorage ───────────────────────
    //
    // sessionStorage is scoped to each browser tab (not shared across tabs of
    // the same origin).  A login in Tab B writes to Tab B's sessionStorage only
    // and cannot overwrite Tab A's token — eliminating the contamination bug.

    it("[FIX] another tab's localStorage write does not contaminate this tab's permissions", async () => {
      // given: Tab B (a different tab) logs in as a candidate and writes to localStorage.
      //        With sessionStorage, this write is invisible to Tab A's store.
      const candidateToken = makeToken({ isSuperuser: false, permissions: ["exam:take"] });
      localStorage.setItem(TOKEN_KEY, candidateToken); // simulates Tab B (ignored by store)

      // when: Tab A refreshes — authStore reads sessionStorage (empty)
      const { useAuthStore } = await import("../stores/authStore");

      // expect: Tab A loads with no token — localStorage write had no effect
      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.permissions).toEqual([]);
    });

    it("[FIX] a root tab's localStorage write does not grant superuser to other tabs", async () => {
      // given: a root tab wrote its token to localStorage
      const rootToken = makeToken({ isSuperuser: true, permissions: [] });
      localStorage.setItem(TOKEN_KEY, rootToken); // simulates root Tab B (ignored by store)

      // when: another tab refreshes — authStore reads its own (empty) sessionStorage
      const { useAuthStore } = await import("../stores/authStore");

      // expect: isSuperuser stays false — no privilege escalation via shared storage
      expect(useAuthStore.getState().isSuperuser).toBe(false);
    });
  });
});
