import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAgentRun,
  ScriptedOperator,
  weakHostFactsModel,
  ValidateGate,
  isPhaseEvent,
  foldPlaybook,
  mintAuditKey,
  type PhaseEvent,
} from "@openhawkins/core";
import { openDatabase, SqliteEventStore, SqliteAuditLog } from "../src/index.js";

const PROMPT = "How much disk space is free on this machine?";
const approvals = () =>
  new ScriptedOperator(
    Array.from({ length: 8 }, () => ({ approve: true as const, actor: "op", reason: "ok" })),
  );

describe("durable run — replay + audit parity across a reopen", () => {
  it("persists the run to SQLite; a reopened store replays it and the audit verifies", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "oh-a1-")), "run.db");
    const KEY = mintAuditKey();

    // 1) run against a durable store+audit over one shared db file
    const db = openDatabase({ path: dbPath });
    const store = new SqliteEventStore(db);
    const audit = new SqliteAuditLog(db, KEY);
    const built = await buildAgentRun({
      adapter: weakHostFactsModel(tmpdir()),
      grounding: "cited",
      prompts: { Execute: PROMPT },
      operator: approvals(),
      validateGate: new ValidateGate(async () => ({ ok: true })),
      store,
      audit,
    });
    expect(await built.run.run()).toEqual({ kind: "completed" });
    expect(await audit.verify()).toBe(true);
    const liveEvents = await store.read("probe-agent-session");
    db.close();

    // 2) REOPEN the same file with fresh stores — durability proof
    const db2 = openDatabase({ path: dbPath });
    const store2 = new SqliteEventStore(db2);
    const audit2 = new SqliteAuditLog(db2, KEY);

    const replayedEvents = await store2.read("probe-agent-session");
    expect(replayedEvents).toEqual(liveEvents); // events survived the reopen
    const phaseEvents = replayedEvents.filter(isPhaseEvent) as PhaseEvent[];
    expect(foldPlaybook(phaseEvents).phase).toBe("Present"); // replay reproduces final state
    expect(await audit2.verify()).toBe(true); // audit chain survived + verifies
    const kinds = (await audit2.entries()).map((e) => e.kind);
    expect(kinds).toContain("FinalAccepted"); // agent turn recorded
    expect(kinds).toContain("PhaseEntered"); // phase transition (unified chain)
    db2.close();
  });
});
