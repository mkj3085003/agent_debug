import { AgentEvent } from "@agent-debug/shared";

interface TimelineProps {
  events: AgentEvent[];
  selected: AgentEvent | null;
  onSelect: (event: AgentEvent) => void;
}

export function Timeline({ events, selected, onSelect }: TimelineProps): JSX.Element {
  return (
    <div className="timeline">
      <div className="timeline-header">Timeline</div>
      <div className="timeline-list">
        {events.map((event) => (
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
            <div className="timeline-item-type">{event.type}</div>
            <div className="timeline-item-time">{new Date(event.ts).toLocaleTimeString()}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
