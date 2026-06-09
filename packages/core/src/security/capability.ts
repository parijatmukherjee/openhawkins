/** The Lab — least-privilege capability model. Default-deny. */
export type CapabilityName =
  | "shell"
  | "network"
  | "fs:read"
  | "fs:write"
  | "host:info"
  | "model-call"
  | "playbook:override";

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
 * Does `grant` satisfy `required`? A capability matches when names are equal and
 * either side's scope is broad (undefined) or the scopes are equal. Default-deny:
 * no matching capability => false.
 *
 * KNOWN-LIMITATION(S6): a scoped grant (e.g. `fs:read` scope `/var`) also satisfies
 * a scope-LESS requirement of the same name. So scope narrows peer-to-peer matching,
 * not the actual reach of a tool that declares no scope. True path/resource
 * confinement arrives with the S6 process sandbox; until then, scope is advisory.
 */
export function grantSatisfies(grant: AgentGrant, required: Capability): boolean {
  return grant.capabilities.some(
    (c) =>
      c.name === required.name &&
      (c.scope === undefined || required.scope === undefined || c.scope === required.scope),
  );
}
