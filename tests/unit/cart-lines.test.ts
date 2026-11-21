/**
 * THE CART'S LINES: what a change does to them (lib/cart/lines.ts), how stored
 * lines are believed, and what a request may say (lib/validation/cart.ts).
 * Refuse rather than trim: a cart that quietly held fewer than the buyer
 * pressed is the checkout's lowered quantity again.
 */
import { describe, expect, it } from "vitest";
import { cartItemCount, changeCartLines, mergeCartLines, parseCartLines } from "@/lib/cart/lines";
import { lineKey } from "@/lib/checkout/lines";
import { cartWriteSchema } from "@/lib/validation/cart";
import { CART_LINES_MAX } from "@/lib/cart/limits";
import { PURCHASE_QUANTITY_MAX } from "@/lib/validation/product";
import type { CartLine } from "@/types/cart";

const NOW = new Date("2026-11-20T10:00:00Z");
const VASE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SMALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LARGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

function line(productId: string, optionIds: string[] = [], quantity = 1): CartLine {
  return { productId, optionIds, quantity, source: "cart", addedAt: NOW.toISOString() };
}
const add = (productId: string, optionIds: string[] = [], quantity = 1) =>
  ({ kind: "add", productId, optionIds, quantity, source: "cart" }) as const;

describe("a line's key", () => {
  it("is the product and its version, whatever order the options came in", () => {
    expect(lineKey({ productId: VASE, optionIds: [SMALL, RED] })).toBe(lineKey({ productId: VASE, optionIds: [RED, SMALL] }));
    expect(lineKey({ productId: VASE, optionIds: [SMALL] })).not.toBe(lineKey({ productId: VASE, optionIds: [LARGE] }));
  });
});

describe("changing a cart", () => {
  it("adds a new line, and adds to a line already there", () => {
    const once = changeCartLines([], add(VASE, [SMALL]), NOW);
    expect(once).toEqual({ ok: true, lines: [line(VASE, [SMALL])] });
    const twice = changeCartLines(once.ok ? once.lines : [], add(VASE, [SMALL], 2), NOW);
    expect(twice.ok && twice.lines).toEqual([line(VASE, [SMALL], 3)]);
    // Another version is another line.
    const other = changeCartLines(twice.ok ? twice.lines : [], add(VASE, [LARGE]), NOW);
    expect(other.ok && other.lines.length).toBe(2);
  });

  it("refuses a line past CART_LINES_MAX and a quantity past one order's, rather than trimming", () => {
    const full = Array.from({ length: CART_LINES_MAX }, (_, n) => line(id(n)));
    expect(changeCartLines(full, add(id(999)), NOW)).toEqual({ ok: false, reason: "full" });
    // Adding to a line already there still works when the cart is full.
    expect(changeCartLines(full, add(id(0)), NOW).ok).toBe(true);
    expect(changeCartLines([line(VASE, [], PURCHASE_QUANTITY_MAX)], add(VASE), NOW)).toEqual({
      ok: false,
      reason: "quantity",
    });
  });

  it("sets a quantity, takes a line out at 0, and says when the line is already gone", () => {
    const lines = [line(VASE, [SMALL], 2), line(RED)];
    const key = lineKey(lines[0]!);
    expect(changeCartLines(lines, { kind: "set", key, quantity: 5 }, NOW)).toEqual({
      ok: true,
      lines: [line(VASE, [SMALL], 5), line(RED)],
    });
    expect(changeCartLines(lines, { kind: "set", key, quantity: 0 }, NOW)).toEqual({ ok: true, lines: [line(RED)] });
    expect(changeCartLines(lines, { kind: "set", key: lineKey(line(LARGE)), quantity: 1 }, NOW)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(changeCartLines(lines, { kind: "set", key, quantity: PURCHASE_QUANTITY_MAX + 1 }, NOW)).toEqual({
      ok: false,
      reason: "quantity",
    });
  });

  it("removes (gone already reads the same), and empties", () => {
    const lines = [line(VASE), line(RED)];
    expect(changeCartLines(lines, { kind: "remove", key: lineKey(lines[0]!) }, NOW)).toEqual({ ok: true, lines: [line(RED)] });
    expect(changeCartLines(lines, { kind: "remove", key: lineKey(line(LARGE)) }, NOW)).toEqual({ ok: true, lines });
    expect(changeCartLines(lines, { kind: "clear" }, NOW)).toEqual({ ok: true, lines: [] });
  });

  it("counts items with quantities summed", () => {
    expect(cartItemCount([line(VASE, [], 3), line(RED)])).toBe(4);
  });
});

describe("merging two carts", () => {
  it("adds up the same lines, puts new ones after, and leaves out what would not fit", () => {
    const into = [line(VASE, [SMALL], 2)];
    const from = [line(VASE, [SMALL], 1), line(RED)];
    expect(mergeCartLines(into, from)).toEqual([line(VASE, [SMALL], 3), line(RED)]);
    const full = Array.from({ length: CART_LINES_MAX }, (_, n) => line(id(n)));
    expect(mergeCartLines(full, [line(RED)])).toEqual(full);
    expect(mergeCartLines([line(VASE, [], PURCHASE_QUANTITY_MAX)], [line(VASE)])).toEqual([
      line(VASE, [], PURCHASE_QUANTITY_MAX),
    ]);
  });
});

describe("believing stored lines", () => {
  it("drops what does not parse, merges doubles and keeps at most CART_LINES_MAX", () => {
    const stored = [
      line(VASE, [SMALL]),
      { productId: "nope", optionIds: [], quantity: 1, source: "cart", addedAt: "x" },
      { ...line(RED), quantity: 0 },
      { ...line(RED), source: "elsewhere" },
      line(VASE, [SMALL], 2),
      "a string",
      ...Array.from({ length: CART_LINES_MAX + 5 }, (_, n) => line(id(n))),
    ];
    const lines = parseCartLines(stored);
    expect(lines[0]).toEqual(line(VASE, [SMALL], 3));
    expect(lines).toHaveLength(CART_LINES_MAX);
    expect(parseCartLines(null)).toEqual([]);
    expect(parseCartLines({ lines: [] })).toEqual([]);
  });
});

describe("what a cart request may say", () => {
  const parse = (body: unknown) => cartWriteSchema.safeParse(body).success;

  it("names products, versions and quantities, never a price", () => {
    expect(parse({ cartId: null, change: { kind: "add", productId: VASE, optionIds: [SMALL], quantity: 1, source: "cart" } })).toBe(true);
    expect(
      parse({
        cartId: null,
        change: { kind: "add", productId: VASE, optionIds: [], quantity: 1, source: "cart", priceCents: 1 },
      }),
    ).toBe(false);
    expect(parse({ cartId: VASE, change: { kind: "set", key: `${VASE}.${SMALL}`, quantity: 0 } })).toBe(true);
    expect(parse({ cartId: VASE, change: { kind: "clear" } })).toBe(true);
    expect(parse({ cartId: VASE, change: { kind: "merge", fromCartId: RED } })).toBe(true);
  });

  it("refuses a malformed key, a quantity out of range, too many options and an unknown change", () => {
    expect(parse({ cartId: VASE, change: { kind: "set", key: "../etc", quantity: 1 } })).toBe(false);
    expect(parse({ cartId: VASE, change: { kind: "set", key: VASE.toUpperCase(), quantity: 1 } })).toBe(false);
    expect(
      parse({ cartId: null, change: { kind: "add", productId: VASE, optionIds: [], quantity: 0, source: "cart" } }),
    ).toBe(false);
    expect(
      parse({ cartId: null, change: { kind: "add", productId: VASE, optionIds: [], quantity: 1.5, source: "cart" } }),
    ).toBe(false);
    expect(
      parse({
        cartId: null,
        change: { kind: "add", productId: VASE, optionIds: [SMALL, LARGE, RED, VASE, id(1)], quantity: 1, source: "cart" },
      }),
    ).toBe(false);
    expect(parse({ cartId: null, change: { kind: "empty" } })).toBe(false);
    expect(parse({ change: { kind: "clear" } })).toBe(false);
  });
});
