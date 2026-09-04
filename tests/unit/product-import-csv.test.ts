import { describe, expect, it } from "vitest";
import {
  IMPORT_ROWS_MAX,
  buildImportPlan,
  guessColumns,
  htmlToText,
  importableRows,
  isShopifyExport,
  parseCsv,
  parsePriceCents,
} from "@/lib/products/csv";

// The importer's whole job is to not corrupt a seller's catalogue silently, so
// these lean on the cases that DO corrupt naive parsers: commas and newlines
// inside quoted cells, doubled quotes, European decimals, and Shopify's habit
// of writing one row per variant.

describe("parseCsv", () => {
  it("keeps commas, newlines and quotes that live inside a quoted cell", () => {
    const text = 'Title,Body\n"Lamp, oak","Line one\nLine two"\n"He said ""hi""",Plain';
    expect(parseCsv(text)).toEqual([
      ["Title", "Body"],
      ["Lamp, oak", "Line one\nLine two"],
      ['He said "hi"', "Plain"],
    ]);
  });

  it("reads CRLF, a trailing newline and Excel's byte-order mark", () => {
    const text = "﻿Title,Price\r\nLamp,10\r\n";
    const rows = parseCsv(text);
    // The BOM must not survive into the first header name, or every column
    // lookup misses and the file appears to have no Title at all.
    expect(rows[0]).toEqual(["Title", "Price"]);
    expect(rows).toHaveLength(2);
  });

  it("drops blank lines rather than reading them as products", () => {
    expect(parseCsv("Title,Price\n\nLamp,10\n\n")).toEqual([
      ["Title", "Price"],
      ["Lamp", "10"],
    ]);
  });
});

describe("parsePriceCents", () => {
  it("reads both decimal conventions, symbols and thousands separators", () => {
    expect(parsePriceCents("129.00")).toBe(12900);
    expect(parsePriceCents("129,00")).toBe(12900); // European decimal comma
    expect(parsePriceCents("€1,299.00")).toBe(129900);
    expect(parsePriceCents("1.299,00")).toBe(129900); // European thousands dot
    expect(parsePriceCents(" 45 ")).toBe(4500);
    expect(parsePriceCents("0.99")).toBe(99);
  });

  it("treats a lone group of three as thousands, not cents", () => {
    // "1,200" is twelve hundred in every spreadsheet that writes it, not 1.20.
    expect(parsePriceCents("1,200")).toBe(120000);
    expect(parsePriceCents("1.200")).toBe(120000);
  });

  it("answers null for anything that is not money", () => {
    for (const bad of ["", "   ", "free", "N/A", "-"]) {
      expect(parsePriceCents(bad), bad).toBeNull();
    }
  });
});

describe("htmlToText", () => {
  it("turns a Shopify description into the plain text this app stores", () => {
    const html = "<p>Warm light.</p><p>Hand finished &amp; oiled.</p><ul><li>Oak</li></ul>";
    expect(htmlToText(html)).toBe("Warm light.\n\nHand finished & oiled.\n\n- Oak");
  });

  it("keeps a script's markup from surviving as text", () => {
    // Nothing renders this as markup, so the point is only that the payload
    // does not come through as a paragraph of the seller's description.
    expect(htmlToText("<p>Hi</p><script>alert(1)</script>")).toBe("Hi");
    expect(htmlToText("<b>Bold</b>")).toBe("Bold");
  });

  it("decodes an escaped entity exactly once", () => {
    // &amp;lt; encodes the literal text "&lt;", and must not be decoded twice
    // into a "<" that was never in the seller's copy.
    expect(htmlToText("a &amp;lt; b")).toBe("a &lt; b");
  });
});

describe("column guessing", () => {
  it("maps a Shopify export with nothing to correct", () => {
    const header = ["Handle", "Title", "Body (HTML)", "Variant SKU", "Variant Price", "Status"];
    expect(isShopifyExport(header)).toBe(true);
    const columns = guessColumns(header);
    expect(columns.title).toBe(1);
    expect(columns.description).toBe(2);
    expect(columns.sku).toBe(3);
    expect(columns.price).toBe(4);
  });

  it("maps the plain words other tools use, and leaves the rest unmapped", () => {
    const columns = guessColumns(["name", "description", "price", "qty"]);
    expect(columns.title).toBe(0);
    expect(columns.price).toBe(2);
    expect(columns.stock).toBe(3);
    expect(columns.sku).toBeNull();
  });
});

describe("buildImportPlan", () => {
  const shopify = [
    ["Handle", "Title", "Body (HTML)", "Variant Price", "Variant Inventory Qty", "Status"],
    ["oak-lamp", "Oak lamp", "<p>Warm light.</p>", "129.00", "4", "active"],
    ["oak-lamp", "", "", "129.00", "2", "active"], // a second variant
    ["oak-lamp", "", "", "129.00", "1", "active"], // a third
    ["wall-hook", "Wall hook", "<p>Brass.</p>", "19,50", "0", "draft"],
  ];

  it("folds a Shopify product's variant rows into one product", () => {
    const plan = buildImportPlan(shopify);
    expect(plan.shopify).toBe(true);
    // Three rows for one handle become one product, and the seller is told.
    expect(plan.foldedVariants).toBe(2);
    const ready = importableRows(plan);
    expect(ready.map((row) => row.title)).toEqual(["Oak lamp", "Wall hook"]);
    expect(ready[0]!.priceCents).toBe(12900);
    expect(ready[0]!.description).toBe("Warm light.");
    expect(ready[0]!.stock).toBe(4);
    expect(ready[1]!.priceCents).toBe(1950);
    // Both arrive as drafts even though the file calls the lamp active: the
    // seller's choice governs, and its default is the safe one.
    expect(ready.map((row) => row.status)).toEqual(["draft", "draft"]);
  });

  it("reports each unusable row with its line number instead of dropping it", () => {
    const plan = buildImportPlan([
      ["Title", "Price"],
      ["", "10"],
      ["No price", ""],
      ["Free thing", "0"],
      ["Lamp", "10"],
      ["lamp", "12"], // same title, different case
    ]);
    const problems = plan.rows.filter((row) => row.problem);
    expect(problems.map((row) => row.line)).toEqual([2, 3, 4, 6]);
    expect(problems[0]!.problem).toMatch(/no title/i);
    expect(problems[1]!.problem).toMatch(/price/i);
    expect(problems[2]!.problem).toMatch(/zero/i);
    expect(problems[3]!.problem).toMatch(/another row/i);
    expect(importableRows(plan).map((row) => row.title)).toEqual(["Lamp"]);
  });

  it("gives every row the seller's chosen status, whatever the file says", () => {
    // The importer offers one "import as drafts or live" control. A file that
    // quietly overrode it would break the promise that control makes, and
    // would let a catalogue that was live elsewhere arrive live here by
    // surprise. So the file's own Status column is not read at all.
    const rows = [
      ["Title", "Price", "Status"],
      ["A", "10", "active"],
      ["B", "10", "TRUE"],
      ["C", "10", "archived"],
    ];
    const asDraft = importableRows(buildImportPlan(rows, undefined, { status: "draft" }));
    expect(asDraft.map((row) => row.status)).toEqual(["draft", "draft", "draft"]);
    const asActive = importableRows(buildImportPlan(rows, undefined, { status: "active" }));
    expect(asActive.map((row) => row.status)).toEqual(["active", "active", "active"]);
  });

  it("defaults to drafts when the seller expresses no choice", () => {
    // The safe direction: an import is a bulk action, and a mistake that lands
    // live is one buyers can see.
    const plan = buildImportPlan([
      ["Title", "Price"],
      ["A", "10"],
    ]);
    expect(importableRows(plan)[0]!.status).toBe("draft");
  });

  it("stops at the row cap and says how many it left", () => {
    const rows = [["Title", "Price"]];
    for (let i = 0; i < IMPORT_ROWS_MAX + 5; i += 1) rows.push([`Product ${i}`, "10"]);
    const plan = buildImportPlan(rows);
    expect(plan.rows).toHaveLength(IMPORT_ROWS_MAX);
    expect(plan.dropped).toBe(5);
  });

  it("honours a corrected mapping over the guessed one", () => {
    // A file whose headers say nothing useful: the seller points the fields at
    // the right columns and the same rows become importable.
    const rows = [
      ["col a", "col b"],
      ["Lamp", "129.00"],
    ];
    expect(importableRows(buildImportPlan(rows))).toHaveLength(0);
    const fixed = buildImportPlan(rows, { title: 0, price: 1 });
    expect(importableRows(fixed).map((row) => row.title)).toEqual(["Lamp"]);
  });
});
