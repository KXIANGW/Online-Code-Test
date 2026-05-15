export const PERMISSIONS = {
  EXAM_MANAGE: "exam:manage",
  EXAM_TAKE: "exam:take",
  PROBLEM_MANAGE: "problem:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
