import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { getSessionPaths } from "@agent-debug/store";

interface ServeOptions {
  root: string;
  port: string;
  host: string;
}

interface SessionSummary {
  id: string;
  updatedAt: string;
}

function withCors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  withCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  withCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

async function listSessions(rootDir: string): Promise<SessionSummary[]> {
  const sessionsDir = path.join(rootDir, "sessions");
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const { eventsPath, sessionDir } = getSessionPaths(rootDir, entry.name);
        let stats: { mtime: Date } | null = null;
        try {
          stats = await fs.stat(eventsPath);
        } catch {
          try {
            stats = await fs.stat(sessionDir);
          } catch {
            stats = null;
          }
        }
        const updatedAt = stats ? stats.mtime.toISOString() : new Date(0).toISOString();
        return { id: entry.name, updatedAt };
      })
  );

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function readEvents(rootDir: string, sessionId: string): Promise<unknown[]> {
  const { eventsPath } = getSessionPaths(rootDir, sessionId);
  const content = await fs.readFile(eventsPath, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

async function readArtifact(rootDir: string, sessionId: string, relativePath: string): Promise<Buffer> {
  const { artifactsDir } = getSessionPaths(rootDir, sessionId);
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const resolved = path.join(artifactsDir, normalized);
  const base = artifactsDir.endsWith(path.sep) ? artifactsDir : `${artifactsDir}${path.sep}`;
  if (!resolved.startsWith(base)) {
    throw new Error("Invalid artifact path");
  }
  return fs.readFile(resolved);
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const rootDir = options.root;
  const port = Number(options.port) || 8787;
  const host = options.host || "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    withCors(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/sessions") {
      const sessions = await listSessions(rootDir);
      sendJson(res, 200, { sessions });
      return;
    }

    const eventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (req.method === "GET" && eventsMatch) {
      try {
        const events = await readEvents(rootDir, eventsMatch[1]);
        sendJson(res, 200, { events });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to read events";
        sendJson(res, 404, { error: message });
      }
      return;
    }

    const artifactMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/artifacts\/(.+)$/);
    if (req.method === "GET" && artifactMatch) {
      try {
        const payload = await readArtifact(rootDir, artifactMatch[1], artifactMatch[2]);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to read artifact";
        sendText(res, 404, message);
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  server.listen(port, host, () => {
    console.log(`Agent Debug API listening at http://${host}:${port}`);
  });
}
