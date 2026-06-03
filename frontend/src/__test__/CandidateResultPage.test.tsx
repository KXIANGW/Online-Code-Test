import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CandidateResultPage from "../pages/CandidateResultPage";
import type {
  JudgeResultMessage,
  SessionResult,
  SubmissionStatusMessage,
  SubmissionSummary,
  SubmissionDetail,
} from "../types";

const mockGetSessionResult = vi.hoisted(() => vi.fn());
const mockGetSubmissionDetail = vi.hoisted(() => vi.fn());
const mockListSessionSubmissions = vi.hoisted(() => vi.fn());
const mockUseJudgeSocket = vi.hoisted(() => vi.fn());

vi.mock("../api/client", () => ({
  getSessionResult: mockGetSessionResult,
  getSubmissionDetail: mockGetSubmissionDetail,
  listSessionSubmissions: mockListSessionSubmissions,
}));

vi.mock("../hooks/useJudgeSocket", () => ({
  useJudgeSocket: mockUseJudgeSocket,
}));

vi.mock("../components/NavBar", () => ({
  NavBar: ({ homeHref }: { homeHref: string }) => <nav data-testid="navbar" data-home={homeHref} />,
}));

const sessionResult: SessionResult = {
  id: 42,
  candidate: { id: 1, username: "candidate01", displayName: "Alice Chen" },
  status: "submitted",
  actualStartAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-01T01:00:00.000Z",
  submittedAt: "2026-01-01T00:30:00.000Z",
  totalScore: 50,
  maxScore: 100,
  problems: [
    {
      examSessionProblemId: 101,
      problemId: 1,
      problemTitle: "Two Sum",
      orderIndex: 1,
      scoreWeight: 50,
      score: 50,
      latestStatus: "AC",
      latestSubmissionId: 9001,
      finalSubmissionId: 9001,
      language: "python3",
      runtimeMs: 12,
      memoryKb: 1024,
      submittedAt: "2026-01-01T00:10:00.000Z",
      judgedAt: "2026-01-01T00:10:02.000Z",
    },
    {
      examSessionProblemId: 102,
      problemId: 2,
      problemTitle: "Binary Search",
      orderIndex: 2,
      scoreWeight: 50,
      score: 0,
      latestStatus: "pending",
      latestSubmissionId: 9002,
      finalSubmissionId: null,
      language: "cpp17",
      runtimeMs: null,
      memoryKb: null,
      submittedAt: "2026-01-01T00:20:00.000Z",
      judgedAt: null,
    },
  ],
};

const submissions: SubmissionSummary[] = [
  {
    id: 8999,
    examSessionProblemId: 101,
    problemId: 1,
    problemTitle: "Practice Run",
    orderIndex: 1,
    language: "python3",
    submissionType: "simple",
    status: "done",
    verdict: "WA",
    runtimeMs: 22,
    memoryKb: 1024,
    submittedAt: "2026-01-01T00:09:00.000Z",
    judgedAt: "2026-01-01T00:09:02.000Z",
    score: 0,
    scoreWeight: 50,
    isFinalSubmission: false,
  },
  {
    id: 9001,
    examSessionProblemId: 101,
    problemId: 1,
    problemTitle: "Two Sum",
    orderIndex: 1,
    language: "python3",
    submissionType: "formal",
    status: "done",
    verdict: "AC",
    runtimeMs: 12,
    memoryKb: 1024,
    submittedAt: "2026-01-01T00:10:00.000Z",
    judgedAt: "2026-01-01T00:10:02.000Z",
    score: 50,
    scoreWeight: 50,
    isFinalSubmission: true,
  },
  {
    id: 9002,
    examSessionProblemId: 102,
    problemId: 2,
    problemTitle: "Binary Search",
    orderIndex: 2,
    language: "cpp17",
    submissionType: "formal",
    status: "pending",
    verdict: null,
    runtimeMs: null,
    memoryKb: null,
    submittedAt: "2026-01-01T00:20:00.000Z",
    judgedAt: null,
    score: 0,
    scoreWeight: 50,
    isFinalSubmission: false,
  },
];

const submissionDetail: SubmissionDetail = {
  ...submissions[1]!,
  sourceCode: "print('ok')",
  testcaseResults: [
    {
      id: 1,
      testcaseId: 1,
      orderIndex: 1,
      isPublic: true,
      verdict: "AC",
      runtimeMs: 12,
      memoryKb: 1024,
      actualOutput: "ok",
    },
    {
      id: 2,
      testcaseId: 2,
      orderIndex: 2,
      isPublic: false,
      verdict: "WA",
      runtimeMs: 18,
      memoryKb: 2048,
    },
  ],
};

async function renderPage() {
  render(
    <MemoryRouter initialEntries={["/exam/42/result"]}>
      <Routes>
        <Route path="/exam/:id/result" element={<CandidateResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
}

describe("CandidateResultPage", () => {
  let realtimeHandler:
    | ((message: JudgeResultMessage | SubmissionStatusMessage) => void)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionResult.mockResolvedValue(sessionResult);
    mockGetSubmissionDetail.mockResolvedValue(submissionDetail);
    mockListSessionSubmissions.mockResolvedValue(submissions);
    mockUseJudgeSocket.mockImplementation(
      (
        _sessionId: number,
        onMessage: (message: JudgeResultMessage | SubmissionStatusMessage) => void,
      ) => {
        realtimeHandler = onMessage;
      },
    );
  });

  it("renders candidate-visible summary using the interviewer result format", async () => {
    await renderPage();

    expect(screen.getByTestId("navbar")).toHaveAttribute("data-home", "/candidate");
    expect(screen.getByText("已交卷")).toBeInTheDocument();
    expect(screen.getByText("50 / 100")).toBeInTheDocument();
    expect(screen.getAllByText("1. Two Sum")).toHaveLength(2);
    expect(screen.getAllByText("2. Binary Search")).toHaveLength(2);
    expect(screen.getAllByText("正式")).toHaveLength(2);
    expect(screen.getByText("最終提交")).toBeInTheDocument();
    expect(screen.queryByText("Practice Run")).not.toBeInTheDocument();
  });

  it("expands candidate history details with public and hidden testcase verdicts", async () => {
    await renderPage();

    await screen.findByRole("button", { name: "查看詳細測資：提交 9001" });
    await act(async () => {
      screen.getByRole("button", { name: "查看詳細測資：提交 9001" }).click();
    });

    expect(await screen.findByText("公開測資 1")).toBeInTheDocument();
    expect(screen.getByText("隱藏測資 2")).toBeInTheDocument();
    expect(mockGetSubmissionDetail).toHaveBeenCalledWith(42, 9001);
  });

  it("shows final-submission tag even when the formal final submission has score 0", async () => {
    mockListSessionSubmissions.mockResolvedValue([
      {
        ...submissions[1]!,
        verdict: "WA",
        score: 0,
        isFinalSubmission: true,
      },
    ]);

    await renderPage();

    expect(screen.getByText("WA")).toBeInTheDocument();
    expect(screen.getByText("最終提交")).toBeInTheDocument();
  });

  it("shows loading state while fetching history submission detail", async () => {
    // given: make getSubmissionDetail hang indefinitely
    let resolveDetail!: (v: SubmissionDetail) => void;
    mockGetSubmissionDetail.mockReturnValue(
      new Promise<SubmissionDetail>((resolve) => {
        resolveDetail = resolve;
      }),
    );
    await renderPage();

    // when
    await act(async () => {
      screen.getByRole("button", { name: "查看詳細測資：提交 9001" }).click();
    });

    // expect
    expect(screen.getByText("載入詳細測資中...")).toBeInTheDocument();

    // cleanup – resolve so no dangling promise warning
    resolveDetail(submissionDetail);
  });

  it("shows error message when history submission detail fetch fails", async () => {
    // given
    mockGetSubmissionDetail.mockRejectedValue(new Error("network error"));
    await renderPage();

    // when
    await act(async () => {
      screen.getByRole("button", { name: "查看詳細測資：提交 9001" }).click();
    });

    // expect
    expect(await screen.findByText("無法載入詳細測資結果")).toBeInTheDocument();
  });

  it("shows empty state when history submission has no testcase results", async () => {
    // given
    mockGetSubmissionDetail.mockResolvedValue({ ...submissionDetail, testcaseResults: [] });
    await renderPage();

    // when
    await act(async () => {
      screen.getByRole("button", { name: "查看詳細測資：提交 9001" }).click();
    });

    // expect
    expect(await screen.findByText("無詳細測資結果")).toBeInTheDocument();
  });

  it("shows dash for runtime and memory when testcase verdict is skipped", async () => {
    // given
    mockGetSubmissionDetail.mockResolvedValue({
      ...submissionDetail,
      testcaseResults: [
        {
          id: 1,
          testcaseId: 1,
          orderIndex: 1,
          isPublic: true,
          verdict: "skipped",
          runtimeMs: null,
          memoryKb: null,
        },
      ],
    });
    await renderPage();

    // when
    await act(async () => {
      screen.getByRole("button", { name: "查看詳細測資：提交 9001" }).click();
    });

    // expect: both runtime and memory columns display "—"
    const dashes = await screen.findAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("shows dash for runtime and memory when runtimeMs and memoryKb are null", async () => {
    // given: non-skipped verdict but null timing values
    mockGetSubmissionDetail.mockResolvedValue({
      ...submissionDetail,
      testcaseResults: [
        {
          id: 1,
          testcaseId: 1,
          orderIndex: 1,
          isPublic: true,
          verdict: "WA",
          runtimeMs: null,
          memoryKb: null,
        },
      ],
    });
    await renderPage();

    // when
    await act(async () => {
      screen.getByRole("button", { name: "查看詳細測資：提交 9001" }).click();
    });

    // expect
    const dashes = await screen.findAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("updates pending history rows when lifecycle events arrive", async () => {
    await renderPage();

    act(() => {
      realtimeHandler?.({
        type: "submission_status",
        submissionId: 9002,
        sessionId: 42,
        status: "judging",
        judgedAt: null,
      });
    });

    expect(screen.getByText("judging")).toBeInTheDocument();
  });

  it("judge_result message updates verdict and score in the history list", async () => {
    // given
    await renderPage();

    // when: formal judge_result arrives for the pending submission
    act(() => {
      realtimeHandler?.({
        type: "judge_result",
        submissionId: 9002,
        examSessionProblemId: 102,
        sessionId: 42,
        status: "done",
        verdict: "WA",
        runtimeMs: 30,
        memoryKb: 2048,
        judgedAt: "2026-01-01T00:20:05.000Z",
        submissionType: "formal",
        score: 0,
        testcaseResults: [],
      });
    });

    // expect: history row for submission 9002 now shows verdict WA
    await waitFor(() => expect(screen.getByText("WA")).toBeInTheDocument());
  });

  it("shows 未作答 when a problem has no submission", async () => {
    // given: one problem with no_submission status
    mockGetSessionResult.mockResolvedValue({
      ...sessionResult,
      problems: [
        {
          ...sessionResult.problems[0]!,
          latestStatus: "no_submission",
          latestSubmissionId: null,
          finalSubmissionId: null,
          score: 0,
          runtimeMs: null,
          memoryKb: null,
          submittedAt: null,
          judgedAt: null,
        },
      ],
    });

    // when
    await renderPage();

    // expect
    expect(screen.getByText("未作答")).toBeInTheDocument();
  });

  it("expands problem detail and shows testcase table", async () => {
    // given: problem 1 has finalSubmissionId 9001 → "查看詳情 ▶" available
    await renderPage();

    // when: click the problem section expand button
    await act(async () => {
      screen.getByRole("button", { name: "查看詳情 ▶" }).click();
    });

    // expect: testcase rows appear (submissionDetail has 2 testcases)
    expect(await screen.findByText("公開測資 1")).toBeInTheDocument();
    expect(screen.getByText("隱藏測資 2")).toBeInTheDocument();
    expect(mockGetSubmissionDetail).toHaveBeenCalledWith(42, 9001);
  });

  it("shows error when problem detail fetch fails", async () => {
    // given
    mockGetSubmissionDetail.mockRejectedValue(new Error("network error"));
    await renderPage();

    // when
    await act(async () => {
      screen.getByRole("button", { name: "查看詳情 ▶" }).click();
    });

    // expect
    expect(await screen.findByText("無法載入測資結果")).toBeInTheDocument();
  });

  it("shows 尚無提交紀錄 when submission list is empty", async () => {
    // given
    mockListSessionSubmissions.mockResolvedValue([]);

    // when
    await renderPage();

    // expect
    expect(screen.getByText("尚無提交紀錄")).toBeInTheDocument();
  });
});
