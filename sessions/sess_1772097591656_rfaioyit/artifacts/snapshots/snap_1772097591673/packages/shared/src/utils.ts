export function nowIso(): string {
  return new Date().toISOString();
}

export function makeSessionId(prefix = "sess"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function makeCallId(prefix = "call"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}
