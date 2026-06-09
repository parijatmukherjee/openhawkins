import { describe, it, expect } from "vitest";
import { grantSatisfies, type AgentGrant } from "../../src/security/capability.js";

const grant = (caps: AgentGrant["capabilities"]): AgentGrant => ({
  agentId: "probe-agent",
  capabilities: caps,
});

describe("grantSatisfies (The Lab)", () => {
  it("returns true when the grant has the required capability name", () => {
    expect(grantSatisfies(grant([{ name: "host:info" }]), { name: "host:info" })).toBe(true);
  });

  it("default-denies when the capability is absent", () => {
    expect(grantSatisfies(grant([{ name: "fs:read" }]), { name: "network" })).toBe(false);
  });

  it("a scope-less grant satisfies a scoped requirement (broad grant)", () => {
    expect(grantSatisfies(grant([{ name: "fs:read" }]), { name: "fs:read", scope: "/etc" })).toBe(
      true,
    );
  });

  it("a scoped grant satisfies only its matching scope", () => {
    const g = grant([{ name: "fs:read", scope: "/var" }]);
    expect(grantSatisfies(g, { name: "fs:read", scope: "/var" })).toBe(true);
    expect(grantSatisfies(g, { name: "fs:read", scope: "/etc" })).toBe(false);
  });

  it("a scoped grant satisfies a scope-less requirement", () => {
    expect(grantSatisfies(grant([{ name: "fs:read", scope: "/var" }]), { name: "fs:read" })).toBe(
      true,
    );
  });
});

describe("playbook:override capability", () => {
  it("is satisfiable by a matching grant and denied by default", () => {
    const granted = { agentId: "op", capabilities: [{ name: "playbook:override" as const }] };
    expect(grantSatisfies(granted, { name: "playbook:override" })).toBe(true);
    const empty = { agentId: "op", capabilities: [] };
    expect(grantSatisfies(empty, { name: "playbook:override" })).toBe(false);
  });
});
