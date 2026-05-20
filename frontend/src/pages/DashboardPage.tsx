import { useNavigate } from "react-router-dom";
import { useExamStore } from "../stores/examStore";
import type { ExamSession } from "../types";
import { useEffect } from "react";
import { getExamSessions, startExamSession } from "../api/client";
import { NavBar } from "../components/NavBar";
import { formatTimeLeft, useExamTimer } from "../hooks/useExamTimer";
import { STORAGE_KEYS } from "../config/storage";
import { ROUTES } from "../config/routes";

function SectionCard({
  title,
  badge,
  badgeColor = "bg-slate-100 text-slate-600",
  children,
}: {
  title: string;
  badge?: string | number;
  badgeColor?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-slate-200">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <h2 className="font-medium text-slate-800">{title}</h2>
        {badge !== undefined && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-slate-400 text-center py-6">{message}</p>;
}

function ExamSessionCard({
  session,
  onStart,
}: {
  session: ExamSession;
  onStart: (sessionId: number) => Promise<void>;
}) {
  const navigate = useNavigate();
  const timeLeft = useExamTimer(session.expiresAt);
  const title = session.examTitle || `考試 #${session.id}`;

  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-800">{title}</p>
        {session.status === "in_progress" && session.expiresAt && (
          <p className="text-xs text-slate-400 mt-0.5">剩餘：{formatTimeLeft(timeLeft ?? 0)}</p>
        )}
        {session.status === "not_started" && (
          <p className="text-xs text-slate-400 mt-0.5">{session.durationMinutes} 分鐘</p>
        )}
        {(session.status === "submitted" || session.status === "expired") && (
          <p className="text-xs text-slate-400 mt-0.5">
            {session.totalScore} / {session.maxScore} 分
          </p>
        )}
      </div>

      {session.status === "in_progress" && (
        <button
          onClick={() => navigate(ROUTES.examPage(session.id))}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          繼續考試
        </button>
      )}
      {session.status === "not_started" && (
        <button
          onClick={() => void onStart(session.id)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          開始考試
        </button>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const sessions = useExamStore((s) => s.sessions);
  const setSessions = useExamStore((s) => s.setSessions);

  const inProgress = sessions.filter((s) => s.status === "in_progress");
  const pending = sessions.filter((s) => s.status === "not_started");
  const history = sessions.filter((s) => s.status === "submitted" || s.status === "expired");

  useEffect(() => {
    getExamSessions().then((data) => setSessions(data));
  }, []);

  function clearSessionLocalStorage(sessionId: number) {
    const prefix = STORAGE_KEYS.draftPrefix(sessionId);
    const langPrefix = STORAGE_KEYS.langPrefix(sessionId);
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(prefix) || key.startsWith(langPrefix))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }

  async function handleStart(sessionId: number) {
    const started = await startExamSession(sessionId);
    clearSessionLocalStorage(sessionId);
    setSessions(sessions.map((session) => (session.id === sessionId ? started : session)));
    navigate(ROUTES.examPage(sessionId));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref={ROUTES.DASHBOARD} />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <SectionCard title="進行中" badge={inProgress.length} badgeColor="bg-blue-50 text-blue-600">
          {inProgress.length === 0 ? (
            <EmptyState message="目前沒有進行中的考試" />
          ) : (
            inProgress.map((s) => <ExamSessionCard key={s.id} session={s} onStart={handleStart} />)
          )}
        </SectionCard>

        <SectionCard title="待考" badge={pending.length} badgeColor="bg-amber-50 text-amber-600">
          {pending.length === 0 ? (
            <EmptyState message="目前沒有待考的考試" />
          ) : (
            pending.map((s) => <ExamSessionCard key={s.id} session={s} onStart={handleStart} />)
          )}
        </SectionCard>

        <SectionCard title="歷史紀錄">
          {history.length === 0 ? (
            <EmptyState message="尚無歷史紀錄" />
          ) : (
            history.map((s) => <ExamSessionCard key={s.id} session={s} onStart={handleStart} />)
          )}
        </SectionCard>
      </main>
    </div>
  );
}
