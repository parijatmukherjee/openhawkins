import type { SqlDriver } from "./driver/driver.js";

/** One forward-only schema step. */
export interface Migration {
  /** Caller's contract: strictly increasing across the migration list (gaps tolerated). */
  version: number;
  name: string;
  up: string; // SQL executed once, inside a transaction
}

/**
 * Apply every migration whose version exceeds the database's current max, in order,
 * each inside its own transaction, recording it in `_migrations`. Idempotent:
 * already-applied migrations are skipped. Returns the number applied this call.
 */
export function migrate(db: SqlDriver, migrations: Migration[]): number {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL)",
  );
  const row = db.prepare("SELECT MAX(version) AS v FROM _migrations").get() as {
    v: number | null;
  };
  const current = row.v ?? 0;
  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((m) => m.version > current);

  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.up);
      db.prepare("INSERT INTO _migrations (version, name, at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        Date.now(),
      );
    });
  }
  return pending.length;
}
