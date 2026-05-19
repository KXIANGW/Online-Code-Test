import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { examSessions } from "../db/schema";
import { NotFoundError } from "../errors";

export async function getSessionOrThrow(sessionId: number) {
  const [session] = await db.select().from(examSessions).where(eq(examSessions.id, sessionId));

  if (!session) throw NotFoundError("exam session");
  return session;
}

export type ExamSessionRecord = Awaited<ReturnType<typeof getSessionOrThrow>>;

export async function expireIfNeeded(session: ExamSessionRecord): Promise<ExamSessionRecord> {
  if (session.status === "in_progress" && session.expiresAt && session.expiresAt <= new Date()) {
    const [updated] = await db
      .update(examSessions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(examSessions.id, session.id))
      .returning();
    return updated!;
  }

  return session;
}

export async function getFreshSessionOrThrow(sessionId: number): Promise<ExamSessionRecord> {
  return expireIfNeeded(await getSessionOrThrow(sessionId));
}
