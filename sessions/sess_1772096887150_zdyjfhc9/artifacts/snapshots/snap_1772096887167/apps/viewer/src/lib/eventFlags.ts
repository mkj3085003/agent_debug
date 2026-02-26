import { AgentEvent } from "@agent-debug/shared";

export type TimelineFilter = "changes" | "errors" | "tools" | "prompts";

export interface EventFlags {
  hasChanges: boolean;
  hasError: boolean;
  isTool: boolean;
  isPrompt: boolean;
}

export function getEventFlags(event: AgentEvent): EventFlags {
  const isTool = event.type === "tool.call" || event.type === "tool.result";
  const isPrompt =
    event.type === "user.input" || event.type === "model.output" || event.type === "codex.event";
  const hasChanges = event.type === "fs.diff";
  const hasError =
    event.type === "error" ||
    (event.type === "tool.result" && (event.output.exitCode ?? 0) !== 0);

  return { hasChanges, hasError, isTool, isPrompt };
}

export function filterEvents(events: AgentEvent[], filters: TimelineFilter[]): AgentEvent[] {
  if (!filters.length) {
    return events;
  }
  return events.filter((event) => {
    const flags = getEventFlags(event);
    return (
      (filters.includes("changes") && flags.hasChanges) ||
      (filters.includes("errors") && flags.hasError) ||
      (filters.includes("tools") && flags.isTool) ||
      (filters.includes("prompts") && flags.isPrompt)
    );
  });
}
