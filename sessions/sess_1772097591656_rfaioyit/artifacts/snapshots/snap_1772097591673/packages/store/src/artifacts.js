import fs from "node:fs/promises";
import path from "node:path";
import { getSessionPaths } from "./paths.js";
export async function writeDiffArtifact(rootDir, sessionId, step, patch) {
    const { diffDir } = getSessionPaths(rootDir, sessionId);
    const name = `step_${String(step).padStart(5, "0")}.patch`;
    const filePath = path.join(diffDir, name);
    await fs.writeFile(filePath, patch, "utf8");
    return filePath;
}
export async function writeLogArtifact(rootDir, sessionId, step, stream, data) {
    const { logsDir } = getSessionPaths(rootDir, sessionId);
    const name = `step_${String(step).padStart(5, "0")}.${stream}.txt`;
    const filePath = path.join(logsDir, name);
    await fs.writeFile(filePath, data, "utf8");
    return filePath;
}
//# sourceMappingURL=artifacts.js.map