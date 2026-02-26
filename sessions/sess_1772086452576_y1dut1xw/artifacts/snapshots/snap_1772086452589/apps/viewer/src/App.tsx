import { useEffect, useMemo, useState } from "react";
import { AgentEvent } from "@agent-debug/shared";
import { Timeline } from "./components/Timeline";
import { StepDetail } from "./components/StepDetail";
import {
  SessionSummary,
  getApiBaseUrl,
  loadSessionEvents,
  loadSessions
} from "./lib/loadSession";

export default function App(): JSX.Element {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [selected, setSelected] = useState<AgentEvent | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [status, setStatus] = useState<string>("Loading sessions…");
  const [error, setError] = useState<string>("");

  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const querySessionId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("session") ?? "";
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError("");
    loadSessions(apiBaseUrl)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setSessions(data);
        const fallbackId = data[0]?.id ?? "";
        setActiveSessionId(querySessionId || fallbackId);
        setStatus(data.length ? "Session ready" : "No sessions found");
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Failed to load sessions");
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, querySessionId]);

  useEffect(() => {
    if (!activeSessionId) {
      setEvents([]);
      setSelected(null);
      return;
    }
    let cancelled = false;
    setError("");
    setStatus(`Loading ${activeSessionId}…`);
    loadSessionEvents(activeSessionId, apiBaseUrl)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setEvents(data);
        setSelected(data[0] ?? null);
        setStatus(`Loaded ${activeSessionId}`);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setStatus(`Failed to load ${activeSessionId}`);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, apiBaseUrl]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">Agent Debug Viewer</div>
        <div className="header-controls">
          <div className="session-control">
            <label htmlFor="session-select">Session</label>
            <select
              id="session-select"
              value={activeSessionId}
              onChange={(event) => setActiveSessionId(event.target.value)}
              disabled={!sessions.length}
            >
              {sessions.length === 0 ? (
                <option value="">No sessions</option>
              ) : (
                sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.id}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="status">{error ? error : status}</div>
        </div>
      </header>
      <main className="app-main">
        <section className="timeline-panel">
          <Timeline events={events} selected={selected} onSelect={setSelected} />
        </section>
        <section className="detail-panel">
          <StepDetail event={selected} />
        </section>
      </main>
    </div>
  );
}
