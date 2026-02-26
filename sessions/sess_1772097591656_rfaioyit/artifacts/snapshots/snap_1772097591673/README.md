# Agent Debug Platform

Local-first debugging platform for agent runs. Records every step, stores workspace diffs, and enables replay or rerun from any step.

This repo is a practical "flight recorder" for agentic workflows. It captures model/tool I/O, command execution, and filesystem changes, then renders them in a timeline UI you can replay, inspect, or re-execute.

## Screenshot

![Viewer UI (placeholder)](docs/assets/viewer-placeholder.svg)

> Replace this placeholder with a real screenshot from your environment when convenient.

## What you get

- Timeline viewer that lets you inspect each step with logs, tool calls, and diffs.
- Local JSONL session log plus artifacts (snapshots + per-file blobs).
- Replay and rerun from any step (reuse outputs or live re-exec).
- Codex CLI integration via `codex exec --json` capture.
- Restore a workspace to any step for forensic debugging.

## Quick start

Install deps and build:

```bash
npm install
npm run build
```

Record a shell command:

```bash
node apps/cli/dist/index.js run echo hello
```

Record a Codex run (requires `codex` on PATH):

```bash
node apps/cli/dist/index.js codex-exec -- --model <model> "summarize this repo"
```

Start the API server and viewer:

```bash
node apps/cli/dist/index.js serve
npm run dev -w @agent-debug/viewer
```

If your API is not on `http://localhost:8787`, override it:

```bash
VITE_AGENT_DEBUG_API=http://localhost:8787 npm run dev -w @agent-debug/viewer
```

## CLI reference

All commands accept `-r, --root <path>` to control where sessions are stored (default: `.`).

| Command | Description |
| --- | --- |
| `run <cmd> [args...]` | Execute a command and record tool calls, results, and diffs. |
| `codex-exec [args...]` | Run `codex exec --json` and record each JSON event line as `codex.event`. |
| `replay <sessionId>` | Print a step-by-step list of events from a session. |
| `rerun <sessionId> --step <n> [--reuse]` | Restore a workspace and rerun from step `n`. Use `--reuse` to replay recorded outputs. |
| `restore <sessionId> --step <n> [--out <dir>]` | Restore a workspace snapshot to `--out` (default: `./restores/<sessionId>_step_<n>`). |
| `serve` | Serve sessions over HTTP for the viewer UI. |

## How recording works (today)

- Session events are stored as JSONL in `sessions/<sessionId>/events.jsonl`.
- Snapshots and diffs are stored in `sessions/<sessionId>/artifacts/`.
- For shell commands, the recorder skips diffs for common read-only commands (e.g. `ls`, `cat`, `rg`) to reduce overhead.
- `codex-exec` captures raw Codex JSON events; these are stored verbatim as `codex.event`.

## Viewer workflow

1) Start the API: `node apps/cli/dist/index.js serve`
2) Start the UI: `npm run dev -w @agent-debug/viewer`
3) Pick a session, inspect steps, then use Restore or Rerun actions in the detail pane.

## Rerun behavior

- A rerun creates a fresh workspace under `reruns/<sessionId>_<timestamp>`.
- Live rerun currently executes **shell tools only**; other tool types are recorded as errors.
- With `--reuse`, recorded tool outputs and file diffs are replayed deterministically.

## Project structure

- `apps/cli`: CLI wrapper and runner.
- `apps/viewer`: Timeline UI (React + Vite).
- `packages/recorder`: Session recorder.
- `packages/diff-engine`: File snapshot + diff engine.
- `packages/replay`: Replay, restore, rerun logic.
- `packages/store`: JSONL + artifacts store.
- `packages/tool-adapters`: Tool wrappers (shell, fs, network, test).
- `packages/shared`: Shared schema/types.
- `docs/`: Design notes and schema.

## Development

- `npm run dev` runs all workspace dev servers.
- `npm run typecheck` typechecks all packages.

## Notes & limitations

- Codex capture requires the `codex` CLI and uses `codex exec --json` internally.
- Rerun currently supports shell tool execution only.
- Snapshot/diff storage is file-blob based (viewer computes diffs client-side).

See `docs/` for schema and architecture notes.
