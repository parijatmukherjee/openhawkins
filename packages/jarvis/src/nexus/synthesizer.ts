import type { Synthesizer, AgentResult, Intent, JarvisContext, Synthesis } from "./types.js";

export interface Synthesizer {
  synthesize(results: AgentResult[], originalIntent: Intent, context: JarvisContext): Promise<Synthesis>;
}

export class RuleBasedSynthesizer implements Synthesizer {
  async synthesize(results: AgentResult[], originalIntent: Intent, _context: JarvisContext): Promise<Synthesis> {
    const parts: string[] = [];
    const visual: Synthesis["visual"] = [];

    for (const result of results) {
      if (!result.success) {
        parts.push(`${result.agentId} is unavailable: ${result.error}`);
        continue;
      }

      switch (result.agentId) {
        case "weather": {
          const output = result.output as { temp?: number; condition?: string };
          parts.push(`It's ${output.condition} and ${output.temp} degrees.`);
          if (output.temp !== undefined) {
            visual.push({ type: "show_text", text: `${output.temp}°F`, monitor: 1 });
          }
          break;
        }
        case "calendar": {
          const output = result.output as { events?: Array<{ title: string; time: string }> };
          if (output.events?.length) {
            const eventList = output.events.map((e) => `${e.title} at ${e.time}`).join(", ");
            parts.push(`You have ${eventList}.`);
            visual.push({ type: "open_app", app: "Calendar", monitor: 1 });
          } else {
            parts.push("You have no events.");
          }
          break;
        }
        case "system": {
          const output = result.output as { opened?: boolean };
          if (output.opened) {
            parts.push("Done.");
          }
          break;
        }
        case "research": {
          const output = result.output as { results?: string[] };
          if (output.results?.length) {
            parts.push(`I found: ${output.results.join(", ")}.`);
          }
          break;
        }
        case "browser": {
          const output = result.output as { loaded?: boolean };
          if (output.loaded) {
            parts.push("Opened the browser.");
            visual.push({ type: "open_app", app: "Browser", monitor: 2 });
          }
          break;
        }
        case "vision": {
          const output = result.output as { humans?: number; emotion?: string };
          if (output.humans !== undefined) {
            parts.push(`I see ${output.humans} person${output.humans !== 1 ? "s" : ""}.`);
            if (output.emotion) {
              parts.push(`They seem ${output.emotion}.`);
            }
          }
          break;
        }
        default:
          parts.push(`${result.agentId} responded.`);
      }
    }

    return {
      spoken: parts.join(" ") || "I'm not sure how to help with that.",
      visual: visual.length > 0 ? visual : undefined,
    };
  }
}
