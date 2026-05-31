import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  client: {
    query: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock("../../db/client", () => ({
  pool: {
    query: mocks.query,
    connect: mocks.connect,
  },
}));

import {
  getSubmissionById,
  getTestcases,
  markSubmissionSystemError,
  updateSubmissionJudging,
  writeJudgeResults,
} from "../../db/queries";

describe("worker db queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(mocks.client);
    mocks.client.query.mockResolvedValue({ rows: [] });
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it("maps a submission row into the judge DTO", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "123",
          exam_session_problem_id: "10",
          exam_session_id: "20",
          candidate_id: "30",
          problem_id: "40",
          language: "python3",
          source_code: "print(1)",
          submission_type: "simple",
          time_limit_ms: 1500,
          memory_limit_mb: 256,
          output_limit_kb: 64,
          score_weight: 25,
        },
      ],
    });

    await expect(getSubmissionById(123)).resolves.toEqual({
      id: 123,
      examSessionProblemId: 10,
      examSessionId: 20,
      candidateId: 30,
      problemId: 40,
      language: "python3",
      sourceCode: "print(1)",
      submissionType: "simple",
      timeLimitMs: 1500,
      memoryLimitMb: 256,
      outputLimitKb: 64,
      scoreWeight: 25,
    });
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([123]);
  });

  it("returns null when a submission does not exist", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await expect(getSubmissionById(999)).resolves.toBeNull();
  });

  it("rejects unsupported submission languages before judging", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "123",
          exam_session_problem_id: "10",
          exam_session_id: "20",
          candidate_id: "30",
          problem_id: "40",
          language: "ruby",
          source_code: "puts 1",
          submission_type: "simple",
          time_limit_ms: 1500,
          memory_limit_mb: 256,
          output_limit_kb: 64,
          score_weight: 25,
        },
      ],
    });

    await expect(getSubmissionById(123)).rejects.toThrow("Unsupported language: ruby");
  });

  it("maps testcase rows in judge order", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "7",
          order_index: 2,
          is_public: false,
          input_data: "in",
          expected_output: "out",
        },
      ],
    });

    await expect(getTestcases(40, true)).resolves.toEqual([
      {
        id: 7,
        orderIndex: 2,
        isPublic: false,
        inputData: "in",
        expectedOutput: "out",
      },
    ]);
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([40, true]);
  });

  it("updates a submission to judging", async () => {
    await updateSubmissionJudging(123);

    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'judging'"), [
      123,
    ]);
  });

  it("marks a submission as system_error", async () => {
    await markSubmissionSystemError(123);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'system_error'"),
      [123]
    );
  });

  it("writes simple judge results without updating final score", async () => {
    await writeJudgeResults({
      submissionId: 123,
      examSessionProblemId: 10,
      examSessionId: 20,
      type: "simple",
      verdict: "WA",
      runtimeMs: 12,
      memoryKb: 256,
      testcaseResults: [
        {
          testcaseId: 1,
          verdict: "WA",
          runtimeMs: 12,
          memoryKb: 256,
          actualOutput: "wrong",
        },
      ],
    });

    expect(mocks.client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.client.query).toHaveBeenCalledWith(
      "DELETE FROM submission_testcase_results WHERE submission_id = $1",
      [123]
    );
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO submission_testcase_results"),
      [123, 1, "WA", 12, 256, "wrong"]
    );
    expect(mocks.client.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE submissions"), [
      123,
      "WA",
      12,
      256,
    ]);
    expect(mocks.client.query).toHaveBeenLastCalledWith("COMMIT");
    expect(mocks.client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE exam_session_problems"),
      expect.anything()
    );
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });

  it("writes formal judge results and recalculates exam total score", async () => {
    await writeJudgeResults({
      submissionId: 123,
      examSessionProblemId: 10,
      examSessionId: 20,
      type: "formal",
      verdict: "AC",
      runtimeMs: 12,
      memoryKb: null,
      testcaseResults: [],
    });

    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE exam_session_problems"),
      [10, 123, "AC"]
    );
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE exam_sessions"),
      [20]
    );
    expect(mocks.client.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("rolls back and releases the connection when result writing fails", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("delete failed"))
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      writeJudgeResults({
        submissionId: 123,
        examSessionProblemId: 10,
        examSessionId: 20,
        type: "formal",
        verdict: "RE",
        runtimeMs: null,
        memoryKb: null,
        testcaseResults: [],
      })
    ).rejects.toThrow("delete failed");

    expect(mocks.client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.client.release).toHaveBeenCalledTimes(1);
  });
});
