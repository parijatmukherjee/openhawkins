import { randomUUID } from "node:crypto";
import { Session } from "../session/session.js";
import { InMemoryEventStore, type EventStore } from "../session/events.js";
import { type Clock, systemClock } from "../util/clock.js";
import type { ModelAdapter } from "../models/adapter.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentGrant } from "../security/capability.js";
import type { ToolDefinition } from "../tools/tool.js";
import { runAgentTurn, type AgentLoopConfig } from "../loop/agent-loop.js";
import type { TurnRecord } from "../loop/turn.js";
import { Eleven, groundingInstruction, type ElevenConfig } from "../grounding/eleven.js";
import { type AuditLog, InMemoryAuditLog } from "../security/audit.js";
import type { MemoryStore } from "../memory.js";
import type { MetricsCollector } from "../observability/metrics.js";
import { noopMetricsCollector } from "../observability/metrics.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDefinition = ToolDefinition<any, any>;

/**
 * The runtime object a caller (the CLI, the eval harness) actually drives. It ties
 * the event-sourced Session (single-writer), the agent loop, Eleven grounding, and
 * the Murray audit into one `ask()` — so grounding, session integrity, and audit are
 * owned by the runtime, not the model (spec §2 goals).
 */
export interface AgentConfig {
  agentId: string;
  adapter: ModelAdapter;
  registry: ToolRegistry;
  grant: AgentGrant;
  tools: AnyToolDefinition[];
  grounding: ElevenConfig;
  systemPrompt?: string;
  maxModelCalls?: number;
  store?: EventStore;
  audit?: AuditLog;
  clock?: Clock;
  /** Optional memory store for context injection before each turn. */
  memory?: MemoryStore;
  /** Metrics collector for turn lifecycle and latency telemetry. */
  metrics?: MetricsCollector;
}

export class Agent {
  private constructor(
    private readonly cfg: AgentConfig,
    private readonly session: Session,
    private readonly clock: Clock,
    readonly audit: AuditLog,
  ) {}

  static async start(cfg: AgentConfig): Promise<Agent> {
    const clock = cfg.clock ?? systemClock;
    const store = cfg.store ?? new InMemoryEventStore();
    const audit = cfg.audit ?? new InMemoryAuditLog();
    const session = await Session.start({
      sessionId: `${cfg.agentId}-session`,
      agentId: cfg.agentId,
      store,
      clock,
    });
    return new Agent(cfg, session, clock, audit);
  }

  /** Run one grounded turn. Serialized by the Session; audited by Murray. */
  async ask(input: string): Promise<TurnRecord> {
    const metrics = this.cfg.metrics ?? noopMetricsCollector;
    const policy = new Eleven(this.cfg.grounding, metrics);
    const instruction = groundingInstruction(
      this.cfg.grounding.mode,
      this.cfg.grounding.qualifyingTools,
    );
    let systemPrompt = [this.cfg.systemPrompt, instruction].filter(Boolean).join("\n\n");

    // Inject recalled memory fragments into the system prompt before the turn.
    if (this.cfg.memory) {
      const fragments = await this.cfg.memory.recall(input);
      if (fragments.length > 0) {
        const memoryBlock = `Relevant context:\n${fragments.join("\n")}`;
        systemPrompt = systemPrompt ? `${memoryBlock}\n\n${systemPrompt}` : memoryBlock;
      }
    }

    const traceId = randomUUID();

    // Wrap adapter to record ModelResponseLatency for each generate call.
    const timedAdapter: ModelAdapter = {
      name: this.cfg.adapter.name,
      generate: async (req) => {
        const start = Date.now();
        const result = await this.cfg.adapter.generate(req);
        metrics.histogram("ModelResponseLatency", Date.now() - start);
        return result;
      },
    };

    const loopCfg: AgentLoopConfig = {
      adapter: timedAdapter,
      registry: this.cfg.registry,
      grant: this.cfg.grant,
      tools: this.cfg.tools,
      policy,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(this.cfg.maxModelCalls ? { maxModelCalls: this.cfg.maxModelCalls } : {}),
      ...(this.cfg.memory ? { memory: this.cfg.memory } : {}),
      traceId,
      metrics,
    };

    let record!: TurnRecord;
    await this.session.runTurn(input, async () => {
      record = await runAgentTurn(loopCfg, input);
      await this.writeAudit(record);
      return record.final ?? "[no grounded answer]";
    });
    return record;
  }

  /** Derive Murray audit entries from a completed turn (every step is auditable). */
  private async writeAudit(rec: TurnRecord): Promise<void> {
    for (const mc of rec.modelCalls) {
      await this.audit.append({
        kind: "ModelResponded",
        at: this.clock(),
        data: { content: mc.content, toolCalls: mc.toolCalls.length, traceId: rec.traceId },
      });
    }
    for (const tc of rec.toolCalls) {
      await this.audit.append({
        kind: "ToolReturned",
        at: this.clock(),
        data: {
          tool: tc.call.tool,
          ok: tc.result.ok,
          traceId: rec.traceId,
          ...(tc.result.ok ? {} : { error: tc.result.error }),
        },
      });
    }
    for (const correction of rec.corrections) {
      await this.audit.append({
        kind: "CorrectionIssued",
        at: this.clock(),
        data: { correction, traceId: rec.traceId },
      });
    }
    await this.audit.append({
      kind: rec.accepted ? "FinalAccepted" : "GroundingFailed",
      at: this.clock(),
      data: {
        accepted: rec.accepted,
        traceId: rec.traceId,
        ...(rec.final ? { final: rec.final } : {}),
        ...(rec.flagged ? { flagged: rec.flagged } : {}),
      },
    });
  }
}
