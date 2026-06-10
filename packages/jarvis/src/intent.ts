import type { JarvisContext } from "./context.js";

export interface Intent {
  /**
   * The action to perform. Built-in vision actions include:
   *
   * - `"vision_query"` — "what do you see?"
   * - `"vision_count"` — "how many people are there?"
   * - `"vision_presence"` — "is anyone there?"
   * - `"vision_alert"` — triggered by `presence_change` event (proactive)
   */
  action: string;
  params: Record<string, unknown>;
  confidence: number;
  ambiguous: boolean;
  suggestedClarification?: string;
}

export interface IntentParser {
  parse(input: string, context: JarvisContext): Promise<Intent>;
}
