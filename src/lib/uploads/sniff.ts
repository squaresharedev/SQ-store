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

export type SniffedSvg = { mime: "image/svg+xml"; ext: "svg" };

/**
 * The shortest thing that could honestly be an SVG. Below this there is not
 * room for a root element, so there is nothing to judge.
 */
const MIN_SVG_BYTES = 24;

/**
 * Constructs that disqualify an SVG outright. Matched against the LOWERCASED
 * source, so the table only ever needs the lowercase form.
 *
 * Each entry answers "what could this do if the file were ever opened as a
 * document rather than painted into an `<img>`" — because defence that depends
 * on one render path staying the only render path is not defence.
 */
const SVG_REJECTIONS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /<\s*script/, why: "inline script" },
  { pattern: /<\s*\/\s*script/, why: "stray closing script tag" },
  // Event-handler attributes: onload=, onclick=, onmouseover=, and the rest.
  // `\son` (not `\bon`) so ordinary words ending in "on" cannot trip it.
  { pattern: /\son[a-z]+\s*=/, why: "event-handler attribute" },
  { pattern: /javascript\s*:/, why: "javascript: URL" },
  // foreignObject escapes SVG into arbitrary HTML, taking every HTML sink
  // with it. Nothing decorative needs it.
  { pattern: /<\s*foreignobject/, why: "foreignObject" },
  { pattern: /<\s*iframe/, why: "iframe" },
  { pattern: /<\s*embed/, why: "embed" },
  { pattern: /<\s*object/, why: "object" },
  // References that leave the document: remote fetches (which also beacon the
  // viewer's IP to a third party) and data: payloads, which would mean
  // sniffing a second format inside this one. Same-document `#fragment`
  // references — how a legitimate `<use>` works — are untouched.
  {
    pattern: /(?:xlink:)?href\s*=\s*["']?\s*(?:https?:|\/\/|data:)/,
    why: "external or embedded reference",
  },
  // Same idea for the presentation-attribute form, url(http://...).
  { pattern: /url\s*\(\s*["']?\s*(?:https?:|\/\/|data:)/, why: "external url()" },
  { pattern: /@import/, why: "CSS @import" },
  // A DOCTYPE is how both XXE and billion-laughs entity expansion get set up,
  // and a plain SVG has no use for one.
  { pattern: /<!\s*doctype/, why: "DOCTYPE" },
  { pattern: /<!\s*entity/, why: "entity declaration" },
  { pattern: /<!\[cdata\[/, why: "CDATA section" },
];

/**
 * The real type of a CANVAS ELEMENT upload when the bytes are SVG, or null.
 *
 * SVG has no magic number — it is XML — so this reads the document itself:
 * confirm the root element really is `<svg>`, then refuse anything that could
 * execute, fetch, or expand. Null means reject, exactly as in {@link sniffImage}.
 *
 * IT REJECTS RATHER THAN SANITIZES, on purpose. Rewriting untrusted markup
 * safely needs a real XML parser, and there is none available on this runtime
 * (no DOMPurify; jsdom is a dev dependency and does not run on Workers).
 * Hand-rolling one is how sanitizers grow bypasses. A rejection is a rule you
 * can read, test, and be sure of — and the seller gets told what to change.
 *
 * This is defence in depth, not the only defence: elements render solely
 * through `<img src>`, where SVG runs in the spec's secure static mode with
 * scripting and external loads disabled.
 */
export function sniffSvg(bytes: Uint8Array): SniffedSvg | null {
  if (bytes.length < MIN_SVG_BYTES) return null;

  let text: string;
  try {
    // `fatal` so malformed UTF-8 is a rejection rather than a string full of
    // replacement characters that the checks below would then scan in vain.
    // A leading BOM needs no handling here: the UTF-8 decoder strips one by
    // default (that is what `ignoreBOM: false`, the default, means).
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  // Walk past everything the XML prolog legally allows before the root element,
  // so a real file with a declaration and a licence comment still parses.
  let head = text.trimStart();
  for (;;) {
    if (head.startsWith("<?")) {
      const end = head.indexOf("?>");
      if (end === -1) return null;
      head = head.slice(end + 2).trimStart();
      continue;
    }
    if (head.startsWith("<!--")) {
      const end = head.indexOf("-->");
      if (end === -1) return null;
      head = head.slice(end + 3).trimStart();
      continue;
    }
    break;
  }

  // The root element must be <svg>, and it must be the WHOLE token: `<svgfoo`
  // is not an SVG, so the next character has to end the name.
  const root = /^<svg(?=[\s/>])/i.exec(head);
  if (!root) return null;

  // Scan the entire document, not just the prolog: the checks above prove what
  // this file claims to be, and these prove it is not carrying anything active.
  const lower = text.toLowerCase();
  for (const { pattern } of SVG_REJECTIONS) {
    if (pattern.test(lower)) return null;
  }

  return { mime: "image/svg+xml", ext: "svg" };
}

export type SniffedFont = { mime: string; ext: string };

/**
 * The real type of a FONT upload, or null if the bytes are not one of the
 * formats a storefront can render. Null means "reject": a font is parsed by
 * the browser's own font engine, so "probably fine" is not a standard worth
 * applying to it.
 *
 * Signatures are the sfnt/WOFF headers: `wOF2` and `wOFF` for the two web
 * wrappers, `OTTO` for CFF-flavoured OpenType, and the 1.0 sfnt version tag
 * (00 01 00 00) for TrueType. Collections (`ttcf`) are deliberately absent,
 * @font-face cannot address a face inside one.
 */
export function sniffFont(bytes: Uint8Array): SniffedFont | null {
  if (bytes.length < MIN_SNIFF_BYTES) return null;

  if (ascii(bytes, 0, "wOF2")) return { mime: "font/woff2", ext: "woff2" };
  if (ascii(bytes, 0, "wOFF")) return { mime: "font/woff", ext: "woff" };
  if (ascii(bytes, 0, "OTTO")) return { mime: "font/otf", ext: "otf" };
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x00
  ) {
    return { mime: "font/ttf", ext: "ttf" };
  }
  // Apple's legacy TrueType tag, still emitted by some foundries' exports.
  if (ascii(bytes, 0, "true")) return { mime: "font/ttf", ext: "ttf" };
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
