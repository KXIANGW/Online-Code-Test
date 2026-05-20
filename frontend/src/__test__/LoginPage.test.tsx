import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "../pages/LoginPage";

// ── Hoist mocks so they are available inside vi.mock factories ────────────────
const mockLogin = vi.hoisted(() => vi.fn<[], Promise<void>>());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("../stores/authStore", () => {
  function useAuthStore(selector: (s: { login: typeof mockLogin }) => unknown) {
    return selector({ login: mockLogin });
  }
  // getState is called after login to read role for routing
  useAuthStore.getState = () => ({ isSuperuser: false, permissions: [] as string[] });
  return { useAuthStore };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

function getUsername() {
  return screen.getByLabelText("帳號");
}
function getPassword() {
  return screen.getByLabelText("密碼");
}
function getSubmitBtn() {
  return screen.getByRole("button", { name: /^登入$/ });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("LoginPage", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockNavigate.mockReset();
  });

  // Render
  it("renders username input, password input, and submit button", () => {
    // given
    renderLoginPage();

    // when
    // (no user interaction — asserting initial render)

    // expect
    expect(getUsername()).toBeInTheDocument();
    expect(getPassword()).toBeInTheDocument();
    expect(getSubmitBtn()).toBeInTheDocument();
  });

  it("does not show an error on initial render", () => {
    // given
    renderLoginPage();

    // when
    // (no user interaction — asserting initial render)

    // expect
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Boundary: empty username
  it("shows validation error and skips API call when username is empty", async () => {
    // given
    const user = userEvent.setup();
    renderLoginPage();

    // when
    await user.click(getSubmitBtn());

    // expect
    expect(screen.getByRole("alert")).toHaveTextContent("請輸入帳號");
    expect(mockLogin).not.toHaveBeenCalled();
  });

  // Boundary: whitespace-only username treated as empty
  it("treats whitespace-only username as empty", async () => {
    // given
    const user = userEvent.setup();
    renderLoginPage();

    // when
    await user.type(getUsername(), "   ");
    await user.click(getSubmitBtn());

    // expect
    expect(screen.getByRole("alert")).toHaveTextContent("請輸入帳號");
    expect(mockLogin).not.toHaveBeenCalled();
  });

  // Boundary: empty password
  it("shows validation error and skips API call when password is empty", async () => {
    // given
    const user = userEvent.setup();
    renderLoginPage();

    // when
    await user.type(getUsername(), "candidate01");
    await user.click(getSubmitBtn());

    // expect
    expect(screen.getByRole("alert")).toHaveTextContent("請輸入密碼");
    expect(mockLogin).not.toHaveBeenCalled();
  });

  // Happy path
  it("calls login with trimmed username and navigates to / on success", async () => {
    // given
    const user = userEvent.setup();
    mockLogin.mockResolvedValueOnce(undefined);
    renderLoginPage();

    // when
    await user.type(getUsername(), "  candidate01  ");
    await user.type(getPassword(), "password");
    await user.click(getSubmitBtn());

    // expect
    // LoginPage always navigates to "/" with replace:true after login.
    // Role-based redirection (/ → /interviewer, /admin, etc.) is handled by
    // RoleRedirect in App.tsx, not by LoginPage itself.
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("candidate01", "password"));
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  // LoginPage always goes to "/" regardless of role; RoleRedirect owns routing
  it("navigates to / regardless of role after successful login", async () => {
    // given
    const user = userEvent.setup();
    mockLogin.mockResolvedValueOnce(undefined);
    renderLoginPage();

    // when
    await user.type(getUsername(), "alice");
    await user.type(getPassword(), "password");
    await user.click(getSubmitBtn());

    // expect
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  // Edge case: double-click during loading must not fire a second API call
  it("does not call login again when submit is clicked while loading", async () => {
    // given
    const user = userEvent.setup();
    let resolveLogin!: () => void;
    mockLogin.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLogin = resolve;
      }),
    );
    renderLoginPage();

    // when
    await user.type(getUsername(), "candidate01");
    await user.type(getPassword(), "password");
    await user.click(getSubmitBtn()); // first submit — starts loading, button becomes "登入中..."
    // Button is now disabled ("登入中..."); attempt a second click — should be a no-op
    await user.click(screen.getByRole("button", { name: "登入中..." }));

    // expect
    expect(mockLogin).toHaveBeenCalledTimes(1);

    resolveLogin();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  });

  // Negative: wrong credentials
  it("shows error message when login API returns an error", async () => {
    // given
    const user = userEvent.setup();
    mockLogin.mockRejectedValueOnce(new Error("Unauthorized"));
    renderLoginPage();

    // when
    await user.type(getUsername(), "wrong");
    await user.type(getPassword(), "wrong");
    await user.click(getSubmitBtn());

    // expect
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("帳號或密碼錯誤"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // Previous error is cleared on re-submit
  it("clears previous error when re-submitting", async () => {
    // given
    const user = userEvent.setup();
    mockLogin.mockRejectedValueOnce(new Error("Unauthorized")).mockResolvedValueOnce(undefined);
    renderLoginPage();

    // when
    await user.type(getUsername(), "wrong");
    await user.type(getPassword(), "wrong");
    await user.click(getSubmitBtn());
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    await user.clear(getPassword());
    await user.type(getPassword(), "password");
    await user.click(getSubmitBtn());

    // expect
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  // Loading state
  it("disables submit button and shows loading text while request is in flight", async () => {
    // given
    const user = userEvent.setup();
    let resolveLogin!: () => void;
    mockLogin.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLogin = resolve;
      }),
    );
    renderLoginPage();

    // when
    await user.type(getUsername(), "candidate01");
    await user.type(getPassword(), "password");
    await user.click(getSubmitBtn());

    // expect
    const loadingBtn = screen.getByRole("button", { name: "登入中..." });
    expect(loadingBtn).toBeDisabled();

    resolveLogin();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  });

  // Inputs disabled during loading
  it("disables inputs while request is in flight", async () => {
    // given
    const user = userEvent.setup();
    let resolveLogin!: () => void;
    mockLogin.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLogin = resolve;
      }),
    );
    renderLoginPage();

    // when
    await user.type(getUsername(), "candidate01");
    await user.type(getPassword(), "password");
    await user.click(getSubmitBtn());

    // expect
    expect(getUsername()).toBeDisabled();
    expect(getPassword()).toBeDisabled();

    resolveLogin();
    await waitFor(() => expect(getUsername()).not.toBeDisabled());
  });
});
