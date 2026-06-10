/** A narrow, dependency-free structured log interface.
 *  This is the same shape as `@openhawkins/core`'s `Logger` so a
 *  caller can inject a `JsonLogger` (or any other concrete logger)
 *  without markdownify pulling in the core package. */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields, traceId?: string): void;
}

/** Default: drops everything. */
export const noopLogger: Logger = { log() {} };
