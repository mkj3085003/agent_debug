import fs from "node:fs/promises";
import path from "node:path";
import { AgentEvent, FsDiffEvent, FsSnapshotEvent, RerunOptions } from "@agent-debug/shared";
import { JsonlStore, getSessionPaths } from "@agent-debug/store";

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
    throw new Error("rerun not implemented");
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
}
