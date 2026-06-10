import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import {
  runScenario,
  calledToolSuccessfully,
  noToolCalled,
  wasAccepted,
  issuedCorrection,
  finalContains,
  finalMatchesToolNumber,
  type Scenario,
} from "../../src/eval/harness.js";
import { buildProbeAgent, weakHostFactsModel } from "../../src/eval/scenarios.js";

const PROMPT = "How much disk space is free on this machine?";
const PATH = tmpdir();

// The headline acceptance (spec §3): the SAME weak model, run with grounding on vs
// off, produces a verified-real answer vs a fabrication — proving Eleven, not the
// model, is what kills the hallucination. The disk number is REAL (the real tool runs
// on the real machine); only the "model" is scripted, which is the spec's
// deterministic-replay mechanism (§7.2).

describe("the hallucination test (cited grounding)", () => {
  // `diskFree` (when set) pins the tool's number so the determinism test is reproducible;
  // the headline test omits it and exercises the REAL disk read.
  const scenario = (diskFree?: number): Scenario => ({
    name: "host-facts/cited",
    prompt: PROMPT,
    agent: () =>
      buildProbeAgent({
        adapter: weakHostFactsModel(PATH),
        grounding: "cited",
        ...(diskFree !== undefined ? { diskFree } : {}),
      }),
    assertions: [
      issuedCorrection(), // the pre-tool guess was REJECTED
      calledToolSuccessfully("disk_free"), // it was forced to call the real tool
      wasAccepted(), // the cited answer was accepted
      finalMatchesToolNumber("disk_free"), // and its number equals the tool result
    ],
  });

  it("rejects the fabricated answer, forces the tool, and accepts only the cited real number", async () => {
    const result = await runScenario(scenario());
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);

    const free = (result.record.toolCalls[0].result.data as { freeBytes: number }).freeBytes;
    expect(free).toBeGreaterThan(0);
    expect(result.record.final).toContain(String(free));
    // The fabricated "250 GB" never survived to the final answer.
    expect(result.record.final).not.toContain("250 GB");
  });

  it("is deterministic — same scenario replays to an identical decision trace", async () => {
    // Pin the disk number so the run is fully reproducible: the model is scripted and
    // Eleven is deterministic, so the only live input is the real disk's free bytes,
    // which drift between calls. A fixed tool result isolates replay determinism.
    const a = await runScenario(scenario(123_456_789));
    const b = await runScenario(scenario(123_456_789));
    expect(a.record.final).toBe(b.record.final);
    expect(a.record.final).toContain("123456789 bytes are free");
    expect(a.record.corrections).toEqual(b.record.corrections);
    expect(a.record.modelCalls.length).toBe(b.record.modelCalls.length);
  });
});

describe("the negative control (grounding off)", () => {
  it("accepts the fabrication unchanged — no tool, no correction — proving the engine is the difference", async () => {
    const result = await runScenario({
      name: "host-facts/off",
      prompt: PROMPT,
      agent: () => buildProbeAgent({ adapter: weakHostFactsModel(PATH), grounding: "off" }),
      assertions: [noToolCalled(), wasAccepted(), finalContains("250 GB")],
    });
    expect(result.failures).toEqual([]);
    expect(result.record.corrections).toHaveLength(0);
    expect(result.record.toolCalls).toHaveLength(0);
    expect(result.record.final).toContain("250 GB"); // the hallucination survived
  });
});

describe("the runtime records and audits the grounded turn", () => {
  it("event-sources the session and keeps a verifiable audit chain", async () => {
    const agent = await buildProbeAgent({
      adapter: weakHostFactsModel(PATH),
      grounding: "cited",
    });
    await agent.ask(PROMPT);

    // Murray: every model/tool/correction/final step is auditable and tamper-evident.
    const entries = await agent.audit.entries();
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("ToolReturned");
    expect(kinds).toContain("CorrectionIssued");
    expect(kinds).toContain("FinalAccepted");
    expect((await agent.audit.verify()).ok).toBe(true);
  });
});
