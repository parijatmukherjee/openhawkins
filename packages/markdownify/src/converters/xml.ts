import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Converter } from "../types.js";
import { asString } from "./text.js";

/** Hard ceiling on XML nesting depth: `render` recurses once per level, so a pathologically
 *  deep document (within the size budget) could overflow the stack (review F-M2). */
const MAX_DEPTH = 256;

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true, maxNestedTags: 1000 });

/** Render a parsed XML object as nested Markdown bullets. */
function render(node: unknown, depth: number, lines: string[], name?: string): void {
  if (depth > MAX_DEPTH) {
    lines.push(`${"  ".repeat(depth)}- [truncated: max nesting depth ${MAX_DEPTH}]`);
    return;
  }
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
  const obj = node as Record<string, unknown>;
  if (name !== undefined) {
    // An element with mixed text + child content keeps its own text under "#text".
    // Render it as the element's value, not as a bogus "#text" child field.
    const text = obj["#text"];
    lines.push(
      text === undefined ? `${indent}- **${name}**` : `${indent}- **${name}**: ${String(text)}`,
    );
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === "#text") {
      continue;
    }
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
    let parsed: unknown;
    try {
      parsed = parser.parse(raw);
    } catch {
      return { markdown: "```\n" + raw + "\n```" };
    }
    const lines: string[] = [];
    render(parsed, 0, lines);
    return { markdown: lines.join("\n") };
  },
};
