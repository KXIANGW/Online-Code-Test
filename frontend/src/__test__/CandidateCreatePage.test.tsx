import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import CandidateCreatePage from "../pages/CandidateCreatePage";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockCreateUser = vi.hoisted(() => vi.fn());
const mockSetCandidates = vi.hoisted(() => vi.fn());
const mockUseInterviewerStore = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../stores/interviewerStore", () => ({
  useInterviewerStore: mockUseInterviewerStore,
}));
vi.mock("../api/client", () => ({
  createUser: mockCreateUser,
}));

function setupAuthStore(username = "interviewer01") {
  mockUseAuthStore.mockImplementation(
    (sel: (s: { username: string; logout: typeof mockLogout }) => unknown) =>
      sel({ username, logout: mockLogout }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/interviewer/candidates/new"]}>
      <Routes>
        <Route path="/interviewer/candidates/new" element={<CandidateCreatePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CandidateCreatePage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockCreateUser.mockReset();
    mockSetCandidates.mockReset();
    setupAuthStore();
    mockUseInterviewerStore.mockImplementation((sel: any) =>
      sel({ setCandidates: mockSetCandidates }),
    );
  });

  it("renders single-create mode by default", () => {
    renderPage();
    expect(screen.getByRole("textbox", { name: "帳號" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "密碼" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "建立帳號" })).toBeEnabled();
  });

  it("shows error when submitting with empty username", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "建立帳號" }));
    expect(screen.getByText("請填寫帳號")).toBeInTheDocument();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("calls createUser and shows credential panel on success", async () => {
    mockCreateUser.mockResolvedValue({
      id: 10,
      username: "candidate01",
      displayName: "Alice",
    });
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox", { name: "帳號" }), "candidate01");

    // Clear auto-generated password and type a known one
    const pwInput = screen.getByRole("textbox", { name: "密碼" });
    await user.clear(pwInput);
    await user.type(pwInput, "mypassword");

    await user.click(screen.getByRole("button", { name: "建立帳號" }));

    await waitFor(() =>
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: "candidate01", password: "mypassword" }),
      ),
    );

    // Credential panel is shown
    expect(await screen.findByText(/成功建立/)).toBeInTheDocument();
    expect(screen.getByText("candidate01")).toBeInTheDocument();
    expect(screen.getByText("mypassword")).toBeInTheDocument();
    expect(mockSetCandidates).toHaveBeenCalledWith([]);
  });

  it("does not navigate away automatically after success", async () => {
    mockCreateUser.mockResolvedValue({ id: 10, username: "u1", displayName: null });
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox", { name: "帳號" }), "u1");
    await user.click(screen.getByRole("button", { name: "建立帳號" }));

    await waitFor(() => expect(screen.getByText(/成功建立/)).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows error when createUser rejects", async () => {
    mockCreateUser.mockRejectedValue(new Error("Username already taken"));
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox", { name: "帳號" }), "taken");
    await user.click(screen.getByRole("button", { name: "建立帳號" }));

    await waitFor(() =>
      expect(screen.getByText("Username already taken")).toBeInTheDocument(),
    );
  });

  it("switches to batch mode and shows row inputs", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "批次建立" }));
    expect(screen.getByRole("textbox", { name: "帳號 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批次建立帳號" })).toBeInTheDocument();
  });

  it("batch mode: creates all valid rows and shows result panel", async () => {
    mockCreateUser
      .mockResolvedValueOnce({ id: 1, username: "a1", displayName: null })
      .mockResolvedValueOnce({ id: 2, username: "a2", displayName: null });

    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "批次建立" }));

    // Fill first row
    await user.type(screen.getByRole("textbox", { name: "帳號 1" }), "a1");
    const pw1 = screen.getByRole("textbox", { name: "密碼 1" });
    await user.clear(pw1);
    await user.type(pw1, "pass1");

    // Add second row
    await user.click(screen.getByText("＋ 新增一行"));
    await user.type(screen.getByRole("textbox", { name: "帳號 2" }), "a2");
    const pw2 = screen.getByRole("textbox", { name: "密碼 2" });
    await user.clear(pw2);
    await user.type(pw2, "pass2");

    await user.click(screen.getByRole("button", { name: "批次建立帳號" }));

    await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/成功建立 2/)).toBeInTheDocument();
  });

  it("batch mode: shows partial failure correctly", async () => {
    mockCreateUser
      .mockResolvedValueOnce({ id: 1, username: "ok_user", displayName: null })
      .mockRejectedValueOnce(new Error("Duplicate"));

    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "批次建立" }));

    await user.type(screen.getByRole("textbox", { name: "帳號 1" }), "ok_user");
    await user.click(screen.getByText("＋ 新增一行"));
    await user.type(screen.getByRole("textbox", { name: "帳號 2" }), "dup_user");

    await user.click(screen.getByRole("button", { name: "批次建立帳號" }));

    await waitFor(() => expect(screen.getByText(/成功建立 1/)).toBeInTheDocument());
    expect(screen.getByText(/建立失敗 1/)).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
  });
});
