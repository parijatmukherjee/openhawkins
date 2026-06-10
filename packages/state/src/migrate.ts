import type { SqlDriver } from "./driver/driver.js";

/** One schema step with optional rollback. */
export interface Migration {
  /** Caller's contract: strictly increasing across the migration list (gaps tolerated). */
  version: number;
  name: string;
  up: string; // SQL executed once, inside a transaction
  down?: string; // SQL to undo this migration
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

/**
 * Undo the last N applied migrations by running their `down` scripts (if present) in
 * reverse order, removing the `_migrations` record for each. Returns the number rolled
 * back this call.
 */
export function rollback(db: SqlDriver, migrations: Migration[], steps = 1): number {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
    .get() as { name: string } | undefined;
  if (!tableExists) return 0;

  const row = db.prepare("SELECT MAX(version) AS v FROM _migrations").get() as {
    v: number | null;
  };
  const current = row.v ?? 0;
  if (current === 0) return 0;

  const applied = [...migrations]
    .sort((a, b) => b.version - a.version)
    .filter((m) => m.version <= current && m.down);

  let rolled = 0;
  for (const m of applied) {
    if (rolled >= steps) break;
    db.transaction(() => {
      db.exec(m.down!);
      db.prepare("DELETE FROM _migrations WHERE version = ?").run(m.version);
    });
    rolled++;
  }
  return rolled;
}
