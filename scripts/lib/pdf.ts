// A minimal PDF writer, for the seed's demo documents.
//
// WHY HAND-WRITTEN rather than a dependency: the seed needs one thing, a
// single page of Helvetica text, and that is about forty lines of the PDF
// format. Pulling in a PDF library to produce it would add a build dependency
// to dev-only tooling for output nobody reads closely. The one part that has
// to be exactly right is the cross-reference table, which is byte offsets into
// the file, so this builds the body first and measures it rather than
// guessing.
//
// The output is a REAL PDF: it starts with %PDF, carries a correct xref, and
// opens in a browser's viewer. That matters because the app sniffs uploads by
// magic bytes, and a fake that only looked like a PDF would be a demo asset
// the product's own rules would reject.

/** Page box, A4 in PDF points (72 per inch). */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/** Text inside a PDF string literal: these three are the only characters that
 *  can end or nest the literal, so they are the only ones to escape. */
function escapeText(value: string): string {
  return value.replace(/[\\()]/g, (char) => `\\${char}`);
}

/**
 * Latin-1, because the base Helvetica font this uses has no Unicode encoding:
 * anything outside it would render as the wrong glyph rather than fail loudly.
 * Demo copy is written in ASCII, so this only ever trims a stray character.
 */
function toLatin1(value: string): string {
  // Filtered by CODE rather than a character-class regex: the range needs a
  // non-breaking space as a boundary, and a literal one in source is
  // invisible to a reader and easy to mangle in a copy-paste.
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    const printableAscii = code >= 0x20 && code <= 0x7e;
    const latin1Supplement = code >= 0xa0 && code <= 0xff;
    if (printableAscii || latin1Supplement) out += char;
  }
  return out;
}

/** One page of text: a bold-ish title, then body lines down the page. */
function contentStream(title: string, lines: readonly string[]): string {
  const parts = [
    "BT",
    `/F1 20 Tf 60 ${PAGE_HEIGHT - 90} Td (${escapeText(toLatin1(title))}) Tj`,
    "ET",
  ];
  let y = PAGE_HEIGHT - 130;
  for (const line of lines) {
    parts.push("BT", `/F1 11 Tf 60 ${y} Td (${escapeText(toLatin1(line))}) Tj`, "ET");
    y -= 18;
  }
  return parts.join("\n");
}

/**
 * Build a one-page PDF as bytes.
 *
 * Objects are assembled in order and each one's byte offset recorded as it is
 * appended, which is what the xref table is: a caller cannot get the offsets
 * wrong because it never sees them.
 */
export function buildDemoPdf(title: string, lines: readonly string[]): Uint8Array {
  const stream = contentStream(title, lines);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(body, "latin1");
  // Entry format is fixed-width by spec: a 10-digit offset, a 5-digit
  // generation, a keyword, and a two-byte terminator. Object 0 is always the
  // free-list head.
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(body + xref + trailer, "latin1"));
}
