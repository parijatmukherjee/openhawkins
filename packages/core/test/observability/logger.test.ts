import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonLogger, noopLogger, type LogLevel } from "../../src/observability/logger.js";
import { REDACTED } from "../../src/security/redact.js";

describe("noopLogger", () => {
  it("accepts a call and does nothing (no throw, no output)", () => {
    expect(() => noopLogger.log("error", "anything", { a: 1 })).not.toThrow();
  });
});

describe("JsonLogger", () => {
  const sink = () => {
    const lines: string[] = [];
    return { write: (l: string) => lines.push(l), lines };
  };

  it("emits one JSON object per event with level, event, and fields", () => {
    const s = sink();
    new JsonLogger({ sink: s.write }).log("info", "hello", { n: 1 });
    expect(s.lines).toHaveLength(1);
    expect(JSON.parse(s.lines[0])).toEqual({ level: "info", event: "hello", n: 1 });
  });

  it("merges base fields into every record", () => {
    const s = sink();
    new JsonLogger({ sink: s.write, base: { runId: "r1" } }).log("warn", "e");
    expect(JSON.parse(s.lines[0])).toEqual({ level: "warn", event: "e", runId: "r1" });
  });

  it("drops records below the minimum level", () => {
    const s = sink();
    const log = new JsonLogger({ sink: s.write, min: "warn" });
    log.log("info", "quiet");
    log.log("error", "loud");
    expect(s.lines.map((l) => (JSON.parse(l) as { event: string }).event)).toEqual(["loud"]);
  });

  it("redacts secrets in fields before emit", () => {
    const s = sink();
    new JsonLogger({ sink: s.write }).log("error", "boom", { apiKey: "sk-supersecret-123" });
    expect(s.lines[0]).not.toContain("sk-supersecret-123");
    expect((JSON.parse(s.lines[0]) as { apiKey: string }).apiKey).toBe(REDACTED);
  });

  it("defaults to writing a newline-terminated line to stderr at >=info", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      new JsonLogger().log("info", "viastderr");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toBe(
        `${JSON.stringify({ level: "info", event: "viastderr" })}\n`,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("the default minimum is info (debug is dropped)", () => {
    const s = sink();
    const log = new JsonLogger({ sink: s.write });
    log.log("debug", "trace");
    expect(s.lines).toHaveLength(0);
  });

  it("orders levels debug < info < warn < error", () => {
    const order: LogLevel[] = ["debug", "info", "warn", "error"];
    const s = sink();
    const log = new JsonLogger({ sink: s.write, min: "debug" });
    for (const lvl of order) log.log(lvl, lvl);
    expect(s.lines).toHaveLength(4);
  });

  it("includes traceId in the output when provided", () => {
    const s = sink();
    new JsonLogger({ sink: s.write }).log("info", "hello", { n: 1 }, "trace-abc-123");
    expect(s.lines).toHaveLength(1);
    expect(JSON.parse(s.lines[0])).toEqual({
      level: "info",
      event: "hello",
      n: 1,
      traceId: "trace-abc-123",
    });
  });

  it("rotates log file when maxSizeBytes is exceeded", () => {
    const dir = mkdtempSync(join(tmpdir(), "log-rotate-"));
    try {
      const path = join(dir, "app.log");
      const log = new JsonLogger({ path, maxSizeBytes: 1 });
      log.log("info", "first");
      log.log("info", "second");
      const files = readdirSync(dir).sort();
      expect(files).toContain("app.log");
      expect(files).toContain("app.log.1");
      const current = readFileSync(join(dir, "app.log"), "utf8");
      expect(JSON.parse(current).event).toBe("second");
      const rotated = readFileSync(join(dir, "app.log.1"), "utf8");
      expect(JSON.parse(rotated).event).toBe("first");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps only maxFiles rotated files", () => {
    const dir = mkdtempSync(join(tmpdir(), "log-rotate-"));
    try {
      const path = join(dir, "app.log");
      const log = new JsonLogger({ path, maxSizeBytes: 1, maxFiles: 2 });
      log.log("info", "a");
      log.log("info", "b");
      log.log("info", "c");
      log.log("info", "d");
      const files = readdirSync(dir).sort();
      expect(files).toEqual(["app.log", "app.log.1", "app.log.2"]);
      const oldest = readFileSync(join(dir, "app.log.2"), "utf8");
      expect(JSON.parse(oldest).event).toBe("b");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults to no rotation when path is omitted", () => {
    const s = sink();
    const log = new JsonLogger({ sink: s.write });
    log.log("info", "hello");
    expect(s.lines).toHaveLength(1);
  });

  it("omits traceId when not provided", () => {
    const s = sink();
    new JsonLogger({ sink: s.write }).log("info", "hello", { n: 1 });
    expect(s.lines).toHaveLength(1);
    expect(JSON.parse(s.lines[0])).not.toHaveProperty("traceId");
  });
});
