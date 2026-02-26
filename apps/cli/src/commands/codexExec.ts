import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { DiffEngine } from "@agent-debug/diff-engine";
import { Recorder } from "@agent-debug/recorder";
import { makeCallId } from "@agent-debug/shared";
import { writeDiffBlob, writeSnapshotBlob } from "@agent-debug/store";
import { decideRecording } from "./recordingStrategy.js";

interface CodexExecOptions {
  root: string;
  cwd?: string;
  session?: string;
  ignoreCmd?: string[];
  onlyCmd?: string[];
  importantCmd?: string[];
}

export async function codexExecCommand(args: string[], options: CodexExecOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const commandArgs = ["exec", "--json", ...args];
  const recorder = new Recorder({
    rootDir: options.root,
    sessionId: options.session,
    meta: {
      cwd,
      pid: process.pid,
      agent: "codex"
    }
  });

  type PromptCandidate = {
    index: number;
    text?: string;
    file?: string;
    source: string;
    sourceDetail?: string;
  };

  const extractPromptFromArgs = async (
    rawArgs: string[]
  ): Promise<{ text: string; source: string; sourceDetail?: string } | null> => {
    if (!rawArgs.length) {
      return null;
    }

    const promptFlags = new Set(["--prompt", "-p"]);
    const promptFileFlags = new Set(["--prompt-file", "--input-file"]);
    const valueFlags = new Set([
      "--model",
      "-m",
      "--reasoning",
      "--temperature",
      "--max-tokens",
      "--max-output-tokens",
      "--top-p",
      "--top-k",
      "--seed",
      "--stop",
      "--n",
      "--output",
      "--output-file",
      "--format",
      "--system",
      "--system-file",
      "--message",
      "--messages",
      "--user",
      "--config",
      "--api-key",
      "--organization",
      ...promptFlags,
      ...promptFileFlags
    ]);

    const positional: string[] = [];
    let selectedPrompt: PromptCandidate | undefined;
    let afterDoubleDash = false;

    const recordPromptValue = (
      value: string,
      index: number,
      source: string,
      sourceDetail?: string
    ): void => {
      if (!value) {
        return;
      }
      if (!selectedPrompt || index >= selectedPrompt.index) {
        selectedPrompt = { index, text: value, source, sourceDetail };
      }
    };

    const recordPromptFile = (
      value: string,
      index: number,
      source: string,
      sourceDetail?: string
    ): void => {
      if (!value) {
        return;
      }
      if (!selectedPrompt || index >= selectedPrompt.index) {
        selectedPrompt = { index, file: value, source, sourceDetail };
      }
    };

    for (let i = 0; i < rawArgs.length; i += 1) {
      const arg = rawArgs[i];
      if (!afterDoubleDash && arg === "--") {
        afterDoubleDash = true;
        continue;
      }

      if (!afterDoubleDash && arg.startsWith("-")) {
        if (
          arg.startsWith("-p") &&
          arg !== "-p" &&
          !arg.startsWith("--") &&
          !arg.startsWith("-p=")
        ) {
          recordPromptValue(arg.slice(2), i, "flag", "-p");
          continue;
        }
        const eqIndex = arg.indexOf("=");
        const flag = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
        const inlineValue = eqIndex === -1 ? null : arg.slice(eqIndex + 1);

        if (promptFlags.has(flag)) {
          if (inlineValue !== null) {
            recordPromptValue(inlineValue, i, "flag", flag);
          } else if (rawArgs[i + 1]) {
            recordPromptValue(rawArgs[i + 1], i, "flag", flag);
            i += 1;
          }
          continue;
        }

        if (promptFileFlags.has(flag)) {
          if (inlineValue !== null) {
            recordPromptFile(inlineValue, i, "file", flag);
          } else if (rawArgs[i + 1]) {
            recordPromptFile(rawArgs[i + 1], i, "file", flag);
            i += 1;
          }
          continue;
        }

        if (valueFlags.has(flag)) {
          if (inlineValue !== null) {
            continue;
          }
          if (rawArgs[i + 1] && rawArgs[i + 1] !== "--" && !rawArgs[i + 1].startsWith("-")) {
            i += 1;
          }
          continue;
        }
        continue;
      }

      positional.push(arg);
    }

    if (selectedPrompt?.file) {
      const promptFile = selectedPrompt.file;
      const resolved = path.isAbsolute(promptFile) ? promptFile : path.resolve(cwd, promptFile);
      try {
        const content = await fs.readFile(resolved, "utf-8");
        return { text: content, source: "file", sourceDetail: resolved };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recorder.recordError(`Prompt file read failed: ${message}`);
      }
    }

    if (selectedPrompt?.text) {
      return {
        text: selectedPrompt.text,
        source: selectedPrompt.source,
        sourceDetail: selectedPrompt.sourceDetail
      };
    }

    if (positional.length) {
      return { text: positional.join(" "), source: "positional" };
    }

    return null;
  };

  await recorder.startSession({ command: "codex", args: commandArgs });
  const promptInfo = await extractPromptFromArgs(args);
  let stdinPayload: Buffer | null = null;
  if (promptInfo?.text) {
    await recorder.recordUserInput(promptInfo.text, promptInfo.source, promptInfo.sourceDetail);
  } else if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length) {
      stdinPayload = Buffer.concat(chunks);
      const text = stdinPayload.toString("utf-8");
      if (text.trim()) {
        await recorder.recordUserInput(text, "stdin");
      }
    }
  }

  const diffEngine = new DiffEngine(cwd);
  let lastSnapshot: Awaited<ReturnType<DiffEngine["captureSnapshot"]>> | null = null;
  let diffCounter = 0;
  const recordingRules = {
    ignoreCmd: options.ignoreCmd,
    onlyCmd: options.onlyCmd,
    importantCmd: options.importantCmd
  };

  const captureInitialSnapshot = async (): Promise<void> => {
    if (lastSnapshot) {
      return;
    }
    try {
      const snapshot = await diffEngine.captureSnapshot();
      const snapshotId = `snap_${Date.now()}`;
      const files = [];
      for (const file of Object.values(snapshot.files)) {
        const absPath = path.join(cwd, file.path);
        const data = await fs.readFile(absPath);
        const blobRef = await writeSnapshotBlob(
          options.root,
          recorder.getSessionId(),
          snapshotId,
          file.path,
          data
        );
        files.push({ path: file.path, blobRef });
      }
      if (files.length) {
        await recorder.recordSnapshot(files);
      }
      lastSnapshot = snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recorder.recordError(`Snapshot failed: ${message}`);
    }
  };

  const captureDiff = async (): Promise<void> => {
    if (!lastSnapshot) {
      await captureInitialSnapshot();
      return;
    }
    try {
      const { snapshot, changes } = await diffEngine.computeDiff(lastSnapshot);
      lastSnapshot = snapshot;
      if (!changes.length) {
        return;
      }
      diffCounter += 1;
      const diffId = `diff_${Date.now()}_${diffCounter}`;
      const files = [];
      for (const change of changes) {
        if (change.status === "deleted") {
          files.push({ path: change.path, status: "deleted" as const });
          continue;
        }
        const absPath = path.join(cwd, change.path);
        const data = await fs.readFile(absPath);
        const blobRef = await writeDiffBlob(
          options.root,
          recorder.getSessionId(),
          diffId,
          change.path,
          data
        );
        files.push({ path: change.path, status: change.status, blobRef });
      }
      await recorder.recordDiff(files);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recorder.recordError(`Diff failed: ${message}`);
    }
  };

  const child = spawn("codex", commandArgs, {
    cwd,
    env: process.env,
    stdio: [stdinPayload ? "pipe" : "inherit", "pipe", "pipe"]
  });
  if (stdinPayload && child.stdin) {
    child.stdin.write(stdinPayload);
    child.stdin.end();
  }

  let buffer = "";
  let interrupted = false;
  let processing = Promise.resolve();

  processing = processing.then(() => captureInitialSnapshot());

  const toolStarts = new Map<string, number>();
  const recordedToolCalls = new Set<string>();
  let stderrBuffer = "";

  const extractCommandExecutionItem = (
    event: Record<string, unknown>
  ): Record<string, unknown> | null => {
    if (event.type !== "item.started" && event.type !== "item.completed") {
      return null;
    }
    const item = event.item as Record<string, unknown> | undefined;
    if (!item || item.type !== "command_execution") {
      return null;
    }
    return item;
  };

  const pickOutputString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    return undefined;
  };

  const getCommandFromItem = (item: Record<string, unknown>): string => {
    const command = item.command;
    return typeof command === "string" ? command : "";
  };

  const getCallIdForItem = (item: Record<string, unknown>): string => {
    const itemId = item.id;
    if (typeof itemId === "string" && itemId.trim()) {
      return itemId;
    }
    return makeCallId();
  };

  const recordToolCallForItem = (item: Record<string, unknown>, callId: string): void => {
    if (recordedToolCalls.has(callId)) {
      return;
    }
    const command = getCommandFromItem(item);
    recordedToolCalls.add(callId);
    toolStarts.set(callId, Date.now());
    processing = processing.then(async () => {
      await recorder.recordToolCall("shell", { command }, callId);
    });
  };

  const extractTextItem = (
    event: Record<string, unknown>
  ): { role: "user" | "model"; text: string; source: string } | null => {
    if (event.type !== "item.completed") {
      return null;
    }
    const item = event.item as Record<string, unknown> | undefined;
    if (!item) {
      return null;
    }
    const text = item.text;
    if (typeof text !== "string" || !text.length) {
      return null;
    }
    const rawType = typeof item.type === "string" ? item.type : "";
    const lowered = rawType.toLowerCase();
    if (lowered.includes("user")) {
      return { role: "user", text, source: `codex.${rawType || "user_message"}` };
    }
    if (lowered.includes("reason")) {
      return { role: "model", text, source: `codex.${rawType || "reasoning"}` };
    }
    if (
      lowered.includes("agent") ||
      lowered.includes("assistant") ||
      lowered.includes("model") ||
      lowered.includes("message")
    ) {
      return { role: "model", text, source: `codex.${rawType || "agent_message"}` };
    }
    return { role: "model", text, source: `codex.${rawType || "message"}` };
  };

  const extractItemError = (
    event: Record<string, unknown>
  ): { message: string; stack?: string } | null => {
    if (event.type === "error") {
      const message = typeof event.message === "string" ? event.message : "";
      if (message) {
        const stack = typeof event.stack === "string" ? event.stack : undefined;
        return { message, stack };
      }
      return null;
    }
    if (event.type !== "item.completed") {
      return null;
    }
    const item = event.item as Record<string, unknown> | undefined;
    if (!item || item.type !== "error") {
      return null;
    }
    const message = typeof item.message === "string" ? item.message : "";
    if (!message) {
      return null;
    }
    const stack = typeof item.stack === "string" ? item.stack : undefined;
    return { message, stack };
  };

  const recordLine = (line: string): void => {
    if (!line.trim()) {
      return;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const event =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)
          : { value: parsed };
      processing = processing.then(() => recorder.recordCodexEvent(event));
      const commandItem = extractCommandExecutionItem(event);
      if (commandItem && event.type === "item.started") {
        const callId = getCallIdForItem(commandItem);
        recordToolCallForItem(commandItem, callId);
      }
      const textItem = extractTextItem(event);
      if (textItem?.role === "model") {
        processing = processing.then(() => recorder.recordModelOutput(textItem.text, textItem.source));
      } else if (textItem?.role === "user") {
        processing = processing.then(() =>
          recorder.recordUserInput(textItem.text, textItem.source)
        );
      }
      const itemError = extractItemError(event);
      if (itemError) {
        processing = processing.then(() => recorder.recordError(itemError.message, itemError.stack));
      }
      if (commandItem && event.type === "item.completed") {
        const callId = getCallIdForItem(commandItem);
        recordToolCallForItem(commandItem, callId);
        const command = getCommandFromItem(commandItem);
        const output: {
          stdout?: string;
          exitCode?: number;
          durationMs?: number;
          result?: Record<string, unknown>;
          stderr?: string;
        } = {};
        output.stdout = pickOutputString(
          commandItem.stdout,
          commandItem.aggregated_output,
          commandItem.output
        );
        output.stderr = pickOutputString(commandItem.stderr, commandItem.stderr_output);
        const exitCode = commandItem.exit_code;
        if (typeof exitCode === "number") {
          output.exitCode = exitCode;
        }
        const startedAt = toolStarts.get(callId);
        if (typeof startedAt === "number") {
          output.durationMs = Date.now() - startedAt;
          toolStarts.delete(callId);
        }
        const status = commandItem.status;
        if (typeof status === "string" && status !== "completed") {
          output.result = { status };
        }
        processing = processing.then(() => recorder.recordToolResult("shell", callId, output));
        const decision = decideRecording(command, recordingRules);
        if (decision.shouldRecordDiff) {
          processing = processing.then(() => captureDiff());
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      processing = processing.then(() =>
        recorder.recordError(`Failed to parse codex JSON: ${message}`)
      );
    }
  };

  const onSigInt = (): void => {
    interrupted = true;
    child.kill("SIGINT");
  };

  process.on("SIGINT", onSigInt);

  if (child.stdout) {
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        recordLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    });
  }

  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      process.stderr.write(chunk);
    });
  }

  let exitCode = 1;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? -1));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recorder.recordError(`Failed to run codex: ${message}`);
  } finally {
    process.off("SIGINT", onSigInt);
  }

  if (buffer.trim()) {
    recordLine(buffer);
  }

  await processing;
  if (stderrBuffer.trim()) {
    await recorder.recordError(`codex stderr: ${stderrBuffer.trim()}`);
  }
  await recorder.endSession(interrupted ? "cancelled" : exitCode === 0 ? "ok" : "error");
  process.exitCode = exitCode;
}
