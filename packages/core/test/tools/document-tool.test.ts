import { describe, it, expect } from "vitest";
import { createDocumentTool } from "../../src/tools/document-tool.js";

describe("createDocumentTool", () => {
  it("converts a document through the injected converter", async () => {
    const converter = {
      convert: async (data: string, _mime: string, _filename: string) => ({
        markdown: `# ${data}`,
        format: "html",
      }),
    };
    const tool = createDocumentTool(converter);
    const result = await tool.handler({ data: "hello", mime: "", filename: "" }, { agentId: "a" });
    expect(result.markdown).toBe("# hello");
    expect(result.format).toBe("html");
    expect(result.warnings).toEqual([]);
  });

  it("requires the document:convert capability", () => {
    const tool = createDocumentTool({
      convert: async () => ({ markdown: "", format: "text" }),
    });
    expect(tool.capabilities).toEqual([{ name: "document:convert" }]);
  });
});
