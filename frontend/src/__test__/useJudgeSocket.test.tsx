import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJudgeSocket } from "../hooks/useJudgeSocket";
import type { JudgeSocketMessage } from "../types";

type MockSocketEvent = { data?: string };
type MockSocketListener = (event?: MockSocketEvent) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly sent: string[] = [];
  readonly closedByClient: boolean[] = [];
  private listeners = new Map<string, MockSocketListener[]>();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closedByClient.push(true);
    this.emit("close");
  }

  addEventListener(type: string, listener: MockSocketListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event?: MockSocketEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("useJudgeSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    sessionStorage.setItem("oct_token", "token");
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reconnects after close and asks the caller to resync", () => {
    // given
    const onMessage = vi.fn();
    const onReconnect = vi.fn();

    // when
    renderHook(() => useJudgeSocket(42, onMessage, onReconnect));
    const first = MockWebSocket.instances[0]!;

    // expect
    act(() => first.emit("open"));
    expect(first.sent).toContain(JSON.stringify({ type: "subscribe", sessionId: 42 }));
    expect(onReconnect).not.toHaveBeenCalled();

    // when
    act(() => {
      first.emit("close");
      vi.advanceTimersByTime(1000);
    });
    const second = MockWebSocket.instances[1]!;

    // expect
    act(() => second.emit("open"));
    expect(second.sent).toContain(JSON.stringify({ type: "subscribe", sessionId: 42 }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("delivers valid judge_result and submission_status messages for the active session", () => {
    // given
    const onMessage = vi.fn<(message: JudgeSocketMessage) => void>();
    const onReconnect = vi.fn();
    renderHook(() => useJudgeSocket(42, onMessage, onReconnect));
    const socket = MockWebSocket.instances[0]!;
    const judgeResult: JudgeSocketMessage = {
      type: "judge_result",
      sessionId: 42,
      submissionId: 7001,
      examSessionProblemId: 901,
      submissionType: "simple",
      status: "completed",
      verdict: "AC",
      runtimeMs: 12,
      memoryKb: 2048,
      judgedAt: "2026-06-02T00:00:00.000Z",
      score: 100,
      testcaseResults: [],
    };
    const submissionStatus: JudgeSocketMessage = {
      type: "submission_status",
      sessionId: 42,
      submissionId: 7002,
      status: "judging",
      judgedAt: null,
    };

    // when
    act(() => {
      socket.emit("message", { data: JSON.stringify(judgeResult) });
      socket.emit("message", { data: JSON.stringify(submissionStatus) });
    });

    // expect
    expect(onMessage).toHaveBeenNthCalledWith(1, judgeResult);
    expect(onMessage).toHaveBeenNthCalledWith(2, submissionStatus);
    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it("ignores malformed, unknown, and cross-session messages without crashing", () => {
    // given
    const onMessage = vi.fn<(message: JudgeSocketMessage) => void>();
    renderHook(() => useJudgeSocket(42, onMessage));
    const socket = MockWebSocket.instances[0]!;
    const crossSessionMessage: JudgeSocketMessage = {
      type: "judge_result",
      sessionId: 43,
      submissionId: 7001,
      examSessionProblemId: 901,
      submissionType: "simple",
      status: "completed",
      verdict: "WA",
      runtimeMs: null,
      memoryKb: null,
      judgedAt: "2026-06-02T00:00:00.000Z",
      score: 0,
      testcaseResults: [],
    };

    // when
    act(() => {
      socket.emit("message", { data: "{not valid json" });
      socket.emit("message", {
        data: JSON.stringify({ type: "heartbeat", sessionId: 42 }),
      });
      socket.emit("message", { data: JSON.stringify(crossSessionMessage) });
    });

    // expect
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("does not create a socket when auth or session preconditions are invalid", () => {
    // given
    const onMessage = vi.fn<(message: JudgeSocketMessage) => void>();

    // when
    sessionStorage.removeItem("oct_token");
    renderHook(() => useJudgeSocket(42, onMessage));

    // expect
    expect(MockWebSocket.instances).toHaveLength(0);

    // when
    sessionStorage.setItem("oct_token", "token");
    renderHook(() => useJudgeSocket(42.5, onMessage));

    // expect
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("closes the active socket and cancels reconnect on unmount", () => {
    // given
    const onMessage = vi.fn<(message: JudgeSocketMessage) => void>();
    const { unmount } = renderHook(() => useJudgeSocket(42, onMessage));
    const socket = MockWebSocket.instances[0]!;

    // when
    unmount();
    act(() => {
      socket.emit("close");
      vi.advanceTimersByTime(1000);
    });

    // expect
    expect(socket.closedByClient).toHaveLength(1);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
