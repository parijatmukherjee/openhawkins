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
