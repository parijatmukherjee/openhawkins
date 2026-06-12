import { ProcessEngine } from "./engine.js";
import { AGENT_LOOP_PHASES } from "./manifest.js";

export function createCliEngine(args: string[]): ProcessEngine {
  const plan = args.find((a) => a.startsWith("--plan="))?.split("=")[1];

  const engine = new ProcessEngine();
  if (plan) engine.state.metadata.planFile = plan;

  return engine;
}

export async function runCli(
  args: string[],
  engineFactory: typeof createCliEngine = createCliEngine,
): Promise<void> {
  const phase = args.find((a) => a.startsWith("--phase="))?.split("=")[1];
  const engine = engineFactory(args);

  if (phase) {
    await engine.runPhase(phase);
  } else {
    await engine.runAll(AGENT_LOOP_PHASES);
  }
}
