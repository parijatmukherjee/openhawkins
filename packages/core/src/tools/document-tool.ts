import { z } from "zod";
import type { ToolDefinition } from "./tool.js";

/** A minimal document-converter interface injected by the composition root.
 *  `core` does not depend on `@openhawkins/markdownify`; the composition root
 *  (e.g. `buildDurableAgentRun`) injects a concrete converter. */
export interface DocumentConverter {
  convert(
    data: string,
    mime: string,
    filename: string,
  ): Promise<{ markdown: string; format: string }>;
}

export function createDocumentTool(
  converter: DocumentConverter,
): ToolDefinition<
  { data: string; mime: string; filename: string },
  { markdown: string; format: string; warnings: string[] }
> {
  return {
    name: "convert_document",
    description:
      "Convert a document (CSV, HTML, JSON, XML, text, etc.) to Markdown for token reduction. " +
      "Provide the raw content as `data`, and optionally a MIME type or filename for format detection.",
    capabilities: [{ name: "document:convert" }],
    args: z.object({
      data: z.string().min(1).describe("The raw document content"),
      mime: z
        .string()
        .describe("MIME type (e.g. text/csv, text/html) — empty string for auto-detect"),
      filename: z.string().describe("Filename with extension — empty string for auto-detect"),
    }),
    result: z.object({
      markdown: z.string(),
      format: z.string(),
      warnings: z.array(z.string()),
    }),
    handler: async (args) => {
      const result = await converter.convert(args.data, args.mime || "", args.filename || "");
      return { markdown: result.markdown, format: result.format, warnings: [] };
    },
  };
}
