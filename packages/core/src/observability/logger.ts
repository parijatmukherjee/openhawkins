import { redact } from "../security/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

/** A structured sink: one method, one event at a time. Components depend on this narrow
 *  interface (not a concrete logger), so tests inject a capturing logger and production
 *  injects the JSON-to-stderr one. */
export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
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
}

/** Emits one JSON object per event to a sink. Fields are run through `redact` so a secret
 *  swept into a log payload never lands in the log (review F-C3 applies to the log plane
 *  too). Below-threshold levels are dropped. */
export class JsonLogger implements Logger {
  private readonly min: LogLevel;
  private readonly sink: (line: string) => void;
  private readonly base: LogFields;

  constructor(opts: JsonLoggerOptions = {}) {
    this.min = opts.min ?? "info";
    this.sink = opts.sink ?? ((line) => void process.stderr.write(`${line}\n`));
    this.base = opts.base ?? {};
  }

  log(level: LogLevel, event: string, fields?: LogFields): void {
    if (SEVERITY[level] < SEVERITY[this.min]) {
      return;
    }
    const payload = fields ? (redact(fields) as LogFields) : {};
    this.sink(JSON.stringify({ level, event, ...this.base, ...payload }));
  }
}
