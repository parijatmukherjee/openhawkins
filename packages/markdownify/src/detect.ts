/** Lowercased file extension (no dot), or undefined when there isn't a usable one. */
export function extOf(filename: string | undefined): string | undefined {
  if (filename === undefined) {
    return undefined;
  }
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) {
    return undefined;
  }
  return filename.slice(dot + 1).toLowerCase();
}

/** A light content sniff for text formats, used only when mime/extension don't decide. */
export function sniff(text: string): "xml" | "html" | "json" | undefined {
  const head = text.trimStart();
  if (head.startsWith("<?xml")) {
    return "xml";
  }
  if (head.startsWith("<")) {
    return "html";
  }
  if (head.startsWith("{") || head.startsWith("[")) {
    return "json";
  }
  return undefined;
}
