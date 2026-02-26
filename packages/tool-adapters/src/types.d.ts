export interface ToolResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
}
export interface ToolAdapter<Input, Output> {
    name: string;
    execute(input: Input): Promise<Output>;
}
//# sourceMappingURL=types.d.ts.map