import { JsonlStore } from "@agent-debug/store";
export class ReplayEngine {
    rootDir;
    store;
    constructor(rootDir) {
        this.rootDir = rootDir;
        this.store = new JsonlStore(rootDir);
    }
    async loadEvents(sessionId) {
        return this.store.readEvents(sessionId);
    }
    async replay(sessionId) {
        return this.loadEvents(sessionId);
    }
    async rerun(_sessionId, _options) {
        throw new Error("rerun not implemented");
    }
}
//# sourceMappingURL=replayEngine.js.map