import { describe, expect, it } from "vitest";
import { deriveStockBadge } from "@/lib/stock/badge";
import { PUBLIC_STOCK_SELECT, toPublicStockBadge } from "@/lib/stock/public";

describe("deriveStockBadge", () => {
  it("returns null when not tracking (unlimited stock, no badge)", () => {
    expect(
      deriveStockBadge({ trackStock: false, stockQuantity: 3, lowStockThreshold: 5 }),
    ).toBeNull();
  });

  it("returns null when tracking but quantity is null (defensive)", () => {
    expect(
      deriveStockBadge({ trackStock: true, stockQuantity: null, lowStockThreshold: 5 }),
    ).toBeNull();
  });

  it("0 → sold_out", () => {
    expect(
      deriveStockBadge({ trackStock: true, stockQuantity: 0, lowStockThreshold: 5 }),
    ).toEqual({ state: "sold_out" });
  });

  it("negative (should never happen — DB check) still reads sold_out, never a weird badge", () => {
    expect(
      deriveStockBadge({ trackStock: true, stockQuantity: -1, lowStockThreshold: 5 }),
    ).toEqual({ state: "sold_out" });
  });

  it("at threshold → low_stock with the remaining count", () => {
    expect(
      deriveStockBadge({ trackStock: true, stockQuantity: 5, lowStockThreshold: 5 }),
    ).toEqual({ state: "low_stock", remaining: 5 });
  });

  it("below threshold → low_stock", () => {
    expect(
      deriveStockBadge({ trackStock: true, stockQuantity: 1, lowStockThreshold: 5 }),
    ).toEqual({ state: "low_stock", remaining: 1 });
  });

  it("one above threshold → in_stock (strict boundary)", () => {
    expect(
      deriveStockBadge({ trackStock: true, stockQuantity: 6, lowStockThreshold: 5 }),
    ).toEqual({ state: "in_stock" });
  });

  it("threshold 0: only sold_out at 0, in_stock at 1 (low_stock unreachable)", () => {
    expect(
      deriveStockBadge({ trackStock: true, stockQuantity: 0, lowStockThreshold: 0 }),
    ).toEqual({ state: "sold_out" });
    expect(
      deriveStockBadge({ trackStock: true, stockQuantity: 1, lowStockThreshold: 0 }),
    ).toEqual({ state: "in_stock" });
  });

  it("never exposes the threshold itself in any badge", () => {
    const badge = deriveStockBadge({
      trackStock: true,
      stockQuantity: 2,
      lowStockThreshold: 7,
    });
    expect(JSON.stringify(badge)).not.toContain("7");
  });
});

describe("public stock whitelist (embed payload contract)", () => {
  it("PUBLIC_STOCK_SELECT covers exactly the three derivation columns", () => {
    const cols = PUBLIC_STOCK_SELECT.split(",").map((c) => c.trim()).sort();
    expect(cols).toEqual(
      ["low_stock_threshold", "stock_quantity", "track_stock"].sort(),
    );
  });

  it("never selects private columns", () => {
    for (const secret of [
      "owner_id",
      "digital_file_key",
      "buyer_email",
      "email",
    ]) {
      expect(PUBLIC_STOCK_SELECT).not.toContain(secret);
    }
  });

  it("toPublicStockBadge maps a raw DB row through the same derivation", () => {
    expect(
      toPublicStockBadge({ track_stock: true, stock_quantity: 0, low_stock_threshold: 5 }),
    ).toEqual({ state: "sold_out" });
    expect(
      toPublicStockBadge({ track_stock: true, stock_quantity: 3, low_stock_threshold: 5 }),
    ).toEqual({ state: "low_stock", remaining: 3 });
    expect(
      toPublicStockBadge({ track_stock: false, stock_quantity: null, low_stock_threshold: 5 }),
    ).toBeNull();
  });
});
