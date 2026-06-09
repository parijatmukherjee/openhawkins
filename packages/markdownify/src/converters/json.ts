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
