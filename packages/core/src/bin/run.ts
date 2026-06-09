import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import type { ModelAdapter } from "../models/adapter.js";
import type { GroundingMode } from "../grounding/eleven.js";
import { weakHostFactsModel } from "../eval/scenarios.js";
import { buildAgentRun } from "../playbook/build-agent-run.js";
import { HumanOperator, ScriptedOperator } from "../playbook/operators.js";
import { ValidateGate } from "../playbook/gates.js";
import type { Operator } from "../playbook/agent-run.js";

/**
 * `openhawkins run` — drive a real agent run as a Playbook-governed process. The scripted
 * model + a trivial Validate make a deterministic, offline demo (the REAL orchestrator,
 * gates plumbing, events and audit still run). `--approve-all` runs unattended (a
 * ScriptedOperator that approves every soft phase — still audited); otherwise a human is
 * prompted at each soft phase. `--json` prints the run result + audit summary.
 */
function flag(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

function buildAdapter(kind: string, path: string): ModelAdapter {
  if (kind === "scripted") {
    return weakHostFactsModel(path);
  }
  throw new Error(`unknown --model "${kind}" (this demo CLI supports: scripted)`);
}

const GROUNDING_MODES: GroundingMode[] = ["off", "preferred", "required", "cited"];

function parseGrounding(value: string): GroundingMode {
  if ((GROUNDING_MODES as string[]).includes(value)) {
    return value as GroundingMode;
  }
  throw new Error(`unknown --grounding "${value}" (use: ${GROUNDING_MODES.join(" | ")})`);
}

function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.once("line", (line) => {
      rl.close();
      resolve(line);
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modelKind = flag(args, "--model", "scripted");
  const grounding = parseGrounding(flag(args, "--grounding", "cited"));
  const path = flag(args, "--path", tmpdir());
  const approveAll = args.includes("--approve-all");
  const asJson = args.includes("--json");

  const operator: Operator = approveAll
    ? new ScriptedOperator(
        Array.from({ length: 8 }, () => ({ approve: true as const, actor: "cli", reason: "auto" })),
      )
    : new HumanOperator({
        actor: process.env.USER ?? "operator",
        readLine: readStdinLine,
        write: (s) => process.stdout.write(s),
      });

  const built = await buildAgentRun({
    adapter: buildAdapter(modelKind, path),
    grounding,
    prompts: { Execute: "How much disk space is free on this machine?" },
    operator,
    // Demo Validate: a real ValidateGate over a trivially-true predicate — exercises the
    // gate plumbing end-to-end without recursively running the repo's own gate.
    validateGate: new ValidateGate(async () => ({ ok: true })),
  });

  const result = await built.run.run();
  const verified = await built.audit.verify();
  if (asJson) {
    const entries = await built.audit.entries();
    console.log(JSON.stringify({ result, auditEntries: entries.length, auditVerified: verified }));
  } else {
    console.log(`run ${result.kind}; audit ${verified ? "verified" : "TAMPERED"}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
