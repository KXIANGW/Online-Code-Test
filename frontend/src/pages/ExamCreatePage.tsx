import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { NavBar } from "../components/NavBar";
import { getProblems, createExamSession, createUser } from "../api/client";
// 修正 Import路徑與類型名稱
import type {
  ProblemSummary,
  Difficulty,
  CreateExamSessionRequest,
  CreateUserRequest,
  RandomDistribution,
} from "../types";
import { DIFFICULTY_LABEL, DIFFICULTY_TEXT_COLOR } from "../config/difficulty";
import { ROUTES } from "../config/routes";

type ExamMode = "manual" | "random";
type DiffTab = Difficulty;

const DIFF_TABS: { value: DiffTab; label: string }[] = [
  { value: "easy", label: DIFFICULTY_LABEL.easy },
  { value: "medium", label: DIFFICULTY_LABEL.medium },
  { value: "hard", label: DIFFICULTY_LABEL.hard },
];

// ── 主組件 ──────────────────────────────────────────────────────────────────

export default function ExamCreatePage() {
  const navigate = useNavigate();

  // ── 密碼產生邏輯 ──
  const generateStrongPassword = (length = 12) => {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let retVal = "";
    const values = new Uint32Array(length);
    window.crypto.getRandomValues(values);
    for (let i = 0; i < length; i++) {
      retVal += charset.charAt(values[i] % charset.length);
    }
    return retVal;
  };

  // ── 狀態管理 ──
  const [pendingUser, setPendingUser] = useState<CreateUserRequest | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [mode, setMode] = useState<ExamMode>("manual");
  const [diffTab, setDiffTab] = useState<DiffTab>("easy");

  // 手動挑選題目暫存 (使用跟 ManualProblemEntry 相似但沒 orderIndex 的結構)
  const [selectedProblems, setSelectedProblems] = useState<
    { problemId: number; scoreWeight: number }[]
  >([]);

  // 隨機抽題分佈
  const [distribution, setDistribution] = useState<Required<RandomDistribution>>({
    easy: 0,
    medium: 0,
    hard: 0,
  });
  const [randomScoreWeight, setRandomScoreWeight] = useState(100);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 彈窗狀態
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalForm, setModalForm] = useState<CreateUserRequest>({
    username: "",
    password: "",
    displayName: "",
    roleNames: ["candidate"],
  });

  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(true);

  useEffect(() => {
    getProblems()
      .then(setProblems)
      .finally(() => setProblemsLoading(false));
  }, []);

  // ── 處理函式 ──

  const openCreateUserModal = () => {
    setModalForm({
      username: "",
      displayName: "",
      password: generateStrongPassword(),
      roleNames: ["candidate"],
    });
    setIsModalOpen(true);
  };

  const handleConfirmModal = () => {
    if (!modalForm.username) return;
    setPendingUser(modalForm);
    setIsModalOpen(false);
  };

  function toggleProblem(pId: number) {
    if (selectedProblems.some((sp) => sp.problemId === pId)) {
      setSelectedProblems(selectedProblems.filter((sp) => sp.problemId !== pId));
    } else {
      setSelectedProblems([...selectedProblems, { problemId: pId, scoreWeight: 100 }]);
    }
  }

  function updateScoreWeight(id: number, weight: number) {
    setSelectedProblems(
      selectedProblems.map((sp) => (sp.problemId === id ? { ...sp, scoreWeight: weight } : sp)),
    );
  }

  // 最終提交：連鎖 API 呼叫
  async function handleSubmit() {
    if (!pendingUser) {
      setSubmitError("請先設定面試者資訊");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // 1. 建立使用者帳號
      const newUser = await createUser(pendingUser);

      // 2. 準備 ExamSession 請求
      let req: CreateExamSessionRequest;

      if (mode === "manual") {
        if (selectedProblems.length === 0) throw new Error("請至少選擇一個題目");

        req = {
          candidateId: newUser.id,
          durationMinutes,
          problems: selectedProblems.map((sp, idx) => ({
            problemId: sp.problemId,
            scoreWeight: sp.scoreWeight,
            orderIndex: idx + 1, // 根據選擇順序賦予 Index
          })),
        };
      } else {
        const totalProblems = distribution.easy + distribution.medium + distribution.hard;
        if (totalProblems === 0) throw new Error("請至少在難度分佈中填寫一題");

        // 過濾掉為 0 的難度以符合 RandomDistribution 類型
        const finalDist: RandomDistribution = {};
        if (distribution.easy > 0) finalDist.easy = distribution.easy;
        if (distribution.medium > 0) finalDist.medium = distribution.medium;
        if (distribution.hard > 0) finalDist.hard = distribution.hard;

        req = {
          candidateId: newUser.id,
          durationMinutes,
          distribution: finalDist,
          scoreWeight: randomScoreWeight,
        };
      }

      await createExamSession(req);
      navigate(ROUTES.INTERVIEWER);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "建立失敗，請檢查資料正確性";
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

        <h1 className="text-xl font-semibold text-slate-800 mb-6">建立考試</h1>

        {problemsLoading ? (
          <p className="text-center py-12 text-slate-400">載入題目中...</p>
        ) : (
          <div className="space-y-5">
            {/* 基本設定 */}
            <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-medium text-slate-800">基本設定</h2>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">面試候選人</label>
                {pendingUser ? (
                  <div className="flex items-center gap-3">
                    <div className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-100 text-sm font-medium">
                      待建立：{pendingUser.displayName || pendingUser.username} (@
                      {pendingUser.username})
                    </div>
                    <button
                      onClick={openCreateUserModal}
                      className="text-xs text-slate-400 hover:text-blue-600 underline"
                    >
                      修改資訊
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openCreateUserModal}
                    className="flex items-center justify-center gap-2 w-full md:w-auto px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-all font-medium"
                  >
                    + 設定面試者帳號
                  </button>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  測驗時長（分鐘）
                </label>
                <input
                  type="number"
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
                        mode === m ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"
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
                            <span className={`text-xs ml-2 ${DIFFICULTY_TEXT_COLOR[p.difficulty]}`}>
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
                            setDistribution({
                              ...distribution,
                              [t.value]: Number(e.target.value),
                            })
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
                  {submitting ? "建立中..." : "建立考試"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 建立使用者帳號彈窗 */}
      <Dialog open={isModalOpen} onClose={() => setIsModalOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <DialogTitle className="text-lg font-bold text-slate-800 mb-5">
              設定面試者帳號
            </DialogTitle>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  帳號 (Username) *
                </label>
                <input
                  type="text"
                  aria-label="帳號"
                  value={modalForm.username}
                  onChange={(e) => setModalForm({ ...modalForm, username: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  密碼 (Password) *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={modalForm.password}
                    readOnly
                    className="flex-1 bg-slate-50 border rounded-lg px-3 py-2 text-sm font-mono text-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setModalForm({
                        ...modalForm,
                        password: generateStrongPassword(),
                      })
                    }
                    className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    🔄
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  顯示名稱 (Display Name)
                </label>
                <input
                  type="text"
                  value={modalForm.displayName}
                  onChange={(e) => setModalForm({ ...modalForm, displayName: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
            <div className="mt-8 flex gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-2 text-sm text-slate-500"
              >
                取消
              </button>
              <button
                onClick={handleConfirmModal}
                disabled={!modalForm.username}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                儲存設定
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}
