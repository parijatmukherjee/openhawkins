import type { ProcessState } from "./engine.js";
import { ProcessError } from "./engine.js";

export type HookType = "pre-phase" | "post-phase" | "on-failure" | "on-complete";

export interface LifecycleHook {
  type: HookType;
  phase?: string;
  handler: (state: ProcessState) => Promise<void> | void;
}

export class HookRegistry {
  private hooks: LifecycleHook[] = [];

  register(hook: LifecycleHook): void {
    this.hooks.push(hook);
  }

  async run(type: HookType, state: ProcessState): Promise<void> {
    const matching = this.hooks.filter(
      (h) => h.type === type && (h.phase === undefined || h.phase === state.currentPhase),
    );
    for (const hook of matching) {
      await hook.handler(state);
    }
  }
}

export function installDefaultHooks(registry: HookRegistry): void {
  registry.register({
    type: "pre-phase",
    phase: "execute",
    handler: (state) => {
      if (!state.metadata.planFile) {
        throw new ProcessError("Cannot execute without a plan file");
      }
    },
  });

  registry.register({
    type: "post-phase",
    phase: "validate",
    handler: () => {
      // Validation success logging
    },
  });
}
