export interface TestInput {
    command: string;
    args?: string[];
}
export interface TestResult {
    status: "pass" | "fail" | "skip";
    output?: string;
}
export declare function runTests(_input: TestInput): Promise<TestResult>;
//# sourceMappingURL=test.d.ts.map