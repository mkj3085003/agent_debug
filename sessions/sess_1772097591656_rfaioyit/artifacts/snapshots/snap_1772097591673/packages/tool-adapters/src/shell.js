import { spawn } from "node:child_process";
export async function runShell(input) {
    const { command, args = [], cwd, env } = input;
    const start = Date.now();
    return new Promise((resolve, reject) => {
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
//# sourceMappingURL=shell.js.map