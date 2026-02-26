import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface SnapshotFile {
  path: string;
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface Snapshot {
  createdAt: string;
  files: Record<string, SnapshotFile>;
}

export interface DiffChange {
  path: string;
  status: "added" | "modified" | "deleted";
  file?: SnapshotFile;
}

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  "sessions",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo"
]);

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function shouldIgnore(relativePath: string, ignore: Set<string>): boolean {
  const segments = relativePath.split("/");
  return segments.some((segment) => ignore.has(segment));
}

export class DiffEngine {
  private ignore: Set<string>;

  constructor(private rootDir: string, ignore?: string[]) {
    this.ignore = new Set(ignore ?? Array.from(DEFAULT_IGNORES));
  }

  async captureSnapshot(): Promise<Snapshot> {
    const files: Record<string, SnapshotFile> = {};
    await this.walk(this.rootDir, files);
    return { createdAt: new Date().toISOString(), files };
  }

  async computeDiff(prev: Snapshot): Promise<{ snapshot: Snapshot; changes: DiffChange[] }> {
    const snapshot = await this.captureSnapshot();
    const changes: DiffChange[] = [];

    for (const [relativePath, file] of Object.entries(snapshot.files)) {
      const before = prev.files[relativePath];
      if (!before) {
        changes.push({ path: relativePath, status: "added", file });
      } else if (before.hash !== file.hash) {
        changes.push({ path: relativePath, status: "modified", file });
      }
    }

    for (const relativePath of Object.keys(prev.files)) {
      if (!snapshot.files[relativePath]) {
        changes.push({ path: relativePath, status: "deleted" });
      }
    }

    return { snapshot, changes };
  }

  private async walk(dir: string, files: Record<string, SnapshotFile>): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        const relative = toPosixPath(path.relative(this.rootDir, fullPath));
        if (!relative || shouldIgnore(relative, this.ignore)) {
          return;
        }
        if (entry.isDirectory()) {
          await this.walk(fullPath, files);
          return;
        }
        if (!entry.isFile()) {
          return;
        }
        const stats = await fs.stat(fullPath);
        const data = await fs.readFile(fullPath);
        const hash = crypto.createHash("sha256").update(data).digest("hex");
        files[relative] = {
          path: relative,
          hash,
          size: stats.size,
          mtimeMs: stats.mtimeMs
        };
      })
    );
  }
}
