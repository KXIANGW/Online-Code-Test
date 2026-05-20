import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { UserMenu } from "../components/UserMenu";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));

function setupAuth(username: string | null = "alice") {
  mockUseAuthStore.mockImplementation(
    (sel: (s: { username: string | null; logout: typeof mockLogout }) => unknown) =>
      sel({ username, logout: mockLogout }),
  );
}

function renderMenu() {
  return render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAuth("alice");
});

describe("UserMenu", () => {
  describe("initials display", () => {
    it("shows first two characters of username in uppercase", () => {
      // Given: username = "alice"
      setupAuth("alice");
      // When: component renders
      renderMenu();
      // Expect: button shows "AL"
      expect(screen.getByRole("button", { name: "User menu" })).toHaveTextContent("AL");
    });

    it("shows '??' when username is null", () => {
      // Given: username is null (not logged in)
      setupAuth(null);
      // When: component renders
      renderMenu();
      // Expect: button shows "??"
      expect(screen.getByRole("button", { name: "User menu" })).toHaveTextContent("??");
    });

    it("uppercases single-character username prefix correctly", () => {
      // Given: username starts with single char "z"
      setupAuth("zo");
      // When: component renders
      renderMenu();
      // Expect: button shows "ZO"
      expect(screen.getByRole("button", { name: "User menu" })).toHaveTextContent("ZO");
    });
  });

  describe("logout", () => {
    it("calls logout() and navigates to /login when Log out is clicked", async () => {
      // Given: user opens the menu
      const user = userEvent.setup();
      renderMenu();
      await user.click(screen.getByRole("button", { name: "User menu" }));

      // When: user clicks "Log out"
      const logoutBtn = await screen.findByRole("menuitem", { name: /log out/i });
      await user.click(logoutBtn);

      // Expect: logout is called and navigation to /login occurs
      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/login");
    });

    it("shows the username inside the open dropdown", async () => {
      // Given: username = "alice"
      const user = userEvent.setup();
      renderMenu();

      // When: user opens the menu
      await user.click(screen.getByRole("button", { name: "User menu" }));

      // Expect: "alice" appears in the dropdown header
      expect(await screen.findByText("alice")).toBeInTheDocument();
    });
  });
});
