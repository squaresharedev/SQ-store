import { buildObjectKey, putObject, r2FailureMessage } from "@/lib/r2";
import { sniffFont } from "@/lib/uploads/sniff";
import { FONT_CONTENT_TYPES, FONT_MAX_BYTES } from "@/lib/validation/product";

/**
 * Storing a storefront's own typeface, once, for everything that accepts one:
 * the upload route (/api/uploads/font) and an assistant's upload_font tool.
 * What the bytes ARE decides whether they are stored: a WOFF2, WOFF, TTF or
 * OTF by its signature, never by its name, within FONT_MAX_BYTES, because
 * every buyer who loads the storefront fetches it and the browser's own font
 * engine parses it. No content moderation: that classifier reads pictures,
 * and a font carries none.
 *
 * The key is the uploader's own (`fonts/{uploaderId}/...`), which is what
 * saveStorefront's verifyUpload checks before a config may name it, whichever
 * door the font came through.
 */
export type StoreFontResult =
  | { ok: true; key: string }
  | { ok: false; reason: "empty" | "too_large" | "unsupported" | "store_failed" };

export async function storeFont(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string | undefined,
  uploaderId: string,
): Promise<StoreFontResult> {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  // The measured length is the one that counts: a declared size is a claim.
  if (bytes.byteLength > FONT_MAX_BYTES) return { ok: false, reason: "too_large" };

  const sniffed = sniffFont(bytes);
  const allowed: readonly string[] = FONT_CONTENT_TYPES;
  if (!sniffed || !allowed.includes(sniffed.mime)) return { ok: false, reason: "unsupported" };

  const key = buildObjectKey("font", uploaderId, filename || `font.${sniffed.ext}`);
  try {
    // The SNIFFED type is what R2 serves the file back as.
    await putObject(key, bytes, sniffed.mime);
  } catch (error) {
    console.error("[uploads] font store failed:", r2FailureMessage(error));
    return { ok: false, reason: "store_failed" };
  }
  return { ok: true, key };
}
