import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { NavBar } from "../components/NavBar";
import {
  listExamTemplates,
  getUsers,
  assignExamToCandidates,
  getExamSessions,
} from "../api/client";
import type { ExamSession, ExamTemplate, UserSummary } from "../types";
import { getAssignableCandidates } from "../utils/assignmentEligibility";

interface ApiMessageError {
  response?: {
    data?: {
      message?: string;
    };
  };
  message?: string;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const apiError = err as ApiMessageError;
    return apiError.response?.data?.message ?? apiError.message ?? fallback;
  }
  return fallback;
}

export default function TemplateAssignPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const templateId = Number(id);

  const [template, setTemplate] = useState<ExamTemplate | null>(null);
  const [candidates, setCandidates] = useState<UserSummary[]>([]);
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [templates, users, sessionList] = await Promise.all([
          listExamTemplates(),
          getUsers(),
          getExamSessions(),
        ]);

        const found = templates.find((t) => t.id === templateId) ?? null;
        setTemplate(found);
        setSessions(sessionList);

        const filteredCandidates = users.filter((u) => u.roles.includes("candidate"));
        setCandidates(filteredCandidates);
      } catch {
        setError("資料載入失敗");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [templateId]);

  const assignableCandidates = getAssignableCandidates(candidates, sessions);

  function toggleCandidate(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleAssign() {
    setSubmitting(true);
    setError(null);
    try {
      await assignExamToCandidates(templateId, Array.from(selectedIds));
      setSuccess(true);
      setTimeout(() => navigate("/interviewer"), 1500);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "分配失敗"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <NavBar homeHref="/interviewer" />
        <main className="max-w-2xl mx-auto px-4 py-8">
          <p className="text-center py-12 text-slate-400">載入中...</p>
        </main>
      </div>
    );
  }

  if (error && !template) {
    return (
      <div className="min-h-screen bg-slate-50">
        <NavBar homeHref="/interviewer" />
        <main className="max-w-2xl mx-auto px-4 py-8">
          <p className="text-center py-12 text-red-500">{error}</p>
          <button
            onClick={() => navigate("/interviewer")}
            className="block mx-auto text-sm text-blue-600 hover:underline"
          >
            返回考試管理
          </button>
        </main>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="min-h-screen bg-slate-50">
        <NavBar homeHref="/interviewer" />
        <main className="max-w-2xl mx-auto px-4 py-8">
          <p className="text-center py-12 text-red-500">找不到此考試模板</p>
          <button
            onClick={() => navigate("/interviewer")}
            className="block mx-auto text-sm text-blue-600 hover:underline"
          >
            返回考試管理
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref="/interviewer" />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate("/interviewer")}
          className="text-sm text-slate-500 hover:text-slate-700 mb-6 flex items-center gap-1"
        >
          ← 返回考試管理
        </button>

        <h1 className="text-xl font-semibold text-slate-800 mb-2">分配考試</h1>

        {/* Template info */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
          <p className="font-medium text-blue-800">{template.title}</p>
          <p className="text-sm text-blue-600 mt-1">時長：{template.durationMinutes} 分鐘</p>
        </div>

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 text-green-700 text-sm font-medium">
            ✓ 分配成功，即將返回考試管理...
          </div>
        )}

        {/* Candidate list */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
          {assignableCandidates.length === 0 ? (
            <p className="text-center py-8 text-slate-400 text-sm">目前沒有考生帳號</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {assignableCandidates.map(({ candidate: c, pendingSession }) => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    aria-label={c.displayName ?? c.username}
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleCandidate(c.id)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {c.displayName ?? c.username}
                    </p>
                    <p className="text-xs text-slate-400">@{c.username}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {pendingSession ? `目前模板：${pendingSession.examTitle}` : "尚未分配模板"}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        <button
          type="button"
          onClick={handleAssign}
          disabled={submitting || selectedIds.size === 0 || success}
          className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all"
        >
          {submitting ? "分配中..." : `確認分配（${selectedIds.size} 人）`}
        </button>
      </main>
    </div>
  );
}
