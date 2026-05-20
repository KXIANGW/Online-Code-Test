// 比對 stdout 與 expectedOutput (處理空格、換行)
interface CheckerResult {
  verdict: 'AC' | 'WA';
  diff?: string; // 可選：提供差異資訊方便除錯
}

export function checkOutput(
  actual: string,
  expected: string
): CheckerResult {
  // 1. 標準化處理：處理換行符號並去除末尾空白
  const actualLines = prepareString(actual);
  const expectedLines = prepareString(expected);

  // 2. 比對行數是否一致
  if (actualLines.length !== expectedLines.length) {
    return { verdict: 'WA' };
  }

  // 3. 逐行比對內容
  for (let i = 0; i < actualLines.length; i++) {
    if (actualLines[i] !== expectedLines[i]) {
      return { 
        verdict: 'WA',
        diff: `Line ${i + 1}: expected "${expectedLines[i]}", got "${actualLines[i]}"`
      };
    }
  }

  return { verdict: 'AC' };
}

/**
 * 核心標準化函式
 */
function prepareString(str: string): string[] {
  return str
    .replace(/\r\n/g, '\n')     // 統一將 Windows 的 \r\n 轉為 \n
    .replace(/\r/g, '\n')       // 統一 Mac 舊格式
    .split('\n')                // 切割成陣列
    .map(line => line.trimEnd()) // 去除每一行末尾的空白 (忽略 Presentation Error)
    .filter((line, index, array) => {
      // 僅移除陣列「末尾」的所有空行
      if (line !== '') return true;
      return array.slice(index).some(l => l.trimEnd() !== '');
    });
}