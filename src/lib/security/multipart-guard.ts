/**
 * A MULTIPART POST WHOSE BODY CANNOT BE A FORM, answered before Next sees it.
 *
 * Next treats every `multipart/form-data` POST to a page as a possible Server
 * Action and parses its body with the runtime's `formData()`. On Workers that
 * throws ("No initial boundary string (or you have a truncated message)") when
 * the body is empty or does not open with its boundary, and the throw is an
 * unhandled 500 on whatever page was hit, usually `/_not-found` for a scanner
 * posting to an address that does not exist. Each one also spends the error
 * email's window (ops/uptime), which can hide a real failure behind it.
 *
 * The check only reads the START of a copy of the body (a few hundred bytes at
 * most), so a real upload is neither consumed nor buffered twice. A body that
 * opens properly but breaks later is left to Next: that is a real client that
 * lost its connection, not junk.
 *
 * Pure and edge-safe: the middleware imports it.
 */

/** How far into a body the opening boundary may sit (after a preamble). */
const BOUNDARY_SCAN_BYTES = 1024;

/** The boundary parameter of a multipart content type, or null for none. */
export function multipartBoundary(contentType: string | null): string | null {
  if (!contentType || !/^multipart\/form-data\b/i.test(contentType)) return null;
  const match = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/**
 * True when this is a multipart POST that no parser could read as a form: no
 * boundary, no body, or a body that does not open with its boundary.
 */
export async function isMalformedMultipart(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  const contentType = request.headers.get("content-type");
  if (!contentType || !/^multipart\/form-data\b/i.test(contentType)) return false;
  const boundary = multipartBoundary(contentType);
  if (!boundary || !request.body) return true;

  const reader = request.clone().body!.getReader();
  const decoder = new TextDecoder();
  const opening = `--${boundary}`;
  let head = "";
  try {
    while (head.length < BOUNDARY_SCAN_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      head += decoder.decode(value, { stream: true });
      if (head.includes(opening)) return false;
    }
    return !head.includes(opening);
  } finally {
    reader.cancel().catch(() => {});
  }
}
