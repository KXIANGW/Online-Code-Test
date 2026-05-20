import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NavBar } from "../components/NavBar";
import { useInterviewerStore } from "../stores/interviewerStore";
import { getExamSessions, getSessionResult } from "../api/client";
import type { ExamStatus, SessionResult } from "../types";

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

type Tab = "all" | "in_progress" | "not_started" | "ended";

const TABS: { value: Tab; label: string }[] = [
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
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getExamSessions()
      .then((sessions) => Promise.all(sessions.map((s) => getSessionResult(s.id))))
      .then((data) => {
        setResults(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [setResults]);

  const filtered =
    activeTab === "all"
      ? results
      : activeTab === "ended"
        ? results.filter((r) => r.status === "submitted" || r.status === "expired")
        : results.filter((r) => r.status === activeTab);

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref="/interviewer" />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-slate-800">考試管理</h1>
          <button
            onClick={() => navigate("/interviewer/new")}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            建立考試
          </button>
        </div>

        <div className="flex gap-1 mb-4 border-b border-slate-200">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.value
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
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">目前沒有考試紀錄</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => (
              <SessionCard key={r.id} result={r} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
