import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createTwoFilesPatch, diffLines } from "diff";
import { AgentEvent, FsDiffEvent } from "@agent-debug/shared";
import { loadArtifactText } from "../lib/loadSession";

interface StepDetailProps {
  event: AgentEvent | null;
  events: AgentEvent[];
  sessionId: string;
  apiBaseUrl: string;
  onSelectEvent?: (event: AgentEvent) => void;
  onRestore?: (step: number) => void;
  restoreBusy?: boolean;
  restoreStatus?: string;
  restoreOutDir?: string;
  onRestoreOutDirChange?: (value: string) => void;
  onRerun?: (step: number) => void;
  rerunBusy?: boolean;
  rerunStatus?: string;
  rerunReuse?: boolean;
  onRerunReuseChange?: (value: boolean) => void;
}

type DiffViewMode = "split" | "unified";

interface DiffRow {
  leftNum?: number;
  rightNum?: number;
  left?: string;
  right?: string;
  type: "add" | "del" | "same";
}

interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

interface DiffState {
  loading: boolean;
  error?: string;
  before?: string;
  after?: string;
  diff?: string;
  rows?: DiffRow[];
  stats?: DiffStats;
  status?: string;
}

interface PromptItem {
  role: "user" | "model" | "codex";
  step: number;
  ts: string;
  text: string;
}

function DetailSection({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="detail-section">
      <div className="detail-section-title">{title}</div>
      <div className="detail-section-body">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }): JSX.Element {
  return (
    <div className="detail-row">
      <div className="detail-row-label">{label}</div>
      <div className="detail-row-value">{value ?? "—"}</div>
    </div>
  );
}

function summarizeText(text: string, max = 140): string {
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
    return JSON.stringify(input, null, 2);
  }
  return [command, ...args].join(" ").trim();
}

function findPreviousFileRef(
  events: AgentEvent[],
  currentStep: number,
  filePath: string
): { blobRef?: string; status?: string } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i];
    if (evt.step >= currentStep) {
      continue;
    }
    if (evt.type === "fs.diff") {
      const file = evt.files.find((entry) => entry.path === filePath);
      if (file) {
        return { blobRef: file.blobRef, status: file.status };
      }
    }
    if (evt.type === "fs.snapshot") {
      const file = evt.files.find((entry) => entry.path === filePath);
      if (file) {
        return { blobRef: file.blobRef, status: "snapshot" };
      }
    }
  }
  return null;
}

function buildSideBySide(beforeText: string, afterText: string): {
  rows: DiffRow[];
  stats: DiffStats;
} {
  const rows: DiffRow[] = [];
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 };
  let leftLine = 1;
  let rightLine = 1;
  const parts = diffLines(beforeText, afterText);
  for (const part of parts) {
    const lines = part.value.split("\n");
    if (lines.length && lines[lines.length - 1] === "") {
      lines.pop();
    }
    for (const line of lines) {
      if (part.added) {
        rows.push({ type: "add", leftNum: undefined, rightNum: rightLine, left: "", right: line });
        rightLine += 1;
        stats.added += 1;
      } else if (part.removed) {
        rows.push({ type: "del", leftNum: leftLine, rightNum: undefined, left: line, right: "" });
        leftLine += 1;
        stats.removed += 1;
      } else {
        rows.push({
          type: "same",
          leftNum: leftLine,
          rightNum: rightLine,
          left: line,
          right: line
        });
        leftLine += 1;
        rightLine += 1;
        stats.unchanged += 1;
      }
    }
  }
  return { rows, stats };
}

function renderUnifiedDiff(diffText: string): JSX.Element {
  const lines = diffText.split("\n");
  return (
    <div className="diff-block">
      {lines.map((line, index) => {
        let className = "diff-line";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          className += " diff-line--add";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          className += " diff-line--del";
        } else if (line.startsWith("@@")) {
          className += " diff-line--hunk";
        }
        return (
          <div key={`${index}-${line}`} className={className}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

function renderSplitDiff(rows: DiffRow[]): JSX.Element {
  return (
    <div className="diff-split">
      <div className="diff-split-header">
        <span>Before</span>
        <span>After</span>
      </div>
      <div className="diff-split-body">
        {rows.map((row, index) => (
          <div key={`${index}-${row.leftNum ?? "x"}-${row.rightNum ?? "x"}`} className={`diff-row diff-row--${row.type}`}>
            <div className="diff-cell diff-cell--num">{row.leftNum ?? ""}</div>
            <div className="diff-cell diff-cell--text">{row.left ?? ""}</div>
            <div className="diff-cell diff-cell--num">{row.rightNum ?? ""}</div>
            <div className="diff-cell diff-cell--text">{row.right ?? ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getStepExplanation(event: AgentEvent, events: AgentEvent[]): string {
  switch (event.type) {
    case "session.start":
      return `开始记录会话${event.input?.command ? `：${event.input.command}` : ""}。`;
    case "session.end":
      return `会话结束，状态：${event.status}。`;
    case "user.input":
      return `用户输入（${event.text.length} 字符）。`;
    case "model.output":
      return `模型输出（${event.text.length} 字符）。`;
    case "tool.call": {
      const command = formatCommandInput(event.input);
      return command
        ? `调用工具 ${event.tool} 执行命令：${command}。`
        : `调用工具 ${event.tool} 执行命令。`;
    }
    case "tool.result": {
      const exit = event.output.exitCode;
      const stdoutSize = event.output.stdout?.length ?? 0;
      const stderrSize = event.output.stderr?.length ?? 0;
      const parts = [`工具 ${event.tool} 执行完成`];
      if (exit !== undefined) {
        parts.push(`exitCode=${exit}`);
      }
      if (stdoutSize) {
        parts.push(`stdout ${stdoutSize} 字符`);
      }
      if (stderrSize) {
        parts.push(`stderr ${stderrSize} 字符`);
      }
      return `${parts.join("，")}。`;
    }
    case "fs.diff": {
      const counts = event.files.reduce(
        (acc, file) => {
          const status = file.status ?? "modified";
          acc[status] += 1;
          return acc;
        },
        { added: 0, modified: 0, deleted: 0 }
      );
      return `检测到文件变更：新增 ${counts.added}，修改 ${counts.modified}，删除 ${counts.deleted}。`;
    }
    case "fs.snapshot":
      return `保存工作区快照（${event.files.length} 个文件）。`;
    case "test.result":
      return `测试 ${event.name} 结果：${event.status}。`;
    case "error":
      return `发生错误：${event.message}`;
    case "codex.event":
      return "记录 Codex 内部事件。";
    default:
      return "事件已记录。";
  }
}

function getPromptItems(events: AgentEvent[]): PromptItem[] {
  const items: PromptItem[] = [];
  for (const event of events) {
    if (event.type === "user.input") {
      items.push({ role: "user", step: event.step, ts: event.ts, text: event.text });
    } else if (event.type === "model.output") {
      items.push({ role: "model", step: event.step, ts: event.ts, text: event.text });
    } else if (event.type === "codex.event") {
      items.push({
        role: "codex",
        step: event.step,
        ts: event.ts,
        text: JSON.stringify(event.event, null, 2)
      });
    }
  }
  return items;
}

function findPromptEvent(events: AgentEvent[], item: PromptItem): AgentEvent | null {
  const typeMap: Record<PromptItem["role"], AgentEvent["type"]> = {
    user: "user.input",
    model: "model.output",
    codex: "codex.event"
  };
  const targetType = typeMap[item.role];
  const exact = events.find((event) => event.step === item.step && event.type === targetType);
  if (exact) {
    return exact;
  }
  return events.find((event) => event.step === item.step) ?? null;
}

export function StepDetail({
  event,
  events,
  sessionId,
  apiBaseUrl,
  onSelectEvent,
  onRestore,
  restoreBusy = false,
  restoreStatus = "",
  restoreOutDir = "",
  onRestoreOutDirChange,
  onRerun,
  rerunBusy = false,
  rerunStatus = "",
  rerunReuse = true,
  onRerunReuseChange
}: StepDetailProps): JSX.Element {
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [diffState, setDiffState] = useState<DiffState>({ loading: false });
  const [diffView, setDiffView] = useState<DiffViewMode>("split");
  const promptListRef = useRef<HTMLDivElement | null>(null);

  const eventTime = useMemo(() => {
    if (!event) {
      return "";
    }
    return new Date(event.ts).toLocaleString();
  }, [event]);

  const explanation = useMemo(() => {
    if (!event) {
      return "";
    }
    return getStepExplanation(event, events);
  }, [event, events]);

  const promptItems = useMemo(() => getPromptItems(events), [events]);

  useEffect(() => {
    if (event?.type === "fs.diff") {
      setSelectedFile(event.files[0]?.path ?? "");
    } else {
      setSelectedFile("");
    }
    setDiffState({ loading: false });
  }, [event?.step, event?.type]);

  useEffect(() => {
    if (!event || event.type !== "fs.diff" || !selectedFile || !sessionId) {
      return;
    }
    let cancelled = false;
    const run = async (): Promise<void> => {
      setDiffState({ loading: true });
      try {
        const file = event.files.find((entry) => entry.path === selectedFile);
        const beforeRef = findPreviousFileRef(events, event.step, selectedFile);
        const beforeText = beforeRef?.blobRef
          ? await loadArtifactText(sessionId, beforeRef.blobRef, apiBaseUrl)
          : "";
        const afterText = file?.blobRef
          ? await loadArtifactText(sessionId, file.blobRef, apiBaseUrl)
          : "";
        const diffText = createTwoFilesPatch(
          selectedFile,
          selectedFile,
          beforeText,
          afterText,
          "before",
          "after",
          { context: 3 }
        );
        const split = buildSideBySide(beforeText, afterText);
        if (cancelled) {
          return;
        }
        setDiffState({
          loading: false,
          before: beforeText,
          after: afterText,
          diff: diffText,
          rows: split.rows,
          stats: split.stats,
          status: file?.status
        });
      } catch (err) {
        if (cancelled) {
          return;
        }
        setDiffState({
          loading: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [event, selectedFile, sessionId, apiBaseUrl, events]);

  useEffect(() => {
    if (!promptListRef.current) {
      return;
    }
    const active = promptListRef.current.querySelector(".prompt-item--active");
    if (active instanceof HTMLElement) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [event?.step]);

  if (!event) {
    return (
      <div className="detail">
        <div className="detail-empty">Select a step to inspect details.</div>
      </div>
    );
  }

  const renderEventBody = (): JSX.Element => {
    switch (event.type) {
      case "session.start":
        return (
          <DetailSection title="Session start">
            <DetailRow label="Command" value={event.input?.command ?? "—"} />
            <DetailRow
              label="Args"
              value={event.input?.args ? event.input.args.join(" ") : "—"}
            />
            <DetailRow label="User" value={event.input?.user ?? "—"} />
          </DetailSection>
        );
      case "session.end":
        return (
          <DetailSection title="Session end">
            <DetailRow label="Status" value={event.status} />
          </DetailSection>
        );
      case "user.input":
        return (
          <DetailSection title="User input">
            <pre className="detail-code">{event.text}</pre>
          </DetailSection>
        );
      case "model.output":
        return (
          <DetailSection title="Model output">
            <pre className="detail-code">{event.text}</pre>
          </DetailSection>
        );
      case "tool.call": {
        const command = formatCommandInput(event.input);
        return (
          <DetailSection title="Tool call">
            <DetailRow label="Tool" value={event.tool} />
            <DetailRow label="Call ID" value={event.callId} />
            <DetailRow label="Command" value={command || "—"} />
            <pre className="detail-code">{JSON.stringify(event.input, null, 2)}</pre>
          </DetailSection>
        );
      }
      case "tool.result":
        return (
          <DetailSection title="Tool result">
            <DetailRow label="Tool" value={event.tool} />
            <DetailRow label="Call ID" value={event.callId} />
            <DetailRow label="Exit code" value={event.output.exitCode ?? "—"} />
            <DetailRow label="Duration" value={event.output.durationMs ?? "—"} />
            {event.output.stdout ? (
              <div className="detail-output">
                <div className="detail-output-title">stdout</div>
                <pre className="detail-code">{event.output.stdout}</pre>
              </div>
            ) : null}
            {event.output.stderr ? (
              <div className="detail-output">
                <div className="detail-output-title">stderr</div>
                <pre className="detail-code">{event.output.stderr}</pre>
              </div>
            ) : null}
            {event.output.result ? (
              <div className="detail-output">
                <div className="detail-output-title">result</div>
                <pre className="detail-code">{JSON.stringify(event.output.result, null, 2)}</pre>
              </div>
            ) : null}
          </DetailSection>
        );
      case "fs.diff": {
        const diffEvent = event as FsDiffEvent;
        return (
          <DetailSection title="Filesystem diff">
            <DetailRow label="Files changed" value={diffEvent.files.length} />
            <div className="diff-layout">
              <div className="diff-files">
                {diffEvent.files.map((file) => (
                  <button
                    key={file.path}
                    className={
                      selectedFile === file.path ? "diff-file diff-file--active" : "diff-file"
                    }
                    onClick={() => setSelectedFile(file.path)}
                  >
                    <span className={`diff-badge diff-badge--${file.status ?? "modified"}`}>
                      {file.status ?? "modified"}
                    </span>
                    <span className="diff-path">{file.path}</span>
                  </button>
                ))}
              </div>
              <div className="diff-detail">
                {diffState.loading ? (
                  <div className="detail-empty">Loading diff…</div>
                ) : diffState.error ? (
                  <div className="detail-empty">{diffState.error}</div>
                ) : diffState.diff ? (
                  <>
                    <div className="diff-toolbar">
                      <div className="diff-stats">
                        +{diffState.stats?.added ?? 0} / -{diffState.stats?.removed ?? 0} / =
                        {diffState.stats?.unchanged ?? 0}
                      </div>
                      <div className="diff-view-toggle">
                        <button
                          className={diffView === "split" ? "diff-toggle diff-toggle--active" : "diff-toggle"}
                          onClick={() => setDiffView("split")}
                        >
                          Split
                        </button>
                        <button
                          className={
                            diffView === "unified" ? "diff-toggle diff-toggle--active" : "diff-toggle"
                          }
                          onClick={() => setDiffView("unified")}
                        >
                          Unified
                        </button>
                      </div>
                    </div>
                    {diffView === "split" && diffState.rows ? renderSplitDiff(diffState.rows) : null}
                    {diffView === "unified" && diffState.diff ? renderUnifiedDiff(diffState.diff) : null}
                    <details className="detail-toggle-panel">
                      <summary>Show before</summary>
                      <pre className="detail-code">{diffState.before ?? ""}</pre>
                    </details>
                    <details className="detail-toggle-panel">
                      <summary>Show after</summary>
                      <pre className="detail-code">{diffState.after ?? ""}</pre>
                    </details>
                  </>
                ) : (
                  <div className="detail-empty">Select a file to view diff.</div>
                )}
              </div>
            </div>
          </DetailSection>
        );
      }
      case "fs.snapshot":
        return (
          <DetailSection title="Filesystem snapshot">
            <DetailRow label="Files captured" value={event.files.length} />
            <div className="detail-note">
              Snapshot stored for restore/replay. Diff view shows file changes only.
            </div>
          </DetailSection>
        );
      case "test.result":
        return (
          <DetailSection title="Test result">
            <DetailRow label="Test" value={event.name} />
            <DetailRow label="Status" value={event.status} />
            {event.output ? <pre className="detail-code">{event.output}</pre> : null}
          </DetailSection>
        );
      case "error":
        return (
          <DetailSection title="Error">
            <DetailRow label="Message" value={event.message} />
            {event.stack ? <pre className="detail-code">{event.stack}</pre> : null}
          </DetailSection>
        );
      case "codex.event":
        return (
          <DetailSection title="Codex event">
            <pre className="detail-code">{JSON.stringify(event.event, null, 2)}</pre>
          </DetailSection>
        );
      default:
        return (
          <DetailSection title="Event">
            <pre className="detail-code">{JSON.stringify(event, null, 2)}</pre>
          </DetailSection>
        );
    }
  };

  return (
    <div className="detail">
      <div className="detail-header">
        <div className="detail-title">Step {event.step}</div>
        <div className="detail-type">{event.type}</div>
      </div>
      <div className="detail-subtitle">
        <span>{eventTime}</span>
        {event.meta?.cwd ? <span>cwd: {event.meta.cwd}</span> : null}
      </div>
      <div className="detail-actions">
        <div className="detail-action-stack">
          <button
            className="detail-action-button"
            onClick={() => onRestore?.(event.step)}
            disabled={restoreBusy || !onRestore}
          >
            {restoreBusy ? "Restoring…" : "Restore to this step"}
          </button>
          <div className="detail-action-field">
            <label htmlFor="restore-out">Output dir (optional)</label>
            <input
              id="restore-out"
              type="text"
              value={restoreOutDir}
              placeholder="e.g. /tmp/restore_demo"
              onChange={(event) => onRestoreOutDirChange?.(event.target.value)}
            />
          </div>
        </div>
        <div className="detail-action-stack">
          <button
            className="detail-action-button detail-action-button--secondary"
            onClick={() => onRerun?.(event.step)}
            disabled={rerunBusy || !onRerun}
          >
            {rerunBusy ? "Rerunning…" : "Rerun from this step"}
          </button>
          <label className="detail-toggle">
            <input
              type="checkbox"
              checked={rerunReuse}
              onChange={(event) => onRerunReuseChange?.(event.target.checked)}
              disabled={rerunBusy || !onRerun}
            />
            Reuse outputs (fast)
          </label>
        </div>
      </div>
      {restoreStatus ? <div className="detail-status">{restoreStatus}</div> : null}
      {rerunStatus ? <div className="detail-status detail-status--accent">{rerunStatus}</div> : null}
      <DetailSection title="Step explanation">
        <div className="detail-note">{explanation}</div>
      </DetailSection>
      {renderEventBody()}
      <DetailSection title="Prompt trail">
        {promptItems.length === 0 ? (
          <div className="detail-note">No prompt events recorded.</div>
        ) : (
          <div className="prompt-list" ref={promptListRef}>
            {promptItems.map((item) => {
              const preview = summarizeText(item.text, 160);
              const isShort = item.text.length <= 160;
              const handlePromptClick = (): void => {
                if (!onSelectEvent) {
                  return;
                }
                const target = findPromptEvent(events, item);
                if (target) {
                  onSelectEvent(target);
                }
              };
              const handlePromptKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handlePromptClick();
                }
              };
              return (
                <div
                  key={`${item.step}-${item.role}`}
                  className={`prompt-item prompt-item--${item.role} ${
                    item.step === event.step ? "prompt-item--active" : ""
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={handlePromptClick}
                  onKeyDown={handlePromptKeyDown}
                >
                  <div className="prompt-meta">
                    <span className="prompt-role">{item.role.toUpperCase()}</span>
                    <span className="prompt-step">#{item.step}</span>
                    <span className="prompt-time">{new Date(item.ts).toLocaleTimeString()}</span>
                  </div>
                  {isShort ? (
                    <pre className="prompt-preview">{item.text}</pre>
                  ) : (
                    <details className="detail-toggle-panel">
                      <summary>{preview}</summary>
                      <pre className="detail-code">{item.text}</pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DetailSection>
      <details className="detail-toggle-panel">
        <summary>Raw event JSON</summary>
        <pre className="detail-code">{JSON.stringify(event, null, 2)}</pre>
      </details>
    </div>
  );
}
