import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJudgeSocket } from "../hooks/useJudgeSocket";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly sent: string[] = [];
  private listeners = new Map<string, Array<(event?: { data?: string }) => void>>();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.emit("close");
  }

  addEventListener(type: string, listener: (event?: { data?: string }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event?: { data?: string }) {
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
    const onMessage = vi.fn();
    const onReconnect = vi.fn();

    renderHook(() => useJudgeSocket(42, onMessage, onReconnect));
    const first = MockWebSocket.instances[0]!;

    act(() => first.emit("open"));
    expect(first.sent).toContain(JSON.stringify({ type: "subscribe", sessionId: 42 }));
    expect(onReconnect).not.toHaveBeenCalled();

    act(() => {
      first.emit("close");
      vi.advanceTimersByTime(1000);
    });
    const second = MockWebSocket.instances[1]!;

    act(() => second.emit("open"));
    expect(second.sent).toContain(JSON.stringify({ type: "subscribe", sessionId: 42 }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
