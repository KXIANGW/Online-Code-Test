import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "./helpers/app";
import { truncateTestTables, seedUser, loginAs } from "./helpers/db";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let carolId: number;
let aliceId: number;
let candidate1Id: number;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateTestTables();
  await seedUser({ username: "root", password: "Root@1234", displayName: "Root", isSuperuser: true });
  carolId = await seedUser({ username: "carol", password: "Test@1234", displayName: "Carol", roleNames: ["problem_setter"] });
  aliceId = await seedUser({ username: "alice", password: "Test@1234", displayName: "Alice", roleNames: ["interviewer"] });
  candidate1Id = await seedUser({ username: "candidate1", password: "Cand@1234", displayName: "Candidate 1", roleNames: ["candidate"], createdBy: aliceId });
});

const sampleProblem = {
  title: "Two Sum",
  descriptionMd: "Given an array of integers...",
  difficulty: "easy",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  testcases: [
    { orderIndex: 1, isPublic: true, inputData: "2 7 11 15\n9", expectedOutput: "0 1" },
    { orderIndex: 2, isPublic: false, inputData: "3 2 4\n6", expectedOutput: "1 2" },
  ],
};

// ── POST /api/problems ─────────────────────────────────────────────────────────

describe("POST /api/problems", () => {
  it("problem_setter can create a problem with testcases", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: number; title: string }>();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Two Sum");
  });

  it("candidate → 403", async () => {
    const token = await loginAs(app, "candidate1", "Cand@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    expect(res.statusCode).toBe(403);
  });

  it("interviewer (exam:manage only) → 403 on create", async () => {
    const token = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    expect(res.statusCode).toBe(403);
  });

  it("invalid payload and duplicate testcase order → 400/409", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const invalid = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...sampleProblem, timeLimitMs: 0 },
    });
    expect(invalid.statusCode).toBe(400);

    const duplicateOrder = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...sampleProblem,
        testcases: [
          { orderIndex: 1, isPublic: true, inputData: "a", expectedOutput: "a" },
          { orderIndex: 1, isPublic: false, inputData: "b", expectedOutput: "b" },
        ],
      },
    });
    expect(duplicateOrder.statusCode).toBe(409);
  });
});

// ── GET /api/problems ──────────────────────────────────────────────────────────

describe("GET /api/problems", () => {
  it("problem_setter can list problems", async () => {
    const carolToken = await loginAs(app, "carol", "Test@1234");
    await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${carolToken}` },
      payload: sampleProblem,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/problems",
      headers: { authorization: `Bearer ${carolToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ title: string }[]>();
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it("interviewer can list problems", async () => {
    const token = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "GET",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("candidate → 403", async () => {
    const token = await loginAs(app, "candidate1", "Cand@1234");
    const res = await app.inject({
      method: "GET",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("soft-deleted problem does not appear in list", async () => {
    const carolToken = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${carolToken}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    await app.inject({
      method: "DELETE",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${carolToken}` },
    });

    const listRes = await app.inject({
      method: "GET",
      url: "/api/problems",
      headers: { authorization: `Bearer ${carolToken}` },
    });
    const list = listRes.json<{ id: number }[]>();
    expect(list.find((p) => p.id === id)).toBeUndefined();
  });
});

// ── GET /api/problems/:id ──────────────────────────────────────────────────────

describe("GET /api/problems/:id", () => {
  it("problem_setter sees all testcase data (including hidden)", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const res = await app.inject({
      method: "GET",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ testcases: { isPublic: boolean; inputData?: string }[] }>();
    const hiddenTc = body.testcases.find((tc) => !tc.isPublic);
    expect(hiddenTc?.inputData).toBeDefined();
  });

  it("interviewer sees hidden testcases without input/output data", async () => {
    const carolToken = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${carolToken}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "GET",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ testcases: { isPublic: boolean; inputData?: string }[] }>();
    const hiddenTc = body.testcases.find((tc) => !tc.isPublic);
    expect(hiddenTc?.inputData).toBeUndefined();
  });

  it("invalid id → 400 and missing problem → 404", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const invalid = await app.inject({
      method: "GET",
      url: "/api/problems/nope",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: "/api/problems/999999",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.statusCode).toBe(404);
  });
});

// ── PUT /api/problems/:id ──────────────────────────────────────────────────────

describe("PUT /api/problems/:id", () => {
  it("problem_setter can update title and timeLimitMs", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const res = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Two Sum Updated", timeLimitMs: 2000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ title: string; timeLimitMs: number }>();
    expect(body.title).toBe("Two Sum Updated");
    expect(body.timeLimitMs).toBe(2000);
  });

  it("interviewer → 403 (no problem:manage)", async () => {
    const carolToken = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${carolToken}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { title: "Hacked" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /api/problems/:id/testcases ──────────────────────────────────────────

describe("POST /api/problems/:id/testcases", () => {
  it("problem_setter can add a testcase", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...sampleProblem, testcases: [] },
    });
    const { id } = createRes.json<{ id: number }>();

    const tcRes = await app.inject({
      method: "POST",
      url: `/api/problems/${id}/testcases`,
      headers: { authorization: `Bearer ${token}` },
      payload: { orderIndex: 1, isPublic: true, inputData: "1 2", expectedOutput: "3" },
    });
    expect(tcRes.statusCode).toBe(201);
    expect(tcRes.json<{ id: number }>().id).toBeDefined();
  });

  it("duplicate orderIndex on an existing problem → 409", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const res = await app.inject({
      method: "POST",
      url: `/api/problems/${id}/testcases`,
      headers: { authorization: `Bearer ${token}` },
      payload: { orderIndex: 1, isPublic: true, inputData: "dup", expectedOutput: "dup" },
    });
    expect(res.statusCode).toBe(409);
  });
});

// ── PUT /api/problems/:id/testcases/:tcId ─────────────────────────────────────

describe("PUT /api/problems/:id/testcases/:tcId", () => {
  it("problem_setter can update isPublic and inputData of a testcase", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const { testcases } = detailRes.json<{ testcases: { id: number; isPublic: boolean }[] }>();
    const publicTc = testcases.find((tc) => tc.isPublic)!;

    const res = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}/testcases/${publicTc.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { isPublic: false, inputData: "updated input" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ inputData: string; isPublic: boolean }>();
    expect(body.inputData).toBe("updated input");
    expect(body.isPublic).toBe(false);
  });
});

// ── DELETE /api/problems/:id/testcases/:tcId ──────────────────────────────────

describe("DELETE /api/problems/:id/testcases/:tcId", () => {
  it("problem_setter can delete a testcase", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const { testcases } = detailRes.json<{ testcases: { id: number }[] }>();
    const tcId = testcases[0]!.id;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/problems/${id}/testcases/${tcId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });
});

// ── DELETE /api/problems/:id ───────────────────────────────────────────────────

describe("DELETE /api/problems/:id", () => {
  it("problem_setter → 409 when problem is referenced by an exam session", async () => {
    const carolToken = await loginAs(app, "carol", "Test@1234");
    const aliceToken = await loginAs(app, "alice", "Test@1234");

    // 1. Carol 建立基礎題目
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${carolToken}` },
      payload: sampleProblem,
    });
    const { id: problemId } = createRes.json<{ id: number }>();

    // 2. Alice 建立考卷模板，並綁定該題目
    const examRes = await app.inject({
      method: "POST",
      url: "/api/exam-sessions/templates/manual", // 💡 對應 app.post("/templates/manual")
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        title: "Test Exam Template Containing This Problem",
        durationMinutes: 60,
        problems: [
          { problemId, scoreWeight: 100, orderIndex: 1 }
        ],
      },
    });

    const { id: examId } = examRes.json<{ id: number }>();

    // 3. Alice 批次指派考卷給考生（產生 Exam Session 實體）
    const assignRes = await app.inject({
      method: "POST",
      url: `/api/exam-sessions/templates/${examId}/assign`, // 💡 對應 app.post("/templates/:id/assign")
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        candidateIds: [candidate1Id],
      },
    });

    // 4. Carol 嘗試刪除題目
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/problems/${problemId}`,
      headers: { authorization: `Bearer ${carolToken}` },
    });

    expect(delRes.statusCode).toBe(409);
  });

  it("interviewer → 403 (no problem:manage)", async () => {
    const carolToken = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${carolToken}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "DELETE",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("soft-deleted problem rejects detail/update/testcase/language operations", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    await app.inject({
      method: "DELETE",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detail.statusCode).toBe(404);

    const update = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Nope" },
    });
    expect(update.statusCode).toBe(404);

    const testcase = await app.inject({
      method: "POST",
      url: `/api/problems/${id}/testcases`,
      headers: { authorization: `Bearer ${token}` },
      payload: { orderIndex: 3, isPublic: true, inputData: "", expectedOutput: "" },
    });
    expect(testcase.statusCode).toBe(404);

    const languages = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}/languages`,
      headers: { authorization: `Bearer ${token}` },
      payload: [{ language: "cpp17", timeMultiplier: 1, memoryMultiplier: 1 }],
    });
    expect(languages.statusCode).toBe(404);
  });
});

// ── GET /api/languages ────────────────────────────────────────────────────────

describe("GET /api/languages", () => {
  it("problem_setter can list languages", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const res = await app.inject({
      method: "GET",
      url: "/api/languages",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ language: string; displayName: string }[]>();
    expect(Array.isArray(body)).toBe(true);
    const languages = body.map((l) => l.language);
    expect(languages).toContain("cpp17");
    expect(languages).toContain("python3");
  });

  it("interviewer can list languages", async () => {
    const token = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "GET",
      url: "/api/languages",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("unauthenticated → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/languages" });
    expect(res.statusCode).toBe(401);
  });
});

// ── POST /api/problems with languageLimits ────────────────────────────────────

describe("POST /api/problems with languageLimits", () => {
  it("problem_setter can create a problem with language limits", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    
    // 1. 嘗試發送建立題目的請求（帶有 cpp17 與 python3）
    const res = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...sampleProblem,
        languageLimits: [
          { language: "cpp17", timeMultiplier: 1.0, memoryMultiplier: 1.0 },
          { language: "python3", timeMultiplier: 3.0, memoryMultiplier: 2.0 },
        ],
      },
    });

    // 📡 偵錯點 A：確認建立題目時，後端回傳的狀態碼與完整的 Problem Body 結構
    console.log("=== 🔍 [DEBUG A] POST /api/problems (With LanguageLimits) ===");
    console.log("Status:", res.statusCode);
    console.log("Body:", JSON.stringify(res.json(), null, 2));

    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: number }>();

    // 2. 獲取該題目的詳細資訊
    const detailRes = await app.inject({
      method: "GET",
      url: `/api/problems/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    // 📡 偵錯點 B：確認 GET 詳細資訊時，整個 JSON 回應，特別是 languageLimits 的陣列內容
    console.log("=== 🔍 [DEBUG B] GET /api/problems/:id (Detail Payload) ===");
    console.log("Status:", detailRes.statusCode);
    console.log("Full Body:", JSON.stringify(detailRes.json(), null, 2));
    if (detailRes.json<{ languageLimits?: any }>().languageLimits) {
      console.log("LanguageLimits Type & Value:", typeof detailRes.json<{ languageLimits: any }>().languageLimits, detailRes.json<{ languageLimits: any }>().languageLimits);
    }
    console.log("==========================================================");

    expect(detailRes.statusCode).toBe(200);
    const body = detailRes.json<{ languageLimits: { language: string }[] }>();
    
    // 這裡會發生斷言錯誤，但在看 log 之前可以先留著
    expect(body.languageLimits).toHaveLength(2);
    expect(body.languageLimits.map((l) => l.language).sort()).toEqual(["cpp17", "python3"]);
  });
});

// ── PUT /api/problems/:id/languages ──────────────────────────────────────────

describe("PUT /api/problems/:id/languages", () => {
  it("problem_setter can set language limits", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const res = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}/languages`,
      headers: { authorization: `Bearer ${token}` },
      payload: [
        { language: "cpp17", timeMultiplier: 2.0, memoryMultiplier: 1.5 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ language: string; timeMultiplier: string }[]>();
    expect(body).toHaveLength(1);
    expect(body[0]!.language).toBe("cpp17");
  });

  it("problem_setter can clear language limits by passing empty array", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...sampleProblem,
        languageLimits: [{ language: "cpp17", timeMultiplier: 1.0, memoryMultiplier: 1.0 }],
      },
    });
    const { id } = createRes.json<{ id: number }>();

    const res = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}/languages`,
      headers: { authorization: `Bearer ${token}` },
      payload: [],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toHaveLength(0);
  });

  it("interviewer → 403 (no problem:manage)", async () => {
    const carolToken = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${carolToken}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const aliceToken = await loginAs(app, "alice", "Test@1234");
    const res = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}/languages`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: [{ language: "cpp17", timeMultiplier: 1.0, memoryMultiplier: 1.0 }],
    });
    expect(res.statusCode).toBe(403);
  });

  it("unknown language → 400 and duplicate language → 409", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/problems",
      headers: { authorization: `Bearer ${token}` },
      payload: sampleProblem,
    });
    const { id } = createRes.json<{ id: number }>();

    const unknown = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}/languages`,
      headers: { authorization: `Bearer ${token}` },
      payload: [{ language: "ruby", timeMultiplier: 1, memoryMultiplier: 1 }],
    });
    expect(unknown.statusCode).toBe(400);

    const duplicate = await app.inject({
      method: "PUT",
      url: `/api/problems/${id}/languages`,
      headers: { authorization: `Bearer ${token}` },
      payload: [
        { language: "cpp17", timeMultiplier: 1, memoryMultiplier: 1 },
        { language: "cpp17", timeMultiplier: 2, memoryMultiplier: 2 },
      ],
    });
    expect(duplicate.statusCode).toBe(409);
  });
});

// ── GET /api/exam-sessions (problem_setter access) ────────────────────────────

describe("GET /api/exam-sessions as problem_setter", () => {
  it("problem_setter → 403 (no exam:manage or exam:take)", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const res = await app.inject({
      method: "GET",
      url: "/api/exam-sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /api/users/:id (problem_setter self) ───────────────────────────────────

describe("GET /api/users/:id as problem_setter", () => {
  it("problem_setter can view own profile", async () => {
    const token = await loginAs(app, "carol", "Test@1234");
    const res = await app.inject({
      method: "GET",
      url: `/api/users/${carolId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ username: string }>().username).toBe("carol");
  });
});
