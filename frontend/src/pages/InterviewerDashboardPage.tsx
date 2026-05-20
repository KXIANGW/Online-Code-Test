import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NavBar } from "../components/NavBar";
import { useInterviewerStore } from "../stores/interviewerStore";
import {
  getExamSessions,
  getSessionResult,
  listExamTemplates,
  getUsers,
} from "../api/client";
import type { ExamStatus, SessionResult, ExamTemplate, UserSummary } from "../types";

const STATUS_LABEL: Record<ExamStatus, string> = {
  not_started: "待考",
  in_progress: "進行中",
  submitted: "已交卷",
  expired: "已逾時",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<ExamStatus, string> = {
  not_started: "bg-amber-50 text-amber-600",
  in_progress: "bg-blue-50 text-blue-600",
  submitted: "bg-green-50 text-green-600",
  expired: "bg-slate-100 text-slate-500",
  cancelled: "bg-slate-100 text-slate-400",
};

type MainTab = "candidates" | "templates" | "records";
type RecordTab = "all" | "in_progress" | "not_started" | "ended";

const MAIN_TABS: { value: MainTab; label: string }[] = [
  { value: "candidates", label: "考生帳號" },
  { value: "templates", label: "考試模板" },
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
        onClick={() => navigate(`/result/${result.id}`)}
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

  useEffect(() => {
    async function load() {
      try {
        const [sessions, templateList, userList] = await Promise.all([
          getExamSessions(),
          listExamTemplates(),
          getUsers(),
        ]);
        const resultList = await Promise.all(sessions.map((s) => getSessionResult(s.id)));
        setResults(resultList);
        setTemplates(templateList);
        setCandidates(userList.filter((u) => u.roles.includes("candidate")));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [setResults, setTemplates, setCandidates]);

  const filteredRecords =
    recordTab === "all"
      ? results
      : recordTab === "ended"
      ? results.filter((r) => r.status === "submitted" || r.status === "expired")
      : results.filter((r) => r.status === recordTab);

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref="/interviewer" />
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
                    共管理 <span className="font-semibold text-slate-800">{candidates.length}</span> 位考生
                  </p>
                  <button
                    onClick={() => navigate("/interviewer/candidates/new")}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    ＋ 建立帳號
                  </button>
                </div>
                {candidates.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">目前沒有考生帳號</p>
                ) : (
                  <div className="space-y-2">
                    {candidates.map((c: UserSummary) => (
                      <div
                        key={c.id}
                        className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between"
                      >
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
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab: 考試模板 */}
            {mainTab === "templates" && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-slate-600">
                    共 <span className="font-semibold text-slate-800">{templates.length}</span> 個模板
                  </p>
                  <button
                    onClick={() => navigate("/interviewer/templates/new")}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    ＋ 建立模板
                  </button>
                </div>
                {templates.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">目前沒有考試模板</p>
                ) : (
                  <div className="space-y-3">
                    {templates.map((t: ExamTemplate) => (
                      <div
                        key={t.id}
                        className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between"
                      >
                        <div className="space-y-1">
                          <p className="font-medium text-slate-800">{t.title}</p>
                          <p className="text-xs text-slate-400">
                            {t.durationMinutes} 分鐘 ·{" "}
                            {new Date(t.createdAt).toLocaleDateString("zh-TW")}
                          </p>
                        </div>
                        <button
                          onClick={() => navigate(`/interviewer/templates/${t.id}/assign`)}
                          className="px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors font-medium"
                        >
                          分配考試
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
    </div>
  );
}
