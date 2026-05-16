import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTimeLeft, useExamTimer } from "../hooks/useExamTimer";

describe("useExamTimer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats non-positive and positive durations as HH:MM:SS", () => {
    expect(formatTimeLeft(0)).toBe("00:00:00");
    expect(formatTimeLeft(-5)).toBe("00:00:00");
    expect(formatTimeLeft(3661)).toBe("01:01:01");
  });

  it("counts down from expiresAt and clamps at zero", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T00:00:00.000Z"));

    const { result } = renderHook(() =>
      useExamTimer("2026-05-16T00:00:03.000Z"),
    );

    expect(result.current).toBe(3);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(0);
  });

  it("returns null when there is no expiry", () => {
    const { result } = renderHook(() => useExamTimer(null));

    expect(result.current).toBeNull();
  });
});
