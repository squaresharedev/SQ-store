/** "PDF", "ZIP"... from a download's key: the extension only, never the
 *  name, never the key. What a buyer is told about a file before buying it
 *  (CRD art. 6(1)(r) format), and on every page that names it. */
export function fileFormatFromKey(key: string | null): string | null {
  if (!key) return null;
  const lastSegment = key.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot === -1) return null;
  const extension = lastSegment.slice(dot + 1);
  return /^[A-Za-z0-9]{1,5}$/.test(extension) ? extension.toUpperCase() : null;
}
