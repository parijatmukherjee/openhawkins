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
    const lines: string[] = [];
    render(parser.parse(raw), 0, lines);
    return { markdown: lines.join("\n") };
  },
};
