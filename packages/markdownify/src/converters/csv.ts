import type { Converter } from "../types.js";
import { asString } from "./text.js";

/** Minimal RFC-4180-ish row parser: handles quoted fields with commas/quotes/newlines. */
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

/** Make a field safe for a single Markdown table cell: escape pipes (which would
 *  start a new column) and turn embedded newlines into `<br>` (a literal newline
 *  would split the row across physical lines and break the table). */
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

/** CSV → a GitHub-flavored Markdown table (first row is the header). */
export const csvConverter: Converter = {
  format: "csv",
  accepts: (d) => d.mime === "text/csv" || d.ext === "csv",
  convert: async (data) => {
    const rows = parseCsv(asString(data));
    const first = rows[0];
    if (first === undefined) {
      return { markdown: "" };
    }
    // reduce (not `Math.max(...spread)`): a spread of one argument per row throws a
    // RangeError past the engine's argument-count limit on a large CSV (review F-M2).
    const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
    const pad = (r: string[]): string[] => [...r, ...Array<string>(width - r.length).fill("")];
    const line = (r: string[]): string => `| ${pad(r).map(cell).join(" | ")} |`;
    const header = line(first);
    const sep = `| ${Array<string>(width).fill("---").join(" | ")} |`;
    const body = rows.slice(1).map(line);
    return { markdown: [header, sep, ...body].join("\n") };
  },
};
