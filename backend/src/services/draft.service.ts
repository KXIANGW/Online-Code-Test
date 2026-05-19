import { redis } from "../db/redis";
import { db } from "../db/client";
import { examSessions, examSessionProblems } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { NotFoundError, BadRequestError } from "../errors";
import type { FastifyJWT } from "@fastify/jwt";

type CurrentUser = FastifyJWT["user"];

// Key format: session:draft:<sessionId>:<problemId>:<language>
function draftKey(sessionId: number, problemId: number, language: string) {
  return `session:draft:${sessionId}:${problemId}:${language}`;
}

// Prefix for all draft keys of a session (used for SCAN-based deletion and listing)
function sessionDraftPrefix(sessionId: number) {
  return `session:draft:${sessionId}:`;
}

export async function saveDraft(
  currentUser: CurrentUser,
  sessionId: number,
  problemId: number,
  language: string,
  code: string,
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
        eq(examSessionProblems.problemId, problemId),
      ),
    )
    .where(eq(examSessions.id, sessionId));

  if (!row || row.candidateId !== currentUser.id) throw NotFoundError("exam session");
  if (row.status !== "in_progress") throw BadRequestError("Exam is not in progress");
  if (!row.espId) throw NotFoundError("exam session problem");

  const ttlSeconds = row.expiresAt
    ? Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000))
    : 7200;

  try {
    await redis.setex(draftKey(sessionId, problemId, language), ttlSeconds, code);
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

  const prefix = sessionDraftPrefix(sessionId);

  let keys: string[] = [];
  try {
    // SCAN to find all draft keys for this session across all languages
    let cursor = "0";
    do {
      const [nextCursor, batch] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");
  } catch {
    // Redis unavailable — degrade gracefully rather than crashing the exam UI
    return {};
  }

  if (keys.length === 0) return {};

  let values: (string | null)[];
  try {
    values = await redis.mget(...keys);
  } catch {
    return {};
  }

  // Result is keyed by "problemId:language" → code string
  const result: Record<string, string> = {};
  keys.forEach((key, i) => {
    const raw = values[i];
    if (!raw) return;
    // key format: session:draft:<sessionId>:<problemId>:<language>
    const suffix = key.slice(prefix.length); // "<problemId>:<language>"
    result[suffix] = raw;
  });
  return result;
}

export async function clearSessionDrafts(sessionId: number) {
  const prefix = sessionDraftPrefix(sessionId);
  try {
    let cursor = "0";
    const keys: string[] = [];
    do {
      const [nextCursor, batch] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // Redis unavailable — non-fatal
  }
}
