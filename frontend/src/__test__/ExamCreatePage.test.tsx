import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ExamCreatePage from "../pages/ExamCreatePage";
import { mockProblemSummaries } from "./mock-data";
import type { ExamSession, CreateUserResponse } from "../types";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockGetProblems = vi.hoisted(() => vi.fn());
const mockCreateExamTemplateManual = vi.hoisted(() => vi.fn());
const mockCreateExamTemplateRandom = vi.hoisted(() => vi.fn());
const mockAssignExamToCandidates = vi.hoisted(() => vi.fn());
const mockCreateUser = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../api/client", () => ({
  getProblems: mockGetProblems,
  createExamTemplateManual: mockCreateExamTemplateManual,
  createExamTemplateRandom: mockCreateExamTemplateRandom,
  assignExamToCandidates: mockAssignExamToCandidates,
  createUser: mockCreateUser,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function setupAuthStore(username = "interviewer01") {
  mockUseAuthStore.mockImplementation(
    (sel: (s: { username: string; logout: typeof mockLogout }) => unknown) =>
      sel({ username, logout: mockLogout }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/interviewer/new"]}>
      <Routes>
        <Route path="/interviewer/new" element={<ExamCreatePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockCreatedUser: CreateUserResponse = {
  id: 99,
  username: "candidate01",
  displayName: "Test Candidate",
};

const mockCreatedTemplate = {
  id: 42,
  title: "Test Exam",
  durationMinutes: 90,
  createdBy: 10,
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
  deletedAt: null,
};

const mockCreatedSession: ExamSession = {
  id: 1,
  candidateId: 99,
  createdBy: 10,
  status: "not_started",
  durationMinutes: 90,
  actualStartAt: null,
  expiresAt: null,
  totalScore: 0,
  maxScore: 100,
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
};

// ── Helper: set candidate via modal ──────────────────────────────────────────
async function setupCandidate(username = "candidate01") {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /設定面試者帳號/ }));
  const usernameInput = await screen.findByRole("textbox", { name: /帳號/ });
  await user.clear(usernameInput);
  await user.type(usernameInput, username);
  await user.click(screen.getByRole("button", { name: "儲存設定" }));
  return user;
}

async function fillTitle(title = "Test Exam") {
  const user = userEvent.setup();
  const titleInput = screen.getByRole("textbox", { name: /考試標題/ });
  await user.clear(titleInput);
  await user.type(titleInput, title);
  return user;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("ExamCreatePage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockGetProblems.mockReset();
    mockCreateExamTemplateManual.mockReset();
    mockCreateExamTemplateRandom.mockReset();
    mockAssignExamToCandidates.mockReset();
    mockCreateUser.mockReset();
    setupAuthStore();
    mockGetProblems.mockResolvedValue(mockProblemSummaries);
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  it("shows 載入題目中... while getProblems is fetching", () => {
    // given
    mockGetProblems.mockReturnValue(new Promise(() => {}));

    // when
    renderPage();

    // expect
    expect(screen.getByText("載入題目中...")).toBeInTheDocument();
  });

  it("hides loading state after getProblems resolves", async () => {
    // given: mockGetProblems resolves (default setup)

    // when
    renderPage();

    // expect
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
  });

  // ── Candidate setup button ─────────────────────────────────────────────────

  it("shows '+ 設定面試者帳號' button before any candidate is set", async () => {
    // given: no pending user
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // expect: setup button present; no "待建立" badge
    expect(
      screen.getByRole("button", { name: /設定面試者帳號/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/待建立/)).not.toBeInTheDocument();
  });

  it("opens the candidate creation modal when the button is clicked", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // when
    await user.click(screen.getByRole("button", { name: /設定面試者帳號/ }));

    // expect: modal dialog title is visible
    expect(await screen.findByText("設定面試者帳號")).toBeInTheDocument();
  });

  it("shows '待建立' badge after confirming the modal with a username", async () => {
    // given
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // when
    await setupCandidate("candidate01");

    // expect: badge shows with the entered username
    expect(screen.getByText(/待建立/)).toBeInTheDocument();
    expect(screen.getByText(/candidate01/)).toBeInTheDocument();
  });

  it("cancel closes the modal without setting a pending user", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /設定面試者帳號/ }));
    await screen.findByText("設定面試者帳號");

    // when
    await user.click(screen.getByRole("button", { name: "取消" }));

    // expect: modal closed, no badge, setup button restored
    await waitFor(() =>
      expect(screen.queryByText(/待建立/)).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /設定面試者帳號/ }),
    ).toBeInTheDocument();
  });

  it("confirm button is disabled when username is empty", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /設定面試者帳號/ }));
    await screen.findByText("設定面試者帳號");

    // expect: confirm button is disabled because username is empty on open
    expect(screen.getByRole("button", { name: "儲存設定" })).toBeDisabled();
  });

  // ── Problem list (manual mode) ────────────────────────────────────────────

  it("shows easy problems in the easy tab sorted alphabetically", async () => {
    // given: mockProblemSummaries has one easy problem: 'Two Sum'

    // when
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // expect: easy tab shows 'Two Sum'; medium/hard problems are hidden
    expect(screen.getByText("Two Sum")).toBeInTheDocument();
    expect(screen.queryByText("Binary Search")).not.toBeInTheDocument();
    expect(screen.queryByText("Merge Sort")).not.toBeInTheDocument();
  });

  it("switches to medium tab and shows medium problems", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // when
    await user.click(screen.getByRole("button", { name: /中等/ }));

    // expect
    expect(screen.getByText("Binary Search")).toBeInTheDocument();
    expect(screen.queryByText("Two Sum")).not.toBeInTheDocument();
  });

  it("checking a problem shows a score weight input with default 100", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // when
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // expect
    const weightInput = screen.getByRole("spinbutton", { name: "Two Sum 配分" });
    expect(weightInput).toBeInTheDocument();
    expect(weightInput).toHaveValue(100);
  });

  it("unchecking a problem removes the score weight input", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));
    expect(
      screen.getByRole("spinbutton", { name: "Two Sum 配分" }),
    ).toBeInTheDocument();

    // when
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // expect
    expect(
      screen.queryByRole("spinbutton", { name: "Two Sum 配分" }),
    ).not.toBeInTheDocument();
  });

  // ── Mode toggle ───────────────────────────────────────────────────────────

  it("switching to random mode shows distribution inputs and hides problem list", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // when
    await user.click(screen.getByRole("button", { name: "隨機派題" }));

    // expect: distribution inputs appear
    expect(
      screen.getByRole("spinbutton", { name: "隨機簡單題數" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "隨機中等題數" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "隨機困難題數" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "每題配分" }),
    ).toBeInTheDocument();
    // problem list is hidden
    expect(screen.queryByText("Two Sum")).not.toBeInTheDocument();
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("shows '請先設定面試者資訊' error when submitting without setting a candidate", async () => {
    // given
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // when: submit without setting candidate
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    expect(screen.getByText("請先設定面試者資訊")).toBeInTheDocument();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("shows error when submitting manual mode with no problems selected", async () => {
    // given
    mockCreateUser.mockResolvedValue(mockCreatedUser);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
    await setupCandidate();

    // when: submit without selecting any problem
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    await waitFor(() =>
      expect(screen.getByText("請至少選擇一個題目")).toBeInTheDocument(),
    );
    expect(mockCreateExamTemplateManual).not.toHaveBeenCalled();
    expect(mockAssignExamToCandidates).not.toHaveBeenCalled();
  });

  it("shows error when submitting random mode with all distribution counts = 0", async () => {
    // given
    mockCreateUser.mockResolvedValue(mockCreatedUser);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await setupCandidate();
    await user.click(screen.getByRole("button", { name: "隨機派題" }));

    // when: all distribution inputs are 0 (default)
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    await waitFor(() =>
      expect(
        screen.getByText("請至少在難度分佈中填寫一題"),
      ).toBeInTheDocument(),
    );
    expect(mockCreateExamTemplateRandom).not.toHaveBeenCalled();
    expect(mockAssignExamToCandidates).not.toHaveBeenCalled();
  });

  // ── Submit: manual mode ───────────────────────────────────────────────────

  it("calls createUser then createExamTemplateManual then assign with correct payload and navigates", async () => {
    // given
    mockCreateUser.mockResolvedValue(mockCreatedUser);
    mockCreateExamTemplateManual.mockResolvedValue(mockCreatedTemplate);
    mockAssignExamToCandidates.mockResolvedValue([mockCreatedSession]);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
    await setupCandidate("candidate01");
    await fillTitle("My Exam");
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));
    const weightInput = screen.getByRole("spinbutton", { name: "Two Sum 配分" });
    await user.clear(weightInput);
    await user.type(weightInput, "50");

    // when
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    await waitFor(() =>
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: "candidate01" }),
      ),
    );
    await waitFor(() =>
      expect(mockCreateExamTemplateManual).toHaveBeenCalledWith({
        title: "My Exam",
        durationMinutes: 90,
        problems: [{ problemId: 1, scoreWeight: 50, orderIndex: 1 }],
      }),
    );
    await waitFor(() =>
      expect(mockAssignExamToCandidates).toHaveBeenCalledWith(42, [99]),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  // ── Submit: random mode ───────────────────────────────────────────────────

  it("calls createUser then createExamTemplateRandom then assign with correct payload and navigates", async () => {
    // given
    mockCreateUser.mockResolvedValue(mockCreatedUser);
    mockCreateExamTemplateRandom.mockResolvedValue(mockCreatedTemplate);
    mockAssignExamToCandidates.mockResolvedValue([mockCreatedSession]);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await setupCandidate("candidate01");
    await fillTitle("Random Exam");
    await user.click(screen.getByRole("button", { name: "隨機派題" }));
    const easyInput = screen.getByRole("spinbutton", { name: "隨機簡單題數" });
    await user.clear(easyInput);
    await user.type(easyInput, "1");

    // when
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect
    await waitFor(() =>
      expect(mockCreateExamTemplateRandom).toHaveBeenCalledWith({
        title: "Random Exam",
        durationMinutes: 90,
        distribution: { easy: 1 },
        scoreWeight: 100,
      }),
    );
    await waitFor(() =>
      expect(mockAssignExamToCandidates).toHaveBeenCalledWith(42, [99]),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  // ── API failures ──────────────────────────────────────────────────────────

  it("shows error message when createExamTemplateManual rejects", async () => {
    // given
    mockCreateUser.mockResolvedValue(mockCreatedUser);
    mockCreateExamTemplateManual.mockRejectedValue(
      new Error("500 Internal Server Error"),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
    await setupCandidate();
    await fillTitle("Failing Exam");
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // when
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect: error shown, no navigation
    await waitFor(() =>
      expect(
        screen.getByText("500 Internal Server Error"),
      ).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows error message when createUser rejects", async () => {
    // given
    mockCreateUser.mockRejectedValue(new Error("使用者帳號已存在"));
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );
    await setupCandidate();
    await fillTitle("Test Exam");
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Two Sum/ }));

    // when
    await user.click(screen.getByRole("button", { name: "建立考試" }));

    // expect: error shown, no navigation
    await waitFor(() =>
      expect(screen.getByText("使用者帳號已存在")).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  it("back button navigates to /interviewer", async () => {
    // given
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // when
    await userEvent.click(screen.getByText("← 返回考試管理"));

    // expect
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  it("brand link in navbar points to /interviewer", async () => {
    // given
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入題目中...")).not.toBeInTheDocument(),
    );

    // expect
    expect(
      screen.getByRole("link", { name: "Online Code Test" }),
    ).toHaveAttribute("href", "/interviewer");
  });
});
