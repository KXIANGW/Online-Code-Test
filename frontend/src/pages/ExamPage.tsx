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
  SubmissionCreated,
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
import { STORAGE_KEYS } from "../config/storage";
import { ROUTES } from "../config/routes";

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
  const [selectedLangs, setSelectedLangs] = useState<Record<number, string>>({});
  // codes keyed by composite "${problemId}:${language}" to preserve per-language drafts
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [bottomTab, setBottomTab] = useState<BottomTab>("testcases");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<ExamStatus>("not_started");
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [runResult, setRunResult] = useState<SubmissionCreated | null>(null);
  const [publicResultsBySubmission, setPublicResultsBySubmission] = useState<
    Record<number, TestcaseResult[]>
  >({});
  const [publicTestcases, setPublicTestcases] = useState<Record<number, PublicTestcase[]>>({});
  const [activeCaseIdx, setActiveCaseIdx] = useState(0);
  const [leftWidth, setLeftWidth] = useState(420);
  const [bottomHeight, setBottomHeight] = useState(208);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const vertDragState = useRef<{ startY: number; startHeight: number } | null>(null);
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
        const enabledLanguageIds = new Set(enabledLangs.map((lang) => lang.language));
        setProblems(sessionProblems);
        setLanguages(enabledLangs);
        setSessionStatus(session.status);
        setSubmissions(history.filter((s) => s.submissionType === "formal"));
        if (session.expiresAt) setExpiresAt(session.expiresAt);
        if (sessionProblems.length > 0) setActiveProblemId(sessionProblems[0].problemId);

        const defaultLang = enabledLangs[0]?.language ?? "";
        // codes keyed by "${problemId}:${language}"
        const initialCodes: Record<string, string> = {};
        const initialLangs: Record<number, string> = {};

        for (const p of sessionProblems) {
          // Restore code for each enabled language from per-language localStorage keys
          for (const lang of enabledLangs) {
            const lsKey = STORAGE_KEYS.draftKey(sessionId, p.problemId, lang.language);
            const code = localStorage.getItem(lsKey);
            if (code !== null) {
              initialCodes[`${p.problemId}:${lang.language}`] = code;
            }
          }
          // Restore the last-used language from a separate key
          const lastLang = localStorage.getItem(STORAGE_KEYS.langKey(sessionId, p.problemId));
          initialLangs[p.problemId] =
            lastLang && enabledLanguageIds.has(lastLang) ? lastLang : defaultLang;
        }

        setCodes(initialCodes);
        setSelectedLangs(initialLangs);

        // Restore from Redis for problems with no localStorage data for any language
        const missingIds = sessionProblems
          .filter((p) =>
            enabledLangs.every(
              (lang) => initialCodes[`${p.problemId}:${lang.language}`] === undefined,
            ),
          )
          .map((p) => p.problemId);

        if (missingIds.length > 0 && session.status === "in_progress") {
          try {
            // drafts: Record<"problemId:language", code>
            const drafts = await getExamDrafts(sessionId);
            for (const [key, code] of Object.entries(drafts)) {
              const colonIdx = key.indexOf(":");
              const pid = Number(key.slice(0, colonIdx));
              const lang = key.slice(colonIdx + 1);
              if (!missingIds.includes(pid)) continue;
              if (!enabledLanguageIds.has(lang)) continue;
              setCodes((prev) => ({ ...prev, [`${pid}:${lang}`]: code }));
              localStorage.setItem(STORAGE_KEYS.draftKey(sessionId, pid, lang), code);
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
      .then((testcases) => setPublicTestcases((prev) => ({ ...prev, [espId]: testcases })))
      .catch(() => {});
  }, [problems, activeProblemId, sessionId]);

  const timeLeft = useExamTimer(expiresAt);

  const activeProblem = problems.find((p) => p.problemId === activeProblemId);
  const currentLang = selectedLangs[activeProblemId] ?? languages[0]?.language ?? "";
  const currentCode = codes[`${activeProblemId}:${currentLang}`] ?? "";
  const monacoLang = currentLang ? (MONACO_LANG[currentLang] ?? currentLang) : "plaintext";

  function handleCodeChange(value: string | undefined) {
    const code = value ?? "";
    const lang = selectedLangs[activeProblemId] ?? languages[0]?.language ?? "";
    setCodes((prev) => ({ ...prev, [`${activeProblemId}:${lang}`]: code }));

    const lsKey = STORAGE_KEYS.draftKey(sessionId, activeProblemId, lang);

    if (lsDebounceRef.current) clearTimeout(lsDebounceRef.current);
    lsDebounceRef.current = setTimeout(() => {
      localStorage.setItem(lsKey, code);
    }, 1000);

    if (apiDebounceRef.current) clearTimeout(apiDebounceRef.current);
    apiDebounceRef.current = setTimeout(() => {
      if (sessionStatus !== "in_progress") return;
      saveExamDraft(sessionId, activeProblemId, lang, { code }).catch((err) =>
        console.error("[ExamPage] auto-save draft failed:", err),
      );
    }, 5000);
  }

  function handleTabSwitch(problemId: number) {
    // Flush active language's draft to localStorage immediately before switching problems
    const lang = selectedLangs[activeProblemId] ?? languages[0]?.language ?? "";
    localStorage.setItem(
      STORAGE_KEYS.draftKey(sessionId, activeProblemId, lang),
      codes[`${activeProblemId}:${lang}`] ?? "",
    );
    setActiveProblemId(problemId);
  }

  function handleDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: leftWidth };

    function onMouseMove(ev: MouseEvent) {
      if (!dragState.current) return;
      const delta = ev.clientX - dragState.current.startX;
      setLeftWidth(Math.min(700, Math.max(240, dragState.current.startWidth + delta)));
    }

    function onMouseUp() {
      dragState.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function handleVertDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    vertDragState.current = { startY: e.clientY, startHeight: bottomHeight };

    function onMouseMove(ev: MouseEvent) {
      if (!vertDragState.current) return;
      const delta = vertDragState.current.startY - ev.clientY;
      setBottomHeight(Math.min(600, Math.max(80, vertDragState.current.startHeight + delta)));
    }

    function onMouseUp() {
      vertDragState.current = null;
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

    if (type === "simple") {
      setRunResult(created);
      setBottomTab("output");
    } else {
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
      setBottomTab("history");
    }
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
    setSubmissions(history.filter((s) => s.submissionType === "formal"));
  }, [sessionId]);

  const handleJudgeSocketMessage = useCallback((message: JudgeSocketMessage) => {
    if (message.type === "submission_status") {
      setRunResult((prev) =>
        prev?.id === message.submissionId
          ? { ...prev, status: message.status, judgedAt: message.judgedAt }
          : prev,
      );
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === message.submissionId
            ? { ...s, status: message.status, judgedAt: message.judgedAt }
            : s,
        ),
      );
      return;
    }

    // judge_result
    if (message.submissionType === "simple") {
      setRunResult((prev) =>
        prev?.id === message.submissionId
          ? {
              ...prev,
              status: message.status,
              verdict: message.verdict,
              runtimeMs: message.runtimeMs,
              memoryKb: message.memoryKb,
              judgedAt: message.judgedAt,
            }
          : prev,
      );
    } else {
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === message.submissionId
            ? {
                ...s,
                status: message.status,
                verdict: message.verdict,
                runtimeMs: message.runtimeMs,
                memoryKb: message.memoryKb,
                judgedAt: message.judgedAt,
                score: message.score,
                isFinalSubmission: message.score > 0,
              }
            : s,
        ),
      );
      setProblems((prev) =>
        prev.map((p) =>
          p.id === message.examSessionProblemId ? { ...p, score: message.score } : p,
        ),
      );
    }

    setPublicResultsBySubmission((prev) => ({
      ...prev,
      [message.submissionId]: message.testcaseResults.filter((r) => r.isPublic),
    }));
  }, []);

  useJudgeSocket(sessionId, handleJudgeSocketMessage, reloadSubmissions);

  const isExpired = timeLeft !== null && timeLeft === 0;
  const isSubmitted = sessionStatus === "submitted";
  const isLocked = isExpired || isSubmitted || sessionStatus === "expired";

  const activeRunResult = runResult?.examSessionProblemId === activeProblem?.id ? runResult : null;
  const activeProblemLatestFormal = activeProblem
    ? (submissions.filter((s) => s.examSessionProblemId === activeProblem.id).at(-1) ?? null)
    : null;
  const activeResultId = activeRunResult?.id ?? activeProblemLatestFormal?.id ?? null;
  const activePublicResults: TestcaseResult[] = activeResultId
    ? (publicResultsBySubmission[activeResultId] ?? [])
    : [];
  const currentTestcases: PublicTestcase[] =
    activeProblem !== undefined ? (publicTestcases[activeProblem.id] ?? []) : [];

  if (Number.isNaN(sessionId)) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
        <NavBar homeHref={ROUTES.CANDIDATE} />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-red-500">無效的考試連結。</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
        <NavBar homeHref={ROUTES.CANDIDATE} />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-slate-400">載入中...</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
        <NavBar homeHref={ROUTES.CANDIDATE} />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-red-500">{loadError}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen flex flex-col overflow-hidden bg-slate-50">
      <NavBar homeHref={ROUTES.CANDIDATE} />

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
          {isSubmitted && <span className="text-xs font-medium text-green-600">已交卷</span>}
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
              timeLeft !== null && timeLeft < 300 ? "text-red-500" : "text-slate-600"
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
            <label htmlFor="language-select" className="text-xs text-slate-500 shrink-0">
              語言
            </label>
            <select
              id="language-select"
              value={currentLang}
              onChange={(e) => {
                const newLang = e.target.value;

                // Flush current language's code to localStorage before switching
                localStorage.setItem(
                  STORAGE_KEYS.draftKey(sessionId, activeProblemId, currentLang),
                  currentCode,
                );

                // Load new language's code from localStorage (or empty)
                const newCode =
                  localStorage.getItem(
                    STORAGE_KEYS.draftKey(sessionId, activeProblemId, newLang),
                  ) ?? "";
                setCodes((prev) => ({
                  ...prev,
                  [`${activeProblemId}:${newLang}`]: newCode,
                }));

                // Persist last-used language for this problem
                localStorage.setItem(STORAGE_KEYS.langKey(sessionId, activeProblemId), newLang);

                setSelectedLangs((prev) => ({
                  ...prev,
                  [activeProblemId]: newLang,
                }));

                // Sync new language's draft to Redis if there is code to restore
                if (newCode && sessionStatus === "in_progress") {
                  saveExamDraft(sessionId, activeProblemId, newLang, {
                    code: newCode,
                  }).catch((err) => console.error("[ExamPage] auto-save draft failed:", err));
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

          {/* Vertical drag divider */}
          <div
            onMouseDown={handleVertDividerMouseDown}
            className="h-1 shrink-0 bg-slate-200 hover:bg-blue-400 active:bg-blue-500 cursor-row-resize transition-colors select-none"
            role="separator"
            aria-label="調整底部面板高度"
          />

          {/* Bottom panel */}
          <div
            className="shrink-0 border-slate-200 bg-white flex flex-col overflow-hidden"
            style={{ height: bottomHeight }}
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
                        const result = activePublicResults.find((r) => r.testcaseId === tc.id);
                        const isActive = idx === activeCaseIdx;
                        const verdictColor = isActive
                          ? "bg-slate-900 text-white border-transparent"
                          : result?.verdict === "AC"
                            ? "border-green-400 text-green-600 hover:bg-green-50"
                            : result
                              ? "border-red-400 text-red-500 hover:bg-red-50"
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
                      const result = activePublicResults.find((r) => r.testcaseId === tc.id);
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
                            <span className="font-semibold text-slate-600">Sample Input：</span>
                            <pre className="whitespace-pre-wrap mt-0.5">{tc.inputData}</pre>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-600">Sample Output：</span>
                            <pre className="whitespace-pre-wrap mt-0.5">{tc.expectedOutput}</pre>
                          </div>
                          {result?.actualOutput != null && (
                            <div>
                              <span className="font-semibold text-slate-600">Your Output：</span>
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
                (activeRunResult ? (
                  <div className="space-y-2 text-slate-600">
                    <p>
                      一般提交：
                      {activeRunResult.status === "done"
                        ? activeRunResult.verdict
                        : activeRunResult.status}
                    </p>
                    {activeRunResult.runtimeMs !== null && (
                      <p>執行時間：{activeRunResult.runtimeMs} ms</p>
                    )}
                  </div>
                ) : (
                  <p className="text-center py-6">尚未執行</p>
                ))}
              {bottomTab === "history" &&
                (() => {
                  const activeSubmissions = submissions.filter(
                    (s) => s.examSessionProblemId === activeProblem?.id,
                  );
                  return activeSubmissions.length === 0 ? (
                    <p className="text-center py-6">尚無提交記錄</p>
                  ) : (
                    <div className="space-y-2">
                      {activeSubmissions.map((submission) => (
                        <div
                          key={submission.id}
                          className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-slate-600"
                        >
                          <span>
                            {submission.orderIndex}. {submission.problemTitle}
                          </span>
                          <span>{submission.submissionType === "simple" ? "一般" : "正式"}</span>
                          <span>{submission.verdict ?? submission.status}</span>
                          <span>{submission.language}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
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
            <h2 className="text-xl font-semibold text-slate-900 mb-2">考試時間已到</h2>
            <p className="text-sm text-slate-500">您的作答已自動提交，請聯繫面試官。</p>
          </div>
        </div>
      )}
    </div>
  );
}
