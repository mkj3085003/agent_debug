import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { DiffEngine } from "@agent-debug/diff-engine";
import { Recorder } from "@agent-debug/recorder";
import { writeDiffBlob, writeSnapshotBlob } from "@agent-debug/store";

interface CodexExecOptions {
  root: string;
  cwd?: string;
  session?: string;
}

export async function codexExecCommand(args: string[], options: CodexExecOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const commandArgs = ["exec", "--json", ...args];
  const recorder = new Recorder({
    rootDir: options.root,
    sessionId: options.session,
    meta: {
      cwd,
      pid: process.pid,
      agent: "codex"
    }
  });

  await recorder.startSession({ command: "codex", args: commandArgs });

  const diffEngine = new DiffEngine(cwd);
  let lastSnapshot: Awaited<ReturnType<DiffEngine["captureSnapshot"]>> | null = null;
  let diffCounter = 0;

  const captureInitialSnapshot = async (): Promise<void> => {
    if (lastSnapshot) {
      return;
    }
    try {
      const snapshot = await diffEngine.captureSnapshot();
      const snapshotId = `snap_${Date.now()}`;
      const files = [];
      for (const file of Object.values(snapshot.files)) {
        const absPath = path.join(cwd, file.path);
        const data = await fs.readFile(absPath);
        const blobRef = await writeSnapshotBlob(
          options.root,
          recorder.getSessionId(),
          snapshotId,
          file.path,
          data
        );
        files.push({ path: file.path, blobRef });
      }
      if (files.length) {
        await recorder.recordSnapshot(files);
      }
      lastSnapshot = snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recorder.recordError(`Snapshot failed: ${message}`);
    }
  };

  const captureDiff = async (): Promise<void> => {
    if (!lastSnapshot) {
      await captureInitialSnapshot();
      return;
    }
    try {
      const { snapshot, changes } = await diffEngine.computeDiff(lastSnapshot);
      lastSnapshot = snapshot;
      if (!changes.length) {
        return;
      }
      diffCounter += 1;
      const diffId = `diff_${Date.now()}_${diffCounter}`;
      const files = [];
      for (const change of changes) {
        if (change.status === "deleted") {
          files.push({ path: change.path, status: "deleted" as const });
          continue;
        }
        const absPath = path.join(cwd, change.path);
        const data = await fs.readFile(absPath);
        const blobRef = await writeDiffBlob(
          options.root,
          recorder.getSessionId(),
          diffId,
          change.path,
          data
        );
        files.push({ path: change.path, status: change.status, blobRef });
      }
      await recorder.recordDiff(files);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recorder.recordError(`Diff failed: ${message}`);
    }
  };

  const child = spawn("codex", commandArgs, {
    cwd,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  let buffer = "";
  let interrupted = false;
  let processing = Promise.resolve();

  processing = processing.then(() => captureInitialSnapshot());

  const isCommandExecutionComplete = (event: Record<string, unknown>): boolean => {
    if (event.type !== "item.completed") {
      return false;
    }
    const item = event.item as Record<string, unknown> | undefined;
    return typeof item === "object" && item?.type === "command_execution";
  };

  const recordLine = (line: string): void => {
    if (!line.trim()) {
      return;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const event =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)
          : { value: parsed };
      processing = processing.then(() => recorder.recordCodexEvent(event));
      if (isCommandExecutionComplete(event)) {
        processing = processing.then(() => captureDiff());
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      processing = processing.then(() =>
        recorder.recordError(`Failed to parse codex JSON: ${message}`)
      );
    }
  };

  const onSigInt = (): void => {
    interrupted = true;
    child.kill("SIGINT");
  };

  process.on("SIGINT", onSigInt);

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      recordLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  let exitCode = 1;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? -1));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recorder.recordError(`Failed to run codex: ${message}`);
  } finally {
    process.off("SIGINT", onSigInt);
  }

  if (buffer.trim()) {
    recordLine(buffer);
  }

  await processing;
  await recorder.endSession(interrupted ? "cancelled" : exitCode === 0 ? "ok" : "error");
  process.exitCode = exitCode;
}
