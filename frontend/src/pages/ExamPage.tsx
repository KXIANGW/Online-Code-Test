import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NavBar } from "../components/NavBar";
import type {
  ExamSessionProblem,
  ExamStatus,
  JudgeSocketMessage,
  Language,
  PublicTestcase,
  SubmissionSummary,
  TestcaseResult,
} from "../types";
import {
  createSubmission,
  getExamSession,
  getExamSessionProblems,
  getLanguages,
  getPublicTestcases,
  saveExamDraft,
  getExamDrafts,
  listSessionSubmissions,
  submitExamSession,
} from "../api/client";
import { formatTimeLeft, useExamTimer } from "../hooks/useExamTimer";
import { useJudgeSocket } from "../hooks/useJudgeSocket";

const MONACO_LANG: Record<string, string> = {
  python3: "python",
  cpp17: "cpp",
  java21: "java",
};

type BottomTab = "testcases" | "output" | "history";

export default function ExamPage() {
  const { id: sessionIdStr } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sessionId = Number(sessionIdStr);

  const [problems, setProblems] = useState<ExamSessionProblem[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [activeProblemId, setActiveProblemId] = useState<number>(0);
  const [selectedLangs, setSelectedLangs] = useState<Record<number, string>>(
    {},
  );
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [bottomTab, setBottomTab] = useState<BottomTab>("testcases");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<ExamStatus>("not_started");
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [latestSubmissionId, setLatestSubmissionId] = useState<number | null>(
    null,
  );
  const [publicResultsBySubmission, setPublicResultsBySubmission] = useState<
    Record<number, TestcaseResult[]>
  >({});
  const [publicTestcases, setPublicTestcases] = useState<
    Record<number, PublicTestcase[]>
  >({});
  const [activeCaseIdx, setActiveCaseIdx] = useState(0);
  const [leftWidth, setLeftWidth] = useState(420);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const lsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedEspIds = useRef<Set<number>>(new Set());

  // Load session data on mount
  useEffect(() => {
    async function load() {
      try {
        const [session, sessionProblems, langs, history] = await Promise.all([
          getExamSession(sessionId),
          getExamSessionProblems(sessionId),
          getLanguages(),
          listSessionSubmissions(sessionId),
        ]);

        const enabledLangs = langs.filter((l) => l.isEnabled !== false);
        const enabledLanguageIds = new Set(
          enabledLangs.map((lang) => lang.language),
        );
        setProblems(sessionProblems);
        setLanguages(enabledLangs);
        setSessionStatus(session.status);
        setSubmissions(history);
        setLatestSubmissionId(history.at(-1)?.id ?? null);
        if (session.expiresAt) setExpiresAt(session.expiresAt);
        if (sessionProblems.length > 0)
          setActiveProblemId(sessionProblems[0].problemId);

        const defaultLang = enabledLangs[0]?.language ?? "";
        const initialCodes: Record<number, string> = {};
        const initialLangs: Record<number, string> = {};

        for (const p of sessionProblems) {
          const lsKey = `oct:draft:${sessionId}:${p.problemId}`;
          const lsRaw = localStorage.getItem(lsKey);
          if (lsRaw) {
            try {
              const parsed = JSON.parse(lsRaw) as {
                code?: string;
                language?: string;
              };
              if (parsed.code !== undefined)
                initialCodes[p.problemId] = parsed.code;
              initialLangs[p.problemId] =
                parsed.language && enabledLanguageIds.has(parsed.language)
                  ? parsed.language
                  : defaultLang;
            } catch {
              initialLangs[p.problemId] = defaultLang;
            }
          } else {
            initialLangs[p.problemId] = defaultLang;
          }
        }

        setCodes(initialCodes);
        setSelectedLangs(initialLangs);

        // Restore from Redis for problems not found in localStorage
        const missingIds = sessionProblems
          .filter((p) => initialCodes[p.problemId] === undefined)
          .map((p) => p.problemId);

        if (missingIds.length > 0 && session.status === "in_progress") {
          try {
            const drafts = await getExamDrafts(sessionId);
            for (const [pidStr, draft] of Object.entries(drafts)) {
              const pid = Number(pidStr);
              if (missingIds.includes(pid)) {
                setCodes((prev) => ({ ...prev, [pid]: draft.code }));
                setSelectedLangs((prev) => ({
                  ...prev,
                  [pid]: enabledLanguageIds.has(draft.language)
                    ? draft.language
                    : defaultLang,
                }));
                localStorage.setItem(
                  `oct:draft:${sessionId}:${pid}`,
                  JSON.stringify({
                    ...draft,
                    language: enabledLanguageIds.has(draft.language)
                      ? draft.language
                      : defaultLang,
                  }),
                );
              }
            }
          } catch {
            // Redis restore failed — draft code may be missing, editor will be empty
          }
        }
      } catch {
        setLoadError("無法載入考試，請重新整理頁面或聯繫面試官。");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionId]);

  // Ensure every problem has a language entry once both languages and problems are loaded.
  // This guards against any render where selectedLangs is still {} but languages are available,
  // so the controlled <select> always has a matching value and never shows value="".
  useEffect(() => {
    if (languages.length === 0 || problems.length === 0) return;
    setSelectedLangs((prev) => {
      const defaultLang = languages[0].language;
      const next: Record<number, string> = { ...prev };
      let changed = false;
      for (const p of problems) {
        if (!next[p.problemId]) {
          next[p.problemId] = defaultLang;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [languages, problems]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      if (lsDebounceRef.current) clearTimeout(lsDebounceRef.current);
      if (apiDebounceRef.current) clearTimeout(apiDebounceRef.current);
    };
  }, []);

  // Reset selected case when switching problems
  useEffect(() => {
    setActiveCaseIdx(0);
  }, [activeProblemId]);

  // Fetch public testcases once per exam session problem (cached by espId)
  useEffect(() => {
    const espId = problems.find((p) => p.problemId === activeProblemId)?.id;
    if (espId === undefined) return;
    if (fetchedEspIds.current.has(espId)) return;
    fetchedEspIds.current.add(espId);
    getPublicTestcases(sessionId, espId)
      .then((testcases) =>
        setPublicTestcases((prev) => ({ ...prev, [espId]: testcases })),
      )
      .catch(() => {});
  }, [problems, activeProblemId, sessionId]);

  const timeLeft = useExamTimer(expiresAt);

  const activeProblem = problems.find((p) => p.problemId === activeProblemId);
  const currentCode = codes[activeProblemId] ?? "";
  const currentLang =
    selectedLangs[activeProblemId] ?? languages[0]?.language ?? "";
  const monacoLang = currentLang
    ? (MONACO_LANG[currentLang] ?? currentLang)
    : "plaintext";

  function handleCodeChange(value: string | undefined) {
    const code = value ?? "";
    setCodes((prev) => ({ ...prev, [activeProblemId]: code }));

    const lang = selectedLangs[activeProblemId] ?? languages[0]?.language ?? "";
    const lsKey = `oct:draft:${sessionId}:${activeProblemId}`;

    if (lsDebounceRef.current) clearTimeout(lsDebounceRef.current);
    lsDebounceRef.current = setTimeout(() => {
      localStorage.setItem(lsKey, JSON.stringify({ code, language: lang }));
    }, 1000);

    if (apiDebounceRef.current) clearTimeout(apiDebounceRef.current);
    apiDebounceRef.current = setTimeout(() => {
      if (sessionStatus !== "in_progress") return;
      saveExamDraft(sessionId, activeProblemId, { code, language: lang }).catch(
        (err) => console.error("[ExamPage] auto-save draft failed:", err),
      );
    }, 5000);
  }

  function handleTabSwitch(problemId: number) {
    // Flush current draft to localStorage immediately before switching
    const lang = selectedLangs[activeProblemId] ?? languages[0]?.language ?? "";
    const lsKey = `oct:draft:${sessionId}:${activeProblemId}`;
    localStorage.setItem(
      lsKey,
      JSON.stringify({ code: codes[activeProblemId] ?? "", language: lang }),
    );
    setActiveProblemId(problemId);
  }

  function handleDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: leftWidth };

    function onMouseMove(ev: MouseEvent) {
      if (!dragState.current) return;
      const delta = ev.clientX - dragState.current.startX;
      setLeftWidth(
        Math.min(700, Math.max(240, dragState.current.startWidth + delta)),
      );
    }

    function onMouseUp() {
      dragState.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  async function sendSubmission(type: "simple" | "formal") {
    if (!activeProblem || currentCode.trim().length === 0) return;

    const created = await createSubmission(sessionId, {
      examSessionProblemId: activeProblem.id,
      language: currentLang,
      sourceCode: currentCode,
      type,
    });

    const summary: SubmissionSummary = {
      ...created,
      problemId: activeProblem.problemId,
      problemTitle: activeProblem.title,
      orderIndex: activeProblem.orderIndex,
      score: 0,
      scoreWeight: activeProblem.scoreWeight,
      isFinalSubmission: false,
    };

    setSubmissions((prev) => [...prev, summary]);
    setLatestSubmissionId(summary.id);
    setBottomTab(type === "simple" ? "output" : "history");
  }

  function handleRun() {
    setBottomTab("output");
    void sendSubmission("simple");
  }

  function handleSubmit() {
    setBottomTab("history");
    void sendSubmission("formal");
  }

  async function handleFinishExam() {
    if (!window.confirm("確定要提前結束考試嗎？交卷後將無法再次提交。")) return;
    await submitExamSession(sessionId);
    navigate(`/exam/${sessionId}/result`);
  }

  const reloadSubmissions = useCallback(async () => {
    const history = await listSessionSubmissions(sessionId);
    setSubmissions(history);
    setLatestSubmissionId(history.at(-1)?.id ?? null);
  }, [sessionId]);

  const handleJudgeSocketMessage = useCallback(
    (message: JudgeSocketMessage) => {
      if (message.type === "submission_status") {
        setSubmissions((prev) =>
          prev.map((submission) =>
            submission.id === message.submissionId
              ? {
                  ...submission,
                  status: message.status,
                  judgedAt: message.judgedAt,
                }
              : submission,
          ),
        );
        setLatestSubmissionId(message.submissionId);
        return;
      }

      setSubmissions((prev) =>
        prev.map((submission) =>
          submission.id === message.submissionId
            ? {
                ...submission,
                status: message.status,
                verdict: message.verdict,
                runtimeMs: message.runtimeMs,
                memoryKb: message.memoryKb,
                judgedAt: message.judgedAt,
                score: message.score,
                isFinalSubmission:
                  message.submissionType === "formal" && message.score > 0,
              }
            : submission,
        ),
      );
      setLatestSubmissionId(message.submissionId);
      setPublicResultsBySubmission((prev) => ({
        ...prev,
        [message.submissionId]: message.testcaseResults.filter(
          (result) => result.isPublic,
        ),
      }));

      if (message.submissionType === "formal") {
        setProblems((prev) =>
          prev.map((problem) =>
            problem.id === message.examSessionProblemId
              ? { ...problem, score: message.score }
              : problem,
          ),
        );
      }
    },
    [],
  );

  useJudgeSocket(sessionId, handleJudgeSocketMessage, reloadSubmissions);

  const isExpired = timeLeft !== null && timeLeft === 0;
  const isSubmitted = sessionStatus === "submitted";
  const isLocked = isExpired || isSubmitted || sessionStatus === "expired";
  const latestSubmission =
    submissions.find((submission) => submission.id === latestSubmissionId) ??
    null;

  const activeProblemLatestSubmission = activeProblem
    ? (submissions
        .filter((s) => s.examSessionProblemId === activeProblem.id)
        .at(-1) ?? null)
    : null;
  const activePublicResults: TestcaseResult[] = activeProblemLatestSubmission
    ? (publicResultsBySubmission[activeProblemLatestSubmission.id] ?? [])
    : [];
  const currentTestcases: PublicTestcase[] =
    activeProblem !== undefined
      ? (publicTestcases[activeProblem.id] ?? [])
      : [];

  if (Number.isNaN(sessionId)) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
        <NavBar homeHref="/candidate" />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-red-500">無效的考試連結。</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
        <NavBar homeHref="/candidate" />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-slate-400">載入中...</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
        <NavBar homeHref="/candidate" />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-red-500">{loadError}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen flex flex-col overflow-hidden bg-slate-50">
      <NavBar homeHref="/candidate" />

      {/* Problem tabs + Timer */}
      <div
        className="h-10 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0"
        aria-label="考試工具列"
      >
        <div className="flex items-center gap-1 h-full" role="tablist">
          {problems.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={activeProblemId === p.problemId}
              onClick={() => handleTabSwitch(p.problemId)}
              className={`h-full px-4 text-sm font-medium border-b-2 transition-colors ${
                activeProblemId === p.problemId
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {p.orderIndex}. {p.title}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {isSubmitted && (
            <span className="text-xs font-medium text-green-600">已交卷</span>
          )}
          {sessionStatus === "in_progress" && (
            <button
              type="button"
              onClick={() => void handleFinishExam()}
              className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              提前結束考試
            </button>
          )}
          <span
            aria-label="倒數計時"
            className={`text-sm font-mono font-medium tabular-nums ${
              timeLeft !== null && timeLeft < 300
                ? "text-red-500"
                : "text-slate-600"
            }`}
          >
            {timeLeft !== null ? formatTimeLeft(timeLeft) : "--:--:--"}
          </span>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Problem description */}
        <aside
          className="shrink-0 overflow-y-auto bg-white"
          style={{ width: leftWidth }}
          aria-label="題目描述"
        >
          {activeProblem && (
            <div className="px-6 py-5">
              <div className="flex items-center gap-2 mb-4">
                <h1 className="text-base font-semibold text-slate-900">
                  {activeProblem.orderIndex}. {activeProblem.title}
                </h1>
              </div>
              <div className="flex gap-4 text-xs text-slate-500 mb-5">
                <span>時間限制：{activeProblem.timeLimitMs} ms</span>
                <span>記憶體限制：{activeProblem.memoryLimitMb} MB</span>
              </div>
              <div className="prose prose-sm prose-slate max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {activeProblem.descriptionMd}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </aside>

        {/* Drag divider */}
        <div
          onMouseDown={handleDividerMouseDown}
          className="w-1 shrink-0 bg-slate-200 hover:bg-blue-400 active:bg-blue-500 cursor-col-resize transition-colors select-none"
          role="separator"
          aria-label="調整面板寬度"
        />

        {/* Right: Editor + Bottom panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Language selector bar */}
          <div className="h-10 bg-white border-b border-slate-200 flex items-center px-3 gap-3 shrink-0">
            <label
              htmlFor="language-select"
              className="text-xs text-slate-500 shrink-0"
            >
              語言
            </label>
            <select
              id="language-select"
              value={currentLang}
              onChange={(e) => {
                const newLang = e.target.value;
                setSelectedLangs((prev) => ({
                  ...prev,
                  [activeProblemId]: newLang,
                }));
                const code = codes[activeProblemId] ?? "";
                localStorage.setItem(
                  `oct:draft:${sessionId}:${activeProblemId}`,
                  JSON.stringify({ code, language: newLang }),
                );
                if (sessionStatus === "in_progress") {
                  saveExamDraft(sessionId, activeProblemId, {
                    code,
                    language: newLang,
                  }).catch((err) =>
                    console.error("[ExamPage] auto-save draft failed:", err),
                  );
                }
              }}
              className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 outline-none focus:border-blue-400"
            >
              {languages.map((lang) => (
                <option key={lang.language} value={lang.language}>
                  {lang.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Monaco Editor */}
          <div className="flex-1 min-h-0">
            <Editor
              key={monacoLang}
              height="100%"
              language={monacoLang}
              value={currentCode}
              onChange={handleCodeChange}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>

          {/* Bottom panel */}
          <div
            className="h-52 shrink-0 border-t border-slate-200 bg-white flex flex-col"
            aria-label="底部面板"
          >
            {/* Tab bar + action buttons */}
            <div className="h-10 flex items-center justify-between px-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-1 h-full" role="tablist">
                {(
                  [
                    { key: "testcases", label: "測試資料" },
                    { key: "output", label: "執行結果" },
                    { key: "history", label: "提交記錄" },
                  ] as { key: BottomTab; label: string }[]
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={bottomTab === t.key}
                    onClick={() => setBottomTab(t.key)}
                    className={`h-full px-3 text-xs font-medium border-b-2 transition-colors ${
                      bottomTab === t.key
                        ? "border-blue-500 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={isLocked}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors"
                >
                  Run
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isLocked}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black transition-colors"
                >
                  Submit
                </button>
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-4 py-3 text-xs text-slate-400">
              {bottomTab === "testcases" &&
                (currentTestcases.length === 0 ? (
                  <p className="text-center py-6">暫無公開測試資料</p>
                ) : (
                  <div className="space-y-2">
                    {/* Case selector buttons */}
                    <div className="flex gap-1 flex-wrap">
                      {currentTestcases.map((tc, idx) => {
                        const result = activePublicResults.find(
                          (r) => r.testcaseId === tc.id,
                        );
                        const isActive = idx === activeCaseIdx;
                        const verdictColor =
                          result?.verdict === "AC"
                            ? isActive
                              ? "bg-green-600 text-white border-green-600"
                              : "border-green-400 text-green-600 hover:bg-green-50"
                            : result
                              ? isActive
                                ? "bg-red-500 text-white border-red-500"
                                : "border-red-400 text-red-500 hover:bg-red-50"
                              : isActive
                                ? "bg-blue-500 text-white border-blue-500"
                                : "border-slate-200 text-slate-600 hover:bg-slate-50";
                        return (
                          <button
                            key={tc.id}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => setActiveCaseIdx(idx)}
                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1 ${verdictColor}`}
                          >
                            Case {tc.orderIndex}
                          </button>
                        );
                      })}
                    </div>
                    {/* Active case detail */}
                    {(() => {
                      const tc = currentTestcases[activeCaseIdx];
                      if (!tc) return null;
                      const result = activePublicResults.find(
                        (r) => r.testcaseId === tc.id,
                      );
                      return (
                        <div className="rounded-md border border-slate-100 px-3 py-2 text-slate-600 space-y-2">
                          {result && (
                            <span
                              className={`text-xs font-semibold ${result.verdict === "AC" ? "text-green-600" : "text-red-500"}`}
                            >
                              {result.verdict}
                            </span>
                          )}
                          <div>
                            <span className="font-semibold text-slate-600">
                              Sample Input：
                            </span>
                            <pre className="whitespace-pre-wrap mt-0.5">
                              {tc.inputData}
                            </pre>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-600">
                              Sample Output：
                            </span>
                            <pre className="whitespace-pre-wrap mt-0.5">
                              {tc.expectedOutput}
                            </pre>
                          </div>
                          {result?.actualOutput != null && (
                            <div>
                              <span className="font-semibold text-slate-600">
                                Your Output：
                              </span>
                              <pre className="whitespace-pre-wrap mt-0.5">
                                {result.actualOutput}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              {bottomTab === "output" &&
                (latestSubmission ? (
                  <div className="space-y-2 text-slate-600">
                    <p>
                      {latestSubmission.submissionType === "simple"
                        ? "一般"
                        : "正式"}
                      提交：
                      {latestSubmission.status === "done"
                        ? latestSubmission.verdict
                        : latestSubmission.status}
                    </p>
                    {latestSubmission.runtimeMs !== null && (
                      <p>執行時間：{latestSubmission.runtimeMs} ms</p>
                    )}
                  </div>
                ) : (
                  <p className="text-center py-6">尚未執行</p>
                ))}
              {bottomTab === "history" &&
                (submissions.length === 0 ? (
                  <p className="text-center py-6">尚無提交記錄</p>
                ) : (
                  <div className="space-y-2">
                    {submissions.map((submission) => (
                      <div
                        key={submission.id}
                        className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-slate-600"
                      >
                        <span>
                          {submission.orderIndex}. {submission.problemTitle}
                        </span>
                        <span>
                          {submission.submissionType === "simple"
                            ? "一般"
                            : "正式"}
                        </span>
                        <span>{submission.verdict ?? submission.status}</span>
                        <span>{submission.language}</span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Expired overlay */}
      {isExpired && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/80"
          aria-label="考試時間已到"
        >
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full mx-4 text-center shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              考試時間已到
            </h2>
            <p className="text-sm text-slate-500">
              您的作答已自動提交，請聯繫面試官。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
