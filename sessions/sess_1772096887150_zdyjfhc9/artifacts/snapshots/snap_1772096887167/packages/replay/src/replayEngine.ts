import fs from "node:fs/promises";
import path from "node:path";
import { DiffEngine } from "@agent-debug/diff-engine";
import { Recorder } from "@agent-debug/recorder";
import { AgentEvent, FsDiffEvent, FsSnapshotEvent, RerunOptions } from "@agent-debug/shared";
import { JsonlStore, getSessionPaths, writeDiffBlob, writeSnapshotBlob } from "@agent-debug/store";
import { runShell } from "@agent-debug/tool-adapters";

export class ReplayEngine {
  private store: JsonlStore;

  constructor(private rootDir: string) {
    this.store = new JsonlStore(rootDir);
  }

  async loadEvents(sessionId: string): Promise<AgentEvent[]> {
    return this.store.readEvents(sessionId);
  }

  async replay(sessionId: string): Promise<AgentEvent[]> {
    return this.loadEvents(sessionId);
  }

  async restoreToStep(sessionId: string, step: number, targetDir: string): Promise<void> {
    const events = await this.loadEvents(sessionId);
    const snapshotEvents = events.filter(
      (event): event is FsSnapshotEvent => event.type === "fs.snapshot"
    );
    const diffEvents = events.filter(
      (event): event is FsDiffEvent => event.type === "fs.diff"
    );

    const snapshot = snapshotEvents
      .filter((event) => event.step <= step)
      .sort((a, b) => b.step - a.step)[0];

    if (!snapshot) {
      throw new Error("No snapshot found before the requested step");
    }

    await this.resetDirectory(targetDir);
    const { artifactsDir } = getSessionPaths(this.rootDir, sessionId);

    for (const file of snapshot.files) {
      const source = this.resolveArtifactPath(artifactsDir, file.blobRef);
      const destination = path.join(targetDir, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }

    const diffsToApply = diffEvents
      .filter((event) => event.step > snapshot.step && event.step <= step)
      .sort((a, b) => a.step - b.step);

    for (const diff of diffsToApply) {
      for (const file of diff.files) {
        const destination = path.join(targetDir, file.path);
        if (file.status === "deleted") {
          await fs.rm(destination, { recursive: true, force: true });
          continue;
        }
        if (file.blobRef) {
          const source = this.resolveArtifactPath(artifactsDir, file.blobRef);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.copyFile(source, destination);
          continue;
        }
        if (file.patchRef) {
          const source = this.resolveArtifactPath(artifactsDir, file.patchRef);
          const content = await fs.readFile(source);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.writeFile(destination, content);
          continue;
        }
        if (file.patch) {
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.writeFile(destination, file.patch, "utf8");
        }
      }
    }
  }

  async rerun(_sessionId: string, _options: RerunOptions): Promise<void> {
    const sessionId = _sessionId;
    const options = _options;
    const fromStep = Number.isFinite(options.fromStep) ? options.fromStep : 0;
    const events = await this.loadEvents(sessionId);
    const runId = `rerun_${Date.now()}`;
    const targetDir = path.join(this.rootDir, "reruns", `${sessionId}_${runId}`);

    await this.restoreToStep(sessionId, fromStep, targetDir);

    const recorder = new Recorder({
      rootDir: this.rootDir,
      meta: { cwd: targetDir, pid: process.pid, agent: options.reuseOutputs ? "replay" : "rerun" }
    });
    await recorder.startSession({ command: "rerun", args: [sessionId, String(fromStep)] });

    const diffEngine = new DiffEngine(targetDir);
    let snapshot = await this.captureSnapshot(diffEngine, recorder, targetDir);
    let status: "ok" | "error" = "ok";

    for (const event of events) {
      if (event.step < fromStep) {
        continue;
      }

      if (event.type === "tool.call") {
        const callId = await recorder.recordToolCall(event.tool, event.input, event.callId);
        if (!options.reuseOutputs) {
          if (event.tool === "shell") {
            const input = event.input as Record<string, unknown>;
            const command = typeof input.command === "string" ? input.command : "";
            const args = Array.isArray(input.args) ? (input.args as string[]) : [];
            const cwdInput = typeof input.cwd === "string" ? input.cwd : "";
            const resolvedCwd =
              cwdInput && !path.isAbsolute(cwdInput)
                ? path.join(targetDir, cwdInput)
                : targetDir;
            const result = await runShell({ command, args, cwd: resolvedCwd });
            await recorder.recordToolResult(event.tool, callId, result);
            if (result.exitCode !== 0) {
              status = "error";
            }
            if (snapshot) {
              snapshot = await this.captureDiff(diffEngine, recorder, targetDir, snapshot);
            }
          } else {
            await recorder.recordError(`Unsupported tool: ${event.tool}`);
            status = "error";
          }
        }
      }

      if (options.reuseOutputs && event.type === "tool.result") {
        await recorder.recordToolResult(event.tool, event.callId, event.output);
      }

      if (options.reuseOutputs && event.type === "fs.diff" && event.step > fromStep) {
        await this.applyDiffEvent(sessionId, event, targetDir);
        if (snapshot) {
          snapshot = await this.captureDiff(diffEngine, recorder, targetDir, snapshot);
        }
      }
    }

    await recorder.endSession(status);
  }

  private async resetDirectory(targetDir: string): Promise<void> {
    await fs.mkdir(targetDir, { recursive: true });
    const entries = await fs.readdir(targetDir);
    await Promise.all(
      entries.map((entry) =>
        fs.rm(path.join(targetDir, entry), { recursive: true, force: true })
      )
    );
  }

  private resolveArtifactPath(artifactsDir: string, ref: string): string {
    if (path.isAbsolute(ref)) {
      return ref;
    }
    return path.join(artifactsDir, ref);
  }

  private async captureSnapshot(
    diffEngine: DiffEngine,
    recorder: Recorder,
    workspaceDir: string
  ): Promise<Awaited<ReturnType<DiffEngine["captureSnapshot"]>> | null> {
    try {
      const snapshot = await diffEngine.captureSnapshot();
      const snapshotId = `snap_${Date.now()}`;
      const files = [];
      for (const file of Object.values(snapshot.files)) {
        const absPath = path.join(workspaceDir, file.path);
        const data = await fs.readFile(absPath);
        const blobRef = await writeSnapshotBlob(
          this.rootDir,
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
      return snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recorder.recordError(`Snapshot failed: ${message}`);
      return null;
    }
  }

  private async captureDiff(
    diffEngine: DiffEngine,
    recorder: Recorder,
    workspaceDir: string,
    previous: Awaited<ReturnType<DiffEngine["captureSnapshot"]>>
  ): Promise<Awaited<ReturnType<DiffEngine["captureSnapshot"]>> | null> {
    try {
      const { snapshot, changes } = await diffEngine.computeDiff(previous);
      if (!changes.length) {
        return snapshot;
      }
      const diffId = `diff_${Date.now()}`;
      const files = [];
      for (const change of changes) {
        if (change.status === "deleted") {
          files.push({ path: change.path, status: "deleted" as const });
          continue;
        }
        const absPath = path.join(workspaceDir, change.path);
        const data = await fs.readFile(absPath);
        const blobRef = await writeDiffBlob(
          this.rootDir,
          recorder.getSessionId(),
          diffId,
          change.path,
          data
        );
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

  private async applyDiffEvent(
    sessionId: string,
    diff: FsDiffEvent,
    targetDir: string
  ): Promise<void> {
    const { artifactsDir } = getSessionPaths(this.rootDir, sessionId);
    for (const file of diff.files) {
      const destination = path.join(targetDir, file.path);
      if (file.status === "deleted") {
        await fs.rm(destination, { recursive: true, force: true });
        continue;
      }
      if (file.blobRef) {
        const source = this.resolveArtifactPath(artifactsDir, file.blobRef);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
        continue;
      }
      if (file.patchRef) {
        const source = this.resolveArtifactPath(artifactsDir, file.patchRef);
        const content = await fs.readFile(source);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, content);
        continue;
      }
      if (file.patch) {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, file.patch, "utf8");
      }
    }
  }
}
