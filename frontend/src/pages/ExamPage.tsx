import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NavBar } from "../components/NavBar";
import type { ExamSessionProblem, Language } from "../types";
import { getLanguages } from "../api/client";
import { getMonacoMode } from "../config/languages";

type BottomTab = "testcases" | "output" | "history";

const PLACEHOLDER_PROBLEMS: ExamSessionProblem[] = [
  {
    id: 1,
    orderIndex: 1,
    scoreWeight: 50,
    score: 0,
    problemId: 1,
    title: "Two Sum",
    descriptionMd:
      "## Two Sum\n\nGiven an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.\n\n**Example 1:**\n\n```\nInput: nums = [2,7,11,15], target = 9\nOutput: [0,1]\n```\n\n**Constraints:**\n- `2 <= nums.length <= 10^4`\n- `-10^9 <= nums[i] <= 10^9`",
    difficulty: "easy",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    outputLimitKb: 64,
    languageLimits: [],
  },
  {
    id: 2,
    orderIndex: 2,
    scoreWeight: 50,
    score: 0,
    problemId: 2,
    title: "Binary Search",
    descriptionMd:
      "## Binary Search\n\nGiven an array of integers `nums` which is sorted in ascending order, and an integer `target`, write a function to search `target` in `nums`.\n\nIf `target` exists, return its index. Otherwise, return `-1`.\n\n**Example 1:**\n\n```\nInput: nums = [-1,0,3,5,9,12], target = 9\nOutput: 4\n```\n\n**Constraints:**\n- `1 <= nums.length <= 10^4`\n- All integers in `nums` are unique.",
    difficulty: "medium",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    outputLimitKb: 64,
    languageLimits: [],
  },
];

function formatTimeLeft(seconds: number): string {
  if (seconds <= 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export default function ExamPage() {
  const problems = PLACEHOLDER_PROBLEMS;
  const [languages, setLanguages] = useState<Language[]>([]);

  const [activeProblemId, setActiveProblemId] = useState<number>(
    problems[0]?.id ?? 0,
  );
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [bottomTab, setBottomTab] = useState<BottomTab>("testcases");
  const [expiresAt] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [leftWidth, setLeftWidth] = useState(420);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

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

  useEffect(() => {
    getLanguages()
      .then((data) => {
        const enabled = data.filter((l) => l.isEnabled);
        setLanguages(enabled);
        setSelectedLanguage((prev) => prev || (enabled[0]?.language ?? ""));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!expiresAt) {
      setTimeLeft(null);
      return;
    }
    const calc = () =>
      Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
    setTimeLeft(calc());
    const interval = setInterval(() => setTimeLeft(calc()), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const activeProblem = problems.find((p) => p.id === activeProblemId);
  const currentCode = codes[activeProblemId] ?? "";
  const monacoLang = getMonacoMode(selectedLanguage);

  function handleCodeChange(value: string | undefined) {
    setCodes((prev) => ({ ...prev, [activeProblemId]: value ?? "" }));
  }

  function handleRun() {
    setBottomTab("output");
  }

  function handleSubmit() {
    setBottomTab("history");
  }

  const isExpired = timeLeft !== null && timeLeft === 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50">
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
              aria-selected={activeProblemId === p.id}
              onClick={() => setActiveProblemId(p.id)}
              className={`h-full px-4 text-sm font-medium border-b-2 transition-colors ${
                activeProblemId === p.id
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {p.orderIndex}. {p.title}
            </button>
          ))}
        </div>
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
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
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
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors"
                >
                  Run
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black transition-colors"
                >
                  Submit
                </button>
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-4 py-3 text-xs text-slate-400">
              {bottomTab === "testcases" && (
                <p className="text-center py-6">暫無公開測試資料</p>
              )}
              {bottomTab === "output" && (
                <p className="text-center py-6">尚未執行</p>
              )}
              {bottomTab === "history" && (
                <p className="text-center py-6">尚無提交記錄</p>
              )}
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
