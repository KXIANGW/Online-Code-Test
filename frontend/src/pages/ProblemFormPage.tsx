import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { NavBar } from "../components/NavBar";
import axios from "axios";
import {
  createProblem,
  getProblemById,
  updateProblem,
  addTestcase,
  deleteTestcase,
} from "../api/client";
import type { Difficulty, Testcase } from "../types";
import { ROUTES } from "../config/routes";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TestcaseRow {
  // undefined id = unsaved (new)
  id?: number;
  orderIndex: number;
  isPublic: boolean;
  inputData: string;
  outputData: string;
  inputFileName?: string;
  outputFileName?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ── Testcase row ───────────────────────────────────────────────────────────────

function TestcaseCard({
  row,
  onTogglePublic,
  onFileUpload,
  onDelete,
}: {
  row: TestcaseRow;
  onTogglePublic: () => void;
  onFileUpload: (field: "input" | "output", file: File) => void;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">測資 #{row.orderIndex + 1}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePublic}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
              row.isPublic
                ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {row.isPublic ? "公開" : "隱藏"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
          >
            刪除
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Input file */}
        <div>
          <p className="text-xs text-slate-500 mb-1">Input (.in)</p>
          <input
            ref={inputRef}
            type="file"
            accept=".in,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileUpload("input", file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-left text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600 transition"
          >
            {row.inputFileName ? (
              <span className="text-slate-700 font-medium">{row.inputFileName}</span>
            ) : (
              "點擊上傳 .in 檔"
            )}
          </button>
          {row.inputData && (
            <pre className="mt-1 max-h-20 overflow-auto rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {row.inputData}
            </pre>
          )}
        </div>

        {/* Output file */}
        <div>
          <p className="text-xs text-slate-500 mb-1">Output (.out)</p>
          <input
            ref={outputRef}
            type="file"
            accept=".out,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileUpload("output", file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => outputRef.current?.click()}
            className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-left text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600 transition"
          >
            {row.outputFileName ? (
              <span className="text-slate-700 font-medium">{row.outputFileName}</span>
            ) : (
              "點擊上傳 .out 檔"
            )}
          </button>
          {row.outputData && (
            <pre className="mt-1 max-h-20 overflow-auto rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {row.outputData}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ProblemFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [timeLimitMs, setTimeLimitMs] = useState(1000);
  const [memoryLimitMb, setMemoryLimitMb] = useState(256);
  const [descriptionMd, setDescriptionMd] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [testcases, setTestcases] = useState<TestcaseRow[]>([]);

  // Track which testcase ids existed on load (for deletion diff on edit)
  const [originalTcIds, setOriginalTcIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isEdit) return;
    getProblemById(Number(id))
      .then((problem) => {
        setTitle(problem.title);
        setDifficulty(problem.difficulty);
        setTimeLimitMs(problem.timeLimitMs);
        setMemoryLimitMb(problem.memoryLimitMb);
        setDescriptionMd(problem.descriptionMd);
        const rows: TestcaseRow[] = (problem.testcases as Testcase[]).map((tc) => ({
          id: tc.id,
          orderIndex: tc.orderIndex,
          isPublic: tc.isPublic,
          inputData: tc.inputData ?? "",
          outputData: tc.expectedOutput ?? "",
        }));
        setTestcases(rows);
        setOriginalTcIds(new Set(rows.filter((r) => r.id !== undefined).map((r) => r.id!)));
      })
      .catch(() => setLoadError(true));
  }, [id, isEdit]);

  function addTestcaseRow() {
    setTestcases((prev) => {
      const nextOrder = prev.length === 0 ? 0 : Math.max(...prev.map((tc) => tc.orderIndex)) + 1;
      return [...prev, { orderIndex: nextOrder, isPublic: false, inputData: "", outputData: "" }];
    });
  }

  function togglePublic(index: number) {
    setTestcases((prev) =>
      prev.map((tc, i) => (i === index ? { ...tc, isPublic: !tc.isPublic } : tc)),
    );
  }

  async function handleFileUpload(index: number, field: "input" | "output", file: File) {
    const text = await readFileAsText(file);
    setTestcases((prev) =>
      prev.map((tc, i) => {
        if (i !== index) return tc;
        return field === "input"
          ? { ...tc, inputData: text, inputFileName: file.name }
          : { ...tc, outputData: text, outputFileName: file.name };
      }),
    );
  }

  function removeTestcase(index: number) {
    setTestcases((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.map((tc, i) => ({ ...tc, orderIndex: i }));
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      alert("請輸入題目名稱");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        const problemId = Number(id);

        await updateProblem(problemId, {
          title: title.trim(),
          descriptionMd,
          difficulty,
          timeLimitMs,
          memoryLimitMb,
        });

        // Delete removed testcases
        const currentIds = new Set(
          testcases.filter((tc) => tc.id !== undefined).map((tc) => tc.id!),
        );
        for (const oid of originalTcIds) {
          if (!currentIds.has(oid)) {
            await deleteTestcase(problemId, oid);
          }
        }

        // Add new testcases (those without an id)
        for (const tc of testcases) {
          if (tc.id === undefined) {
            await addTestcase(problemId, {
              orderIndex: tc.orderIndex,
              isPublic: tc.isPublic,
              inputData: tc.inputData,
              expectedOutput: tc.outputData,
            });
          }
        }
      } else {
        await createProblem({
          title: title.trim(),
          descriptionMd,
          difficulty,
          timeLimitMs,
          memoryLimitMb,
          testcases: testcases.map((tc) => ({
            orderIndex: tc.orderIndex,
            isPublic: tc.isPublic,
            inputData: tc.inputData,
            expectedOutput: tc.outputData,
          })),
        });
      }

      alert("儲存成功！");
      navigate(ROUTES.PROBLEM_SETTER);
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? ((err.response?.data as { message?: string })?.message ?? err.message)
        : String(err);
      alert(`儲存失敗：${detail}`);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50">
        <NavBar homeHref={ROUTES.PROBLEM_SETTER} />
        <main className="max-w-3xl mx-auto px-4 py-8">
          <p className="text-sm text-red-500 text-center py-12">無法載入題目，請稍後再試。</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref={ROUTES.PROBLEM_SETTER} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <button
          type="button"
          onClick={() => navigate(ROUTES.PROBLEM_SETTER)}
          className="text-sm text-slate-500 hover:text-slate-700 mb-6 flex items-center gap-1 transition-colors"
        >
          ← 返回題目列表
        </button>

        <h1 className="text-2xl font-semibold text-slate-900 mb-6">
          {isEdit ? "編輯題目" : "建立新題目"}
        </h1>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* ── 基本資訊 ── */}
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-slate-800">基本資訊</h2>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">題目名稱</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="輸入題目名稱"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">難度</p>
              <div className="flex gap-4">
                {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                  <label
                    key={d}
                    className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="difficulty"
                      value={d}
                      checked={difficulty === d}
                      onChange={() => setDifficulty(d)}
                      className="accent-blue-600"
                    />
                    {d}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  時間限制 (ms)
                </label>
                <input
                  type="number"
                  min={1}
                  value={timeLimitMs}
                  onChange={(e) => setTimeLimitMs(Number(e.target.value))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  記憶體限制 (MB)
                </label>
                <input
                  type="number"
                  min={1}
                  value={memoryLimitMb}
                  onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          </section>

          {/* ── 題目描述 ── */}
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">題目描述</h2>
              <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  className={`px-3 py-1.5 transition ${
                    !showPreview
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  編輯
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  className={`px-3 py-1.5 transition ${
                    showPreview
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  預覽
                </button>
              </div>
            </div>

            {showPreview ? (
              <div className="prose prose-sm max-w-none min-h-[200px] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800">
                {descriptionMd ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                    {descriptionMd}
                  </ReactMarkdown>
                ) : (
                  <em className="text-slate-400">（尚無內容）</em>
                )}
              </div>
            ) : (
              <textarea
                value={descriptionMd}
                onChange={(e) => setDescriptionMd(e.target.value)}
                placeholder="以 Markdown 撰寫題目描述..."
                rows={12}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-mono text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-y"
              />
            )}
          </section>

          {/* ── 測試資料 ── */}
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">測試資料</h2>
              <span className="text-sm text-slate-500">{testcases.length} 筆</span>
            </div>

            {testcases.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">尚未新增測資</p>
            )}

            <div className="space-y-3">
              {testcases.map((tc, i) => (
                <TestcaseCard
                  key={i}
                  row={tc}
                  onTogglePublic={() => togglePublic(i)}
                  onFileUpload={(field, file) => handleFileUpload(i, field, file)}
                  onDelete={() => removeTestcase(i)}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={addTestcaseRow}
              className="w-full rounded-2xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-blue-400 hover:text-blue-600 transition"
            >
              + 新增測資
            </button>
          </section>

          {/* ── Actions ── */}
          <div className="flex justify-end gap-3 pb-8">
            <button
              type="button"
              onClick={() => navigate(ROUTES.PROBLEM_SETTER)}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {saving ? "儲存中..." : "儲存題目"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
