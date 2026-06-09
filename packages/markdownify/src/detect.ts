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

/** A light content sniff for text formats, used only when mime/extension don't decide.
 *  Note: only a leading `<?xml` declaration is classified as XML — declaration-less XML
 *  (e.g. `<r><c>v</c></r>`) is indistinguishable from HTML by a cheap content sniff, so
 *  it falls to `html`. That is a safe degradation (the HTML converter still produces
 *  usable Markdown and never throws); callers that know the type should pass a mime or
 *  filename, which take precedence over the sniff. */
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
