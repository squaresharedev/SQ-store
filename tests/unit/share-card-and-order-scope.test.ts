import { describe, expect, it } from "vitest";
import { decode } from "node:querystring";
import { ORDERS_PRODUCT_PARAM, ordersViewPath } from "@/lib/orders/paths";
import { qrPath } from "@/lib/share-card/qr";

describe("ordersViewPath", () => {
  it("names the list, and the product when there is one", () => {
    expect(ordersViewPath("to-ship")).toBe("/orders?view=to-ship");
    expect(ordersViewPath("all", null)).toBe("/orders?view=all");
    const id = "6f1c2a9e-3b0d-4c55-9a77-2d1e8f4b6c10";
    const query = decode(ordersViewPath("to-ship", id).split("?")[1]);
    expect(query).toEqual({ view: "to-ship", [ORDERS_PRODUCT_PARAM]: id });
  });
});

describe("qrPath", () => {
  it("draws one unit square per dark module, inside a square of `size`", () => {
    const { size, path } = qrPath("https://squareshare.eu/s/loft-and-grain");
    // Version 3 or so for a URL this long: 29 modules across, never fewer than 21.
    expect(size).toBeGreaterThanOrEqual(21);
    const squares = [...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)];
    expect(squares.length).toBeGreaterThan(0);
    expect(squares.map((m) => m[0]).join("")).toBe(path);
    for (const [, x, y] of squares) {
      expect(Number(x)).toBeLessThan(size);
      expect(Number(y)).toBeLessThan(size);
    }
    // The three finder patterns: every corner but bottom right starts dark.
    expect(path).toContain("M0 0h1v1h-1z");
    expect(path).toContain(`M${size - 1} 0h1v1h-1z`);
    expect(path).toContain(`M0 ${size - 1}h1v1h-1z`);
  });
});
