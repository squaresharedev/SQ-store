/**
 * Identify an image from its MAGIC BYTES.
 *
 * The client-supplied `file.type` and the filename extension are both just
 * claims; a `.png` named file holding a script is trivial to produce. Anything
 * that decides what an upload IS must read the bytes, so this is the single
 * place that does it.
 *
 * Callers still apply their own allowlist to the result — the avatar bucket and
 * the product bucket accept different sets — but nobody re-implements the
 * detection.
 */

export type SniffedImage = { mime: string; ext: string };

/** The 12 bytes every signature below fits inside. */
const MIN_SNIFF_BYTES = 12;

function ascii(bytes: Uint8Array, start: number, text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[start + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * The real type of an image, or null if the bytes are not one of the formats
 * this product supports. Null means "reject", never "assume it's fine".
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < MIN_SNIFF_BYTES) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  // PNG: 89 "PNG" CR LF SUB LF
  if (
    bytes[0] === 0x89 &&
    ascii(bytes, 1, "PNG") &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }
  // GIF: "GIF87a" or "GIF89a"
  if (ascii(bytes, 0, "GIF8") && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return { mime: "image/gif", ext: "gif" };
  }
  // WebP: "RIFF" <4-byte size> "WEBP"
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    return { mime: "image/webp", ext: "webp" };
  }
  // AVIF: ISO-BMFF "ftyp" box with an AV1 brand. `avis` is the image-sequence
  // brand and shares the decoder, so it is the same format for our purposes.
  if (ascii(bytes, 4, "ftyp") && (ascii(bytes, 8, "avif") || ascii(bytes, 8, "avis"))) {
    return { mime: "image/avif", ext: "avif" };
  }
  return null;
}
