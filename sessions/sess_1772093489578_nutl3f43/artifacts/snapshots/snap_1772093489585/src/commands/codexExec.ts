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
  };

  const extractPromptFromArgs = async (
    rawArgs: string[]
  ): Promise<{ text: string; source: string } | null> => {
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

    const recordPromptValue = (value: string, index: number, source: string): void => {
      if (!value) {
        return;
      }
      if (!selectedPrompt || index >= selectedPrompt.index) {
        selectedPrompt = { index, text: value, source };
      }
    };

    const recordPromptFile = (value: string, index: number, source: string): void => {
      if (!value) {
        return;
      }
      if (!selectedPrompt || index >= selectedPrompt.index) {
        selectedPrompt = { index, file: value, source };
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
          recordPromptValue(arg.slice(2), i, "flag");
          continue;
        }
        const eqIndex = arg.indexOf("=");
        const flag = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
        const inlineValue = eqIndex === -1 ? null : arg.slice(eqIndex + 1);

        if (promptFlags.has(flag)) {
          if (inlineValue !== null) {
            recordPromptValue(inlineValue, i, "flag");
          } else if (rawArgs[i + 1]) {
            recordPromptValue(rawArgs[i + 1], i, "flag");
            i += 1;
          }
          continue;
        }

        if (promptFileFlags.has(flag)) {
          if (inlineValue !== null) {
            recordPromptFile(inlineValue, i, "file");
          } else if (rawArgs[i + 1]) {
            recordPromptFile(rawArgs[i + 1], i, "file");
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
        return { text: content, source: selectedPrompt.source };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recorder.recordError(`Prompt file read failed: ${message}`);
      }
    }

    if (selectedPrompt?.text) {
      return { text: selectedPrompt.text, source: selectedPrompt.source };
    }

    if (positional.length) {
      return { text: positional.join(" "), source: "positional" };
    }

    return null;
  };

  await recorder.startSession({ command: "codex", args: commandArgs });
  const promptInfo = await extractPromptFromArgs(args);
  if (promptInfo?.text) {
    await recorder.recordUserInput(promptInfo.text);
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
    stdio: ["inherit", "pipe", "pipe"]
  });

  let buffer = "";
  let interrupted = false;
  let processing = Promise.resolve();

  processing = processing.then(() => captureInitialSnapshot());

  const toolStarts = new Map<string, number>();
  const recordedToolCalls = new Set<string>();

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

  const extractAgentMessage = (event: Record<string, unknown>): string | null => {
    if (event.type !== "item.completed") {
      return null;
    }
    const item = event.item as Record<string, unknown> | undefined;
    if (!item || item.type !== "agent_message") {
      return null;
    }
    const text = item.text;
    return typeof text === "string" ? text : null;
  };

  const extractUserMessage = (event: Record<string, unknown>): string | null => {
    if (event.type !== "item.completed") {
      return null;
    }
    const item = event.item as Record<string, unknown> | undefined;
    if (!item || item.type !== "user_message") {
      return null;
    }
    const text = item.text;
    return typeof text === "string" ? text : null;
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
      const agentText = extractAgentMessage(event);
      if (agentText) {
        processing = processing.then(() => recorder.recordModelOutput(agentText));
      }
      const userText = extractUserMessage(event);
      if (userText) {
        processing = processing.then(() => recorder.recordUserInput(userText));
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
        } = {};
        const aggregated = commandItem.aggregated_output;
        if (typeof aggregated === "string" && aggregated.length) {
          output.stdout = aggregated;
        }
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

  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

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
  await recorder.endSession(interrupted ? "cancelled" : exitCode === 0 ? "ok" : "error");
  process.exitCode = exitCode;
}
