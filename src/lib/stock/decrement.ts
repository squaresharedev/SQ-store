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
// TODO(checkout): called from order creation / the Stripe webhook when a sale
// lands. Nothing in the app invokes this yet — the caller context must supply
// a service-role SupabaseClient (dependency injection; we never construct it
// here so the caller is explicit about its privilege level).

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
  if (data === true) return { ok: true };
  return { ok: false, reason: "insufficient_stock" };
}
