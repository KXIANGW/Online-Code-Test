import Docker from 'dockerode';
import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';

const docker = new Docker(); // 預設會連線到 /var/run/docker.sock

interface RunOptions {
  submissionId: number;
  language: string;
  sourceCode: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}

interface RunResult {
  verdict: 'AC' | 'TLE' | 'RE' | 'MLE';
  stdout: string;
  stderr: string;
  runtimeMs: number;
}

export async function runInSandbox(options: RunOptions): Promise<RunResult> {
  const { submissionId, language, sourceCode, timeLimitMs, memoryLimitMb, expectedOutput } = options;
  
  // 1. 準備環境
  const hostWorkDir = path.join(process.cwd(), 'temp', `submission_${submissionId}`);
  await fs.ensureDir(hostWorkDir);
  const fileName = language === 'cpp' ? 'solution.cpp' : 'solution.py';
  await fs.writeFile(path.join(hostWorkDir, fileName), sourceCode);

  try {
    // 2. 編譯階段 (如果是 C++ 等編譯語言)
    const compileResult = await compileInSandbox({ submissionId, language, hostWorkDir });
    if (!compileResult.success) {
      return { verdict: 'CE', stdout: '', stderr: compileResult.errorLog || '', runtimeMs: 0 };
    }

    // 3. 執行階段設定
    const runCmd = language === 'cpp' ? ['./solution'] : ['python3', fileName];
    const container = await docker.createContainer({
      Image: `oj-sandbox-${language}`,
      Cmd: runCmd,
      HostConfig: {
        Binds: [`${hostWorkDir}:/code`],
        Memory: memoryLimitMb * 1024 * 1024,
        NetworkMode: 'none',
        AutoRemove: true,
      },
      WorkingDir: '/code',
    });

    await container.start();
    const startTime = Date.now();

    // 4. 設定 TLE 監控與執行競賽
    const timeoutPromise = new Promise<RunResult>((_, reject) => {
      setTimeout(async () => {
        try { await container.stop(); } catch (e) { /* 容器可能已結束 */ }
        reject(new Error('TLE'));
      }, timeLimitMs);
    });

    const runPromise = (async (): Promise<RunResult> => {
      const waitResult = await container.wait();
      const endTime = Date.now();
      const logs = await container.logs({ stdout: true, stderr: true });
      const { stdout, stderr } = parseDockerLogs(logs);

      return {
        verdict: waitResult.StatusCode === 0 ? 'AC' : 'RE',
        stdout,
        stderr,
        runtimeMs: endTime - startTime,
      };
    })();

    // --- 這裡就是你問的部分：處理 race 結果 ---
    const runResult = await Promise.race([runPromise, timeoutPromise]);

    // 5. 判定階段：如果程式順利跑完 (AC)，則進入 Checker 比對答案
    if (runResult.verdict === 'AC') {
      const checkResult = checkOutput(runResult.stdout, expectedOutput);
      return {
        ...runResult,
        verdict: checkResult.verdict, // 這裡會把 AC 改成真正的 AC 或 WA
      };
    }

    return runResult; // 返回 TLE, RE 等結果

  } catch (error: any) {
    if (error.message === 'TLE') {
      return { verdict: 'TLE', stdout: '', stderr: '', runtimeMs: timeLimitMs };
    }
    return { verdict: 'RE', stdout: '', stderr: error.message, runtimeMs: 0 };
  } finally {
    // 6. 最後清理資源 (無論成功失敗都會執行)
    await fs.remove(hostWorkDir).catch(console.error);
  }
}
/**
 * 輔助函式：處理 Docker Stream Logs 的 Header 
 */
function parseDockerLogs(buffer: Buffer) {
  let stdout = '';
  let stderr = '';
  let offset = 0;
  while (offset < buffer.length) {
    const type = buffer.readUInt8(offset);
    const size = buffer.readUInt32BE(offset + 4);
    const content = buffer.toString('utf8', offset + 8, offset + 8 + size);
    if (type === 1) stdout += content;
    else if (type === 2) stderr += content;
    offset += 8 + size;
  }
  return { stdout, stderr };
}