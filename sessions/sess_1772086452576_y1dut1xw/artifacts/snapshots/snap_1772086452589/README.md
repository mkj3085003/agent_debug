# Agent Debug Platform

Local-first debugging platform for agent runs. Records every step, stores diffs, and enables replay or rerun from any step.

## Repo structure
- apps/cli: CLI wrapper and runner
- apps/viewer: timeline UI
- packages/shared: shared types and schema
- packages/recorder: session recorder
- packages/tool-adapters: tool wrappers (shell/fs/net/test)
- packages/diff-engine: file diff engine
- packages/replay: replay + rerun logic
- packages/store: JSONL + artifacts store
- docs: design docs and schema notes
- examples: sample event logs

## Local development (placeholder)
- Install deps: `npm install`
- Build all: `npm run build`
- Typecheck: `npm run typecheck`
- Dev servers: `npm run dev`

## CLI quick start
- Record a shell run: `node apps/cli/dist/index.js run echo hello`
- Record a Codex exec stream: `node apps/cli/dist/index.js codex-exec -- --model gpt-4.1-mini "summarize this repo"`
- Serve session data for the viewer: `node apps/cli/dist/index.js serve`
- Restore a workspace snapshot: `node apps/cli/dist/index.js restore <sessionId> --step 0`

## Viewer (real sessions)
- Start API: `node apps/cli/dist/index.js serve`
- Start viewer: `npm run dev -w @agent-debug/viewer`
- Optional API override: `VITE_AGENT_DEBUG_API=http://localhost:8787`

## Current focus (MVP)
- Timeline replay
- Rerun from step (reuse outputs or live re-exec)

See `docs/` and the project plans for details.
