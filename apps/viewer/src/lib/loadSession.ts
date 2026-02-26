import { AgentEvent } from "@agent-debug/shared";

export interface SessionSummary {
  id: string;
  updatedAt: string;
}

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_AGENT_DEBUG_API ?? "http://localhost:8787";
}

export async function loadSessions(baseUrl = getApiBaseUrl()): Promise<SessionSummary[]> {
  const res = await fetch(`${baseUrl}/api/sessions`);
  if (!res.ok) {
    throw new Error(`Failed to load sessions (${res.status})`);
  }
  const data = (await res.json()) as { sessions?: SessionSummary[] };
  return data.sessions ?? [];
}

export async function loadSessionEvents(
  sessionId: string,
  baseUrl = getApiBaseUrl()
): Promise<AgentEvent[]> {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/events`);
  if (!res.ok) {
    throw new Error(`Failed to load events (${res.status})`);
  }
  const data = (await res.json()) as { events?: AgentEvent[] };
  return data.events ?? [];
}

function encodeArtifactPath(ref: string): string {
  return ref
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function loadArtifactText(
  sessionId: string,
  ref: string,
  baseUrl = getApiBaseUrl()
): Promise<string> {
  const encoded = encodeArtifactPath(ref);
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/artifacts/${encoded}`);
  if (!res.ok) {
    throw new Error(`Failed to load artifact (${res.status})`);
  }
  return res.text();
}

export async function restoreSession(
  sessionId: string,
  step: number,
  outDir?: string,
  baseUrl = getApiBaseUrl()
): Promise<{ outputDir: string }> {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, outDir })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const message = typeof error.error === "string" ? error.error : `Failed to restore (${res.status})`;
    throw new Error(message);
  }
  const data = (await res.json()) as { outputDir?: string };
  return { outputDir: data.outputDir ?? "" };
}

export async function rerunSession(
  sessionId: string,
  step: number,
  reuseOutputs: boolean,
  baseUrl = getApiBaseUrl()
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/rerun`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, reuseOutputs })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const message = typeof error.error === "string" ? error.error : `Failed to rerun (${res.status})`;
    throw new Error(message);
  }
}
