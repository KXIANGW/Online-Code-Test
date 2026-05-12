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
export const difficultyLevelEnum = pgEnum("difficulty_level", [
  "easy",
  "medium",
  "hard",
]);

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

export const submissionTypeEnum = pgEnum("submission_type", [
  "simple",
  "formal",
]);

export const verdictTypeEnum = pgEnum("verdict_type", [
  "AC",
  "WA",
  "TLE",
  "MLE",
  "RE",
  "CE",
]);

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
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  username:     varchar("username",      { length: 64  }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  displayName:  varchar("display_name",  { length: 128 }),
  isSuperuser:  boolean("is_superuser").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt:    timestamp("deleted_at", { withTimezone: true }),
});

export const roles = pgTable("roles", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  name:        varchar("name",        { length: 64  }).notNull().unique(),
  description: varchar("description", { length: 255 }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  code:        varchar("code",        { length: 64  }).notNull().unique(),
  description: varchar("description", { length: 255 }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId:    bigint("user_id", { mode: "number" }).notNull(),
    roleId:    bigint("role_id", { mode: "number" }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
  })
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId:       bigint("role_id",       { mode: "number" }).notNull(),
    permissionId: bigint("permission_id", { mode: "number" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
  })
);

// ── Problem ───────────────────────────────────────────────────────────────────
export const languageDefaults = pgTable("language_defaults", {
  language:         varchar("language",     { length: 32 }).primaryKey(),
  displayName:      varchar("display_name", { length: 64 }).notNull(),
  timeMultiplier:   numeric("time_multiplier",   { precision: 4, scale: 2 }).notNull().default("1.0"),
  memoryMultiplier: numeric("memory_multiplier", { precision: 4, scale: 2 }).notNull().default("1.0"),
  isEnabled:        boolean("is_enabled").notNull().default(true),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const problems = pgTable("problems", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  title:          varchar("title", { length: 255 }).notNull(),
  descriptionMd:  text("description_md").notNull(),
  difficulty:     difficultyLevelEnum("difficulty").notNull(),
  timeLimitMs:    integer("time_limit_ms").notNull(),
  memoryLimitMb:  integer("memory_limit_mb").notNull(),
  outputLimitKb:  integer("output_limit_kb").notNull().default(64),
  createdBy:      bigint("created_by", { mode: "number" }).notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt:      timestamp("deleted_at", { withTimezone: true }),
});

export const problemTestcases = pgTable("problem_testcases", {
  id:             bigserial("id", { mode: "number" }).primaryKey(),
  problemId:      bigint("problem_id", { mode: "number" }).notNull(),
  orderIndex:     integer("order_index").notNull(),
  isPublic:       boolean("is_public").notNull().default(false),
  inputData:      text("input_data").notNull(),
  expectedOutput: text("expected_output").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const problemLanguageLimits = pgTable(
  "problem_language_limits",
  {
    problemId:        bigint("problem_id", { mode: "number" }).notNull(),
    language:         varchar("language",  { length: 32  }).notNull(),
    timeMultiplier:   numeric("time_multiplier",   { precision: 4, scale: 2 }).notNull(),
    memoryMultiplier: numeric("memory_multiplier", { precision: 4, scale: 2 }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.problemId, t.language] }),
  })
);

// ── Exam ──────────────────────────────────────────────────────────────────────
export const examSessions = pgTable("exam_sessions", {
  id:              bigserial("id", { mode: "number" }).primaryKey(),
  candidateId:     bigint("candidate_id", { mode: "number" }).notNull(),
  createdBy:       bigint("created_by",   { mode: "number" }).notNull(),
  status:          examStatusEnum("status").notNull().default("not_started"),
  durationMinutes: integer("duration_minutes").notNull(),
  actualStartAt:   timestamp("actual_start_at", { withTimezone: true }),
  expiresAt:       timestamp("expires_at",       { withTimezone: true }),
  totalScore:      integer("total_score").notNull().default(0),
  maxScore:        integer("max_score").notNull().default(0),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const examSessionProblems = pgTable("exam_session_problems", {
  id:                bigserial("id", { mode: "number" }).primaryKey(),
  examSessionId:     bigint("exam_session_id", { mode: "number" }).notNull(),
  problemId:         bigint("problem_id",      { mode: "number" }).notNull(),
  orderIndex:        integer("order_index").notNull(),
  scoreWeight:       integer("score_weight").notNull(),
  // Circular FK to submissions — lazy reference breaks TypeScript circular dependency
  finalSubmissionId: bigint("final_submission_id", { mode: "number" })
                       .references((): AnyPgColumn => submissions.id),
  score:             integer("score").notNull().default(0),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Submission ────────────────────────────────────────────────────────────────
export const submissions = pgTable("submissions", {
  id:                   bigserial("id", { mode: "number" }).primaryKey(),
  examSessionProblemId: bigint("exam_session_problem_id", { mode: "number" }).notNull(),
  candidateId:          bigint("candidate_id", { mode: "number" }).notNull(),
  language:             varchar("language", { length: 32 }).notNull(),
  sourceCode:           text("source_code").notNull(),
  submissionType:       submissionTypeEnum("submission_type").notNull().default("formal"),
  status:               submissionStatusEnum("status").notNull().default("pending"),
  verdict:              verdictTypeEnum("verdict"),
  runtimeMs:            integer("runtime_ms"),
  memoryKb:             integer("memory_kb"),
  submittedAt:          timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  judgedAt:             timestamp("judged_at",    { withTimezone: true }),
});

export const submissionTestcaseResults = pgTable("submission_testcase_results", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  submissionId: bigint("submission_id", { mode: "number" }).notNull(),
  testcaseId:   bigint("testcase_id",   { mode: "number" }).notNull(),
  verdict:      testcaseVerdictTypeEnum("verdict").notNull(),
  runtimeMs:    integer("runtime_ms"),
  memoryKb:     integer("memory_kb"),
  actualOutput: text("actual_output"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
