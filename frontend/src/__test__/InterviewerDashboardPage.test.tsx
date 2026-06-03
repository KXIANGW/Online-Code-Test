import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import InterviewerDashboardPage from "../pages/InterviewerDashboardPage";
import { mockSessionResult, mockUserSummaries } from "./mock-data";
import type { ExamSession, ExamTemplate, SessionResult, UserSummary } from "../types";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockUseInterviewerStore = vi.hoisted(() => vi.fn());
const mockGetExamSessions = vi.hoisted(() => vi.fn());
const mockGetSessionResult = vi.hoisted(() => vi.fn());
const mockListExamTemplates = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());
const mockAssignExamToCandidates = vi.hoisted(() => vi.fn());
const mockGetUserPassword = vi.hoisted(() => vi.fn());
const mockDeleteExamTemplate = vi.hoisted(() => vi.fn());
const mockUpdateUser = vi.hoisted(() => vi.fn());
const mockCopyToClipboard = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../stores/interviewerStore", () => ({
  useInterviewerStore: mockUseInterviewerStore,
}));
vi.mock("../api/client", () => ({
  getExamSessions: mockGetExamSessions,
  getSessionResult: mockGetSessionResult,
  listExamTemplates: mockListExamTemplates,
  getUsers: mockGetUsers,
  assignExamToCandidates: mockAssignExamToCandidates,
  getUserPassword: mockGetUserPassword,
  deleteExamTemplate: mockDeleteExamTemplate,
  updateUser: mockUpdateUser,
}));
vi.mock("../utils/clipboard", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const mockTemplate: ExamTemplate = {
  id: 42,
  title: "Backend Engineer Test",
  durationMinutes: 90,
  createdBy: 10,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
  deletedAt: null,
  problems: [
    {
      problemId: 1,
      title: "Two Sum",
      difficulty: "easy",
      orderIndex: 1,
      scoreWeight: 30,
    },
    {
      problemId: 2,
      title: "Binary Search",
      difficulty: "medium",
      orderIndex: 2,
      scoreWeight: 70,
    },
  ],
};

const mockNotStartedResult: SessionResult = {
  id: 1,
  candidate: { id: 5, username: "candidate_20260509_001", displayName: "David Chang" },
  status: "not_started",
  actualStartAt: null,
  expiresAt: null,
  totalScore: 0,
  maxScore: 100,
  problems: [],
};

const mockSubmittedResult: SessionResult = {
  id: 3,
  candidate: { id: 6, username: "candidate_20260509_002", displayName: "Emma Lin" },
  status: "submitted",
  actualStartAt: "2026-05-08T08:00:00.000Z",
  expiresAt: "2026-05-08T09:30:00.000Z",
  totalScore: 75,
  maxScore: 100,
  problems: [],
};

const mockCandidates: UserSummary[] = mockUserSummaries.filter((u) =>
  u.roles.includes("candidate"),
);

const pendingCandidate: UserSummary = {
  id: 4,
  username: "pending01",
  displayName: "Pending Candidate",
  isSuperuser: false,
  createdAt: "2026-01-04T00:00:00.000Z",
  roles: ["candidate"],
};

const activeCandidate: UserSummary = {
  id: 5,
  username: "active01",
  displayName: "Active Candidate",
  isSuperuser: false,
  createdAt: "2026-01-05T00:00:00.000Z",
  roles: ["candidate"],
};

const endedCandidate: UserSummary = {
  id: 6,
  username: "ended01",
  displayName: "Ended Candidate",
  isSuperuser: false,
  createdAt: "2026-01-06T00:00:00.000Z",
  roles: ["candidate"],
};

function sessionForCandidate(
  candidate: UserSummary,
  status: ExamSession["status"],
  examTitle: string,
): ExamSession {
  return {
    id: 100 + candidate.id,
    examId: 200 + candidate.id,
    examTitle,
    candidateId: candidate.id,
    candidate: {
      id: candidate.id,
      username: candidate.username,
      displayName: candidate.displayName,
    },
    createdBy: 10,
    status,
    durationMinutes: 60,
    actualStartAt: status === "not_started" ? null : "2026-05-20T00:00:00.000Z",
    expiresAt: status === "in_progress" ? "2026-05-20T01:00:00.000Z" : null,
    submittedAt: status === "submitted" ? "2026-05-20T01:00:00.000Z" : null,
    totalScore: 0,
    maxScore: 100,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setupAuthStore(username = "alice") {
  mockUseAuthStore.mockImplementation((sel: any) =>
    sel({
      token: "tok",
      username,
      login: vi.fn(),
      logout: mockLogout,
      isSuperuser: false,
      permissions: ["exam:manage"],
    }),
  );
}

function setupInterviewerStore(
  results: SessionResult[] = [],
  templates: ExamTemplate[] = [],
  candidates: UserSummary[] = [],
) {
  const setResults = vi.fn();
  const setTemplates = vi.fn();
  const setCandidates = vi.fn();
  mockUseInterviewerStore.mockImplementation((sel: any) =>
    sel({ results, setResults, templates, setTemplates, candidates, setCandidates }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <InterviewerDashboardPage />
    </MemoryRouter>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("InterviewerDashboardPage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockUseInterviewerStore.mockReset();
    mockGetExamSessions.mockReset();
    mockGetSessionResult.mockReset();
    mockListExamTemplates.mockReset();
    mockGetUsers.mockReset();
    mockAssignExamToCandidates.mockReset();
    mockGetUserPassword.mockReset();
    mockDeleteExamTemplate.mockReset();
    mockUpdateUser.mockReset();
    mockCopyToClipboard.mockReset();
    // Default: API returns empty
    mockGetExamSessions.mockResolvedValue([]);
    mockListExamTemplates.mockResolvedValue([]);
    mockGetUsers.mockResolvedValue([]);
    mockAssignExamToCandidates.mockResolvedValue([]);
    mockDeleteExamTemplate.mockResolvedValue(undefined);
  });

  it("renders 考試管理 heading and 4 main tabs", () => {
    setupAuthStore();
    setupInterviewerStore();
    renderPage();
    expect(screen.getByRole("heading", { name: "考試管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "考生帳號" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "考試模板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "考試分發" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "考試紀錄" })).toBeInTheDocument();
  });

  it("default tab is 考試模板", async () => {
    setupAuthStore();
    setupInterviewerStore([], [], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    // Template tab content shown by default
    expect(screen.getByRole("button", { name: "＋ 建立模板" })).toBeInTheDocument();
  });

  it("shows loading state on mount", () => {
    setupAuthStore();
    setupInterviewerStore();
    mockGetExamSessions.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText("載入中...")).toBeInTheDocument();
  });

  // ── Templates tab ─────────────────────────────────────────────────────────

  it("templates tab: shows template details and problem list without assignment button", async () => {
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    expect(screen.getByText("Backend Engineer Test")).toBeInTheDocument();
    expect(screen.getByText(/90 分鐘/)).toBeInTheDocument();
    expect(screen.getByText(/Two Sum/)).toBeInTheDocument();
    expect(screen.getByText(/Binary Search/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分配考試" })).not.toBeInTheDocument();
  });

  it("templates tab: ＋ 建立模板 navigates to /interviewer/templates/new", async () => {
    setupAuthStore();
    setupInterviewerStore();
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "＋ 建立模板" }));
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer/templates/new");
  });

  it("templates tab: 編輯 navigates to /interviewer/templates/:id/edit", async () => {
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "編輯" }));

    expect(mockNavigate).toHaveBeenCalledWith("/interviewer/templates/42/edit");
  });

  it("templates tab: 刪除 opens confirm dialog → confirm → deletes the template", async () => {
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "刪除" }));
    // confirm dialog should appear
    expect(
      screen.getByText("確定要刪除此考試模板嗎？已分發的考試與歷史紀錄不會受影響。"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "確定" }));

    await waitFor(() => expect(mockDeleteExamTemplate).toHaveBeenCalledWith(42));
  });

  it("templates tab: shows empty state when no templates", async () => {
    setupAuthStore();
    setupInterviewerStore([], [], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    expect(screen.getByText("目前沒有考試模板")).toBeInTheDocument();
  });

  // ── Candidates tab ────────────────────────────────────────────────────────

  it("candidates tab: shows candidate count and list", async () => {
    setupAuthStore();
    setupInterviewerStore([], [], mockCandidates);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));
    // Use toHaveTextContent because the count "1" is inside a child <span>
    const countEl = screen.getByText(/位考生/, { selector: "p" });
    expect(countEl).toHaveTextContent("共管理");
    expect(countEl).toHaveTextContent("1");
    expect(screen.getByText(/Alice Chen/)).toBeInTheDocument();
  });

  it("candidates tab: ＋ 建立帳號 navigates to /interviewer/candidates/new", async () => {
    setupAuthStore();
    setupInterviewerStore([], [], mockCandidates);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));
    await userEvent.click(screen.getByRole("button", { name: "＋ 建立帳號" }));
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer/candidates/new");
  });

  it("candidates tab: shows empty state when no candidates", async () => {
    setupAuthStore();
    setupInterviewerStore([], [], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));
    expect(screen.getByText("目前沒有考生帳號")).toBeInTheDocument();
  });

  // ── Records tab ───────────────────────────────────────────────────────────

  it("records tab: shows session cards", async () => {
    setupAuthStore();
    setupInterviewerStore([mockSessionResult], [], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "考試紀錄" }));
    expect(await screen.findByText("Alice Chen")).toBeInTheDocument();
  });

  it("records tab: 進行中 filter shows only in_progress sessions", async () => {
    setupAuthStore();
    setupInterviewerStore([mockNotStartedResult, mockSessionResult], [], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "考試紀錄" }));
    await userEvent.click(screen.getByRole("button", { name: "進行中" }));
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.queryByText("David Chang")).not.toBeInTheDocument();
  });

  it("records tab: 已結束 filter shows submitted and expired", async () => {
    const expiredResult: SessionResult = { ...mockNotStartedResult, id: 4, status: "expired" };
    setupAuthStore();
    setupInterviewerStore([mockSubmittedResult, expiredResult, mockSessionResult], [], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "考試紀錄" }));
    await userEvent.click(screen.getByRole("button", { name: "已結束" }));
    expect(screen.getByText("Emma Lin")).toBeInTheDocument();
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
  });

  it("records tab: clicking 查看結果 navigates to /result/:id", async () => {
    setupAuthStore();
    setupInterviewerStore([mockSessionResult], [], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "考試紀錄" }));
    await userEvent.click(await screen.findByRole("button", { name: "查看結果" }));
    expect(mockNavigate).toHaveBeenCalledWith("/result/2");
  });

  // ── Assignments tab ───────────────────────────────────────────────────────

  it("assignments tab: assigns selected template to selected candidates", async () => {
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], mockCandidates);
    renderPage();

    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "考試分發" }));
    await userEvent.selectOptions(screen.getByLabelText("考試模板"), "42");
    await userEvent.click(screen.getByRole("checkbox", { name: /Alice Chen/ }));
    await userEvent.click(screen.getByRole("button", { name: /確認分發/ }));

    await waitFor(() => expect(mockAssignExamToCandidates).toHaveBeenCalledWith(42, [1]));
    expect(screen.getByText("分發成功")).toBeInTheDocument();
  });

  it("assignments tab: hides in-progress and ended candidates but shows pending candidate template", async () => {
    const candidates = [mockCandidates[0]!, pendingCandidate, activeCandidate, endedCandidate];
    mockGetExamSessions.mockResolvedValue([
      sessionForCandidate(pendingCandidate, "not_started", "Legacy Backend Test"),
      sessionForCandidate(activeCandidate, "in_progress", "Running Backend Test"),
      sessionForCandidate(endedCandidate, "submitted", "Finished Backend Test"),
    ]);
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], candidates);
    renderPage();

    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "考試分發" }));

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("Pending Candidate")).toBeInTheDocument();
    expect(screen.getByText("目前模板：Legacy Backend Test")).toBeInTheDocument();
    expect(screen.getByText("尚未分配模板")).toBeInTheDocument();
    expect(screen.queryByText("Active Candidate")).not.toBeInTheDocument();
    expect(screen.queryByText("Ended Candidate")).not.toBeInTheDocument();
  });

  it("assignments tab: allows selecting a pending candidate to replace their template", async () => {
    mockGetExamSessions.mockResolvedValue([
      sessionForCandidate(pendingCandidate, "not_started", "Legacy Backend Test"),
    ]);
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], [pendingCandidate]);
    renderPage();

    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "考試分發" }));
    await userEvent.selectOptions(screen.getByLabelText("考試模板"), "42");
    await userEvent.click(screen.getByRole("checkbox", { name: /Pending Candidate/ }));
    await userEvent.click(screen.getByRole("button", { name: /確認分發/ }));

    await waitFor(() => expect(mockAssignExamToCandidates).toHaveBeenCalledWith(42, [4]));
  });

  it("assignments tab: shows error message when assignExamToCandidates rejects", async () => {
    // given
    mockGetExamSessions.mockResolvedValue([]);
    mockAssignExamToCandidates.mockRejectedValue({ message: "分發失敗" });
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], [pendingCandidate]);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    // when
    await userEvent.click(screen.getByRole("button", { name: "考試分發" }));
    await userEvent.selectOptions(screen.getByLabelText("考試模板"), "42");
    await userEvent.click(screen.getByRole("checkbox", { name: /Pending Candidate/ }));
    await userEvent.click(screen.getByRole("button", { name: /確認分發/ }));

    // expect
    await waitFor(() => expect(screen.getByText("分發失敗")).toBeInTheDocument());
  });

  it("assignments tab: shows empty state when all candidates have active or ended sessions", async () => {
    // given: every candidate is in_progress or submitted
    mockGetExamSessions.mockResolvedValue([
      sessionForCandidate(activeCandidate, "in_progress", "Running Test"),
      sessionForCandidate(endedCandidate, "submitted", "Finished Test"),
    ]);
    mockGetSessionResult.mockResolvedValue(mockNotStartedResult);
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], [activeCandidate, endedCandidate]);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    // when
    await userEvent.click(screen.getByRole("button", { name: "考試分發" }));

    // expect
    expect(screen.getByText("目前沒有考生可分發")).toBeInTheDocument();
  });

  it("records tab: shows empty state when no exam sessions exist", async () => {
    // given
    mockGetExamSessions.mockResolvedValue([]);
    setupAuthStore();
    setupInterviewerStore([], [], []);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    // when
    await userEvent.click(screen.getByRole("button", { name: "考試紀錄" }));

    // expect
    expect(screen.getByText("目前沒有考試紀錄")).toBeInTheDocument();
  });

  it("candidates tab: onSaved triggers loadDashboardData and closes the dialog", async () => {
    // given
    mockGetUsers.mockResolvedValue(mockUserSummaries);
    mockUpdateUser.mockResolvedValue({ ...pendingCandidate, displayName: "Updated Name" });
    mockGetUserPassword.mockResolvedValue({ password: "Test@1234" });
    setupAuthStore();
    setupInterviewerStore([], [], [pendingCandidate]);
    renderPage();
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));
    await userEvent.click(screen.getByRole("button", { name: "編輯" }));

    // when: submit the dialog (placeholder = candidate.username since label has no htmlFor)
    const displayNameInput = screen.getByPlaceholderText(pendingCandidate.username);
    await userEvent.clear(displayNameInput);
    await userEvent.type(displayNameInput, "Updated Name");
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));

    // expect: loadDashboardData called again (getExamSessions called twice: mount + onSaved)
    await waitFor(() => expect(mockGetExamSessions).toHaveBeenCalledTimes(2));
    // dialog closed
    expect(screen.queryByRole("button", { name: "儲存" })).not.toBeInTheDocument();
  });

  // ── Data fetching ─────────────────────────────────────────────────────────

  it("fetches sessions, templates, and users on mount", async () => {
    const mockSetResults = vi.fn();
    const mockSetTemplates = vi.fn();
    const mockSetCandidates = vi.fn();
    setupAuthStore();
    mockUseInterviewerStore.mockImplementation((sel: any) =>
      sel({
        results: [],
        setResults: mockSetResults,
        templates: [],
        setTemplates: mockSetTemplates,
        candidates: [],
        setCandidates: mockSetCandidates,
      }),
    );
    mockGetExamSessions.mockResolvedValue([{ id: 2 }]);
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    mockListExamTemplates.mockResolvedValue([mockTemplate]);
    mockGetUsers.mockResolvedValue(mockUserSummaries);
    mockGetUserPassword.mockResolvedValue({ password: "Passw0rd!" });

    renderPage();

    await waitFor(() => {
      expect(mockGetExamSessions).toHaveBeenCalledTimes(1);
      expect(mockListExamTemplates).toHaveBeenCalledTimes(1);
      expect(mockGetUsers).toHaveBeenCalledTimes(1);
      expect(mockSetTemplates).toHaveBeenCalledWith([mockTemplate]);
    });
  });

  // ── Candidate masked password display (考生帳號 tab) ────────────────────────

  describe("candidate masked password display in 考生帳號 tab", () => {
    it("shows masked password (first 3 + stars + last 3) after load", async () => {
      // given: getUserPassword resolves with "Passw0rd!" (9 chars → "Pas***rd!")
      setupAuthStore();
      setupInterviewerStore([], [], mockCandidates);
      mockGetUsers.mockResolvedValue(mockUserSummaries);
      mockGetUserPassword.mockResolvedValue({ password: "Passw0rd!" });

      renderPage();
      await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

      // when
      await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));

      // expect: masked form shown, full plaintext hidden
      await waitFor(() => expect(screen.getByText("Pas***rd!")).toBeInTheDocument());
      expect(screen.queryByText("Passw0rd!")).not.toBeInTheDocument();
    });

    it("does not render a 查看密碼 button — password is displayed directly", async () => {
      // given
      setupAuthStore();
      setupInterviewerStore([], [], mockCandidates);
      mockGetUsers.mockResolvedValue(mockUserSummaries);
      mockGetUserPassword.mockResolvedValue({ password: "Passw0rd!" });

      renderPage();
      await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

      // when
      await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));

      // expect: no on-demand reveal button
      expect(screen.queryByRole("button", { name: "查看密碼" })).not.toBeInTheDocument();
    });

    it("copy button calls copyToClipboard with full plaintext password", async () => {
      // given
      setupAuthStore();
      setupInterviewerStore([], [], mockCandidates);
      mockGetUsers.mockResolvedValue(mockUserSummaries);
      mockGetUserPassword.mockResolvedValue({ password: "Passw0rd!" });

      renderPage();
      await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));
      await waitFor(() => expect(screen.getByText("Pas***rd!")).toBeInTheDocument());

      // when: click copy icon
      await userEvent.click(screen.getByRole("button", { name: /複製.*密碼/ }));

      // expect: called with the FULL plaintext, not the masked form
      expect(mockCopyToClipboard).toHaveBeenCalledWith("Passw0rd!");
    });

    it("getUserPassword is called with the correct candidate userId", async () => {
      // given: Alice Chen has id=1 in mockUserSummaries
      setupAuthStore();
      setupInterviewerStore([], [], mockCandidates);
      mockGetUsers.mockResolvedValue(mockUserSummaries);
      mockGetUserPassword.mockResolvedValue({ password: "Passw0rd!" });

      renderPage();
      await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

      // expect
      expect(mockGetUserPassword).toHaveBeenCalledWith(1);
    });

    it("shows — when getUserPassword rejects (404 / 500)", async () => {
      // given: API rejects for this candidate
      setupAuthStore();
      setupInterviewerStore([], [], mockCandidates);
      mockGetUsers.mockResolvedValue(mockUserSummaries);
      mockGetUserPassword.mockRejectedValue(new Error("404 Not Found"));

      renderPage();
      await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

      // when
      await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));

      // expect: fallback dash shown, no masked password
      expect(screen.getByText("—")).toBeInTheDocument();
      expect(screen.queryByText("Pas***rd!")).not.toBeInTheDocument();
    });

    it("masks a short password (≤ 6 chars) with all stars — boundary case", async () => {
      // given: password shorter than 7 chars → all stars
      setupAuthStore();
      setupInterviewerStore([], [], mockCandidates);
      mockGetUsers.mockResolvedValue(mockUserSummaries);
      mockGetUserPassword.mockResolvedValue({ password: "abc" });

      renderPage();
      await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());

      // when
      await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));

      // expect: "abc" (len 3) → "***"
      await waitFor(() => expect(screen.getByText("***")).toBeInTheDocument());
    });
  });

  // ── Logout ────────────────────────────────────────────────────────────────

  it("logout: opens menu → clicks Log out → calls logout and navigates to /login", async () => {
    setupAuthStore();
    setupInterviewerStore();
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    await userEvent.click(screen.getByText("Log out"));

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });
});
