import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSessionResult, getSubmissionDetail } from "../api/client";
import { NavBar } from "../components/NavBar";
import type { ExamStatus, SessionResult, TestcaseResult } from "../types";

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

export default function ExamResultPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<SessionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedEspId, setExpandedEspId] = useState<Set<number>>(new Set());
  const [tcCache, setTcCache] = useState<
    Record<number, TestcaseResult[] | "loading" | "error">
  >({});

  useEffect(() => {
    if (!id) return;
    getSessionResult(Number(id))
      .then(setResult)
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
      .then((detail) =>
        setTcCache((prev) => ({ ...prev, [espId]: detail.testcaseResults })),
      )
      .catch(() => setTcCache((prev) => ({ ...prev, [espId]: "error" })));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref="/interviewer" />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate("/interviewer")}
          className="text-sm text-slate-500 hover:text-slate-700 mb-6 flex items-center gap-1 transition-colors"
        >
          ← 返回考試管理
        </button>

        {loading && (
          <p className="text-sm text-slate-400 text-center py-12">載入中...</p>
        )}

        {error && (
          <p className="text-sm text-red-500 text-center py-12">
            無法載入考試結果
          </p>
        )}

        {result && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div>
                  <p className="font-medium text-slate-800">
                    {result.candidate.displayName ?? result.candidate.username}
                  </p>
                  <p className="text-xs text-slate-400">
                    @{result.candidate.username}
                  </p>
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
                            {p.latestStatus === "no_submission"
                              ? "未作答"
                              : p.latestStatus}
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
                                toggleDetail(
                                  p.examSessionProblemId,
                                  p.finalSubmissionId!,
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
                            <p className="py-3 text-center text-xs text-slate-400">
                              載入測資中...
                            </p>
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
                                  <th className="py-2 text-left font-medium">
                                    #
                                  </th>
                                  <th className="py-2 text-left font-medium">
                                    判決
                                  </th>
                                  <th className="py-2 text-left font-medium">
                                    執行時間
                                  </th>
                                  <th className="py-2 text-left font-medium">
                                    記憶體
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {tcState
                                  .filter((tc) => !tc.isPublic)
                                  .map((tc) => (
                                    <tr key={tc.id}>
                                      <td className="py-2 text-slate-600">
                                        測資 {tc.orderIndex}
                                      </td>
                                      <td
                                        className={`py-2 font-medium ${
                                          TC_VERDICT_COLOR[tc.verdict] ??
                                          "text-slate-600"
                                        }`}
                                      >
                                        {tc.verdict}
                                      </td>
                                      <td className="py-2 text-slate-600">
                                        {tc.verdict === "skipped" ||
                                        tc.runtimeMs === null
                                          ? "—"
                                          : `${tc.runtimeMs} ms`}
                                      </td>
                                      <td className="py-2 text-slate-600">
                                        {tc.verdict === "skipped" ||
                                        tc.memoryKb === null
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
          </div>
        )}
      </main>
    </div>
  );
}
