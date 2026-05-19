import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSessionResult, listSessionSubmissions } from "../api/client";
import { NavBar } from "../components/NavBar";
import { useJudgeSocket } from "../hooks/useJudgeSocket";
import type { ExamStatus, JudgeSocketMessage, SessionResult, SubmissionSummary } from "../types";

const STATUS_LABEL: Record<ExamStatus, string> = {
  not_started: "待考",
  in_progress: "進行中",
  submitted: "已交卷",
  expired: "已逾時",
  cancelled: "已取消",
};

export default function CandidateResultPage() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    const [nextResult, nextSubmissions] = await Promise.all([
      getSessionResult(sessionId),
      listSessionSubmissions(sessionId),
    ]);
    setResult(nextResult);
    setSubmissions(nextSubmissions);
  }, [sessionId]);

  useEffect(() => {
    if (!Number.isInteger(sessionId)) {
      setError(true);
      setLoading(false);
      return;
    }

    reload()
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [reload, sessionId]);

  const handleJudgeSocketMessage = useCallback(
    (message: JudgeSocketMessage) => {
      if (message.type === "submission_status") {
        setSubmissions((prev) =>
          prev.map((submission) =>
            submission.id === message.submissionId
              ? {
                  ...submission,
                  status: message.status,
                  judgedAt: message.judgedAt,
                }
              : submission,
          ),
        );
        return;
      }

      setSubmissions((prev) =>
        prev.map((submission) =>
          submission.id === message.submissionId
            ? {
                ...submission,
                status: message.status,
                verdict: message.verdict,
                runtimeMs: message.runtimeMs,
                memoryKb: message.memoryKb,
                judgedAt: message.judgedAt,
                score: message.score,
                isFinalSubmission: message.submissionType === "formal" && message.score > 0,
              }
            : submission,
        ),
      );
      void reload();
    },
    [reload],
  );

  useJudgeSocket(sessionId, handleJudgeSocketMessage, reload);

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref="/candidate" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {loading && <p className="py-12 text-center text-sm text-slate-400">載入中...</p>}
        {error && <p className="py-12 text-center text-sm text-red-500">無法載入考試結果</p>}

        {result && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex items-center gap-3">
                <h1 className="text-lg font-semibold text-slate-900">考試結果</h1>
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
                  {STATUS_LABEL[result.status]}
                </span>
              </div>
              <p className="text-sm text-slate-600">
                總分：
                <span className="font-medium text-slate-900">
                  {result.totalScore} / {result.maxScore}
                </span>
              </p>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-medium text-slate-800">題目結果</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {result.problems.map((problem) => (
                  <div
                    key={problem.examSessionProblemId}
                    className="flex items-center justify-between px-5 py-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {problem.orderIndex}. {problem.problemTitle}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {problem.latestStatus === "no_submission" ? "未作答" : problem.latestStatus}
                      </p>
                    </div>
                    <p className="text-sm text-slate-600">
                      {problem.score} / {problem.scoreWeight} 分
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-medium text-slate-800">提交記錄</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {submissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="flex items-center justify-between px-5 py-4 text-sm text-slate-600"
                  >
                    <span>
                      {submission.orderIndex}. {submission.problemTitle}
                    </span>
                    <span>{submission.verdict ?? submission.status}</span>
                    <span>{submission.language}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
