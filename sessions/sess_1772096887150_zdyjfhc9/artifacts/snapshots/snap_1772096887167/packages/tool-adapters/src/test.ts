export interface TestInput {
  command: string;
  args?: string[];
}

export interface TestResult {
  status: "pass" | "fail" | "skip";
  output?: string;
}

export async function runTests(_input: TestInput): Promise<TestResult> {
  throw new Error("runTests adapter not implemented");
}
