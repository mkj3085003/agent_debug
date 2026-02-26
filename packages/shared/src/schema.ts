export type SchemaVersion = "1.0.0";

export type EventType =
  | "session.start"
  | "session.end"
  | "user.input"
  | "model.output"
  | "tool.call"
  | "tool.result"
  | "fs.diff"
  | "fs.snapshot"
  | "test.result"
  | "error"
  | "codex.event";

export type StepIndex = number;

export interface EventMeta {
  cwd?: string;
  host?: string;
  pid?: number;
  agent?: string;
}

export interface BaseEvent {
  schemaVersion: SchemaVersion;
  sessionId: string;
  step: StepIndex;
  ts: string;
  type: EventType;
  meta?: EventMeta;
}

export interface SessionStartEvent extends BaseEvent {
  type: "session.start";
  input: { command?: string; args?: string[]; user?: string };
}

export interface SessionEndEvent extends BaseEvent {
  type: "session.end";
  status: "ok" | "error" | "cancelled";
}

export interface UserInputEvent extends BaseEvent {
  type: "user.input";
  text: string;
}

export interface ModelOutputEvent extends BaseEvent {
  type: "model.output";
  text: string;
}

export interface ToolCallEvent extends BaseEvent {
  type: "tool.call";
  tool: string;
  callId: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseEvent {
  type: "tool.result";
  tool: string;
  callId: string;
  output: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    durationMs?: number;
    result?: Record<string, unknown>;
  };
}

export interface FsDiffEvent extends BaseEvent {
  type: "fs.diff";
  files: Array<{
    path: string;
    patchRef?: string;
    patch?: string;
    status?: "added" | "modified" | "deleted";
    blobRef?: string;
  }>;
}

export interface FsSnapshotEvent extends BaseEvent {
  type: "fs.snapshot";
  files: Array<{
    path: string;
    blobRef: string;
  }>;
}

export interface TestResultEvent extends BaseEvent {
  type: "test.result";
  name: string;
  status: "pass" | "fail" | "skip";
  output?: string;
}

export interface ErrorEvent extends BaseEvent {
  type: "error";
  message: string;
  stack?: string;
}

export interface CodexEvent extends BaseEvent {
  type: "codex.event";
  event: Record<string, unknown>;
}

export type AgentEvent =
  | SessionStartEvent
  | SessionEndEvent
  | UserInputEvent
  | ModelOutputEvent
  | ToolCallEvent
  | ToolResultEvent
  | FsDiffEvent
  | FsSnapshotEvent
  | TestResultEvent
  | ErrorEvent
  | CodexEvent;
