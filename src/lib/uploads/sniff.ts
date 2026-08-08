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

/**
 * The FAMILY a set of magic bytes belongs to.
 *
 * Families rather than MIME types, because several accepted types share one
 * signature and no byte inspection can tell them apart: a .epub IS a zip, and
 * `application/zip` and `application/x-zip-compressed` are the same bytes under
 * two names. Claiming to distinguish them would be a lie the format cannot
 * support, so the check below verifies the family and stops there.
 */
export type FileFamily = "zip" | "pdf" | "mpeg-audio" | "wav" | "mp4" | "image";

/**
 * Which declared content types are honest about a given family.
 *
 * `text/plain` is deliberately absent: text has no signature, so it is handled
 * by exclusion — see {@link fileBytesContradictType}.
 */
const FAMILY_TYPES: Record<FileFamily, readonly string[]> = {
  zip: [
    "application/zip",
    "application/x-zip-compressed",
    // An epub is a zip with a prescribed layout; the container bytes are a zip.
    "application/epub+zip",
  ],
  pdf: ["application/pdf"],
  "mpeg-audio": ["audio/mpeg"],
  wav: ["audio/wav", "audio/x-wav"],
  mp4: ["video/mp4"],
  image: ["image/jpeg", "image/png", "image/webp"],
};

/**
 * The family a digital-file upload's bytes actually belong to, or null when the
 * leading bytes match no known container.
 *
 * Null is NOT "bad" here, unlike {@link sniffImage}: `text/plain` is an accepted
 * type and text has no magic number. Null means "no container signature", which
 * the caller interprets against what the client claimed.
 */
export function sniffFile(bytes: Uint8Array): FileFamily | null {
  if (bytes.length < MIN_SNIFF_BYTES) return null;

  // Zip family: "PK" 03 04 (normal), 05 06 (empty archive), 07 08 (spanned).
  if (
    ascii(bytes, 0, "PK") &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  ) {
    return "zip";
  }
  if (ascii(bytes, 0, "%PDF")) return "pdf";
  // MP3: an ID3 tag, or a bare frame sync (11 set bits) for tagless files.
  if (ascii(bytes, 0, "ID3")) return "mpeg-audio";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mpeg-audio";
  // RIFF containers: WAVE here, WebP is an image and is caught below.
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE")) return "wav";
  // ISO-BMFF. sniffImage claims the AVIF brands, so anything else is video.
  if (ascii(bytes, 4, "ftyp") && !ascii(bytes, 8, "avif") && !ascii(bytes, 8, "avis")) {
    return "mp4";
  }
  if (sniffImage(bytes)) return "image";
  return null;
}

/**
 * Do these bytes contradict the content type the client declared?
 *
 * The digital-file route cannot sniff the way the image route does — it streams
 * a 200 MB body straight to R2 and never holds it — so this reads only the
 * leading bytes and answers a narrower question: is the declared type a
 * provable lie?
 *
 * It is intentionally lenient in one direction. A file whose bytes match no
 * container is accepted for `text/plain`, because text has no signature and
 * refusing everything unrecognised would reject legitimate text files. What it
 * will not accept is the reverse: bytes that are demonstrably a zip, a PDF or
 * an MP4 while the client claims something else.
 */
export function fileBytesContradictType(
  bytes: Uint8Array,
  declaredType: string,
): boolean {
  const family = sniffFile(bytes);

  if (family === null) {
    // No container signature. Only text may look like this — a "zip" with no
    // zip header is not a zip.
    return declaredType !== "text/plain";
  }

  // A recognised container claiming to be plain text is the clearest lie of
  // all, and the one that matters most: it is how a binary payload gets stored
  // under a type nothing will scrutinise.
  return !FAMILY_TYPES[family].includes(declaredType);
}
