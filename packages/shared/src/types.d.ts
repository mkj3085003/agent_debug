export interface SessionInfo {
    sessionId: string;
    startedAt: string;
    endedAt?: string;
    status?: "ok" | "error" | "cancelled";
    rootDir: string;
}
export interface RecorderOptions {
    sessionId?: string;
    rootDir: string;
    meta?: {
        cwd?: string;
        host?: string;
        pid?: number;
        agent?: string;
    };
}
export interface StorePaths {
    sessionDir: string;
    eventsPath: string;
    artifactsDir: string;
    diffDir: string;
    logsDir: string;
}
export interface RerunOptions {
    mode: "replay" | "rerun";
    fromStep: number;
    reuseOutputs: boolean;
}
//# sourceMappingURL=types.d.ts.map