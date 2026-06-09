import TurndownService from "turndown";
import type { Converter } from "../types.js";
import { asString } from "./text.js";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

/** Best-effort title: the text of the first non-empty ATX heading in the converted
 *  Markdown. Reading it from the Markdown (not the raw HTML) means the title shares
 *  turndown's entity decoding, so `Tom &amp; Jerry` becomes `Tom & Jerry` like the
 *  body. The leading `\S` keeps a whitespace-only heading from yielding a blank title. */
function firstHeading(markdown: string): string | undefined {
  return /^#{1,6}\s+(\S.*?)\s*$/m.exec(markdown)?.[1].trim();
}

/** HTML → Markdown via turndown (ATX headings, fenced code). */
export const htmlConverter: Converter = {
  format: "html",
  accepts: (d) => d.mime === "text/html" || d.ext === "html" || d.ext === "htm",
  convert: async (data) => {
    const markdown = turndown.turndown(asString(data)).trim();
    const title = firstHeading(markdown);
    return { markdown, ...(title !== undefined ? { title } : {}) };
  },
};
