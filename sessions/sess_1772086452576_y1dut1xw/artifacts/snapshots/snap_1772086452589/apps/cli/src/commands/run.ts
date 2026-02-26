import fs from "node:fs/promises";
import path from "node:path";
import { DiffEngine } from "@agent-debug/diff-engine";
import { Recorder } from "@agent-debug/recorder";
import { writeDiffBlob, writeSnapshotBlob } from "@agent-debug/store";
import { runShell } from "@agent-debug/tool-adapters";

export async function runCommand(
  cmd: string,
  args: string[],
  options: { root: string; cwd?: string }
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const recorder = new Recorder({
    rootDir: options.root,
    meta: { cwd, pid: process.pid, agent: "shell" }
  });
  await recorder.startSession({ command: cmd, args });
  console.log(`Session ${recorder.getSessionId()} started`);

  const diffEngine = new DiffEngine(cwd);
  let snapshot = await captureSnapshot(diffEngine, recorder, options.root, cwd);

  const callId = await recorder.recordToolCall("shell", { command: cmd, args });
  const result = await runShell({ command: cmd, args, cwd });
  await recorder.recordToolResult("shell", callId, result);

  if (snapshot) {
    snapshot = await captureDiff(diffEngine, recorder, options.root, cwd, snapshot);
  }

  await recorder.endSession(result.exitCode === 0 ? "ok" : "error");
  process.exitCode = result.exitCode;
}

async function captureSnapshot(
  diffEngine: DiffEngine,
  recorder: Recorder,
  rootDir: string,
  workspaceDir: string
): Promise<Awaited<ReturnType<DiffEngine["captureSnapshot"]>> | null> {
  try {
    const snapshot = await diffEngine.captureSnapshot();
    const snapshotId = `snap_${Date.now()}`;
    const files = [];
    for (const file of Object.values(snapshot.files)) {
      const absPath = path.join(workspaceDir, file.path);
      const data = await fs.readFile(absPath);
      const blobRef = await writeSnapshotBlob(rootDir, recorder.getSessionId(), snapshotId, file.path, data);
      files.push({ path: file.path, blobRef });
    }
    if (files.length) {
      await recorder.recordSnapshot(files);
    }
    return snapshot;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recorder.recordError(`Snapshot failed: ${message}`);
    return null;
  }
}

async function captureDiff(
  diffEngine: DiffEngine,
  recorder: Recorder,
  rootDir: string,
  workspaceDir: string,
  previous: Awaited<ReturnType<DiffEngine["captureSnapshot"]>>
): Promise<Awaited<ReturnType<DiffEngine["captureSnapshot"]>> | null> {
  try {
    const { snapshot, changes } = await diffEngine.computeDiff(previous);
    const diffId = `diff_${Date.now()}`;
    const files = [];
    for (const change of changes) {
      if (change.status === "deleted") {
        files.push({ path: change.path, status: "deleted" as const });
        continue;
      }
      const absPath = path.join(workspaceDir, change.path);
      const data = await fs.readFile(absPath);
      const blobRef = await writeDiffBlob(rootDir, recorder.getSessionId(), diffId, change.path, data);
      files.push({ path: change.path, status: change.status, blobRef });
    }
    if (files.length) {
      await recorder.recordDiff(files);
    }
    return snapshot;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recorder.recordError(`Diff failed: ${message}`);
    return null;
  }
}
