import { create } from "zustand";
import type { SessionResult } from "../types";

interface InterviewerState {
  results: SessionResult[];
  setResults: (results: SessionResult[]) => void;
}

export const useInterviewerStore = create<InterviewerState>()((set) => ({
  results: [],
  setResults: (results) => set({ results }),
}));
