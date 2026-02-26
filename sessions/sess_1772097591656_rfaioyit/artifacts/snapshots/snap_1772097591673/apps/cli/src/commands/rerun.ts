import { ReplayEngine } from "@agent-debug/replay";

export async function rerunCommand(
  sessionId: string,
  options: { root: string; step: string; reuse?: boolean }
): Promise<void> {
  const engine = new ReplayEngine(options.root);
  await engine.rerun(sessionId, {
    mode: options.reuse ? "replay" : "rerun",
    fromStep: Number(options.step),
    reuseOutputs: Boolean(options.reuse)
  });
}
