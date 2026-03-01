"use strict";

const {
  createDebugState,
  updateOutput,
  updateStopped,
  updateRunning,
  updateTerminated
} = require("./agentState");

function attachAgentLoop(client, options) {
  const opts = options || {};
  const state = createDebugState(opts);
  let busy = false;
  const listeners = [];

  const on = (event, handler) => {
    client.emitter.on(event, handler);
    listeners.push([event, handler]);
  };

  on("output", (event) => {
    updateOutput(state, event);
    if (opts.onStateChange) opts.onStateChange(state);
  });

  on("continued", () => {
    updateRunning(state);
    if (opts.onStateChange) opts.onStateChange(state);
  });

  on("terminated", () => {
    updateTerminated(state);
    if (opts.onStateChange) opts.onStateChange(state);
  });

  on("exited", () => {
    updateTerminated(state);
    if (opts.onStateChange) opts.onStateChange(state);
  });

  on("stopped", async (event) => {
    updateStopped(state, event);
    if (busy) return;
    busy = true;
    try {
      await refreshStateFromStop(client, state, event);
      const explanation = defaultExplain(state);
      if (explanation && opts.onExplain) {
        opts.onExplain(explanation, state);
      }
      if (opts.onStateChange) opts.onStateChange(state);
      const action = defaultPolicyDecision(state, opts);
      if (action) {
        await client.request(action.command, action.arguments || {});
      }
    } finally {
      busy = false;
    }
  });

  return {
    state,
    dispose() {
      for (const [event, handler] of listeners) {
        client.emitter.removeListener(event, handler);
      }
    }
  };
}

async function refreshStateFromStop(client, state, event) {
  const threadId =
    (event && event.body && event.body.threadId) ||
    (state.lastStopped && state.lastStopped.threadId) ||
    null;

  const threadsResp = await client.request("threads", {});
  state.threads = (threadsResp.body && threadsResp.body.threads) || [];

  const resolvedThreadId = threadId || (state.threads[0] ? state.threads[0].id : null);
  if (!resolvedThreadId) {
    state.frames = [];
    state.currentFrameId = null;
    state.scopes = [];
    state.variablesByScope = {};
    return;
  }

  const stackResp = await client.request("stackTrace", {
    threadId: resolvedThreadId,
    startFrame: 0,
    levels: 20
  });
  state.frames = (stackResp.body && stackResp.body.stackFrames) || [];
  state.currentFrameId = state.frames[0] ? state.frames[0].id : null;
  if (state.lastStopped) state.lastStopped.threadId = resolvedThreadId;

  if (!state.currentFrameId) {
    state.scopes = [];
    state.variablesByScope = {};
    return;
  }

  const scopesResp = await client.request("scopes", { frameId: state.currentFrameId });
  state.scopes = (scopesResp.body && scopesResp.body.scopes) || [];

  const varsByScope = {};
  for (const scope of state.scopes) {
    const varsResp = await client.request("variables", {
      variablesReference: scope.variablesReference
    });
    varsByScope[scope.name] = (varsResp.body && varsResp.body.variables) || [];
  }
  state.variablesByScope = varsByScope;
}

function defaultExplain(state) {
  const stop = state.lastStopped || { reason: "stopped" };
  const frame = state.frames[0];
  const location = frame
    ? `${frame.source && frame.source.path ? frame.source.path : "<unknown>"}:${frame.line}`
    : "<unknown>";
  const fn = frame ? frame.name : "<unknown>";

  const scopeNames = state.scopes.map((s) => s.name).join(", ");
  const vars = state.variablesByScope;
  const firstScope = state.scopes[0] ? vars[state.scopes[0].name] || [] : [];
  const sampleVars = firstScope.slice(0, 5).map((v) => `${v.name}=${v.value}`);

  let msg = `agent: stopped (${stop.reason}) at ${location} in ${fn}`;
  if (scopeNames) msg += ` | scopes: ${scopeNames}`;
  if (sampleVars.length) msg += ` | vars: ${sampleVars.join(", ")}`;
  msg += "";
  return msg;
}

function defaultPolicyDecision(state, opts) {
  const mode = opts.mode || "guide";
  if (mode === "auto") {
    if (state.autoStepsRemaining > 0) {
      state.autoStepsRemaining -= 1;
      const threadId = state.lastStopped && state.lastStopped.threadId;
      if (!threadId) return null;
      return { command: "next", arguments: { threadId } };
    }
    return null;
  }
  return null;
}

module.exports = {
  attachAgentLoop
};
