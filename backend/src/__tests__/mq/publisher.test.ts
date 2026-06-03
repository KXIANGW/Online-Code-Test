import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MQ client so tests never open a real RabbitMQ connection.
vi.mock("../../mq/client", () => ({
  JUDGE_TASKS_QUEUE: "judge.tasks",
  getChannel: vi.fn(),
}));

import { getChannel } from "../../mq/client";
import { publishJudgeTask } from "../../mq/publisher";

const mockGetChannel = getChannel as ReturnType<typeof vi.fn>;

describe("publishJudgeTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serialises the task and sends it when the channel is not back-pressured", async () => {
    // given: sendToQueue returns true (write buffer has space)
    const channel = { sendToQueue: vi.fn().mockReturnValue(true), once: vi.fn() };
    mockGetChannel.mockResolvedValue(channel);

    // when
    await publishJudgeTask({ submissionId: 1, type: "formal" });

    // expect: payload serialised correctly with persistence flag
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      "judge.tasks",
      Buffer.from(JSON.stringify({ submissionId: 1, type: "formal" })),
      { contentType: "application/json", persistent: true },
    );
    // drain listener not registered when there is no back-pressure
    expect(channel.once).not.toHaveBeenCalled();
  });

  it("waits for the drain event when sendToQueue signals back-pressure (returns false)", async () => {
    // given: channel is back-pressured — sendToQueue returns false
    const drainListeners: Array<() => void> = [];
    const channel = {
      sendToQueue: vi.fn().mockReturnValue(false),
      once: vi.fn((event: string, cb: () => void) => {
        if (event === "drain") drainListeners.push(cb);
      }),
    };
    mockGetChannel.mockResolvedValue(channel);

    // when: start publish; let getChannel() resolve before firing drain
    const promise = publishJudgeTask({ submissionId: 2, type: "simple" });
    await Promise.resolve(); // flush the getChannel microtask so channel.once is registered
    drainListeners[0]?.();
    await promise;

    // expect: message was sent and drain listener was registered
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      "judge.tasks",
      Buffer.from(JSON.stringify({ submissionId: 2, type: "simple" })),
      { contentType: "application/json", persistent: true },
    );
    expect(channel.once).toHaveBeenCalledWith("drain", expect.any(Function));
  });
});
