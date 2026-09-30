/**
 * Read a request body, refusing anything over `maxBytes` BEFORE it is all in
 * memory.
 *
 * `request.text()` reads a body to the end first, so checking the length of its
 * result stops nothing: a client can still make the Worker buffer megabytes per
 * request. This reads the stream chunk by chunk and gives up the moment the
 * count passes the cap, and turns away an honest `Content-Length` over the cap
 * without reading a byte. (A client can lie about Content-Length or omit it;
 * the running count is the real limit, the header only saves the read.)
 *
 * Returns why it failed rather than throwing, so each route can answer in its
 * own envelope.
 */
export type BoundedText =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "not_text" };

/**
 * The body as UTF-8 text, exactly as sent. For a route that must see the RAW
 * bytes (a signed webhook, whose signature covers the body verbatim), where
 * parsing first and re-serialising would break the signature.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<BoundedText> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too_large" };

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "not_text" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "not_text" };
  }
}

export type BoundedJson =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "not_json" };

/** The body parsed as JSON, under the same cap as readBoundedText. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<BoundedJson> {
  const body = await readBoundedText(request, maxBytes);
  if (!body.ok) return { ok: false, reason: body.reason === "too_large" ? "too_large" : "not_json" };
  try {
    return { ok: true, value: JSON.parse(body.text) };
  } catch {
    return { ok: false, reason: "not_json" };
  }
}
