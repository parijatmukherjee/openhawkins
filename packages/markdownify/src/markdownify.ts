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
