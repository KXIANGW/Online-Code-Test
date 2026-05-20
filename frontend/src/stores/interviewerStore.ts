import { create } from "zustand";
import type { SessionResult, ExamTemplate, UserSummary } from "../types";

interface InterviewerState {
  results: SessionResult[];
  setResults: (results: SessionResult[]) => void;
  templates: ExamTemplate[];
  setTemplates: (templates: ExamTemplate[]) => void;
  candidates: UserSummary[];
  setCandidates: (candidates: UserSummary[]) => void;
}

export const useInterviewerStore = create<InterviewerState>()((set) => ({
  results: [],
  setResults: (results) => set({ results }),
  templates: [],
  setTemplates: (templates) => set({ templates }),
  candidates: [],
  setCandidates: (candidates) => set({ candidates }),
}));
