import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { buildProbeAgent, weakHostFactsModel } from "../../src/eval/scenarios.js";
import type { Logger } from "../../src/observability/logger.js";
import {
  runScenario,
  wasAccepted,
  finalMatchesToolNumber,
  calledToolSuccessfully,
  issuedCorrection,
} from "../../src/eval/harness.js";
import type { Scenario } from "../../src/eval/harness.js";

describe("buildProbeAgent", () => {
  it("accepts an optional logger and runs the full turn", async () => {
    const records: {
      level: string;
      event: string;
      fields?: Record<string, unknown> | undefined;
    }[] = [];
    const logger: Logger = {
      log: (level, event, fields) => void records.push({ level, event, fields }),
    };
    const agent = await buildProbeAgent({
      adapter: weakHostFactsModel(tmpdir()),
      grounding: "cited",
      logger,
    });
    const record = await agent.ask("How much disk space is free on this machine?");
    expect(record.accepted).toBe(true);
  });

  it("runs without a logger (noop default)", async () => {
    const scenario: Scenario = {
      name: "host-facts/logger-default",
      prompt: "How much disk space is free on this machine?",
      agent: () =>
        buildProbeAgent({
          adapter: weakHostFactsModel(tmpdir()),
          grounding: "cited",
        }),
      assertions: [
        issuedCorrection(),
        calledToolSuccessfully("disk_free"),
        wasAccepted(),
        finalMatchesToolNumber("disk_free"),
      ],
    };
    const result = await runScenario(scenario);
    expect(result.failures).toEqual([]);
  });
});
