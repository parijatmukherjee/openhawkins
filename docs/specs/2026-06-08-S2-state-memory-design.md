# S2 — Durable State (VINES) + Memory (VECNA) — Design

**Date:** 2026-06-08
**Status:** Approved for planning
**Parent:** [`2026-06-05-openhawkins-design.md`](./2026-06-05-openhawkins-design.md) (umbrella)
**Builds on:** [`2026-06-05-S1-core-runtime-grounding-design.md`](./2026-06-05-S1-core-runtime-grounding-design.md)
**Subproject:** S2 of the build order (umbrella §9)

> S2 makes OpenHawkins **remember**. It gives the runtime durable, embedded
> persistence (no external DB) for orchestration state — **VINES** — and a
> decay-aware, auto-injected shared memory — **VECNA** — and wires both into the S1
> agent so a grounded answer learned in one run is recalled in the next. Both are
> **runtime-owned**: state transitions are written by the runtime as it drives a
> turn, and memory is recalled and injected automatically — never something the
> model must remember to call (closes umbrella P5/P11).

---

## 1. Scope

### 1.1 In scope (S2)

1. **`SqlDriver` port** + runtime selection (`bun:sqlite` in the shipped binary,
   `node:sqlite` in dev/test) + a forward-only **migration runner**, in
   `@openhawkins/state`.
2. **`SqliteEventStore` — VINES:** a durable implementation of the S1 `EventStore`
   interface (`@openhawkins/core`), so S1 `Session`/replay become durable with
   **zero caller changes**.
3. **VECNA store** (`@openhawkins/memory`): decay-aware memory `fragments` —
   `remember` / `recall` / `reinforce`, blended ranking, taint-aware down-ranking.
4. **Embeddings:** an `Embedder` port (built-in `FakeEmbedder`; optional real
   `TransformersEmbedder`) + **pure-JS cosine** vector recall over Float32 BLOBs
   (works on Node, Bun, and the binary), with **FTS5 + decay lexical fallback**
   whenever no embedder is configured (see §9, decision §12.2).
5. **Auto-injection + write-back:** a `MemoryPort` interface in `@openhawkins/core`
   and its use inside `Agent.ask` (recall → inject before the turn; write-back →
   `reinforce` after acceptance). Proven end-to-end by a "remembers across process
   restarts" slice.
6. **Toolchain:** bump to **Node 24** (so `node:sqlite` is stable/unflagged) across
   `engines`, CI, and the Docker gate; keep the **>99% coverage gate**.

### 1.2 Out of scope (deferred)

- The Nexus orchestrator, the Pulse, and real Tendrils (**S3**). S2 ships the
  `tendril` tag and the `reinforce` feedback API; **per-Tendril specialization**
  (auto-injecting a specialist's own lessons) activates in S3 when Tendrils exist.
- The Board / tickets (**S3/S5**).
- Postgres/MariaDB drivers for multi-host (**later**) — the `SqlDriver` port makes
  them additive; S2 ships only the embedded SQLite drivers.
- Channels, gateway, dashboard (**S4+**).

---

## 2. Goals & non-goals

**Goals**

- Persistence requires **no external database** and no native npm addon: the
  embedded SQLite is a runtime built-in on both Node and Bun.
- A recorded S1 session **survives a process restart** and replays to identical
  state from disk, with no change to S1 callers.
- A grounded fact written to VECNA in one turn is **automatically recalled and
  injected** into a later turn — the model never calls a memory tool.
- Recall **degrades gracefully**: pure-JS cosine vector recall when an embedder is
  configured; lexical (FTS5) + decay otherwise. The system is always functional.
- Determinism preserved: tests run against real SQLite (temp files) with the
  built-in deterministic `FakeEmbedder`; the real `TransformersEmbedder` is opt-in.

**Non-goals**

- Not optimizing recall latency/quality beyond the blended baseline (correctness
  and graceful degradation first).
- No background/cron decay job — decay is computed at query time.
- No multi-host replication or external DB in S2.

---

## 3. The vertical slice — S2's definition of done

Extends the S1 `probe-agent` slice. Using a durable on-disk database:

```
GIVEN  probe-agent backed by SqliteEventStore (VINES) + VecnaStore (VECNA)
WHEN   asked "How much disk space is free on this machine?" (run #1)
THEN   the grounded, cited answer is written back to VECNA as a fragment;
AND    the session is durably recorded (events on disk).

WHEN   the process is restarted (a fresh DB handle on the same file) and the same
       question is asked again (run #2)
THEN   the runtime auto-recalls run #1's fragment and injects it into the prompt
       (observable in the turn's assembled system prompt / trace);
AND    the session from run #1 replays deterministically from disk to identical
       state;
AND    the entire flow passes on Windows, macOS, and Linux under the >99% coverage
       gate, with a black-box functional test proving cross-process persistence.
```

A companion **opt-in test** (with `@huggingface/transformers` installed) exercises
true semantic recall via the real `TransformersEmbedder`; CI uses the deterministic
built-in `FakeEmbedder` across the full vector pipeline.

---

## 4. Package & module layout

Dependency DAG: **`core ← state ← memory`**. `core` stays dependency-free; it only
gains the `MemoryPort` interface that `memory` implements, so the agent never
imports `memory`.

```
packages/state/                       # VINES — persistence foundation
  src/
    driver/
      driver.ts        # SqlDriver / SqlStatement ports + openDatabase()
      select.ts        # runtime selection: bun:sqlite vs node:sqlite
    migrate.ts         # forward-only migration runner (_migrations table)
    event-store.ts     # SqliteEventStore implements core's EventStore
    schema.ts          # migration definitions (versioned)
    index.ts
  test/ ...

packages/memory/                      # VECNA — decay-aware memory
  src/
    fragment.ts        # Fragment type + Zod schema
    embedder.ts        # Embedder port + FakeEmbedder + cosineSimilarity
    transformers-embedder.ts  # real TransformersEmbedder (optional peer dep)
    recall.ts          # blended scoring (relevance + importance*decay + tags)
    store.ts           # VecnaStore: remember / recall / reinforce
    memory-port.ts     # adapter: VecnaStore -> core MemoryPort
    index.ts
  test/ ...

packages/core/src/
    memory/port.ts     # NEW: MemoryPort interface (no deps)
    eval/agent.ts      # MODIFIED: optional memory hook (recall+inject, write-back)
```

**Responsibility boundaries:** `driver` knows only SQLite; `migrate` knows only
schema versioning; `event-store` adapts the log to a table; `embedder` knows only
text→vector (+ cosine); `recall` is pure scoring; `store` orchestrates; `memory-port`
adapts to core's interface. Each is independently testable.

---

## 5. The `SqlDriver` port (S2.0)

A deliberately tiny synchronous port — both `bun:sqlite` and `node:sqlite` are
synchronous, which suits an embedded single-writer store.

```ts
export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}
export interface SqlStatement {
  run(...params: unknown[]): SqlRunResult;
  get(...params: unknown[]): unknown; // first row or undefined
  all(...params: unknown[]): unknown[]; // all rows
}
export interface SqlDriver {
  exec(sql: string): void; // multi-statement DDL/pragmas
  prepare(sql: string): SqlStatement;
  loadExtension(path: string): void; // generic; unused by memory (pure-JS vectors)
  transaction<T>(fn: () => T): T; // wraps BEGIN/COMMIT/ROLLBACK
  close(): void;
}

export interface OpenOptions {
  path: string; // file path, or ":memory:"
  allowExtension?: boolean; // default false
}
export function openDatabase(opts: OpenOptions): SqlDriver;
```

**Runtime selection** (`select.ts`): `typeof Bun !== "undefined"` → `bun:sqlite`,
else `node:sqlite`. The concrete module is loaded by dynamic `import()` so the
unused runtime's module is never resolved. Both are wrapped to the `SqlDriver`
shape (their native APIs differ slightly: `node:sqlite`'s `DatabaseSync` vs
`bun:sqlite`'s `Database`). Callers depend only on the port.

**Why synchronous + single-writer:** matches the S1 single-writer session model
(§8.4 of the S1 spec) — one embedded writer avoids SQLite write-contention and
keeps the event-sourced aggregate's integrity guarantees.

**Tests** use the **real** `node:sqlite` against `:memory:` and temp files — no
fake driver. This exercises the genuine SQL, exactly as production runs.

---

## 6. Migrations (S2.0)

Forward-only, deterministic, transactional.

```ts
export interface Migration {
  version: number; // strictly increasing, contiguous from 1
  name: string;
  up: string; // SQL executed once, in a transaction
}
export function migrate(db: SqlDriver, migrations: Migration[]): void;
```

`migrate` ensures a `_migrations(version INTEGER PRIMARY KEY, name TEXT, at INTEGER)`
table, then applies every migration whose `version` exceeds the current max — each
inside `db.transaction`, recording the row on success. Re-running is a no-op
(idempotent). Schema lives in `state/src/schema.ts` so both VINES and VECNA tables
are created by versioned migrations.

---

## 7. VINES — `SqliteEventStore` (S2.1)

Implements the S1 `EventStore` interface verbatim:

```ts
interface EventStore {
  append(event: DomainEvent): Promise<void>;
  read(sessionId: string): Promise<DomainEvent[]>;
}
```

Schema (migration v1):

```sql
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT, -- global append order
  session_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,                      -- JSON of the full DomainEvent
  at         INTEGER NOT NULL
);
CREATE INDEX events_by_session ON events (session_id, seq);
```

`append` inserts `(session_id, type, JSON.stringify(event), event.at)`; `read`
selects by `session_id` ordered by `seq` and `JSON.parse`s each `payload`. Because
the S1 `Session` writes only through `append` and rebuilds state by folding
`read`, **swapping `InMemoryEventStore` → `SqliteEventStore` needs no other
change**. Acceptance: run a session, open a fresh `SqliteEventStore` on the same
file, `rebuildState` → deep-equal the live state (durable replay across restart).

---

## 8. VECNA — memory store (S2.2)

### 8.1 The fragment

```ts
interface Fragment {
  id: string;
  text: string; // the remembered content
  tendril?: string; // owning specialist (set now; used by S3)
  tags: string[]; // topic tags for overlap scoring
  importance: number; // 0..1, mutated by reinforce()
  trust: Trust; // reuse core's provenance trust level
  taint: boolean; // untrusted-origin -> down-ranked
  createdAt: number;
  lastUsedAt: number;
  uses: number; // reinforcement count
}
```

Schema: migration **v1** (S2.2) creates the `fragments` table + the FTS5 virtual
table `fragments_fts(text, content='fragments', content_rowid='rowid')` kept in sync
by triggers. Migration **v2** (S2.3) adds a nullable `embedding BLOB` column for the
JS-cosine vector path (§9.2) — no separate vector table.

### 8.2 API

```ts
interface VecnaStore {
  remember(input: {
    text: string;
    tendril?: string;
    tags?: string[];
    importance?: number; // default 0.5
    provenance?: Provenance; // default {trust:"tool", taint:false}
  }): Promise<Fragment>;

  recall(query: {
    text: string;
    tendril?: string; // bias toward this specialist's fragments
    k?: number; // default 5
    now?: number; // injected clock for deterministic decay
  }): Promise<ScoredFragment[]>;

  reinforce(id: string, delta: number, now?: number): Promise<void>; // learning loop
}
```

### 8.3 Decay & ranking

Decay is computed **at query time** (no background job). With injected `now`:

```
ageDays   = (now - lastUsedAt) / 86_400_000
decay     = 0.5 ** (ageDays / HALF_LIFE_DAYS)         // default HALF_LIFE_DAYS = 7
score     = wV*vecSim + wF*bm25Norm + wI*(importance*decay) + wT*tagOverlap
            - (taint ? TAINT_PENALTY : 0)
            + (tendril matches query.tendril ? TENDRIL_BONUS : 0)
```

Weights are fixed constants in S2 (`recall.ts`), documented and unit-tested in
isolation (pure function over candidate rows). `reinforce` bumps `importance`
(clamped to ≤1), sets `lastUsedAt = now`, increments `uses` — the feedback signal
from a reused/approved fragment, which S3 will drive from approval/audit outcomes.

---

## 9. Embeddings + recall (S2.3)

> **Pivot (2026-06-09):** S2.3 uses **pure-JS embeddings + JS cosine similarity over
> Float32 BLOBs**, not the native `sqlite-vec` extension. Grounding spikes showed
> `bun:sqlite` refuses to load dynamic extensions ("this build of sqlite3 does not
> support dynamic extension loading"), so sqlite-vec would only work under the Node
> runtime — the shipped **Bun binary** would silently fall back to lexical. A pure-JS
> path works **identically on Node and Bun** (and the binary), at the cost of
> brute-force similarity (fine at S2 store sizes). See decision §12.2.

### 9.1 Embedder port

```ts
interface Embedder {
  readonly dims: number;
  embed(text: string): Promise<Float32Array>;
}
```

- **`FakeEmbedder`** (built-in, zero-dependency): a deterministic text → vector hash.
  Powers reproducible recall tests **and the >99% coverage gate** on the full vector
  pipeline under both Node and Bun (no model download, no network).
- **`TransformersEmbedder`** (real, production): wraps `@huggingface/transformers`
  (e.g. `all-MiniLM-L6-v2`, 384-dim) running on ONNX/WASM — self-contained, so it
  works in the shipped binary with no external service and no native extension.
  `@huggingface/transformers` is an **optional peer dependency** (lazy-imported; a
  clear error if absent) so it never bloats CI; its file is coverage-excluded and
  exercised by **opt-in** tests, mirroring S1's live-Ollama pattern.
- `cosineSimilarity(a, b)` is a pure helper shared by the store.

### 9.2 Embedding storage

Migration **v2** adds a nullable `embedding BLOB` column to `fragments`. On
`remember`, when an embedder is configured, the store stores
`Buffer.from(embedder.embed(text).buffer)`; rows reconstruct via
`new Float32Array(blob.buffer, blob.byteOffset, dims)`. Fragments written without an
embedder have `embedding = NULL` and are only reachable via the lexical path.

### 9.3 Recall path

- **Vector mode** (an embedder is configured): embed the query, **brute-force
  cosine** over every fragment with an embedding, and feed each as a `Candidate`
  whose `relevance` is its cosine similarity. Brute force is O(n) per query —
  acceptable at S2 store sizes; an ANN index is a later optimization.
- **Lexical fallback** (no embedder): the S2.2 path — FTS5 `MATCH` → candidates whose
  `relevance` derives from `bm25`.
- Both modes feed the **same** §8.3 blended scorer. To unify them, `Candidate`
  carries a normalized `relevance` (higher = better) instead of a raw `bm25`; the
  store computes `relevance` per mode (cosine, or a transform of `bm25`). The
  `recall()` signature and ranking shape are identical — callers can't tell which
  path ran except via a logged note.

---

## 10. Auto-injection + write-back (S2.4)

`@openhawkins/core` gains a dependency-free port:

```ts
// core/src/memory/port.ts
export interface MemoryPort {
  recall(query: { text: string; tendril?: string; k?: number }): Promise<string[]>;
  remember(fact: { text: string; tendril?: string; tags?: string[] }): Promise<void>;
}
```

`Agent.ask` (S1) gains an **optional** `memory?: MemoryPort`:

1. **Before** the turn: `const recalled = await memory.recall({ text: input })`;
   prepend recalled fragments to the system prompt under a clear
   "Relevant remembered context:" header (still subject to Eleven — recalled text
   is a _hint_, never a substitute for a grounded tool call; tainted fragments are
   already down-ranked at recall).
2. **After** acceptance: `await memory.remember({ text: <grounded answer> })` and
   `reinforce` any fragment that was reused — closing the learning loop.

`memory` provides `vecnaMemoryPort(store)` adapting `VecnaStore` to `MemoryPort`.
Wiring lives at the call site (the eval harness now, the gateway later) — core
never imports `memory`. The slice (§3) proves recall-across-restart end-to-end.

---

## 11. Cross-platform, toolchain & error handling

- **Node 24 bump:** `engines.node` → `>=22.5`, CI matrix `node 20 → 24`,
  `Dockerfile.test` → `node:24-slim`. Rationale: `node:sqlite` is stable/unflagged
  in Node 24 (experimental behind a flag in 22.5+). Bun unchanged (`bun:sqlite` is
  always present); the bun CI job and `--compile` path are unaffected.
- **Error handling / graceful degradation:**
  - No embedder configured → lexical (FTS5) recall. Never a crash.
  - DB writes go through `db.transaction`; a failed migration rolls back.
  - A corrupt/unreadable DB is **surfaced** (thrown), never silently recreated —
    we don't destroy a user's data to "recover."
  - Embedding/recall failures inside `Agent.ask` are non-fatal: the turn proceeds
    without injected memory rather than failing the user's request.
- **Coverage:** the **>99% gate stays**. Real SQLite temp-file DBs and the built-in
  deterministic `FakeEmbedder` cover the **full vector pipeline** (embed → store BLOB
  → cosine → rank) under both Node and Bun — no native extension, no model download.
  The lexical-fallback path (no embedder) is covered too. The real
  `TransformersEmbedder` (`@huggingface/transformers`, optional peer dep) is
  coverage-excluded and exercised by **opt-in** tests (like S1's live-Ollama).

---

## 12. Decisions (resolved 2026-06-08)

1. **SQLite = `SqlDriver` port over built-ins** (`bun:sqlite` binary /
   `node:sqlite` dev-test). No native npm addon; keeps the single-binary story
   clean (ADR 0001). Cost accepted: **Node 24**. Native `better-sqlite3` and WASM
   SQLite were considered and rejected (CI/binary-bundling risk; perf/durability,
   respectively).
2. **Embeddings now, via pure-JS vectors + JS cosine over Float32 BLOBs**
   (revised 2026-06-09). The original plan (sqlite-vec native extension +
   `OllamaEmbedder`) was **rejected once grounding showed `bun:sqlite` cannot load
   dynamic extensions** — sqlite-vec would only work under Node, leaving the shipped
   Bun binary on lexical recall. A pure-JS path (brute-force cosine, a built-in
   deterministic `FakeEmbedder`, and an optional `TransformersEmbedder` for a real
   self-contained model) works **identically on Node, Bun, and the binary**, fully
   CI-tested. **Lexical FTS5 + decay remains the always-available fallback** when no
   embedder is configured. Trade-off accepted: brute-force O(n) similarity (fine at
   S2 store sizes; ANN is a later optimization).
3. **Full S2 + wire into the S1 Agent.** Build VINES + VECNA and prove them
   through `Agent.ask` end-to-end this round; per-Tendril specialization waits for
   S3 (the `tendril` tag and `reinforce` API ship now).
4. **Decay at query time**, fixed weights, injected clock — no background job;
   deterministic and testable.
5. **`MemoryPort` lives in core; `memory` implements it.** Keeps the dependency DAG
   `core ← state ← memory` acyclic and the agent decoupled from VECNA.

---

## 13. Milestones (suggested order for the implementation plan)

1. **S2.0** — `SqlDriver` port + runtime selection + migration runner; **Node 24**
   bump (engines/CI/Docker). Real-SQLite tests.
2. **S2.1** — `SqliteEventStore` (VINES) implementing core's `EventStore`; durable
   replay-across-reopen acceptance.
3. **S2.2** — VECNA `fragments` schema + `remember`/`recall` (FTS5 + decay) +
   `reinforce`; pure ranking unit tests.
4. **S2.3** — `Embedder` port (built-in `FakeEmbedder`; optional `TransformersEmbedder`)
   - pure-JS cosine vector recall over Float32 BLOBs (migration v2) with FTS5 lexical
     fallback; `Candidate` generalized to a normalized `relevance`.
5. **S2.4** — core `MemoryPort` + `Agent.ask` auto-injection & write-back; the
   "remembers across restart" slice + black-box functional test; green on 3 OSes
   under the >99% coverage gate.

Each milestone is independently reviewable and lands via its own PR through the
required `docker-gate` (now including the coverage gate).
