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
// authStore reads localStorage.getItem("oct_token") at module load time (line 8
// of authStore.ts).  A static top-level import triggers that code before jsdom
// has initialised localStorage in the Vitest worker, resulting in:
//   TypeError: localStorage.getItem is not a function
//
// Solution: vi.resetModules() in beforeEach clears the module registry so every
// test gets a fresh store instance, and each test dynamically imports authStore
// AFTER jsdom (and any localStorage setup) is ready.

describe("useAuthStore", () => {
  beforeEach(() => {
    mockApiLogin.mockReset();
    localStorage.clear();
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

    it("persists token and username to localStorage on success", async () => {
      // given
      const { useAuthStore } = await import("../stores/authStore");
      const token = makeToken({ isSuperuser: false, permissions: ["exam:take"] });
      mockApiLogin.mockResolvedValue({ token });

      // when
      await useAuthStore.getState().login("candidate01", "password");

      // expect
      expect(localStorage.getItem(TOKEN_KEY)).toBe(token);
      expect(localStorage.getItem(USERNAME_KEY)).toBe("candidate01");
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

    it("does not write to localStorage when the API call fails", async () => {
      // given
      const { useAuthStore } = await import("../stores/authStore");
      mockApiLogin.mockRejectedValue(new Error("Unauthorized"));

      // when
      await useAuthStore.getState().login("wrong", "wrong").catch(() => {});

      // expect
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(USERNAME_KEY)).toBeNull();
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

    it("removes oct_token and oct_username from localStorage", async () => {
      // given: a logged-in user with data in localStorage
      const { useAuthStore } = await import("../stores/authStore");
      const token = makeToken({ isSuperuser: false, permissions: [] });
      mockApiLogin.mockResolvedValue({ token });
      await useAuthStore.getState().login("alice", "password");

      // when
      useAuthStore.getState().logout();

      // expect
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(USERNAME_KEY)).toBeNull();
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

  // ── Initialization from localStorage ─────────────────────────────────────
  //
  // authStore reads localStorage at module load time.  These tests set
  // localStorage BEFORE the dynamic import so the module-level code reads the
  // correct value, simulating a page reload with controlled storage state.

  describe("initialization from localStorage", () => {
    it("starts with null token and empty permissions when localStorage is empty", async () => {
      // given: localStorage is empty (beforeEach already cleared it)

      // when: page loads — authStore initialises
      const { useAuthStore } = await import("../stores/authStore");

      // expect
      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.username).toBeNull();
      expect(state.isSuperuser).toBe(false);
      expect(state.permissions).toEqual([]);
    });

    it("restores token, username, and permissions from a previously saved session", async () => {
      // given: a previous session stored a valid candidate token
      const token = makeToken({ isSuperuser: false, permissions: ["exam:take"] });
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USERNAME_KEY, "candidate01");

      // when: page reloads — authStore re-initialises
      const { useAuthStore } = await import("../stores/authStore");

      // expect
      const state = useAuthStore.getState();
      expect(state.token).toBe(token);
      expect(state.username).toBe("candidate01");
      expect(state.isSuperuser).toBe(false);
      expect(state.permissions).toContain("exam:take");
    });

    it("restores isSuperuser=true when the stored token carries the superuser flag", async () => {
      // given: a root user token is in localStorage
      const token = makeToken({ isSuperuser: true, permissions: [] });
      localStorage.setItem(TOKEN_KEY, token);

      // when
      const { useAuthStore } = await import("../stores/authStore");

      // expect
      expect(useAuthStore.getState().isSuperuser).toBe(true);
    });

    // ── [BUG] Cross-tab localStorage contamination ─────────────────────────
    //
    // localStorage is shared across all tabs of the same origin.  If Tab B
    // logs in and overwrites oct_token, Tab A reads the wrong token on its next
    // page refresh — because authStore decodes permissions from localStorage at
    // module load time.
    //
    // Fix: replace localStorage with sessionStorage for oct_token so each tab
    // has an isolated token and cross-tab contamination becomes impossible.

    it("[BUG] loads with wrong permissions when another tab's candidate login overwrote oct_token", async () => {
      // given: Alice (interviewer) is in Tab A.
      //        Tab B logs in as a candidate, overwriting oct_token in shared localStorage.
      const candidateToken = makeToken({ isSuperuser: false, permissions: ["exam:take"] });
      localStorage.setItem(TOKEN_KEY, candidateToken);

      // when: Alice's tab refreshes — authStore re-initialises from contaminated storage
      const { useAuthStore } = await import("../stores/authStore");

      // expect: Alice now has exam:take instead of exam:manage
      const state = useAuthStore.getState();
      expect(state.permissions).not.toContain("exam:manage");
      expect(state.permissions).toContain("exam:take");
      // RoleRedirect sends Alice to /dashboard instead of /interviewer
    });

    it("[BUG] loads as isSuperuser when a root tab login overwrote oct_token before refresh", async () => {
      // given: a root tab logged in, its token now sits in shared localStorage
      const rootToken = makeToken({ isSuperuser: true, permissions: [] });
      localStorage.setItem(TOKEN_KEY, rootToken);

      // when: any other tab refreshes
      const { useAuthStore } = await import("../stores/authStore");

      // expect: that tab unintentionally gets superuser privileges
      expect(useAuthStore.getState().isSuperuser).toBe(true);
      // privilege escalation via shared storage
    });
  });
});
