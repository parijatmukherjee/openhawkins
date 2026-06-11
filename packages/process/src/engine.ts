export interface ProcessState {
  currentPhase: string;
  completedPhases: string[];
  phaseResults: Record<
    string,
    { status: "success" | "failure" | "skipped"; logs: string[] }
  >;
  startTime: number;
  metadata: Record<string, unknown>;
}

export type PhaseHandler = (state: ProcessState) => Promise<{ logs: string[] }>;

export class ProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessError";
  }
}

export class ProcessEngine {
  public state: ProcessState;
  private phaseHandlers: Map<string, PhaseHandler> = new Map();

  constructor(initialState?: Partial<ProcessState>) {
    this.state = {
      currentPhase: "",
      completedPhases: [],
      phaseResults: {},
      startTime: Date.now(),
      metadata: {},
      ...initialState,
    };
  }

  registerPhase(phaseId: string, handler: PhaseHandler): void {
    this.phaseHandlers.set(phaseId, handler);
  }

  async runPhase(phaseId: string): Promise<void> {
    const deps = PHASE_DEPENDENCIES[phaseId];
    if (deps) {
      for (const dep of deps) {
        if (!this.state.completedPhases.includes(dep)) {
          throw new ProcessError(
            `Phase ${phaseId} requires ${dep} to be completed first`,
          );
        }
      }
    }

    if (this.state.completedPhases.includes(phaseId)) {
      this.state.phaseResults[phaseId] = { status: "skipped", logs: [] };
      return;
    }

    this.state.currentPhase = phaseId;
    const handler = this.phaseHandlers.get(phaseId);
    if (!handler) throw new ProcessError(`No handler for phase ${phaseId}`);

    try {
      const result = await handler(this.state);
      this.state.completedPhases.push(phaseId);
      this.state.phaseResults[phaseId] = { status: "success", logs: result.logs };
    } catch (err) {
      this.state.phaseResults[phaseId] = {
        status: "failure",
        logs: [String(err)],
      };
      throw err;
    }
  }

  async runAll(phases: readonly { id: string }[]): Promise<ProcessState> {
    for (const phase of phases) {
      await this.runPhase(phase.id);
    }
    return this.state;
  }
}

import { PHASE_DEPENDENCIES } from "./manifest.js";
