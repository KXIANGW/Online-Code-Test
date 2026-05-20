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
const mockCreateUsersBatch = vi.hoisted(() => vi.fn());
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
  createUsersBatch: mockCreateUsersBatch,
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
    mockCreateUsersBatch.mockReset();
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

  it("switches to batch mode and shows count input", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "批次建立" }));
    expect(screen.getByRole("spinbutton", { name: "建立數量" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批次建立帳號" })).toBeInTheDocument();
  });

  it("batch mode: calls createUsersBatch once and shows generated credentials", async () => {
    mockCreateUsersBatch.mockResolvedValue([
      { username: "candidate_20260520_001", password: "pass1" },
      { username: "candidate_20260520_002", password: "pass2" },
    ]);

    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "批次建立" }));
    const countInput = screen.getByRole("spinbutton", { name: "建立數量" });
    await user.clear(countInput);
    await user.type(countInput, "2");
    await user.click(screen.getByRole("button", { name: "批次建立帳號" }));

    await waitFor(() => expect(mockCreateUsersBatch).toHaveBeenCalledWith(2));
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(await screen.findByText(/成功建立 2/)).toBeInTheDocument();
    expect(screen.getByText("candidate_20260520_001")).toBeInTheDocument();
    expect(screen.getByText("pass1")).toBeInTheDocument();
  });

  it("batch mode: shows error when createUsersBatch rejects", async () => {
    mockCreateUsersBatch.mockRejectedValue(new Error("Batch failed"));

    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "批次建立" }));
    await user.click(screen.getByRole("button", { name: "批次建立帳號" }));

    await waitFor(() => expect(screen.getByText("Batch failed")).toBeInTheDocument());
  });
});
