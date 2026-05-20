// Parses the key:value text file produced by `isolate --meta=<path>`.
//
// Reference: sio2project/isolate man page §"Meta-file".
// Format example:
//   status:OK
//   exitcode:0
//   exitsig:0
//   killed:0
//   time:0.012
//   time-wall:0.013
//   max-rss:1240
//   csw-voluntary:1
//   csw-forced:0
//   cg-mem:1024
//   cg-oom-killed:0

export type IsolateStatus = "OK" | "RE" | "SG" | "TO" | "XX";

export interface IsolateMeta {
  status: IsolateStatus | null;
  exitcode: number | null;
  exitsig: number | null;
  killed: boolean;
  message: string | null;
  cpuTimeSec: number | null;
  wallTimeSec: number | null;
  maxRssKb: number | null;
  cgMemKb: number | null;
  cgOomKilled: boolean;
}

const EMPTY_META: IsolateMeta = {
  status: null,
  exitcode: null,
  exitsig: null,
  killed: false,
  message: null,
  cpuTimeSec: null,
  wallTimeSec: null,
  maxRssKb: null,
  cgMemKb: null,
  cgOomKilled: false,
};

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBool(value: string | undefined): boolean {
  return value === "1";
}

export function parseIsolateMeta(content: string): IsolateMeta {
  const meta: IsolateMeta = { ...EMPTY_META };
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    switch (key) {
      case "status":
        if (value === "OK" || value === "RE" || value === "SG" || value === "TO" || value === "XX") {
          meta.status = value;
        }
        break;
      case "exitcode":
        meta.exitcode = toNumber(value);
        break;
      case "exitsig":
        meta.exitsig = toNumber(value);
        break;
      case "killed":
        meta.killed = toBool(value);
        break;
      case "message":
        meta.message = value;
        break;
      case "time":
        meta.cpuTimeSec = toNumber(value);
        break;
      case "time-wall":
        meta.wallTimeSec = toNumber(value);
        break;
      case "max-rss":
        meta.maxRssKb = toNumber(value);
        break;
      case "cg-mem":
        meta.cgMemKb = toNumber(value);
        break;
      case "cg-oom-killed":
        meta.cgOomKilled = toBool(value);
        break;
    }
  }
  return meta;
}

export type Verdict = "AC" | "TLE" | "MLE" | "RE";

export interface MetaVerdictInput {
  meta: IsolateMeta;
  // Time limit Worker passed to isolate, in milliseconds. Used as the reported
  // runtime when meta status=TO (Isolate caps cpu time at the limit).
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface MetaVerdictResult {
  verdict: Verdict;
  runtimeMs: number;
  memoryKb: number | null;
}

// Maps an Isolate meta + the user limits into a Worker-friendly verdict.
//
// Priority (matches Docker engine semantics):
//   1. cg-oom-killed → MLE
//   2. status=TO → TLE
//   3. status=SG with SIGKILL (9) and memory near limit → MLE; else RE
//   4. status=RE or any non-zero exitcode → RE
//   5. status=OK → AC
export function classifyVerdict(input: MetaVerdictInput): MetaVerdictResult {
  const { meta, timeLimitMs, memoryLimitMb } = input;
  const wallMs = meta.wallTimeSec !== null ? Math.round(meta.wallTimeSec * 1000) : timeLimitMs;
  const memoryKb = meta.cgMemKb ?? meta.maxRssKb;

  if (meta.cgOomKilled) {
    return { verdict: "MLE", runtimeMs: wallMs, memoryKb: memoryKb ?? memoryLimitMb * 1024 };
  }

  if (meta.status === "TO") {
    return { verdict: "TLE", runtimeMs: timeLimitMs, memoryKb };
  }

  if (meta.status === "SG") {
    // SIGKILL near memory limit → treat as MLE; any other signal → RE
    if (meta.exitsig === 9 && memoryKb !== null && memoryKb >= memoryLimitMb * 1024 * 0.95) {
      return { verdict: "MLE", runtimeMs: wallMs, memoryKb };
    }
    return { verdict: "RE", runtimeMs: wallMs, memoryKb };
  }

  if (meta.status === "RE" || (meta.exitcode !== null && meta.exitcode !== 0)) {
    return { verdict: "RE", runtimeMs: wallMs, memoryKb };
  }

  return { verdict: "AC", runtimeMs: wallMs, memoryKb };
}
