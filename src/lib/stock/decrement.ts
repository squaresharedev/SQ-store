import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { STOCK_QUANTITY_MAX } from "@/lib/validation/product";

// Stock decrement — service-role-only path. The DB function decrement_stock
// runs atomically (no concurrent read-modify-write), and EXECUTE is granted
// ONLY to service_role. The anon/authenticated roles cannot call this RPC;
// attempting to do so returns a Postgres permission error, which we treat as
// "error" (not insufficient_stock) so the caller's audit trail stays accurate.
//
// NOT how an order takes its stock any more. The order writer
// (lib/orders/record.ts) goes through public.order_place, which writes the
// order and takes its units in ONE transaction (20261008_order_lifecycle);
// taking them here, in a second statement after the order existed, is what let
// two buyers both be sold the last one. This stays for stock taken outside an
// order (scripts/stock-smoke.ts). The caller supplies a service-role
// SupabaseClient (dependency injection; we never construct it here so the
// caller is explicit about its privilege level).
//
// THE DB FUNCTION ALSO ENFORCES products.max_per_order, as a second fence
// behind resolveOrderQuantity (lib/products/order-quantity.ts). It reads the
// ceiling AS IT IS NOW, so a seller who lowers the cap between a payment
// landing and this call turns an already-paid order into `insufficient_stock`.
// That is the right way for a fence to fail — refusing is recoverable, an
// unchecked decrement is not — but it means the checkout caller has to treat
// this result as a real outcome to reconcile, never as a formality.

/** Validated parameter constraints — mirror the DB function signature. */
const decrementArgsSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(STOCK_QUANTITY_MAX),
});

export type DecrementResult =
  | { ok: true }
  | { ok: false; reason: "insufficient_stock" | "error" };

/**
 * Atomically decrement stock for a product via the `decrement_stock` DB
 * function. Returns `{ ok: true }` on success; `{ ok: false, reason }` when
 * stock is insufficient/untracked or the call fails.
 *
 * The `client` MUST be a service-role client — EXECUTE on decrement_stock is
 * revoked from anon and authenticated roles. The caller is responsible for
 * constructing (and disposing of) the privileged client; we accept it as a
 * parameter to keep privilege boundaries explicit and testable.
 *
 * `data === true` → decremented successfully.
 * `data === false` or `data === null` → product not found, not tracking stock,
 * or quantity would go negative (the DB function returns false in all of these
 * cases rather than raising an exception).
 */
export async function decrementStock(
  client: SupabaseClient<Database>,
  productId: string,
  quantity: number,
): Promise<DecrementResult> {
  const parsed = decrementArgsSchema.safeParse({ productId, quantity });
  if (!parsed.success) {
    return { ok: false, reason: "error" };
  }

  const { data, error } = await client.rpc("decrement_stock", {
    p_product_id: parsed.data.productId,
    p_quantity: parsed.data.quantity,
  });

  if (error) {
    console.error("[stock] decrement_stock RPC failed", error);
    return { ok: false, reason: "error" };
  }

  // The function returns true on success, false/null on insufficient stock
  // (not tracking, already at zero, or would go negative).
  if (data === true) {
    // The low-stock notification is the order writer's (lib/orders/record.ts
    // tellSellerStockIsLow): order_place reports what is left with the order.
    return { ok: true };
  }
  return { ok: false, reason: "insufficient_stock" };
}
