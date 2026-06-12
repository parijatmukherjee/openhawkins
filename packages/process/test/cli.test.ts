import { describe, it, expect } from "vitest";
import { runCli } from "../src/cli.js";

describe("CLI", () => {
  it("parses --phase and --plan args without throwing", async () => {
    // No phases registered in fresh engine, so this will throw "No handler"
    // but that tests argument parsing works
    await expect(runCli(["--phase=research", "--plan=docs/plans/test.md"])).rejects.toThrow(
      "No handler for phase research",
    );
  });

  it("runs without args (no phase specified)", async () => {
    // Will fail on first phase with no handler
    await expect(runCli([])).rejects.toThrow("No handler");
  });
});
