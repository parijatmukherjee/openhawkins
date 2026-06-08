import { describe, it, expect } from "vitest";
import { openDatabase } from "../src/driver/driver.js";
import { migrate, type Migration } from "../src/migrate.js";

const migrations: Migration[] = [
  { version: 1, name: "first", up: "CREATE TABLE a (id INTEGER)" },
  { version: 2, name: "second", up: "CREATE TABLE b (id INTEGER)" },
];

describe("migrate (forward-only)", () => {
  it("applies all pending migrations in version order and is idempotent", () => {
    const db = openDatabase({ path: ":memory:" });

    expect(migrate(db, migrations)).toBe(2); // 2 applied
    expect(migrate(db, migrations)).toBe(0); // re-run is a no-op

    const versions = db.prepare("SELECT version FROM _migrations ORDER BY version").all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
    // both tables exist:
    expect(db.prepare("SELECT COUNT(*) AS c FROM a").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) AS c FROM b").get()).toEqual({ c: 0 });
    db.close();
  });

  it("applies only newly-added migrations on a later run", () => {
    const db = openDatabase({ path: ":memory:" });
    expect(migrate(db, migrations)).toBe(2);
    const withThird: Migration[] = [
      ...migrations,
      { version: 3, name: "third", up: "CREATE TABLE c (id INTEGER)" },
    ];
    expect(migrate(db, withThird)).toBe(1);
    db.close();
  });

  it("rolls back a failing migration: throws and records nothing for it", () => {
    const db = openDatabase({ path: ":memory:" });
    const bad: Migration[] = [
      { version: 1, name: "ok", up: "CREATE TABLE a (id INTEGER)" },
      { version: 2, name: "bad", up: "THIS IS NOT VALID SQL" },
    ];
    expect(() => migrate(db, bad)).toThrow();
    // v1 committed; v2 rolled back -> only version 1 recorded, table b absent.
    expect(db.prepare("SELECT version FROM _migrations ORDER BY version").all()).toEqual([
      { version: 1 },
    ]);
    db.close();
  });
});
