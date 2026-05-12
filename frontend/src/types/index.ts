// ── Auth ──────────────────────────────────────────────────────────────────────
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
}

// ── Language ──────────────────────────────────────────────────────────────────
export interface Language {
  language: string;
  displayName: string;
  timeMultiplier: string;
  memoryMultiplier: string;
  isEnabled: boolean;
  createdAt: string;
}

// ── Problem ───────────────────────────────────────────────────────────────────
export type Difficulty = "easy" | "medium" | "hard";

export interface LanguageLimit {
  language: string;
  timeMultiplier: string;
  memoryMultiplier: string;
}

// ── Exam Session ──────────────────────────────────────────────────────────────
export type ExamStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "expired"
  | "cancelled";

export interface ExamSession {
  id: number;
  candidateId: number;
  createdBy: number;
  status: ExamStatus;
  durationMinutes: number;
  actualStartAt: string | null;
  expiresAt: string | null;
  totalScore: number;
  maxScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExamSessionProblem {
  id: number;
  orderIndex: number;
  scoreWeight: number;
  score: number;
  problemId: number;
  title: string;
  descriptionMd: string;
  difficulty: Difficulty;
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitKb: number;
  languageLimits: LanguageLimit[];
}

// ── Submission ────────────────────────────────────────────────────────────────
export type SubmissionStatus = "pending" | "judging" | "done" | "system_error";
export type Verdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE";
export type TestcaseVerdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "skipped";

export interface SubmissionCreated {
  id: number;
  examSessionProblemId: number;
  language: string;
  status: SubmissionStatus;
  verdict: Verdict | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  submittedAt: string;
  judgedAt: string | null;
}

export interface SubmissionSummary {
  id: number;
  examSessionProblemId: number;
  problemId: number;
  problemTitle: string;
  orderIndex: number;
  language: string;
  status: SubmissionStatus;
  verdict: Verdict | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  submittedAt: string;
  judgedAt: string | null;
  score: number;
  scoreWeight: number;
  isFinalSubmission: boolean;
}

export interface TestcaseResult {
  id: number;
  testcaseId: number;
  orderIndex: number;
  isPublic: boolean;
  verdict: TestcaseVerdict;
  runtimeMs: number | null;
  memoryKb: number | null;
  actualOutput?: string | null;
}

export interface SubmissionDetail extends SubmissionSummary {
  sourceCode: string;
  testcaseResults: TestcaseResult[];
}

// ── Session Result ────────────────────────────────────────────────────────────
export interface SessionResultProblem {
  examSessionProblemId: number;
  problemId: number;
  problemTitle: string;
  orderIndex: number;
  scoreWeight: number;
  score: number;
  latestStatus: string;
  latestSubmissionId: number | null;
  finalSubmissionId: number | null;
  language: string | null;
  runtimeMs: number | null;
  memoryKb: number | null;
  submittedAt: string | null;
  judgedAt: string | null;
}

export interface SessionResult {
  id: number;
  candidate: { id: number; username: string; displayName: string | null };
  status: ExamStatus;
  actualStartAt: string | null;
  expiresAt: string | null;
  totalScore: number;
  maxScore: number;
  problems: SessionResultProblem[];
}
