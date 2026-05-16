import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CandidateResultPage from "../pages/CandidateResultPage";
import type {
  JudgeResultMessage,
  SessionResult,
  SubmissionStatusMessage,
  SubmissionSummary,
} from "../types";

const mockGetSessionResult = vi.hoisted(() => vi.fn());
const mockListSessionSubmissions = vi.hoisted(() => vi.fn());
const mockUseJudgeSocket = vi.hoisted(() => vi.fn());

vi.mock("../api/client", () => ({
  getSessionResult: mockGetSessionResult,
  listSessionSubmissions: mockListSessionSubmissions,
}));

vi.mock("../hooks/useJudgeSocket", () => ({
  useJudgeSocket: mockUseJudgeSocket,
}));

vi.mock("../components/NavBar", () => ({
  NavBar: ({ homeHref }: { homeHref: string }) => (
    <nav data-testid="navbar" data-home={homeHref} />
  ),
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

  it("renders candidate-visible summary without testcase details", async () => {
    await renderPage();

    expect(screen.getByTestId("navbar")).toHaveAttribute("data-home", "/candidate");
    expect(screen.getByText("已交卷")).toBeInTheDocument();
    expect(screen.getByText("50 / 100")).toBeInTheDocument();
    expect(screen.getAllByText("1. Two Sum")).toHaveLength(2);
    expect(screen.getAllByText("2. Binary Search")).toHaveLength(2);
    expect(screen.queryByText(/測資/)).not.toBeInTheDocument();
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
});
