import { describe, it, expect } from "vitest";
import { mintAuditKey } from "@openhawkins/core";
import { openDatabase } from "../src/driver/driver.js";
import { SqliteAuditLog } from "../src/audit-store.js";

const KEY = mintAuditKey();
const fresh = () => new SqliteAuditLog(openDatabase({ path: ":memory:" }), KEY);

describe("SqliteAuditLog", () => {
  it("appends a hash-chained entry and verifies", async () => {
    const a = fresh();
    const e0 = await a.append({ kind: "X", data: { v: 1 }, at: 10 });
    expect(e0.seq).toBe(0);
    expect(e0.prevHash).toBe("0".repeat(64));
    const e1 = await a.append({ kind: "Y", data: { v: 2 }, at: 20 });
    expect(e1.seq).toBe(1);
    expect(e1.prevHash).toBe(e0.hash);
    expect((await a.verify()).ok).toBe(true);
    expect((await a.entries()).map((e) => e.kind)).toEqual(["X", "Y"]);
  });

  it("round-trips nested JSON data faithfully through entries()", async () => {
    const a = fresh();
    const data = { nested: { a: [1, 2], b: "x" }, n: 42 };
    await a.append({ kind: "N", data, at: 1 });
    expect((await a.entries())[0].data).toEqual(data);
  });

  it("redacts secret-shaped data before hashing/persisting", async () => {
    const a = fresh();
    await a.append({ kind: "Z", data: { apiKey: "sk-abcdefgh1234" }, at: 1 });
    const [entry] = await a.entries();
    expect(JSON.stringify(entry.data)).not.toContain("sk-abcdefgh1234");
  });

  it("rebuilds the chain tail from persistence (a reopened log continues the chain)", async () => {
    const db = openDatabase({ path: ":memory:" });
    const a1 = new SqliteAuditLog(db, KEY);
    await a1.append({ kind: "A", data: {}, at: 1 });
    const a2 = new SqliteAuditLog(db, KEY);
    const e = await a2.append({ kind: "B", data: {}, at: 2 });
    expect(e.seq).toBe(1);
    expect(e.prevHash).toBe((await a1.entries())[0].hash);
    expect((await a2.verify()).ok).toBe(true);
  });

  it("serializes concurrent appends without forking the chain", async () => {
    const a = fresh();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => a.append({ kind: "C", data: { i }, at: i })),
    );
    const entries = await a.entries();
    expect(entries.map((e) => e.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect((await a.verify()).ok).toBe(true);
  });

  it("verify() returns false if a persisted row is tampered", async () => {
    const db = openDatabase({ path: ":memory:" });
    const a = new SqliteAuditLog(db, KEY);
    await a.append({ kind: "A", data: { v: 1 }, at: 1 });
    db.prepare("UPDATE audit SET data = ? WHERE seq = 0").run(JSON.stringify({ v: 999 }));
    expect((await a.verify()).ok).toBe(false);
  });

  it("verify() returns false if a persisted prev_hash is broken", async () => {
    const db = openDatabase({ path: ":memory:" });
    const a = new SqliteAuditLog(db, KEY);
    await a.append({ kind: "A", data: {}, at: 1 });
    db.prepare("UPDATE audit SET prev_hash = ? WHERE seq = 0").run("f".repeat(64));
    expect((await a.verify()).ok).toBe(false);
  });

  it("opens from a path and closes cleanly", async () => {
    const a = SqliteAuditLog.open(":memory:", KEY);
    const e = await a.append({ kind: "A", data: {}, at: 1 });
    expect(e.seq).toBe(0);
    a.close();
  });
});
