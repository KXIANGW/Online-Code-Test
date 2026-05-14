import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import InterviewerDashboardPage from "../pages/InterviewerDashboardPage";
import { mockSessionResult } from "./mock-data";
import type { SessionResult } from "../types";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockUseInterviewerStore = vi.hoisted(() => vi.fn());
const mockGetExamSessions = vi.hoisted(() => vi.fn());
const mockGetSessionResult = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../stores/interviewerStore", () => ({ useInterviewerStore: mockUseInterviewerStore }));
vi.mock("../api/client", () => ({
  getExamSessions: mockGetExamSessions,
  getSessionResult: mockGetSessionResult,
}));

// ── Extra fixture data ────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function setupAuthStore(username = "alice") {
  mockUseAuthStore.mockImplementation((sel: any) =>
    sel({ token: "tok", username, login: vi.fn(), logout: mockLogout,
          isSuperuser: false, permissions: ["exam:manage"] })
  );
}

function setupInterviewerStore(results: SessionResult[] = [], setResults = vi.fn()) {
  mockUseInterviewerStore.mockImplementation((sel: any) =>
    sel({ results, setResults })
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <InterviewerDashboardPage />
    </MemoryRouter>
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
    // Default: API returns nothing
    mockGetExamSessions.mockResolvedValue([]);
  });

  it("renders 考試管理 heading and 建立考試 button", () => {
    // given
    setupAuthStore();
    setupInterviewerStore([]);

    // when
    renderPage();

    // expect
    expect(screen.getByText("考試管理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "建立考試" })).toBeEnabled();
  });

  it("shows all 4 status tabs", () => {
    // given
    setupAuthStore();
    setupInterviewerStore([]);

    // when
    renderPage();

    // expect
    expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "進行中" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "待考" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已結束" })).toBeInTheDocument();
  });

  it("shows loading state immediately on mount", () => {
    // given
    setupAuthStore();
    mockUseInterviewerStore.mockImplementation((sel: any) =>
      sel({ results: [], setResults: vi.fn() })
    );
    mockGetExamSessions.mockReturnValue(new Promise(() => {})); // never resolves

    // when
    renderPage();

    // expect
    expect(screen.getByText("載入中...")).toBeInTheDocument();
  });

  it("shows empty state after API returns no sessions", async () => {
    // given
    setupAuthStore();
    setupInterviewerStore([]);
    mockGetExamSessions.mockResolvedValue([]);

    // when
    renderPage();

    // expect
    await waitFor(() =>
      expect(screen.getByText("目前沒有考試紀錄")).toBeInTheDocument()
    );
  });

  it("displays session card with candidate display name and status badge", async () => {
    // given
    setupAuthStore();
    setupInterviewerStore([mockSessionResult]); // in_progress, "Alice Chen"

    // when
    renderPage();

    // expect
    expect(await screen.findByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getAllByText("進行中").length).toBeGreaterThanOrEqual(1);
  });

  it("shows exam date for in_progress sessions", async () => {
    // given
    setupAuthStore();
    setupInterviewerStore([mockSessionResult]);

    // when
    renderPage();

    // expect
    expect(await screen.findByText(/測驗日期：/)).toBeInTheDocument();
  });

  it("shows score for submitted sessions", async () => {
    // given
    setupAuthStore();
    setupInterviewerStore([mockSubmittedResult]);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("75 / 100 分")).toBeInTheDocument();
  });

  it("falls back to username when displayName is null", async () => {
    // given
    setupAuthStore();
    const noDisplayName: SessionResult = {
      ...mockNotStartedResult,
      candidate: { id: 5, username: "candidate_20260509_001", displayName: null },
    };
    setupInterviewerStore([noDisplayName]);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("candidate_20260509_001")).toBeInTheDocument();
  });

  it("clicking 查看結果 navigates to /result/:id", async () => {
    // given
    setupAuthStore();
    setupInterviewerStore([mockSessionResult]); // id=2
    renderPage();

    // when
    await userEvent.click(await screen.findByRole("button", { name: "查看結果" }));

    // expect
    expect(mockNavigate).toHaveBeenCalledWith("/result/2");
  });

  it("進行中 tab filters to only in_progress sessions", async () => {
    // given
    setupAuthStore();
    setupInterviewerStore([mockNotStartedResult, mockSessionResult]); // not_started + in_progress
    renderPage();

    // when
    await userEvent.click(screen.getByRole("button", { name: "進行中" }));

    // expect
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();        // in_progress → visible
    expect(screen.queryByText("David Chang")).not.toBeInTheDocument(); // not_started → hidden
  });

  it("待考 tab filters to only not_started sessions", async () => {
    // given
    setupAuthStore();
    setupInterviewerStore([mockNotStartedResult, mockSessionResult]);
    renderPage();

    // when
    await userEvent.click(screen.getByRole("button", { name: "待考" }));

    // expect
    expect(screen.getByText("David Chang")).toBeInTheDocument();
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
  });

  it("已結束 tab shows submitted and expired sessions", async () => {
    // given
    const expiredResult: SessionResult = { ...mockNotStartedResult, id: 4, status: "expired" };
    setupAuthStore();
    setupInterviewerStore([mockSubmittedResult, expiredResult, mockSessionResult]);
    renderPage();

    // when
    await userEvent.click(screen.getByRole("button", { name: "已結束" }));

    // expect
    expect(screen.getByText("Emma Lin")).toBeInTheDocument();          // submitted → visible
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();  // in_progress → hidden
  });

  // ── Page refresh: data is re-fetched on mount ─────────────────────────────
  describe("page refresh behavior", () => {
    it("refetches sessions via API when interviewerStore is empty on mount", async () => {
      // given
      const mockSetResults = vi.fn();
      setupAuthStore();
      mockUseInterviewerStore.mockImplementation((sel: any) =>
        sel({ results: [], setResults: mockSetResults })
      );
      mockGetExamSessions.mockResolvedValue([{ id: 2 }]);
      mockGetSessionResult.mockResolvedValue(mockSessionResult);

      // when
      renderPage();

      // expect
      await waitFor(() => {
        expect(mockGetExamSessions).toHaveBeenCalledTimes(1);
        expect(mockGetSessionResult).toHaveBeenCalledWith(2);
        expect(mockSetResults).toHaveBeenCalledWith([mockSessionResult]);
      });
    });

    it("shows loading while fetch is in flight and data after fetch completes", async () => {
      // given
      const mockSetResults = vi.fn();
      let resolveExamSessions!: (v: unknown) => void;
      setupAuthStore();
      mockUseInterviewerStore.mockImplementation((sel: any) =>
        sel({ results: [], setResults: mockSetResults })
      );
      mockGetExamSessions.mockReturnValue(
        new Promise((resolve) => { resolveExamSessions = resolve; })
      );

      // when
      renderPage();

      // expect: loading shown during fetch
      expect(screen.getByText("載入中...")).toBeInTheDocument();

      // when: fetch resolves
      resolveExamSessions([]);

      // expect: loading hidden after fetch
      await waitFor(() =>
        expect(screen.queryByText("載入中...")).not.toBeInTheDocument()
      );
    });
  });

  it("logout: opens menu → clicks Log out → calls logout and navigates to /login", async () => {
    // given
    setupAuthStore();
    setupInterviewerStore([]);
    renderPage();

    // when
    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    await userEvent.click(screen.getByText("Log out"));

    // expect
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });
});
