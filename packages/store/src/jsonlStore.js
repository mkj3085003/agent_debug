import fs from "node:fs/promises";
import { getSessionPaths } from "./paths.js";
export class JsonlStore {
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    async ensureSession(sessionId) {
        const paths = getSessionPaths(this.rootDir, sessionId);
        await fs.mkdir(paths.diffDir, { recursive: true });
        await fs.mkdir(paths.logsDir, { recursive: true });
    }
    async appendEvent(sessionId, event) {
        const { eventsPath } = getSessionPaths(this.rootDir, sessionId);
        const line = JSON.stringify(event);
        await fs.appendFile(eventsPath, `${line}\n`, "utf8");
    }
    async readEvents(sessionId) {
        const { eventsPath } = getSessionPaths(this.rootDir, sessionId);
        const content = await fs.readFile(eventsPath, "utf8");
        return content
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
}
//# sourceMappingURL=jsonlStore.js.map