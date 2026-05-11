import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/queries", () => ({
  getSubmissionById: vi.fn(),
  getTestcases: vi.fn(),
  markSubmissionSystemError: vi.fn(),
  updateSubmissionJudging: vi.fn(),
  writeJudgeResults: vi.fn(),
}));

vi.mock("../engine/compiler", () => ({
  compileInSandbox: vi.fn(),
}));

vi.mock("../engine/runner", () => ({
  runOneTestcase: vi.fn(),
}));

vi.mock("../engine/checker", () => ({
  checkOutput: vi.fn(),
}));

import {
  getSubmissionById,
  getTestcases,
  markSubmissionSystemError,
  updateSubmissionJudging,
  writeJudgeResults,
} from "../db/queries";
import { compileInSandbox } from "../engine/compiler";
import { runOneTestcase } from "../engine/runner";
import { checkOutput } from "../engine/checker";
import { handleJudgeMessage, startJudgeConsumer } from "./judge.consumer";

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
  scoreWeight: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
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
  vi.mocked(compileInSandbox).mockResolvedValue({ success: true });
  vi.mocked(markSubmissionSystemError).mockResolvedValue(undefined as never);
  vi.mocked(runOneTestcase).mockResolvedValue({
    verdict: "AC",
    stdout: "1\n",
    stderr: "",
    runtimeMs: 7,
    memoryKb: null,
  });
  vi.mocked(checkOutput).mockReturnValue({ verdict: "AC" });
});

describe("judge consumer", () => {
  it("sets prefetch=1 before consuming tasks", async () => {
    const channel = {
      prefetch: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue(undefined),
    };

    await startJudgeConsumer(channel as never);

    expect(channel.prefetch).toHaveBeenCalledWith(1);
    expect(channel.consume).toHaveBeenCalledWith("judge.tasks", expect.any(Function), { noAck: false });
  });

  it("judges simple submissions with public-only testcases and publishes results", async () => {
    const ack = vi.fn();
    const publish = vi.fn().mockReturnValue(true);

    await handleJudgeMessage(
      { ack, publish },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "simple" })) } as never
    );

    expect(updateSubmissionJudging).toHaveBeenCalledWith(123);
    expect(getTestcases).toHaveBeenCalledWith(40, true);
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

  it("marks skipped testcases after first failure", async () => {
    vi.mocked(getTestcases).mockResolvedValue([
      { id: 1, orderIndex: 1, isPublic: true, inputData: "", expectedOutput: "1\n" },
      { id: 2, orderIndex: 2, isPublic: false, inputData: "", expectedOutput: "2\n" },
    ] as never);
    vi.mocked(checkOutput).mockReturnValue({ verdict: "WA" });
    const ack = vi.fn();

    await handleJudgeMessage(
      { ack, publish: vi.fn().mockReturnValue(true) },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "formal" })) } as never
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

  it("marks system_error and ACKs when judging throws", async () => {
    vi.mocked(getSubmissionById).mockRejectedValue(new Error("db down"));
    const ack = vi.fn();

    await handleJudgeMessage(
      { ack, publish: vi.fn().mockReturnValue(true) },
      { content: Buffer.from(JSON.stringify({ submissionId: 123, type: "simple" })) } as never
    );

    expect(markSubmissionSystemError).toHaveBeenCalledWith(123);
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
