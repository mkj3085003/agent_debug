import path from "node:path";
import { ReplayEngine } from "@agent-debug/replay";

interface RestoreOptions {
  root: string;
  step: string;
  out?: string;
}

export async function restoreCommand(sessionId: string, options: RestoreOptions): Promise<void> {
  const step = Number(options.step);
  if (Number.isNaN(step)) {
    throw new Error("Invalid step value");
  }
  const outputDir =
    options.out ?? path.join(options.root, "restores", `${sessionId}_step_${step}`);

  const engine = new ReplayEngine(options.root);
  await engine.restoreToStep(sessionId, step, outputDir);
  console.log(`Restored ${sessionId} to step ${step} at ${outputDir}`);
}
