import { describe, expect, it } from "vitest";
import { classifyVerdict, parseIsolateMeta } from "../../engine/meta-parser";

describe("parseIsolateMeta", () => {
  it("parses a typical OK meta file", () => {
    const meta = parseIsolateMeta(
      [
        "status:OK",
        "exitcode:0",
        "exitsig:0",
        "killed:0",
        "time:0.012",
        "time-wall:0.013",
        "max-rss:1240",
        "cg-mem:1024",
        "cg-oom-killed:0",
      ].join("\n")
    );

    expect(meta.status).toBe("OK");
    expect(meta.exitcode).toBe(0);
    expect(meta.cpuTimeSec).toBeCloseTo(0.012);
    expect(meta.wallTimeSec).toBeCloseTo(0.013);
    expect(meta.maxRssKb).toBe(1240);
    expect(meta.cgMemKb).toBe(1024);
    expect(meta.cgOomKilled).toBe(false);
    expect(meta.killed).toBe(false);
  });

  it("parses TO (timeout)", () => {
    const meta = parseIsolateMeta(["status:TO", "time:1.000", "time-wall:1.000", "killed:1"].join("\n"));
    expect(meta.status).toBe("TO");
    expect(meta.killed).toBe(true);
  });

  it("parses cg-oom-killed=1 as MLE signal", () => {
    const meta = parseIsolateMeta(
      ["status:SG", "exitsig:9", "cg-oom-killed:1", "cg-mem:262144"].join("\n")
    );
    expect(meta.status).toBe("SG");
    expect(meta.exitsig).toBe(9);
    expect(meta.cgOomKilled).toBe(true);
    expect(meta.cgMemKb).toBe(262144);
  });

  it("ignores unknown keys and empty lines", () => {
    const meta = parseIsolateMeta("status:OK\n\nfoo:bar\nexitcode:0\n");
    expect(meta.status).toBe("OK");
    expect(meta.exitcode).toBe(0);
  });

  it("returns null fields when meta file is empty", () => {
    const meta = parseIsolateMeta("");
    expect(meta.status).toBeNull();
    expect(meta.exitcode).toBeNull();
    expect(meta.cgOomKilled).toBe(false);
  });
});

describe("classifyVerdict", () => {
  const baseMeta = parseIsolateMeta("");
  const limits = { timeLimitMs: 1000, memoryLimitMb: 256 };

  it("maps OK + exitcode=0 to AC", () => {
    const meta = { ...baseMeta, status: "OK" as const, exitcode: 0, wallTimeSec: 0.05, cgMemKb: 1024 };
    const r = classifyVerdict({ meta, ...limits });
    expect(r.verdict).toBe("AC");
    expect(r.runtimeMs).toBe(50);
    expect(r.memoryKb).toBe(1024);
  });

  it("maps TO to TLE and reports the time limit as runtime", () => {
    const meta = { ...baseMeta, status: "TO" as const, wallTimeSec: 1.5 };
    const r = classifyVerdict({ meta, ...limits });
    expect(r.verdict).toBe("TLE");
    expect(r.runtimeMs).toBe(1000); // capped to timeLimit
  });

  it("maps cg-oom-killed=1 to MLE", () => {
    const meta = { ...baseMeta, status: "SG" as const, exitsig: 9, cgOomKilled: true, cgMemKb: 262144 };
    const r = classifyVerdict({ meta, ...limits });
    expect(r.verdict).toBe("MLE");
    expect(r.memoryKb).toBe(262144);
  });

  it("maps SG with SIGKILL near memory limit to MLE", () => {
    const meta = {
      ...baseMeta,
      status: "SG" as const,
      exitsig: 9,
      cgMemKb: Math.floor(256 * 1024 * 0.99), // 99% of limit
      wallTimeSec: 0.5,
    };
    const r = classifyVerdict({ meta, ...limits });
    expect(r.verdict).toBe("MLE");
  });

  it("maps SG with non-OOM signal to RE", () => {
    const meta = { ...baseMeta, status: "SG" as const, exitsig: 11, wallTimeSec: 0.1, cgMemKb: 2048 };
    const r = classifyVerdict({ meta, ...limits });
    expect(r.verdict).toBe("RE");
  });

  it("maps RE status to RE", () => {
    const meta = { ...baseMeta, status: "RE" as const, exitcode: 1, wallTimeSec: 0.05 };
    const r = classifyVerdict({ meta, ...limits });
    expect(r.verdict).toBe("RE");
  });

  it("maps non-zero exitcode without explicit status to RE", () => {
    const meta = { ...baseMeta, exitcode: 137, wallTimeSec: 0.1 };
    const r = classifyVerdict({ meta, ...limits });
    expect(r.verdict).toBe("RE");
  });
});
