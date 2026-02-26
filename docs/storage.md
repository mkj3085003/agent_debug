# Storage Layout

sessions/
  sess_01/
    events.jsonl
    artifacts/
      diff/
        step_00014.patch
      logs/
        step_00013.stdout.txt
        step_00013.stderr.txt

## Guidelines
- Keep JSONL append-only.
- Store large blobs as artifacts, reference from events.
- Consider compression and size caps for large sessions.
