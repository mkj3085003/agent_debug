"use strict";

function answerQuestion(state, question) {
  const text = String(question || "").trim();
  if (!text) return "No question provided.";
  const lower = text.toLowerCase();

  if (includesAny(lower, ["where", "location", "current", "当前位置", "哪儿", "在哪"])) {
    return describeLocation(state);
  }

  if (includesAny(lower, ["variable", "vars", "变量", "值", "value"])) {
    return describeVariables(state);
  }

  if (includesAny(lower, ["stack", "call", "trace", "调用", "路径"])) {
    return describeStack(state);
  }

  if (includesAny(lower, ["why", "原因", "为什么"])) {
    return describeReason(state);
  }

  return defaultSummary(state);
}

function includesAny(text, tokens) {
  for (const token of tokens) {
    if (text.includes(token)) return true;
  }
  return false;
}

function describeLocation(state) {
  const frame = state.frames && state.frames[0];
  if (!frame) return "No current frame available.";
  const source = frame.source && frame.source.path ? frame.source.path : "<unknown>";
  const line = frame.line || 0;
  return `Currently at ${source}:${line} in ${frame.name || "<unknown>"}.`;
}

function describeVariables(state) {
  const scopes = state.scopes || [];
  if (!scopes.length) return "No scopes/variables available yet.";
  const varsByScope = state.variablesByScope || {};
  const firstScope = scopes[0];
  const vars = varsByScope[firstScope.name] || [];
  if (!vars.length) return `No variables in scope ${firstScope.name}.`;
  const sample = vars.slice(0, 8).map((v) => `${v.name}=${v.value}`).join(", ");
  return `Variables (${firstScope.name}): ${sample}.`;
}

function describeStack(state) {
  const frames = state.frames || [];
  if (!frames.length) return "No stack frames available.";
  const list = frames.slice(0, 5).map((f, i) => {
    const src = f.source && f.source.path ? f.source.path : "<unknown>";
    return `[${i}] ${f.name} (${src}:${f.line || 0})`;
  });
  return `Top stack frames:\n${list.join("\n")}`;
}

function describeReason(state) {
  const stop = state.lastStopped || {};
  if (stop.reason) {
    return `Stopped because: ${stop.reason}.`;
  }
  return "Stop reason not available.";
}

function defaultSummary(state) {
  const parts = [describeLocation(state)];
  const reason = describeReason(state);
  if (reason) parts.push(reason);
  return parts.join(" ");
}

module.exports = {
  answerQuestion
};
