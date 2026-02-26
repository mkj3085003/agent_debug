import {
  AgentEvent,
  EventMeta,
  makeCallId,
  makeSessionId,
  nowIso,
  RecorderOptions,
  SchemaVersion
} from "@agent-debug/shared";
import { JsonlStore } from "@agent-debug/store";

type EventPayload = AgentEvent extends infer T
  ? T extends AgentEvent
    ? Omit<T, "schemaVersion" | "sessionId" | "step" | "ts" | "meta">
    : never
  : never;

function formatCommandInput(input: Record<string, unknown>): string {
  const command = typeof input.command === "string" ? input.command : "";
  const args = Array.isArray(input.args) ? input.args.map((item) => String(item)) : [];
  if (!command && args.length === 0) {
    return "";
  }
  return [command, ...args].join(" ").trim();
}

function formatSourceLabel(source?: string, detail?: string): string {
  if (!source) {
    return "";
  }
  if (detail) {
    return `${source} (${detail})`;
  }
  return source;
}

export class Recorder {
  private sessionId: string;
  private step = 0;
  private meta?: EventMeta;
  private schemaVersion: SchemaVersion = "1.0.0";
  private store: JsonlStore;

  constructor(private options: RecorderOptions) {
    this.sessionId = options.sessionId ?? makeSessionId();
    this.meta = options.meta;
    this.store = new JsonlStore(options.rootDir);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async startSession(input: { command?: string; args?: string[]; user?: string } = {}): Promise<void> {
    await this.store.ensureSession(this.sessionId);
    await this.append({
      type: "session.start",
      input
    });
  }

  async endSession(status: "ok" | "error" | "cancelled"): Promise<void> {
    await this.append({
      type: "session.end",
      status
    });
  }

  async recordUserInput(text: string, source?: string, sourceDetail?: string): Promise<void> {
    await this.append({ type: "user.input", text, source, sourceDetail });
  }

  async recordModelOutput(text: string, source?: string): Promise<void> {
    await this.append({ type: "model.output", text, source });
  }

  async recordToolCall(tool: string, input: Record<string, unknown>, callId = makeCallId()): Promise<string> {
    await this.append({ type: "tool.call", tool, callId, input });
    return callId;
  }

  async recordToolResult(tool: string, callId: string, output: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    durationMs?: number;
    result?: Record<string, unknown>;
  }): Promise<void> {
    await this.append({ type: "tool.result", tool, callId, output });
  }

  async recordDiff(files: Array<{
    path: string;
    patch?: string;
    patchRef?: string;
    status?: "added" | "modified" | "deleted";
    blobRef?: string;
  }>): Promise<void> {
    await this.append({ type: "fs.diff", files });
  }

  async recordSnapshot(files: Array<{ path: string; blobRef: string }>): Promise<void> {
    await this.append({ type: "fs.snapshot", files });
  }

  async recordCodexEvent(event: Record<string, unknown>): Promise<void> {
    await this.append({ type: "codex.event", event });
  }

  async recordError(message: string, stack?: string): Promise<void> {
    await this.append({ type: "error", message, stack });
  }

  private buildExplanation(event: EventPayload): string | undefined {
    switch (event.type) {
      case "session.start": {
        const command = event.input?.command;
        const args = event.input?.args?.join(" ");
        if (command) {
          const tail = args ? ` ${args}` : "";
          return `Session started: ${command}${tail}`;
        }
        return "Session started.";
      }
      case "session.end":
        return `Session ended (${event.status}).`;
      case "user.input": {
        const sourceLabel = formatSourceLabel(event.source, event.sourceDetail);
        return sourceLabel ? `User input recorded (${sourceLabel}).` : "User input recorded.";
      }
      case "model.output": {
        const sourceLabel = event.source ? ` (${event.source})` : "";
        return `Model output recorded${sourceLabel}.`;
      }
      case "tool.call": {
        const command = formatCommandInput(event.input);
        return command ? `Tool call (${event.tool}): ${command}` : `Tool call (${event.tool}).`;
      }
      case "tool.result": {
        const parts = [`Tool result (${event.tool})`];
        if (typeof event.output.exitCode === "number") {
          parts.push(`exit ${event.output.exitCode}`);
        }
        if (typeof event.output.durationMs === "number") {
          parts.push(`${event.output.durationMs}ms`);
        }
        return `${parts.join(" ")}.`;
      }
      case "fs.diff": {
        const counts = { added: 0, modified: 0, deleted: 0 };
        for (const file of event.files) {
          const status = file.status ?? "modified";
          counts[status] += 1;
        }
        return `Filesystem diff: +${counts.added} ~${counts.modified} -${counts.deleted}.`;
      }
      case "fs.snapshot":
        return `Filesystem snapshot (${event.files.length} files).`;
      case "test.result":
        return `Test ${event.name}: ${event.status}.`;
      case "error":
        return `Error: ${event.message}`;
      case "codex.event":
        return "Codex event recorded.";
      default:
        return undefined;
    }
  }

  private async append(event: EventPayload): Promise<void> {
    const explain = event.explain ?? this.buildExplanation(event);
    const fullEvent = {
      schemaVersion: this.schemaVersion,
      sessionId: this.sessionId,
      step: this.step++,
      ts: nowIso(),
      meta: this.meta,
      ...event,
      explain
    } as AgentEvent;
    await this.store.appendEvent(this.sessionId, fullEvent);
  }
}
