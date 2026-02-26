# Event Schema (v1 draft)

All events are JSON objects, one per line, in `events.jsonl`.

## Common fields
- schemaVersion: "1.0.0"
- sessionId: string
- step: number
- ts: ISO timestamp
- type: string
- meta: { cwd, host, pid, agent }

## Key event types
- session.start / session.end
- user.input
- model.output
- tool.call / tool.result
- fs.diff
- codex.event
- test.result
- error

## Notes
- tool.call and tool.result should include a shared callId for pairing.
- fs.diff may reference artifacts in the store.
- codex.event stores raw JSON lines from `codex exec --json` for later mapping.
- fs.snapshot captures workspace blobs; fs.diff includes status + blobRef for added/modified files.
