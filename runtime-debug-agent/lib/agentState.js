"use strict";

function createDebugState(options) {
  const opts = options || {};
  return {
    sessionId: opts.sessionId || `dbg_${Date.now()}`,
    mode: opts.mode || "guide",
    status: "starting",
    lastStopped: null,
    threads: [],
    frames: [],
    currentFrameId: null,
    scopes: [],
    variablesByScope: {},
    outputs: [],
    stepCounter: 0,
    autoStepsRemaining: Number.isFinite(opts.autoSteps) ? opts.autoSteps : 0,
    breakpoints: Array.isArray(opts.breakpoints) ? opts.breakpoints.slice() : []
  };
}

function updateOutput(state, event) {
  const body = event && event.body ? event.body : {};
  const entry = {
    ts: Date.now(),
    category: body.category || "output",
    output: body.output || ""
  };
  state.outputs.push(entry);
}

function updateStopped(state, event) {
  const body = event && event.body ? event.body : {};
  state.status = "stopped";
  state.lastStopped = {
    reason: body.reason || "stopped",
    threadId: body.threadId || null,
    description: body.description || "",
    text: body.text || ""
  };
}

function updateRunning(state) {
  state.status = "running";
}

function updateTerminated(state) {
  state.status = "terminated";
}

module.exports = {
  createDebugState,
  updateOutput,
  updateStopped,
  updateRunning,
  updateTerminated
};
