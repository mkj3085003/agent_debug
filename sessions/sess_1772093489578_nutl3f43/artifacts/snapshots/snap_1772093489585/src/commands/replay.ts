import { ReplayEngine } from "@agent-debug/replay";

export async function replayCommand(sessionId: string, options: { root: string }): Promise<void> {
  const engine = new ReplayEngine(options.root);
  const events = await engine.replay(sessionId);
  for (const event of events) {
    process.stdout.write(`${event.step}\t${event.type}\t${event.ts}\n`);
  }
}
