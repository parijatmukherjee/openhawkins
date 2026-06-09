import { describe, it, expect } from "vitest";
import * as playbook from "../../src/playbook/index.js";

describe("@openhawkins/core playbook barrel", () => {
  it("re-exports the manifest, events, and machine surface", () => {
    expect(playbook.DEFAULT_MANIFEST.phases.length).toBe(6);
    expect(typeof playbook.nextPhase).toBe("function");
    expect(typeof playbook.isPhaseEvent).toBe("function");
    expect(typeof playbook.foldPlaybook).toBe("function");
    expect(typeof playbook.step).toBe("function");
    expect(typeof playbook.SoftGate).toBe("function");
    expect(typeof playbook.ValidateGate).toBe("function");
    expect(typeof playbook.runCommand).toBe("function");
    expect(typeof playbook.gateCommandPredicate).toBe("function");
    expect(typeof playbook.npmExecutable).toBe("function");
    expect(Array.isArray(playbook.DEFAULT_GATE_COMMANDS)).toBe(true);
  });
});
