import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSessionResult, getSubmissionDetail, listSessionSubmissions } from "../api/client";
import { NavBar } from "../components/NavBar";
import { useJudgeSocket } from "../hooks/useJudgeSocket";
import type {
  JudgeSocketMessage,
  SessionResult,
  SubmissionSummary,
  TestcaseResult,
} from "../types";
import { STATUS_LABEL, STATUS_COLOR } from "../config/examStatus";
import { ROUTES } from "../config/routes";
import { SUBMISSION_TYPE_LABEL } from "../config/submission";

const TC_VERDICT_COLOR: Record<string, string> = {
  AC: "text-green-600",
  WA: "text-red-500",
  TLE: "text-amber-500",
  MLE: "text-amber-500",
  RE: "text-orange-500",
  skipped: "text-slate-400",
};

const VERDICT_COLOR: Record<string, string> = {
  AC: "text-green-600 font-medium",
  WA: "text-red-500 font-medium",
  TLE: "text-amber-500 font-medium",
  MLE: "text-amber-500 font-medium",
  RE: "text-orange-500 font-medium",
  CE: "text-purple-500 font-medium",
  no_submission: "text-slate-400",
  pending: "text-slate-400",
  judging: "text-blue-500",
};

function testcaseLabel(tc: TestcaseResult) {
  return `${tc.isPublic ? "公開測資" : "隱藏測資"} ${tc.orderIndex}`;
}

export default function CandidateResultPage() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedEspId, setExpandedEspId] = useState<Set<number>>(new Set());
  const [tcCache, setTcCache] = useState<Record<number, TestcaseResult[] | "loading" | "error">>(
    {},
  );
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<Set<number>>(new Set());
  const [historyTcCache, setHistoryTcCache] = useState<
    Record<number, TestcaseResult[] | "loading" | "error">
  >({});

  const reload = useCallback(async () => {
    const [nextResult, nextSubmissions] = await Promise.all([
      getSessionResult(sessionId),
      listSessionSubmissions(sessionId),
    ]);
    setResult(nextResult);
    setSubmissions(nextSubmissions.filter((submission) => submission.submissionType === "formal"));
  }, [sessionId]);

  const toggleDetail = useCallback(
    (espId: number, submissionId: number) => {
      setExpandedEspId((prev) => {
        const next = new Set(prev);
        if (next.has(espId)) {
          next.delete(espId);
        } else {
          next.add(espId);
        }
        return next;
      });

      if (tcCache[espId] !== undefined) return;

      setTcCache((prev) => ({ ...prev, [espId]: "loading" }));
      getSubmissionDetail(sessionId, submissionId)
        .then((detail) => setTcCache((prev) => ({ ...prev, [espId]: detail.testcaseResults })))
        .catch(() => setTcCache((prev) => ({ ...prev, [espId]: "error" })));
    },
    [sessionId, tcCache],
  );

  const toggleHistoryDetail = useCallback(
    (submissionId: number) => {
      setExpandedSubmissionId((prev) => {
        const next = new Set(prev);
        if (next.has(submissionId)) {
          next.delete(submissionId);
        } else {
          next.add(submissionId);
        }
        return next;
      });

      if (historyTcCache[submissionId] !== undefined) return;

      setHistoryTcCache((prev) => ({ ...prev, [submissionId]: "loading" }));
      getSubmissionDetail(sessionId, submissionId)
        .then((detail) =>
          setHistoryTcCache((prev) => ({ ...prev, [submissionId]: detail.testcaseResults })),
        )
        .catch(() => setHistoryTcCache((prev) => ({ ...prev, [submissionId]: "error" })));
    },
    [historyTcCache, sessionId],
  );

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
                isFinalSubmission: message.submissionType === "formal",
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
      <NavBar homeHref={ROUTES.CANDIDATE} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {loading && <p className="py-12 text-center text-sm text-slate-400">載入中...</p>}
        {error && <p className="py-12 text-center text-sm text-red-500">無法載入考試結果</p>}

        {result && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex items-center gap-3">
                <h1 className="text-lg font-semibold text-slate-900">考試結果</h1>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[result.status]}`}
                >
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
                {result.problems.map((problem) => {
                  const isExpanded = expandedEspId.has(problem.examSessionProblemId);
                  const tcState = tcCache[problem.examSessionProblemId];
                  return (
                    <div key={problem.examSessionProblemId}>
                      <div className="flex items-center justify-between px-5 py-4">
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            {problem.orderIndex}. {problem.problemTitle}
                          </p>
                          <p
                            className={`mt-0.5 text-xs ${
                              VERDICT_COLOR[problem.latestStatus] ?? "text-slate-400"
                            }`}
                          >
                            {problem.latestStatus === "no_submission"
                              ? "未作答"
                              : problem.latestStatus}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-sm text-slate-600">
                            {problem.score} / {problem.scoreWeight} 分
                          </p>
                          {problem.finalSubmissionId !== null && (
                            <button
                              type="button"
                              onClick={() =>
                                toggleDetail(
                                  problem.examSessionProblemId,
                                  problem.finalSubmissionId!,
                                )
                              }
                              className="text-xs text-blue-600 hover:text-blue-800 transition-colors whitespace-nowrap"
                            >
                              {isExpanded ? "收合 ▲" : "查看詳情 ▶"}
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-50 px-5 pb-4">
                          {tcState === "loading" && (
                            <p className="py-3 text-center text-xs text-slate-400">載入測資中...</p>
                          )}
                          {tcState === "error" && (
                            <p className="py-3 text-center text-xs text-red-500">
                              無法載入測資結果
                            </p>
                          )}
                          {Array.isArray(tcState) && (
                            <table className="mt-3 w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 text-slate-400">
                                  <th className="py-2 text-left font-medium">#</th>
                                  <th className="py-2 text-left font-medium">判決</th>
                                  <th className="py-2 text-left font-medium">執行時間</th>
                                  <th className="py-2 text-left font-medium">記憶體</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {tcState.map((tc) => (
                                  <tr key={tc.id}>
                                    <td className="py-2 text-slate-600">{testcaseLabel(tc)}</td>
                                    <td
                                      className={`py-2 font-medium ${
                                        TC_VERDICT_COLOR[tc.verdict] ?? "text-slate-600"
                                      }`}
                                    >
                                      {tc.verdict}
                                    </td>
                                    <td className="py-2 text-slate-600">
                                      {tc.verdict === "skipped" || tc.runtimeMs === null
                                        ? "—"
                                        : `${tc.runtimeMs} ms`}
                                    </td>
                                    <td className="py-2 text-slate-600">
                                      {tc.verdict === "skipped" || tc.memoryKb === null
                                        ? "—"
                                        : `${tc.memoryKb} KB`}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-medium text-slate-800">提交紀錄</h2>
              </div>
              {submissions.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-400">尚無提交紀錄</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {submissions.map((submission) => {
                    const isExpanded = expandedSubmissionId.has(submission.id);
                    const tcState = historyTcCache[submission.id];
                    const verdict = submission.verdict ?? submission.status;
                    return (
                      <div key={submission.id}>
                        <div className="px-5 py-4 flex items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-slate-800">
                                {submission.orderIndex}. {submission.problemTitle}
                              </p>
                              <span className="text-xs rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                                {SUBMISSION_TYPE_LABEL[submission.submissionType]}
                              </span>
                              {submission.isFinalSubmission && (
                                <span className="text-xs rounded-full bg-green-50 px-2 py-0.5 text-green-600">
                                  最終提交
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span className={VERDICT_COLOR[verdict] ?? "text-slate-500"}>
                                {verdict}
                              </span>
                              <span>{submission.language}</span>
                              <span>
                                {new Date(submission.submittedAt).toLocaleString("zh-TW")}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleHistoryDetail(submission.id)}
                            aria-label={`查看詳細測資：提交 ${submission.id}`}
                            className="text-xs text-blue-600 hover:text-blue-800 transition-colors whitespace-nowrap"
                          >
                            {isExpanded ? "收合詳細測資 ▲" : "查看詳細測資"}
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-slate-100 bg-slate-50 px-5 pb-4">
                            {tcState === "loading" && (
                              <p className="py-3 text-center text-xs text-slate-400">
                                載入詳細測資中...
                              </p>
                            )}
                            {tcState === "error" && (
                              <p className="py-3 text-center text-xs text-red-500">
                                無法載入詳細測資結果
                              </p>
                            )}
                            {Array.isArray(tcState) && tcState.length === 0 && (
                              <p className="py-3 text-center text-xs text-slate-400">
                                無詳細測資結果
                              </p>
                            )}
                            {Array.isArray(tcState) && tcState.length > 0 && (
                              <table className="mt-3 w-full text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 text-slate-400">
                                    <th className="py-2 text-left font-medium">#</th>
                                    <th className="py-2 text-left font-medium">判決</th>
                                    <th className="py-2 text-left font-medium">執行時間</th>
                                    <th className="py-2 text-left font-medium">記憶體</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {tcState.map((tc) => (
                                    <tr key={tc.id}>
                                      <td className="py-2 text-slate-600">{testcaseLabel(tc)}</td>
                                      <td
                                        className={`py-2 font-medium ${
                                          TC_VERDICT_COLOR[tc.verdict] ?? "text-slate-600"
                                        }`}
                                      >
                                        {tc.verdict}
                                      </td>
                                      <td className="py-2 text-slate-600">
                                        {tc.verdict === "skipped" || tc.runtimeMs === null
                                          ? "—"
                                          : `${tc.runtimeMs} ms`}
                                      </td>
                                      <td className="py-2 text-slate-600">
                                        {tc.verdict === "skipped" || tc.memoryKb === null
                                          ? "—"
                                          : `${tc.memoryKb} KB`}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
