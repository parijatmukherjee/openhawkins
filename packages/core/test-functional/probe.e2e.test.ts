import { describe, it, expect } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Black-box functional tests: we do NOT import the source. We spawn the actual
// built artifacts a user would run and assert on their real stdout. This catches
// packaging/runtime issues (bad import paths, ESM resolution, the single-binary
// bundling) that unit tests cannot.

const run = promisify(execFile);

// Path (relative to repo root, the cwd vitest runs from) to the compiled CLI.
const DIST_CLI = "packages/core/dist/bin/probe.js";

// Is the Bun toolchain available? In the Docker gate it always is; locally it
// usually is. When absent we skip the single-binary test rather than fail.
const hasBun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;

function parseLastJsonLine(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  return JSON.parse(line) as Record<string, unknown>;
}

function assertProbeOutput(out: Record<string, unknown>): void {
  expect(["windows", "macos", "linux"]).toContain(out.os);
  expect(typeof out.shell).toBe("string");
  expect((out.shell as string).length).toBeGreaterThan(0);
  expect(String(out.configDir)).toContain("openhawkins");
  expect(Number.isInteger(out.freeDiskBytes)).toBe(true);
  expect(out.freeDiskBytes as number).toBeGreaterThan(0);
}

describe("probe CLI — functional (black-box, exactly as a user runs it)", () => {
  it("the node-built CLI prints valid platform JSON", async () => {
    const { stdout } = await run("node", [DIST_CLI]);
    assertProbeOutput(parseLastJsonLine(stdout));
  });

  it.skipIf(!hasBun)(
    "the Bun single-file binary (the shipped artifact) runs standalone and prints the same shape",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "oh-fn-"));
      const bin = join(dir, "openhawkins-probe");
      // Compile exactly what a user downloads, then run it with no Node/Bun on PATH assumed.
      await run("bun", ["build", "packages/core/src/bin/probe.ts", "--compile", "--outfile", bin]);
      const { stdout } = await run(bin, []);
      assertProbeOutput(parseLastJsonLine(stdout));
    },
  );
});
