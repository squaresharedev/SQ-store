import { z } from "zod";
import { CART_LINES_MAX, CART_OPTIONS_PER_LINE } from "@/lib/cart/limits";
import { ORDER_LINE_SOURCES, lineKey } from "@/lib/checkout/lines";
import { PURCHASE_QUANTITY_MAX } from "@/lib/validation/product";
import type { CartLine } from "@/types/cart";

// WHAT A CART HOLDS, and how a change to it is made. Pure: the cart routes
// (app/api/cart) read the stored lines, change them here, and write them back;
// a test changes them here directly. Nothing here knows a price or whether a
// product can be sold: that is the quote's question, asked when the cart is
// shown (lib/cart/view.ts).

const storedLineSchema = z.object({
  productId: z.uuid(),
  optionIds: z.array(z.uuid()).max(CART_OPTIONS_PER_LINE),
  quantity: z.number().int().min(1).max(PURCHASE_QUANTITY_MAX),
  source: z.enum(ORDER_LINE_SOURCES),
  addedAt: z.string().max(40),
});

/**
 * A cart's stored lines, as far as they can be trusted: malformed entries are
 * dropped, two entries for the same line are merged, and nothing past
 * CART_LINES_MAX is kept. The table's CHECKs bound what is stored; this bounds
 * what is believed.
 */
export function parseCartLines(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  let lines: CartLine[] = [];
  for (const entry of raw) {
    const parsed = storedLineSchema.safeParse(entry);
    if (!parsed.success) continue;
    lines = addLine(lines, { ...parsed.data, optionIds: [...parsed.data.optionIds] });
  }
  return lines.slice(0, CART_LINES_MAX);
}

/** A change a buyer makes. `key` names a line (lib/checkout/lines.ts lineKey). */
export type CartChange =
  | {
      kind: "add";
      productId: string;
      optionIds: readonly string[];
      quantity: number;
      source: CartLine["source"];
    }
  /** A new quantity; 0 takes the line out. */
  | { kind: "set"; key: string; quantity: number }
  | { kind: "remove"; key: string }
  | { kind: "clear" };

export type CartChangeResult =
  | { ok: true; lines: CartLine[] }
  /** full: no room for another line; quantity: more than one order can hold;
   *  missing: no such line (another tab took it out first). */
  | { ok: false; reason: "full" | "quantity" | "missing" };

/** Apply one change. Refuses rather than trims: a cart that quietly held
 *  fewer than the buyer pressed is the checkout's lowered quantity again. */
export function changeCartLines(lines: readonly CartLine[], change: CartChange, now: Date): CartChangeResult {
  switch (change.kind) {
    case "add": {
      const key = lineKey(change);
      const existing = lines.find((line) => lineKey(line) === key);
      if (existing) {
        if (existing.quantity + change.quantity > PURCHASE_QUANTITY_MAX) return { ok: false, reason: "quantity" };
      } else if (lines.length >= CART_LINES_MAX) {
        return { ok: false, reason: "full" };
      }
      return {
        ok: true,
        lines: addLine(lines, {
          productId: change.productId,
          optionIds: [...change.optionIds],
          quantity: change.quantity,
          source: change.source,
          addedAt: now.toISOString(),
        }),
      };
    }
    case "set": {
      const at = lines.findIndex((line) => lineKey(line) === change.key);
      if (at === -1) return { ok: false, reason: "missing" };
      if (change.quantity === 0) return { ok: true, lines: lines.filter((_, index) => index !== at) };
      if (!Number.isInteger(change.quantity) || change.quantity < 0 || change.quantity > PURCHASE_QUANTITY_MAX) {
        return { ok: false, reason: "quantity" };
      }
      return {
        ok: true,
        lines: lines.map((line, index) => (index === at ? { ...line, quantity: change.quantity } : line)),
      };
    }
    case "remove": {
      // Already gone (another tab) is the same answer as taken out now.
      return { ok: true, lines: lines.filter((line) => lineKey(line) !== change.key) };
    }
    case "clear":
      return { ok: true, lines: [] };
  }
}

/**
 * Another cart's lines brought into this one (a buyer whose embedded shop had
 * a cart opens our page, which held one too): same lines add up, new ones go
 * after, and whatever would not fit (past CART_LINES_MAX, or a quantity no
 * order can hold) stays out rather than failing the whole merge.
 */
export function mergeCartLines(into: readonly CartLine[], from: readonly CartLine[]): CartLine[] {
  let lines = [...into];
  for (const line of from) {
    const key = lineKey(line);
    const existing = lines.find((candidate) => lineKey(candidate) === key);
    if (existing) {
      if (existing.quantity + line.quantity > PURCHASE_QUANTITY_MAX) continue;
    } else if (lines.length >= CART_LINES_MAX) {
      continue;
    }
    lines = addLine(lines, line);
  }
  return lines;
}

/** How many items a cart holds, quantities summed: the cart button's count. */
export function cartItemCount(lines: readonly Pick<CartLine, "quantity">[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

/** Add a line, or add to the same line's quantity (keeping where it was). */
function addLine(lines: readonly CartLine[], line: CartLine): CartLine[] {
  const key = lineKey(line);
  const at = lines.findIndex((candidate) => lineKey(candidate) === key);
  if (at === -1) return [...lines, line];
  return lines.map((candidate, index) =>
    index === at
      ? { ...candidate, quantity: Math.min(PURCHASE_QUANTITY_MAX, candidate.quantity + line.quantity) }
      : candidate,
  );
}
