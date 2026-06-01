import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ExamPage from "../pages/ExamPage";
import type {
  ExamSession,
  ExamSessionProblem,
  JudgeResultMessage,
  Language,
  PublicTestcase,
  SubmissionStatusMessage,
  SubmissionCreated,
} from "../types";
import { mockSubmissions } from "./mock-data";

// ── Hoisted mock factories ────────────────────────────────────────────────────
const mockGetExamSession = vi.hoisted(() => vi.fn());
const mockGetExamSessionProblems = vi.hoisted(() => vi.fn());
const mockGetLanguages = vi.hoisted(() => vi.fn());
const mockGetExamDrafts = vi.hoisted(() => vi.fn());
const mockSaveExamDraft = vi.hoisted(() => vi.fn());
const mockCreateSubmission = vi.hoisted(() => vi.fn());
const mockListSessionSubmissions = vi.hoisted(() => vi.fn());
const mockSubmitExamSession = vi.hoisted(() => vi.fn());
const mockGetPublicTestcases = vi.hoisted(() => vi.fn());
const mockUseJudgeSocket = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("../api/client", () => ({
  getExamSession: mockGetExamSession,
  getExamSessionProblems: mockGetExamSessionProblems,
  getLanguages: mockGetLanguages,
  getExamDrafts: mockGetExamDrafts,
  saveExamDraft: mockSaveExamDraft,
  createSubmission: mockCreateSubmission,
  listSessionSubmissions: mockListSessionSubmissions,
  submitExamSession: mockSubmitExamSession,
  getPublicTestcases: mockGetPublicTestcases,
}));

vi.mock("../hooks/useJudgeSocket", () => ({
  useJudgeSocket: mockUseJudgeSocket,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

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
  NavBar: ({ homeHref }: { homeHref: string }) => <nav data-testid="navbar" data-home={homeHref} />,
}));

// ── Local mock data (separate from mock-data.ts: tests expect "Binary Search") ─
const mockExamPageSession: ExamSession = {
  id: 42,
  examId: 420,
  examTitle: "考試 #42",
  candidateId: 1,
  candidate: { id: 1, username: "candidate01", displayName: "Alice Chen" },
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
  await waitFor(() => expect(screen.queryByText("載入中...")).not.toBeInTheDocument());
  return result;
}

describe("ExamPage", () => {
  let realtimeHandler:
    | ((message: JudgeResultMessage | SubmissionStatusMessage) => void)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetExamSession.mockResolvedValue(mockExamPageSession);
    mockGetExamSessionProblems.mockResolvedValue(mockExamPageProblems);
    mockGetLanguages.mockResolvedValue(mockExamPageLanguages);
    mockGetExamDrafts.mockResolvedValue({});
    mockSaveExamDraft.mockResolvedValue({ ok: true });
    mockListSessionSubmissions.mockResolvedValue([]);
    mockGetPublicTestcases.mockResolvedValue([]);
    mockSubmitExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "submitted",
      submittedAt: "2026-01-01T00:30:00.000Z",
    });
    mockCreateSubmission.mockImplementation(
      async (
        _sessionId: number,
        { type }: { type: "simple" | "formal" },
      ): Promise<SubmissionCreated> => ({
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
      (
        _sessionId: number,
        onJudgeResult: (message: JudgeResultMessage | SubmissionStatusMessage) => void,
      ) => {
        realtimeHandler = onJudgeResult;
      },
    );
  });

  // ── Layout ────────────────────────────────────────────────────────────────

  it("renders NavBar with /candidate homeHref", async () => {
    // given
    await renderExamPage();
    // when / expect
    expect(screen.getByTestId("navbar")).toHaveAttribute("data-home", "/candidate");
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

  it("renders problem tabs by orderIndex even when API returns them out of order", async () => {
    mockGetExamSessionProblems.mockResolvedValue([
      mockExamPageProblems[1]!,
      mockExamPageProblems[0]!,
    ]);

    await renderExamPage();

    const problemTabs = screen
      .getAllByRole("tab")
      .filter((tab) => /^\d+\./.test(tab.textContent ?? ""));
    expect(problemTabs.map((tab) => tab.textContent)).toEqual(["1. Two Sum", "2. Binary Search"]);
    expect(screen.getByRole("tab", { name: "1. Two Sum" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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

  it("renders language selector populated from GET /api/languages", async () => {
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
    // wait for languages to load and default to python3
    await waitFor(() => {
      expect(screen.getByLabelText("Code editor")).toHaveAttribute("data-language", "python");
    });

    // when
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect — re-query because key={monacoLang} causes the editor to remount on language change
    expect(screen.getByLabelText("Code editor")).toHaveAttribute("data-language", "cpp");
  });

  it("shows empty language selector and plaintext editor when GET /api/languages returns empty list", async () => {
    // given
    mockGetLanguages.mockResolvedValue([]);
    // when
    await renderExamPage();
    // expect — no options, editor defaults to plaintext
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    expect(select.options).toHaveLength(0);
    expect(screen.getByLabelText("Code editor")).toHaveAttribute("data-language", "plaintext");
  });

  it("shows load error when GET /api/languages fails (API error)", async () => {
    // given — getLanguages rejects → Promise.all rejects → load error UI
    mockGetLanguages.mockRejectedValue(new Error("500 Internal Server Error"));
    // when
    await renderExamPage();
    // expect — error message shown, editor not rendered
    expect(screen.getByText("無法載入考試，請重新整理頁面或聯繫面試官。")).toBeInTheDocument();
    expect(screen.queryByLabelText("Code editor")).not.toBeInTheDocument();
  });

  it("filters out disabled languages from the selector", async () => {
    // given
    mockGetLanguages.mockResolvedValue([
      { ...mockExamPageLanguages[0], isEnabled: false },
      mockExamPageLanguages[1],
    ]);
    // when
    await renderExamPage();
    // expect — only enabled language appears
    expect(screen.getByRole("option", { name: "C++ 17" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Python 3.11" })).not.toBeInTheDocument();
  });

  it("falls back to the first enabled language when a restored draft language is disabled", async () => {
    // given — python3 disabled; last-used language key points to python3
    mockGetLanguages.mockResolvedValue([
      { ...mockExamPageLanguages[0], isEnabled: false },
      mockExamPageLanguages[1],
    ]);
    localStorage.setItem("oct:lang:42:1", "python3");
    localStorage.setItem("oct:draft:42:1:python3", "print('stale')");

    // when
    await renderExamPage();

    // expect — disabled language is rejected; selector shows first enabled (cpp17)
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    expect(select.value).toBe("cpp17");
    expect(screen.getByLabelText("Code editor")).toHaveAttribute("data-language", "cpp");
  });

  it("language selector default value matches the first enabled language", async () => {
    // given
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    // expect — select.value should be python3, not empty string
    await waitFor(() => expect(select.value).toBe("python3"));
  });

  it("select.value updates immediately after user selects a different language", async () => {
    // given
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));
    // when — simulate real user interaction via userEvent (not synthetic fireEvent)
    const user = userEvent.setup();
    await user.selectOptions(select, "cpp17");
    // expect
    expect(select.value).toBe("cpp17");
  });

  it("each problem maintains its own independent language selection", async () => {
    // given
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));

    // when: change problem 1 to cpp17
    fireEvent.change(select, { target: { value: "cpp17" } });
    expect(select.value).toBe("cpp17");

    // switch to problem 2
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    // expect: problem 2 is still on default python3 (unaffected by problem 1 change)
    expect(select.value).toBe("python3");

    // switch back to problem 1
    fireEvent.click(screen.getByRole("tab", { name: /Two Sum/ }));
    // expect: problem 1 preserves cpp17
    expect(select.value).toBe("cpp17");
  });

  it("typing code in editor does not reset the language selection", async () => {
    // given
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));
    fireEvent.change(select, { target: { value: "cpp17" } });
    expect(select.value).toBe("cpp17");
    // when — re-query editor after language change because key={monacoLang} causes remount
    const editor = screen.getByLabelText("Code editor") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "int main() { return 0; }" } });
    // expect — language must not be reset by code input
    expect(select.value).toBe("cpp17");
  });

  it("all problems have a valid default language even when Redis draft only partially restores", async () => {
    // given — session must be in_progress for Redis restore to run;
    //          Redis returns a draft for problem 1 (cpp17 code) but nothing for problem 2
    mockGetExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "in_progress",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    // New format: key = "problemId:language", value = code string
    mockGetExamDrafts.mockResolvedValue({
      "1:cpp17": "int main() {}",
    });
    // when
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    // expect: selected language stays at defaultLang (python3); Redis restore only
    //         populates the code for that language, it does not change the selector
    await waitFor(() => expect(select.value).toBe("python3"));
    // when — switch to cpp17 to verify code was restored from Redis
    fireEvent.change(select, { target: { value: "cpp17" } });
    expect(screen.getByLabelText("Code editor")).toHaveValue("int main() {}");
    // when — switch to problem 2 (Binary Search, problemId: 2 — not in Redis)
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    // expect: problem 2 falls back to the default language (python3), not empty string
    expect(select.value).toBe("python3");
  });

  // ── Per-language draft isolation ──────────────────────────────────────────

  it("switching language preserves per-language code independently", async () => {
    // given
    await renderExamPage();
    const editor = screen.getByLabelText("Code editor") as HTMLTextAreaElement;
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));

    // when: write python code
    fireEvent.change(editor, { target: { value: "print('py')" } });
    // switch to cpp17
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect: editor is empty for cpp17 (new language has no code)
    expect(screen.getByLabelText("Code editor")).toHaveValue("");

    // when: write cpp code
    fireEvent.change(screen.getByLabelText("Code editor"), { target: { value: "int main() {}" } });
    // switch back to python3
    fireEvent.change(select, { target: { value: "python3" } });
    // expect: python code is restored
    expect(screen.getByLabelText("Code editor")).toHaveValue("print('py')");

    // when: switch back to cpp17
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect: cpp code is also restored
    expect(screen.getByLabelText("Code editor")).toHaveValue("int main() {}");
  });

  it("restores per-language code from localStorage on page load", async () => {
    // given — both python3 and cpp17 have saved code in localStorage
    localStorage.setItem("oct:draft:42:1:python3", "restored_py");
    localStorage.setItem("oct:draft:42:1:cpp17", "restored_cpp");
    localStorage.setItem("oct:lang:42:1", "cpp17"); // last used was cpp17
    // when
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    // expect: last-used language (cpp17) is selected on load
    await waitFor(() => expect(select.value).toBe("cpp17"));
    expect(screen.getByLabelText("Code editor")).toHaveValue("restored_cpp");
    // when: switch to python3
    fireEvent.change(select, { target: { value: "python3" } });
    // expect: python3 code also restored
    expect(screen.getByLabelText("Code editor")).toHaveValue("restored_py");
  });

  it("per-language draft localStorage key is written on code change", async () => {
    // given
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));
    vi.useFakeTimers();
    try {
      // when: type code and advance debounce
      fireEvent.change(screen.getByLabelText("Code editor"), { target: { value: "new_code" } });
      vi.advanceTimersByTime(1001);
      // expect: localStorage key includes language
      expect(localStorage.getItem("oct:draft:42:1:python3")).toBe("new_code");
      expect(localStorage.getItem("oct:draft:42:1")).toBeNull(); // old format must not exist
    } finally {
      vi.useRealTimers();
    }
  });

  it("oct:lang key is updated when language is switched", async () => {
    // given
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));
    // when
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect: last-used language stored for this session+problem
    expect(localStorage.getItem("oct:lang:42:1")).toBe("cpp17");
  });

  // ── Draft restore (sessionStatus guard) ──────────────────────────────────

  it("does not call getExamDrafts when session is not_started", async () => {
    // given — default session status is "not_started"; no localStorage so missingIds is non-empty
    // when
    await renderExamPage();
    // expect — Redis restore must be skipped before exam starts
    expect(mockGetExamDrafts).not.toHaveBeenCalled();
  });

  it("calls getExamDrafts when session is in_progress and localStorage is empty", async () => {
    // given
    mockGetExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "in_progress",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    // when
    await renderExamPage();
    // expect — Redis restore should run for in_progress sessions
    expect(mockGetExamDrafts).toHaveBeenCalledWith(42);
  });

  // ── Auto-save draft (sessionStatus guard) ────────────────────────────────

  it("does not call saveExamDraft when changing language if session is not_started", async () => {
    // given — default session status is "not_started"
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));
    vi.clearAllMocks();
    // when
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect — draft API must not be called before exam starts
    expect(mockSaveExamDraft).not.toHaveBeenCalled();
  });

  it("does not call saveExamDraft when switching to a language with no existing code", async () => {
    // given — in_progress session, but cpp17 has no code in localStorage
    mockGetExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "in_progress",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));
    vi.clearAllMocks();
    // when — switch to cpp17 which has no code
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect — no code to sync so saveExamDraft must not be called
    expect(mockSaveExamDraft).not.toHaveBeenCalled();
  });

  it("calls saveExamDraft when changing to a language with existing localStorage code during in_progress session", async () => {
    // given — cpp17 has pre-existing code in localStorage
    mockGetExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "in_progress",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    localStorage.setItem("oct:draft:42:1:cpp17", "int main() {}");
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));
    vi.clearAllMocks();
    // when
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect — existing code is synced to Redis
    expect(mockSaveExamDraft).toHaveBeenCalledWith(42, 1, "cpp17", {
      code: "int main() {}",
    });
  });

  it("logs error to console when saveExamDraft rejects on language change during in_progress session", async () => {
    // given — cpp17 has code so saveExamDraft will be triggered on language switch
    mockGetExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "in_progress",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    localStorage.setItem("oct:draft:42:1:cpp17", "int main() {}");
    mockSaveExamDraft.mockRejectedValue(new Error("404 Not Found"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));
    // when
    fireEvent.change(select, { target: { value: "cpp17" } });
    // expect
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "[ExamPage] auto-save draft failed:",
        expect.any(Error),
      ),
    );
    errorSpy.mockRestore();
  });

  it("keeps the editor usable after a saveExamDraft rejection — failure must not block editing", async () => {
    // FR-4.2 AC3: Redis 暫時不可用 → UI 不阻斷編輯，使用者仍能繼續輸入。
    // given — in_progress session + cpp17 has pre-existing code so switching language
    //         triggers a saveExamDraft sync (same path as the existing logging test).
    mockGetExamSession.mockResolvedValue({
      ...mockExamPageSession,
      status: "in_progress",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    localStorage.setItem("oct:draft:42:1:cpp17", "int main() {}");
    mockSaveExamDraft.mockRejectedValue(new Error("503 Service Unavailable"));
    // The existing handler logs to console.error; suppress to keep test output clean.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderExamPage();
    const select = screen.getByLabelText("語言") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("python3"));

    // when — switch language to trigger the rejecting Redis save
    fireEvent.change(select, { target: { value: "cpp17" } });
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());

    // when — user keeps typing after the failure
    const editorAfter = screen.getByLabelText("Code editor") as HTMLTextAreaElement;
    fireEvent.change(editorAfter, { target: { value: "int main() { return 0; }" } });

    // expect — editor still accepts input (value updates, no fatal overlay)
    expect(editorAfter.value).toBe("int main() { return 0; }");
    expect(
      screen.queryByText("無法載入考試，請重新整理頁面或聯繫面試官。"),
    ).not.toBeInTheDocument();
    // expect — language selector remains operable as a second usability check
    expect(select).not.toBeDisabled();

    errorSpy.mockRestore();
  });

  it("does not call saveExamDraft debounce when typing code if session is not_started", async () => {
    // given
    await renderExamPage();
    const editor = screen.getByLabelText("Code editor");
    vi.clearAllMocks();
    vi.useFakeTimers();
    try {
      // when
      fireEvent.change(editor, { target: { value: "print('hello')" } });
      vi.advanceTimersByTime(5001);
      // expect — debounced API call must be suppressed when session not started
      expect(mockSaveExamDraft).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
    expect(screen.getByRole("tab", { name: "執行結果" })).toHaveAttribute("aria-selected", "true");
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
    expect(screen.getByRole("tab", { name: "提交記錄" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders loaded submission history showing only formal submissions", async () => {
    // given — backend returns both simple (WA) and formal (AC)
    mockListSessionSubmissions.mockResolvedValue(mockSubmissions);
    await renderExamPage();
    // when
    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));
    // expect — only the formal submission is shown; simple is filtered out
    const panel = screen.getByLabelText("底部面板");
    expect(within(panel).getAllByText("1. Two Sum")).toHaveLength(1);
    expect(within(panel).getByText("正式")).toBeInTheDocument();
    expect(within(panel).getByText("AC")).toBeInTheDocument();
    expect(within(panel).queryByText("一般")).not.toBeInTheDocument();
    expect(within(panel).queryByText("WA")).not.toBeInTheDocument();
  });

  it("output tab shows pending submission immediately after Run with code", async () => {
    // given
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('hi')" },
    });
    // when
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    // expect — createSubmission resolves → latestSubmission appears in output tab
    await waitFor(() =>
      expect(screen.getByLabelText("底部面板")).toHaveTextContent("一般提交：pending"),
    );
  });

  it("output tab updates to verdict when judge_result WebSocket message arrives", async () => {
    // given
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('hi')" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() =>
      expect(screen.getByLabelText("底部面板")).toHaveTextContent("一般提交：pending"),
    );
    // when — WebSocket delivers judge_result
    act(() => {
      realtimeHandler?.({
        type: "judge_result",
        submissionId: 9001,
        examSessionProblemId: 101,
        sessionId: 42,
        status: "done",
        verdict: "AC",
        runtimeMs: 42,
        memoryKb: 1024,
        judgedAt: "2026-01-01T00:10:02.000Z",
        submissionType: "simple",
        score: 0,
        testcaseResults: [],
      });
    });
    // expect — output tab reflects verdict and runtime
    const panel = screen.getByLabelText("底部面板");
    expect(panel).toHaveTextContent("一般提交：AC");
    expect(panel).toHaveTextContent("執行時間：42 ms");
  });

  it("updates run result to judging from realtime lifecycle messages", async () => {
    // given
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('run')" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());
    // when — submission_status arrives
    act(() => {
      realtimeHandler?.({
        type: "submission_status",
        submissionId: 9001,
        sessionId: 42,
        status: "judging",
        judgedAt: null,
      });
    });
    // expect — output tab (not history) reflects judging status
    expect(screen.getByLabelText("底部面板")).toHaveTextContent("一般提交：judging");
  });

  it("shows realtime public testcase results after judge_result arrives", async () => {
    // given — one public testcase loaded for problem 1 (espId 101)
    mockGetPublicTestcases.mockResolvedValue([
      {
        id: 1,
        orderIndex: 1,
        inputData: "1 2",
        expectedOutput: "expected_3",
      } satisfies PublicTestcase,
    ]);
    await renderExamPage();
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 101));

    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('run')" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());

    // when — WebSocket delivers judge_result
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

    // expect — "測試資料" tab shows testcase enriched with verdict and actual output
    fireEvent.click(screen.getByRole("tab", { name: "測試資料" }));
    const panel = screen.getByLabelText("底部面板");
    expect(within(panel).getByText("Case 1")).toBeInTheDocument();
    expect(within(panel).getByText("3")).toBeInTheDocument(); // actualOutput
    expect(within(panel).getByText("AC")).toBeInTheDocument(); // verdict
  });

  // ── Public testcases ─────────────────────────────────────────────────────

  it("fetches and displays public testcases for the active problem on mount", async () => {
    // given
    mockGetPublicTestcases.mockResolvedValue([
      {
        id: 10,
        orderIndex: 1,
        inputData: "hello",
        expectedOutput: "world",
      } satisfies PublicTestcase,
    ]);
    // when
    await renderExamPage();
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 101));
    // expect — testcase shown with input and expected output
    const panel = screen.getByLabelText("底部面板");
    expect(within(panel).getByText("Case 1")).toBeInTheDocument();
    expect(within(panel).getByText(/hello/)).toBeInTheDocument();
    expect(within(panel).getByText(/world/)).toBeInTheDocument();
  });

  it("shows 暫無公開測試資料 when getPublicTestcases returns empty array", async () => {
    // given
    mockGetPublicTestcases.mockResolvedValue([]);
    // when
    await renderExamPage();
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 101));
    // expect
    expect(screen.getByText("暫無公開測試資料")).toBeInTheDocument();
  });

  it("shows 暫無公開測試資料 when getPublicTestcases API fails (500)", async () => {
    // given — API error treated as silent fail
    mockGetPublicTestcases.mockRejectedValue(new Error("500 Internal Server Error"));
    // when
    await renderExamPage();
    // expect — graceful fallback, no crash
    expect(screen.getByText("暫無公開測試資料")).toBeInTheDocument();
  });

  it("clicking a case button shows that case's content and hides the previous", async () => {
    // given — two public testcases for the active problem
    mockGetPublicTestcases.mockResolvedValue([
      {
        id: 1,
        orderIndex: 1,
        inputData: "input_one",
        expectedOutput: "out_one",
      } satisfies PublicTestcase,
      {
        id: 2,
        orderIndex: 2,
        inputData: "input_two",
        expectedOutput: "out_two",
      } satisfies PublicTestcase,
    ]);
    await renderExamPage();
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 101));
    const panel = screen.getByLabelText("底部面板");
    // by default Case 1 is active — its content is visible
    expect(within(panel).getByText(/input_one/)).toBeInTheDocument();
    expect(within(panel).queryByText(/input_two/)).not.toBeInTheDocument();
    // when — click Case 2 button
    fireEvent.click(within(panel).getByRole("button", { name: "Case 2" }));
    // expect — Case 2 content shown, Case 1 content hidden
    expect(within(panel).getByText(/input_two/)).toBeInTheDocument();
    expect(within(panel).queryByText(/input_one/)).not.toBeInTheDocument();
  });

  it("resets to Case 1 when switching to a different problem", async () => {
    // given — two cases for problem 1, one case for problem 2
    mockGetPublicTestcases.mockImplementation(
      (_sessionId: number, espId: number): Promise<PublicTestcase[]> =>
        Promise.resolve(
          espId === 101
            ? [
                { id: 1, orderIndex: 1, inputData: "p1c1", expectedOutput: "out" },
                { id: 2, orderIndex: 2, inputData: "p1c2", expectedOutput: "out" },
              ]
            : [{ id: 3, orderIndex: 1, inputData: "p2c1", expectedOutput: "out" }],
        ),
    );
    await renderExamPage();
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 101));
    const panel = screen.getByLabelText("底部面板");
    // advance to Case 2 on problem 1
    fireEvent.click(within(panel).getByRole("button", { name: "Case 2" }));
    expect(within(panel).getByText(/p1c2/)).toBeInTheDocument();
    // when — switch to problem 2 (which only has Case 1)
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 102));
    // expect — Case 1 of problem 2 is shown (activeCaseIdx reset to 0)
    expect(within(panel).getByText(/p2c1/)).toBeInTheDocument();
  });

  it("fetches testcases for a new problem when switching problem tabs", async () => {
    // given
    mockGetPublicTestcases.mockResolvedValue([]);
    await renderExamPage();
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 101));
    mockGetPublicTestcases.mockResolvedValue([
      { id: 20, orderIndex: 1, inputData: "abc", expectedOutput: "xyz" } satisfies PublicTestcase,
    ]);
    // when — switch to problem 2 (espId 102)
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    // expect — getPublicTestcases called with espId 102
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 102));
    const panel = screen.getByLabelText("底部面板");
    expect(within(panel).getByText(/abc/)).toBeInTheDocument();
    expect(within(panel).getByText(/xyz/)).toBeInTheDocument();
  });

  it("does not re-fetch testcases when switching back to an already-loaded problem", async () => {
    // given
    mockGetPublicTestcases.mockResolvedValue([]);
    await renderExamPage();
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 101));
    // when — switch to problem 2 then back to problem 1
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 102));
    fireEvent.click(screen.getByRole("tab", { name: /Two Sum/ }));
    // expect — problem 1 (espId 101) fetched exactly once despite switching back
    expect(mockGetPublicTestcases).toHaveBeenCalledTimes(2);
    expect(mockGetPublicTestcases).toHaveBeenNthCalledWith(1, 42, 101);
    expect(mockGetPublicTestcases).toHaveBeenNthCalledWith(2, 42, 102);
  });

  it("does not enrich problem 1 testcases when judge_result is for a problem 2 submission", async () => {
    // given
    mockGetPublicTestcases.mockImplementation(
      (_sessionId: number, espId: number): Promise<PublicTestcase[]> =>
        Promise.resolve(
          espId === 101
            ? [{ id: 1, orderIndex: 1, inputData: "p1 input", expectedOutput: "p1 out" }]
            : [{ id: 2, orderIndex: 1, inputData: "p2 input", expectedOutput: "p2 out" }],
        ),
    );
    mockCreateSubmission.mockResolvedValue({
      id: 9001,
      examSessionProblemId: 102, // submission belongs to problem 2
      language: "python3",
      submissionType: "simple",
      status: "pending",
      verdict: null,
      runtimeMs: null,
      memoryKb: null,
      submittedAt: "2026-01-01T00:10:00.000Z",
      judgedAt: null,
    });
    await renderExamPage();
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 101));

    // Run from problem 2 and receive judge_result for espId 102
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    await waitFor(() => expect(mockGetPublicTestcases).toHaveBeenCalledWith(42, 102));
    fireEvent.change(screen.getByLabelText("Code editor"), { target: { value: "code" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());
    act(() => {
      realtimeHandler?.({
        type: "judge_result",
        submissionId: 9001,
        examSessionProblemId: 102,
        sessionId: 42,
        status: "done",
        verdict: "WA",
        runtimeMs: 10,
        memoryKb: 512,
        judgedAt: "2026-01-01T00:10:02.000Z",
        submissionType: "simple",
        score: 0,
        testcaseResults: [
          {
            id: 99,
            testcaseId: 1,
            orderIndex: 1,
            isPublic: true,
            verdict: "WA",
            runtimeMs: 10,
            memoryKb: 512,
            actualOutput: "wrong",
          },
        ],
      });
    });

    // when — switch back to problem 1 and open testcases tab
    fireEvent.click(screen.getByRole("tab", { name: /Two Sum/ }));
    fireEvent.click(screen.getByRole("tab", { name: "測試資料" }));

    // expect — problem 1's testcase has no verdict (result was for problem 2)
    const panel = screen.getByLabelText("底部面板");
    expect(within(panel).queryByText("WA")).not.toBeInTheDocument();
    expect(within(panel).queryByText("wrong")).not.toBeInTheDocument();
    expect(within(panel).getByText(/p1 input/)).toBeInTheDocument();
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
    expect(mockNavigate).toHaveBeenCalledWith("/exam/42/result");
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

  // ── Vertical resizable divider (editor / bottom panel) ───────────────────

  it("renders a vertical drag divider separator between editor and bottom panel", async () => {
    // given
    await renderExamPage();
    // expect
    expect(screen.getByRole("separator", { name: "調整底部面板高度" })).toBeInTheDocument();
  });

  it("dragging vertical divider upward increases bottom panel height", async () => {
    // given
    await renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整底部面板高度" });
    const panel = screen.getByLabelText("底部面板") as HTMLElement;
    const initialHeight = parseInt(panel.style.height); // default 208

    // when: drag 100px upward (clientY decreases)
    fireEvent.mouseDown(divider, { clientY: 600 });
    fireEvent.mouseMove(document, { clientY: 500 });
    fireEvent.mouseUp(document);

    // expect: height increased by 100
    expect(parseInt(panel.style.height)).toBe(initialHeight + 100);
  });

  it("dragging vertical divider downward decreases bottom panel height", async () => {
    // given
    await renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整底部面板高度" });
    const panel = screen.getByLabelText("底部面板") as HTMLElement;
    const initialHeight = parseInt(panel.style.height);

    // when: drag 50px downward
    fireEvent.mouseDown(divider, { clientY: 600 });
    fireEvent.mouseMove(document, { clientY: 650 });
    fireEvent.mouseUp(document);

    // expect: height decreased by 50
    expect(parseInt(panel.style.height)).toBe(initialHeight - 50);
  });

  it("clamps bottom panel height to minimum 80px", async () => {
    // given
    await renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整底部面板高度" });
    const panel = screen.getByLabelText("底部面板") as HTMLElement;

    // when: drag far downward
    fireEvent.mouseDown(divider, { clientY: 600 });
    fireEvent.mouseMove(document, { clientY: 9999 });
    fireEvent.mouseUp(document);

    // expect
    expect(parseInt(panel.style.height)).toBe(80);
  });

  it("clamps bottom panel height to maximum 600px", async () => {
    // given
    await renderExamPage();
    const divider = screen.getByRole("separator", { name: "調整底部面板高度" });
    const panel = screen.getByLabelText("底部面板") as HTMLElement;

    // when: drag far upward
    fireEvent.mouseDown(divider, { clientY: 600 });
    fireEvent.mouseMove(document, { clientY: 0 });
    fireEvent.mouseUp(document);

    // expect
    expect(parseInt(panel.style.height)).toBe(600);
  });

  // ── Run vs Submit isolation ───────────────────────────────────────────────

  it("clicking Run does NOT add result to 提交記錄 history", async () => {
    // given
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('hi')" },
    });
    // when
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());
    // expect — history tab shows empty state; simple submission is not recorded
    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));
    expect(screen.getByText("尚無提交記錄")).toBeInTheDocument();
  });

  it("clicking Run shows pending immediately in output tab", async () => {
    // given
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('hi')" },
    });
    // when
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    // expect — output tab active and shows pending
    await waitFor(() =>
      expect(screen.getByLabelText("底部面板")).toHaveTextContent("一般提交：pending"),
    );
  });

  it("WebSocket judge_result for simple updates output tab but NOT 提交記錄", async () => {
    // given
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('hi')" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());
    // when — judge_result for simple submission
    act(() => {
      realtimeHandler?.({
        type: "judge_result",
        submissionId: 9001,
        examSessionProblemId: 101,
        sessionId: 42,
        status: "done",
        verdict: "AC",
        runtimeMs: 20,
        memoryKb: 512,
        judgedAt: "2026-01-01T00:10:02.000Z",
        submissionType: "simple",
        score: 0,
        testcaseResults: [],
      });
    });
    // expect — output tab shows verdict
    expect(screen.getByLabelText("底部面板")).toHaveTextContent("一般提交：AC");
    // expect — history tab stays empty
    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));
    expect(screen.getByText("尚無提交記錄")).toBeInTheDocument();
  });

  it("clicking Submit adds a formal submission to 提交記錄 but NOT to output tab state", async () => {
    // given
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), {
      target: { value: "print('submit')" },
    });
    // when
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());
    // expect — history tab shows formal submission
    const panel = screen.getByLabelText("底部面板");
    expect(within(panel).getByText("正式")).toBeInTheDocument();
    // output tab stays empty (no runResult set for formal submit)
    fireEvent.click(screen.getByRole("tab", { name: "執行結果" }));
    expect(screen.getByText("尚未執行")).toBeInTheDocument();
  });

  it("listSessionSubmissions filters out simple submissions on initial load", async () => {
    // given — backend returns both simple and formal submissions
    mockListSessionSubmissions.mockResolvedValue([
      ...mockSubmissions, // mockSubmissions contains a simple ("一般") and a formal ("正式")
    ]);
    // when
    await renderExamPage();
    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));
    // expect — only formal submission visible in history
    const panel = screen.getByLabelText("底部面板");
    expect(within(panel).getByText("正式")).toBeInTheDocument();
    expect(within(panel).queryByText("一般")).not.toBeInTheDocument();
  });

  // ── Cross-problem isolation (output tab) ──────────────────────────────────

  it("output tab shows 尚未執行 after switching to a problem that has no run result", async () => {
    // given — run on problem 1
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), { target: { value: "print('hi')" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() =>
      expect(screen.getByLabelText("底部面板")).toHaveTextContent("一般提交：pending"),
    );

    // when — switch to problem 2
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    fireEvent.click(screen.getByRole("tab", { name: "執行結果" }));

    // expect — problem 2 has no run result
    expect(screen.getByText("尚未執行")).toBeInTheDocument();
  });

  it("output tab restores run result when switching back to the problem that was run", async () => {
    // given — run on problem 1, switch away, switch back
    await renderExamPage();
    fireEvent.change(screen.getByLabelText("Code editor"), { target: { value: "print('hi')" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() =>
      expect(screen.getByLabelText("底部面板")).toHaveTextContent("一般提交：pending"),
    );
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));

    // when — switch back to problem 1
    fireEvent.click(screen.getByRole("tab", { name: /Two Sum/ }));
    fireEvent.click(screen.getByRole("tab", { name: "執行結果" }));

    // expect — problem 1's run result is still visible
    expect(screen.getByLabelText("底部面板")).toHaveTextContent("一般提交：pending");
  });

  // ── Cross-problem isolation (history tab) ─────────────────────────────────

  it("history tab shows 尚無提交記錄 for a problem with no submissions when another problem has submissions", async () => {
    // given — problem 1 has a formal submission pre-loaded, problem 2 has none
    mockListSessionSubmissions.mockResolvedValue([mockSubmissions[1]!]); // formal for problem 1
    await renderExamPage();

    // when — switch to problem 2 and open history
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));

    // expect — problem 2 history is empty even though problem 1 has submissions
    expect(screen.getByText("尚無提交記錄")).toBeInTheDocument();
  });

  it("history tab restores submissions when switching back to the problem that was submitted", async () => {
    // given — problem 1 has a formal submission pre-loaded
    mockListSessionSubmissions.mockResolvedValue([mockSubmissions[1]!]);
    await renderExamPage();
    // navigate away to problem 2 then back
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));

    // when — switch back to problem 1 and open history
    fireEvent.click(screen.getByRole("tab", { name: /Two Sum/ }));
    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));

    // expect — problem 1's submission is visible again
    const panel = screen.getByLabelText("底部面板");
    expect(within(panel).getByText("1. Two Sum")).toBeInTheDocument();
    expect(within(panel).getByText("AC")).toBeInTheDocument();
  });

  it("marks a formal judge result as final even when the score is 0", async () => {
    mockListSessionSubmissions.mockResolvedValue([
      {
        ...mockSubmissions[1]!,
        id: 9002,
        verdict: null,
        score: 0,
        isFinalSubmission: false,
      },
    ]);
    await renderExamPage();

    act(() => {
      realtimeHandler?.({
        type: "judge_result",
        sessionId: 42,
        submissionId: 9002,
        examSessionProblemId: 101,
        submissionType: "formal",
        status: "done",
        verdict: "WA",
        runtimeMs: 12,
        memoryKb: 1024,
        judgedAt: "2026-01-01T00:10:02.000Z",
        score: 0,
        testcaseResults: [],
      });
    });

    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));

    expect(screen.getByText("WA")).toBeInTheDocument();
    expect(screen.getByText("最終提交")).toBeInTheDocument();
  });

  it("submitting on problem 2 does not pollute problem 1 history tab", async () => {
    // given — createSubmission returns espId 102 (problem 2)
    mockCreateSubmission.mockResolvedValue({
      id: 9002,
      examSessionProblemId: 102,
      language: "python3",
      submissionType: "formal",
      status: "pending",
      verdict: null,
      runtimeMs: null,
      memoryKb: null,
      submittedAt: "2026-01-01T00:10:00.000Z",
      judgedAt: null,
    });
    await renderExamPage();

    // switch to problem 2 and submit
    fireEvent.click(screen.getByRole("tab", { name: /Binary Search/ }));
    fireEvent.change(screen.getByLabelText("Code editor"), { target: { value: "code" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());

    // when — switch to problem 1 and open history
    fireEvent.click(screen.getByRole("tab", { name: /Two Sum/ }));
    fireEvent.click(screen.getByRole("tab", { name: "提交記錄" }));

    // expect — problem 1 history is empty (submission belonged to problem 2)
    expect(screen.getByText("尚無提交記錄")).toBeInTheDocument();
  });
});
