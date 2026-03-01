# Runtime Debug Agent (RDA)

Editor-agnostic, runtime single-step debugging via DAP (Debug Adapter Protocol).

This is a standalone tool in this repo. It focuses on **runtime debugging**, not the
"record/replay" features of the main project.

## Status

- Built-in adapter: **Python (debugpy)**
- Other languages: supported via **custom DAP adapter command**

## Quick start (Python)

1) Install debugpy in your Python environment:

```bash
python -m pip install debugpy
```

2) Install Node dependencies for the UI:

```bash
cd runtime-debug-agent
npm install
```

3) Start debugging:

```bash
./runtime-debug-agent/bin/rda.js start --lang python --program path/to/app.py -- --arg1 --arg2
```

4) Use the interactive REPL:

- `next` / `n` - step over
- `step` / `s` - step in
- `out` / `o` - step out
- `cont` / `c` - continue
- `bt` - stack trace
- `scopes` - list scopes
- `vars` - list variables in current scope
- `eval <expr>` - evaluate in current frame
- `break add <file:line>` - add breakpoint
- `break clear <file>` - clear breakpoints for file
- `quit` - exit

## Web panel UI

Start the built-in web panel:

```bash
./runtime-debug-agent/bin/rda.js start --lang python --program path/to/app.py --ui
```

The CLI will print the UI URL (default `http://127.0.0.1:8789`).

The UI can send debug control commands:
- Step In / Step Over / Step Out / Continue
- Breakpoint add (`file.py:12`) and clear (`file.py`)
 - Chat ask/answer about current state (call stack, variables, location)

## VSCode (DAP proxy)

Use VSCode's built-in debug UI with RDA acting as a DAP proxy (Python first).

1) Start the adapter server:

```bash
./runtime-debug-agent/bin/rda-adapter.js --port 4711
```

2) Add a `launch.json` configuration (requires the Python extension):

```json
{
  "type": "python",
  "request": "launch",
  "name": "RDA (proxy)",
  "program": "${file}",
  "debugServer": 4711,
  "rda": {
    "mode": "guide",
    "autoSteps": 0
  }
}
```

RDA agent notes are emitted to the Debug Console via DAP `output` events.

## Custom DAP adapter

If you have another DAP adapter, you can run it via `--adapter`:

```bash
./runtime-debug-agent/bin/rda.js start \
  --adapter "python -m debugpy.adapter" \
  --type python \
  --request launch \
  --program path/to/app.py
```

## Notes

- This tool is intentionally minimal and CLI-first.
- It can be extended with more built-in adapters (Node, Go, etc.).
