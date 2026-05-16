import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ExamPage from "../pages/ExamPage";
import type {
  ExamSession,
  ExamSessionProblem,
  JudgeResultMessage,
  Language,
  SubmissionCreated,
} from "../types";
import { mockSubmissions } from "./mock-data";

// ── Hoisted mock factories ────────────────────────────────────────────────────
const mockGetExamSession         = vi.hoisted(() => vi.fn());
const mockGetExamSessionProblems = vi.hoisted(() => vi.fn());
const mockGetLanguages           = vi.hoisted(() => vi.fn());
const mockGetExamDrafts          = vi.hoisted(() => vi.fn());
const mockSaveExamDraft          = vi.hoisted(() => vi.fn());
const mockCreateSubmission       = vi.hoisted(() => vi.fn());
const mockListSessionSubmissions = vi.hoisted(() => vi.fn());
const mockSubmitExamSession      = vi.hoisted(() => vi.fn());
const mockUseJudgeSocket         = vi.hoisted(() => vi.fn());

vi.mock("../api/client", () => ({
  getExamSession:         mockGetExamSession,
  getExamSessionProblems: mockGetExamSessionProblems,
  getLanguages:           mockGetLanguages,
  getExamDrafts:          mockGetExamDrafts,
  saveExamDraft:          mockSaveExamDraft,
  createSubmission:       mockCreateSubmission,
  listSessionSubmissions: mockListSessionSubmissions,
  submitExamSession:      mockSubmitExamSession,
}));

vi.mock("../hooks/useJudgeSocket", () => ({
  useJudgeSocket: mockUseJudgeSocket,
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
    language,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
    language?: string;
  }) => (
    <textarea
      aria-label="Code editor"
      data-language={language}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock("remark-gfm", () => ({ default: () => ({}) }));

vi.mock("../components/NavBar", () => ({
  NavBar: ({ homeHref }: { homeHref: string }) => (
    <nav data-testid="navbar" data-home={homeHref} />
  ),
}));

// ── Local mock data (separate from mock-data.ts: tests expect "Binary Search") ─
const mockExamPageSession: ExamSession = {
  id: 42,
  candidateId: 1,
  createdBy: 2,
  status: "not_started",
  durationMinutes: 90,
  actualStartAt: null,
  expiresAt: null,
  submittedAt: null,
  totalScore: 0,
  maxScore: 100,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const mockExamPageProblems: ExamSessionProblem[] = [
  {
    id: 101,
    orderIndex: 1,
    scoreWeight: 50,
    score: 0,
    problemId: 1,
    title: "Two Sum",
    descriptionMd: "## Two Sum\n\nGiven an array...",
    difficulty: "easy",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    outputLimitKb: 64,
    languageLimits: [],
  },
  {
    id: 102,
    orderIndex: 2,
    scoreWeight: 50,
    score: 0,
    problemId: 2,
    title: "Binary Search",
    descriptionMd: "## Binary Search\n\nGiven a sorted array...",
    difficulty: "medium",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    outputLimitKb: 64,
    languageLimits: [],
  },
];

const mockExamPageLanguages: Language[] = [
  {
    language: "python3",
    displayName: "Python 3.11",
    timeMultiplier: "2.00",
    memoryMultiplier: "1.50",
    isEnabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  },
  {
    language: "cpp17",
    displayName: "C++ 17",
    timeMultiplier: "1.00",
    memoryMultiplier: "1.00",
    isEnabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  },
  {
    language: "java21",
    displayName: "Java 21",
    timeMultiplier: "2.00",
    memoryMultiplier: "2.00",
    isEnabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  },
];

async function renderExamPage(id = "42") {
  const result = render(
    <MemoryRouter initialEntries={[`/exam/${id}`]}>
      <Routes>
        <Route path="/exam/:id" element={<ExamPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.queryByText("載入中...")).not.toBeInTheDocument(),
  );
  return result;
}

describe("ExamPage", () => {
  let realtimeHandler: ((message: JudgeResultMessage) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetExamSession.mockResolvedValue(mockExamPageSession);
    mockGetExamSessionProblems.mockResolvedValue(mockExamPageProblems);
    mockGetLanguages.mockResolvedValue(mockExamPageLanguages);
    mockGetExamDrafts.mockResolvedValue({});
    mockSaveExamDraft.mockResolvedValue({ ok: true });
    mockListSessionSubmissions.mockResolvedValue([]);
    mockSubmitExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "submitted",
      submittedAt: "2026-01-01T00:30:00.000Z",
    });
    mockCreateSubmission.mockImplementation(
      async ({ type }): Promise<SubmissionCreated> => ({
        id: type === "simple" ? 9001 : 9002,
        examSessionProblemId: 101,
        language: "python3",
        submissionType: type,
        status: "pending",
        verdict: null,
        runtimeMs: null,
        memoryKb: null,
        submittedAt: "2026-01-01T00:10:00.000Z",
        judgedAt: null,
      }),
    );
    realtimeHandler = undefined;
    mockUseJudgeSocket.mockImplementation(
      (_sessionId: number, onJudgeResult: (message: JudgeResultMessage) => void) => {
        realtimeHandler = onJudgeResult;
      },
    );
  });

  // ── Layout ────────────────────────────────────────────────────────────────

  it("renders NavBar with /candidate homeHref", async () => {
    // given
    await renderExamPage();
    // when / expect
    expect(screen.getByTestId("navbar")).toHaveAttribute(
      "data-home",
      "/candidate",
    );
  });

  it("renders problem tabs for all placeholder problems", async () => {
    // given
    await renderExamPage();
    // when
    const tabs = screen.getAllByRole("tab");
    const problemTabs = tabs.filter(
      (t) => t.textContent?.includes("Two Sum") || t.textContent?.includes("Binary Search"),
    );
    // expect
    expect(problemTabs).toHaveLength(2);
  });

  it("renders timer with placeholder '--:--:--' when exam not started", async () => {
    // given
    await renderExamPage();
    // expect
    expect(screen.getByLabelText("倒數計時")).toHaveTextContent("--:--:--");
  });

  it("renders live remaining time when exam is in progress", async () => {
    const oneHourFromNow = new Date(Date.now() + 3_600_500).toISOString();
    mockGetExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "in_progress",
      actualStartAt: new Date().toISOString(),
      expiresAt: oneHourFromNow,
    });

    await renderExamPage();

    expect(screen.getByLabelText("倒數計時")).toHaveTextContent("01:00:00");
  });

  it("renders problem description panel with first problem by default", async () => {
    // given
    await renderExamPage();
    // expect
    const panel = screen.getByLabelText("題目描述");
    expect(panel).toBeInTheDocument();
    expect(within(panel).getAllByText(/Two Sum/).length).toBeGreaterThan(0);
  });

  it("renders language selector with placeholder languages", async () => {
    // given
    await renderExamPage();
    // when
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    // expect
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Python 3.11" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "C++ 17" })).toBeInTheDocument();
  });

  it("renders Monaco editor", async () => {
    // given
    await renderExamPage();
    // expect
    expect(screen.getByLabelText("Code editor")).toBeInTheDocument();
  });

  it("renders bottom panel with testcases tab active by default", async () => {
    // given
    await renderExamPage();
    // expect
    expect(screen.getByLabelText("底部面板")).toBeInTheDocument();
    expect(screen.getByText("暫無公開測試資料")).toBeInTheDocument();
  });

  it("renders Run and Submit buttons", async () => {
    // given
    await renderExamPage();
    // expect
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  // ── Problem switching ─────────────────────────────────────────────────────

  it("switches to second problem when its tab is clicked", async () => {
    // given
    await renderExamPage();
    const bsTab = screen.getByRole("tab", { name: /Binary Search/ });
    // when
    fireEvent.click(bsTab);
    // expect
    const panel = screen.getByLabelText("題目描述");
    expect(within(panel).getAllByText(/Binary Search/).length).toBeGreaterThan(0);
    expect(bsTab).toHaveAttribute("aria-selected", "true");
  });

  it("sets aria-selected=false on unselected problem tab", async () => {
    // given
    await renderExamPage();
    // when - default is first problem selected
    const twoSumTab = screen.getByRole("tab", { name: /Two Sum/ });
    const bsTab = screen.getByRole("tab", { name: /Binary Search/ });
    // expect
    expect(twoSumTab).toHaveAttribute("aria-selected", "true");
    expect(bsTab).toHaveAttribute("aria-selected", "false");
  });

  // ── Code persistence ──────────────────────────────────────────────────────

  it("persists code per problem when switching tabs", async () => {
    // given
    await renderExamPage();
    const editor = screen.getByLabelText("Code editor") as HTMLTextAreaElement;

    // when: type in problem 1
    fireEvent.change(editor, { target: { value: "print('hello')" } });

    // switch to problem 2
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    // expect: editor is empty for problem 2
    expect(editor.value).toBe("");

    // switch back to problem 1
    fireEvent.click(screen.getByRole("tab", { name: /Two Sum/ }));
    // expect: code is restored
    expect(editor.value).toBe("print('hello')");
  });

  // ── Language selector ─────────────────────────────────────────────────────

  it("changes Monaco language when language selector changes", async () => {
    // given
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    const editor = screen.getByLabelText("Code editor");
    // initially python
    expect(editor).toHaveAttribute("data-language", "python");

    // when
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect
    expect(editor).toHaveAttribute("data-language", "cpp");
  });

  // ── Bottom panel tabs ─────────────────────────────────────────────────────

  it("switches to output tab when '執行結果' tab is clicked", async () => {
    // given
    await renderExamPage();
    // when
    fireEvent.click(screen.getByRole("tab", { name: "執行結果" }));
    // expect
    expect(screen.getByText("尚未執行")).toBeInTheDocument();
  });

  it("switches to history tab when '提交記錄' tab is clicked", async () => {
    // given
    await renderExamPage();
    // when
    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));
    // expect
    expect(screen.getByText("尚無提交記錄")).toBeInTheDocument();
  });

  it("returns to testcases tab when '測試資料' tab is clicked", async () => {
    // given
    await renderExamPage();
    fireEvent.click(screen.getByRole("tab", { name: "執行結果" }));
    // when
    fireEvent.click(screen.getByRole("tab", { name: "測試資料" }));
    // expect
    expect(screen.getByText("暫無公開測試資料")).toBeInTheDocument();
  });

  // ── Run / Submit buttons ──────────────────────────────────────────────────

  it("clicking Run switches bottom panel to '執行結果' tab", async () => {
    // given
    await renderExamPage();
    // when
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    // expect
    expect(screen.getByRole("tab", { name: "執行結果" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("尚未執行")).toBeInTheDocument();
  });

  it("clicking Run creates a simple submission", async () => {
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('run')" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() =>
      expect(mockCreateSubmission).toHaveBeenCalledWith(42, {
        examSessionProblemId: 101,
        language: "python3",
        sourceCode: "print('run')",
        type: "simple",
      }),
    );
  });

  it("clicking Submit creates a formal submission and switches to history", async () => {
    // given
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('submit')" },
    });
    // when
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    // expect
    await waitFor(() =>
      expect(mockCreateSubmission).toHaveBeenCalledWith(42, {
        examSessionProblemId: 101,
        language: "python3",
        sourceCode: "print('submit')",
        type: "formal",
      }),
    );
    expect(screen.getByRole("tab", { name: "提交記錄" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders loaded submission history", async () => {
    mockListSessionSubmissions.mockResolvedValue(mockSubmissions);
    await renderExamPage();

    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));

    expect(screen.getByText("一般")).toBeInTheDocument();
    expect(screen.getByText("正式")).toBeInTheDocument();
    expect(screen.getByText("WA")).toBeInTheDocument();
    expect(screen.getByText("AC")).toBeInTheDocument();
  });

  it("shows realtime public testcase results after judge_result arrives", async () => {
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('run')" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());

    act(() => {
      realtimeHandler?.({
        type: "judge_result",
        submissionId: 9001,
        examSessionProblemId: 101,
        sessionId: 42,
        status: "done",
        verdict: "AC",
        runtimeMs: 12,
        memoryKb: 1024,
        judgedAt: "2026-01-01T00:10:02.000Z",
        submissionType: "simple",
        score: 0,
        testcaseResults: [
          {
            id: 1,
            testcaseId: 1,
            orderIndex: 1,
            isPublic: true,
            verdict: "AC",
            runtimeMs: 12,
            memoryKb: 1024,
            actualOutput: "3",
          },
        ],
      });
    });

    fireEvent.click(screen.getByRole("tab", { name: "測試資料" }));
    expect(screen.getByText("測資 1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("submits the exam early after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockGetExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "in_progress",
      actualStartAt: "2026-01-01T00:00:00.000Z",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await renderExamPage();

    fireEvent.click(screen.getByRole("button", { name: "提前結束考試" }));

    await waitFor(() => expect(mockSubmitExamSession).toHaveBeenCalledWith(42));
    expect(screen.getByText("已交卷")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  // ── Expired overlay ───────────────────────────────────────────────────────

  it("does not show expired overlay when timer is not expired", async () => {
    // given
    await renderExamPage();
    // expect
    expect(screen.queryByLabelText("考試時間已到")).not.toBeInTheDocument();
  });

  // ── Resizable divider ─────────────────────────────────────────────────────

  it("renders a drag divider separator between the two panels", async () => {
    // given
    await renderExamPage();
    // expect
    expect(screen.getByRole("separator", { name: "調整面板寬度" })).toBeInTheDocument();
  });

  it("dragging the divider updates the left panel width", async () => {
    // given
    await renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整面板寬度" });
    const panel = screen.getByLabelText("題目描述") as HTMLElement;
    const initialWidth = parseInt(panel.style.width);

    // when: simulate drag 100px to the right
    fireEvent.mouseDown(divider, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 500 });
    fireEvent.mouseUp(document);

    // expect
    const newWidth = parseInt(panel.style.width);
    expect(newWidth).toBe(initialWidth + 100);
  });

  it("clamps left panel width to minimum 240px", async () => {
    // given
    await renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整面板寬度" });
    const panel = screen.getByLabelText("題目描述") as HTMLElement;

    // when: drag far to the left
    fireEvent.mouseDown(divider, { clientX: 420 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);

    // expect
    expect(parseInt(panel.style.width)).toBe(240);
  });

  it("clamps left panel width to maximum 700px", async () => {
    // given
    await renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整面板寬度" });
    const panel = screen.getByLabelText("題目描述") as HTMLElement;

    // when: drag far to the right
    fireEvent.mouseDown(divider, { clientX: 420 });
    fireEvent.mouseMove(document, { clientX: 2000 });
    fireEvent.mouseUp(document);

    // expect
    expect(parseInt(panel.style.width)).toBe(700);
  });
});
