import fs from "node:fs/promises";
import { AgentEvent } from "@agent-debug/shared";
import { getSessionPaths } from "./paths.js";

export class JsonlStore {
  constructor(private rootDir: string) {}

  async ensureSession(sessionId: string): Promise<void> {
    const paths = getSessionPaths(this.rootDir, sessionId);
    await fs.mkdir(paths.diffDir, { recursive: true });
    await fs.mkdir(paths.snapshotsDir, { recursive: true });
    await fs.mkdir(paths.logsDir, { recursive: true });
  }

  async appendEvent(sessionId: string, event: AgentEvent): Promise<void> {
    const { eventsPath } = getSessionPaths(this.rootDir, sessionId);
    const line = JSON.stringify(event);
    await fs.appendFile(eventsPath, `${line}\n`, "utf8");
  }

  async readEvents(sessionId: string): Promise<AgentEvent[]> {
    const { eventsPath } = getSessionPaths(this.rootDir, sessionId);
    const content = await fs.readFile(eventsPath, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentEvent);
  }
}
