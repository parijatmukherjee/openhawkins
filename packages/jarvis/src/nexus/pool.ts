import type { AgentRoute, AgentContext, AgentResult, AgentInfo } from "./types.js";

export interface AgentPool {
  list(): Promise<AgentInfo[]>;
  execute(route: AgentRoute, context: AgentContext): Promise<AgentResult>;
  health(agentId: string): Promise<boolean>;
}

interface AgentFactory {
  (context: AgentContext): Promise<unknown>;
}

export class InProcessAgentPool implements AgentPool {
  private agents: Map<string, AgentInfo>;
  private factories: Map<string, AgentFactory>;

  constructor() {
    this.agents = new Map([
      ["research", { id: "research", name: "Research Agent", role: "research", capabilities: ["web_search", "summarize"], active: true }],
      ["system", { id: "system", name: "System Agent", role: "system", capabilities: ["open_app", "list_apps"], active: true }],
      ["weather", { id: "weather", name: "Weather Agent", role: "data", capabilities: ["fetch_weather"], active: true }],
      ["calendar", { id: "calendar", name: "Calendar Agent", role: "data", capabilities: ["fetch_calendar"], active: true }],
      ["browser", { id: "browser", name: "Browser Agent", role: "browser", capabilities: ["navigate", "click", "scroll"], active: true }],
      ["vision", { id: "vision", name: "Vision Agent", role: "vision", capabilities: ["detect_humans", "detect_emotion"], active: true }],
    ]);

    this.factories = new Map([
      ["research", async () => ({ results: ["Result 1", "Result 2"] })],
      ["system", async () => ({ opened: true })],
      ["weather", async () => ({ temp: 72, condition: "sunny" })],
      ["calendar", async () => ({ events: [{ title: "Meeting", time: "10:00" }] })],
      ["browser", async () => ({ loaded: true })],
      ["vision", async () => ({ humans: 1, emotion: "neutral" })],
      ["slow", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { slow: true };
      }],
    ]);
  }

  async list(): Promise<AgentInfo[]> {
    return Array.from(this.agents.values());
  }

  async execute(route: AgentRoute, context: AgentContext): Promise<AgentResult> {
    const factory = this.factories.get(route.agentId);
    if (!factory) {
      return { agentId: route.agentId, success: false, error: `Unknown agent: ${route.agentId}` };
    }

    const start = Date.now();
    try {
      const timeoutMs = route.timeoutMs ?? 30000;
      const output = await Promise.race([
        factory(context),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
      return { agentId: route.agentId, success: true, output, durationMs: Date.now() - start };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { agentId: route.agentId, success: false, error, durationMs: Date.now() - start };
    }
  }

  async health(agentId: string): Promise<boolean> {
    return this.agents.has(agentId) && this.agents.get(agentId)!.active;
  }
}
