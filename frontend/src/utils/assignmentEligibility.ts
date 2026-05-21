import type { ExamSession, UserSummary } from "../types";

export interface AssignableCandidate {
  candidate: UserSummary;
  pendingSession: ExamSession | null;
}

const BLOCKING_STATUSES = new Set<ExamSession["status"]>(["in_progress", "submitted", "expired"]);

export function getAssignableCandidates(
  candidates: UserSummary[],
  sessions: ExamSession[],
): AssignableCandidate[] {
  return candidates.flatMap((candidate) => {
    const candidateSessions = sessions.filter((session) => session.candidateId === candidate.id);
    const hasBlockingSession = candidateSessions.some((session) =>
      BLOCKING_STATUSES.has(session.status),
    );

    if (hasBlockingSession) {
      return [];
    }

    return [
      {
        candidate,
        pendingSession:
          candidateSessions.find((session) => session.status === "not_started") ?? null,
      },
    ];
  });
}
