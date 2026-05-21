import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { toast } from "react-hot-toast";
import * as apiClient from "../api/client";
import { useAntiCheat } from "../hooks/useAntiCheat";

vi.mock("react-hot-toast", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("../api/client", () => ({
  reportViolation: vi.fn().mockResolvedValue(undefined),
}));

const mockReportViolation = vi.mocked(apiClient.reportViolation);
const mockToastError = vi.mocked(toast.error);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset visibility state
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAntiCheat — fullscreen_exit", () => {
  it("reports fullscreen_exit and shows toast when fullscreenElement becomes null", async () => {
    // given: hook enabled
    renderHook(() => useAntiCheat({ sessionId: 42, enabled: true }));

    // when: fullscreen is exited (element is null)
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    // expect
    expect(mockReportViolation).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ type: "fullscreen_exit" }),
    );
    expect(mockToastError).toHaveBeenCalled();
  });

  it("does NOT report when enabled is false", async () => {
    // given
    renderHook(() => useAntiCheat({ sessionId: 1, enabled: false }));

    // when
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    // expect
    expect(mockReportViolation).not.toHaveBeenCalled();
  });
});

describe("useAntiCheat — tab_switch", () => {
  it("reports tab_switch when tab becomes hidden", async () => {
    // given
    renderHook(() => useAntiCheat({ sessionId: 7, enabled: true }));

    // when: tab hidden
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // expect: violation reported immediately on hide
    expect(mockReportViolation).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: "tab_switch" }),
    );
  });

  it("shows toast when tab becomes visible again after a switch", async () => {
    // given: hook mounted
    renderHook(() => useAntiCheat({ sessionId: 7, enabled: true }));

    // tab hidden (triggers report + sets hadTabSwitchedRef)
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // when: tab visible again
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // expect: toast shown on return
    expect(mockToastError).toHaveBeenCalled();
  });

  it("does NOT report when enabled is false", async () => {
    // given
    renderHook(() => useAntiCheat({ sessionId: 1, enabled: false }));

    // when
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // expect
    expect(mockReportViolation).not.toHaveBeenCalled();
  });
});

describe("useAntiCheat — window_blur", () => {
  it("reports window_blur when window loses focus while tab is visible", async () => {
    // given
    renderHook(() => useAntiCheat({ sessionId: 3, enabled: true }));

    // when: window blur (tab is still visible)
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    // expect
    expect(mockReportViolation).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ type: "window_blur" }),
    );
    expect(mockToastError).toHaveBeenCalled();
  });

  it("does NOT report window_blur when tab is hidden (already counted as tab_switch)", async () => {
    // given
    renderHook(() => useAntiCheat({ sessionId: 3, enabled: true }));

    // tab is hidden
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    // when: blur fires while tab is hidden
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    // expect: no window_blur report (visibilityState is not 'visible')
    expect(mockReportViolation).not.toHaveBeenCalledWith(
      3,
      expect.objectContaining({ type: "window_blur" }),
    );
  });

  it("debounces — second blur within 2 seconds is ignored", async () => {
    // given: fake timers to control Date.now()
    vi.useFakeTimers();
    renderHook(() => useAntiCheat({ sessionId: 5, enabled: true }));

    // when: two rapid blurs
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500); // only 500ms later — within debounce window
      window.dispatchEvent(new Event("blur"));
    });

    // expect: only one report
    expect(mockReportViolation).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("useAntiCheat — paste (handleEditorPaste)", () => {
  it("reports paste with length detail and shows toast", async () => {
    // given
    const { result } = renderHook(() => useAntiCheat({ sessionId: 9, enabled: true }));

    // when
    await act(async () => {
      result.current.handleEditorPaste("some pasted code");
    });

    // expect
    expect(mockReportViolation).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ type: "paste", detail: "length:16" }),
    );
    expect(mockToastError).toHaveBeenCalled();
  });

  it("does NOT report paste when disabled", async () => {
    // given
    const { result } = renderHook(() => useAntiCheat({ sessionId: 9, enabled: false }));

    // when
    await act(async () => {
      result.current.handleEditorPaste("some pasted code");
    });

    // expect
    expect(mockReportViolation).not.toHaveBeenCalled();
  });
});

describe("useAntiCheat — copy", () => {
  it("silently reports copy when selection is non-empty", async () => {
    // given
    renderHook(() => useAntiCheat({ sessionId: 11, enabled: true }));

    // mock window.getSelection to return a non-empty selection
    const mockGetSelection = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "problem statement text",
    } as Selection);

    // when
    await act(async () => {
      document.dispatchEvent(new Event("copy"));
    });

    // expect: reported without toast
    expect(mockReportViolation).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ type: "copy", detail: "length:22" }),
    );
    expect(mockToastError).not.toHaveBeenCalled();
    mockGetSelection.mockRestore();
  });

  it("does NOT report copy when selection is empty", async () => {
    // given
    renderHook(() => useAntiCheat({ sessionId: 11, enabled: true }));
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "",
    } as Selection);

    // when
    await act(async () => {
      document.dispatchEvent(new Event("copy"));
    });

    // expect
    expect(mockReportViolation).not.toHaveBeenCalled();
  });
});

describe("useAntiCheat — cleanup", () => {
  it("removes all event listeners on unmount", async () => {
    // given
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() => useAntiCheat({ sessionId: 1, enabled: true }));
    const added = addSpy.mock.calls.map((c) => c[0]);

    // when
    unmount();

    // expect: every added listener was also removed
    const removed = removeSpy.mock.calls.map((c) => c[0]);
    for (const event of added) {
      expect(removed).toContain(event);
    }

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
