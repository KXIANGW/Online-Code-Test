import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/queries", () => ({
  getSubmissionById: vi.fn(),
  getTestcases: vi.fn(),
  markSubmissionSystemError: vi.fn(),
  updateSubmissionJudging: vi.fn(),
  writeJudgeResults: vi.fn(),
}));

vi.mock("../../engine/checker", () => ({
  checkOutput: vi.fn(),
}));

import {
  getSubmissionById,
  getTestcases,
  markSubmissionSystemError,
  updateSubmissionJudging,
  writeJudgeResults,
} from "../../db/queries";
import { checkOutput } from "../../engine/checker";
import { handleJudgeMessage, startJudgeConsumer } from "../../consumers/judge.consumer";
import type { SandboxEngine } from "../../engine/sandbox-engine";

// Minimal LanguageSpec for python3 used by the mock submission
const mockLanguages = [
  {
    id: "python3",
    image: "oct-sandbox-python:3.11",
    source: { filename: "solution.py" },
    run: { cmd: ["python3", "/code/solution.py"] },
    enabled: true,
  },
];

const submission = {
  id: 123,
  examSessionProblemId: 10,
  examSessionId: 20,
  candidateId: 30,
  problemId: 40,
  language: "python3",
  sourceCode: "print(1)",
  submissionType: "simple",
  timeLimitMs: 1000,
  memoryLimitMb: 128,
  outputLimitKb: 64,
  scoreWeight: 30,
};

// Fresh mock engine for each test so call assertions don't leak.
let engine: SandboxEngine & {
  compile: ReturnType<typeof vi.fn>;
  runOne: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  engine = {
    name: "mock",
    compile: vi.fn().mockResolvedValue({ success: true }),
    runOne: vi.fn().mockResolvedValue({
      verdict: "AC",
      stdout: "1\n",
      stderr: "",
      runtimeMs: 7,
      memoryKb: null,
    }),
  };
  vi.mocked(getSubmissionById).mockResolvedValue(submission as never);
  vi.mocked(getTestcases).mockResolvedValue([
    {
      id: 1,
      orderIndex: 1,
      isPublic: true,
      inputData: "",
      expectedOutput: "1\n",
    },
  ] as never);
  vi.mocked(markSubmissionSystemError).mockResolvedValue(undefined as never);
  vi.mocked(checkOutput).mockReturnValue({ verdict: "AC" });
});

describe("judge consumer", () => {
  it("sets prefetch=1 before consuming tasks", async () => {
    const channel = {
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue(undefined),
    };

    await startJudgeConsumer(channel as never, mockLanguages as never, engine);

    expect(channel.prefetch).toHaveBeenCalledWith(1);
    expect(channel.consume).toHaveBeenCalledWith("judge.tasks", expect.any(Function), { noAck: false });
  });

  it("judges simple submissions with public-only testcases and publishes results", async () => {
    const ack = vi.fn();
    const publish = vi.fn().mockReturnValue(true);

    await handleJudgeMessage(
      { ack, publish },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "simple" })) } as never,
      mockLanguages as never,
      engine
    );

    expect(updateSubmissionJudging).toHaveBeenCalledWith(123);
    expect(getTestcases).toHaveBeenCalledWith(40, true);
    expect(engine.runOne).toHaveBeenCalledWith(expect.objectContaining({ outputLimitKb: 64 }));
    expect(writeJudgeResults).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 123,
        type: "simple",
        verdict: "AC",
        testcaseResults: [
          expect.objectContaining({
            testcaseId: 1,
            verdict: "AC",
            actualOutput: "1\n",
          }),
        ],
      })
    );
    expect(publish).toHaveBeenCalledWith(
      "judge.results",
      "",
      expect.any(Buffer),
      expect.objectContaining({ persistent: true })
    );
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("publishes a judging lifecycle event before the final result", async () => {
    const ack = vi.fn();
    const publish = vi.fn().mockReturnValue(true);

    await handleJudgeMessage(
      { ack, publish },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "simple" })) } as never,
      mockLanguages as never,
      engine
    );

    const lifecyclePayload = JSON.parse(
      Buffer.from(publish.mock.calls[0]![2] as Buffer).toString("utf8")
    );
    expect(lifecyclePayload).toMatchObject({
      submissionId: 123,
      eventType: "status",
      status: "judging",
    });
  });

  it("ACKs invalid task messages without publishing", async () => {
    const ack = vi.fn();
    const publish = vi.fn().mockReturnValue(true);

    await handleJudgeMessage(
      { ack, publish },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "practice" })) } as never,
      mockLanguages as never,
      engine
    );

    expect(getSubmissionById).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("records CE without running testcases when compile fails", async () => {
    engine.compile.mockResolvedValue({ success: false, stderr: "syntax error" });
    const ack = vi.fn();
    const publish = vi.fn().mockReturnValue(true);

    await handleJudgeMessage(
      { ack, publish },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "formal" })) } as never,
      mockLanguages as never,
      engine
    );

    expect(engine.runOne).not.toHaveBeenCalled();
    expect(writeJudgeResults).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 123,
        type: "formal",
        verdict: "CE",
        runtimeMs: 0,
        memoryKb: null,
        testcaseResults: [],
      })
    );
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("marks skipped testcases after first failure", async () => {
    vi.mocked(getTestcases).mockResolvedValue([
      { id: 1, orderIndex: 1, isPublic: true, inputData: "", expectedOutput: "1\n" },
      { id: 2, orderIndex: 2, isPublic: false, inputData: "", expectedOutput: "2\n" },
    ] as never);
    vi.mocked(checkOutput).mockReturnValue({ verdict: "WA" });
    const ack = vi.fn();

    await handleJudgeMessage(
      { ack, publish: vi.fn().mockReturnValue(true) },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "formal" })) } as never,
      mockLanguages as never,
      engine
    );

    expect(getTestcases).toHaveBeenCalledWith(40, false);
    expect(writeJudgeResults).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "formal",
        verdict: "WA",
        testcaseResults: [
          expect.objectContaining({ testcaseId: 1, verdict: "WA" }),
          expect.objectContaining({ testcaseId: 2, verdict: "skipped" }),
        ],
      })
    );
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("uses engine verdict directly for runtime failures and keeps hidden output private", async () => {
    vi.mocked(getTestcases).mockResolvedValue([
      { id: 1, orderIndex: 1, isPublic: false, inputData: "", expectedOutput: "1\n" },
    ] as never);
    engine.runOne.mockResolvedValue({
      verdict: "TLE",
      stdout: "late output\n",
      stderr: "",
      runtimeMs: 1001,
      memoryKb: 256,
    });
    const ack = vi.fn();

    await handleJudgeMessage(
      { ack, publish: vi.fn().mockReturnValue(true) },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "formal" })) } as never,
      mockLanguages as never,
      engine
    );

    expect(checkOutput).not.toHaveBeenCalled();
    expect(writeJudgeResults).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: "TLE",
        runtimeMs: 1001,
        memoryKb: 256,
        testcaseResults: [
          expect.objectContaining({
            testcaseId: 1,
            verdict: "TLE",
            actualOutput: null,
          }),
        ],
      })
    );
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("writes an AC result with zero runtime when a problem has no selected testcases", async () => {
    vi.mocked(getTestcases).mockResolvedValue([] as never);
    const ack = vi.fn();

    await handleJudgeMessage(
      { ack, publish: vi.fn().mockReturnValue(true) },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "simple" })) } as never,
      mockLanguages as never,
      engine
    );

    expect(engine.runOne).not.toHaveBeenCalled();
    expect(writeJudgeResults).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: "AC",
        runtimeMs: 0,
        memoryKb: null,
        testcaseResults: [],
      })
    );
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("waits for drain when result publishing applies backpressure", async () => {
    const ack = vi.fn();
    const publish = vi.fn().mockReturnValue(false);
    const once = vi.fn((_event: "drain", cb: () => void) => {
      queueMicrotask(cb);
    });

    await handleJudgeMessage(
      { ack, publish, once } as never,
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "simple" })) } as never,
      mockLanguages as never,
      engine
    );

    expect(once).toHaveBeenCalledWith("drain", expect.any(Function));
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it("marks system_error and ACKs when judging throws", async () => {
    vi.mocked(getSubmissionById).mockRejectedValue(new Error("db down"));
    const ack = vi.fn();

    await handleJudgeMessage(
      { ack, publish: vi.fn().mockReturnValue(true) },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "simple" })) } as never,
      mockLanguages as never,
      engine
    );

    expect(markSubmissionSystemError).toHaveBeenCalledWith(123);
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
