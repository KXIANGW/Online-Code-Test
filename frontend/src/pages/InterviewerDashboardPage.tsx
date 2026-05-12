import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useAuthStore } from "../stores/authStore";
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
      <NavBar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-slate-800">考試管理</h1>
          <button
            disabled
            title="建立考試功能即將推出"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg opacity-50 cursor-not-allowed"
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
