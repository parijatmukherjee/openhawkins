/**
 * The Gate — provenance / taint (spec §5.2, §8.3). Every piece of content carries
 * where it came from and whether it is untrusted. The taint→approval rule: a
 * side-effecting action influenced by tainted content requires human approval. S1
 * ships no side-effecting tools, but the field and the rule exist so later
 * subprojects inherit them unchanged.
 */
export type Trust = "system" | "operator" | "tool" | "external";

export interface Provenance {
  trust: Trust;
  source: string;
  taint: boolean;
}

/** Build a provenance tag; `external` content is tainted (untrusted) by default. */
export function provenance(trust: Trust, source: string): Provenance {
  return { trust, source, taint: trust === "external" };
}

/**
 * The taint→approval rule: a side-effecting action requires approval iff any of the
 * content that influenced it is tainted. Read-only actions never require approval on
 * taint grounds.
 */
export function requiresApproval(opts: {
  sideEffecting: boolean;
  influencedBy: Provenance[];
}): boolean {
  return opts.sideEffecting && opts.influencedBy.some((p) => p.taint);
}

/** Thrown when a side-effecting tool is gated by the taint rule. */
export class TaintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaintError";
  }
}
