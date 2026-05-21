import {
  pgTable,
  pgEnum,
  bigserial,
  bigint,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ── Enums ─────────────────────────────────────────────────────────────────────
export const difficultyLevelEnum = pgEnum("difficulty_level", ["easy", "medium", "hard"]);

export const examStatusEnum = pgEnum("exam_status", [
  "not_started",
  "in_progress",
  "submitted",
  "expired",
  "cancelled",
]);

export const submissionStatusEnum = pgEnum("submission_status", [
  "pending",
  "judging",
  "done",
  "system_error",
]);

export const submissionTypeEnum = pgEnum("submission_type", ["simple", "formal"]);

export const verdictTypeEnum = pgEnum("verdict_type", ["AC", "WA", "TLE", "MLE", "RE", "CE"]);

export const testcaseVerdictTypeEnum = pgEnum("testcase_verdict_type", [
  "AC",
  "WA",
  "TLE",
  "MLE",
  "RE",
  "skipped",
]);

// ── IAM ───────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 128 }),
  isSuperuser: boolean("is_superuser").notNull().default(false),
  createdBy: bigint("created_by", { mode: "number" }).references((): AnyPgColumn => users.id),
  encryptedPassword: text("encrypted_password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const roles = pgTable("roles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  description: varchar("description", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  description: varchar("description", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: bigint("user_id", { mode: "number" }).notNull(),
    roleId: bigint("role_id", { mode: "number" }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
  }),
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: bigint("role_id", { mode: "number" }).notNull(),
    permissionId: bigint("permission_id", { mode: "number" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
  }),
);

// ── Problem ───────────────────────────────────────────────────────────────────
export const languageDefaults = pgTable("language_defaults", {
  language: varchar("language", { length: 32 }).primaryKey(),
  displayName: varchar("display_name", { length: 64 }).notNull(),
  timeMultiplier: numeric("time_multiplier", { precision: 4, scale: 2 }).notNull().default("1.0"),
  memoryMultiplier: numeric("memory_multiplier", { precision: 4, scale: 2 })
    .notNull()
    .default("1.0"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const problems = pgTable("problems", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  descriptionMd: text("description_md").notNull(),
  difficulty: difficultyLevelEnum("difficulty").notNull(),
  timeLimitMs: integer("time_limit_ms").notNull(),
  memoryLimitMb: integer("memory_limit_mb").notNull(),
  outputLimitKb: integer("output_limit_kb").notNull().default(64),
  createdBy: bigint("created_by", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const problemTestcases = pgTable("problem_testcases", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  problemId: bigint("problem_id", { mode: "number" }).notNull(),
  orderIndex: integer("order_index").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  inputData: text("input_data").notNull(),
  expectedOutput: text("expected_output").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const problemLanguageLimits = pgTable(
  "problem_language_limits",
  {
    problemId: bigint("problem_id", { mode: "number" }).notNull(),
    language: varchar("language", { length: 32 }).notNull(),
    timeMultiplier: numeric("time_multiplier", { precision: 4, scale: 2 }).notNull(),
    memoryMultiplier: numeric("memory_multiplier", { precision: 4, scale: 2 }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.problemId, t.language] }),
  }),
);

// ── Exam ──────────────────────────────────────────────────────────────────────

/**
 * 1. 考試模板表 (Exams)
 * 儲存主管建立的「考卷範本」，例如：「2026 後端工程師初試卷」
 * 這裡「不」綁定任何候選人，純粹作為考卷的設定與時長。
 */
export const exams = pgTable("exams", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(), // 考卷標題
  durationMinutes: integer("duration_minutes").notNull(),
  createdBy: bigint("created_by", { mode: "number" })
    .notNull()
    .references((): AnyPgColumn => users.id), // 建立此考卷的主管
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * 2. 考卷題目關聯表 (Exam Problems)
 * 記錄這張考卷裡面，主管挑選了哪些題目、順序為何、配分幾分。
 */
export const examProblems = pgTable("exam_problems", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  examId: bigint("exam_id", { mode: "number" })
    .notNull()
    .references((): AnyPgColumn => exams.id, { onDelete: "cascade" }),
  problemId: bigint("problem_id", { mode: "number" })
    .notNull()
    .references((): AnyPgColumn => problems.id),
  orderIndex: integer("order_index").notNull(), // 題目在考卷中的順序
  scoreWeight: integer("score_weight").notNull().default(100), // 該題配分 (原存在 session_problems，移至模板更合理)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 3. 考試場次實體表 (Exam Sessions) - 關鍵多對多橋樑
 * 當主管選擇「將某一場考試(examId) 分配給 多個面試者(candidateIds)」時，
 * 後端會在這裡批次插入多筆資料。
 */
export const examSessions = pgTable("exam_sessions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  examId: bigint("exam_id", { mode: "number" })
    .notNull()
    .references((): AnyPgColumn => exams.id), // 關聯對應的考卷模板
  candidateId: bigint("candidate_id", { mode: "number" })
    .notNull()
    .references((): AnyPgColumn => users.id), // 分配給哪位面試者
  createdBy: bigint("created_by", { mode: "number" })
    .notNull()
    .references((): AnyPgColumn => users.id), // 執行派考動作的主管
  status: examStatusEnum("status").notNull().default("not_started"),
  actualStartAt: timestamp("actual_start_at", { withTimezone: true }), // 自由進場：按下「開始」的時間
  expiresAt: timestamp("expires_at", { withTimezone: true }), // 系統自動收卷的絕對死線
  submittedAt: timestamp("submitted_at", { withTimezone: true }), // 實際交卷時間
  totalScore: integer("total_score").notNull().default(0), // 該面試者此場總得分
  maxScore: integer("max_score").notNull().default(0), // 該場考試的總滿分
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * 4. 考生場次題目快照表 (Exam Session Problems)
 * 維持你們原本的設計，當面試者開始測驗時，把考卷題目實體化到這裡，
 * 用來記錄該面試者「這一題」拿了幾分、最終提交的程式碼(finalSubmissionId)是什麼。
 */
export const examSessionProblems = pgTable("exam_session_problems", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  examSessionId: bigint("exam_session_id", { mode: "number" })
    .notNull()
    .references((): AnyPgColumn => examSessions.id, { onDelete: "cascade" }),
  problemId: bigint("problem_id", { mode: "number" })
    .notNull()
    .references((): AnyPgColumn => problems.id),
  orderIndex: integer("order_index").notNull(),
  scoreWeight: integer("score_weight").notNull(),
  finalSubmissionId: bigint("final_submission_id", { mode: "number" }).references(
    (): AnyPgColumn => submissions.id,
  ),
  score: integer("score").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Submission ────────────────────────────────────────────────────────────────
export const submissions = pgTable("submissions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  examSessionProblemId: bigint("exam_session_problem_id", { mode: "number" }).notNull(),
  candidateId: bigint("candidate_id", { mode: "number" }).notNull(),
  language: varchar("language", { length: 32 }).notNull(),
  sourceCode: text("source_code").notNull(),
  submissionType: submissionTypeEnum("submission_type").notNull().default("formal"),
  status: submissionStatusEnum("status").notNull().default("pending"),
  verdict: verdictTypeEnum("verdict"),
  runtimeMs: integer("runtime_ms"),
  memoryKb: integer("memory_kb"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  judgedAt: timestamp("judged_at", { withTimezone: true }),
});

// ── Anti-cheat ────────────────────────────────────────────────────────────────

export const violationTypeEnum = pgEnum("violation_type", [
  "fullscreen_exit",
  "tab_switch",
  "window_blur",
  "paste",
  "copy",
]);

export const examViolations = pgTable("exam_violations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sessionId: bigint("session_id", { mode: "number" })
    .notNull()
    .references((): AnyPgColumn => examSessions.id, { onDelete: "cascade" }),
  type: violationTypeEnum("type").notNull(),
  detail: text("detail"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Submission ────────────────────────────────────────────────────────────────

export const submissionTestcaseResults = pgTable("submission_testcase_results", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  submissionId: bigint("submission_id", { mode: "number" }).notNull(),
  testcaseId: bigint("testcase_id", { mode: "number" }).notNull(),
  verdict: testcaseVerdictTypeEnum("verdict").notNull(),
  runtimeMs: integer("runtime_ms"),
  memoryKb: integer("memory_kb"),
  actualOutput: text("actual_output"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
