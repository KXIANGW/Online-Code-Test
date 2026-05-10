// 處理 C++/Java 等需要預編譯的語言
import Docker from 'dockerode';
import fs from 'fs-extra';
import path from 'path';

const docker = new Docker();

interface CompileOptions {
  submissionId: number;
  language: string;
  hostWorkDir: string; // 複用 runner 建立的暫存路徑
}

interface CompileResult {
  success: boolean;
  errorLog?: string; // 存放編譯錯誤 (CE) 的訊息
}

export async function compileInSandbox(options: CompileOptions): Promise<CompileResult> {
  const { submissionId, language, hostWorkDir } = options;

  // 如果是 Python，不需要編譯，直接回傳成功
  if (language === 'python') return { success: true };

  // 根據語言決定編譯指令
  let compileCmd: string[];
  let image: string;

  if (language === 'cpp') {
    image = 'oj-sandbox-cpp';
    // -O2 優化, -lm 連結數學庫, 產出名為 solution 的執行檔
    compileCmd = ['g++', 'solution.cpp', '-O2', '-o', 'solution', '-lm'];
  } else if (language === 'java') {
    image = 'oj-sandbox-java';
    compileCmd = ['javac', 'Main.java'];
  } else {
    return { success: false, errorLog: `Unsupported language: ${language}` };
  }

  const containerConfig = {
    Image: image,
    Cmd: compileCmd,
    HostConfig: {
      Binds: [`${hostWorkDir}:/code`],
      Memory: 512 * 1024 * 1024, // 編譯通常比較耗記憶體，給 512MB
      NetworkMode: 'none',
      AutoRemove: true,
    },
    WorkingDir: '/code',
  };

  try {
    const container = await docker.createContainer(containerConfig);
    await container.start();
    
    // 等待編譯結束
    const waitResult = await container.wait();
    
    if (waitResult.StatusCode !== 0) {
      // 獲取編譯失敗的錯誤訊息 (stderr)
      const logs = await container.logs({ stderr: true });
      // 移除前 8 bytes 的 Docker header
      const errorLog = logs.slice(8).toString('utf8');
      return { success: false, errorLog };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, errorLog: error.message };
  }
}