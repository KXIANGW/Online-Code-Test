import { beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  toast: toastMock,
}));

import { useExamStore } from "../stores/examStore";
import { useInterviewerStore } from "../stores/interviewerStore";
import { copyToClipboard } from "../utils/clipboard";

describe("examStore", () => {
  beforeEach(() => {
    useExamStore.setState({ sessions: [] });
  });

  it("stores the latest exam sessions", () => {
    const sessions = [{ id: 1, status: "not_started" }];

    useExamStore.getState().setSessions(sessions as never);

    expect(useExamStore.getState().sessions).toEqual(sessions);
  });
});

describe("interviewerStore", () => {
  beforeEach(() => {
    useInterviewerStore.setState({ results: [], templates: [], candidates: [] });
  });

  it("stores dashboard result, template, and candidate collections independently", () => {
    const results = [{ sessionId: 1 }];
    const templates = [{ id: 2, title: "Template" }];
    const candidates = [{ id: 3, username: "candidate" }];

    useInterviewerStore.getState().setResults(results as never);
    useInterviewerStore.getState().setTemplates(templates as never);
    useInterviewerStore.getState().setCandidates(candidates as never);

    expect(useInterviewerStore.getState().results).toEqual(results);
    expect(useInterviewerStore.getState().templates).toEqual(templates);
    expect(useInterviewerStore.getState().candidates).toEqual(candidates);
  });
});

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes text to the clipboard and shows success feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copyToClipboard("secret");

    expect(writeText).toHaveBeenCalledWith("secret");
    expect(toastMock.success).toHaveBeenCalledWith("已複製到剪貼簿！");
  });

  it("shows failure feedback when clipboard write fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("denied");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(error) },
    });

    await copyToClipboard("secret");

    expect(consoleSpy).toHaveBeenCalledWith("複製失敗:", error);
    expect(toastMock.error).toHaveBeenCalledWith("複製失敗");
    consoleSpy.mockRestore();
  });
});
