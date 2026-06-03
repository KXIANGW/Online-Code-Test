import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ExamResultPage from "../pages/ExamResultPage";
import { mockSessionResult, mockSubmissionDetail, mockSubmissions } from "./mock-data";
import type { SessionResult } from "../types";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUseAuthStore = vi.hoisted(() => vi.fn());
const mockGetSessionResult = vi.hoisted(() => vi.fn());
const mockGetSubmissionDetail = vi.hoisted(() => vi.fn());
const mockListSessionSubmissions = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../stores/authStore", () => ({ useAuthStore: mockUseAuthStore }));
vi.mock("../api/client", () => ({
  getSessionResult: mockGetSessionResult,
  getSubmissionDetail: mockGetSubmissionDetail,
  listSessionSubmissions: mockListSessionSubmissions,
}));

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
      sel({ username, logout: mockLogout }),
  );
}

/** Render the page under the /result/:id route so useParams() receives the id. */
function renderPage(id = "2") {
  return render(
    <MemoryRouter initialEntries={[`/result/${id}`]}>
      <Routes>
        <Route path="/result/:id" element={<ExamResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Render the page on a route that provides no `:id` param. */
function renderPageNoId() {
  return render(
    <MemoryRouter initialEntries={["/result"]}>
      <Routes>
        <Route path="/result" element={<ExamResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("ExamResultPage()", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockLogout.mockReset();
    mockUseAuthStore.mockReset();
    mockGetSessionResult.mockReset();
    mockGetSubmissionDetail.mockReset();
    mockListSessionSubmissions.mockReset();
    mockListSessionSubmissions.mockResolvedValue([]);
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
    await waitFor(() => expect(screen.getByText("無法載入考試結果")).toBeInTheDocument());
    expect(screen.queryByText("載入中...")).not.toBeInTheDocument();
  });

  it("hides loading state after a successful fetch", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockSessionResult);

    // when
    renderPage();

    // expect
    await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
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
    mockGetSessionResult.mockResolvedValue({
      ...mockSessionResult,
      status: "in_progress",
    });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("進行中")).toBeInTheDocument();
  });

  it("renders 已交卷 badge for submitted session", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({
      ...mockSessionResult,
      status: "submitted",
    });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("已交卷")).toBeInTheDocument();
  });

  it("renders 待考 badge for not_started session", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({
      ...mockSessionResult,
      status: "not_started",
    });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("待考")).toBeInTheDocument();
  });

  it("renders 已逾時 badge for expired session", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({
      ...mockSessionResult,
      status: "expired",
    });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("已逾時")).toBeInTheDocument();
  });

  it("renders 已取消 badge for cancelled session", async () => {
    // given
    mockGetSessionResult.mockResolvedValue({
      ...mockSessionResult,
      status: "cancelled",
    });

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
    mockGetSessionResult.mockResolvedValue({
      ...mockSessionResult,
      totalScore: 0,
      maxScore: 80,
    });

    // when
    renderPage();

    // expect
    expect(await screen.findByText("0 / 80")).toBeInTheDocument();
  });

  it("loads and renders submission history for the interviewer", async () => {
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    mockListSessionSubmissions.mockResolvedValue(mockSubmissions);

    renderPage();

    expect(await screen.findByText("提交紀錄")).toBeInTheDocument();
    expect(screen.queryByText("一般")).not.toBeInTheDocument();
    expect(screen.getByText("正式")).toBeInTheDocument();
    expect(screen.getByText("最終提交")).toBeInTheDocument();
  });

  it("expands a history item and shows public and hidden testcase results", async () => {
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    mockListSessionSubmissions.mockResolvedValue(mockSubmissions);
    mockGetSubmissionDetail.mockResolvedValue(mockSubmissionDetail);

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "查看詳細測資：提交 2" }));

    expect(await screen.findByText("公開測資 1")).toBeInTheDocument();
    expect(screen.getByText("公開測資 2")).toBeInTheDocument();
    expect(screen.getByText("隱藏測資 3")).toBeInTheDocument();
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
    await waitFor(() => expect(mockGetSessionResult).toHaveBeenCalledWith(42));
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
      "/interviewer",
    );
  });

  // ── Testcase detail accordion ────────────────────────────────────────────────

  describe("testcase detail accordion", () => {
    it("renders 查看詳情 button only for problems that have a final submission", async () => {
      // given: Two Sum has finalSubmissionId=2, Valid Parentheses has finalSubmissionId=null
      mockGetSessionResult.mockResolvedValue(mockSessionResult);

      // when
      renderPage();
      await screen.findByText(/Two Sum/);

      // expect: exactly 1 button (Valid Parentheses has no finalSubmissionId → no button)
      expect(screen.getAllByRole("button", { name: "查看詳情 ▶" })).toHaveLength(1);
    });

    it("clicking 查看詳情 ▶ calls getSubmissionDetail with correct sessionId and submissionId", async () => {
      // given
      const user = userEvent.setup();
      mockGetSessionResult.mockResolvedValue(mockSessionResult);
      mockGetSubmissionDetail.mockResolvedValue(mockSubmissionDetail);
      renderPage();
      await screen.findByText(/Two Sum/);

      // when
      await user.click(screen.getByRole("button", { name: "查看詳情 ▶" }));

      // expect: sessionId=2 (from URL /result/2), finalSubmissionId=2
      await waitFor(() => expect(mockGetSubmissionDetail).toHaveBeenCalledWith(2, 2));
    });

    it("shows 載入測資中... while getSubmissionDetail is in flight", async () => {
      // given
      const user = userEvent.setup();
      mockGetSessionResult.mockResolvedValue(mockSessionResult);
      mockGetSubmissionDetail.mockReturnValue(new Promise(() => {})); // never resolves
      renderPage();
      await screen.findByText(/Two Sum/);

      // when
      await user.click(screen.getByRole("button", { name: "查看詳情 ▶" }));

      // expect
      expect(screen.getByText("載入測資中...")).toBeTruthy();
    });

    it("shows 無法載入測資結果 when getSubmissionDetail rejects", async () => {
      // given
      const user = userEvent.setup();
      mockGetSessionResult.mockResolvedValue(mockSessionResult);
      mockGetSubmissionDetail.mockRejectedValue(new Error("Server error"));
      renderPage();
      await screen.findByText(/Two Sum/);

      // when
      await user.click(screen.getByRole("button", { name: "查看詳情 ▶" }));

      // expect
      await waitFor(() => expect(screen.getByText("無法載入測資結果")).toBeTruthy());
    });

    it("renders public and hidden testcase rows with verdict and runtime after successful fetch", async () => {
      // given: mockSubmissionDetail has 2 public testcaseResults and 1 hidden testcaseResult
      const user = userEvent.setup();
      mockGetSessionResult.mockResolvedValue(mockSessionResult);
      mockGetSubmissionDetail.mockResolvedValue(mockSubmissionDetail);
      renderPage();
      await screen.findByText(/Two Sum/);

      // when
      await user.click(screen.getByRole("button", { name: "查看詳情 ▶" }));

      // expect: public and hidden testcase verdicts are all visible
      await screen.findByText("公開測資 1");
      expect(screen.getByText("公開測資 2")).toBeInTheDocument();
      expect(screen.getByText("隱藏測資 3")).toBeInTheDocument();
      expect(screen.getByText("45 ms")).toBeTruthy();
    });

    it("clicking 收合 ▲ hides the testcase detail panel", async () => {
      // given
      const user = userEvent.setup();
      mockGetSessionResult.mockResolvedValue(mockSessionResult);
      mockGetSubmissionDetail.mockResolvedValue(mockSubmissionDetail);
      renderPage();
      await screen.findByText(/Two Sum/);
      await user.click(screen.getByRole("button", { name: "查看詳情 ▶" }));
      await screen.findByText("隱藏測資 3");

      // when
      await user.click(screen.getByRole("button", { name: "收合 ▲" }));

      // expect
      expect(screen.queryByText("隱藏測資 3")).toBeFalsy();
    });

    it("re-expanding an already fetched problem does not call getSubmissionDetail again", async () => {
      // given
      const user = userEvent.setup();
      mockGetSessionResult.mockResolvedValue(mockSessionResult);
      mockGetSubmissionDetail.mockResolvedValue(mockSubmissionDetail);
      renderPage();
      await screen.findByText(/Two Sum/);
      await user.click(screen.getByRole("button", { name: "查看詳情 ▶" }));
      await screen.findByText("隱藏測資 3");
      await user.click(screen.getByRole("button", { name: "收合 ▲" }));

      // when
      await user.click(screen.getByRole("button", { name: "查看詳情 ▶" }));

      // expect: fetched only once; results re-render from cache
      expect(mockGetSubmissionDetail).toHaveBeenCalledTimes(1);
      expect(screen.getByText("隱藏測資 3")).toBeTruthy();
    });

    it("feat: supports expanding multiple problem details simultaneously without closing others", async () => {
      // Given
      const user = userEvent.setup();
      const mockResultTwoSubmissions: SessionResult = {
        ...mockSessionResult,
        problems: [
          {
            ...mockSessionResult.problems[0]!,
            examSessionProblemId: 101,
            finalSubmissionId: 10,
            problemTitle: "Problem A",
          },
          {
            ...mockSessionResult.problems[1]!,
            examSessionProblemId: 102,
            finalSubmissionId: 11,
            problemTitle: "Problem B",
          },
        ],
      };

      mockGetSessionResult.mockResolvedValue(mockResultTwoSubmissions);

      // 模擬 API：讓不同的 submissionId 回傳可辨識的 runtimeMs
      // isPublic: false 確保隱藏測資 filter 不會過濾掉這筆測試資料
      mockGetSubmissionDetail.mockImplementation(async (sessionId, submissionId) => ({
        ...mockSubmissionDetail,
        testcaseResults: [
          {
            ...mockSubmissionDetail.testcaseResults[0]!,
            isPublic: false,
            id: submissionId * 100,
            runtimeMs: submissionId,
          },
        ],
      }));

      renderPage();

      const buttons = await screen.findAllByRole("button", {
        name: "查看詳情 ▶",
      });

      // When
      await user.click(buttons[0]!); // 展開 Problem A (submissionId: 10)
      await user.click(buttons[1]!); // 展開 Problem B (submissionId: 11)

      // Expect
      // 1. 驗證兩組詳情內的獨特數據是否同時存在 (10 ms 來自 A, 11 ms 來自 B)
      await waitFor(() => {
        expect(screen.getByText("10 ms")).toBeInTheDocument();
        expect(screen.getByText("11 ms")).toBeInTheDocument();
      });

      // 2. 驗證收合按鈕數量
      expect(screen.getAllByRole("button", { name: "收合 ▲" })).toHaveLength(2);

      // 3. 驗證 API 呼叫
      expect(mockGetSubmissionDetail).toHaveBeenCalledTimes(2);
    });
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
        sel({ username: null, logout: mockLogout }),
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

  it("collapses an expanded history submission detail on second click", async () => {
    // given: expand submission 2
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    mockListSessionSubmissions.mockResolvedValue(mockSubmissions);
    mockGetSubmissionDetail.mockResolvedValue(mockSubmissionDetail);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "查看詳細測資：提交 2" }));
    await screen.findByText("公開測資 1");

    // when: click again to collapse
    await userEvent.click(screen.getByRole("button", { name: "查看詳細測資：提交 2" }));

    // expect: detail rows hidden
    expect(screen.queryByText("公開測資 1")).not.toBeInTheDocument();
  });

  it("shows dash for runtime in problem final submission when testcase verdict is skipped", async () => {
    // given: final submission has a skipped testcase
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    mockGetSubmissionDetail.mockResolvedValue({
      ...mockSubmissionDetail,
      testcaseResults: [
        { id: 1, testcaseId: 1, orderIndex: 1, isPublic: true, verdict: "skipped", runtimeMs: null, memoryKb: null },
      ],
    });
    renderPage();

    // when: expand the problem detail
    await userEvent.click(await screen.findByRole("button", { name: "查看詳情 ▶" }));

    // expect: runtime and memory show "—"
    const dashes = await screen.findAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("shows error state in history submission detail when fetch fails", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    mockListSessionSubmissions.mockResolvedValue(mockSubmissions);
    mockGetSubmissionDetail.mockRejectedValue(new Error("network error"));
    renderPage();

    // when
    await userEvent.click(await screen.findByRole("button", { name: "查看詳細測資：提交 2" }));

    // expect
    expect(await screen.findByText("無法載入詳細測資結果")).toBeInTheDocument();
  });

  it("shows empty state in history submission detail when testcaseResults is empty", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    mockListSessionSubmissions.mockResolvedValue(mockSubmissions);
    mockGetSubmissionDetail.mockResolvedValue({ ...mockSubmissionDetail, testcaseResults: [] });
    renderPage();

    // when
    await userEvent.click(await screen.findByRole("button", { name: "查看詳細測資：提交 2" }));

    // expect
    expect(await screen.findByText("無詳細測資結果")).toBeInTheDocument();
  });

  it("shows dash for runtime and memory in history detail when verdict is skipped", async () => {
    // given
    mockGetSessionResult.mockResolvedValue(mockSessionResult);
    mockListSessionSubmissions.mockResolvedValue(mockSubmissions);
    mockGetSubmissionDetail.mockResolvedValue({
      ...mockSubmissionDetail,
      testcaseResults: [
        { id: 1, testcaseId: 1, orderIndex: 1, isPublic: true, verdict: "skipped", runtimeMs: null, memoryKb: null },
      ],
    });
    renderPage();

    // when
    await userEvent.click(await screen.findByRole("button", { name: "查看詳細測資：提交 2" }));

    // expect: both runtime and memory show "—"
    const dashes = await screen.findAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
