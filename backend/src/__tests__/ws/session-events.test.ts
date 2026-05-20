import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSubscribersForTests, subscribeToSession } from "../../ws/hub";
import {
  WS_SESSION_EVENTS_CHANNEL,
  configureSessionEventBusForTests,
  handleSessionEventBusMessage,
  publishSessionEvent,
  resetSessionEventBusForTests,
} from "../../ws/session-events";

describe("session event bus", () => {
  const publisher = {
    publish: vi.fn().mockResolvedValue(1),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetSubscribersForTests();
    resetSessionEventBusForTests();
    configureSessionEventBusForTests({ instanceId: "backend-a", publisher });
  });

  it("delivers session events locally before publishing them to Redis", async () => {
    const sent: string[] = [];
    subscribeToSession(42, {
      readyState: 1,
      send: (data) => sent.push(data),
      close: vi.fn(),
      on: vi.fn(),
    });

    const payload = { type: "submission_status", submissionId: 7, sessionId: 42 };
    await publishSessionEvent(42, payload);

    expect(sent).toEqual([JSON.stringify(payload)]);
    expect(publisher.publish).toHaveBeenCalledWith(
      WS_SESSION_EVENTS_CHANNEL,
      JSON.stringify({ origin: "backend-a", sessionId: 42, payload }),
    );
  });

  it("delivers Redis events from another backend pod to local subscribers", () => {
    const sent: string[] = [];
    subscribeToSession(42, {
      readyState: 1,
      send: (data) => sent.push(data),
      close: vi.fn(),
      on: vi.fn(),
    });

    const payload = { type: "judge_result", submissionId: 7, sessionId: 42 };
    handleSessionEventBusMessage(JSON.stringify({ origin: "backend-b", sessionId: 42, payload }));

    expect(sent).toEqual([JSON.stringify(payload)]);
  });

  it("ignores Redis echoes from the same backend pod", () => {
    const sent: string[] = [];
    subscribeToSession(42, {
      readyState: 1,
      send: (data) => sent.push(data),
      close: vi.fn(),
      on: vi.fn(),
    });

    const payload = { type: "judge_result", submissionId: 7, sessionId: 42 };
    handleSessionEventBusMessage(JSON.stringify({ origin: "backend-a", sessionId: 42, payload }));

    expect(sent).toEqual([]);
  });
});
