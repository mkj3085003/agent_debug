import { useEffect, useMemo, useState } from "react";
import { AgentEvent } from "@agent-debug/shared";
import { Timeline } from "./components/Timeline";
import { StepDetail } from "./components/StepDetail";
import {
  SessionSummary,
  getApiBaseUrl,
  loadSessionEvents,
  loadSessions,
  restoreSession,
  rerunSession
} from "./lib/loadSession";
import { TimelineFilter, filterEvents } from "./lib/eventFlags";

export default function App(): JSX.Element {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [selected, setSelected] = useState<AgentEvent | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [status, setStatus] = useState<string>("Loading sessions…");
  const [error, setError] = useState<string>("");
  const [restoreStatus, setRestoreStatus] = useState<string>("");
  const [restoreBusy, setRestoreBusy] = useState<boolean>(false);
  const [restoreOutDir, setRestoreOutDir] = useState<string>("");
  const [rerunStatus, setRerunStatus] = useState<string>("");
  const [rerunBusy, setRerunBusy] = useState<boolean>(false);
  const [rerunReuse, setRerunReuse] = useState<boolean>(true);
  const [filters, setFilters] = useState<TimelineFilter[]>([]);

  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const querySessionId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("session") ?? "";
  }, []);

  const filteredEvents = useMemo(() => filterEvents(events, filters), [events, filters]);

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
    setRestoreStatus("");
    setRerunStatus("");
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

  useEffect(() => {
    setSelected((current) => {
      if (!current) {
        return filteredEvents[0] ?? null;
      }
      if (filteredEvents.includes(current)) {
        return current;
      }
      return filteredEvents[0] ?? current;
    });
  }, [filteredEvents]);

  const handleToggleFilter = (filter: TimelineFilter | "all"): void => {
    setFilters((prev) => {
      if (filter === "all") {
        return [];
      }
      if (prev.includes(filter)) {
        return prev.filter((item) => item !== filter);
      }
      return [...prev, filter];
    });
  };

  const handleRerun = async (step: number): Promise<void> => {
    if (!activeSessionId) {
      return;
    }
    setRerunBusy(true);
    setRerunStatus("Rerunning…");
    try {
      await rerunSession(activeSessionId, step, rerunReuse, apiBaseUrl);
      setRerunStatus("Rerun complete. Refresh sessions to view.");
    } catch (err) {
      setRerunStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setRerunBusy(false);
    }
  };

  const handleRestore = async (step: number): Promise<void> => {
    if (!activeSessionId) {
      return;
    }
    setRestoreBusy(true);
    setRestoreStatus("Restoring…");
    try {
      const result = await restoreSession(
        activeSessionId,
        step,
        restoreOutDir || undefined,
        apiBaseUrl
      );
      setRestoreStatus(result.outputDir ? `Restored to ${result.outputDir}` : "Restored");
    } catch (err) {
      setRestoreStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoreBusy(false);
    }
  };

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
                {session.id} · {new Date(session.updatedAt).toLocaleString()}
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
          <Timeline
            events={filteredEvents}
            selected={selected}
            onSelect={setSelected}
            filters={filters}
            onToggleFilter={handleToggleFilter}
          />
        </section>
        <section className="detail-panel">
          <StepDetail
            event={selected}
            events={events}
            sessionId={activeSessionId}
            apiBaseUrl={apiBaseUrl}
            onSelectEvent={setSelected}
            onRestore={handleRestore}
            restoreBusy={restoreBusy}
            restoreStatus={restoreStatus}
            restoreOutDir={restoreOutDir}
            onRestoreOutDirChange={setRestoreOutDir}
            onRerun={handleRerun}
            rerunBusy={rerunBusy}
            rerunStatus={rerunStatus}
            rerunReuse={rerunReuse}
            onRerunReuseChange={setRerunReuse}
          />
        </section>
      </main>
    </div>
  );
}
