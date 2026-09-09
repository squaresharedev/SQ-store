/**
 * The quantity rules a buyer's page is built from.
 *
 * Two of these are policy, not arithmetic, and they are the reason this file
 * exists: the picker's ceiling must never publish a stock number the badge
 * has not already published, and a clamp must never be mistaken for a
 * permission. The second is proved in order-quantity.test.ts, which is the
 * layer that actually decides.
 */
import { describe, expect, it } from "vitest";
import {
  clampQuantity,
  lineTotalCents,
  productQuantityCap,
  publicQuantityLimit,
  requestedQuantity,
} from "@/lib/products/quantity";
import { MAX_PER_ORDER_DEFAULT, PURCHASE_QUANTITY_MAX } from "@/lib/validation/product";

describe("productQuantityCap", () => {
  it("passes a legal ceiling through untouched", () => {
    expect(productQuantityCap(3)).toBe(3);
    expect(productQuantityCap(1)).toBe(1);
    expect(productQuantityCap(PURCHASE_QUANTITY_MAX)).toBe(PURCHASE_QUANTITY_MAX);
  });

  it("corrects a stored value the CHECK would not have allowed", () => {
    // A row written before the constraint, or by a service-role path that
    // skipped the schema. Believed as far as the legal range and no further.
    expect(productQuantityCap(9_999)).toBe(PURCHASE_QUANTITY_MAX);
    expect(productQuantityCap(0)).toBe(1);
    expect(productQuantityCap(-5)).toBe(1);
    expect(productQuantityCap(4.7)).toBe(4);
  });

  it("falls back to the column's own default when there is no value", () => {
    expect(productQuantityCap(null)).toBe(MAX_PER_ORDER_DEFAULT);
    expect(productQuantityCap(undefined)).toBe(MAX_PER_ORDER_DEFAULT);
    expect(productQuantityCap(Number.NaN)).toBe(MAX_PER_ORDER_DEFAULT);
  });
});

describe("publicQuantityLimit", () => {
  it("offers the seller's ceiling when stock is not tracked", () => {
    expect(
      publicQuantityLimit({
        maxPerOrder: 6,
        trackStock: false,
        stockQuantity: null,
        lowStockThreshold: 5,
      }),
    ).toBe(6);
  });

  it("offers nothing when the shelf is empty", () => {
    expect(
      publicQuantityLimit({
        maxPerOrder: 6,
        trackStock: true,
        stockQuantity: 0,
        lowStockThreshold: 5,
      }),
    ).toBe(0);
  });

  it("narrows to the remaining count ONLY once the page has published it", () => {
    // "Only 2 left" is already printed beside the picker, so stopping the list
    // at 2 tells the buyer nothing the page did not.
    expect(
      publicQuantityLimit(
        { maxPerOrder: 6, trackStock: true, stockQuantity: 2, lowStockThreshold: 5 },
        { stockShown: true },
      ),
    ).toBe(2);
  });

  it("does not narrow to a stock count the page has kept private", () => {
    // THE PRIVACY INVARIANT. 7 units on hand, above the threshold, so the badge
    // says only "In stock". A limit of 7 here would publish the shelf; the
    // ceiling stays the seller's own, and the oversell is caught by
    // resolveOrderQuantity instead.
    expect(
      publicQuantityLimit(
        { maxPerOrder: 10, trackStock: true, stockQuantity: 7, lowStockThreshold: 5 },
        { stockShown: true },
      ),
    ).toBe(10);
  });

  it("does not narrow when the seller has turned stock display OFF", () => {
    // The same low-stock product as above. With showStock off the page prints
    // no "Only 2 left", so a list stopping at 2 would be disclosing a count the
    // seller chose to hide — in a control nobody thinks of as a disclosure.
    const low = { maxPerOrder: 6, trackStock: true, stockQuantity: 2, lowStockThreshold: 5 };
    expect(publicQuantityLimit(low, { stockShown: false })).toBe(6);
    // And OFF is the default, so a caller that has not thought about it cannot
    // leak by omission.
    expect(publicQuantityLimit(low)).toBe(6);
    expect(publicQuantityLimit(low, {})).toBe(6);
  });

  it("still offers nothing when sold out, whatever the display switch says", () => {
    // Not gated: the button reads "Sold out" either way, so zero discloses
    // nothing a buyer cannot already see.
    const gone = { maxPerOrder: 6, trackStock: true, stockQuantity: 0, lowStockThreshold: 5 };
    expect(publicQuantityLimit(gone, { stockShown: false })).toBe(0);
    expect(publicQuantityLimit(gone, { stockShown: true })).toBe(0);
  });

  it("never lets the shelf raise the seller's ceiling", () => {
    expect(
      publicQuantityLimit(
        { maxPerOrder: 2, trackStock: true, stockQuantity: 900, lowStockThreshold: 5 },
        { stockShown: true },
      ),
    ).toBe(2);
  });
});

describe("clampQuantity", () => {
  it("keeps a legal request", () => {
    expect(clampQuantity(3, 10)).toBe(3);
    expect(clampQuantity("3", 10)).toBe(3);
  });

  it("brings anything outside the limit back inside it", () => {
    expect(clampQuantity(999, 5)).toBe(5);
    expect(clampQuantity(0, 5)).toBe(1);
    expect(clampQuantity(-4, 5)).toBe(1);
    expect(clampQuantity(2.9, 5)).toBe(2);
  });

  it("reads a forged or malformed parameter as one", () => {
    for (const forged of ["abc", "", "1e9", "  ", "NaN", null, undefined, {}, []]) {
      expect(clampQuantity(forged, 10)).toBe(1);
    }
  });

  it("refuses to parse an over-long parameter at all", () => {
    // Three digits covers every legal value; a longer one is a probe.
    expect(clampQuantity("9999", 100)).toBe(1);
  });

  it("never exceeds the platform ceiling, whatever limit it is handed", () => {
    expect(clampQuantity(10_000, 1_000_000)).toBe(PURCHASE_QUANTITY_MAX);
  });

  it("treats a broken limit as one", () => {
    expect(clampQuantity(5, 0)).toBe(1);
    expect(clampQuantity(5, Number.NaN)).toBe(1);
  });
});

describe("requestedQuantity", () => {
  it("takes the first value when the parameter repeats", () => {
    expect(requestedQuantity(["2", "9"], 10)).toBe(2);
  });

  it("is one when the parameter is absent", () => {
    expect(requestedQuantity(undefined, 10)).toBe(1);
  });
});

describe("lineTotalCents", () => {
  it("multiplies integers, exactly", () => {
    expect(lineTotalCents(1299, 3)).toBe(3897);
    // The bound the platform ceiling exists to keep: still an exact integer.
    expect(Number.isSafeInteger(lineTotalCents(100_000_000, PURCHASE_QUANTITY_MAX))).toBe(true);
  });
});
