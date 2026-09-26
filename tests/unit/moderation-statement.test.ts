// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderStatement, statementFileName, type StatementInput } from "@/lib/moderation/statement";
import { english } from "../setup/translate";

/**
 * The statement of reasons a seller downloads is a PDF this app writes itself
 * (lib/pdf/document.ts), so nothing else vouches for it being a readable file
 * that says what it should. These tests read it back the way a viewer does:
 * the cross-reference table must point at real objects, and the text layer,
 * decoded through each font's ToUnicode map, must be the words that went in,
 * accents and all.
 */

const DECISION_ID = "0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";

function input(overrides: Partial<StatementInput["decision"]> = {}): StatementInput {
  return {
    decision: {
      id: DECISION_ID,
      targetType: "product",
      targetId: "7e57c0de-0000-4000-8000-000000000001",
      targetTitle: "Brass lamp",
      action: "paused",
      ground: "counterfeit",
      note: "Remove the brand logo from the main photo.",
      fields: ["photos", "title"],
      reportCount: 2,
      reportReasons: ["counterfeit", "scam"],
      decidedAt: "2026-09-23T10:00:00Z",
      ...overrides,
    },
    appeal: null,
    status: "inForce",
    locale: "en",
    generatedAt: new Date("2026-09-26T08:00:00Z"),
  };
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** The text of every page, decoded the way a PDF viewer copies it out. */
function extractText(pdf: string): string {
  // Each font's ToUnicode map: glyph id -> the text it stands for.
  const maps = [...pdf.matchAll(/beginbfchar\n([\s\S]*?)\nendbfchar/g)].map((match) => {
    const map = new Map<string, string>();
    for (const line of match[1]!.split("\n")) {
      const [, gid, hex] = line.match(/<([0-9a-f]{4})> <([0-9a-f]+)>/) ?? [];
      if (!gid || !hex) continue;
      const units = hex.match(/.{4}/g)!.map((unit) => parseInt(unit, 16));
      map.set(gid, String.fromCharCode(...units));
    }
    return map;
  });
  const [regular, bold] = maps;
  const out: string[] = [];
  for (const run of pdf.matchAll(/BT \/(F1|F2) [\d.]+ Tf [\d.]+ g [\d.]+ [\d.]+ Td <([0-9a-f]*)> Tj ET/g)) {
    const map = run[1] === "F2" ? bold! : regular!;
    out.push((run[2]!.match(/.{4}/g) ?? []).map((gid) => map.get(gid) ?? "�").join(""));
  }
  return out.join("\n");
}

describe("renderStatement", () => {
  const bytes = renderStatement(input(), english);
  const pdf = latin1(bytes);

  it("is a complete PDF whose cross-reference table points at real objects", () => {
    expect(pdf.startsWith("%PDF-1.7\n")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    const startxref = Number(pdf.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const [, count] = pdf.slice(startxref).match(/^xref\n0 (\d+)\n/)!;
    const rows = pdf.slice(startxref).split("\n").slice(3, 2 + Number(count));
    rows.forEach((row, index) => {
      const offset = Number(row.slice(0, 10));
      expect(pdf.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it("declares its language and title, and embeds its fonts with a text layer", () => {
    expect(pdf).toContain("/Lang (en)");
    expect(pdf).toContain("/DisplayDocTitle true");
    expect(pdf.match(/\/FontFile2/g)).toHaveLength(2);
    expect(pdf.match(/\/ToUnicode/g)).toHaveLength(2);
  });

  it("says what was decided, why, what to change and how to challenge it", () => {
    const text = extractText(pdf);
    for (const expected of [
      "Statement of reasons",
      "We paused your product",
      "MD-0B1F7B1E6D",
      "Product: Brass lamp",
      "Counterfeit or stolen. It appeared to offer counterfeit goods",
      "Remove the brand logo from the main photo.",
      "Title",
      "Photos",
      "This followed 2 notices from people outside SquareShare, about: Counterfeit or stolen, Scam or fraud.",
      "No automated means were used",
      "Out-of-court dispute settlement",
      "support@squareshare.eu",
      "Page 1 of",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("keeps a seller's own words intact, accents and all", () => {
    const note = "Příliš žluťoučký kůň úpěl ďábelské ódy. Zażółć gęślą jaźń.";
    const text = extractText(latin1(renderStatement(input({ note }), english)));
    expect(text.replace(/\n/g, " ")).toContain(note);
  });

  it("marks characters the font lacks as ? rather than dropping them", () => {
    const text = extractText(latin1(renderStatement(input({ targetTitle: "Lamp \u{1F4A1}" }), english)));
    expect(text).toContain("Product: Lamp ?");
  });

  it("runs onto more pages when it has to, numbering every one", () => {
    const long = renderStatement(
      input({ note: "A detailed note. ".repeat(29).trim(), fields: ["title", "description", "price", "image", "file", "purchaseLink", "shipping", "options", "photos", "specs", "documents", "safety", "other"] }),
      english,
    );
    const text = extractText(latin1(long));
    const pages = Number(latin1(long).match(/\/Count (\d+)/)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain(`Page ${pages} of ${pages}`);
  });

  it("leaves out the fix list for a removal, which has nothing to fix", () => {
    const text = extractText(latin1(renderStatement(input({ action: "removed" }), english)));
    expect(text).toContain("We removed your product");
    expect(text).not.toContain("What to change");
    // The parts it concerned are still part of the reasons.
    expect(text).toContain("What it concerned\nTitle, Photos");
  });

  it("reports an appeal and our answer", () => {
    const text = extractText(
      latin1(
        renderStatement(
          {
            ...input(),
            appeal: {
              status: "upheld",
              filedAt: "2026-09-24T10:00:00Z",
              decidedAt: "2026-09-25T10:00:00Z",
              note: "The logo is still visible on the box.",
              message: "The logo is our own trademark.",
            },
          },
          english,
        ),
      ),
    );
    expect(text).toContain("the decision stands");
    expect(text).toContain("The logo is still visible on the box.");
    expect(text).toContain("The logo is our own trademark.");
  });

  it("is saved under the decision's reference", () => {
    expect(statementFileName(DECISION_ID)).toBe("squareshare-md-0b1f7b1e6d.pdf");
  });
});
