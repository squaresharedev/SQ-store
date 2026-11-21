// SERVER ONLY. Where carts live: public.carts (20261120_shopping_cart.sql),
// service role only, reached by a cart's random id, which is the buyer's only
// key to it. Every read names the storefront too, so one storefront's cart id
// is nothing on another storefront.
//
// WRITES NEVER LOSE AN ADD. Two tabs pressing "Add to cart" at the same moment
// both read the cart, change it and write it back; the second write would
// erase the first. So every write says which revision it changed, and is
// refused if the cart moved on in between; the loser reads again and retries.

import type { createAdminClient } from "@/lib/supabase/admin";
import { CART_IDLE_DAYS } from "@/lib/cart/limits";
import { changeCartLines, mergeCartLines, parseCartLines, type CartChange } from "@/lib/cart/lines";
import type { CartLine } from "@/types/cart";
import type { Json } from "@/types";

type Admin = ReturnType<typeof createAdminClient>;

export type StoredCart = {
  id: string;
  lines: CartLine[];
  rev: number;
  /** Paid: takes no more lines. */
  closed: boolean;
};

type CartRow = {
  id: string;
  lines: unknown;
  rev: number;
  ordered_at: string | null;
  updated_at: string;
};

const CART_SELECT = "id, lines, rev, ordered_at, updated_at" as const;
const IDLE_MS = CART_IDLE_DAYS * 24 * 60 * 60 * 1000;
/** A write that keeps losing to other tabs gives up after this many tries. */
const WRITE_ATTEMPTS = 3;

function toCart(row: CartRow): StoredCart {
  return { id: row.id, lines: parseCartLines(row.lines), rev: row.rev, closed: row.ordered_at !== null };
}

/**
 * A storefront's cart by its id. Null when there is none: never existed,
 * another storefront's, or idle past CART_IDLE_DAYS (the sweep may not have
 * run yet; an expired cart is gone either way). "error" when the database did
 * not answer.
 */
export async function readCart(
  admin: Admin,
  cartId: string,
  storefrontId: string,
  now: Date = new Date(),
): Promise<StoredCart | null | "error"> {
  const { data, error } = await admin
    .from("carts")
    .select(CART_SELECT)
    .eq("id", cartId)
    .eq("storefront_id", storefrontId)
    .maybeSingle();
  if (error) {
    console.error("[cart] read failed", error.message);
    return "error";
  }
  const row = data as CartRow | null;
  if (!row || now.getTime() - Date.parse(row.updated_at) > IDLE_MS) return null;
  return toCart(row);
}

export type CartWriteResult =
  | { ok: true; cart: StoredCart }
  | { ok: false; reason: "full" | "quantity" | "missing" | "error" };

/**
 * Make one change to a buyer's cart, starting a new cart when they have none
 * (or theirs was paid, or expired). The answer is the cart as written.
 */
export async function changeCart(
  admin: Admin,
  input: { cartId: string | null; storefrontId: string; change: CartChange; now?: Date },
): Promise<CartWriteResult> {
  const now = input.now ?? new Date();
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const current = input.cartId ? await readCart(admin, input.cartId, input.storefrontId, now) : null;
    if (current === "error") return { ok: false, reason: "error" };
    const live = current && !current.closed ? current : null;
    const changed = changeCartLines(live?.lines ?? [], input.change, now);
    if (!changed.ok) return changed;
    const written = live
      ? await updateCart(admin, live, changed.lines, now)
      : await insertCart(admin, input.storefrontId, changed.lines);
    if (written === "error") return { ok: false, reason: "error" };
    if (written) return { ok: true, cart: written };
    // Another tab wrote first: read again and redo the change on top of it.
  }
  return { ok: false, reason: "error" };
}

/**
 * Bring one cart's lines into another (a buyer's embedded shop handed its
 * cart to our page, which held one of its own): see mergeCartLines. The cart
 * merged FROM is deleted. Both must be this storefront's; when the one merged
 * INTO is gone, the other simply carries on as the buyer's cart.
 */
export async function mergeCarts(
  admin: Admin,
  input: { intoId: string; fromId: string; storefrontId: string; now?: Date },
): Promise<StoredCart | null | "error"> {
  const now = input.now ?? new Date();
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const [into, from] = await Promise.all([
      readCart(admin, input.intoId, input.storefrontId, now),
      readCart(admin, input.fromId, input.storefrontId, now),
    ]);
    if (into === "error" || from === "error") return "error";
    const liveInto = into && !into.closed ? into : null;
    const liveFrom = from && !from.closed ? from : null;
    if (!liveFrom || input.fromId === input.intoId) return liveInto;
    if (!liveInto) return liveFrom;
    const written = await updateCart(admin, liveInto, mergeCartLines(liveInto.lines, liveFrom.lines), now);
    if (written === "error") return "error";
    if (written) {
      const { error } = await admin
        .from("carts")
        .delete()
        .eq("id", input.fromId)
        .eq("storefront_id", input.storefrontId);
      if (error) console.error("[cart] merged cart not deleted", error.message);
      return written;
    }
  }
  return "error";
}

/**
 * The order paid from a cart closes it: every tab and the embedded shop
 * holding its id see it closed on their next look, and start afresh. Called
 * once an order is PAID (lib/orders/record.ts). Best-effort and idempotent:
 * an open cart left behind is a cart the buyer can empty, not a lost order.
 */
export async function closeOrderCart(admin: Admin, orderId: string): Promise<void> {
  const { data, error } = await admin.from("orders").select("cart_id").eq("id", orderId).maybeSingle();
  if (error) {
    console.error("[cart] order read failed", error.message);
    return;
  }
  const cartId = (data as { cart_id: string | null } | null)?.cart_id;
  if (cartId) await closeCart(admin, cartId);
}

/** closeOrderCart for a caller that already knows the cart's id. */
export async function closeCart(admin: Admin, cartId: string): Promise<void> {
  const { error } = await admin
    .from("carts")
    .update({ ordered_at: new Date().toISOString() })
    .eq("id", cartId)
    .is("ordered_at", null);
  if (error) console.error("[cart] closing a paid cart failed", error.message);
}

/** Write `lines` over the revision `cart` was read at. Null when another
 *  write got there first. */
async function updateCart(
  admin: Admin,
  cart: StoredCart,
  lines: CartLine[],
  now: Date,
): Promise<StoredCart | null | "error"> {
  const { data, error } = await admin
    .from("carts")
    .update({ lines: lines as unknown as Json, rev: cart.rev + 1, updated_at: now.toISOString() })
    .eq("id", cart.id)
    .eq("rev", cart.rev)
    .is("ordered_at", null)
    .select(CART_SELECT)
    .maybeSingle();
  if (error) {
    console.error("[cart] write failed", error.message);
    return "error";
  }
  return data ? toCart(data as CartRow) : null;
}

async function insertCart(admin: Admin, storefrontId: string, lines: CartLine[]): Promise<StoredCart | "error"> {
  const { data, error } = await admin
    .from("carts")
    .insert({ storefront_id: storefrontId, lines: lines as unknown as Json, rev: 1 })
    .select(CART_SELECT)
    .single();
  if (error || !data) {
    console.error("[cart] create failed", error?.message);
    return "error";
  }
  return toCart(data as CartRow);
}
