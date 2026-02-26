import { AgentEvent } from "@agent-debug/shared";
export declare class JsonlStore {
    private rootDir;
    constructor(rootDir: string);
    ensureSession(sessionId: string): Promise<void>;
    appendEvent(sessionId: string, event: AgentEvent): Promise<void>;
    readEvents(sessionId: string): Promise<AgentEvent[]>;
}
//# sourceMappingURL=jsonlStore.d.ts.map