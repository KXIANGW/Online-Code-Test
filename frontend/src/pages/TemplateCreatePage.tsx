import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NavBar } from "../components/NavBar";
import { getProblems, createExamTemplateManual, createExamTemplateRandom } from "../api/client";
import { useInterviewerStore } from "../stores/interviewerStore";
import { DIFFICULTY_LABEL, DIFFICULTY_TEXT_COLOR } from "../config/difficulty";
import { ROUTES } from "../config/routes";
import type {
  ProblemSummary,
  Difficulty,
  CreateExamTemplateManualRequest,
  CreateExamTemplateRandomRequest,
  RandomDistribution,
} from "../types";

type ExamMode = "manual" | "random";
type DiffTab = Difficulty;

const DIFF_TABS: { value: DiffTab; label: string }[] = [
  { value: "easy", label: DIFFICULTY_LABEL.easy },
  { value: "medium", label: DIFFICULTY_LABEL.medium },
  { value: "hard", label: DIFFICULTY_LABEL.hard },
];

const DIFF_COLOR: Record<Difficulty, string> = DIFFICULTY_TEXT_COLOR;

export default function TemplateCreatePage() {
  const navigate = useNavigate();
  const setTemplates = useInterviewerStore((s) => s.setTemplates);

  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [mode, setMode] = useState<ExamMode>("manual");
  const [diffTab, setDiffTab] = useState<DiffTab>("easy");

  const [selectedProblems, setSelectedProblems] = useState<
    { problemId: number; scoreWeight: number }[]
  >([]);

  const [distribution, setDistribution] = useState<Required<RandomDistribution>>({
    easy: 0,
    medium: 0,
    hard: 0,
  });
  const [randomScoreWeight, setRandomScoreWeight] = useState(100);

  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    getProblems()
      .then(setProblems)
      .finally(() => setProblemsLoading(false));
  }, []);

  function toggleProblem(pId: number) {
    if (selectedProblems.some((sp) => sp.problemId === pId)) {
      setSelectedProblems(selectedProblems.filter((sp) => sp.problemId !== pId));
    } else {
      setSelectedProblems([...selectedProblems, { problemId: pId, scoreWeight: 100 }]);
    }
  }

  function updateScoreWeight(id: number, weight: number) {
    setSelectedProblems(
      selectedProblems.map((sp) =>
        sp.problemId === id ? { ...sp, scoreWeight: weight } : sp,
      ),
    );
  }

  async function handleSubmit() {
    if (!title.trim()) {
      setSubmitError("請填寫考試標題");
      return;
    }

    if (mode === "manual") {
      if (selectedProblems.length === 0) {
        setSubmitError("請至少選擇一個題目");
        return;
      }
    } else {
      const total = distribution.easy + distribution.medium + distribution.hard;
      if (total === 0) {
        setSubmitError("請至少在難度分佈中填寫一題");
        return;
      }
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      if (mode === "manual") {
        const req: CreateExamTemplateManualRequest = {
          title: title.trim(),
          durationMinutes,
          problems: selectedProblems.map((sp, idx) => ({
            problemId: sp.problemId,
            scoreWeight: sp.scoreWeight,
            orderIndex: idx + 1,
          })),
        };
        await createExamTemplateManual(req);
      } else {
        const finalDist: RandomDistribution = {};
        if (distribution.easy > 0) finalDist.easy = distribution.easy;
        if (distribution.medium > 0) finalDist.medium = distribution.medium;
        if (distribution.hard > 0) finalDist.hard = distribution.hard;

        const req: CreateExamTemplateRandomRequest = {
          title: title.trim(),
          durationMinutes,
          distribution: finalDist,
          scoreWeight: randomScoreWeight,
        };
        await createExamTemplateRandom(req);
      }

      // Invalidate store so dashboard re-fetches on next mount
      setTemplates([]);
      navigate(ROUTES.INTERVIEWER);
    } catch (err: any) {
      const msg =
        err.response?.data?.message || err.message || "建立失敗，請檢查資料正確性";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const filteredProblems = problems
    .filter((p) => p.difficulty === diffTab)
    .sort((a, b) => a.title.localeCompare(b.title));

  const totalScore =
    mode === "manual"
      ? selectedProblems.reduce((acc, sp) => acc + sp.scoreWeight, 0)
      : (distribution.easy + distribution.medium + distribution.hard) * randomScoreWeight;

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref={ROUTES.INTERVIEWER} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate(ROUTES.INTERVIEWER)}
          className="text-sm text-slate-500 hover:text-slate-700 mb-6 flex items-center gap-1"
        >
          ← 返回考試管理
        </button>

        <h1 className="text-xl font-semibold text-slate-800 mb-6">建立考試模板</h1>

        {problemsLoading ? (
          <p className="text-center py-12 text-slate-400">載入題目中...</p>
        ) : (
          <div className="space-y-5">
            {/* 基本設定 */}
            <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-medium text-slate-800">基本設定</h2>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  考試標題
                </label>
                <input
                  type="text"
                  aria-label="考試標題"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：後端工程師初試卷"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  測驗時長（分鐘）
                </label>
                <input
                  type="number"
                  aria-label="測驗時長"
                  min={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </section>

            {/* 出題方式 */}
            <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="font-medium text-slate-800">出題方式</h2>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                  {(["manual", "random"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-3 py-1.5 transition-colors ${
                        mode === m
                          ? "bg-blue-600 text-white"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {m === "manual" ? "手動選題" : "隨機派題"}
                    </button>
                  ))}
                </div>
              </div>

              {mode === "manual" ? (
                <div className="space-y-4">
                  <div className="flex gap-1 border-b border-slate-200 mb-3">
                    {DIFF_TABS.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => setDiffTab(t.value)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                          diffTab === t.value
                            ? "border-blue-600 text-blue-600"
                            : "border-transparent text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {t.label} ({problems.filter((p) => p.difficulty === t.value).length})
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {filteredProblems.map((p) => {
                      const sel = selectedProblems.find((sp) => sp.problemId === p.id);
                      return (
                        <div
                          key={p.id}
                          className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0"
                        >
                          <input
                            type="checkbox"
                            aria-label={p.title}
                            checked={!!sel}
                            onChange={() => toggleProblem(p.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                          <div className="flex-1 text-sm text-slate-800">
                            {p.title}{" "}
                            <span className={`text-xs ml-2 ${DIFF_COLOR[p.difficulty]}`}>
                              {p.timeLimitMs}ms
                            </span>
                          </div>
                          {sel && (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                aria-label={`${p.title} 配分`}
                                value={sel.scoreWeight}
                                onChange={(e) => updateScoreWeight(p.id, Number(e.target.value))}
                                className="w-20 border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                              />
                              <span className="text-xs text-slate-500">分</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    {DIFF_TABS.map((t) => (
                      <div key={t.value}>
                        <label className="block text-xs font-medium text-slate-500 mb-1">
                          {t.label}題數
                        </label>
                        <input
                          type="number"
                          aria-label={`隨機${t.label}題數`}
                          min={0}
                          value={distribution[t.value]}
                          onChange={(e) =>
                            setDistribution({ ...distribution, [t.value]: Number(e.target.value) })
                          }
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      每題配分
                    </label>
                    <input
                      type="number"
                      aria-label="每題配分"
                      min={1}
                      value={randomScoreWeight}
                      onChange={(e) => setRandomScoreWeight(Number(e.target.value))}
                      className="w-24 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
              )}
            </section>

            {/* 底部提交 */}
            <div className="flex items-center justify-between bg-slate-100 rounded-xl p-5">
              <div>
                <p className="text-xs text-slate-500 font-medium">預計總分</p>
                <p className="text-2xl font-bold text-slate-800">{totalScore} pts</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {submitError && <p className="text-xs text-red-500">{submitError}</p>}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="px-8 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-100"
                >
                  {submitting ? "建立中..." : "建立模板"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
