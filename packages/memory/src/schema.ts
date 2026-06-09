import type { Migration } from "@openhawkins/state";

/**
 * VECNA's schema, run via the shared migration runner against the memory database.
 * `fragments` holds the rows; `fragments_fts` is an FTS5 external-content mirror of
 * `text` kept in sync by triggers so recall can MATCH + bm25 over it.
 */
export const MEMORY_SCHEMA: Migration[] = [
  {
    version: 1,
    name: "fragments",
    up: `
      CREATE TABLE fragments (
        id           TEXT PRIMARY KEY,
        text         TEXT NOT NULL,
        tendril      TEXT,
        tags         TEXT NOT NULL,    -- JSON array of strings
        importance   REAL NOT NULL,
        trust        TEXT NOT NULL,
        taint        INTEGER NOT NULL, -- 0 | 1
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        uses         INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE fragments_fts USING fts5(text, content='fragments', content_rowid='rowid');

      CREATE TRIGGER fragments_ai AFTER INSERT ON fragments BEGIN
        INSERT INTO fragments_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE TRIGGER fragments_ad AFTER DELETE ON fragments BEGIN
        INSERT INTO fragments_fts(fragments_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      END;
      CREATE TRIGGER fragments_au AFTER UPDATE OF text ON fragments
      WHEN new.text != old.text BEGIN
        INSERT INTO fragments_fts(fragments_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
        INSERT INTO fragments_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `,
  },
  {
    version: 2,
    name: "fragment-embedding",
    up: `ALTER TABLE fragments ADD COLUMN embedding BLOB;`,
  },
];
