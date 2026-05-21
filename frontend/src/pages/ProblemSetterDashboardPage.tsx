import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getProblems, deleteProblem } from "../api/client";
import { NavBar } from "../components/NavBar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { Difficulty, ProblemSummary } from "../types";
import { DIFFICULTY_LABEL, DIFFICULTY_BADGE_COLOR } from "../config/difficulty";
import { ROUTES } from "../config/routes";

type DifficultyFilter = Difficulty | "all";

function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${DIFFICULTY_BADGE_COLOR[difficulty]}`}
    >
      {DIFFICULTY_LABEL[difficulty]}
    </span>
  );
}

export default function ProblemSetterDashboardPage() {
  const navigate = useNavigate();
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getProblems()
      .then(setProblems)
      .catch(() => setError("無法載入題目列表，請稍後再試。"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = problems.filter((p) => {
    const nameMatch = p.title.toLowerCase().includes(searchTerm.trim().toLowerCase());
    if (!nameMatch) return false;
    if (difficultyFilter !== "all") return p.difficulty === difficultyFilter;
    return true;
  });

  function handleDelete(id: number) {
    setDeleteTarget(id);
  }

  async function handleConfirmDelete() {
    if (deleteTarget === null) return;
    try {
      await deleteProblem(deleteTarget);
      setProblems((prev) => prev.filter((p) => p.id !== deleteTarget));
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref={ROUTES.PROBLEM_SETTER} />
      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">Problem Setter 控制台</p>
            <h1 className="text-2xl font-semibold text-slate-900">題目管理</h1>
          </div>
          <button
            type="button"
            onClick={() => navigate(ROUTES.PROBLEM_SETTER_NEW)}
            className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition"
          >
            + 新增題目
          </button>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center text-slate-600 shadow-sm">
            讀取中，請稍候...
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-6 text-base text-rose-700 shadow-sm">
            {error}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm text-slate-500">題目列表</p>
              <h2 className="text-lg font-semibold text-slate-900">全部題目</h2>
            </div>
            <span className="text-sm text-slate-500">總計 {problems.length} 題</span>
          </div>

          <div className="border-b border-slate-100 px-6 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { key: "all", label: "全部" },
                    { key: "easy", label: DIFFICULTY_LABEL.easy },
                    { key: "medium", label: DIFFICULTY_LABEL.medium },
                    { key: "hard", label: DIFFICULTY_LABEL.hard },
                  ] as { key: DifficultyFilter; label: string }[]
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setDifficultyFilter(f.key)}
                    className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      difficultyFilter === f.key
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="w-full sm:w-64">
                <label className="sr-only" htmlFor="problem-search">
                  搜尋題目
                </label>
                <input
                  id="problem-search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="以題目名稱搜尋"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          </div>

          <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100">
            {!loading && filtered.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-400">無符合條件的題目</p>
            ) : (
              filtered.map((problem) => (
                <div
                  key={problem.id}
                  className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{problem.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {problem.timeLimitMs} ms · {problem.memoryLimitMb} MB
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <DifficultyBadge difficulty={problem.difficulty} />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => navigate(ROUTES.problemEdit(problem.id))}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                      >
                        編輯
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(problem.id)}
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 whitespace-nowrap"
                      >
                        刪除
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="刪除題目"
        message="確定要刪除這道題目嗎？此操作無法復原。"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
