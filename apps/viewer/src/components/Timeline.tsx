import { AgentEvent } from "@agent-debug/shared";
import { TimelineFilter, getEventFlags } from "../lib/eventFlags";

interface TimelineProps {
  events: AgentEvent[];
  selected: AgentEvent | null;
  onSelect: (event: AgentEvent) => void;
  filters: TimelineFilter[];
  onToggleFilter: (filter: TimelineFilter | "all") => void;
}

function previewText(text: string, max = 70): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
}

function formatCommandInput(input: Record<string, unknown>): string {
  const command = typeof input.command === "string" ? input.command : "";
  const args = Array.isArray(input.args) ? input.args.map((item) => String(item)) : [];
  if (!command && args.length === 0) {
    return JSON.stringify(input);
  }
  return [command, ...args].join(" ").trim();
}

function getEventSummary(event: AgentEvent): { title: string; subtitle?: string } {
  switch (event.type) {
    case "session.start":
      return {
        title: "session.start",
        subtitle: event.input?.command ? previewText(event.input.command) : undefined
      };
    case "session.end":
      return { title: `session.end (${event.status})` };
    case "user.input":
      return { title: "user.input", subtitle: previewText(event.text) };
    case "model.output":
      return { title: "model.output", subtitle: previewText(event.text) };
    case "tool.call":
      return {
        title: `tool.call (${event.tool})`,
        subtitle: previewText(formatCommandInput(event.input))
      };
    case "tool.result":
      return { title: `tool.result (${event.tool})` };
    case "fs.diff":
      return { title: "fs.diff", subtitle: `${event.files.length} file(s)` };
    case "fs.snapshot":
      return { title: "fs.snapshot", subtitle: `${event.files.length} file(s)` };
    case "test.result":
      return { title: `test.result (${event.status})`, subtitle: event.name };
    case "error":
      return { title: "error", subtitle: previewText(event.message) };
    case "codex.event":
      return { title: "codex.event" };
    default:
      return { title: "event" };
  }
}

export function Timeline({
  events,
  selected,
  onSelect,
  filters,
  onToggleFilter
}: TimelineProps): JSX.Element {
  return (
    <div className="timeline">
      <div className="timeline-header">
        <div className="timeline-title">Timeline</div>
        <div className="timeline-filters">
          <button
            type="button"
            className={filters.length === 0 ? "timeline-filter timeline-filter--active" : "timeline-filter"}
            onClick={() => onToggleFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={filters.includes("changes") ? "timeline-filter timeline-filter--active" : "timeline-filter"}
            onClick={() => onToggleFilter("changes")}
          >
            Changes
          </button>
          <button
            type="button"
            className={filters.includes("errors") ? "timeline-filter timeline-filter--active" : "timeline-filter"}
            onClick={() => onToggleFilter("errors")}
          >
            Errors
          </button>
          <button
            type="button"
            className={filters.includes("tools") ? "timeline-filter timeline-filter--active" : "timeline-filter"}
            onClick={() => onToggleFilter("tools")}
          >
            Tools
          </button>
          <button
            type="button"
            className={filters.includes("prompts") ? "timeline-filter timeline-filter--active" : "timeline-filter"}
            onClick={() => onToggleFilter("prompts")}
          >
            Prompts
          </button>
        </div>
      </div>
      <div className="timeline-list">
        {events.length === 0 ? (
          <div className="timeline-empty">No events match the current filters.</div>
        ) : (
          events.map((event) => (
            <button
              key={`${event.step}-${event.type}`}
              className={
                selected?.step === event.step
                  ? "timeline-item timeline-item--active"
                  : "timeline-item"
              }
              onClick={() => onSelect(event)}
            >
              <div className="timeline-item-step">#{event.step}</div>
              {(() => {
                const summary = getEventSummary(event);
                const flags = getEventFlags(event);
                const badges = [
                  flags.hasChanges ? { label: "diff", className: "timeline-badge--changes" } : null,
                  flags.hasError ? { label: "err", className: "timeline-badge--error" } : null,
                  flags.isTool ? { label: "tool", className: "timeline-badge--tool" } : null,
                  flags.isPrompt ? { label: "prompt", className: "timeline-badge--prompt" } : null
                ].filter(Boolean) as Array<{ label: string; className: string }>;
                return (
                  <>
                    <div className="timeline-item-type">{summary.title}</div>
                    {badges.length ? (
                      <div className="timeline-item-badges">
                        {badges.map((badge) => (
                          <span key={badge.label} className={`timeline-badge ${badge.className}`}>
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {summary.subtitle ? (
                      <div className="timeline-item-meta">{summary.subtitle}</div>
                    ) : null}
                  </>
                );
              })()}
              <div className="timeline-item-time">{new Date(event.ts).toLocaleTimeString()}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
