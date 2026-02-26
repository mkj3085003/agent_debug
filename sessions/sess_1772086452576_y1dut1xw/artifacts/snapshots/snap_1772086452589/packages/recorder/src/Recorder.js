import { makeCallId, makeSessionId, nowIso } from "@agent-debug/shared";
import { JsonlStore } from "@agent-debug/store";
export class Recorder {
    options;
    sessionId;
    step = 0;
    meta;
    schemaVersion = "1.0.0";
    store;
    constructor(options) {
        this.options = options;
        this.sessionId = options.sessionId ?? makeSessionId();
        this.meta = options.meta;
        this.store = new JsonlStore(options.rootDir);
    }
    getSessionId() {
        return this.sessionId;
    }
    async startSession(input = {}) {
        await this.store.ensureSession(this.sessionId);
        await this.append({
            type: "session.start",
            input
        });
    }
    async endSession(status) {
        await this.append({
            type: "session.end",
            status
        });
    }
    async recordUserInput(text) {
        await this.append({ type: "user.input", text });
    }
    async recordModelOutput(text) {
        await this.append({ type: "model.output", text });
    }
    async recordToolCall(tool, input, callId = makeCallId()) {
        await this.append({ type: "tool.call", tool, callId, input });
        return callId;
    }
    async recordToolResult(tool, callId, output) {
        await this.append({ type: "tool.result", tool, callId, output });
    }
    async recordDiff(files) {
        await this.append({ type: "fs.diff", files });
    }
    async recordError(message, stack) {
        await this.append({ type: "error", message, stack });
    }
    async append(event) {
        const fullEvent = {
            schemaVersion: this.schemaVersion,
            sessionId: this.sessionId,
            step: this.step++,
            ts: nowIso(),
            meta: this.meta,
            ...event
        };
        await this.store.appendEvent(this.sessionId, fullEvent);
    }
}
//# sourceMappingURL=Recorder.js.map