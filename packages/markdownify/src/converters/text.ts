import type { Converter } from "../types.js";

/** Decode bytes (UTF-8) or accept a string unchanged. Shared by other converters. */
export function asString(data: Uint8Array | string): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

/** The fallback converter: treats input as plain text (already Markdown-friendly). */
export const textConverter: Converter = {
  format: "text",
  accepts: () => true,
  convert: async (data) => ({ markdown: asString(data) }),
};
