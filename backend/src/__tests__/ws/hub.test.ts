import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  countActiveSubscribers,
  subscribeToSession,
  unsubscribeClient,
  publishToSession,
  resetSubscribersForTests,
} from "../../ws/hub";

function makeClient(overrides: Partial<{ readyState: number }> = {}) {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
}

describe("ws/hub", () => {
  beforeEach(() => {
    resetSubscribersForTests();
  });

  // ── countActiveSubscribers ────────────────────────────────────────────────

  describe("countActiveSubscribers", () => {
    it("returns 0 when there are no subscribers", () => {
      // given / when / expect
      expect(countActiveSubscribers()).toBe(0);
    });

    it("counts all clients across multiple sessions", () => {
      // given
      subscribeToSession(1, makeClient());
      subscribeToSession(1, makeClient());
      subscribeToSession(2, makeClient());

      // when / expect
      expect(countActiveSubscribers()).toBe(3);
    });
  });

  // ── unsubscribeClient ─────────────────────────────────────────────────────

  describe("unsubscribeClient", () => {
    it("deletes the session entry when the last client for that session unsubscribes", () => {
      // given
      const client = makeClient();
      subscribeToSession(42, client);
      expect(countActiveSubscribers()).toBe(1);

      // when
      unsubscribeClient(client);

      // expect: session entry removed — total drops to 0
      expect(countActiveSubscribers()).toBe(0);
    });

    it("leaves remaining clients intact when only one of several is removed", () => {
      // given
      const clientA = makeClient();
      const clientB = makeClient();
      subscribeToSession(42, clientA);
      subscribeToSession(42, clientB);

      // when
      unsubscribeClient(clientA);

      // expect: clientB still subscribed
      expect(countActiveSubscribers()).toBe(1);
    });
  });

  // ── publishToSession ──────────────────────────────────────────────────────

  describe("publishToSession", () => {
    it("returns 0 and does not send when no clients are subscribed to the session", () => {
      // given / when
      const sent = publishToSession(99, { type: "test" });

      // expect
      expect(sent).toBe(0);
    });

    it("sends serialised JSON to every OPEN client and returns send count", () => {
      // given
      const clientA = makeClient();
      const clientB = makeClient();
      subscribeToSession(42, clientA);
      subscribeToSession(42, clientB);
      const payload = { type: "judge_result", sessionId: 42 };

      // when
      const sent = publishToSession(42, payload);

      // expect
      expect(sent).toBe(2);
      expect(clientA.send).toHaveBeenCalledWith(JSON.stringify(payload));
      expect(clientB.send).toHaveBeenCalledWith(JSON.stringify(payload));
    });

    it("removes stale clients (readyState !== OPEN) and does not send to them", () => {
      // given: one stale (readyState = 3 = CLOSING) and one open client
      const stale = makeClient({ readyState: 3 });
      const open = makeClient({ readyState: 1 });
      subscribeToSession(42, stale);
      subscribeToSession(42, open);

      // when
      const sent = publishToSession(42, { type: "ping" });

      // expect: stale skipped and removed; only open client received message
      expect(sent).toBe(1);
      expect(stale.send).not.toHaveBeenCalled();
      expect(open.send).toHaveBeenCalled();
      // stale client pruned — only 1 subscriber remains
      expect(countActiveSubscribers()).toBe(1);
    });

    it("cleans up the session entry when all clients are stale", () => {
      // given
      const stale = makeClient({ readyState: 2 });
      subscribeToSession(42, stale);

      // when
      publishToSession(42, { type: "ping" });

      // expect: session entry deleted entirely
      expect(countActiveSubscribers()).toBe(0);
    });
  });
});
