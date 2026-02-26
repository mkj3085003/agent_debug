import fs from "node:fs/promises";
import path from "node:path";
import { getSessionPaths } from "./paths.js";

function sanitizeRelativePath(relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  return normalized.replace(/^[/\\]+/, "");
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export async function writeDiffArtifact(
  rootDir: string,
  sessionId: string,
  step: number,
  patch: string
): Promise<string> {
  const { diffDir } = getSessionPaths(rootDir, sessionId);
  const name = `step_${String(step).padStart(5, "0")}.patch`;
  const filePath = path.join(diffDir, name);
  await fs.writeFile(filePath, patch, "utf8");
  return filePath;
}

export async function writeLogArtifact(
  rootDir: string,
  sessionId: string,
  step: number,
  stream: "stdout" | "stderr",
  data: string
): Promise<string> {
  const { logsDir } = getSessionPaths(rootDir, sessionId);
  const name = `step_${String(step).padStart(5, "0")}.${stream}.txt`;
  const filePath = path.join(logsDir, name);
  await fs.writeFile(filePath, data, "utf8");
  return filePath;
}

export async function writeSnapshotBlob(
  rootDir: string,
  sessionId: string,
  snapshotId: string,
  relativePath: string,
  data: Buffer
): Promise<string> {
  const { snapshotsDir, artifactsDir } = getSessionPaths(rootDir, sessionId);
  const safePath = sanitizeRelativePath(relativePath);
  const filePath = path.join(snapshotsDir, snapshotId, safePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
  return toPosixPath(path.relative(artifactsDir, filePath));
}

export async function writeDiffBlob(
  rootDir: string,
  sessionId: string,
  diffId: string,
  relativePath: string,
  data: Buffer
): Promise<string> {
  const { diffDir, artifactsDir } = getSessionPaths(rootDir, sessionId);
  const safePath = sanitizeRelativePath(relativePath);
  const filePath = path.join(diffDir, diffId, safePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
  return toPosixPath(path.relative(artifactsDir, filePath));
}
