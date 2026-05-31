export const PYTHON_AC = "print(sum(map(int, input().split())))\n";
export const PYTHON_WA = "print('wrong')\n";
export const PYTHON_TLE = "while True:\n    pass\n";
export const PYTHON_RE = "raise RuntimeError('boom')\n";
export const PYTHON_CE = "def foo(\n  # syntax error missing paren\n";
export const CPP_AC = [
  "#include <iostream>",
  "int main() {",
  "  long long a, b;",
  "  std::cin >> a >> b;",
  "  std::cout << (a + b) << '\\n';",
  "  return 0;",
  "}",
  "",
].join("\n");
export const CPP_CE = "int main(\n";

export const SUM_PROBLEM = {
  title: "E2E Sum Two Numbers",
  descriptionMd: "Print the sum of two integers.",
  difficulty: "easy" as const,
  timeLimitMs: 4000,
  memoryLimitMb: 128,
  outputLimitKb: 64,
  testcases: [
    { orderIndex: 1, isPublic: true, inputData: "1 2\n", expectedOutput: "3" },
    {
      orderIndex: 2,
      isPublic: false,
      inputData: "40 2\n",
      expectedOutput: "42",
    },
  ],
};

export const TLE_PROBLEM = {
  ...SUM_PROBLEM,
  title: "E2E TLE Probe",
  timeLimitMs: 300,
};
