import { spawn } from "node:child_process";
import { ToolResult } from "./types.js";

export interface ShellInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export async function runShell(input: ShellInput): Promise<ToolResult> {
  const { command, args = [], cwd, env } = input;
  const start = Date.now();

  return new Promise<ToolResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        durationMs: Date.now() - start
      });
    });
  });
}
