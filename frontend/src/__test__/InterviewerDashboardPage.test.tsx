import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import InterviewerDashboardPage from "../pages/InterviewerDashboardPage";
import { mockSessionResult, mockUserSummaries } from "./mock-data";
import type { ExamTemplate, SessionResult, UserSummary } from "../types";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockUseInterviewerStore = vi.hoisted(() => vi.fn());
const mockGetExamSessions = vi.hoisted(() => vi.fn());
const mockGetSessionResult = vi.hoisted(() => vi.fn());
const mockListExamTemplates = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());

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
    // Default: API returns empty
    mockGetExamSessions.mockResolvedValue([]);
    mockListExamTemplates.mockResolvedValue([]);
    mockGetUsers.mockResolvedValue([]);
  });

  it("renders 考試管理 heading and 3 main tabs", () => {
    setupAuthStore();
    setupInterviewerStore();
    renderPage();
    expect(screen.getByText("考試管理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "考生帳號" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "考試模板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "考試紀錄" })).toBeInTheDocument();
  });

  it("default tab is 考試模板", async () => {
    setupAuthStore();
    setupInterviewerStore([], [], []);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
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

  it("templates tab: shows template card with title and 分配考試 button", async () => {
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], []);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Backend Engineer Test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分配考試" })).toBeEnabled();
  });

  it("templates tab: 分配考試 navigates to /interviewer/templates/:id/assign", async () => {
    setupAuthStore();
    setupInterviewerStore([], [mockTemplate], []);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "分配考試" }));
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer/templates/42/assign");
  });

  it("templates tab: ＋ 建立模板 navigates to /interviewer/templates/new", async () => {
    setupAuthStore();
    setupInterviewerStore();
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "＋ 建立模板" }));
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer/templates/new");
  });

  it("templates tab: shows empty state when no templates", async () => {
    setupAuthStore();
    setupInterviewerStore([], [], []);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("目前沒有考試模板")).toBeInTheDocument();
  });

  // ── Candidates tab ────────────────────────────────────────────────────────

  it("candidates tab: shows candidate count and list", async () => {
    setupAuthStore();
    setupInterviewerStore([], [], mockCandidates);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
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
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));
    await userEvent.click(screen.getByRole("button", { name: "＋ 建立帳號" }));
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer/candidates/new");
  });

  it("candidates tab: shows empty state when no candidates", async () => {
    setupAuthStore();
    setupInterviewerStore([], [], []);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "考生帳號" }));
    expect(screen.getByText("目前沒有考生帳號")).toBeInTheDocument();
  });

  // ── Records tab ───────────────────────────────────────────────────────────

  it("records tab: shows session cards", async () => {
    setupAuthStore();
    setupInterviewerStore([mockSessionResult], [], []);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "考試紀錄" }));
    expect(await screen.findByText("Alice Chen")).toBeInTheDocument();
  });

  it("records tab: 進行中 filter shows only in_progress sessions", async () => {
    setupAuthStore();
    setupInterviewerStore([mockNotStartedResult, mockSessionResult], [], []);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
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
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "考試紀錄" }));
    await userEvent.click(screen.getByRole("button", { name: "已結束" }));
    expect(screen.getByText("Emma Lin")).toBeInTheDocument();
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
  });

  it("records tab: clicking 查看結果 navigates to /result/:id", async () => {
    setupAuthStore();
    setupInterviewerStore([mockSessionResult], [], []);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "考試紀錄" }));
    await userEvent.click(await screen.findByRole("button", { name: "查看結果" }));
    expect(mockNavigate).toHaveBeenCalledWith("/result/2");
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

    renderPage();

    await waitFor(() => {
      expect(mockGetExamSessions).toHaveBeenCalledTimes(1);
      expect(mockListExamTemplates).toHaveBeenCalledTimes(1);
      expect(mockGetUsers).toHaveBeenCalledTimes(1);
      expect(mockSetTemplates).toHaveBeenCalledWith([mockTemplate]);
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
