"use strict";

const http = require("http");
const { WebSocketServer } = require("ws");

const defaultHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Runtime Debug Agent</title>
  <style>
    :root {
      --bg: #0b0f16;
      --panel: #111827;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-2: #fbbf24;
      --text: #e2e8f0;
      --border: #1f2937;
      --mono: "SFMono-Regular", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: "IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      background: radial-gradient(1200px 800px at 20% -10%, #132033 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    header h1 { font-size: 18px; margin: 0; letter-spacing: 0.5px; }
    header .status { color: var(--muted); font-size: 12px; }
    .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .btn {
      background: #0f172a;
      color: var(--text);
      border: 1px solid var(--border);
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
    }
    .btn:hover { border-color: var(--accent); color: var(--accent); }
    .field {
      background: #0b1220;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 8px;
      border-radius: 8px;
      font-size: 12px;
      width: 180px;
    }
    main {
      display: grid;
      grid-template-columns: 280px 1fr 320px;
      gap: 16px;
      padding: 16px;
    }
    .panel {
      background: color-mix(in srgb, var(--panel) 92%, #000 8%);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      overflow: hidden;
      min-height: 120px;
    }
    .panel h2 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 0 0 8px 0;
      color: var(--muted);
    }
    .list { font-family: var(--mono); font-size: 12px; line-height: 1.6; white-space: pre; }
    .output { font-family: var(--mono); font-size: 12px; height: 260px; overflow: auto; white-space: pre-wrap; }
    .explain { font-size: 13px; line-height: 1.5; }
    .chat-log {
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.5;
      background: #0b1220;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px;
      height: 160px;
      overflow: auto;
      white-space: pre-wrap;
    }
    .chat-row { display: flex; gap: 8px; margin-top: 8px; }
    .chat-input {
      flex: 1;
      background: #0b1220;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 8px;
      border-radius: 8px;
      font-size: 12px;
    }
    .tag { display: inline-block; padding: 2px 6px; border-radius: 6px; background: #0f172a; color: var(--accent); font-size: 11px; margin-left: 8px; }
    @media (max-width: 1100px) {
      main { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Runtime Debug Agent <span class="tag">DAP</span></h1>
    <div class="toolbar">
      <button class="btn" id="btn-step">Step In</button>
      <button class="btn" id="btn-next">Step Over</button>
      <button class="btn" id="btn-out">Step Out</button>
      <button class="btn" id="btn-cont">Continue</button>
      <input class="field" id="bp-add" placeholder="break: file.py:12" />
      <button class="btn" id="btn-bp-add">Add BP</button>
      <input class="field" id="bp-clear" placeholder="clear: file.py" />
      <button class="btn" id="btn-bp-clear">Clear BP</button>
    </div>
    <div class="status" id="status">connecting...</div>
  </header>
  <main>
    <section class="panel">
      <h2>Call Stack</h2>
      <div class="list" id="stack"></div>
    </section>
    <section class="panel">
      <h2>Variables</h2>
      <div class="list" id="vars"></div>
    </section>
    <section class="panel">
      <h2>Agent Explanation</h2>
      <div class="explain" id="explain">Waiting for a stop...</div>
      <h2 style="margin-top:16px;">Chat</h2>
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-row">
        <input class="chat-input" id="chat-input" placeholder="Ask about current state..." />
        <button class="btn" id="btn-chat-send">Send</button>
      </div>
      <h2 style="margin-top:16px;">Breakpoints</h2>
      <div class="list" id="breakpoints"></div>
      <h2 style="margin-top:16px;">Output</h2>
      <div class="output" id="output"></div>
    </section>
  </main>

  <script>
    const statusEl = document.getElementById('status');
    const stackEl = document.getElementById('stack');
    const varsEl = document.getElementById('vars');
    const outputEl = document.getElementById('output');
    const explainEl = document.getElementById('explain');
    const bpEl = document.getElementById('breakpoints');
    const chatLogEl = document.getElementById('chat-log');
    const chatInputEl = document.getElementById('chat-input');

    const ws = new WebSocket('ws://' + location.host);

    const send = (payload) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    document.getElementById('btn-step').addEventListener('click', () => {
      send({ type: 'action.request', action: 'step' });
    });
    document.getElementById('btn-next').addEventListener('click', () => {
      send({ type: 'action.request', action: 'next' });
    });
    document.getElementById('btn-out').addEventListener('click', () => {
      send({ type: 'action.request', action: 'out' });
    });
    document.getElementById('btn-cont').addEventListener('click', () => {
      send({ type: 'action.request', action: 'continue' });
    });
    document.getElementById('btn-bp-add').addEventListener('click', () => {
      const value = document.getElementById('bp-add').value.trim();
      if (!value) return;
      send({ type: 'break.add', value });
    });
    document.getElementById('btn-bp-clear').addEventListener('click', () => {
      const file = document.getElementById('bp-clear').value.trim();
      if (!file) return;
      send({ type: 'break.clear', file });
    });
    document.getElementById('btn-chat-send').addEventListener('click', () => {
      const text = chatInputEl.value.trim();
      if (!text) return;
      send({ type: 'chat.ask', text });
      appendChat('you: ' + text);
      chatInputEl.value = '';
    });
    chatInputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('btn-chat-send').click();
      }
    });

    ws.addEventListener('open', () => {
      statusEl.textContent = 'connected';
    });

    ws.addEventListener('close', () => {
      statusEl.textContent = 'disconnected';
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === 'state.update') {
        const state = msg.state || {};
        const frames = state.frames || [];
        stackEl.textContent = frames.map((f, i) => {
          const src = f.source && f.source.path ? f.source.path : '<unknown>';
          return '[' + i + '] ' + f.name + ' (' + src + ':' + (f.line || 0) + ')';
        }).join('\n');

        const scopes = state.scopes || [];
        const varsByScope = state.variablesByScope || {};
        const text = scopes.map((s) => {
          const vars = varsByScope[s.name] || [];
          const body = vars.slice(0, 12).map((v) => '  ' + v.name + ' = ' + v.value).join('\n');
          return s.name + ':\n' + body;
        }).join('\n\n');
        varsEl.textContent = text || 'No variables yet.';

        const outputs = state.outputs || [];
        outputEl.textContent = outputs.slice(-200).map((o) => o.output).join('');

        const bps = state.breakpoints || [];
        bpEl.textContent = bps.length
          ? bps.map((bp) => bp.path + ':' + bp.line).join('\\n')
          : 'No breakpoints.';
      }
      if (msg.type === 'agent.explain') {
        explainEl.textContent = msg.text || '';
      }
      if (msg.type === 'chat.answer') {
        appendChat('agent: ' + (msg.text || ''));
      }
    });

    function appendChat(line) {
      const current = chatLogEl.textContent || '';
      chatLogEl.textContent = current ? current + '\n' + line : line;
      chatLogEl.scrollTop = chatLogEl.scrollHeight;
    }
  </script>
</body>
</html>`;

async function createUiServer(options) {
  const opts = options || {};
  const port = Number.isFinite(opts.port) ? opts.port : 8789;
  const host = opts.host || "127.0.0.1";

  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(defaultHtml);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server });
  const clients = new Set();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("message", (data) => {
      if (!opts.onMessage) return;
      let msg;
      try {
        msg = JSON.parse(data.toString("utf8"));
      } catch (err) {
        return;
      }
      opts.onMessage(msg);
    });
    ws.on("close", () => clients.delete(ws));
  });

  const broadcast = (payload) => {
    const data = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  };

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const resolvedPort = address && typeof address === "object" ? address.port : port;
      const url = "http://" + host + ":" + resolvedPort;
      resolve({
        url,
        broadcast,
        close: () => {
          wss.close();
          server.close();
        }
      });
    });
  });
}

module.exports = {
  createUiServer
};
