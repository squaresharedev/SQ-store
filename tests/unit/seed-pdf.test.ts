import { describe, expect, it } from "vitest";
import { buildDemoPdf } from "../../scripts/lib/pdf.ts";
import { sniffFile } from "@/lib/uploads/sniff";

// The seed's demo documents have to be REAL PDFs, not files that merely end in
// .pdf. The app decides what an upload is by reading its magic bytes, so a
// fake would be a demo asset the product's own rules reject, and the product
// page would render a link to something no viewer can open.

const pdf = () =>
  buildDemoPdf("Assembly instructions", [
    "Demo document for the Squareshare seed.",
    "Step 1: unpack the parts.",
  ]);

describe("buildDemoPdf", () => {
  it("passes the app's own file sniffer", () => {
    // The same call /api/uploads/document makes. Nothing else here matters if
    // this fails: the product would refuse its own demo data.
    expect(sniffFile(pdf())).toBe("pdf");
  });

  it("writes a well-formed header, xref and trailer", () => {
    const text = Buffer.from(pdf()).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // startxref must point at the xref table, or a reader cannot find any
    // object in the file.
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("records a correct byte offset for every object", () => {
    // The one part of the format that cannot be eyeballed: each xref entry is
    // an absolute offset, and an off-by-one makes the file unopenable while
    // still looking fine in a text editor.
    const text = Buffer.from(pdf()).toString("latin1");
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + 8)).toContain(`${index + 1} 0 obj`);
    });
  });

  it("drops characters the base font cannot draw, rather than mis-rendering them", () => {
    // Helvetica here is Latin-1: an emoji would paint as the wrong glyph
    // instead of failing, which is worse than not appearing.
    const text = Buffer.from(buildDemoPdf("Care guide \u{1F600}", [])).toString("latin1");
    expect(text).toContain("(Care guide )");
  });

  it("escapes the characters that would end the PDF string early", () => {
    const text = Buffer.from(buildDemoPdf("A (b) \\ c", [])).toString("latin1");
    // Unescaped, the ")" would terminate the literal and corrupt the page.
    expect(text).toContain("(A \\(b\\) \\\\ c)");
  });
});
