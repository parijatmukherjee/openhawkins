import { describe, it, expect } from "vitest";
import {
  SoftGate,
  ValidateGate,
  type PhaseGate,
  type GateContext,
  type ValidatePredicate,
} from "../../src/playbook/gates.js";
import { type Logger, type LogLevel } from "../../src/observability/logger.js";

describe("SoftGate", () => {
  it("always returns needs-operator, naming the phase", async () => {
    const gate: PhaseGate = new SoftGate();
    const ctx: GateContext = { phase: "Research" };
    const verdict = await gate.evaluate(ctx);
    expect(verdict.status).toBe("needs-operator");
    if (verdict.status === "needs-operator") {
      expect(verdict.reason).toContain("Research");
    }
  });
});

describe("ValidateGate", () => {
  const ctx: GateContext = { phase: "Validate" };

  it("passes when the predicate reports ok", async () => {
    const gate: PhaseGate = new ValidateGate(async () => ({ ok: true }));
    expect(await gate.evaluate(ctx)).toEqual({ status: "passed" });
  });

  it("fails with the predicate's detail when it reports not ok", async () => {
    const gate: PhaseGate = new ValidateGate(async () => ({ ok: false, detail: "coverage 98%" }));
    expect(await gate.evaluate(ctx)).toEqual({ status: "failed", reason: "coverage 98%" });
  });

  it("fails with a default reason when not ok and no detail is given", async () => {
    const gate: PhaseGate = new ValidateGate(async () => ({ ok: false }));
    expect(await gate.evaluate(ctx)).toEqual({ status: "failed", reason: "validation failed" });
  });

  it("never throws: a throwing predicate becomes a failed verdict", async () => {
    const boom: ValidatePredicate = async () => {
      throw new Error("gate command crashed");
    };
    const gate: PhaseGate = new ValidateGate(boom);
    expect(await gate.evaluate(ctx)).toEqual({
      status: "failed",
      reason: "gate command crashed",
    });
  });

  it("stringifies a non-Error thrown by the predicate", async () => {
    const gate: PhaseGate = new ValidateGate(async () => {
      throw "weird";
    });
    expect(await gate.evaluate(ctx)).toEqual({ status: "failed", reason: "weird" });
  });

  it("logs a warn event when the validate predicate throws", async () => {
    const records: { level: LogLevel; event: string }[] = [];
    const logger: Logger = { log: (level, event) => void records.push({ level, event }) };
    const gate = new ValidateGate(async () => {
      throw new Error("predicate boom");
    }, logger);
    const verdict = await gate.evaluate();
    expect(verdict).toEqual({ status: "failed", reason: "predicate boom" }); // behavior unchanged
    expect(records).toContainEqual({ level: "warn", event: "gate_predicate_threw" });
  });
});
