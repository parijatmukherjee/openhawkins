import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/driver/driver.js";

describe("openDatabase pragmas", () => {
  it("enables a busy_timeout on the opened database", () => {
    const db = openDatabase({ path: ":memory:" });
    const timeout = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    expect(timeout.timeout).toBeGreaterThanOrEqual(5000);
    db.close();
  });
});

describe("SqlDriver vacuum", () => {
  it("reclaims disk space after heavy inserts and deletes", () => {
    const dir = mkdtempSync(join(tmpdir(), "openhawkins-vacuum-test-"));
    const dbPath = join(dir, "test.db");

    const db = openDatabase({ path: dbPath });
    db.exec("CREATE TABLE big (data TEXT)");
    const insert = db.prepare("INSERT INTO big (data) VALUES (?)");
    const payload = "x".repeat(1000);
    for (let i = 0; i < 500; i++) {
      insert.run(payload);
    }
    db.close();

    const sizeBefore = statSync(dbPath).size;

    const db2 = openDatabase({ path: dbPath });
    db2.exec("DELETE FROM big");
    const sizeAfterDelete = statSync(dbPath).size;
    expect(sizeAfterDelete).toBeGreaterThanOrEqual(sizeBefore); // file doesn't shrink on delete

    db2.vacuum();
    db2.close();

    const sizeAfterVacuum = statSync(dbPath).size;
    expect(sizeAfterVacuum).toBeLessThan(sizeAfterDelete);

    unlinkSync(dbPath);
    rmdirSync(dir);
  });
});
