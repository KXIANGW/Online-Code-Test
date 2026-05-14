import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NavBar } from "../components/NavBar";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuthStore.mockImplementation(
    (sel: (s: { username: string; logout: () => void }) => unknown) =>
      sel({ username: "alice", logout: vi.fn() }),
  );
});

function renderNavBar(homeHref: string) {
  return render(
    <MemoryRouter>
      <NavBar homeHref={homeHref} />
    </MemoryRouter>,
  );
}

describe("NavBar", () => {
  describe("home link", () => {
    it("renders a link with the given homeHref", () => {
      // Given: homeHref = "/interviewer"
      renderNavBar("/interviewer");
      // When: rendered
      // Expect: link points to /interviewer
      expect(screen.getByRole("link", { name: /online code test/i })).toHaveAttribute(
        "href",
        "/interviewer",
      );
    });

    it("renders 'Online Code Test' as the link label", () => {
      // Given: any homeHref
      renderNavBar("/admin");
      // Expect: visible text is "Online Code Test"
      expect(screen.getByRole("link", { name: "Online Code Test" })).toBeInTheDocument();
    });

    it("uses the correct href for /admin", () => {
      // Given: homeHref = "/admin"
      renderNavBar("/admin");
      // Expect: link points to /admin
      expect(screen.getByRole("link", { name: /online code test/i })).toHaveAttribute(
        "href",
        "/admin",
      );
    });

    it("uses the correct href for /problem-setter", () => {
      // Given: homeHref = "/problem-setter"
      renderNavBar("/problem-setter");
      // Expect: link points to /problem-setter
      expect(screen.getByRole("link", { name: /online code test/i })).toHaveAttribute(
        "href",
        "/problem-setter",
      );
    });
  });

  describe("user menu", () => {
    it("renders the user menu button with initials", () => {
      // Given: username = "alice"
      renderNavBar("/interviewer");
      // Expect: user menu button is present showing "AL"
      expect(screen.getByRole("button", { name: "User menu" })).toHaveTextContent("AL");
    });
  });
});
