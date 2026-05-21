import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NavBar } from "../components/NavBar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EditCandidateDialog } from "../components/EditCandidateDialog";
import { useInterviewerStore } from "../stores/interviewerStore";
import { Toaster } from "react-hot-toast";
import {
  getExamSessions,
  getSessionResult,
  listExamTemplates,
  getUsers,
  assignExamToCandidates,
  getUserPassword,
  deleteExamTemplate,
} from "../api/client";
import type { ExamSession, ExamStatus, SessionResult, ExamTemplate, UserSummary } from "../types";
import { STATUS_COLOR, STATUS_LABEL } from "../config/examStatus";
import { DIFFICULTY_LABEL } from "../config/difficulty";
import { ROUTES } from "../config/routes";
import { copyToClipboard } from "../utils/clipboard";
import { getAssignableCandidates } from "../utils/assignmentEligibility";

function maskPassword(pw: string): string {
  if (pw.length <= 6) return "*".repeat(pw.length);
  return pw.slice(0, 3) + "*".repeat(pw.length - 6) + pw.slice(-3);
}

type MainTab = "candidates" | "templates" | "assignments" | "records";
type RecordTab = "all" | "in_progress" | "not_started" | "ended";

const MAIN_TABS: { value: MainTab; label: string }[] = [
  { value: "candidates", label: "考生帳號" },
  { value: "templates", label: "考試模板" },
  { value: "assignments", label: "考試分發" },
  { value: "records", label: "考試紀錄" },
];

const RECORD_TABS: { value: RecordTab; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "in_progress", label: "進行中" },
  { value: "not_started", label: "待考" },
  { value: "ended", label: "已結束" },
];

function StatusBadge({ status }: { status: ExamStatus }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function SessionCard({ result }: { result: SessionResult }) {
  const navigate = useNavigate();
  const name = result.candidate.displayName ?? result.candidate.username;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="font-medium text-slate-800">{name}</p>
          <StatusBadge status={result.status} />
        </div>
        {result.actualStartAt && (
          <p className="text-xs text-slate-400">
            測驗日期：{new Date(result.actualStartAt).toLocaleDateString("zh-TW")}
          </p>
        )}
        {(result.status === "submitted" || result.status === "expired") && (
          <p className="text-xs text-slate-500">
            {result.totalScore} / {result.maxScore} 分
          </p>
        )}
      </div>
      <button
        onClick={() => navigate(ROUTES.resultPage(result.id))}
        className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
      >
        查看結果
      </button>
    </div>
  );
}

export default function InterviewerDashboardPage() {
  const navigate = useNavigate();
  const results = useInterviewerStore((s) => s.results);
  const setResults = useInterviewerStore((s) => s.setResults);
  const templates = useInterviewerStore((s) => s.templates);
  const setTemplates = useInterviewerStore((s) => s.setTemplates);
  const candidates = useInterviewerStore((s) => s.candidates);
  const setCandidates = useInterviewerStore((s) => s.setCandidates);

  const [mainTab, setMainTab] = useState<MainTab>("templates");
  const [recordTab, setRecordTab] = useState<RecordTab>("all");
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<number>>(() => new Set());
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);
  const [assignmentSessions, setAssignmentSessions] = useState<ExamSession[]>([]);
  const [candidatePasswords, setCandidatePasswords] = useState<Map<number, string>>(
    () => new Map(),
  );
  const [templateToDelete, setTemplateToDelete] = useState<number | null>(null);
  const [editingCandidate, setEditingCandidate] = useState<UserSummary | null>(null);

  useEffect(() => {
    loadDashboardData().finally(() => setLoading(false));
  }, [setResults, setTemplates, setCandidates]);

  async function loadDashboardData() {
    const [sessions, templateList, userList] = await Promise.all([
      getExamSessions(),
      listExamTemplates(),
      getUsers(),
    ]);
    setAssignmentSessions(sessions);
    const resultList = await Promise.all(sessions.map((s) => getSessionResult(s.id)));
    setResults(resultList);
    setTemplates(templateList);
    const candidateUsers = userList.filter((u) => u.roles.includes("candidate"));
    setCandidates(candidateUsers);

    const pwResults = await Promise.allSettled(
      candidateUsers.map((c) =>
        getUserPassword(c.id).then((r) => [c.id, r.password] as [number, string]),
      ),
    );
    const pwMap = new Map<number, string>();
    pwResults.forEach((r) => {
      if (r.status === "fulfilled") pwMap.set(r.value[0], r.value[1]);
    });
    setCandidatePasswords(pwMap);
  }

  function toggleCandidate(candidateId: number) {
    setAssignError(null);
    setAssignSuccess(null);
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) {
        next.delete(candidateId);
      } else {
        next.add(candidateId);
      }
      return next;
    });
  }

  async function handleAssign() {
    const templateId = Number(selectedTemplateId);
    const candidateIds = Array.from(selectedCandidateIds);
    if (!templateId || candidateIds.length === 0) {
      setAssignError("請選擇模板與至少一位考生");
      return;
    }

    setAssigning(true);
    setAssignError(null);
    setAssignSuccess(null);
    try {
      await assignExamToCandidates(templateId, candidateIds);
      setAssignSuccess("分發成功");
      setSelectedCandidateIds(new Set());
      await loadDashboardData();
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "分發失敗";
      setAssignError(msg);
    } finally {
      setAssigning(false);
    }
  }

  function handleDeleteTemplate(templateId: number) {
    setTemplateToDelete(templateId);
  }

  async function handleConfirmDeleteTemplate() {
    if (templateToDelete === null) return;
    await deleteExamTemplate(templateToDelete);
    setTemplateToDelete(null);
    await loadDashboardData();
  }

  const filteredRecords =
    recordTab === "all"
      ? results
      : recordTab === "ended"
        ? results.filter((r) => r.status === "submitted" || r.status === "expired")
        : results.filter((r) => r.status === recordTab);
  const assignableCandidates = getAssignableCandidates(candidates, assignmentSessions);

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref={ROUTES.INTERVIEWER} />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-800 mb-6">考試管理</h1>

        {/* Main tabs */}
        <div className="flex gap-1 mb-6 border-b border-slate-200">
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setMainTab(tab.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                mainTab === tab.value
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 text-center py-12">載入中...</p>
        ) : (
          <>
            {/* Tab: 考生帳號 */}
            {mainTab === "candidates" && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-slate-600">
                    共管理 <span className="font-semibold text-slate-800">{candidates.length}</span>{" "}
                    位考生
                  </p>
                  <button
                    onClick={() => navigate(ROUTES.INTERVIEWER_CANDIDATES_NEW)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    ＋ 建立帳號
                  </button>
                </div>
                {candidates.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">目前沒有考生帳號</p>
                ) : (
                  <div className="space-y-2">
                    {candidates.map((c: UserSummary) => {
                      const plainPwd = candidatePasswords.get(c.id);
                      return (
                        <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-slate-800 text-sm">
                                {c.displayName ?? c.username}
                              </p>
                              <p className="text-xs text-slate-400">@{c.username}</p>
                            </div>
                            <p className="text-xs text-slate-400">
                              {new Date(c.createdAt).toLocaleDateString("zh-TW")}
                            </p>
                          </div>
                          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-slate-400">密碼：</span>
                            {plainPwd !== undefined ? (
                              <>
                                <span className="font-mono text-xs text-slate-700">
                                  {maskPassword(plainPwd)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(plainPwd)}
                                  aria-label={`複製 ${c.username} 密碼`}
                                  className="text-slate-400 hover:text-slate-700 transition-colors"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                  </svg>
                                </button>
                              </>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditingCandidate(c)}
                              className="ml-auto rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                              編輯
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab: 考試模板 */}
            {mainTab === "templates" && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-slate-600">
                    共 <span className="font-semibold text-slate-800">{templates.length}</span>{" "}
                    個模板
                  </p>
                  <button
                    onClick={() => navigate(ROUTES.INTERVIEWER_TEMPLATES_NEW)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    ＋ 建立模板
                  </button>
                </div>
                {templates.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">目前沒有考試模板</p>
                ) : (
                  <div className="space-y-3">
                    {templates.map((t: ExamTemplate) => {
                      const templateProblems = t.problems ?? [];
                      return (
                        <div key={t.id} className="bg-white rounded-xl border border-slate-200 p-5">
                          <div className="space-y-1">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-slate-800">{t.title}</p>
                                <p className="text-xs text-slate-400">
                                  {t.durationMinutes} 分鐘 ·{" "}
                                  {new Date(t.createdAt).toLocaleDateString("zh-TW")}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => navigate(ROUTES.templateEdit(t.id))}
                                  className="text-xs font-medium text-blue-600 hover:text-blue-800"
                                >
                                  編輯
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteTemplate(t.id)}
                                  className="text-xs font-medium text-red-500 hover:text-red-700"
                                >
                                  刪除
                                </button>
                              </div>
                            </div>
                          </div>
                          {templateProblems.length > 0 && (
                            <div className="mt-4 border-t border-slate-100 pt-3">
                              <p className="text-xs font-semibold text-slate-500 mb-2">題目</p>
                              <div className="space-y-2">
                                {templateProblems.map((problem) => (
                                  <div
                                    key={`${t.id}-${problem.problemId}`}
                                    className="flex items-center justify-between gap-3 text-sm"
                                  >
                                    <p className="font-medium text-slate-700">
                                      {problem.orderIndex}. {problem.title}
                                    </p>
                                    <p className="text-xs text-slate-400 whitespace-nowrap">
                                      {DIFFICULTY_LABEL[problem.difficulty]} · {problem.scoreWeight}{" "}
                                      分
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab: 考試分發 */}
            {mainTab === "assignments" && (
              <div className="space-y-5">
                <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                  <div>
                    <label
                      htmlFor="assignment-template"
                      className="block text-xs font-semibold text-slate-500 mb-1"
                    >
                      考試模板
                    </label>
                    <select
                      id="assignment-template"
                      aria-label="考試模板"
                      value={selectedTemplateId}
                      onChange={(e) => {
                        setSelectedTemplateId(e.target.value);
                        setAssignError(null);
                        setAssignSuccess(null);
                      }}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">請選擇考試模板</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title}（{template.durationMinutes} 分鐘）
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="block text-xs font-semibold text-slate-500 mb-2">選擇考生</p>
                    {assignableCandidates.length === 0 ? (
                      <p className="text-sm text-slate-400 py-4">目前沒有考生可分發</p>
                    ) : (
                      <div className="space-y-2 max-h-72 overflow-auto pr-1">
                        {assignableCandidates.map(({ candidate, pendingSession }) => {
                          const name = candidate.displayName ?? candidate.username;
                          return (
                            <label
                              key={candidate.id}
                              className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50"
                            >
                              <span>
                                <span className="block text-sm font-medium text-slate-800">
                                  {name}
                                </span>
                                <span className="block text-xs text-slate-400">
                                  @{candidate.username}
                                </span>
                                <span className="block text-xs text-slate-500 mt-1">
                                  {pendingSession
                                    ? `目前模板：${pendingSession.examTitle}`
                                    : "尚未分配模板"}
                                </span>
                              </span>
                              <input
                                type="checkbox"
                                checked={selectedCandidateIds.has(candidate.id)}
                                onChange={() => toggleCandidate(candidate.id)}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {assignError && <p className="text-xs text-red-500">{assignError}</p>}
                  {assignSuccess && <p className="text-xs text-green-600">{assignSuccess}</p>}
                  <button
                    type="button"
                    onClick={handleAssign}
                    disabled={assigning || !selectedTemplateId || selectedCandidateIds.size === 0}
                    className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {assigning ? "分發中..." : `確認分發（${selectedCandidateIds.size} 人）`}
                  </button>
                </div>
              </div>
            )}

            {/* Tab: 考試紀錄 */}
            {mainTab === "records" && (
              <div>
                <div className="flex gap-1 mb-4 border-b border-slate-200">
                  {RECORD_TABS.map((tab) => (
                    <button
                      key={tab.value}
                      onClick={() => setRecordTab(tab.value)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        recordTab === tab.value
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {filteredRecords.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">目前沒有考試紀錄</p>
                ) : (
                  <div className="space-y-3">
                    {filteredRecords.map((r) => (
                      <SessionCard key={r.id} result={r} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
      <Toaster position="bottom-center" reverseOrder={false} />
      <ConfirmDialog
        open={templateToDelete !== null}
        title="刪除考試模板"
        message="確定要刪除此考試模板嗎？已分發的考試與歷史紀錄不會受影響。"
        onConfirm={handleConfirmDeleteTemplate}
        onCancel={() => setTemplateToDelete(null)}
      />
      <EditCandidateDialog
        open={editingCandidate !== null}
        candidate={editingCandidate}
        onClose={() => setEditingCandidate(null)}
        onSaved={(id, newDisplayName) => {
          setCandidates(
            candidates.map((c) => (c.id === id ? { ...c, displayName: newDisplayName } : c)),
          );
          setEditingCandidate(null);
          loadDashboardData();
        }}
      />
    </div>
  );
}
