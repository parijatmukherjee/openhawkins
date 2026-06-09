# Markdownify M1 — Registry + Text Converters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `@openhawkins/markdownify` — a self-contained TS document→Markdown converter — with its `Converter`/registry/detection core and the five **text-format** converters (text, HTML, CSV, JSON, XML), so any text-ish document can be turned into token-lean Markdown that never throws.

**Architecture:** A standalone workspace package with no workspace dependency. A `ConverterRegistry` picks a `Converter` by mime → file extension → content sniff, falling back to a plain-text converter; `markdownify()` runs the chosen converter inside a try/catch so a bad document degrades to text + a warning rather than throwing. Each converter is a small, independently-tested unit. M2 (Office) and M3 (PDF + CLI) add converters to the same registry later.

**Tech Stack:** TypeScript (strict) · `turndown` (HTML) · `fast-xml-parser` (XML) · Vitest · the existing >99% coverage gate. (CSV/JSON/text are hand-rolled — no dep.)

**Spec:** [`docs/specs/2026-06-09-markdownify-design.md`](../specs/2026-06-09-markdownify-design.md) — §3 (architecture), §4 (text converters), §5 (never-throws), §6 (testing). Spike (§2) verified `turndown` + `fast-xml-parser` on Node + Bun.

> **Workflow note:** `main` is protected — lands via a PR whose required `docker-gate` (build + lint + format + **coverage >99%** + unit + functional) must pass. Work on `markdownify` (already created; the spec is its first commit). Per-task commits, then open the PR. Pure-JS converters run identically on the node and bun CI jobs.

---

## File Structure (created by this plan)

```
packages/markdownify/
  package.json            # @openhawkins/markdownify (deps: turndown, fast-xml-parser)
  tsconfig.json           # extends base
  tsconfig.test.json      # typecheck src+test
  src/
    types.ts              # MarkdownResult, ConvertInput, Converter
    detect.ts             # extOf(filename), sniff(text) -> format hint
    registry.ts           # ConverterRegistry: pick + never-throws convert()
    converters/
      text.ts             # plain-text fallback converter
      html.ts             # HTML  -> MD (turndown)
      csv.ts              # CSV   -> MD table (hand-rolled)
      json.ts             # JSON  -> MD (hand-rolled, structured)
      xml.ts              # XML   -> MD (fast-xml-parser)
    markdownify.ts        # default registry + markdownify() public fn
    index.ts              # barrel
  test/ ...
tsconfig.json             # root: + references to packages/markdownify (+ test)
```

**Responsibility boundaries:** `types` is interfaces only; `detect` is pure string helpers; each `converters/*` is one format; `registry` orchestrates pick + never-throws; `markdownify` wires the default registry. Each is independently testable with inline string inputs (no fixtures needed in M1).

---

### Task 1: Scaffold `@openhawkins/markdownify`

**Files:**

- Create: `packages/markdownify/package.json`
- Create: `packages/markdownify/tsconfig.json`
- Create: `packages/markdownify/tsconfig.test.json`
- Create: `packages/markdownify/src/index.ts`
- Modify: `tsconfig.json` (root)

- [ ] **Step 1: Create `packages/markdownify/package.json`**

```json
{
  "name": "@openhawkins/markdownify",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": { "build": "tsc -b" },
  "dependencies": {
    "fast-xml-parser": "^4.5.0",
    "turndown": "^7.2.0"
  }
}
```

- [ ] **Step 2: Create `packages/markdownify/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/markdownify/tsconfig.test.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "composite": false
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Create the barrel `packages/markdownify/src/index.ts`**

```ts
export * from "./types.js";
export * from "./registry.js";
export * from "./markdownify.js";
```

- [ ] **Step 5: Add `markdownify` to the root build graph**

In the root `tsconfig.json`, extend `references` to include the new package and its test config (keep the existing entries):

```json
{
  "files": [],
  "references": [
    { "path": "packages/core" },
    { "path": "packages/core/tsconfig.test.json" },
    { "path": "packages/state" },
    { "path": "packages/state/tsconfig.test.json" },
    { "path": "packages/memory" },
    { "path": "packages/memory/tsconfig.test.json" },
    { "path": "packages/markdownify" },
    { "path": "packages/markdownify/tsconfig.test.json" }
  ]
}
```

- [ ] **Step 6: Install + verify the type stubs resolve**

Run (repo root): `npm install`
Expected: completes; `node_modules/@openhawkins/markdownify` symlink exists; `turndown`, `fast-xml-parser`, and `@types/turndown` resolve (`@types/turndown` comes in transitively or is added — if `npm run build` later complains about missing turndown types, add `"@types/turndown": "^5.0.5"` to `devDependencies` and re-install). Commit the lockfile.

Note: `npm run build` FAILS after this step (the barrel imports `types.js`/`registry.js`/`markdownify.js` which don't exist until Tasks 2–7). Expected — verify only the symlink: `ls -la node_modules/@openhawkins/` shows `markdownify -> ../../packages/markdownify`.

- [ ] **Step 7: Commit**

```bash
git add packages/markdownify/package.json packages/markdownify/tsconfig.json packages/markdownify/tsconfig.test.json packages/markdownify/src/index.ts tsconfig.json package-lock.json
git commit -m "chore(markdownify): scaffold @openhawkins/markdownify package"
```

---

### Task 2: Types + detection

**Files:**

- Create: `packages/markdownify/src/types.ts`
- Create: `packages/markdownify/src/detect.ts`
- Test: `packages/markdownify/test/detect.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/markdownify/test/detect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extOf, sniff } from "../src/detect.js";

describe("extOf", () => {
  it("returns the lowercased extension without the dot", () => {
    expect(extOf("Report.HTML")).toBe("html");
    expect(extOf("/a/b/data.csv")).toBe("csv");
  });
  it("returns undefined when there is no usable extension", () => {
    expect(extOf("noext")).toBeUndefined();
    expect(extOf(undefined)).toBeUndefined();
    expect(extOf("trailingdot.")).toBeUndefined();
  });
});

describe("sniff", () => {
  it("detects xml, html, and json from leading content", () => {
    expect(sniff('<?xml version="1.0"?><a/>')).toBe("xml");
    expect(sniff("  <!DOCTYPE html><html></html>")).toBe("html");
    expect(sniff("<div>hi</div>")).toBe("html");
    expect(sniff('  {"a":1}')).toBe("json");
    expect(sniff("[1,2,3]")).toBe("json");
  });
  it("returns undefined for plain prose", () => {
    expect(sniff("just some text")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/markdownify/test/detect.test.ts`
Expected: FAIL — cannot find module `detect.js`.

- [ ] **Step 3: Write `packages/markdownify/src/types.ts`**

```ts
/** The result of converting a document to Markdown. */
export interface MarkdownResult {
  markdown: string;
  /** The converter that ran (e.g. "html", "text"). */
  format: string;
  /** Non-fatal issues (e.g. a converter failed and the input was treated as text). */
  warnings: string[];
  /** Best-effort document title, when the converter can determine one. */
  title?: string;
}

/** Input to `markdownify`: raw bytes (binary formats) or a string, plus hints. */
export interface ConvertInput {
  data: Uint8Array | string;
  mime?: string;
  filename?: string;
}

/** A single-format converter registered with the `ConverterRegistry`. */
export interface Converter {
  readonly format: string;
  /** True if this converter handles the given mime and/or file extension. */
  accepts(d: { mime?: string; ext?: string }): boolean;
  /** Convert raw input to Markdown. May throw; the registry catches and degrades. */
  convert(data: Uint8Array | string): Promise<{ markdown: string; title?: string }>;
}
```

- [ ] **Step 4: Write `packages/markdownify/src/detect.ts`**

```ts
/** Lowercased file extension (no dot), or undefined when there isn't a usable one. */
export function extOf(filename: string | undefined): string | undefined {
  if (filename === undefined) {
    return undefined;
  }
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) {
    return undefined;
  }
  return filename.slice(dot + 1).toLowerCase();
}

/** A light content sniff for text formats, used only when mime/extension don't decide. */
export function sniff(text: string): "xml" | "html" | "json" | undefined {
  const head = text.trimStart();
  if (head.startsWith("<?xml")) {
    return "xml";
  }
  if (head.startsWith("<")) {
    return "html";
  }
  if (head.startsWith("{") || head.startsWith("[")) {
    return "json";
  }
  return undefined;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/markdownify/test/detect.test.ts`
Expected: PASS (extOf 2 + sniff 2 = 4 tests). `detect.ts` is 100% covered (every `extOf` early-return and every `sniff` branch is exercised). `types.ts` is interfaces only.

- [ ] **Step 6: Commit**

```bash
git add packages/markdownify/src/types.ts packages/markdownify/src/detect.ts packages/markdownify/test/detect.test.ts
git commit -m "feat(markdownify): result/converter types + mime/ext/sniff detection"
```

---

### Task 3: The plain-text converter

**Files:**

- Create: `packages/markdownify/src/converters/text.ts`
- Test: `packages/markdownify/test/converters/text.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/markdownify/test/converters/text.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { textConverter } from "../../src/converters/text.js";

describe("textConverter", () => {
  it("passes a string through unchanged", async () => {
    expect(await textConverter.convert("hello\nworld")).toEqual({ markdown: "hello\nworld" });
  });
  it("decodes bytes as UTF-8", async () => {
    const bytes = new TextEncoder().encode("héllo");
    expect(await textConverter.convert(bytes)).toEqual({ markdown: "héllo" });
  });
  it("accepts anything (it is the fallback)", () => {
    expect(textConverter.accepts({ mime: "anything/at-all" })).toBe(true);
    expect(textConverter.accepts({})).toBe(true);
    expect(textConverter.format).toBe("text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/markdownify/test/converters/text.test.ts`
Expected: FAIL — cannot find module `text.js`.

- [ ] **Step 3: Write `packages/markdownify/src/converters/text.ts`**

```ts
import type { Converter } from "../types.js";

/** Decode bytes (UTF-8) or accept a string unchanged. Shared by other converters. */
export function asString(data: Uint8Array | string): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

/** The fallback converter: treats input as plain text (already Markdown-friendly). */
export const textConverter: Converter = {
  format: "text",
  accepts: () => true,
  convert: async (data) => ({ markdown: asString(data) }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/markdownify/test/converters/text.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/markdownify/src/converters/text.ts packages/markdownify/test/converters/text.test.ts
git commit -m "feat(markdownify): plain-text fallback converter + asString helper"
```

---

### Task 4: The registry + `markdownify()`

**Files:**

- Create: `packages/markdownify/src/registry.ts`
- Create: `packages/markdownify/src/markdownify.ts`
- Test: `packages/markdownify/test/registry.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/markdownify/test/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ConverterRegistry } from "../src/registry.js";
import { textConverter } from "../src/converters/text.js";
import type { Converter } from "../src/types.js";

const upper: Converter = {
  format: "upper",
  accepts: (d) => d.mime === "text/upper" || d.ext === "up",
  convert: async (data) => ({ markdown: String(data).toUpperCase(), title: "T" }),
};
const boom: Converter = {
  format: "boom",
  accepts: (d) => d.ext === "boom",
  convert: async () => {
    throw new Error("kaboom");
  },
};

function registry(): ConverterRegistry {
  return new ConverterRegistry(textConverter).register(upper).register(boom);
}

describe("ConverterRegistry", () => {
  it("dispatches by mime, then extension, attaching the format + title", async () => {
    expect(await registry().convert({ data: "hi", mime: "text/upper" })).toEqual({
      markdown: "HI",
      format: "upper",
      warnings: [],
      title: "T",
    });
    expect(await registry().convert({ data: "hi", filename: "a.up" })).toMatchObject({
      markdown: "HI",
      format: "upper",
    });
  });

  it("falls back to the text converter when nothing accepts", async () => {
    expect(await registry().convert({ data: "plain words" })).toEqual({
      markdown: "plain words",
      format: "text",
      warnings: [],
    });
  });

  it("uses a content sniff when mime/ext do not decide", async () => {
    const reg = new ConverterRegistry(textConverter).register({
      format: "html",
      accepts: (d) => d.ext === "html",
      convert: async () => ({ markdown: "from-html" }),
    });
    // no mime, no extension, but the content sniffs as html
    expect((await reg.convert({ data: "<p>hi</p>" })).format).toBe("html");
  });

  it("falls back to text when the sniffed format has no registered converter", async () => {
    // registry() has upper + boom but no "html"; "<p>" sniffs as html -> no converter -> text
    expect((await registry().convert({ data: "<p>hi</p>" })).format).toBe("text");
  });

  it("never throws: a failing converter degrades to text + a warning", async () => {
    const res = await registry().convert({ data: "data", filename: "x.boom" });
    expect(res.format).toBe("text");
    expect(res.markdown).toBe("data");
    expect(res.warnings[0]).toMatch(/boom.*failed.*kaboom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/markdownify/test/registry.test.ts`
Expected: FAIL — cannot find module `registry.js`.

- [ ] **Step 3: Write `packages/markdownify/src/registry.ts`**

```ts
import type { Converter, ConvertInput, MarkdownResult } from "./types.js";
import { extOf, sniff } from "./detect.js";
import { asString } from "./converters/text.js";

/**
 * Picks a converter by mime → extension → content sniff (falling back to the
 * supplied fallback converter) and runs it. `convert` NEVER throws: a converter that
 * fails degrades to the fallback plus a warning, so a bad document can't fail a turn.
 */
export class ConverterRegistry {
  private readonly converters: Converter[] = [];

  constructor(private readonly fallback: Converter) {}

  register(c: Converter): this {
    this.converters.push(c);
    return this;
  }

  /** Resolve a converter for the given hints + raw data. */
  pick(input: ConvertInput): Converter {
    const ext = extOf(input.filename);
    const byHint = this.converters.find((c) =>
      c.accepts({
        ...(input.mime !== undefined ? { mime: input.mime } : {}),
        ...(ext !== undefined ? { ext } : {}),
      }),
    );
    if (byHint) {
      return byHint;
    }
    const sniffed = sniff(asString(input.data));
    if (sniffed !== undefined) {
      const bySniff = this.converters.find((c) => c.format === sniffed);
      if (bySniff) {
        return bySniff;
      }
    }
    return this.fallback;
  }

  async convert(input: ConvertInput): Promise<MarkdownResult> {
    const converter = this.pick(input);
    const warnings: string[] = [];
    try {
      const out = await converter.convert(input.data);
      return {
        markdown: out.markdown,
        format: converter.format,
        warnings,
        ...(out.title !== undefined ? { title: out.title } : {}),
      };
    } catch (err) {
      warnings.push(
        `converter "${converter.format}" failed: ${err instanceof Error ? err.message : String(err)}; treated as text`,
      );
      const fb = await this.fallback.convert(input.data);
      return { markdown: fb.markdown, format: this.fallback.format, warnings };
    }
  }
}
```

- [ ] **Step 4: Write `packages/markdownify/src/markdownify.ts`**

This wires the default registry (M1 converters) and exposes the public function. Later milestones add converters here.

```ts
import type { ConvertInput, MarkdownResult } from "./types.js";
import { ConverterRegistry } from "./registry.js";
import { textConverter } from "./converters/text.js";
import { htmlConverter } from "./converters/html.js";
import { csvConverter } from "./converters/csv.js";
import { jsonConverter } from "./converters/json.js";
import { xmlConverter } from "./converters/xml.js";

/** The default registry with all built-in converters; text is the fallback. */
export function defaultRegistry(): ConverterRegistry {
  return new ConverterRegistry(textConverter)
    .register(htmlConverter)
    .register(csvConverter)
    .register(jsonConverter)
    .register(xmlConverter);
}

const registry = defaultRegistry();

/** Convert a document to token-lean Markdown. Never throws. */
export function markdownify(input: ConvertInput): Promise<MarkdownResult> {
  return registry.convert(input);
}
```

Note: `markdownify.ts` imports `html`/`csv`/`json`/`xml` converters created in Tasks 5–7. Until those exist the build fails; that is expected within this task — write `registry.ts` first and run the registry test (which does NOT import `markdownify.ts`), then create the converters in Tasks 5–7, then the full build passes.

- [ ] **Step 5: Run the registry test to verify it passes**

Run: `npx vitest run packages/markdownify/test/registry.test.ts`
Expected: PASS (5 tests). The registry test imports only `registry.ts` + `text.ts`, so it passes now even though `markdownify.ts` won't compile until Tasks 5–7. `registry.ts` is 100% covered: mime-pick, ext-pick, sniff-pick (converter found), sniff→no-converter→fallback, no-hint→fallback, and the never-throws catch.

- [ ] **Step 6: Commit**

```bash
git add packages/markdownify/src/registry.ts packages/markdownify/src/markdownify.ts packages/markdownify/test/registry.test.ts
git commit -m "feat(markdownify): ConverterRegistry (mime/ext/sniff) + never-throws markdownify()"
```

---

### Task 5: HTML converter

**Files:**

- Create: `packages/markdownify/src/converters/html.ts`
- Test: `packages/markdownify/test/converters/html.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/markdownify/test/converters/html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { htmlConverter } from "../../src/converters/html.js";

describe("htmlConverter", () => {
  it("accepts text/html and .html/.htm", () => {
    expect(htmlConverter.accepts({ mime: "text/html" })).toBe(true);
    expect(htmlConverter.accepts({ ext: "htm" })).toBe(true);
    expect(htmlConverter.accepts({ ext: "html" })).toBe(true);
    expect(htmlConverter.accepts({ mime: "text/plain" })).toBe(false);
    expect(htmlConverter.format).toBe("html");
  });

  it("converts headings, emphasis, and links to Markdown", async () => {
    const html = "<h1>Title</h1><p>Hello <strong>world</strong> <a href='/x'>link</a></p>";
    const { markdown } = await htmlConverter.convert(html);
    expect(markdown).toContain("# Title");
    expect(markdown).toContain("**world**");
    expect(markdown).toContain("[link](/x)");
  });

  it("decodes byte input", async () => {
    const bytes = new TextEncoder().encode("<h2>Sub</h2>");
    expect((await htmlConverter.convert(bytes)).markdown).toContain("## Sub");
  });

  it("uses the first heading as the title", async () => {
    expect((await htmlConverter.convert("<h1>My Doc</h1><p>x</p>")).title).toBe("My Doc");
    expect((await htmlConverter.convert("<p>no heading</p>")).title).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/markdownify/test/converters/html.test.ts`
Expected: FAIL — cannot find module `html.js`.

- [ ] **Step 3: Write `packages/markdownify/src/converters/html.ts`**

```ts
import TurndownService from "turndown";
import type { Converter } from "../types.js";
import { asString } from "./text.js";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

/** Extract the text of the first <h1>…<h6> as a best-effort title. */
function firstHeading(html: string): string | undefined {
  const m = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/is.exec(html);
  if (!m) {
    return undefined;
  }
  const text = m[1].replace(/<[^>]+>/g, "").trim();
  return text.length > 0 ? text : undefined;
}

/** HTML → Markdown via turndown (ATX headings, fenced code). */
export const htmlConverter: Converter = {
  format: "html",
  accepts: (d) => d.mime === "text/html" || d.ext === "html" || d.ext === "htm",
  convert: async (data) => {
    const html = asString(data);
    const title = firstHeading(html);
    return { markdown: turndown.turndown(html).trim(), ...(title !== undefined ? { title } : {}) };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/markdownify/test/converters/html.test.ts`
Expected: PASS (4 tests). `html.ts` is 100% covered: the `accepts` mime/ext branches, the heading-found and no-heading (`firstHeading` returns undefined) paths, and the empty-heading guard (covered by `<p>` case which yields no match → undefined).

- [ ] **Step 5: Commit**

```bash
git add packages/markdownify/src/converters/html.ts packages/markdownify/test/converters/html.test.ts
git commit -m "feat(markdownify): HTML -> Markdown converter (turndown) with title"
```

---

### Task 6: CSV + JSON converters

**Files:**

- Create: `packages/markdownify/src/converters/csv.ts`
- Create: `packages/markdownify/src/converters/json.ts`
- Test: `packages/markdownify/test/converters/csv.test.ts`
- Test: `packages/markdownify/test/converters/json.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/markdownify/test/converters/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { csvConverter } from "../../src/converters/csv.js";

describe("csvConverter", () => {
  it("accepts text/csv and .csv", () => {
    expect(csvConverter.accepts({ mime: "text/csv" })).toBe(true);
    expect(csvConverter.accepts({ ext: "csv" })).toBe(true);
    expect(csvConverter.accepts({ ext: "txt" })).toBe(false);
  });

  it("renders rows as a GitHub-flavored Markdown table", async () => {
    const { markdown } = await csvConverter.convert("name,age\nAlice,30\nBob,25");
    expect(markdown).toBe(
      ["| name | age |", "| --- | --- |", "| Alice | 30 |", "| Bob | 25 |"].join("\n"),
    );
  });

  it("escapes pipes in cells and tolerates ragged rows", async () => {
    const { markdown } = await csvConverter.convert("a,b\nx|y,z\nonly");
    expect(markdown).toContain("| x\\|y | z |");
    expect(markdown).toContain("| only |  |");
  });

  it("returns empty markdown for empty input", async () => {
    expect((await csvConverter.convert("")).markdown).toBe("");
  });
});
```

`packages/markdownify/test/converters/json.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { jsonConverter } from "../../src/converters/json.js";

describe("jsonConverter", () => {
  it("accepts application/json and .json", () => {
    expect(jsonConverter.accepts({ mime: "application/json" })).toBe(true);
    expect(jsonConverter.accepts({ ext: "json" })).toBe(true);
    expect(jsonConverter.accepts({ mime: "text/plain" })).toBe(false);
  });

  it("pretty-prints valid JSON inside a fenced block", async () => {
    const { markdown } = await jsonConverter.convert('{"a":1,"b":[2,3]}');
    expect(markdown).toBe('```json\n{\n  "a": 1,\n  "b": [2, 3]\n}\n```');
  });

  it("falls back to a fenced raw block for invalid JSON, with a note", async () => {
    const { markdown } = await jsonConverter.convert("{not json");
    expect(markdown).toBe("```\n{not json\n```");
  });
});
````

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/markdownify/test/converters/csv.test.ts packages/markdownify/test/converters/json.test.ts`
Expected: FAIL — cannot find modules `csv.js` / `json.js`.

- [ ] **Step 3: Write `packages/markdownify/src/converters/csv.ts`**

```ts
import type { Converter } from "../types.js";
import { asString } from "./text.js";

/** Minimal RFC-4180-ish row parser: handles quoted fields with commas/quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const cell = (s: string): string => s.replace(/\|/g, "\\|");

/** CSV → a GitHub-flavored Markdown table (first row is the header). */
export const csvConverter: Converter = {
  format: "csv",
  accepts: (d) => d.mime === "text/csv" || d.ext === "csv",
  convert: async (data) => {
    const rows = parseCsv(asString(data));
    if (rows.length === 0) {
      return { markdown: "" };
    }
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]): string[] => [...r, ...Array(width - r.length).fill("")];
    const line = (r: string[]): string => `| ${pad(r).map(cell).join(" | ")} |`;
    const header = line(rows[0]);
    const sep = `| ${Array(width).fill("---").join(" | ")} |`;
    const body = rows.slice(1).map(line);
    return { markdown: [header, sep, ...body].join("\n") };
  },
};
```

- [ ] **Step 4: Write `packages/markdownify/src/converters/json.ts`**

````ts
import type { Converter } from "../types.js";
import { asString } from "./text.js";

/** JSON → a fenced, pretty-printed block (raw fenced block if it doesn't parse). */
export const jsonConverter: Converter = {
  format: "json",
  accepts: (d) => d.mime === "application/json" || d.ext === "json",
  convert: async (data) => {
    const raw = asString(data);
    try {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      return { markdown: "```json\n" + pretty + "\n```" };
    } catch {
      return { markdown: "```\n" + raw + "\n```" };
    }
  },
};
````

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/markdownify/test/converters/csv.test.ts packages/markdownify/test/converters/json.test.ts`
Expected: PASS (csv 4 + json 3 = 7 tests). Both files 100% covered (csv: quoted/escaped/ragged/empty + accepts branches; json: valid + invalid + accepts branches).

Note: the JSON test expects `[2, 3]` (with a space) — that is exactly `JSON.stringify(JSON.parse('{"a":1,"b":[2,3]}'), null, 2)` output. Verify the exact whitespace if the assertion fails.

- [ ] **Step 6: Commit**

```bash
git add packages/markdownify/src/converters/csv.ts packages/markdownify/src/converters/json.ts packages/markdownify/test/converters/csv.test.ts packages/markdownify/test/converters/json.test.ts
git commit -m "feat(markdownify): CSV (MD table) + JSON (fenced) converters"
```

---

### Task 7: XML converter + the full gate

**Files:**

- Create: `packages/markdownify/src/converters/xml.ts`
- Test: `packages/markdownify/test/converters/xml.test.ts`
- Test: `packages/markdownify/test/markdownify.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/markdownify/test/converters/xml.test.ts`:

````ts
import { describe, it, expect } from "vitest";
import { xmlConverter } from "../../src/converters/xml.js";

describe("xmlConverter", () => {
  it("accepts xml mimes and .xml", () => {
    expect(xmlConverter.accepts({ mime: "application/xml" })).toBe(true);
    expect(xmlConverter.accepts({ mime: "text/xml" })).toBe(true);
    expect(xmlConverter.accepts({ ext: "xml" })).toBe(true);
    expect(xmlConverter.accepts({ ext: "csv" })).toBe(false);
  });

  it("renders nested elements as nested Markdown bullet lists", async () => {
    const { markdown } = await xmlConverter.convert(
      "<note><to>Bob</to><body>hi there</body></note>",
    );
    expect(markdown).toContain("- **note**");
    expect(markdown).toContain("  - **to**: Bob");
    expect(markdown).toContain("  - **body**: hi there");
  });

  it("degrades to a fenced block for unparseable XML", async () => {
    const { markdown } = await xmlConverter.convert("<a><b></a>");
    expect(markdown).toBe("```\n<a><b></a>\n```");
  });
});
````

`packages/markdownify/test/markdownify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { markdownify } from "../src/markdownify.js";

describe("markdownify (default registry)", () => {
  it("routes HTML, CSV, JSON, XML, and plain text", async () => {
    expect((await markdownify({ data: "<h1>Hi</h1>", mime: "text/html" })).markdown).toContain(
      "# Hi",
    );
    expect((await markdownify({ data: "a,b\n1,2", filename: "x.csv" })).markdown).toContain(
      "| a | b |",
    );
    expect((await markdownify({ data: '{"k":1}', mime: "application/json" })).format).toBe("json");
    expect((await markdownify({ data: "<r><c>v</c></r>", filename: "x.xml" })).markdown).toContain(
      "**r**",
    );
    expect(await markdownify({ data: "just text" })).toEqual({
      markdown: "just text",
      format: "text",
      warnings: [],
    });
  });

  it("routes by content sniff when there is no mime or extension", async () => {
    expect((await markdownify({ data: "<p>x</p>" })).format).toBe("html");
    expect((await markdownify({ data: '{"a":1}' })).format).toBe("json");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/markdownify/test/converters/xml.test.ts packages/markdownify/test/markdownify.test.ts`
Expected: FAIL — cannot find module `xml.js` (and `markdownify.js` won't compile until `xml.ts` exists).

- [ ] **Step 3: Write `packages/markdownify/src/converters/xml.ts`**

````ts
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Converter } from "../types.js";
import { asString } from "./text.js";

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

/** Render a parsed XML object as nested Markdown bullets. */
function render(node: unknown, depth: number, lines: string[], name?: string): void {
  const indent = "  ".repeat(depth);
  if (node === null || typeof node !== "object") {
    lines.push(`${indent}- **${name}**: ${String(node)}`);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      render(item, depth, lines, name);
    }
    return;
  }
  if (name !== undefined) {
    lines.push(`${indent}- **${name}**`);
  }
  for (const [key, value] of Object.entries(node)) {
    render(value, name !== undefined ? depth + 1 : depth, lines, key);
  }
}

/** XML → nested Markdown bullets (fenced raw block if it doesn't parse). */
export const xmlConverter: Converter = {
  format: "xml",
  accepts: (d) => d.mime === "application/xml" || d.mime === "text/xml" || d.ext === "xml",
  convert: async (data) => {
    const raw = asString(data);
    if (XMLValidator.validate(raw) !== true) {
      return { markdown: "```\n" + raw + "\n```" };
    }
    const lines: string[] = [];
    render(parser.parse(raw), 0, lines);
    return { markdown: lines.join("\n") };
  },
};
````

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npx vitest run packages/markdownify`
Expected: PASS. The full build now succeeds (all converters exist). `xml.ts` is 100% covered: the primitive/array/object branches of `render`, the valid + invalid paths, and the `accepts` branches; `markdownify.ts` is covered by `markdownify.test.ts`.

- [ ] **Step 5: Run the FULL gate**

Run: `npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional`
Expected: all green; coverage ≥99% across all metrics; `markdownify/src` 100% (every converter + registry + detect). If `format:check` complains, run `npm run format` first. Paste the coverage table tail. (No `bin/**` in M1, so nothing new is coverage-excluded.)

- [ ] **Step 6: Run the Docker gate (the required PR check)**

Run: `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test`
Expected: ends with `✅ ALL GATES PASSED`.

- [ ] **Step 7: Commit**

```bash
git add packages/markdownify/src/converters/xml.ts packages/markdownify/test/converters/xml.test.ts packages/markdownify/test/markdownify.test.ts
git commit -m "feat(markdownify): XML -> nested Markdown converter; default-registry tests"
```

---

## Self-Review (coverage of the spec — M1 portion)

- **Spec §3 — package, `Converter`/registry, detection (mime→ext→sniff), `markdownify()`, never-throws:** Tasks 1 (scaffold), 2 (types+detect), 4 (registry+markdownify). ✓
- **Spec §4 — text/HTML/CSV/JSON/XML converters with their stated strategies/deps:** Tasks 3 (text), 5 (html/turndown), 6 (csv hand-rolled table + json fenced), 7 (xml/fast-xml-parser). ✓
- **Spec §5 — never-throws degradation (unknown → text; converter throw → text + warning):** Task 4 (registry catch) + each converter's own degrade (json/xml fenced fallback). ✓
- **Spec §6 — inline-string fixtures (no binaries in M1), Node+Bun, >99% coverage:** every task's tests use inline strings/bytes; the gate runs in Task 7. ✓
- **Type consistency:** `MarkdownResult`/`ConvertInput`/`Converter`, `extOf`/`sniff`, `asString`, `textConverter`/`htmlConverter`/`csvConverter`/`jsonConverter`/`xmlConverter`, `ConverterRegistry.register/pick/convert`, `defaultRegistry`/`markdownify` — names used identically across Tasks 2–7. ✓
- **Not in M1 (follow-on plans):** DOCX/XLSX/PPTX (M2); PDF + the CLI + the black-box functional test (M3); the always-on ingestion wiring (per-consumer follow-on, spec §8).

---

## Next plans (after M1 lands)

- **M2** — Office converters: DOCX (`mammoth`), XLSX (`xlsx`), PPTX (`jszip` + `fast-xml-parser`); in-test fixtures via jszip / `xlsx.write`.
- **M3** — PDF converter (`pdfjs-dist`, worker disabled, `standardFontDataUrl`), the `markdownify` CLI (`src/bin/`), and a black-box functional test (generate a PDF with `pdf-lib`, run the CLI). Then wire `markdownify()` into the first ingestion consumer (tool results / VECNA memory).
