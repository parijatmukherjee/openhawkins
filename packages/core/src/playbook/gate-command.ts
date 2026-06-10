import { spawn } from "node:child_process";
import type { GateCheck, ValidatePredicate } from "./gates.js";

/** A command to run: the executable and its argument list (args are passed literally;
 *  a shell is used only for Windows `.cmd`/`.bat` shims — see `needsShell`). */
export type Command = [cmd: string, args: string[]];

/** Whether spawning `cmd` needs a shell. Since the Node fix for CVE-2024-27980, spawning
 *  a Windows batch shim (`.cmd`/`.bat`, e.g. `npm.cmd`) WITHOUT a shell throws `EINVAL`;
 *  on every other platform/target a shell is avoided so args stay literal. Pure (takes
 *  `platform`) so both arms are testable on any host. */
export function needsShell(cmd: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
}

export interface RunCommandOptions {
  timeoutMs?: number | undefined;
}

/**
 * Run one command to completion, capturing output. Resolves `{ ok: true }` on a zero
 * exit, or `{ ok: false, detail }` on a non-zero exit or a spawn error (e.g. the binary
 * is missing). Never rejects — failures are returned as data, not thrown.
 */
export function runCommand(
  cmd: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<GateCheck> {
  return new Promise((resolve) => {
    // Both `error` (spawn failure) and `close` can fire for one child, so `resolve` may
    // be called twice — harmless, since a settled Promise ignores later resolutions. We
    // rely on that idempotency deliberately rather than tracking a `settled` flag.
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: needsShell(cmd) });
    let out = "";
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ ok: false, detail: `${cmd} timed out after ${options.timeoutMs}ms` });
      }, options.timeoutMs);
    }
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({ ok: false, detail: `failed to run ${cmd}: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        resolve({ ok: true });
      } else {
        const tail = out.trim();
        const detail = `${cmd} ${args.join(" ")} exited with exit code ${code ?? "null"}`;
        resolve({ ok: false, detail: tail.length > 0 ? `${detail}\n${tail}` : detail });
      }
    });
  });
}

/** npm's executable name for the given platform. On Windows npm is `npm.cmd` (a batch
 *  shim); spawning bare `npm` without a shell ENOENTs there, so the Windows CI leg needs
 *  the `.cmd`. Taking `platform` as a parameter keeps this pure and testable on any host. */
export function npmExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

/** The repo gate as a command list (run in order; the Docker gate runs the same set).
 *  Spec §3.4 also lists `test` and `docker-gate`: `coverage` (`vitest run --coverage`)
 *  subsumes `test` (`vitest run`), and `docker-gate` is the CI wrapper around exactly
 *  these scripts — so both are intentionally omitted here rather than run recursively. */
export const DEFAULT_GATE_COMMANDS: Command[] = [
  [npmExecutable(), ["run", "build"]],
  [npmExecutable(), ["run", "lint"]],
  [npmExecutable(), ["run", "format:check"]],
  [npmExecutable(), ["run", "coverage"]],
  [npmExecutable(), ["run", "test:functional"]],
];

/**
 * Build a `ValidatePredicate` that runs `commands` in order and fails on the first
 * non-zero exit (short-circuit), surfacing that command's detail. Pass
 * `DEFAULT_GATE_COMMANDS` for the real repo gate.
 */
export function gateCommandPredicate(commands: Command[], timeoutMs?: number): ValidatePredicate {
  return async () => {
    for (const [cmd, args] of commands) {
      const result = await runCommand(cmd, args, { timeoutMs });
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true };
  };
}
