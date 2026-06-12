import { ProcessEngine } from "./engine.js";
import { AGENT_LOOP_PHASES } from "./manifest.js";

export async function runCli(args: string[]): Promise<void> {
  const phase = args.find((a) => a.startsWith("--phase="))?.split("=")[1];
  const plan = args.find((a) => a.startsWith("--plan="))?.split("=")[1];

  const engine = new ProcessEngine();
  if (plan) engine.state.metadata.planFile = plan;

  if (phase) {
    await engine.runPhase(phase);
  } else {
    await engine.runAll(AGENT_LOOP_PHASES);
  }
}
