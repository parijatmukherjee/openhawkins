import { Agent } from "../eval/agent.js";
import type { ModelAdapter } from "../models/adapter.js";
import { ToolRegistry } from "../tools/registry.js";
import { diskFreeTool } from "../tools/disk-free.js";
import type { GroundingMode } from "../grounding/eleven.js";
import { InMemoryEventStore, type EventStore } from "../session/events.js";
import { RedactingEventStore } from "../session/redacting-store.js";
import { InMemoryAuditLog, type AuditLog } from "../security/audit.js";
import { type Clock, systemClock } from "../util/clock.js";
import type { AgentGrant } from "../security/capability.js";
import { DEFAULT_MANIFEST, type Phase } from "./manifest.js";
import { SoftGate, ValidateGate, type PhaseGate } from "./gates.js";
import { gateCommandPredicate, DEFAULT_GATE_COMMANDS } from "./gate-command.js";
import { PlaybookRun } from "./runner.js";
import { AgentRun, type Operator, type PhaseHandler } from "./agent-run.js";

export interface BuildAgentRunOpts {
  adapter: ModelAdapter;
  grounding: GroundingMode;
  /** Per-phase prompts; a phase with a prompt runs `agent.ask(prompt)` as its work. */
  prompts: Partial<Record<Phase, string>>;
  operator: Operator;
  /** Defaults to the REAL repo gate. Tests pass a fake to avoid recursively running it. */
  validateGate?: PhaseGate;
  /** Durable stores wired by a composition root (e.g. the durable integration test or a
   *  CLI). Default: in-memory. Injecting these is the F-C1 durability seam. */
  store?: EventStore;
  audit?: AuditLog;
  clock?: Clock;
}

export interface BuiltAgentRun {
  run: AgentRun;
  agent: Agent;
  store: EventStore;
  audit: AuditLog;
}

/**
 * Wire a real agent run: one shared `EventStore` + `AuditLog` across the `Agent` and the
 * `PlaybookRun`, so a single hash-chained trace covers grounded turns AND phase
 * transitions. Each phase with a configured prompt runs `agent.ask(prompt)` as its work;
 * Validate runs the real repo gate by default.
 */
export async function buildAgentRun(opts: BuildAgentRunOpts): Promise<BuiltAgentRun> {
  const clock = opts.clock ?? systemClock;
  const baseStore = opts.store ?? new InMemoryEventStore();
  const store = new RedactingEventStore(baseStore);
  const audit = opts.audit ?? new InMemoryAuditLog();
  // `Agent.start` derives its sessionId as `${agentId}-session`; we hand the PlaybookRun
  // the same id so both stream into the one shared store/audit. Derive both from one
  // constant so the shared-trace invariant can't drift across edits.
  const agentId = "probe-agent";
  const sessionId = `${agentId}-session`;
  const grant: AgentGrant = {
    agentId,
    capabilities: [{ name: "host:info" }, { name: "playbook:override" }],
  };

  const registry = new ToolRegistry();
  registry.register(diskFreeTool);
  const agent = await Agent.start({
    agentId,
    adapter: opts.adapter,
    registry,
    grant,
    tools: [diskFreeTool],
    grounding: { mode: opts.grounding, qualifyingTools: ["disk_free"] },
    systemPrompt: "You are probe-agent. Answer questions about this host accurately.",
    store,
    audit,
    clock,
  });

  // `exactOptionalPropertyTypes` makes the prompt values `string` (an explicit `undefined`
  // is a type error), and `Object.entries` only yields present keys — so the cast refines
  // the key to `Phase` with no `undefined` value to guard against.
  const handlers: Partial<Record<Phase, PhaseHandler>> = {};
  for (const [phase, prompt] of Object.entries(opts.prompts) as [Phase, string][]) {
    handlers[phase] = async () => void (await agent.ask(prompt));
  }

  const validateGate =
    opts.validateGate ?? new ValidateGate(gateCommandPredicate(DEFAULT_GATE_COMMANDS));
  const playbook = await PlaybookRun.start({
    manifest: DEFAULT_MANIFEST,
    sessionId,
    runId: `${agentId}-run`,
    store,
    audit,
    grant,
    softGate: new SoftGate(),
    validateGate,
    clock,
  });

  return {
    run: new AgentRun({ playbook, handlers, operator: opts.operator }),
    agent,
    store,
    audit,
  };
}
