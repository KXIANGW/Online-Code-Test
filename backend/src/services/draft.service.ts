import { redis } from "../db/redis";
import { db } from "../db/client";
import { examSessions, examSessionProblems } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { NotFoundError, BadRequestError } from "../errors";
import type { FastifyJWT } from "@fastify/jwt";

type CurrentUser = FastifyJWT["user"];

function draftKey(sessionId: number, problemId: number) {
  return `session:draft:${sessionId}:${problemId}`;
}

export async function saveDraft(
  currentUser: CurrentUser,
  sessionId: number,
  problemId: number,
  data: { code: string; language: string }
) {
  // Single query: verify session ownership, status, and problem membership together
  const [row] = await db
    .select({
      candidateId: examSessions.candidateId,
      status: examSessions.status,
      expiresAt: examSessions.expiresAt,
      espId: examSessionProblems.id,
    })
    .from(examSessions)
    .leftJoin(
      examSessionProblems,
      and(
        eq(examSessionProblems.examSessionId, examSessions.id),
        eq(examSessionProblems.problemId, problemId)
      )
    )
    .where(eq(examSessions.id, sessionId));

  if (!row || row.candidateId !== currentUser.id) throw NotFoundError("exam session");
  if (row.status !== "in_progress") throw BadRequestError("Exam is not in progress");
  if (!row.espId) throw NotFoundError("exam session problem");

  const ttlSeconds = row.expiresAt
    ? Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000))
    : 7200;

  try {
    await redis.setex(draftKey(sessionId, problemId), ttlSeconds, JSON.stringify(data));
  } catch {
    // Redis unavailable — client-side localStorage still holds the draft
  }
  return { ok: true };
}

export async function getDrafts(currentUser: CurrentUser, sessionId: number) {
  const [session] = await db
    .select({ candidateId: examSessions.candidateId })
    .from(examSessions)
    .where(eq(examSessions.id, sessionId));

  // Use NotFoundError for non-owners to avoid leaking session existence
  if (!session || session.candidateId !== currentUser.id) throw NotFoundError("exam session");

  const esps = await db
    .select({ problemId: examSessionProblems.problemId })
    .from(examSessionProblems)
    .where(eq(examSessionProblems.examSessionId, sessionId));

  if (esps.length === 0) return {};

  const keys = esps.map((e) => draftKey(sessionId, e.problemId));

  let values: (string | null)[];
  try {
    values = await redis.mget(...keys);
  } catch {
    // Redis unavailable — degrade gracefully rather than crashing the exam UI
    return {};
  }

  const result: Record<number, { code: string; language: string }> = {};
  esps.forEach((e, i) => {
    const raw = values[i];
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "code" in parsed &&
        "language" in parsed &&
        typeof (parsed as Record<string, unknown>).code === "string" &&
        typeof (parsed as Record<string, unknown>).language === "string"
      ) {
        result[e.problemId] = parsed as { code: string; language: string };
      }
    } catch {
      // Skip corrupted entries
    }
  });
  return result;
}

export async function clearSessionDrafts(sessionId: number, problemIds: number[]) {
  const keys = problemIds.map((pid) => draftKey(sessionId, pid));
  if (keys.length > 0) await redis.del(...keys);
}
