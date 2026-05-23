import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSessionResult, getSubmissionDetail, listSessionSubmissions } from "../api/client";
import { NavBar } from "../components/NavBar";
import type { SessionResult, SubmissionSummary, TestcaseResult } from "../types";
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

export default function ExamResultPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  useEffect(() => {
    if (!id) return;
    Promise.all([getSessionResult(Number(id)), listSessionSubmissions(Number(id))])
      .then(([sessionResult, submissionHistory]) => {
        setResult(sessionResult);
        setSubmissions(
          submissionHistory.filter((submission) => submission.submissionType === "formal"),
        );
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  function toggleDetail(espId: number, submissionId: number) {
    setExpandedEspId((prev) => {
      const next = new Set(prev);
      if (next.has(espId)) {
        next.delete(espId);
      } else {
        next.add(espId);
      }
      return next;
    });

    // 判斷是否需要抓取資料 (邏輯不變，只需確保 tcCache 內沒有資料才發請求)
    if (tcCache[espId] !== undefined) return;

    setTcCache((prev) => ({ ...prev, [espId]: "loading" }));
    getSubmissionDetail(Number(id), submissionId)
      .then((detail) => setTcCache((prev) => ({ ...prev, [espId]: detail.testcaseResults })))
      .catch(() => setTcCache((prev) => ({ ...prev, [espId]: "error" })));
  }

  function toggleHistoryDetail(submissionId: number) {
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
    getSubmissionDetail(Number(id), submissionId)
      .then((detail) =>
        setHistoryTcCache((prev) => ({ ...prev, [submissionId]: detail.testcaseResults })),
      )
      .catch(() => setHistoryTcCache((prev) => ({ ...prev, [submissionId]: "error" })));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref={ROUTES.INTERVIEWER} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate(ROUTES.INTERVIEWER)}
          className="text-sm text-slate-500 hover:text-slate-700 mb-6 flex items-center gap-1 transition-colors"
        >
          ← 返回考試管理
        </button>

        {loading && <p className="text-sm text-slate-400 text-center py-12">載入中...</p>}

        {error && <p className="text-sm text-red-500 text-center py-12">無法載入考試結果</p>}

        {result && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div>
                  <p className="font-medium text-slate-800">
                    {result.candidate.displayName ?? result.candidate.username}
                  </p>
                  <p className="text-xs text-slate-400">@{result.candidate.username}</p>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[result.status]}`}
                >
                  {STATUS_LABEL[result.status]}
                </span>
              </div>
              <div className="flex gap-6 text-sm text-slate-600">
                <span>
                  總分：
                  <span className="font-medium text-slate-800">
                    {result.totalScore} / {result.maxScore}
                  </span>
                </span>
                {result.actualStartAt && (
                  <span>
                    測驗日期：
                    {new Date(result.actualStartAt).toLocaleDateString("zh-TW")}
                  </span>
                )}
              </div>
            </div>

            <section className="bg-white rounded-xl border border-slate-200">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-medium text-slate-800">題目結果</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {result.problems.map((p) => {
                  const isExpanded = expandedEspId.has(p.examSessionProblemId);
                  const tcState = tcCache[p.examSessionProblemId];
                  return (
                    <div key={p.examSessionProblemId}>
                      <div className="px-5 py-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            {p.orderIndex}. {p.problemTitle}
                          </p>
                          <p
                            className={`text-xs mt-0.5 ${
                              VERDICT_COLOR[p.latestStatus] ?? "text-slate-400"
                            }`}
                          >
                            {p.latestStatus === "no_submission" ? "未作答" : p.latestStatus}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-sm text-slate-600">
                            {p.score} / {p.scoreWeight} 分
                          </p>
                          {p.finalSubmissionId !== null && (
                            <button
                              type="button"
                              onClick={() =>
                                toggleDetail(p.examSessionProblemId, p.finalSubmissionId!)
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

            <section className="bg-white rounded-xl border border-slate-200">
              <div className="px-5 py-4 border-b border-slate-100">
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
          </div>
        )}
      </main>
    </div>
  );
}
