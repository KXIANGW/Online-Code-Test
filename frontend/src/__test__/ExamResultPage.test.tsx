import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ExamResultPage from "../pages/ExamResultPage";
import { mockSessionResult } from "./mock-data";
import type { SessionResult } from "../types";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockGetSessionResult = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../api/client", () => ({ getSessionResult: mockGetSessionResult }));

// ── Extra fixture data ────────────────────────────────────────────────────────
const mockResultNoDisplayName: SessionResult = {
  ...mockSessionResult,
  candidate: { id: 1, username: "cand_20260509_001", displayName: null },
};

const mockResultNoDate: SessionResult = {
  ...mockSessionResult,
  actualStartAt: null,
};

const mockResultEmptyProblems: SessionResult = {
  ...mockSessionResult,
  problems: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function setupAuthStore(username = "alice") {
  mockUseAuthStore.mockImplementation(
    (sel: (s: { username: string; logout: typeof mockLogout }) => unknown) =>
      sel({ username, logout: mockLogout })
  );
}

/** Render the page under the /result/:id route so useParams() receives the id. */
function renderPage(id = "2") {
  return render(
    <MemoryRouter initialEntries={[`/result/${id}`]}>
      <Routes>
        <Route path="/result/:id" element={<ExamResultPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/** Render the page on a route that provides no `:id` param. */
function renderPageNoId() {
  return render(
    <MemoryRouter initialEntries={["/result"]}>
      <Routes>
        <Route path="/result" element={<ExamResultPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("ExamResultPage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockGetSessionResult.mockReset();
    setupAuthStore();
  });

  // ── Loading & error states ────────────────────────────────────────────────

  it("shows 載入中... while API request is in flight", () => {
    // given
    mockGetSessionResult.mockReturnValue(new Promise(() => {})); // never resolves

    // when
    renderPage();

    // expect
    expect(screen.getByText("載入中...")).toBeInTheDocument();
  });

  it("shows error message when API rejects", async () => {
    // given
    mockGetSessionResult.mockRejectedValue(new Error("Not Found"));

    // when
    renderPage();

    // expect
    await waitFor(() =>
      expect(screen.getByText("無法載入考試結果")).toBeInTheDocument()
    );
    expect(screen.queryByText("載入中...")).not.toBeInTheDocument();
  });

  it("hides loading state after a successful fetch", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage();

    // expect
    await waitFor(() =>
      expect(screen.queryByText("載入中...")).not.toBeInTheDocument()
    );
  });

  // ── Candidate info ────────────────────────────────────────────────────────

  it("renders candidate displayName and @username after fetch", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("@candidate01")).toBeInTheDocument();
  });

  it("falls back to username when displayName is null", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockResultNoDisplayName);

    // when
    renderPage();

    // expect: primary name is username when displayName is absent
    expect(await screen.findByText("cand_20260509_001")).toBeInTheDocument();
    expect(screen.getByText("@cand_20260509_001")).toBeInTheDocument();
  });

  // ── Status badge ──────────────────────────────────────────────────────────

  it("renders 進行中 badge for in_progress session", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({ ...mockSessionResult, status: "in_progress" });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("進行中")).toBeInTheDocument();
  });

  it("renders 已交卷 badge for submitted session", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({ ...mockSessionResult, status: "submitted" });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("已交卷")).toBeInTheDocument();
  });

  it("renders 待考 badge for not_started session", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({ ...mockSessionResult, status: "not_started" });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("待考")).toBeInTheDocument();
  });

  it("renders 已逾時 badge for expired session", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({ ...mockSessionResult, status: "expired" });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("已逾時")).toBeInTheDocument();
  });

  it("renders 已取消 badge for cancelled session", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({ ...mockSessionResult, status: "cancelled" });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("已取消")).toBeInTheDocument();
  });

  // ── Score display ─────────────────────────────────────────────────────────

  it("displays total score as 'totalScore / maxScore'", async () => {
    // given: totalScore=50, maxScore=100
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("50 / 100")).toBeInTheDocument();
  });

  it("displays 0 / maxScore for a session with no earned score", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({ ...mockSessionResult, totalScore: 0, maxScore: 80 });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("0 / 80")).toBeInTheDocument();
  });

  // ── Exam date ─────────────────────────────────────────────────────────────

  it("shows 測驗日期 when actualStartAt is present", async () => {
    // given: session has actualStartAt
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage();

    // expect
    expect(await screen.findByText(/測驗日期：/)).toBeInTheDocument();
  });

  it("does not show 測驗日期 when actualStartAt is null", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockResultNoDate);

    // when
    renderPage();

    // expect
    await screen.findByText("Alice Chen"); // wait for data to render
    expect(screen.queryByText(/測驗日期：/)).not.toBeInTheDocument();
  });

  // ── Problems list ─────────────────────────────────────────────────────────

  it("renders all problems by title", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage();

    // expect
    expect(await screen.findByText(/Two Sum/)).toBeInTheDocument();
    expect(screen.getByText(/Valid Parentheses/)).toBeInTheDocument();
  });

  it("shows 未作答 for problems with no_submission status", async () => {
    // given: mockSessionResult.problems[1] has latestStatus="no_submission"
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("未作答")).toBeInTheDocument();
  });

  it("shows raw verdict text for attempted problems (AC)", async () => {
    // given: mockSessionResult.problems[0] has latestStatus="AC"
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("AC")).toBeInTheDocument();
  });

  it("shows WA verdict text as-is for a wrong-answer submission", async () => {
    // given
    const withWa: SessionResult = {
      ...mockSessionResult,
      problems: [{ ...mockSessionResult.problems[0]!, latestStatus: "WA" }],
    };
    mockGetSessionResult.mockResolvedValue(withWa);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("WA")).toBeInTheDocument();
  });

  it("renders per-problem score in 'score / scoreWeight 分' format", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage();

    // expect: Two Sum: 50 / 50 分 — Valid Parentheses: 0 / 50 分
    expect(await screen.findByText("50 / 50 分")).toBeInTheDocument();
    expect(screen.getByText("0 / 50 分")).toBeInTheDocument();
  });

  it("renders 題目結果 section header even when problems array is empty", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockResultEmptyProblems);

    // when
    renderPage();

    // expect
    expect(await screen.findByText("題目結果")).toBeInTheDocument();
    expect(screen.queryByText(/1\./)).not.toBeInTheDocument();
  });

  // ── API call correctness ──────────────────────────────────────────────────

  it("calls getSessionResult with the numeric id parsed from the URL", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage("42");

    // expect
    await waitFor(() =>
      expect(mockGetSessionResult).toHaveBeenCalledWith(42)
    );
  });

  it("does not call getSessionResult when URL provides no id param", () => {
    // given: route has no :id segment

    // when
    renderPageNoId();

    // expect: no fetch, loading stays true indefinitely
    expect(mockGetSessionResult).not.toHaveBeenCalled();
    expect(screen.getByText("載入中...")).toBeInTheDocument();
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  it("back button calls navigate('/interviewer') on click", async () => {
    // given
    mockGetSessionResult.mockReturnValue(new Promise(() => {}));
    renderPage();

    // when
    await userEvent.click(screen.getByText("← 返回考試管理"));

    // expect
    expect(mockNavigate).toHaveBeenCalledWith("/interviewer");
  });

  it("brand link in navbar points to /interviewer", () => {
    // given
    mockGetSessionResult.mockReturnValue(new Promise(() => {}));

    // when
    renderPage();

    // expect
    expect(screen.getByRole("link", { name: "Online Code Test" })).toHaveAttribute(
      "href",
      "/interviewer"
    );
  });

  // ── User menu ─────────────────────────────────────────────────────────────

  it("shows the first-two-letter uppercase initials of the logged-in username", () => {
    // given
    mockGetSessionResult.mockReturnValue(new Promise(() => {}));
    setupAuthStore("alice");

    // when
    renderPage();

    // expect
    expect(screen.getByRole("button", { name: "User menu" })).toHaveTextContent("AL");
  });

  it("shows ?? as initials when username is null", () => {
    // given
    mockGetSessionResult.mockReturnValue(new Promise(() => {}));
    mockUseAuthStore.mockImplementation(
      (sel: (s: { username: null; logout: typeof mockLogout }) => unknown) =>
        sel({ username: null, logout: mockLogout })
    );

    // when
    renderPage();

    // expect
    expect(screen.getByRole("button", { name: "User menu" })).toHaveTextContent("??");
  });

  it("logout: opens menu → clicks Log out → calls logout and navigates to /login", async () => {
    // given
    mockGetSessionResult.mockReturnValue(new Promise(() => {}));
    renderPage();

    // when
    await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    await userEvent.click(screen.getByText("Log out"));

    // expect
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });
});
