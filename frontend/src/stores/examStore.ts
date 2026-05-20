import { create } from "zustand";
import type { ExamSession } from "../types";

interface ExamState {
  sessions: ExamSession[];
  setSessions: (sessions: ExamSession[]) => void;
}

export const useExamStore = create<ExamState>()((set) => ({
  sessions: [],
  setSessions: (sessions) => set({ sessions }),
}));
