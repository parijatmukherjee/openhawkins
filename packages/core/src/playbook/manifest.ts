/** The fixed phases of the working process (AGENT.md spine). */
export type Phase = "Research" | "Plan" | "Tasks" | "Execute" | "Validate" | "Present";

/** How a phase decides it is complete. `soft` pauses for an operator override;
 *  `validate` runs an injected predicate (P2). `Present` is terminal. */
export type GateKind = "soft" | "validate";

export interface PhaseSpec {
  phase: Phase;
  gate: GateKind;
  /** Where a failed gate routes. Only meaningful for the `validate` gate. */
  onFail?: Phase;
}

export interface PlaybookManifest {
  /** Ordered; the first is the start phase, the last is terminal. */
  phases: PhaseSpec[];
  /** Max Validate->Plan replans before a run escalates to an operator. */
  maxReplans: number;
}

/** The built-in default Playbook: the AGENT.md Research->...->Present spine. */
export const DEFAULT_MANIFEST: PlaybookManifest = {
  phases: [
    { phase: "Research", gate: "soft" },
    { phase: "Plan", gate: "soft" },
    { phase: "Tasks", gate: "soft" },
    { phase: "Execute", gate: "soft" },
    { phase: "Validate", gate: "validate", onFail: "Plan" },
    { phase: "Present", gate: "soft" },
  ],
  maxReplans: 3,
};

/** The spec for `phase`, or throw if the manifest does not declare it. */
export function phaseSpec(manifest: PlaybookManifest, phase: Phase): PhaseSpec {
  const spec = manifest.phases.find((p) => p.phase === phase);
  if (spec === undefined) {
    throw new Error(`phase "${phase}" is not in manifest`);
  }
  return spec;
}

/** The sequential successor of `phase`, or undefined when `phase` is terminal. */
export function nextPhase(manifest: PlaybookManifest, phase: Phase): Phase | undefined {
  const i = manifest.phases.findIndex((p) => p.phase === phase);
  const next = i >= 0 ? manifest.phases[i + 1] : undefined;
  return next?.phase;
}
