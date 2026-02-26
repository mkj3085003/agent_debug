import { AgentEvent, RerunOptions } from "@agent-debug/shared";
export declare class ReplayEngine {
    private rootDir;
    private store;
    constructor(rootDir: string);
    loadEvents(sessionId: string): Promise<AgentEvent[]>;
    replay(sessionId: string): Promise<AgentEvent[]>;
    rerun(_sessionId: string, _options: RerunOptions): Promise<void>;
}
//# sourceMappingURL=replayEngine.d.ts.map