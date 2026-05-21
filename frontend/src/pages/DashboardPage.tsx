import { useNavigate } from "react-router-dom";
import { useExamStore } from "../stores/examStore";
import type { ExamSession } from "../types";
import { useEffect, useState } from "react";
import { getExamSessions, startExamSession } from "../api/client";
import { NavBar } from "../components/NavBar";
import { formatTimeLeft, useExamTimer } from "../hooks/useExamTimer";
import { STORAGE_KEYS } from "../config/storage";
import { ROUTES } from "../config/routes";
import { toast, Toaster } from "react-hot-toast";

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
  onResume,
  onRequestStart,
}: {
  session: ExamSession;
  onResume: (sessionId: number) => void;
  onRequestStart: (sessionId: number) => void;
}) {
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
          onClick={() => onResume(session.id)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          繼續考試
        </button>
      )}
      {session.status === "not_started" && (
        <button
          onClick={() => onRequestStart(session.id)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          開始考試
        </button>
      )}
      {(session.status === "submitted" || session.status === "expired") && (
        <button
          onClick={() => navigate(ROUTES.candidateResultPage(session.id))}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          查看結果
        </button>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const sessions = useExamStore((s) => s.sessions);
  const setSessions = useExamStore((s) => s.setSessions);
  const [pendingSessionId, setPendingSessionId] = useState<number | null>(null);

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

  async function handleResume(sessionId: number) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      toast.error("請允許全螢幕模式才能繼續考試。");
      return;
    }
    navigate(ROUTES.examPage(sessionId));
  }

  async function handleConfirmFullscreen() {
    if (pendingSessionId === null) return;
    const id = pendingSessionId;
    setPendingSessionId(null);
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      toast.error("請允許全螢幕模式才能開始考試。");
      setPendingSessionId(id);
      return;
    }
    try {
      await handleStart(id);
    } catch {
      toast.error("開始考試失敗，請重試。");
      setPendingSessionId(id);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster position="top-center" />
      <NavBar homeHref={ROUTES.DASHBOARD} />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <SectionCard title="進行中" badge={inProgress.length} badgeColor="bg-blue-50 text-blue-600">
          {inProgress.length === 0 ? (
            <EmptyState message="目前沒有進行中的考試" />
          ) : (
            inProgress.map((s) => (
              <ExamSessionCard
                key={s.id}
                session={s}
                onResume={handleResume}
                onRequestStart={setPendingSessionId}
              />
            ))
          )}
        </SectionCard>

        <SectionCard title="待考" badge={pending.length} badgeColor="bg-amber-50 text-amber-600">
          {pending.length === 0 ? (
            <EmptyState message="目前沒有待考的考試" />
          ) : (
            pending.map((s) => (
              <ExamSessionCard
                key={s.id}
                session={s}
                onResume={handleResume}
                onRequestStart={setPendingSessionId}
              />
            ))
          )}
        </SectionCard>

        <SectionCard title="歷史紀錄">
          {history.length === 0 ? (
            <EmptyState message="尚無歷史紀錄" />
          ) : (
            history.map((s) => (
              <ExamSessionCard
                key={s.id}
                session={s}
                onResume={handleResume}
                onRequestStart={setPendingSessionId}
              />
            ))
          )}
        </SectionCard>
      </main>

      {/* 全螢幕同意 Modal */}
      {pendingSessionId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fullscreen-modal-title"
        >
          <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4 space-y-5">
            <div className="space-y-2">
              <h2 id="fullscreen-modal-title" className="text-lg font-semibold text-slate-800">
                進入考試前請確認
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                本系統為維護考試公平性，開始考試後將啟用以下監控機制：
              </p>
              <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside">
                <li>強制全螢幕模式，離開將觸發警告並記錄</li>
                <li>偵測切換分頁或切換至其他應用程式</li>
                <li>偵測在編輯器中貼入外部程式碼</li>
                <li>偵測複製題目內容</li>
              </ul>
              <p className="text-xs text-slate-400">所有異常行為將即時傳送給面試官。</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setPendingSessionId(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => void handleConfirmFullscreen()}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                同意並開始考試
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
