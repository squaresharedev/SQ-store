// The smallest PDF that carries text: one Helvetica page per entry, one line
// of text per string. Enough for the document eval to build its files from
// plain text at run time, so no binary file is kept in the repo.

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const LEADING = 16;

/** A PDF string literal: only the three characters PDF treats specially are escaped. */
function pdfString(text: string): string {
  return `(${text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")})`;
}

/** Latin-1 only: the built-in Helvetica has no other glyphs. */
function latin1(text: string): string {
  return [...text].map((char) => (char.charCodeAt(0) < 256 ? char : "?")).join("");
}

export function textPdf(pages: readonly (readonly string[])[]): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);

  const catalog = add("");
  const tree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const lines of pages) {
    const text = lines
      .map((line, at) => `BT /F1 11 Tf ${MARGIN} ${PAGE_HEIGHT - MARGIN - at * LEADING} Td ${pdfString(latin1(line))} Tj ET`)
      .join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, at) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${at + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
