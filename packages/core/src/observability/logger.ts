import { redact } from "../security/redact.js";
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

/** A structured sink: one method, one event at a time. Components depend on this narrow
 *  interface (not a concrete logger), so tests inject a capturing logger and production
 *  injects the JSON-to-stderr one. */
export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields, traceId?: string): void;
}

/** The default: drops everything. Library and test constructions stay silent unless a
 *  composition root injects a real logger. */
export const noopLogger: Logger = { log() {} };

const SEVERITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface JsonLoggerOptions {
  /** Minimum level to emit (default "info"). */
  min?: LogLevel;
  /** Where a formatted line goes (default: a newline-terminated write to stderr). */
  sink?: (line: string) => void;
  /** Fields merged into every record (e.g. a runId). */
  base?: LogFields;
  /** Absolute path to log file. Enables rotation when maxSizeBytes is set. */
  path?: string;
  /** Max file size in bytes before rotation. */
  maxSizeBytes?: number;
  /** Max number of rotated files to keep (default 5). */
  maxFiles?: number;
}

/** Emits one JSON object per event to a sink. Fields are run through `redact` so a secret
 *  swept into a log payload never lands in the log (review F-C3 applies to the log plane
 *  too). Below-threshold levels are dropped. */
export class JsonLogger implements Logger {
  private readonly min: LogLevel;
  private readonly sink: (line: string) => void;
  private readonly base: LogFields;
  private readonly path: string | undefined;
  private readonly maxSizeBytes: number;
  private readonly maxFiles: number;

  constructor(opts: JsonLoggerOptions = {}) {
    this.min = opts.min ?? "info";
    this.base = opts.base ?? {};
    this.path = opts.path;
    this.maxSizeBytes = opts.maxSizeBytes ?? Infinity;
    this.maxFiles = opts.maxFiles ?? 5;

    if (this.path) {
      this.sink = (line) => this.writeToFile(line);
    } else {
      this.sink = opts.sink ?? ((line) => void process.stderr.write(`${line}\n`));
    }
  }

  private writeToFile(line: string): void {
    const data = `${line}\n`;
    if (this.maxSizeBytes !== Infinity) {
      const size = existsSync(this.path!) ? statSync(this.path!).size : 0;
      if (size + Buffer.byteLength(data) > this.maxSizeBytes) {
        this.rotate();
      }
    }
    mkdirSync(dirname(this.path!), { recursive: true });
    appendFileSync(this.path!, data);
  }

  private rotate(): void {
    const base = this.path!;
    const oldest = `${base}.${this.maxFiles}`;
    if (existsSync(oldest)) {
      unlinkSync(oldest);
    }
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = `${base}.${i}`;
      const to = `${base}.${i + 1}`;
      if (existsSync(from)) {
        renameSync(from, to);
      }
    }
    if (existsSync(base)) {
      renameSync(base, `${base}.1`);
    }
  }

  log(level: LogLevel, event: string, fields?: LogFields, traceId?: string): void {
    if (SEVERITY[level] < SEVERITY[this.min]) {
      return;
    }
    const payload = fields ? (redact(fields) as LogFields) : {};
    const out: Record<string, unknown> = { level, event, ...this.base, ...payload };
    if (traceId !== undefined) {
      out.traceId = traceId;
    }
    this.sink(JSON.stringify(out));
  }
}
