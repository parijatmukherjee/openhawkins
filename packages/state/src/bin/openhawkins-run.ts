import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedOperator, weakHostFactsModel, ValidateGate } from "@openhawkins/core";
import { buildDurableAgentRun, verifyDurable } from "../build-durable-agent-run.js";

/**
 * `openhawkins-run` — a durable, keyed-audit agent run over SQLite (A1b: F-C1/F-C2 at
 * runtime). The scripted model + a trivial Validate make a deterministic offline demo; the
 * SQLite event store, the Vault-resolved audit key, and the keyed HMAC chain are all REAL.
 * `--verify` reopens an existing db+vault (a SEPARATE process) and reports whether the
 * keyed chain still verifies — the cross-process durability proof.
 */
function flag(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbPath = flag(args, "--db", join(tmpdir(), "openhawkins.db"));
  const vaultPath = flag(args, "--vault", join(tmpdir(), "openhawkins-vault.json"));
  const passphrase = flag(
    args,
    "--passphrase",
    process.env.OPENHAWKINS_VAULT_PASS ?? "openhawkins",
  );
  const asJson = args.includes("--json");

  if (args.includes("--verify")) {
    const v = await verifyDurable({ dbPath, vaultPath, passphrase });
    console.log(asJson ? JSON.stringify({ mode: "verify", ...v }) : `verify: ${JSON.stringify(v)}`);
    return;
  }

  const built = await buildDurableAgentRun({
    dbPath,
    vaultPath,
    passphrase,
    adapter: weakHostFactsModel(tmpdir()),
    grounding: "cited",
    prompts: { Execute: "How much disk space is free on this machine?" },
    operator: new ScriptedOperator(
      Array.from({ length: 8 }, () => ({ approve: true as const, actor: "cli", reason: "auto" })),
    ),
    validateGate: new ValidateGate(async () => ({ ok: true })),
  });
  const result = await built.run.run();
  const verified = await built.audit.verify();
  built.close();
  console.log(
    asJson
      ? JSON.stringify({ mode: "run", result, auditVerified: verified })
      : `run ${result.kind}; audit ${verified ? "verified" : "TAMPERED"}; db ${dbPath}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
