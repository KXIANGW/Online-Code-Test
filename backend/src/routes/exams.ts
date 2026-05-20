import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../hooks/authenticate";
import {
  createExamTemplate,
  createExamTemplateRandom,
  listExamTemplates,
  assignExamToCandidates,
  listExamSessions,
  getExamSession,
  startExamSession,
  submitExamSession,
  cancelExamSession,
  getExamSessionProblems,
  getPublicTestcases,
} from "../services/exam.service";
import { saveDraft, getDrafts } from "../services/draft.service";
import { BadRequestError } from "../errors";
import { parsePositiveIntParam } from "./params";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const saveDraftBody = z.object({
  code: z.string().max(65536),
});

// 調整：手動建立考卷模板的驗證（移除了 candidateId，增加了 title）
const createManualTemplateBody = z.object({
  title: z.string().min(1).max(255),
  durationMinutes: z.number().int().min(1),
  problems: z.array(
    z.object({
      problemId: z.number().int(),
      scoreWeight: z.number().int().min(1),
      orderIndex: z.number().int().min(1),
    })
  ).min(1),
});

// 調整：隨機建立考卷模板的驗證（移除了 candidateId，增加了 title）
const createRandomTemplateBody = z.object({
  title: z.string().min(1).max(255),
  durationMinutes: z.number().int().min(1),
  distribution: z.object({
    easy: z.number().int().min(0).optional(),
    medium: z.number().int().min(0).optional(),
    hard: z.number().int().min(0).optional(),
  }),
  scoreWeight: z.number().int().min(1),
});

// 新增：批次指派考試給多個面試者帳號的驗證
const assignExamBody = z.object({
  candidateIds: z.array(z.number().int()).min(1),
});

// ── Routes Definitions ────────────────────────────────────────────────────────

export const examRoutes: FastifyPluginAsync = async (app) => {
  // 1. 手動建立考卷模板
  app.post("/templates/manual", { preHandler: [authenticate] }, async (request, reply) => {
    const result = createManualTemplateBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);

    const template = await createExamTemplate(request.user, result.data);
    return reply.status(201).send(template);
  });

  // 2. 隨機快速組裝考卷模板 (方案 A)
  app.post("/templates/random", { preHandler: [authenticate] }, async (request, reply) => {
    const result = createRandomTemplateBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);

    const template = await createExamTemplateRandom(request.user, result.data);
    return reply.status(201).send(template);
  });

  // 3. 獲取考卷模板列表（主管選範本時使用）
  app.get("/templates", { preHandler: [authenticate] }, async (request) => {
    return listExamTemplates(request.user);
  });

  // 4. 核心新增：指派指定考卷模板給多位面試者帳號（批次派考）
  app.post("/templates/:id/assign", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const examId = parsePositiveIntParam(id, "id");

    const result = assignExamBody.safeParse(request.body);
    if (!result.success) throw BadRequestError(result.error.message);

    const sessions = await assignExamToCandidates(request.user, examId, result.data);
    return reply.status(201).send(sessions);
  });

  // 5. 獲取考試場次列表
  app.get("/", { preHandler: [authenticate] }, async (request) => {
    return listExamSessions(request.user);
  });

  // 6. 獲取單一場次詳細資訊
  app.get("/:id", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return getExamSession(request.user, parsePositiveIntParam(id, "id"));
  });

  // 7. 面試者進入並開始測驗
  app.post("/:id/start", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return startExamSession(request.user, parsePositiveIntParam(id, "id"));
  });

  // 8. 面試者主動提交考卷
  app.post("/:id/submit", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return submitExamSession(request.user, parsePositiveIntParam(id, "id"));
  });

  // 9. 主管取消該場次考試
  app.post("/:id/cancel", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return cancelExamSession(request.user, parsePositiveIntParam(id, "id"));
  });

  // 10. 獲取該場次的題目清單與語言倍率
  app.get("/:id/problems", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return getExamSessionProblems(request.user, parsePositiveIntParam(id, "id"));
  });

  // 11. 獲取公開測資
  app.get("/:id/problems/:espId/testcases", { preHandler: [authenticate] }, async (request) => {
    const { id, espId } = request.params as { id: string; espId: string };
    return getPublicTestcases(
      request.user,
      parsePositiveIntParam(id, "id"),
      parsePositiveIntParam(espId, "espId"),
    );
  });

  // 12. 儲存草稿：依題目與語言分開保存
  app.put("/:id/drafts/:problemId/:language", { preHandler: [authenticate] }, async (request) => {
    const { id, problemId, language } = request.params as {
      id: string;
      problemId: string;
      language: string;
    };
    const sessionId = parsePositiveIntParam(id, "id");
    const pid = parsePositiveIntParam(problemId, "problemId");

    if (!language || language.length > 32) {
      throw BadRequestError("invalid language");
    }

    const result = saveDraftBody.safeParse(request.body);
    if (!result.success) {
      throw BadRequestError(result.error.message);
    }

    return saveDraft(request.user, sessionId, pid, language, result.data.code);
  });

  // 13. 讀取草稿
  app.get("/:id/drafts", { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    return getDrafts(request.user, parsePositiveIntParam(id, "id"));
  });
};
