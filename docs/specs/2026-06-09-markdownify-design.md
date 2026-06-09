# `@openhawkins/markdownify` — native document → Markdown — Design

**Date:** 2026-06-09
**Status:** Draft for review
**Parent:** [`2026-06-05-openhawkins-design.md`](./2026-06-05-openhawkins-design.md) (umbrella)

> A self-owned, native (TypeScript) converter that turns verbose source documents
> into compact **Markdown** before content enters the agent's context — the
> token-reduction layer requested as "use markitdown always." It is OpenHawkins's
> own implementation (informed by Microsoft's MIT `markitdown`, not a port), so it
> runs in the **single self-contained binary** with **no Python** and **no external
> service** — consistent with ADR 0001 and the pure-JS-over-sqlite-vec decision.

---

## 1. Goal & scope

**Goal.** Given bytes/text + a hint (mime or filename), produce token-efficient
Markdown. Used at OpenHawkins's ingestion boundary so documents (web pages, Office
files, PDFs, data payloads, tool output) cost far fewer tokens when fed to a model
or stored in VECNA memory.

**In scope (v1).** A standalone `@openhawkins/markdownify` package: a converter
**registry** + these converters — **HTML, CSV, JSON, XML, plain-text** (pure-JS /
hand-rolled) and **DOCX, XLSX, PPTX, PDF** (light pure-JS libraries) — plus a small
CLI to exercise it.

> **Delivery across milestones (see §10).** v1 is built and shipped incrementally, one
> PR per milestone: **M1** — the registry + detection + the text/markup converters
> (HTML, CSV, JSON, XML, plain-text); **M2** — the Office converters (DOCX, XLSX,
> PPTX); **M3** — the PDF converter, the CLI, and a black-box functional test. A given
> PR ships only its milestone's slice; this section describes the v1 whole, not any
> single PR.

**Out of scope (later increments / optional).** Image OCR and audio/video
transcription (markitdown's heaviest, cloud/LLM-dependent converters); the
"always-on" **wiring** into each ingestion consumer (tool results, VECNA memory,
channel attachments) — a thin follow-on per consumer as those are touched. v1 ships
the reusable engine + CLI.

---

## 2. Spike results (deps verified Node + Bun, 2026-06-09)

A grounding spike confirmed every v1 dependency is **pure-JS and runs identically on
Node 25 and Bun 1.3** — including PDF text extraction, which was the risk:

| Converter  | Library                                      | Node | Bun |
| ---------- | -------------------------------------------- | ---- | --- |
| HTML → MD  | `turndown`                                   | ✓    | ✓   |
| XML, PPTX  | `fast-xml-parser`                            | ✓    | ✓   |
| PPTX / zip | `jszip`                                      | ✓    | ✓   |
| XLSX       | `xlsx` (SheetJS)                             | ✓    | ✓   |
| DOCX → MD  | `mammoth`                                    | ✓    | ✓   |
| PDF → text | `pdfjs-dist` (legacy build, worker disabled) | ✓    | ✓   |

**Consequence:** PDF needs **no** optional/lazy fallback — it ships in the binary.
The only pdfjs caveat is a benign `standardFontDataUrl` warning; we pass the font
path (resolvable from `pdfjs-dist`) and `useWorkerFetch:false, isEvalSupported:false`.
`pdf-lib` generated the test PDF in the spike and will be a **test-only** dependency
for fixture generation (no binary files committed).

---

## 3. Architecture

A pure converter library — no IO beyond reading the input bytes; **no workspace
dependency** (it defines its own `MarkdownResult`/`Converter` types), so it's
reusable and independently testable.

```
packages/markdownify/
  src/
    markdownify.ts     # public API: markdownify() + MarkdownResult + Converter types
    registry.ts        # ConverterRegistry: detection (mime -> ext -> sniff) + dispatch
    detect.ts          # mime/extension/magic-byte detection helpers
    converters/
      text.ts          # plain text / markdown passthrough
      html.ts          # HTML  -> MD (turndown)
      csv.ts           # CSV   -> MD table
      json.ts          # JSON  -> MD (structured)
      xml.ts           # XML   -> MD (fast-xml-parser)
      docx.ts          # DOCX  -> MD (mammoth)
      xlsx.ts          # XLSX  -> MD tables (xlsx)
      pptx.ts          # PPTX  -> MD (jszip + fast-xml-parser, slide text)
      pdf.ts           # PDF   -> MD (pdfjs-dist text)
    index.ts
  src/bin/markdownify.ts  # CLI: markdownify <file> [--mime m]
  test/ ...
```

### 3.1 Public API

```ts
export interface MarkdownResult {
  markdown: string;
  /** Best-effort document title (e.g. first heading / docx title / pdf metadata). */
  title?: string;
  /** The converter that ran (e.g. "html", "pdf"), for observability. */
  format: string;
  /** Non-fatal issues (e.g. "unknown format; treated as text"). */
  warnings: string[];
}

export interface ConvertInput {
  /** Raw bytes (binary formats) or a string (text formats). */
  data: Uint8Array | string;
  mime?: string;
  filename?: string;
}

/** Convert a document to Markdown. Never throws — unknown/failed formats degrade. */
export function markdownify(input: ConvertInput): Promise<MarkdownResult>;
```

### 3.2 Converter contract + registry

```ts
export interface Converter {
  readonly format: string; // "html", "pdf", ...
  /** True if this converter handles the detected mime/extension. */
  accepts(d: { mime?: string; ext?: string }): boolean;
  /** Convert raw input to Markdown. May throw; the registry catches + degrades. */
  convert(data: Uint8Array | string): Promise<{ markdown: string; title?: string }>;
}
```

`ConverterRegistry.pick(mime?, filename?)` resolves a converter by **mime → file
extension → content sniff** (magic bytes: `PK` zip header for docx/xlsx/pptx, `%PDF`
for pdf, `<` for html/xml). The registry orders specific converters before the
`text` fallback. `markdownify` calls the chosen converter inside a `try/catch`: a
throw becomes a `warning` plus a best-effort text rendering, so ingestion never
fails the turn (mirrors Eleven/registry "never throws" discipline).

---

## 4. Converters (v1)

| Format    | Strategy                                                          | Dep                         |
| --------- | ----------------------------------------------------------------- | --------------------------- |
| text / md | passthrough (already Markdown-ish)                                | none                        |
| HTML      | strip boilerplate, convert to MD                                  | `turndown`                  |
| CSV       | parse rows → GitHub-flavored MD table                             | hand-rolled                 |
| JSON      | pretty structural MD (objects → sections, arrays → lists/tables)  | hand-rolled                 |
| XML       | parse → nested MD (elements → headings/lists)                     | `fast-xml-parser`           |
| DOCX      | OOXML → MD                                                        | `mammoth`                   |
| XLSX      | each sheet → an MD table (sheet name as heading)                  | `xlsx` (SheetJS)            |
| PPTX      | per slide: extract `<a:t>` text runs → MD (slide N headings)      | `jszip` + `fast-xml-parser` |
| PDF       | per page: `getTextContent()` → joined text → MD (page separators) | `pdfjs-dist`                |

CSV/JSON are hand-rolled (no dep, full control over token-lean output). PPTX reuses
`jszip` + `fast-xml-parser` rather than adding a slide-specific library.

---

## 5. Error handling

- `markdownify` **never throws**. Unknown format → `text` fallback + a `warning`.
  A converter that throws (corrupt file, unsupported sub-feature) → `warning` +
  best-effort (decode bytes as UTF-8 text where possible), never a crash.
- Each converter is defensive at its own boundary (e.g. an empty/garbage PDF yields
  `markdown: ""` + a warning, not an exception).
- No network, no shelling out, no Python — pure in-process conversion.

---

## 6. Testing

- **Deterministic fixtures, generated in-test — no committed binaries.** DOCX via
  `jszip` (minimal OOXML), XLSX via `xlsx.write`, PDF via `pdf-lib` (test-only dep),
  PPTX via `jszip`. Text/HTML/CSV/JSON/XML use inline strings.
- Each converter: assert the produced Markdown for a known input (e.g.
  `<h1>Title</h1>` → `# Title`; a 2×2 CSV → a 2-column MD table; the generated PDF →
  its embedded text).
- The registry: mime vs extension vs sniff detection, the `text` fallback, and the
  never-throws degradation path.
- Runs on **Node and Bun** (the deps are verified on both); deterministic, no
  network. Meets the repo **>99% coverage gate** for OUR code (the converters are
  thin wrappers; we cover the wrappers + registry + detection, not the libraries).
- A black-box **functional** test drives the `markdownify` CLI on a generated file.

---

## 7. Dependency footprint

Six runtime deps (`turndown`, `fast-xml-parser`, `jszip`, `mammoth`, `xlsx`,
`pdfjs-dist`) + one test-only (`pdf-lib`). All pure-JS, all Bun-compatible (§2), so
they fit the single-binary story. `pdfjs-dist` is the largest; accepted because the
user chose broad v1 coverage and the spike proved it works in the binary. The
package depends on nothing in the workspace, so it's reusable and independently
testable.

---

## 8. Integration (the "always" part) — follow-on

v1 delivers the engine + CLI. Making conversion **automatic** is a thin per-consumer
wiring that lands as each consumer is touched:

- **Tool results** (S1): a tool that returns a document/bytes is markdownified before
  the result re-enters the model's context.
- **VECNA memory** (S2): external/document content is markdownified before becoming a
  fragment (fewer tokens stored + recalled).
- **Channels** (S4): inbound attachments (PDF/DOCX/…) are markdownified on receipt.

Each is a one-call hook (`markdownify(...)`) at the boundary, capability-gated where
it performs IO. Kept out of v1 so the engine lands and is tested in isolation.

---

## 9. Decisions

1. **Native TS, not Python markitdown.** markitdown is Python-only; bundling it
   breaks the self-contained binary (ADR 0001). We build our own, informed by it.
2. **Broad v1 coverage** (text + Office + PDF) — chosen by the operator; de-risked
   by the spike (§2), so even PDF ships natively (no optional fallback).
3. **Library + CLI in v1; auto-wiring as a follow-on.** Keeps the engine focused and
   independently testable; wiring lands where content actually enters (§8).
4. **In-test fixture generation** (jszip / xlsx.write / pdf-lib) — no committed
   binaries; deterministic and reviewable.
5. **Never-throws** ingestion: unknown/failed conversion degrades to text + a
   warning, so a bad document never fails a turn.

---

## 10. Milestones (for the implementation plan)

1. **M1** — package scaffold + `Converter`/registry + detection + text/HTML/CSV/JSON/XML.
2. **M2** — Office: DOCX, XLSX, PPTX.
3. **M3** — PDF (`pdfjs-dist`) + the CLI + functional test.

Each milestone lands via its own PR through the required `docker-gate` (build + lint

- format + coverage >99% + unit + functional), green on Node + Bun.
