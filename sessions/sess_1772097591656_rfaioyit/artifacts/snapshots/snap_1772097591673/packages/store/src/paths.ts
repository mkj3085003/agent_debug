import path from "node:path";
import { StorePaths } from "@agent-debug/shared";

export function getSessionPaths(rootDir: string, sessionId: string): StorePaths {
  const sessionDir = path.join(rootDir, "sessions", sessionId);
  const eventsPath = path.join(sessionDir, "events.jsonl");
  const artifactsDir = path.join(sessionDir, "artifacts");
  const diffDir = path.join(artifactsDir, "diff");
  const snapshotsDir = path.join(artifactsDir, "snapshots");
  const logsDir = path.join(artifactsDir, "logs");
  return { sessionDir, eventsPath, artifactsDir, diffDir, snapshotsDir, logsDir };
}
