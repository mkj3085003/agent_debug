import { ToolResult } from "./types.js";
export interface ShellInput {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
}
export declare function runShell(input: ShellInput): Promise<ToolResult>;
//# sourceMappingURL=shell.d.ts.map