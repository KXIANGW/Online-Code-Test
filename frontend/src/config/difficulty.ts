import type { Difficulty } from "../types";

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "簡單",
  medium: "中等",
  hard: "困難",
};

/** Badge style: used in pill/chip components (background + text). */
export const DIFFICULTY_BADGE_COLOR: Record<Difficulty, string> = {
  easy: "bg-green-50 text-green-700",
  medium: "bg-amber-50 text-amber-700",
  hard: "bg-red-50 text-red-700",
};

/** Inline text color: used when coloring a label within running text. */
export const DIFFICULTY_TEXT_COLOR: Record<Difficulty, string> = {
  easy: "text-green-600",
  medium: "text-amber-500",
  hard: "text-red-500",
};
