#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const readline = require("readline");
const { EventEmitter } = require("events");
const { attachAgentLoop } = require("../lib/agentLoop");
const { createUiServer } = require("../lib/uiServer");
const { answerQuestion } = require("../lib/agentChat");

function showHelp() {
  const text = `Runtime Debug Agent (RDA)

Usage:
  rda start [options] -- [program args]

Options:
  --lang, -l <lang>           Language (python supported)
  --program, -p <file>        Program path
  --module <name>             Python module to run (python only)
  --cwd <dir>                 Working directory (default: cwd)
  --env <K=V>                 Environment variable (repeatable)
  --break, -b <file:line>     Breakpoint (repeatable)
  --stop-on-entry             Stop on entry
  --request <launch|attach>   DAP request type (default: launch)
  --type <dap-type>           DAP type (default: python for --lang python)
  --adapter <command>         Custom DAP adapter command
  --python <path>             Python executable for debugpy
  --config <file>             JSON file with launch/attach args
  --trace                     Print raw DAP messages
  --agent-mode <mode>         Agent mode: guide|auto|breakpoint (default: guide)
  --auto-steps <n>            Auto step N times (agent mode auto)
  --ui                        Start web panel UI
  --ui-port <port>            UI port (default: 8789)
  --ui-host <host>            UI host (default: 127.0.0.1)
  --help                      Show help

Examples:
  rda start --lang python --program app.py -- --foo bar
  rda start --lang python --module mypkg.cli -- --foo bar
  rda start --adapter "python -m debugpy.adapter" --type python --program app.py
`;
  console.log(text);
}

function parseArgs(argv) {
  let args = argv.slice();
  let programArgs = [];
  const sep = args.indexOf("--");
  if (sep !== -1) {
    programArgs = args.slice(sep + 1);
    args = args.slice(0, sep);
  }

  let command = "start";
  if (args[0] && !args[0].startsWith("-")) {
    command = args[0];
    args = args.slice(1);
  }

  const opts = {
    lang: null,
    program: null,
    module: null,
    cwd: null,
    env: {},
    breakpoints: [],
    stopOnEntry: false,
    request: "launch",
    type: null,
    adapterCmd: null,
    python: null,
    configPath: null,
    trace: false,
    agentMode: "guide",
    autoSteps: 0,
    ui: false,
    uiPort: 8789,
    uiHost: "127.0.0.1"
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      opts.help = true;
      continue;
    }
    if (a === "--lang" || a === "-l") {
      opts.lang = args[++i];
      continue;
    }
    if (a === "--program" || a === "-p") {
      opts.program = args[++i];
      continue;
    }
    if (a === "--module") {
      opts.module = args[++i];
      continue;
    }
    if (a === "--cwd") {
      opts.cwd = args[++i];
      continue;
    }
    if (a === "--env") {
      const pair = args[++i] || "";
      const idx = pair.indexOf("=");
      if (idx === -1) {
        throw new Error(`Invalid --env value: ${pair}`);
      }
      const key = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      opts.env[key] = value;
      continue;
    }
    if (a === "--break" || a === "-b") {
      opts.breakpoints.push(args[++i]);
      continue;
    }
    if (a === "--stop-on-entry") {
      opts.stopOnEntry = true;
      continue;
    }
    if (a === "--request") {
      opts.request = args[++i];
      continue;
    }
    if (a === "--type") {
      opts.type = args[++i];
      continue;
    }
    if (a === "--adapter") {
      opts.adapterCmd = args[++i];
      continue;
    }
    if (a === "--python") {
      opts.python = args[++i];
      continue;
    }
    if (a === "--config") {
      opts.configPath = args[++i];
      continue;
    }
    if (a === "--trace") {
      opts.trace = true;
      continue;
    }
    if (a === "--agent-mode") {
      opts.agentMode = args[++i];
      continue;
    }
    if (a === "--auto-steps") {
      const value = Number(args[++i]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("Invalid --auto-steps value");
      }
      opts.autoSteps = value;
      continue;
    }
    if (a === "--ui") {
      opts.ui = true;
      continue;
    }
    if (a === "--ui-port") {
      const value = Number(args[++i]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Invalid --ui-port value");
      }
      opts.uiPort = value;
      continue;
    }
    if (a === "--ui-host") {
      opts.uiHost = args[++i];
      continue;
    }
    throw new Error(`Unknown arg: ${a}`);
  }

  return { command, opts, programArgs };
}

function detectLanguage(cwd) {
  const checks = [
    { lang: "python", files: ["pyproject.toml", "requirements.txt", "setup.py"] },
    { lang: "node", files: ["package.json"] },
    { lang: "go", files: ["go.mod"] },
    { lang: "rust", files: ["Cargo.toml"] }
  ];
  for (const item of checks) {
    for (const file of item.files) {
      if (fs.existsSync(path.join(cwd, file))) {
        return item.lang;
      }
    }
  }
  return null;
}

function resolvePythonExecutable(explicit) {
  if (explicit) return explicit;
  if (process.env.PYTHON) return process.env.PYTHON;
  const check = (cmd) => {
    const res = spawnSync(cmd, ["-c", "import sys; print(sys.executable)"]);
    return res.status === 0;
  };
  if (check("python3")) return "python3";
  if (check("python")) return "python";
  return "python";
}

class DapClient {
  constructor(proc, opts) {
    this.proc = proc;
    this.trace = Boolean(opts && opts.trace);
    this.seq = 1;
    this.pending = new Map();
    this.emitter = new EventEmitter();
    this.lastEventByType = new Map();
    this.buffer = Buffer.alloc(0);

    proc.stdout.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this._drain();
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      process.stderr.write(text);
    });

    proc.on("exit", (code, signal) => {
      if (code !== 0) {
        console.error(`\nAdapter exited (code=${code}, signal=${signal || "none"})`);
      }
      this.emitter.emit("adapter.exit", { code, signal });
    });
  }

  _log(msg, obj) {
    if (!this.trace) return;
    const payload = obj ? ` ${JSON.stringify(obj)}` : "";
    console.log(`[dap] ${msg}${payload}`);
  }

  _drain() {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length: (\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const total = headerEnd + 4 + length;
      if (this.buffer.length < total) return;
      const body = this.buffer.slice(headerEnd + 4, total).toString("utf8");
      this.buffer = this.buffer.slice(total);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch (err) {
        this._log("invalid-json", { body });
        continue;
      }
      this._handleMessage(msg);
    }
  }

  _handleMessage(msg) {
    if (msg.type === "response") {
      this._log("<- response", msg);
      const pending = this.pending.get(msg.request_seq);
      if (pending) {
        this.pending.delete(msg.request_seq);
        if (msg.success === false) {
          const error = new Error(msg.message || "DAP error");
          error.data = msg.body;
          pending.reject(error);
        } else {
          pending.resolve(msg);
        }
      }
      return;
    }

    if (msg.type === "event") {
      this._log("<- event", msg);
      this.lastEventByType.set(msg.event, msg);
      this.emitter.emit(msg.event, msg);
      return;
    }

    this._log("<- message", msg);
  }

  request(command, args) {
    const seq = this.seq++;
    const payload = {
      seq,
      type: "request",
      command,
      arguments: args || {}
    };
    this._log("-> request", payload);

    const json = JSON.stringify(payload);
    const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
    this.proc.stdin.write(header + json, "utf8");

    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
    });
  }

  waitForEvent(event, timeoutMs) {
    if (this.lastEventByType.has(event)) {
      return Promise.resolve(this.lastEventByType.get(event));
    }
    return new Promise((resolve, reject) => {
      const handler = (msg) => {
        clearTimeout(timer);
        resolve(msg);
      };
      const timer = timeoutMs
        ? setTimeout(() => {
            this.emitter.removeListener(event, handler);
            reject(new Error(`Timeout waiting for event: ${event}`));
          }, timeoutMs)
        : null;
      this.emitter.once(event, handler);
    });
  }
}

function parseBreakpoint(raw, cwd) {
  const idx = raw.lastIndexOf(":");
  if (idx <= 0) {
    throw new Error(`Invalid breakpoint: ${raw}`);
  }
  const file = raw.slice(0, idx);
  const lineStr = raw.slice(idx + 1);
  const line = Number(lineStr);
  if (!Number.isFinite(line) || line <= 0) {
    throw new Error(`Invalid breakpoint line: ${raw}`);
  }
  const absPath = path.isAbsolute(file) ? file : path.join(cwd, file);
  return { path: absPath, line };
}

function groupBreakpoints(bps) {
  const map = new Map();
  for (const bp of bps) {
    const list = map.get(bp.path) || [];
    list.push(bp.line);
    map.set(bp.path, list);
  }
  return map;
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, "utf8");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object") {
    throw new Error("Invalid config JSON");
  }
  return data;
}

function normalizeEnv(base, overrides) {
  const env = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    env[key] = value;
  }
  return env;
}

function buildLaunchArgs({ lang, opts, cwd, programArgs, config }) {
  const launchArgs = { ...config };
  launchArgs.request = opts.request || launchArgs.request || "launch";
  launchArgs.type = opts.type || launchArgs.type || (lang === "python" ? "python" : lang);
  launchArgs.name = launchArgs.name || "runtime-debug-agent";
  launchArgs.cwd = opts.cwd ? cwd : launchArgs.cwd || cwd;

  if (opts.program) {
    const absProgram = path.isAbsolute(opts.program)
      ? opts.program
      : path.join(cwd, opts.program);
    launchArgs.program = absProgram;
  }
  if (opts.module) {
    launchArgs.module = opts.module;
  }

  if (programArgs.length) {
    launchArgs.args = programArgs;
  }
  if (opts.stopOnEntry) {
    launchArgs.stopOnEntry = true;
  }

  launchArgs.env = normalizeEnv(launchArgs.env || {}, opts.env);
  return launchArgs;
}

async function main() {
  const { command, opts, programArgs } = parseArgs(process.argv.slice(2));
  if (opts.help || command !== "start") {
    showHelp();
    process.exit(0);
  }

  const cwd = path.resolve(opts.cwd || process.cwd());
  let lang = opts.lang || detectLanguage(cwd);
  if (!lang) {
    console.error("Could not detect language. Use --lang to specify.");
    process.exit(1);
  }

  if (lang !== "python" && !opts.adapterCmd) {
    console.error(`Language '${lang}' is not built-in yet. Provide --adapter and --type.`);
    process.exit(1);
  }

  const config = opts.configPath ? loadConfig(opts.configPath) : {};

  let adapterProc;
  if (opts.adapterCmd) {
    adapterProc = spawn(opts.adapterCmd, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true
    });
  } else if (lang === "python") {
    const py = resolvePythonExecutable(opts.python);
    adapterProc = spawn(py, ["-m", "debugpy.adapter"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
  }

  if (!adapterProc) {
    console.error("Failed to start adapter process.");
    process.exit(1);
  }

  const client = new DapClient(adapterProc, { trace: opts.trace });
  const initialBreakpoints = [];
  for (const raw of opts.breakpoints) {
    initialBreakpoints.push(parseBreakpoint(raw, cwd));
  }

  let agent = null;
  let cliState = null;
  const syncBreakpointsToAgent = (bps) => {
    if (!agent) return;
    agent.state.breakpoints = bps.slice();
    if (uiServer) uiServer.broadcast({ type: "state.update", state: agent.state });
  };
  const syncBreakpointsToCli = (bps) => {
    if (!cliState) return;
    cliState.breakpoints = bps.slice();
  };
  const handleUiMessage = async (msg) => {
    if (!msg || !agent) return;
    const state = agent.state;
    if (msg.type === "action.request") {
      const action = msg.action;
      const map = {
        step: "stepIn",
        next: "next",
        out: "stepOut",
        continue: "continue"
      };
      const command = map[action];
      if (!command) return;
      const threadId =
        (state.lastStopped && state.lastStopped.threadId) ||
        (state.threads[0] ? state.threads[0].id : null);
      if (!threadId) {
        console.warn("No thread available for action.");
        return;
      }
      await client.request(command, { threadId });
      return;
    }
    if (msg.type === "break.add") {
      const raw = String(msg.value || "").trim();
      if (!raw) return;
      const bp = parseBreakpoint(raw, cwd);
      state.breakpoints = state.breakpoints || [];
      state.breakpoints.push(bp);
      const lines = state.breakpoints
        .filter((item) => item.path === bp.path)
        .map((item) => item.line);
      await client.request("setBreakpoints", {
        source: { path: bp.path },
        breakpoints: lines.map((line) => ({ line }))
      });
      if (uiServer) uiServer.broadcast({ type: "state.update", state });
      syncBreakpointsToCli(state.breakpoints);
      return;
    }
    if (msg.type === "break.clear") {
      const rawFile = String(msg.file || "").trim();
      if (!rawFile) return;
      const filePath = path.isAbsolute(rawFile) ? rawFile : path.join(cwd, rawFile);
      await client.request("setBreakpoints", {
        source: { path: filePath },
        breakpoints: []
      });
      if (state.breakpoints) {
        state.breakpoints = state.breakpoints.filter((bp) => bp.path !== filePath);
      }
      if (uiServer) uiServer.broadcast({ type: "state.update", state });
      syncBreakpointsToCli(state.breakpoints || []);
      return;
    }
    if (msg.type === "chat.ask") {
      const question = String(msg.text || "").trim();
      if (!question) return;
      const answer = answerQuestion(state, question);
      if (uiServer) uiServer.broadcast({ type: "chat.answer", text: answer });
    }
  };

  let uiServer = null;
  if (opts.ui) {
    uiServer = await createUiServer({
      port: opts.uiPort,
      host: opts.uiHost,
      onMessage: (msg) => {
        handleUiMessage(msg).catch((err) => {
          console.warn(`UI message error: ${err.message}`);
        });
      }
    });
    console.log(`UI: ${uiServer.url}`);
  }

  agent = attachAgentLoop(client, {
    mode: opts.agentMode,
    autoSteps: opts.autoSteps,
    breakpoints: initialBreakpoints,
    onExplain: (text, state) => {
      console.log(text);
      if (uiServer) uiServer.broadcast({ type: "agent.explain", text, state });
    },
    onStateChange: (state) => {
      if (uiServer) uiServer.broadcast({ type: "state.update", state });
    }
  });
  if (uiServer) uiServer.broadcast({ type: "state.update", state: agent.state });

  client.emitter.on("output", (event) => {
    if (event && event.body && event.body.output) {
      process.stdout.write(event.body.output);
    }
  });

  client.emitter.on("terminated", () => {
    console.log("\nTarget terminated.");
    process.exit(0);
  });

  client.emitter.on("exited", (event) => {
    const code = event && event.body ? event.body.exitCode : 0;
    console.log(`\nTarget exited with code ${code}.`);
  });

  let supportsConfigDone = false;
  try {
    const initResp = await client.request("initialize", {
      adapterID: lang,
      clientID: "runtime-debug-agent",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: false
    });
    supportsConfigDone = Boolean(
      initResp.body && initResp.body.supportsConfigurationDoneRequest
    );
  } catch (err) {
    console.error(`Initialize failed: ${err.message}`);
    process.exit(1);
  }

  try {
    await client.waitForEvent("initialized", 2000);
  } catch (err) {
    // Some adapters skip initialized event; proceed.
  }

  const launchArgs = buildLaunchArgs({ lang, opts, cwd, programArgs, config });
  if (lang === "python" && !launchArgs.program && !launchArgs.module) {
    console.error("Python launch requires --program or --module.");
    process.exit(1);
  }

  try {
    await client.request(launchArgs.request, launchArgs);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg.includes("No module named debugpy")) {
      console.error("debugpy is not installed. Run: python -m pip install debugpy");
    }
    console.error(`Launch failed: ${msg}`);
    process.exit(1);
  }

  const breakpoints = initialBreakpoints;
  const bpByFile = groupBreakpoints(breakpoints);
  for (const [filePath, lines] of bpByFile.entries()) {
    await client.request("setBreakpoints", {
      source: { path: filePath },
      breakpoints: lines.map((line) => ({ line }))
    });
  }

  if (supportsConfigDone) {
    await client.request("configurationDone", {});
  }

  const state = {
    lastStoppedThreadId: null,
    currentFrameId: null,
    currentScopes: [],
    breakpoints: breakpoints.slice()
  };
  cliState = state;

  client.emitter.on("stopped", async (event) => {
    const reason = event.body && event.body.reason ? event.body.reason : "stopped";
    const threadId = event.body && event.body.threadId ? event.body.threadId : null;
    state.lastStoppedThreadId = threadId;
    state.currentFrameId = null;
    state.currentScopes = [];
    console.log(`\nStopped: ${reason}${threadId ? ` (thread ${threadId})` : ""}`);
    rl.prompt();
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "debug> "
  });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    const [cmd, ...rest] = trimmed.split(" ");
    const arg = rest.join(" ").trim();

    try {
      if (cmd === "help" || cmd === "?") {
        console.log(
          "Commands: help, next|n, step|s, out|o, cont|c, pause, bt, scopes, vars, eval <expr>, break add <file:line>, break clear <file>, break list, threads, frame <n>, quit"
        );
      } else if (cmd === "next" || cmd === "n") {
        await stepCommand(client, state, "next");
      } else if (cmd === "step" || cmd === "s") {
        await stepCommand(client, state, "stepIn");
      } else if (cmd === "out" || cmd === "o") {
        await stepCommand(client, state, "stepOut");
      } else if (cmd === "cont" || cmd === "c" || cmd === "continue") {
        await stepCommand(client, state, "continue");
      } else if (cmd === "pause") {
        await stepCommand(client, state, "pause");
      } else if (cmd === "bt") {
        await stackTrace(client, state);
      } else if (cmd === "scopes") {
        await listScopes(client, state);
      } else if (cmd === "vars") {
        await listVariables(client, state, arg);
      } else if (cmd === "eval") {
        await evaluateExpr(client, state, arg);
      } else if (cmd === "threads") {
        await listThreads(client, state);
      } else if (cmd === "frame") {
        await selectFrame(client, state, arg);
      } else if (cmd === "break") {
        await handleBreakCommand(client, state, arg, cwd, (bps) => {
          syncBreakpointsToAgent(bps);
        });
      } else if (cmd === "quit" || cmd === "exit") {
        rl.close();
        await client.request("disconnect", { terminateDebuggee: true });
        process.exit(0);
      } else {
        console.log(`Unknown command: ${cmd}`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    try {
      await client.request("disconnect", { terminateDebuggee: true });
    } catch (err) {
      // ignore
    }
    if (uiServer) uiServer.close();
    process.exit(0);
  });

  rl.prompt();
}

async function stepCommand(client, state, command) {
  const threadId = state.lastStoppedThreadId;
  if (!threadId) {
    console.log("No stopped thread. Wait for a breakpoint or use 'threads'.");
    return;
  }
  await client.request(command, { threadId });
}

async function stackTrace(client, state) {
  const threadId = state.lastStoppedThreadId;
  if (!threadId) {
    console.log("No stopped thread.");
    return;
  }
  const resp = await client.request("stackTrace", { threadId, startFrame: 0, levels: 20 });
  const frames = (resp.body && resp.body.stackFrames) || [];
  if (!frames.length) {
    console.log("No frames.");
    return;
  }
  state.currentFrameId = frames[0].id;
  console.log("Stack:");
  frames.forEach((frame, idx) => {
    const src = frame.source && frame.source.path ? frame.source.path : "<unknown>";
    const line = frame.line || 0;
    console.log(`  [${idx}] ${frame.name} (${src}:${line})`);
  });
}

async function listScopes(client, state) {
  if (!state.currentFrameId) {
    console.log("No selected frame. Run 'bt' or 'frame <n>'.");
    return;
  }
  const resp = await client.request("scopes", { frameId: state.currentFrameId });
  const scopes = (resp.body && resp.body.scopes) || [];
  state.currentScopes = scopes;
  if (!scopes.length) {
    console.log("No scopes.");
    return;
  }
  console.log("Scopes:");
  scopes.forEach((scope, idx) => {
    console.log(`  [${idx}] ${scope.name}`);
  });
}

async function listVariables(client, state, arg) {
  if (!state.currentScopes.length) {
    console.log("No scopes. Run 'scopes' first.");
    return;
  }
  let scopeIndex = 0;
  if (arg) {
    const parsed = Number(arg);
    if (Number.isFinite(parsed)) scopeIndex = parsed;
  }
  const scope = state.currentScopes[scopeIndex];
  if (!scope) {
    console.log("Invalid scope index.");
    return;
  }
  const resp = await client.request("variables", { variablesReference: scope.variablesReference });
  const vars = (resp.body && resp.body.variables) || [];
  if (!vars.length) {
    console.log("No variables.");
    return;
  }
  console.log(`Variables (${scope.name}):`);
  vars.forEach((v) => {
    console.log(`  ${v.name}: ${v.value}`);
  });
}

async function evaluateExpr(client, state, expr) {
  if (!expr) {
    console.log("Usage: eval <expr>");
    return;
  }
  if (!state.currentFrameId) {
    console.log("No selected frame. Run 'bt' or 'frame <n>'.");
    return;
  }
  const resp = await client.request("evaluate", {
    expression: expr,
    frameId: state.currentFrameId,
    context: "repl"
  });
  const result = resp.body && resp.body.result ? resp.body.result : "";
  console.log(result);
}

async function listThreads(client, state) {
  const resp = await client.request("threads", {});
  const threads = (resp.body && resp.body.threads) || [];
  if (!threads.length) {
    console.log("No threads.");
    return;
  }
  console.log("Threads:");
  threads.forEach((t) => {
    console.log(`  ${t.id}: ${t.name}`);
  });
  if (!state.lastStoppedThreadId) {
    state.lastStoppedThreadId = threads[0].id;
  }
}

async function selectFrame(client, state, arg) {
  if (!arg) {
    console.log("Usage: frame <index>");
    return;
  }
  const idx = Number(arg);
  if (!Number.isFinite(idx)) {
    console.log("Invalid frame index.");
    return;
  }
  const threadId = state.lastStoppedThreadId;
  if (!threadId) {
    console.log("No stopped thread.");
    return;
  }
  const resp = await client.request("stackTrace", { threadId, startFrame: 0, levels: 20 });
  const frames = (resp.body && resp.body.stackFrames) || [];
  const frame = frames[idx];
  if (!frame) {
    console.log("Invalid frame index.");
    return;
  }
  state.currentFrameId = frame.id;
  console.log(`Selected frame [${idx}] ${frame.name}`);
}

async function handleBreakCommand(client, state, arg, cwd, onBreakpointsChanged) {
  if (!arg) {
    console.log("Usage: break add <file:line> | break clear <file> | break list");
    return;
  }
  if (arg === "list") {
    if (!state.breakpoints || state.breakpoints.length === 0) {
      console.log("No breakpoints.");
      return;
    }
    state.breakpoints.forEach((bp) => {
      console.log(`${bp.path}:${bp.line}`);
    });
    return;
  }
  const [action, rest] = arg.split(" ");
  if (action === "add") {
    if (!rest) {
      console.log("Usage: break add <file:line>");
      return;
    }
    const bp = parseBreakpoint(rest, cwd);
    state.breakpoints = state.breakpoints || [];
    state.breakpoints.push(bp);
    const filePath = bp.path;
    const lines = state.breakpoints
      .filter((item) => item.path === filePath)
      .map((item) => item.line);
    await client.request("setBreakpoints", {
      source: { path: filePath },
      breakpoints: lines.map((line) => ({ line }))
    });
    console.log(`Added breakpoint ${bp.path}:${bp.line}`);
    if (onBreakpointsChanged) {
      onBreakpointsChanged(state.breakpoints || []);
    }
    return;
  }
  if (action === "clear") {
    if (!rest) {
      console.log("Usage: break clear <file>");
      return;
    }
    const filePath = path.isAbsolute(rest) ? rest : path.join(cwd, rest);
    await client.request("setBreakpoints", {
      source: { path: filePath },
      breakpoints: []
    });
    if (state.breakpoints) {
      state.breakpoints = state.breakpoints.filter((bp) => bp.path !== filePath);
    }
    console.log(`Cleared breakpoints for ${filePath}`);
    if (onBreakpointsChanged) {
      onBreakpointsChanged(state.breakpoints || []);
    }
    return;
  }
  console.log("Unknown break command.");
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
