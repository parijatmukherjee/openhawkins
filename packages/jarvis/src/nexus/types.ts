export interface Intent {
  action: string;
  params: Record<string, unknown>;
  confidence: number;
  ambiguous: boolean;
  suggestedClarification?: string;
}

export interface JarvisContext {
  sessionId: string;
  userId: string;
  recentIntents: Intent[];
  currentTime: Date;
  location?: string;
}

export interface AgentRoute {
  agentId: string;
  confidence: number;
  timeoutMs?: number;
  required: boolean;
  input?: unknown;
}

export interface DispatchPlan {
  parallel: AgentRoute[];
  sequential: AgentRoute[];
  primary?: AgentRoute;
}

export interface AgentResult {
  agentId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export type VisualCommand =
  | { type: "open_app"; app: string; monitor?: number }
  | { type: "open_url"; url: string; monitor?: number }
  | { type: "show_text"; text: string; monitor?: number }
  | { type: "highlight"; element: string; monitor?: number }
  | { type: "clear"; monitor?: number };

export interface Synthesis {
  spoken: string;
  visual?: VisualCommand[];
  action?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  active: boolean;
}

export interface AgentContext {
  sessionId: string;
  intent: Intent;
  memory?: unknown;
}
