import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Black-box: spawn the actual built CLI a user runs, assert on real stdout. Proves the
// whole wiring (ESM resolution, the Agent+Playbook+gates+audit composition, the operator
// loop) survives packaging — exactly as shipped.
const run = promisify(execFile);
const DIST_CLI = "packages/core/dist/bin/run.js";

describe("openhawkins run — functional (black-box)", () => {
  it("drives an unattended Playbook-governed run to completion with a verified audit", async () => {
    const { stdout } = await run("node", [DIST_CLI, "--approve-all", "--json"]);
    const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
    const out = JSON.parse(line) as {
      result: { kind: string };
      auditEntries: number;
      auditVerified: boolean;
    };
    expect(out.result.kind).toBe("completed");
    expect(out.auditVerified).toBe(true);
    expect(out.auditEntries).toBeGreaterThan(6); // phase transitions + the agent's grounded turn
  });
});
