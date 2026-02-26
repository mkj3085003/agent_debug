import {
  AgentEvent,
  BaseEvent,
  EventMeta,
  makeCallId,
  makeSessionId,
  nowIso,
  RecorderOptions,
  SchemaVersion
} from "@agent-debug/shared";
import { JsonlStore } from "@agent-debug/store";

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

  async recordUserInput(text: string): Promise<void> {
    await this.append({ type: "user.input", text });
  }

  async recordModelOutput(text: string): Promise<void> {
    await this.append({ type: "model.output", text });
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

  private async append(event: Omit<AgentEvent, keyof BaseEvent>): Promise<void> {
    const fullEvent = {
      schemaVersion: this.schemaVersion,
      sessionId: this.sessionId,
      step: this.step++,
      ts: nowIso(),
      meta: this.meta,
      ...event
    } as AgentEvent;
    await this.store.appendEvent(this.sessionId, fullEvent);
  }
}
