import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedOperator, weakHostFactsModel, ValidateGate, JsonLogger } from "@openhawkins/core";
import { buildDurableAgentRun, verifyDurable } from "../build-durable-agent-run.js";
import { checkHealth } from "../health.js";
import { anchorAuditChain, verifyAnchor, FileVault, resolveAuditKey } from "@openhawkins/core";
import { openDatabase } from "../driver/driver.js";
import { SqliteAuditLog } from "../audit-store.js";
import { rollback } from "../migrate.js";
import { SCHEMA } from "../schema.js";

/**
 * `openhawkins-run` — a durable, keyed-audit agent run over SQLite (A1b: F-C1/F-C2 at
 * runtime). The scripted model + a trivial Validate make a deterministic offline demo; the
 * SQLite event store, the Vault-resolved audit key, and the keyed HMAC chain are all REAL.
 * `--verify` reopens an existing db+vault (a SEPARATE process) and reports whether the
 * keyed chain still verifies — the cross-process durability proof.
 * `--health` reports DB connectivity, vault unlock status, last audit verification, and
 * recent error rate.
 * `--anchor` writes an external tamper-evident anchor after the run.
 * `--verify-anchor` checks the external anchor against the current audit tip before running.
 * `--vacuum` runs VACUUM on the database before starting.
 * `--rollback <steps>` undoes the last N migrations before starting.
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
  const anchorPath = flag(args, "--anchor", "");
  const verifyAnchorPath = flag(args, "--verify-anchor", "");
  const vacuum = args.includes("--vacuum");
  const rollbackStepsRaw = flag(args, "--rollback", "");
  const rollbackSteps = rollbackStepsRaw ? Number(rollbackStepsRaw) : undefined;

  if (vacuum || rollbackSteps !== undefined) {
    const db = openDatabase({ path: dbPath });
    try {
      if (vacuum) {
        db.vacuum();
        console.log(asJson ? JSON.stringify({ mode: "vacuum", ok: true }) : `vacuum: ok`);
      }
      if (rollbackSteps !== undefined) {
        const rolled = rollback(db, SCHEMA, rollbackSteps);
        console.log(
          asJson
            ? JSON.stringify({ mode: "rollback", rolled })
            : `rollback: ${rolled} migration(s) rolled back`,
        );
      }
    } finally {
      db.close();
    }
    if (
      !args.includes("--verify") &&
      !args.includes("--health") &&
      !anchorPath &&
      !verifyAnchorPath
    ) {
      return;
    }
  }

  if (verifyAnchorPath) {
    const db = openDatabase({ path: dbPath });
    try {
      const key = await resolveAuditKey(new FileVault({ path: vaultPath, passphrase }));
      const audit = new SqliteAuditLog(db, key);
      const v = await verifyAnchor(audit, verifyAnchorPath);
      console.log(
        asJson
          ? JSON.stringify({ mode: "verify-anchor", ...v })
          : `verify-anchor: ${v.ok ? "ok" : "TAMPERED or MISMATCHED"}`,
      );
      if (!v.ok) {
        process.exitCode = 1;
      }
      return;
    } finally {
      db.close();
    }
  }

  if (args.includes("--health")) {
    const h = await checkHealth({ dbPath, vaultPath, passphrase });
    console.log(asJson ? JSON.stringify({ mode: "health", ...h }) : `health: ${JSON.stringify(h)}`);
    return;
  }

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
    // Observability on for the durable production entrypoint: swallow-point diagnostics to
    // stderr; flows through `...runOpts` into buildAgentRun's logger seam.
    logger: new JsonLogger(),
  });
  const result = await built.run.run();
  const verified = (await built.audit.verify()).ok;
  if (anchorPath) {
    await anchorAuditChain(built.audit, anchorPath);
  }
  built.close();
  console.log(
    asJson
      ? JSON.stringify({ mode: "run", result, auditVerified: verified, anchored: !!anchorPath })
      : `run ${result.kind}; audit ${verified ? "verified" : "TAMPERED"}; db ${dbPath}${anchorPath ? `; anchored ${anchorPath}` : ""}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
