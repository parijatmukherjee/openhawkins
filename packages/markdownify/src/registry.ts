import type { Converter, ConvertInput, MarkdownResult } from "./types.js";
import { extOf, sniff } from "./detect.js";
import { asString } from "./converters/text.js";

/** Render any thrown value as a short message for a warning. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Default input ceiling (characters / bytes): generous for real documents, a hard DoS
 *  bound against a pathological one. Tunable per registry. */
const DEFAULT_MAX_INPUT_CHARS = 5_000_000;

/**
 * Picks a converter by mime → extension → content sniff (falling back to the
 * supplied fallback converter) and runs it. `convert` NEVER throws: a converter that
 * fails degrades to the fallback plus a warning, so a bad document can't fail a turn.
 */
export class ConverterRegistry {
  private readonly converters: Converter[] = [];

  constructor(
    private readonly fallback: Converter,
    private readonly maxInputChars: number = DEFAULT_MAX_INPUT_CHARS,
  ) {}

  register(c: Converter): this {
    this.converters.push(c);
    return this;
  }

  /** Resolve a converter for the given hints + raw data. Precedence is strictly
   *  mime → extension → content sniff: a mime match always wins over an extension
   *  match even when a later-registered converter is the one matching the mime, so
   *  routing does not depend on registration order. */
  pick(input: ConvertInput): Converter {
    if (input.mime !== undefined) {
      const mime = input.mime;
      const byMime = this.converters.find((c) => c.accepts({ mime }));
      if (byMime) {
        return byMime;
      }
    }
    const ext = extOf(input.filename);
    if (ext !== undefined) {
      const byExt = this.converters.find((c) => c.accepts({ ext }));
      if (byExt) {
        return byExt;
      }
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

  /**
   * Convert `input` to Markdown. Guaranteed not to throw: picking a converter, the
   * chosen converter, and even the fallback are all guarded, with a last-resort raw
   * text decode that cannot fail — so a bad document (or a misbehaving injected
   * converter) can never fail an agent turn.
   */
  async convert(input: ConvertInput): Promise<MarkdownResult> {
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

    const warnings: string[] = [];
    let converter = this.fallback;
    let picked = false;
    try {
      converter = this.pick(input);
      picked = true;
      const out = await converter.convert(input.data);
      return {
        markdown: out.markdown,
        format: converter.format,
        warnings,
        ...(out.title !== undefined ? { title: out.title } : {}),
      };
    } catch (err) {
      // Attribute the failure precisely: a throw before `picked` is a selection-time
      // failure (e.g. a converter's accepts() threw), not the chosen converter's fault.
      const culprit = picked ? `converter "${converter.format}"` : "converter selection";
      warnings.push(`${culprit} failed: ${describe(err)}; treated as text`);
      try {
        const fb = await this.fallback.convert(input.data);
        return { markdown: fb.markdown, format: this.fallback.format, warnings };
      } catch (fbErr) {
        warnings.push(`fallback converter failed: ${describe(fbErr)}; using raw text`);
        return { markdown: asString(input.data), format: "text", warnings };
      }
    }
  }
}
