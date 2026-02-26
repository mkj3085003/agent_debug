import { AgentEvent } from "@agent-debug/shared";

interface StepDetailProps {
  event: AgentEvent | null;
}

export function StepDetail({ event }: StepDetailProps): JSX.Element {
  if (!event) {
    return (
      <div className="detail">
        <div className="detail-empty">Select a step to inspect details.</div>
      </div>
    );
  }

  return (
    <div className="detail">
      <div className="detail-header">
        <div className="detail-title">Step {event.step}</div>
        <div className="detail-type">{event.type}</div>
      </div>
      <pre className="detail-body">{JSON.stringify(event, null, 2)}</pre>
    </div>
  );
}
