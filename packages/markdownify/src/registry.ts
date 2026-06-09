import type { Converter, ConvertInput, MarkdownResult } from "./types.js";
import { extOf, sniff } from "./detect.js";
import { asString } from "./converters/text.js";

/** Render any thrown value as a short message for a warning. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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

  /**
   * Convert `input` to Markdown. Guaranteed not to throw: picking a converter, the
   * chosen converter, and even the fallback are all guarded, with a last-resort raw
   * text decode that cannot fail — so a bad document (or a misbehaving injected
   * converter) can never fail an agent turn.
   */
  async convert(input: ConvertInput): Promise<MarkdownResult> {
    const warnings: string[] = [];
    let converter = this.fallback;
    try {
      converter = this.pick(input);
      const out = await converter.convert(input.data);
      return {
        markdown: out.markdown,
        format: converter.format,
        warnings,
        ...(out.title !== undefined ? { title: out.title } : {}),
      };
    } catch (err) {
      warnings.push(`converter "${converter.format}" failed: ${describe(err)}; treated as text`);
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
