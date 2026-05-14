import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useAuthStore } from "../stores/authStore";
import { getUsers, getProblems, createExamSession } from "../api/client";
import type {
  UserSummary,
  ProblemSummary,
  Difficulty,
  CreateExamSessionRequest,
} from "../types";

type ExamMode = "manual" | "random";
type DiffTab = Difficulty;

interface SelectedProblem {
  problemId: number;
  scoreWeight: number;
}

function UserMenu() {
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const initials = username ? username.slice(0, 2).toUpperCase() : "??";

  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label="User menu"
        className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 transition-colors text-sm font-medium text-slate-700"
      >
        {initials}
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        className="z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white shadow-md text-sm focus:outline-none"
      >
        <div className="px-3 py-2 border-b border-slate-100">
          <p className="font-medium text-slate-800 truncate">{username}</p>
        </div>
        <div className="py-1">
          <MenuItem>
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-1.5 text-slate-600 hover:bg-slate-50 data-[focus]:bg-slate-50"
            >
              Log out
            </button>
          </MenuItem>
        </div>
      </MenuItems>
    </Menu>
  );
}

function NavBar() {
  return (
    <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6">
      <Link
        to="/interviewer"
        className="font-semibold text-slate-800 hover:text-slate-600 transition-colors"
      >
        Online Code Test
      </Link>
      <UserMenu />
    </header>
  );
}

const DIFF_TABS: { value: DiffTab; label: string }[] = [
  { value: "easy", label: "簡單" },
  { value: "medium", label: "中等" },
  { value: "hard", label: "困難" },
];

const DIFF_COLOR: Record<Difficulty, string> = {
  easy: "text-green-600",
  medium: "text-amber-500",
  hard: "text-red-500",
};

export default function ExamCreatePage() {
  const navigate = useNavigate();

  // ── form state ───────────────────────────────────────────────────────────────
  const [candidateId, setCandidateId] = useState<number | "">("");
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [mode, setMode] = useState<ExamMode>("manual");
  const [diffTab, setDiffTab] = useState<DiffTab>("easy");
  const [selectedProblems, setSelectedProblems] = useState<SelectedProblem[]>(
    [],
  );
  const [distribution, setDistribution] = useState({
    easy: 0,
    medium: 0,
    hard: 0,
  });
  const [randomScoreWeight, setRandomScoreWeight] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── data fetching ─────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState(false);
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(true);

  useEffect(() => {
    getUsers()
      .then((data) => setUsers(data.filter((u) => !u.isSuperuser)))
      .catch(() => setUsersError(true))
      .finally(() => setUsersLoading(false));

    getProblems()
      .then(setProblems)
      .finally(() => setProblemsLoading(false));
  }, []);

  // ── derived ───────────────────────────────────────────────────────────────────
  const tabProblems = problems
    .filter((p) => p.difficulty === diffTab)
    .sort((a, b) => a.title.localeCompare(b.title));

  const selectedIds = new Set(selectedProblems.map((s) => s.problemId));

  const totalScore =
    mode === "manual"
      ? selectedProblems.reduce((acc, s) => acc + s.scoreWeight, 0)
      : (distribution.easy + distribution.medium + distribution.hard) *
        randomScoreWeight;

  function toggleProblem(problemId: number) {
    setSelectedProblems((prev) => {
      if (prev.some((s) => s.problemId === problemId)) {
        return prev.filter((s) => s.problemId !== problemId);
      }
      return [...prev, { problemId, scoreWeight: 100 }];
    });
  }

  function updateScoreWeight(problemId: number, weight: number) {
    setSelectedProblems((prev) =>
      prev.map((s) => (s.problemId === problemId ? { ...s, scoreWeight: weight } : s)),
    );
  }

  // ── submit ────────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitError(null);

    if (candidateId === "") {
      setSubmitError("請選擇候選人");
      return;
    }
    if (durationMinutes <= 0) {
      setSubmitError("測驗時長須大於 0 分鐘");
      return;
    }

    let req: CreateExamSessionRequest;

    if (mode === "manual") {
      if (selectedProblems.length === 0) {
        setSubmitError("請至少選擇一題");
        return;
      }
      req = {
        candidateId,
        durationMinutes,
        problems: selectedProblems.map((s, idx) => ({
          problemId: s.problemId,
          scoreWeight: s.scoreWeight,
          orderIndex: idx + 1,
        })),
      };
    } else {
      const total =
        distribution.easy + distribution.medium + distribution.hard;
      if (total === 0) {
        setSubmitError("請至少選擇一題");
        return;
      }
      if (randomScoreWeight <= 0) {
        setSubmitError("每題配分須大於 0");
        return;
      }
      req = {
        candidateId,
        durationMinutes,
        distribution: {
          ...(distribution.easy > 0 ? { easy: distribution.easy } : {}),
          ...(distribution.medium > 0 ? { medium: distribution.medium } : {}),
          ...(distribution.hard > 0 ? { hard: distribution.hard } : {}),
        },
        scoreWeight: randomScoreWeight,
      };
    }

    setSubmitting(true);
    try {
      await createExamSession(req);
      navigate("/interviewer");
    } catch {
      setSubmitError("建立考試失敗，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  }

  const isLoading = usersLoading || problemsLoading;

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate("/interviewer")}
          className="text-sm text-slate-500 hover:text-slate-700 mb-6 flex items-center gap-1 transition-colors"
        >
          ← 返回考試管理
        </button>

        <h1 className="text-xl font-semibold text-slate-800 mb-6">建立考試</h1>

        {isLoading && (
          <p className="text-sm text-slate-400 text-center py-12">載入中...</p>
        )}

        {!isLoading && (
          <div className="space-y-5">
            {/* ── 基本設定 ──────────────────────────────────────────────── */}
            <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-medium text-slate-800">基本設定</h2>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  候選人
                </label>
                {usersError ? (
                  <p className="text-xs text-red-500">
                    無法載入候選人清單，請確認帳號權限
                  </p>
                ) : (
                  <select
                    aria-label="候選人"
                    value={candidateId}
                    onChange={(e) =>
                      setCandidateId(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">請選擇候選人</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName ?? u.username} (@{u.username})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  測驗時長（分鐘）
                </label>
                <input
                  aria-label="測驗時長"
                  type="number"
                  min={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </section>

            {/* ── 出題方式 ──────────────────────────────────────────────── */}
            <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="font-medium text-slate-800">出題方式</h2>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                  <button
                    type="button"
                    onClick={() => setMode("manual")}
                    className={`px-3 py-1.5 transition-colors ${
                      mode === "manual"
                        ? "bg-blue-600 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    手動選題
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("random")}
                    className={`px-3 py-1.5 transition-colors ${
                      mode === "random"
                        ? "bg-blue-600 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    隨機派題
                  </button>
                </div>
              </div>

              {/* Manual mode */}
              {mode === "manual" && (
                <div>
                  <div className="flex gap-1 border-b border-slate-200 mb-3">
                    {DIFF_TABS.map((tab) => {
                      const count = problems.filter(
                        (p) => p.difficulty === tab.value,
                      ).length;
                      return (
                        <button
                          key={tab.value}
                          type="button"
                          onClick={() => setDiffTab(tab.value)}
                          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            diffTab === tab.value
                              ? "border-blue-600 text-blue-600"
                              : "border-transparent text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          {tab.label} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {tabProblems.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">
                      此難度目前沒有題目
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {tabProblems.map((p) => {
                        const isSelected = selectedIds.has(p.id);
                        const sel = selectedProblems.find(
                          (s) => s.problemId === p.id,
                        );
                        return (
                          <li
                            key={p.id}
                            className="flex items-center gap-3 py-3"
                          >
                            <input
                              type="checkbox"
                              id={`problem-${p.id}`}
                              checked={isSelected}
                              onChange={() => toggleProblem(p.id)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600"
                            />
                            <label
                              htmlFor={`problem-${p.id}`}
                              className="flex-1 text-sm text-slate-800 cursor-pointer"
                            >
                              {p.title}
                              <span
                                className={`ml-2 text-xs ${DIFF_COLOR[p.difficulty]}`}
                              >
                                {p.timeLimitMs} ms
                              </span>
                            </label>
                            {isSelected && sel && (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  aria-label={`${p.title} 配分`}
                                  min={1}
                                  value={sel.scoreWeight}
                                  onChange={(e) =>
                                    updateScoreWeight(
                                      p.id,
                                      Number(e.target.value),
                                    )
                                  }
                                  className="w-20 border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-xs text-slate-500">分</span>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <p className="mt-3 text-xs text-slate-500">
                    已選 {selectedProblems.length} 題，總分 {totalScore} 分
                  </p>
                </div>
              )}

              {/* Random mode */}
              {mode === "random" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    {DIFF_TABS.map((tab) => (
                      <div key={tab.value}>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          {tab.label}（題）
                        </label>
                        <input
                          type="number"
                          aria-label={`隨機${tab.label}題數`}
                          min={0}
                          value={distribution[tab.value]}
                          onChange={(e) =>
                            setDistribution((prev) => ({
                              ...prev,
                              [tab.value]: Number(e.target.value),
                            }))
                          }
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      每題配分
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        aria-label="每題配分"
                        min={1}
                        value={randomScoreWeight}
                        onChange={(e) =>
                          setRandomScoreWeight(Number(e.target.value))
                        }
                        className="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-500">
                        分，預計總分 {totalScore} 分
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* ── 錯誤訊息 + 送出 ───────────────────────────────────────── */}
            {submitError && (
              <p className="text-sm text-red-500">{submitError}</p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "建立中..." : "建立考試"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
