import { describe, it, expect } from "vitest";
import {
  runCommand,
  gateCommandPredicate,
  DEFAULT_GATE_COMMANDS,
  npmExecutable,
  needsShell,
} from "../../src/playbook/gate-command.js";

// Spawn the running JS engine itself (always present on Node + Bun) so these tests are
// deterministic and cross-platform — no dependency on `node`/`npm` being on PATH.
const SELF = process.execPath;
const exit = (code: number): [string, string[]] => [SELF, ["-e", `process.exit(${code})`]];

describe("runCommand", () => {
  it("reports ok for a zero exit code", async () => {
    const [cmd, args] = exit(0);
    expect(await runCommand(cmd, args)).toEqual({ ok: true });
  });

  it("reports not ok with detail for a non-zero exit code", async () => {
    const [cmd, args] = exit(3);
    const result = await runCommand(cmd, args);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("exit code 3");
  });

  it("includes captured stderr in the detail on failure", async () => {
    const result = await runCommand(SELF, ["-e", 'console.error("boom-detail"); process.exit(1)']);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("boom-detail");
  });

  it("reports not ok when the binary cannot be spawned", async () => {
    const result = await runCommand("definitely-not-a-real-binary-xyz", []);
    expect(result.ok).toBe(false);
    expect(result.detail).toBeDefined();
  });

  it('reports a null exit code as "null" when killed by a signal', async () => {
    // A process killed by a signal closes with code === null (signal set instead);
    // this exercises the `code ?? "null"` coalesce.
    const result = await runCommand(SELF, ["-e", 'process.kill(process.pid, "SIGKILL")']);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("exit code null");
  });
});

describe("gateCommandPredicate", () => {
  it("passes when every command exits zero", async () => {
    const predicate = gateCommandPredicate([
      [SELF, ["-e", "process.exit(0)"]],
      [SELF, ["-e", "process.exit(0)"]],
    ]);
    expect(await predicate()).toEqual({ ok: true });
  });

  it("fails on the first non-zero command and reports which one", async () => {
    const predicate = gateCommandPredicate([
      [SELF, ["-e", "process.exit(0)"]],
      [SELF, ["-e", 'console.error("step-2-failed"); process.exit(1)']],
      [SELF, ["-e", "process.exit(0)"]],
    ]);
    const result = await predicate();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("step-2-failed");
  });

  it("exposes the default gate commands as npm scripts", () => {
    const scripts = DEFAULT_GATE_COMMANDS.map(([, args]) => args[args.length - 1]);
    expect(scripts).toEqual(["build", "lint", "format:check", "coverage", "test:functional"]);
    // each runs the platform-appropriate npm executable (npm / npm.cmd)
    expect(DEFAULT_GATE_COMMANDS.every(([cmd]) => cmd === npmExecutable())).toBe(true);
  });
});

describe("npmExecutable", () => {
  it("uses npm.cmd on Windows and bare npm elsewhere", () => {
    expect(npmExecutable("win32")).toBe("npm.cmd");
    expect(npmExecutable("linux")).toBe("npm");
    expect(npmExecutable("darwin")).toBe("npm");
  });
});

describe("needsShell", () => {
  it("requires a shell only for Windows .cmd/.bat shims", () => {
    expect(needsShell("npm.cmd", "win32")).toBe(true);
    expect(needsShell("foo.bat", "win32")).toBe(true);
    expect(needsShell("npm", "win32")).toBe(false); // a real .exe / non-shim on win32
    expect(needsShell("npm.cmd", "linux")).toBe(false); // .cmd is meaningless off Windows
    expect(needsShell("npm", "darwin")).toBe(false);
  });
});
