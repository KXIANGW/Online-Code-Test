import type {
  Language,
  ExamSession,
  ExamSessionProblem,
  SubmissionSummary,
  SubmissionDetail,
  SessionResult,
  ProblemSummary,
  Problem,
  UserSummary,
} from "../types";

// ── Problems ──────────────────────────────────────────────────────────────────
export const mockProblemSummaries: ProblemSummary[] = [
  {
    id: 1,
    title: "Two Sum",
    difficulty: "easy",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    title: "Binary Search",
    difficulty: "medium",
    timeLimitMs: 2000,
    memoryLimitMb: 128,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: 3,
    title: "Merge Sort",
    difficulty: "hard",
    timeLimitMs: 3000,
    memoryLimitMb: 512,
    createdAt: "2026-01-03T00:00:00.000Z",
  },
];

export const mockProblemDetail: Problem = {
  id: 1,
  title: "Two Sum",
  descriptionMd: "## Two Sum\n\nGiven an array of integers...",
  difficulty: "easy",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  outputLimitKb: 64,
  createdBy: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  testcases: [
    { id: 10, orderIndex: 0, isPublic: true, inputData: "2 7 11 15\n9", expectedOutput: "0 1" },
    { id: 11, orderIndex: 1, isPublic: false, inputData: "3 2 4\n6", expectedOutput: "1 2" },
  ],
  languageLimits: [],
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const mockUserSummaries: UserSummary[] = [
  {
    id: 1,
    username: "candidate01",
    displayName: "Alice Chen",
    isSuperuser: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    roles: ["candidate"],
  },
  {
    id: 2,
    username: "interviewer01",
    displayName: "Bob Li",
    isSuperuser: false,
    createdAt: "2026-01-02T00:00:00.000Z",
    roles: ["interviewer"],
  },
  {
    id: 3,
    username: "root",
    displayName: "Prof. Wang",
    isSuperuser: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    roles: [],
  },
];

export const mockUsers = {
  candidate: {
    id: 1,
    username: "candidate01",
    displayName: "Alice Chen",
    isSuperuser: false,
  },
  admin: {
    id: 2,
    username: "admin",
    displayName: "Prof. Wang",
    isSuperuser: true,
  },
} as const;

// Mock passwords (for MSW login handler): both use "password"
export const mockPasswords: Record<string, string> = {
  candidate01: "password",
  admin: "password",
};

export const mockTokens: Record<string, string> = {
  candidate01: "mock.jwt.candidate01",
  admin: "mock.jwt.admin",
};

// ── Languages ─────────────────────────────────────────────────────────────────
export const mockLanguages: Language[] = [
  {
    language: "python3",
    displayName: "Python 3.11",
    timeMultiplier: "2.00",
    memoryMultiplier: "1.50",
    isEnabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  },
  {
    language: "cpp17",
    displayName: "C++ 17",
    timeMultiplier: "1.00",
    memoryMultiplier: "1.00",
    isEnabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  },
  {
    language: "java21",
    displayName: "Java 21",
    timeMultiplier: "2.00",
    memoryMultiplier: "2.00",
    isEnabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  },
];

// ── Exam Session Problems ─────────────────────────────────────────────────────
// Matches the shape returned by GET /api/exam-sessions/:id/problems
export const mockExamProblems: ExamSessionProblem[] = [
  {
    id: 101,
    orderIndex: 1,
    scoreWeight: 50,
    score: 0,
    problemId: 1,
    title: "Two Sum",
    descriptionMd: `## Two Sum

Given an array of integers \`nums\` and an integer \`target\`, return the **indices** of the two numbers that add up to \`target\`.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

**Example 1:**

\`\`\`
Input:  nums = [2, 7, 11, 15], target = 9
Output: [0, 1]
\`\`\`

**Example 2:**

\`\`\`
Input:  nums = [3, 2, 4], target = 6
Output: [1, 2]
\`\`\`

**Constraints:**
- \`2 ≤ nums.length ≤ 10⁴\`
- \`-10⁹ ≤ nums[i] ≤ 10⁹\`
- Only one valid answer exists.
`,
    difficulty: "easy",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    outputLimitKb: 64,
    languageLimits: [
      { language: "python3", timeMultiplier: "2.00", memoryMultiplier: "1.50" },
      { language: "java21", timeMultiplier: "2.00", memoryMultiplier: "2.00" },
    ],
  },
  {
    id: 102,
    orderIndex: 2,
    scoreWeight: 50,
    score: 0,
    problemId: 2,
    title: "Valid Parentheses",
    descriptionMd: `## Valid Parentheses

Given a string \`s\` containing only the characters \`'('\`, \`')'\`, \`'{'\`, \`'}'\`, \`'['\` and \`']'\`, determine if the input string is **valid**.

An input string is valid if:
1. Open brackets must be closed by the **same type** of brackets.
2. Open brackets must be closed in the **correct order**.
3. Every close bracket has a corresponding open bracket of the same type.

**Example 1:**

\`\`\`
Input:  s = "()"
Output: true
\`\`\`

**Example 2:**

\`\`\`
Input:  s = "()[]{}"
Output: true
\`\`\`

**Example 3:**

\`\`\`
Input:  s = "(]"
Output: false
\`\`\`

**Constraints:**
- \`1 ≤ s.length ≤ 10⁴\`
- \`s\` consists of parentheses only \`'()[]{}'
`,
    difficulty: "medium",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    outputLimitKb: 64,
    languageLimits: [],
  },
];

// ── Exam Sessions ─────────────────────────────────────────────────────────────
// Fixed ISO timestamps so snapshots are deterministic
const T_30MIN_AGO = "2026-05-10T07:30:00.000Z";
const T_IN_1H = "2026-05-10T09:00:00.000Z";
const T_YESTERDAY = "2026-05-09T08:00:00.000Z";
const T_2DAYS_AGO = "2026-05-08T08:00:00.000Z";
const T_2DAYS_END = "2026-05-08T09:30:00.000Z";

export const mockExamSessions: ExamSession[] = [
  {
    // Not yet started — shows on dashboard as "Pending"
    id: 1,
    examId: 101,
    examTitle: "考試 #1",
    candidateId: 1,
    candidate: { id: 1, username: "candidate01", displayName: "Alice Chen" },
    createdBy: 2,
    status: "not_started",
    durationMinutes: 90,
    actualStartAt: null,
    expiresAt: null,
    submittedAt: null,
    totalScore: 0,
    maxScore: 100,
    createdAt: T_YESTERDAY,
    updatedAt: T_YESTERDAY,
  },
  {
    // Active exam — used in ExamPage mock
    id: 2,
    examId: 102,
    examTitle: "考試 #2",
    candidateId: 1,
    candidate: { id: 1, username: "candidate01", displayName: "Alice Chen" },
    createdBy: 2,
    status: "in_progress",
    durationMinutes: 90,
    actualStartAt: T_30MIN_AGO,
    expiresAt: T_IN_1H,
    submittedAt: null,
    totalScore: 0,
    maxScore: 100,
    createdAt: T_YESTERDAY,
    updatedAt: T_30MIN_AGO,
  },
  {
    // Completed — shows final score on dashboard
    id: 3,
    examId: 103,
    examTitle: "考試 #3",
    candidateId: 1,
    candidate: { id: 1, username: "candidate01", displayName: "Alice Chen" },
    createdBy: 2,
    status: "submitted",
    durationMinutes: 90,
    actualStartAt: T_2DAYS_AGO,
    expiresAt: T_2DAYS_END,
    submittedAt: T_2DAYS_END,
    totalScore: 50,
    maxScore: 100,
    createdAt: T_2DAYS_AGO,
    updatedAt: T_2DAYS_AGO,
  },
];

// ── Submissions ───────────────────────────────────────────────────────────────
// Two submissions for session 2, problem "Two Sum":
//   attempt 1 → WA, attempt 2 → AC  (mirrors backend mock judge logic)
export const mockSubmissions: SubmissionSummary[] = [
  {
    id: 1,
    examSessionProblemId: 101,
    problemId: 1,
    problemTitle: "Two Sum",
    orderIndex: 1,
    language: "python3",
    submissionType: "simple",
    status: "done",
    verdict: "WA",
    runtimeMs: 24,
    memoryKb: 4096,
    submittedAt: "2026-05-10T07:35:00.000Z",
    judgedAt: "2026-05-10T07:35:03.000Z",
    score: 0,
    scoreWeight: 50,
    isFinalSubmission: false,
  },
  {
    id: 2,
    examSessionProblemId: 101,
    problemId: 1,
    problemTitle: "Two Sum",
    orderIndex: 1,
    language: "python3",
    submissionType: "formal",
    status: "done",
    verdict: "AC",
    runtimeMs: 42,
    memoryKb: 8192,
    submittedAt: "2026-05-10T07:45:00.000Z",
    judgedAt: "2026-05-10T07:45:02.000Z",
    score: 50,
    scoreWeight: 50,
    isFinalSubmission: true,
  },
];

// ── Submission Detail ─────────────────────────────────────────────────────────
// Full detail for submission id=2 (the AC one)
export const mockSubmissionDetail: SubmissionDetail = {
  ...mockSubmissions[1]!,
  sourceCode: `def twoSum(nums: list[int], target: int) -> list[int]:
    seen: dict[int, int] = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []`,
  testcaseResults: [
    {
      id: 1,
      testcaseId: 1,
      orderIndex: 1,
      isPublic: true,
      verdict: "AC",
      runtimeMs: 42,
      memoryKb: 8192,
      actualOutput: "[0, 1]",
    },
    {
      id: 2,
      testcaseId: 2,
      orderIndex: 2,
      isPublic: true,
      verdict: "AC",
      runtimeMs: 38,
      memoryKb: 8192,
      actualOutput: "[1, 2]",
    },
    {
      id: 3,
      testcaseId: 3,
      orderIndex: 3,
      isPublic: false,
      verdict: "AC",
      runtimeMs: 45,
      memoryKb: 8320,
    },
  ],
};

// ── Session Result ────────────────────────────────────────────────────────────
// Result snapshot for session id=2 (in_progress, one AC one unattempted)
export const mockSessionResult: SessionResult = {
  id: 2,
  candidate: { id: 1, username: "candidate01", displayName: "Alice Chen" },
  status: "in_progress",
  actualStartAt: T_30MIN_AGO,
  expiresAt: T_IN_1H,
  submittedAt: null,
  totalScore: 50,
  maxScore: 100,
  problems: [
    {
      examSessionProblemId: 101,
      problemId: 1,
      problemTitle: "Two Sum",
      orderIndex: 1,
      scoreWeight: 50,
      score: 50,
      latestStatus: "AC",
      latestSubmissionId: 2,
      finalSubmissionId: 2,
      language: "python3",
      runtimeMs: 42,
      memoryKb: 8192,
      submittedAt: "2026-05-10T07:45:00.000Z",
      judgedAt: "2026-05-10T07:45:02.000Z",
    },
    {
      examSessionProblemId: 102,
      problemId: 2,
      problemTitle: "Valid Parentheses",
      orderIndex: 2,
      scoreWeight: 50,
      score: 0,
      latestStatus: "no_submission",
      latestSubmissionId: null,
      finalSubmissionId: null,
      language: null,
      runtimeMs: null,
      memoryKb: null,
      submittedAt: null,
      judgedAt: null,
    },
  ],
};

// ── Reference: current mock user for token-based lookup ──────────────────────
export const mockTokenUserMap: Record<string, typeof mockUsers.candidate | typeof mockUsers.admin> =
  {
    [mockTokens["candidate01"]]: mockUsers.candidate,
    [mockTokens["admin"]]: mockUsers.admin,
  };
