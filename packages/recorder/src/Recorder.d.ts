import { RecorderOptions } from "@agent-debug/shared";
export declare class Recorder {
    private options;
    private sessionId;
    private step;
    private meta?;
    private schemaVersion;
    private store;
    constructor(options: RecorderOptions);
    getSessionId(): string;
    startSession(input?: {
        command?: string;
        args?: string[];
        user?: string;
    }): Promise<void>;
    endSession(status: "ok" | "error" | "cancelled"): Promise<void>;
    recordUserInput(text: string): Promise<void>;
    recordModelOutput(text: string): Promise<void>;
    recordToolCall(tool: string, input: Record<string, unknown>, callId?: string): Promise<string>;
    recordToolResult(tool: string, callId: string, output: {
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        durationMs?: number;
        result?: Record<string, unknown>;
    }): Promise<void>;
    recordDiff(files: Array<{
        path: string;
        patch?: string;
        patchRef?: string;
    }>): Promise<void>;
    recordError(message: string, stack?: string): Promise<void>;
    private append;
}
//# sourceMappingURL=Recorder.d.ts.map