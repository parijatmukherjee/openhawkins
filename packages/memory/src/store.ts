import { randomUUID } from "node:crypto";
import type { Provenance } from "@openhawkins/core";
import { type SqlDriver, type SqlStatement, openDatabase, migrate } from "@openhawkins/state";
import type { Fragment, ScoredFragment } from "./fragment.js";
import { MEMORY_SCHEMA } from "./schema.js";
import { type Candidate, rankCandidates, toMatchQuery } from "./recall.js";

export interface RememberInput {
  text: string;
  tendril?: string;
  tags?: string[];
  importance?: number; // default 0.5
  provenance?: Provenance; // default { trust: "tool", source: "runtime", taint: false }
}

export interface RecallQuery {
  text: string;
  now: number;
  tendril?: string;
  tags?: string[];
  k?: number; // default 5
}

interface FragmentRow {
  id: string;
  text: string;
  tendril: string | null;
  tags: string;
  importance: number;
  trust: string;
  taint: number;
  created_at: number;
  last_used_at: number;
  uses: number;
}

/**
 * VECNA — decay-aware memory over embedded SQLite. `remember` writes a fragment,
 * `recall` returns the most relevant ones for a query (FTS5 text match re-ranked by
 * the pure scorer in recall.ts), and `reinforce` strengthens a fragment that proved
 * useful. The DB handle is injected so tests run against a real `:memory:` SQLite.
 */
export class VecnaStore {
  private readonly db: SqlDriver;
  private readonly nextId: () => string;
  private readonly insertStmt: SqlStatement;
  private readonly matchStmt: SqlStatement;
  private readonly reinforceStmt: SqlStatement;

  constructor(db: SqlDriver, opts: { id?: () => string } = {}) {
    this.db = db;
    this.nextId = opts.id ?? (() => randomUUID());
    migrate(db, MEMORY_SCHEMA);
    this.insertStmt = db.prepare(
      `INSERT INTO fragments
         (id, text, tendril, tags, importance, trust, taint, created_at, last_used_at, uses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    );
    // FTS5 candidate query: join the matched rowids back to the full fragment rows.
    // Candidate set is every FTS5 match (no LIMIT) — fine at S2 store sizes; a
    // bound can be added in S2.4 once recall runs on every turn. rankCandidates
    // needs all candidates to rank globally.
    this.matchStmt = db.prepare(
      `SELECT f.*, bm25(fragments_fts) AS bm25
         FROM fragments_fts
         JOIN fragments f ON f.rowid = fragments_fts.rowid
        WHERE fragments_fts MATCH ?`,
    );
    this.reinforceStmt = db.prepare(
      `UPDATE fragments
          SET importance = MAX(0.0, MIN(1.0, importance + ?)), uses = uses + 1, last_used_at = ?
        WHERE id = ?`,
    );
  }

  static open(path: string, opts: { id?: () => string } = {}): VecnaStore {
    return new VecnaStore(openDatabase({ path }), opts);
  }

  async remember(input: RememberInput, now: number = Date.now()): Promise<Fragment> {
    const prov: Provenance = input.provenance ?? { trust: "tool", source: "runtime", taint: false };
    const fragment: Fragment = {
      id: this.nextId(),
      text: input.text,
      ...(input.tendril !== undefined ? { tendril: input.tendril } : {}),
      tags: input.tags ?? [],
      importance: Math.max(0, Math.min(1, input.importance ?? 0.5)),
      trust: prov.trust,
      taint: prov.taint,
      createdAt: now,
      lastUsedAt: now,
      uses: 0,
    };
    this.insertStmt.run(
      fragment.id,
      fragment.text,
      fragment.tendril ?? null,
      JSON.stringify(fragment.tags),
      fragment.importance,
      fragment.trust,
      fragment.taint ? 1 : 0,
      fragment.createdAt,
      fragment.lastUsedAt,
    );
    return fragment;
  }

  async recall(query: RecallQuery): Promise<ScoredFragment[]> {
    const match = toMatchQuery(query.text);
    if (match === null) {
      return [];
    }
    const rows = this.matchStmt.all(match) as (FragmentRow & { bm25: number })[];
    const candidates: Candidate[] = rows.map((r) => ({ fragment: rowToFragment(r), bm25: r.bm25 }));
    const ctx = {
      now: query.now,
      ...(query.tags !== undefined ? { tags: query.tags } : {}),
      ...(query.tendril !== undefined ? { tendril: query.tendril } : {}),
    };
    return rankCandidates(candidates, ctx, query.k ?? 5);
  }

  async reinforce(id: string, delta: number, now: number = Date.now()): Promise<void> {
    this.reinforceStmt.run(delta, now, id);
  }

  close(): void {
    this.db.close();
  }
}

function rowToFragment(r: FragmentRow): Fragment {
  return {
    id: r.id,
    text: r.text,
    ...(r.tendril !== null ? { tendril: r.tendril } : {}),
    tags: JSON.parse(r.tags) as string[],
    importance: r.importance,
    // invariant: only valid Trust values are ever written (remember() constrains
    // trust via Provenance), so this cast from the TEXT column is sound.
    trust: r.trust as Fragment["trust"],
    taint: r.taint === 1,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    uses: r.uses,
  };
}
