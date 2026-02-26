import path from "node:path";
export function getSessionPaths(rootDir, sessionId) {
    const sessionDir = path.join(rootDir, "sessions", sessionId);
    const eventsPath = path.join(sessionDir, "events.jsonl");
    const artifactsDir = path.join(sessionDir, "artifacts");
    const diffDir = path.join(artifactsDir, "diff");
    const logsDir = path.join(artifactsDir, "logs");
    return { sessionDir, eventsPath, artifactsDir, diffDir, logsDir };
}
//# sourceMappingURL=paths.js.map