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
