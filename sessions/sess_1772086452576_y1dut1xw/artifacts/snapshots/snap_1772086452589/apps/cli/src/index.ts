#!/usr/bin/env node
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { replayCommand } from "./commands/replay.js";
import { rerunCommand } from "./commands/rerun.js";
import { codexExecCommand } from "./commands/codexExec.js";
import { serveCommand } from "./commands/serve.js";
import { restoreCommand } from "./commands/restore.js";

const program = new Command();
program.enablePositionalOptions();

program
  .name("agent-debug")
  .description("Record, replay, and rerun agent sessions")
  .version("0.0.1");

program
  .command("run")
  .description("Run a command and record events")
  .allowUnknownOption(true)
  .argument("<cmd>")
  .argument("[args...]", "Command arguments")
  .option("-r, --root <path>", "Root directory for sessions", ".")
  .option("--cwd <path>", "Working directory for the command")
  .action(runCommand);

program
  .command("replay")
  .description("Replay a recorded session")
  .argument("<sessionId>")
  .option("-r, --root <path>", "Root directory for sessions", ".")
  .action(replayCommand);

program
  .command("rerun")
  .description("Rerun a session from a step")
  .argument("<sessionId>")
  .option("-r, --root <path>", "Root directory for sessions", ".")
  .option("-s, --step <number>", "Step to start from", "0")
  .option("--reuse", "Reuse recorded tool outputs", false)
  .action(rerunCommand);

program
  .command("restore")
  .description("Restore workspace state to a specific step")
  .argument("<sessionId>")
  .option("-r, --root <path>", "Root directory for sessions", ".")
  .option("-s, --step <number>", "Step number to restore", "0")
  .option("-o, --out <path>", "Output directory for restored workspace")
  .action(restoreCommand);

program
  .command("codex-exec")
  .description("Run codex exec --json and record the event stream")
  .allowUnknownOption(true)
  .passThroughOptions()
  .argument("[args...]", "Arguments passed to codex exec")
  .option("-r, --root <path>", "Root directory for sessions", ".")
  .option("--cwd <path>", "Working directory for codex run")
  .option("--session <id>", "Session id override")
  .action(codexExecCommand);

program
  .command("serve")
  .description("Serve session data over HTTP for the viewer")
  .option("-r, --root <path>", "Root directory for sessions", ".")
  .option("-p, --port <number>", "Port to listen on", "8787")
  .option("--host <host>", "Host to bind to", "127.0.0.1")
  .action(serveCommand);

program.parse(process.argv);
