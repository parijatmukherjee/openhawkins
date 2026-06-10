/** The Lab — least-privilege capability model. Default-deny. */
export type CapabilityName =
  | "shell"
  | "network"
  | "fs:read"
  | "fs:write"
  | "host:info"
  | "model-call"
  | "playbook:override"
  | "document:convert";

export interface Capability {
  name: CapabilityName;
  /** Optional fine-grained scope (e.g. a path prefix). Omitted = broad. */
  scope?: string;
}

export interface AgentGrant {
  agentId: string;
  capabilities: Capability[];
}

/**
 * Does `grant` satisfy `required`? A capability matches when names are equal and:
 * - a scopeless requirement matches only a scopeless grant (deny-by-default for scope);
 * - a scoped requirement matches only if the grant's scope is a prefix of the required
 *   scope (or the grant is scopeless, which is broad).
 *
 * Default-deny: no matching capability => false.
 */
export function grantSatisfies(grant: AgentGrant, required: Capability): boolean {
  return grant.capabilities.some((c) => {
    if (c.name !== required.name) return false;
    // Scopeless requirement → scopeless grant only (deny-by-default for scope).
    if (required.scope === undefined) {
      return c.scope === undefined;
    }
    // Scoped requirement → scopeless grant (broad) or scoped grant with matching prefix.
    if (c.scope === undefined) {
      return true;
    }
    return required.scope.startsWith(c.scope);
  });
}
