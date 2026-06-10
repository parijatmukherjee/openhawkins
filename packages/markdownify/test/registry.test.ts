import { describe, it, expect } from "vitest";
import { ConverterRegistry } from "../src/registry.js";
import { textConverter } from "../src/converters/text.js";
import type { Converter } from "../src/types.js";
import type { Logger } from "../src/logger.js";

function capturingLogger(): {
  logger: Logger;
  records: { level: string; event: string; fields?: Record<string, unknown> | undefined }[];
} {
  const records: { level: string; event: string; fields?: Record<string, unknown> | undefined }[] =
    [];
  return {
    logger: { log: (level, event, fields) => void records.push({ level, event, fields }) },
    records,
  };
}

const upper: Converter = {
  format: "upper",
  accepts: (d) => d.mime === "text/upper" || d.ext === "up",
  convert: async (data) => ({ markdown: String(data).toUpperCase(), title: "T" }),
};
const boom: Converter = {
  format: "boom",
  accepts: (d) => d.ext === "boom",
  convert: async () => {
    throw new Error("kaboom");
  },
};

function registry(): ConverterRegistry {
  return new ConverterRegistry(textConverter).register(upper).register(boom);
}

describe("ConverterRegistry", () => {
  it("dispatches by mime, then extension, attaching the format + title", async () => {
    expect(await registry().convert({ data: "hi", mime: "text/upper" })).toEqual({
      markdown: "HI",
      format: "upper",
      warnings: [],
      title: "T",
    });
    expect(await registry().convert({ data: "hi", filename: "a.up" })).toMatchObject({
      markdown: "HI",
      format: "upper",
    });
  });

  it("prefers a mime match over an extension match, regardless of registration order", async () => {
    const byExt: Converter = {
      format: "ext-fmt",
      accepts: (d) => d.ext === "dat",
      convert: async () => ({ markdown: "from-ext" }),
    };
    const byMime: Converter = {
      format: "mime-fmt",
      accepts: (d) => d.mime === "application/special",
      convert: async () => ({ markdown: "from-mime" }),
    };
    // ext converter registered FIRST; mime must still win when both hints are present
    const reg = new ConverterRegistry(textConverter).register(byExt).register(byMime);
    const res = await reg.convert({
      data: "x",
      mime: "application/special",
      filename: "doc.dat",
    });
    expect(res.format).toBe("mime-fmt");
    expect(res.markdown).toBe("from-mime");
  });

  it("falls back to the text converter when nothing accepts", async () => {
    expect(await registry().convert({ data: "plain words" })).toEqual({
      markdown: "plain words",
      format: "text",
      warnings: [],
    });
  });

  it("uses a content sniff when mime/ext do not decide", async () => {
    const reg = new ConverterRegistry(textConverter).register({
      format: "html",
      accepts: (d) => d.ext === "html",
      convert: async () => ({ markdown: "from-html" }),
    });
    // no mime, no extension, but the content sniffs as html
    expect((await reg.convert({ data: "<p>hi</p>" })).format).toBe("html");
  });

  it("falls back to text when the sniffed format has no registered converter", async () => {
    // registry() has upper + boom but no "html"; "<p>" sniffs as html -> no converter -> text
    expect((await registry().convert({ data: "<p>hi</p>" })).format).toBe("text");
  });

  it("never throws: a failing converter degrades to text + a warning", async () => {
    const res = await registry().convert({ data: "data", filename: "x.boom" });
    expect(res.format).toBe("text");
    expect(res.markdown).toBe("data");
    expect(res.warnings[0]).toMatch(/boom.*failed.*kaboom/);
  });

  it("logs a warning when a converter fails and degrades to fallback", async () => {
    const { logger, records } = capturingLogger();
    const reg = new ConverterRegistry(textConverter, undefined, logger).register(boom);
    const res = await reg.convert({ data: "data", filename: "x.boom" });
    expect(res.format).toBe("text");
    expect(res.markdown).toBe("data");
    expect(records).toContainEqual(
      expect.objectContaining({ level: "warn", event: "converter_failed" }),
    );
  });

  it("never throws when a registered converter's accepts() throws", async () => {
    const hostile: Converter = {
      format: "hostile",
      accepts: () => {
        throw new Error("accepts blew up");
      },
      convert: async () => ({ markdown: "unreachable" }),
    };
    const reg = new ConverterRegistry(textConverter).register(hostile);
    const res = await reg.convert({ data: "safe words", mime: "text/plain" });
    expect(res.format).toBe("text");
    expect(res.markdown).toBe("safe words");
    // a throw during selection is attributed to selection, not the fallback converter
    expect(res.warnings[0]).toMatch(/selection failed.*accepts blew up/);
  });

  it("degrades to a raw text decode when the fallback converter itself throws", async () => {
    const brokenFallback: Converter = {
      format: "broken",
      accepts: () => false,
      convert: async () => {
        throw new Error("fallback down");
      },
    };
    const reg = new ConverterRegistry(brokenFallback).register(boom);
    const res = await reg.convert({ data: "raw text", filename: "x.boom" });
    expect(res.format).toBe("text");
    expect(res.markdown).toBe("raw text");
    expect(res.warnings[0]).toMatch(/boom.*failed.*kaboom/);
    expect(res.warnings[1]).toMatch(/fallback converter failed.*fallback down/);
  });

  it("stringifies a non-Error value thrown by a converter", async () => {
    const reg = new ConverterRegistry(textConverter).register({
      format: "weird",
      accepts: (d) => d.ext === "weird",
      convert: async () => {
        throw "just-a-string";
      },
    });
    const res = await reg.convert({ data: "x", filename: "f.weird" });
    expect(res.format).toBe("text");
    expect(res.warnings[0]).toContain("just-a-string");
  });

  it("caps oversized input: degrades to truncated text with a warning", async () => {
    const reg = new ConverterRegistry(textConverter, 10).register(upper);
    // lowercase input so "not uppercased" proves the `upper` converter did NOT run
    const out = await reg.convert({ data: "abcdefghijklmnop", mime: "text/upper" });
    expect(out.format).toBe("text"); // did NOT run the upper converter
    expect(out.markdown).toBe("abcdefghij"); // truncated to the 10-char cap, still lowercase
    expect(out.warnings[0]).toMatch(/exceeds cap/);
  });

  it("does not cap input at or below the ceiling", async () => {
    const reg = new ConverterRegistry(textConverter, 10).register(upper);
    const out = await reg.convert({ data: "abc", mime: "text/upper" });
    expect(out).toMatchObject({ markdown: "ABC", format: "upper" }); // normal path: uppercased
  });
});
