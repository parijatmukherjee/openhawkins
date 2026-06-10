import { describe, it, expect } from "vitest";
import { openDatabase } from "../src/driver/driver.js";
import { migrate, rollback, type Migration } from "../src/migrate.js";

const migrations: Migration[] = [
  { version: 1, name: "first", up: "CREATE TABLE a (id INTEGER)", down: "DROP TABLE a" },
  { version: 2, name: "second", up: "CREATE TABLE b (id INTEGER)", down: "DROP TABLE b" },
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
      { version: 1, name: "ok", up: "CREATE TABLE a (id INTEGER)", down: "DROP TABLE a" },
      { version: 2, name: "bad", up: "THIS IS NOT VALID SQL", down: "" },
    ];
    expect(() => migrate(db, bad)).toThrow();
    // v1 committed; v2 rolled back -> only version 1 recorded, table b absent.
    expect(db.prepare("SELECT version FROM _migrations ORDER BY version").all()).toEqual([
      { version: 1 },
    ]);
    db.close();
  });
});

describe("rollback", () => {
  it("undoes the last migration by default", () => {
    const db = openDatabase({ path: ":memory:" });
    expect(migrate(db, migrations)).toBe(2);

    expect(rollback(db, migrations)).toBe(1);
    expect(db.prepare("SELECT version FROM _migrations ORDER BY version").all()).toEqual([
      { version: 1 },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS c FROM a").get()).toEqual({ c: 0 });
    expect(() => db.prepare("SELECT COUNT(*) AS c FROM b").get()).toThrow();
    db.close();
  });

  it("undoes multiple migrations when steps > 1", () => {
    const db = openDatabase({ path: ":memory:" });
    expect(migrate(db, migrations)).toBe(2);

    expect(rollback(db, migrations, 2)).toBe(2);
    expect(db.prepare("SELECT version FROM _migrations ORDER BY version").all()).toEqual([]);
    expect(() => db.prepare("SELECT COUNT(*) AS c FROM a").get()).toThrow();
    db.close();
  });

  it("stops after requested steps even if more migrations exist", () => {
    const db = openDatabase({ path: ":memory:" });
    const three: Migration[] = [
      { version: 1, name: "a", up: "CREATE TABLE a (id INTEGER)", down: "DROP TABLE a" },
      { version: 2, name: "b", up: "CREATE TABLE b (id INTEGER)", down: "DROP TABLE b" },
      { version: 3, name: "c", up: "CREATE TABLE c (id INTEGER)", down: "DROP TABLE c" },
    ];
    expect(migrate(db, three)).toBe(3);
    expect(rollback(db, three, 1)).toBe(1);
    expect(db.prepare("SELECT version FROM _migrations ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    db.close();
  });

  it("is a no-op when the migrations table exists but is empty", () => {
    const db = openDatabase({ path: ":memory:" });
    db.exec(
      "CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL)",
    );
    expect(rollback(db, migrations)).toBe(0);
    db.close();
  });

  it("is a no-op when nothing to roll back", () => {
    const db = openDatabase({ path: ":memory:" });
    expect(rollback(db, migrations)).toBe(0);
    db.close();
  });

  it("skips migrations that have no down script", () => {
    const db = openDatabase({ path: ":memory:" });
    const noDown: Migration[] = [
      { version: 1, name: "only-up", up: "CREATE TABLE a (id INTEGER)" },
    ];
    expect(migrate(db, noDown)).toBe(1);
    expect(rollback(db, noDown)).toBe(0);
    expect(db.prepare("SELECT version FROM _migrations ORDER BY version").all()).toEqual([
      { version: 1 },
    ]);
    db.close();
  });
});
