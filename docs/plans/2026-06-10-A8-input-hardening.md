# A8 — Input hardening (F-M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the converter input-handling foot-guns — the `csv.ts` `RangeError` on large CSVs, unbounded input size across all converters, and unbounded XML nesting depth — closing review finding **F-M2**.

**Architecture:** Three bounded fixes in `packages/markdownify`, all preserving the registry's "convert never throws" guarantee:

1. **CSV `RangeError`.** `Math.max(...rows.map((r) => r.length))` spreads one argument per row; past the engine's argument limit (~10^5) it throws `RangeError`. Replace the spread with a `reduce` — O(n), no argument-count ceiling.
2. **Input-size cap.** No converter bounds its input, so a huge document drives unbounded CPU/memory in the parsers (turndown, fast-xml-parser, the CSV scanner). Add a `maxInputChars` ceiling to `ConverterRegistry`: an over-cap input short-circuits to truncated raw text with a warning, before any parser runs — a uniform DoS bound that needs no per-converter change.
3. **XML nesting depth.** `xml.ts`'s `render` recurses once per nesting level; a deeply-nested document (within the size budget — `<a><a>…`) can overflow the stack. Add a `MAX_DEPTH` guard that emits a truncation marker and stops descending.

**Scope (honest):** This is the **F-M2** half of roadmap item A8. The **F-M3** citation fix (verify a cited numeric value against the _referenced field_, not anywhere in the payload) is a separate change to the core grounding contract (claim schema + scripted model + the model-facing prompt fragments) and lands as its own follow-up PR.

**Tech Stack:** TypeScript (strict ESM, `.js` specifiers), Vitest.

---

## File Structure

- `packages/markdownify/src/converters/csv.ts` — `Math.max(...spread)` → `reduce`.
- `packages/markdownify/src/registry.ts` — `maxInputChars` ceiling in `convert`.
- `packages/markdownify/src/converters/xml.ts` — `MAX_DEPTH` guard in `render`.
- Tests: `test/converters/csv.test.ts`, `test/registry.test.ts`, `test/converters/xml.test.ts`.

---

### Task 1: Fix the CSV `RangeError` (spread → reduce)

**Files:**

- Modify: `packages/markdownify/src/converters/csv.ts`
- Test: `packages/markdownify/test/converters/csv.test.ts`

- [ ] **Step 1: Write the failing test (RED)**

Add to `packages/markdownify/test/converters/csv.test.ts`:

```ts
it("handles a very large CSV without a RangeError (no argument-count spread)", async () => {
  // 200k single-column rows: `Math.max(...rows.map(...))` spreads 200k args and throws
  // RangeError on V8; `reduce` is unbounded. Build the input cheaply.
  const big = Array.from({ length: 200_000 }, (_, i) => `r${i}`).join("\n");
  const { markdown } = await csvConverter.convert(big);
  expect(markdown.startsWith("| r0 |")).toBe(true); // header is the first row
  expect(markdown.split("\n")).toHaveLength(200_001); // header + sep + 199_999 body rows
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run csv.test.ts`
Expected: FAIL — the `convert` promise rejects with `RangeError: Maximum call stack size exceeded`
(the spread of 200k arguments).

- [ ] **Step 3: Replace the spread with a reduce**

In `packages/markdownify/src/converters/csv.ts`, change the width computation:

```ts
// reduce (not `Math.max(...spread)`): a spread of one argument per row throws a
// RangeError past the engine's argument-count limit on a large CSV (review F-M2).
const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run csv.test.ts`
Expected: PASS (the new case + all existing csv cases).

- [ ] **Step 5: Build + Prettier**

Run: `npm run build && npx prettier --check packages/markdownify/src/converters/csv.ts packages/markdownify/test/converters/csv.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/markdownify/src/converters/csv.ts packages/markdownify/test/converters/csv.test.ts
git commit -m "fix(markdownify): CSV width via reduce, not Math.max spread (F-M2)"
```

---

### Task 2: Input-size cap (registry) + XML nesting-depth cap

**Files:**

- Modify: `packages/markdownify/src/registry.ts`
- Modify: `packages/markdownify/src/converters/xml.ts`
- Test: `packages/markdownify/test/registry.test.ts`, `test/converters/xml.test.ts`

- [ ] **Step 1: Write the failing tests (RED)**

Add to `packages/markdownify/test/registry.test.ts`:

```ts
it("caps oversized input: degrades to truncated text with a warning", async () => {
  const reg = new ConverterRegistry(textConverter, 10).register(upper);
  // lowercase input so "not uppercased" proves the `upper` converter did NOT run
  const out = await reg.convert({ data: "abcdefghijklmnop", mime: "text/upper" });
  expect(out.format).toBe("text"); // did NOT run the upper converter
  expect(out.markdown).toBe("abcdefghij"); // truncated to the 10-char cap, still lowercase
  expect(out.warnings[0]).toMatch(/exceeds cap/);
});

it("does not cap input at or below the ceiling", async () => {
  const reg = new ConverterRegistry(textConverter, 10).register(upper);
  const out = await reg.convert({ data: "abc", mime: "text/upper" });
  expect(out).toMatchObject({ markdown: "ABC", format: "upper" }); // normal path: uppercased
});
```

Add to `packages/markdownify/test/converters/xml.test.ts` (match the file's existing import of
`xmlConverter`):

```ts
it("caps deeply-nested XML instead of overflowing the stack", async () => {
  const deep = "<a>".repeat(500) + "x" + "</a>".repeat(500);
  const { markdown } = await xmlConverter.convert(deep);
  expect(markdown).toContain("[truncated: max nesting depth");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run registry.test.ts xml.test.ts`
Expected: FAIL — `ConverterRegistry` takes no size cap (oversized input runs `upper`), and `render`
has no depth guard (the marker is absent; a deep-enough input could also overflow).

- [ ] **Step 3: Add the input-size cap to `ConverterRegistry`**

In `packages/markdownify/src/registry.ts`, add a module-level default and a constructor
parameter, and short-circuit at the top of `convert`. The `asString` import already exists.

Add near the top (after the imports):

```ts
/** Default input ceiling (characters / bytes): generous for real documents, a hard DoS
 *  bound against a pathological one. Tunable per registry. */
const DEFAULT_MAX_INPUT_CHARS = 5_000_000;
```

Change the constructor:

```ts
  constructor(
    private readonly fallback: Converter,
    private readonly maxInputChars: number = DEFAULT_MAX_INPUT_CHARS,
  ) {}
```

At the very top of `convert(input)`, before the existing `const warnings: string[] = []` /
`try` block, add:

```ts
// Bound input before any parser runs: `.length` is the char count for a string and the
// byte count for a Uint8Array, so this caps both without decoding (review F-M2).
if (input.data.length > this.maxInputChars) {
  return {
    markdown: asString(input.data).slice(0, this.maxInputChars),
    format: "text",
    warnings: [
      `input of ${input.data.length} exceeds cap ${this.maxInputChars}; truncated to text`,
    ],
  };
}
```

- [ ] **Step 4: Add the depth cap to the XML converter**

In `packages/markdownify/src/converters/xml.ts`, add a module-level constant and a guard at the
top of `render`:

```ts
/** Hard ceiling on XML nesting depth: `render` recurses once per level, so a pathologically
 *  deep document (within the size budget) could overflow the stack (review F-M2). */
const MAX_DEPTH = 256;
```

```ts
function render(node: unknown, depth: number, lines: string[], name?: string): void {
  if (depth > MAX_DEPTH) {
    lines.push(`${"  ".repeat(depth)}- [truncated: max nesting depth ${MAX_DEPTH}]`);
    return;
  }
  const indent = "  ".repeat(depth);
  // ...unchanged...
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run registry.test.ts xml.test.ts`
Expected: PASS (the new cases + all existing registry/xml cases).

- [ ] **Step 6: Build + Prettier**

Run: `npm run build && npx prettier --check packages/markdownify/src/registry.ts packages/markdownify/src/converters/xml.ts packages/markdownify/test/registry.test.ts packages/markdownify/test/converters/xml.test.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/markdownify/src/registry.ts packages/markdownify/src/converters/xml.ts \
  packages/markdownify/test/registry.test.ts packages/markdownify/test/converters/xml.test.ts
git commit -m "feat(markdownify): input-size cap + XML depth cap (F-M2)"
```

---

### Task 3: Roadmap + full gate

**Files:**

- Modify: `docs/reviews/2026-06-09-production-readiness-review.md`

- [ ] **Step 1: Update the A8 roadmap line**

In `docs/reviews/2026-06-09-production-readiness-review.md`, replace the A8 line (item 8) with:

```md
8. **A8 — Input hardening (F-M2) ✅ DONE (PR pending) + citation fix (F-M3, next PR).** F-M2 closed: CSV column width is computed with `reduce` (no `Math.max(...spread)` `RangeError` on a large CSV); `ConverterRegistry` enforces a tunable `maxInputChars` ceiling (default 5,000,000) that degrades an oversized input to truncated text with a warning before any parser runs; and the XML renderer caps nesting depth (256) with a truncation marker so a deeply-nested document can't overflow the stack. **F-M3 (next PR)** — verify a cited numeric value against the _referenced field_ (the claim gains a field reference), not anywhere in the tool-result payload; touches the claim schema, the scripted model, and the model-facing grounding prompt fragments.
```

- [ ] **Step 2: Full repo gate**

Run:

```bash
npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional
```

Expected: all green, coverage 100%.

- [ ] **Step 3: Docker gate**

Run: `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test`
Expected: `✅ ALL GATES PASSED`

- [ ] **Step 4: Commit**

```bash
git add docs/reviews/2026-06-09-production-readiness-review.md
git commit -m "docs(review): A8 input hardening done (F-M2); F-M3 citation fix next"
```
