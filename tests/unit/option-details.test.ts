import { describe, expect, it } from "vitest";
import {
  hasOptionDetails,
  optionSummaryRows,
  resolveDetailsForSelection,
} from "@/lib/products/option-details";
import { specRows } from "@/components/product-page/SpecsTable";
import type { ProductDetails, ProductOption, ProductOptionGroup } from "@/types/product";

/**
 * WHICH FACTS A BUYER IS SHOWN once a product is sold in versions.
 *
 * The rules under test are the ones a seller's spec table depends on: a
 * version's own measurement beats the product's, a version that says nothing
 * changes nothing, and a spec row named the same as one above replaces it
 * rather than printing twice.
 */

const optionId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const groupId = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;

function option(n: number, name: string, details?: ProductOption["details"]): ProductOption {
  return { id: optionId(n), name, available: true, ...(details ? { details } : {}) };
}

function group(n: number, name: string, options: ProductOption[]): ProductOptionGroup {
  return { id: groupId(n), name, display: "chip", options };
}

const SMALL = option(1, "Small", {
  dimensions: { length: 120, width: 80, height: 75, unit: "cm" },
  weight: { value: 18, unit: "kg" },
  specs: [{ label: "Seats", value: "4" }],
});
const LARGE = option(2, "Large", {
  dimensions: { length: 180, width: 90, height: 75, unit: "cm" },
  weight: { value: 26, unit: "kg" },
  specs: [{ label: "Seats", value: "6" }],
});
const OAK = option(3, "Oak");
const WALNUT = option(4, "Walnut", { specs: [{ label: "Wood", value: "Solid walnut" }] });

const SIZE = group(1, "Size", [SMALL, LARGE]);
const FINISH = group(2, "Finish", [OAK, WALNUT]);

const PRODUCT_DETAILS: ProductDetails = {
  dimensions: { length: 100, width: 50, height: 70, unit: "cm" },
  weight: { value: 10, unit: "kg" },
  materials: "Solid oak",
  origin: "Portugal",
  specs: [
    { label: "Seats", value: "2" },
    { label: "Assembly", value: "Required" },
  ],
};

describe("resolveDetailsForSelection", () => {
  it("returns the product's own details untouched when nothing is picked", () => {
    const resolved = resolveDetailsForSelection(PRODUCT_DETAILS, [SIZE], new Set());
    expect(resolved).toBe(PRODUCT_DETAILS);
  });

  it("returns the product's own details when the picked version states nothing", () => {
    const resolved = resolveDetailsForSelection(PRODUCT_DETAILS, [FINISH], new Set([OAK.id]));
    expect(resolved).toBe(PRODUCT_DETAILS);
  });

  it("shows the picked version's measurements in place of the product's", () => {
    const resolved = resolveDetailsForSelection(PRODUCT_DETAILS, [SIZE], new Set([LARGE.id]));
    expect(resolved.dimensions).toEqual({ length: 180, width: 90, height: 75, unit: "cm" });
    expect(resolved.weight).toEqual({ value: 26, unit: "kg" });
    // The facts that do not vary are still the product's.
    expect(resolved.materials).toBe("Solid oak");
    expect(resolved.origin).toBe("Portugal");
  });

  it("swaps the whole set when the pick changes", () => {
    const small = resolveDetailsForSelection(PRODUCT_DETAILS, [SIZE], new Set([SMALL.id]));
    const large = resolveDetailsForSelection(PRODUCT_DETAILS, [SIZE], new Set([LARGE.id]));
    expect(small.dimensions?.length).toBe(120);
    expect(large.dimensions?.length).toBe(180);
    // And the product itself is never mutated on the way through.
    expect(PRODUCT_DETAILS.dimensions?.length).toBe(100);
  });

  it("replaces a spec row of the same name and appends a new one", () => {
    const resolved = resolveDetailsForSelection(
      PRODUCT_DETAILS,
      [SIZE, FINISH],
      new Set([LARGE.id, WALNUT.id]),
    );
    expect(resolved.specs).toEqual([
      // Replaced in place, so the row keeps the position the seller gave it.
      { label: "Seats", value: "6" },
      { label: "Assembly", value: "Required" },
      { label: "Wood", value: "Solid walnut" },
    ]);
  });

  it("matches spec rows by name regardless of case or padding", () => {
    const loose = option(5, "Loose", { specs: [{ label: "  seats ", value: "8" }] });
    const resolved = resolveDetailsForSelection(
      PRODUCT_DETAILS,
      [group(3, "Size", [loose])],
      new Set([loose.id]),
    );
    expect(resolved.specs).toHaveLength(2);
    expect(resolved.specs?.[0]?.value).toBe("8");
  });

  it("lets the seller's FIRST group win when two both claim a measurement", () => {
    const heavyFinish = option(6, "Marble", { weight: { value: 40, unit: "kg" } });
    const resolved = resolveDetailsForSelection(
      PRODUCT_DETAILS,
      [SIZE, group(4, "Finish", [heavyFinish])],
      new Set([LARGE.id, heavyFinish.id]),
    );
    expect(resolved.weight).toEqual({ value: 26, unit: "kg" });

    // Reorder the axes and the other one wins, because the order IS the rule.
    const reordered = resolveDetailsForSelection(
      PRODUCT_DETAILS,
      [group(4, "Finish", [heavyFinish]), SIZE],
      new Set([LARGE.id, heavyFinish.id]),
    );
    expect(reordered.weight).toEqual({ value: 40, unit: "kg" });
  });

  it("carries a version's measurements for a product that states none of its own", () => {
    const resolved = resolveDetailsForSelection({}, [SIZE], new Set([SMALL.id]));
    expect(specRows(resolved)).toEqual([
      { label: "Dimensions", value: "120 × 80 × 75 cm" },
      { label: "Weight", value: "18 kg" },
      { label: "Seats", value: "4" },
    ]);
  });
});

describe("optionSummaryRows", () => {
  it("names the version the measurements describe", () => {
    expect(optionSummaryRows([SIZE, FINISH], { [SIZE.id]: LARGE, [FINISH.id]: WALNUT })).toEqual([
      { label: "Size", value: "Large" },
      { label: "Finish", value: "Walnut" },
    ]);
  });

  it("skips a group with no name rather than printing a bare colon", () => {
    const unnamed = group(9, "  ", [option(9, "Red")]);
    expect(optionSummaryRows([unnamed], { [unnamed.id]: option(9, "Red") })).toEqual([]);
  });
});

describe("hasOptionDetails", () => {
  it("is true only once some version measures something of its own", () => {
    expect(hasOptionDetails([FINISH])).toBe(true);
    expect(hasOptionDetails([group(5, "Colour", [OAK])])).toBe(false);
    // An override object carrying nothing is the same as no override.
    expect(hasOptionDetails([group(6, "Colour", [option(7, "Blue", {})])])).toBe(false);
  });
});
