import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";
import { pool } from "../helpers/db.js";
import { waitForSubmissionsDone } from "../helpers/wait.js";
import { PYTHON_AC, SUM_PROBLEM } from "../helpers/fixtures.js";

const TS = Date.now().toString().slice(-8);

describe("Concurrent submissions and queue serialization", () => {
  it(
    "3 simultaneous submissions all complete with done status",
    async () => {
      const rootToken = await login("root", "Root@1234");
      const aliceToken = await login("alice", "Test@1234");

      const ps = await api<{ id: number; username: string }>(
        "POST",
        "/users",
        {
          username: `e2e_ps11_${TS}`,
          password: "E2e@1234",
          displayName: "PS11",
          roleNames: ["problem_setter"],
        },
        rootToken,
        201,
      );
      const psToken = await login(ps.username, "E2e@1234");

      const cand = await api<{ id: number; username: string }>(
        "POST",
        "/users",
        {
          username: `e2e_cand11_${TS}`,
          password: "E2e@1234",
          displayName: "Cand11",
          roleNames: ["candidate"],
        },
        aliceToken,
        201,
      );
      const candToken = await login(cand.username, "E2e@1234");

      const p = await api<{ id: number }>(
        "POST",
        "/problems",
        SUM_PROBLEM,
        psToken,
        201,
      );
      const tmpl = await api<{ id: number }>(
        "POST",
        "/exam-sessions/templates/manual",
        {
          title: `E2E Concurrent ${TS}`,
          durationMinutes: 10,
          problems: [{ problemId: p.id, scoreWeight: 100, orderIndex: 1 }],
        },
        aliceToken,
        201,
      );
      const sessions = await api<{ id: number }[]>(
        "POST",
        `/exam-sessions/templates/${tmpl.id}/assign`,
        { candidateIds: [cand.id] },
        aliceToken,
        201,
      );
      const sessionId = sessions[0]!.id;
      await api(
        "POST",
        `/exam-sessions/${sessionId}/start`,
        undefined,
        candToken,
        200,
      );

      const sps = await api<{ id: number }[]>(
        "GET",
        `/exam-sessions/${sessionId}/problems`,
        undefined,
        candToken,
        200,
      );
      const espId = sps[0]!.id;

      const [sub1, sub2, sub3] = await Promise.all([
        api<{ id: number }>(
          "POST",
          `/exam-sessions/${sessionId}/submissions`,
          {
            examSessionProblemId: espId,
            language: "python3",
            sourceCode: PYTHON_AC,
            type: "formal",
          },
          candToken,
          202,
        ),
        api<{ id: number }>(
          "POST",
          `/exam-sessions/${sessionId}/submissions`,
          {
            examSessionProblemId: espId,
            language: "python3",
            sourceCode: PYTHON_AC,
            type: "formal",
          },
          candToken,
          202,
        ),
        api<{ id: number }>(
          "POST",
          `/exam-sessions/${sessionId}/submissions`,
          {
            examSessionProblemId: espId,
            language: "python3",
            sourceCode: PYTHON_AC,
            type: "formal",
          },
          candToken,
          202,
        ),
      ]);

      const ids = [sub1.id, sub2.id, sub3.id];

      await waitForSubmissionsDone(pool, ids, 120000);

      const result = await pool.query<{
        id: number;
        status: string;
        verdict: string;
      }>(
        `SELECT id, status, verdict FROM submissions WHERE id = ANY($1::bigint[]) ORDER BY id`,
        [ids],
      );
      expect(result.rows).toHaveLength(3);
      for (const row of result.rows) {
        expect(row.status).toBe("done");
        expect(row.verdict).not.toBeNull();
      }

      const sessionResult = await api<{
        totalScore: number;
        problems: { finalSubmissionId: number | null }[];
      }>(
        "GET",
        `/exam-sessions/${sessionId}/result`,
        undefined,
        aliceToken,
        200,
      );
      expect([0, 100]).toContain(sessionResult.totalScore);
      expect(sessionResult.problems[0]!.finalSubmissionId).not.toBeNull();

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM submissions WHERE exam_session_problem_id = $1`,
        [espId],
      );
      expect(parseInt(countResult.rows[0]!.count)).toBe(3);
    },
    120000,
  );

  it(
    "10 batch candidates each get independent sessions and all complete AC",
    async () => {
      const aliceToken = await login("alice", "Test@1234");
      const rootToken = await login("root", "Root@1234");

      const ps = await api<{ id: number; username: string }>(
        "POST",
        "/users",
        {
          username: `e2e_ps11b_${TS}`,
          password: "E2e@1234",
          displayName: "PS11B",
          roleNames: ["problem_setter"],
        },
        rootToken,
        201,
      );
      const psToken = await login(ps.username, "E2e@1234");
      const p = await api<{ id: number }>(
        "POST",
        "/problems",
        SUM_PROBLEM,
        psToken,
        201,
      );

      const batch = await api<{ username: string; password: string }[]>(
        "POST",
        "/users/batch",
        { count: 10 },
        aliceToken,
        201,
      );

      const allUsers = await api<{ id: number; username: string }[]>(
        "GET",
        "/users",
        undefined,
        aliceToken,
        200,
      );
      const batchNames = new Set(batch.map((u) => u.username));
      const candIds = allUsers
        .filter((u) => batchNames.has(u.username))
        .map((u) => u.id);
      expect(candIds).toHaveLength(10);

      const tmpl = await api<{ id: number }>(
        "POST",
        "/exam-sessions/templates/manual",
        {
          title: `E2E Batch ${TS}`,
          durationMinutes: 10,
          problems: [{ problemId: p.id, scoreWeight: 100, orderIndex: 1 }],
        },
        aliceToken,
        201,
      );
      const sessions = await api<{ id: number; candidateId: number }[]>(
        "POST",
        `/exam-sessions/templates/${tmpl.id}/assign`,
        { candidateIds: candIds },
        aliceToken,
        201,
      );
      expect(sessions).toHaveLength(10);

      const submissionIds: number[] = [];
      await Promise.all(
        sessions.map(async (session, idx) => {
          const cred = batch[idx]!;
          const candToken = await login(cred.username, cred.password);
          await api(
            "POST",
            `/exam-sessions/${session.id}/start`,
            undefined,
            candToken,
            200,
          );
          const sps = await api<{ id: number }[]>(
            "GET",
            `/exam-sessions/${session.id}/problems`,
            undefined,
            candToken,
            200,
          );
          const sub = await api<{ id: number }>(
            "POST",
            `/exam-sessions/${session.id}/submissions`,
            {
              examSessionProblemId: sps[0]!.id,
              language: "python3",
              sourceCode: PYTHON_AC,
              type: "formal",
            },
            candToken,
            202,
          );
          submissionIds.push(sub.id);
        }),
      );

      await waitForSubmissionsDone(pool, submissionIds, 120000);

      const dbResult = await pool.query<{ status: string; verdict: string }>(
        `SELECT status, verdict FROM submissions WHERE id = ANY($1::bigint[])`,
        [submissionIds],
      );
      expect(dbResult.rows).toHaveLength(10);
      expect(dbResult.rows.every((r) => r.status === "done")).toBe(true);
      expect(dbResult.rows.every((r) => r.verdict === "AC")).toBe(true);
    },
    120000,
  );
});
