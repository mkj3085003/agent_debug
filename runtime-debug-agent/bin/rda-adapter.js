#!/usr/bin/env node
"use strict";

const net = require("net");
const { spawn, spawnSync } = require("child_process");
const EventEmitter = require("events");
const { attachAgentLoop } = require("../lib/agentLoop");

function logStderr(message) {
  process.stderr.write(`${message}\n`);
}

function parseArgs(argv) {
  const opts = {
    host: "127.0.0.1",
    port: null,
    stdio: true,
    python: null,
    adapterCmd: null,
    trace: false,
    mode: "guide",
    autoSteps: 0
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      opts.port = Number(argv[++i]);
      opts.stdio = false;
    } else if (arg === "--host") {
      opts.host = argv[++i];
    } else if (arg === "--stdio") {
      opts.port = null;
      opts.stdio = true;
    } else if (arg === "--python") {
      opts.python = argv[++i];
    } else if (arg === "--adapter") {
      opts.adapterCmd = argv[++i];
    } else if (arg === "--trace") {
      opts.trace = true;
    } else if (arg === "--mode") {
      opts.mode = argv[++i] || opts.mode;
    } else if (arg === "--auto-steps") {
      const val = Number(argv[++i]);
      if (Number.isFinite(val)) opts.autoSteps = val;
    }
  }

  return opts;
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

class DapTransport {
  constructor(input, output, opts) {
    this.input = input;
    this.output = output;
    this.trace = Boolean(opts && opts.trace);
    this.name = (opts && opts.name) || "dap";
    this.seq = 1;
    this.pending = new Map();
    this.emitter = new EventEmitter();
    this.buffer = Buffer.alloc(0);

    input.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this._drain();
    });

    input.on("end", () => {
      this.emitter.emit("end");
    });

    input.on("error", (err) => {
      this.emitter.emit("error", err);
    });
  }

  _log(message, obj) {
    if (!this.trace) return;
    const payload = obj ? ` ${JSON.stringify(obj)}` : "";
    logStderr(`[${this.name}] ${message}${payload}`);
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
      } else {
        this.emitter.emit("response", msg);
      }
      return;
    }

    if (msg.type === "event") {
      this._log("<- event", msg);
      this.emitter.emit("event", msg);
      if (msg.event) this.emitter.emit(msg.event, msg);
      return;
    }

    if (msg.type === "request") {
      this._log("<- request", msg);
      this.emitter.emit("request", msg);
      return;
    }

    this._log("<- message", msg);
  }

  sendMessage(msg) {
    const payload = { ...msg };
    if (!payload.seq) payload.seq = this.seq++;
    const json = JSON.stringify(payload);
    const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
    this._log("-> message", payload);
    this.output.write(header + json, "utf8");
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
    this.output.write(header + json, "utf8");

    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
    });
  }
}

function applyRdaConfig(options, args) {
  if (!args || typeof args !== "object") return;
  const cfg = args.rda || args.__rda;
  if (!cfg || typeof cfg !== "object") return;
  if (cfg.mode) options.mode = cfg.mode;
  if (Number.isFinite(cfg.autoSteps)) options.autoSteps = cfg.autoSteps;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let upstream = null;
  let adapterProc = null;
  let agent = null;
  let client = null;
  let shuttingDown = false;

  const agentOptions = {
    mode: opts.mode,
    autoSteps: opts.autoSteps
  };

  function ensureUpstream() {
    if (upstream) return upstream;

    if (opts.adapterCmd) {
      adapterProc = spawn(opts.adapterCmd, {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        shell: true
      });
    } else {
      const py = resolvePythonExecutable(opts.python);
      adapterProc = spawn(py, ["-m", "debugpy.adapter"], {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"]
      });
    }

    adapterProc.stderr.on("data", (chunk) => {
      process.stderr.write(chunk.toString("utf8"));
    });

    adapterProc.on("exit", (code, signal) => {
      if (shuttingDown) return;
      logStderr(`Adapter exited (code=${code}, signal=${signal || "none"})`);
      shutdown(1);
    });

    upstream = new DapTransport(adapterProc.stdout, adapterProc.stdin, {
      trace: opts.trace,
      name: "upstream"
    });

    upstream.emitter.on("event", (event) => {
      if (!client) return;
      client.sendMessage({
        type: "event",
        event: event.event,
        body: event.body || {}
      });
    });

    upstream.emitter.on("request", async (req) => {
      if (!client) return;
      try {
        const resp = await client.request(req.command, req.arguments || {});
        upstream.sendMessage({
          type: "response",
          request_seq: req.seq,
          command: req.command,
          success: true,
          body: resp.body || {}
        });
      } catch (err) {
        upstream.sendMessage({
          type: "response",
          request_seq: req.seq,
          command: req.command,
          success: false,
          message: err.message || "DAP error",
          body: err.data || {}
        });
      }
    });

    return upstream;
  }

  function ensureAgent() {
    if (agent || !upstream) return;
    agent = attachAgentLoop(upstream, {
      mode: agentOptions.mode,
      autoSteps: agentOptions.autoSteps,
      onExplain: (text) => {
        if (!client) return;
        client.sendMessage({
          type: "event",
          event: "output",
          body: {
            category: "console",
            output: `${text}\n`
          }
        });
      }
    });
  }

  async function forwardRequest(req, overrideArgs) {
    const target = ensureUpstream();
    try {
      const resp = await target.request(req.command, overrideArgs || req.arguments || {});
      client.sendMessage({
        type: "response",
        request_seq: req.seq,
        command: req.command,
        success: true,
        body: resp.body || {}
      });
    } catch (err) {
      client.sendMessage({
        type: "response",
        request_seq: req.seq,
        command: req.command,
        success: false,
        message: err.message || "DAP error",
        body: err.data || {}
      });
    }
  }

  async function handleClientRequest(req) {
    if (!req || !req.command) return;

    if (req.command === "initialize") {
      const args = { ...(req.arguments || {}) };
      if (args.adapterID === "rda") args.adapterID = "python";
      await forwardRequest(req, args);
      return;
    }

    if (req.command === "launch" || req.command === "attach") {
      applyRdaConfig(agentOptions, req.arguments);
      ensureUpstream();
      ensureAgent();
      await forwardRequest(req, req.arguments || {});
      return;
    }

    if (req.command === "setBreakpoints" && agent && req.arguments) {
      const src = req.arguments.source && req.arguments.source.path;
      const lines = (req.arguments.breakpoints || []).map((bp) => bp.line).filter(Boolean);
      if (src && lines.length) {
        const existing = agent.state.breakpoints || [];
        const remaining = existing.filter((bp) => bp.path !== src);
        const next = remaining.concat(lines.map((line) => ({ path: src, line })));
        agent.state.breakpoints = next;
      }
      await forwardRequest(req, req.arguments || {});
      return;
    }

    if (req.command === "disconnect") {
      await forwardRequest(req, req.arguments || {});
      shutdown(0);
      return;
    }

    await forwardRequest(req, req.arguments || {});
  }

  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      if (adapterProc) adapterProc.kill();
    } catch (err) {
      // ignore
    }
    process.exit(code || 0);
  }

  function attachClient(input, output) {
    client = new DapTransport(input, output, { trace: opts.trace, name: "client" });
    client.emitter.on("request", (req) => {
      handleClientRequest(req).catch((err) => {
        client.sendMessage({
          type: "response",
          request_seq: req.seq,
          command: req.command,
          success: false,
          message: err.message || "Internal error"
        });
      });
    });
    client.emitter.on("end", () => shutdown(0));
    client.emitter.on("error", () => shutdown(1));
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("uncaughtException", (err) => {
    logStderr(err.stack || err.message || String(err));
    shutdown(1);
  });

  if (opts.port) {
    const server = net.createServer((socket) => {
      server.close();
      attachClient(socket, socket);
    });
    server.listen(opts.port, opts.host, () => {
      logStderr(`RDA adapter listening on ${opts.host}:${opts.port}`);
    });
  } else {
    if (process.stdin.isTTY) {
      logStderr("RDA adapter started in stdio mode (no TTY). Use --port for server mode.");
    }
    process.stdin.resume();
    attachClient(process.stdin, process.stdout);
  }
}

main().catch((err) => {
  logStderr(err.stack || err.message || String(err));
  process.exit(1);
});
