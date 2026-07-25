"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  failure,
  invalidInput,
  notFound,
  permissionDenied,
  serverError,
  sessionExpired,
  type ActionFailure,
} from "@/lib/errors";
import { STOCK_QUANTITY_MAX } from "@/lib/validation/product";

// Stock settings server action. Follows the same session-check → Zod parse →
// owner-scoped mutation pattern as lib/products/actions.ts. The owner sets an
// ABSOLUTE quantity (not a delta): a single atomic UPDATE — no read-modify-write
// race — so restocking is safe under concurrent writes.

/** Mirrors lib/products/actions.ts result shape for uniform client handling. */
export type StockActionResult = { ok: true } | ActionFailure;

// Local schema: only the stock fields. Quantity is required when tracking is
// enabled — mirrors the DB check constraint and productWriteSchema's refine.
const stockSettingsSchema = z
  .object({
    trackStock: z.boolean(),
    stockQuantity: z.number().int().min(0).max(STOCK_QUANTITY_MAX).nullish(),
    lowStockThreshold: z.number().int().min(0).max(STOCK_QUANTITY_MAX),
  })
  .refine(
    (data) => data.trackStock !== true || typeof data.stockQuantity === "number",
    { error: "Set how many are in stock.", path: ["stockQuantity"] },
  );

/**
 * Persist stock settings for a product. Owner-scoped: the .eq("owner_id")
 * guard ensures a seller can only update their own rows even if the product id
 * is spoofed. RLS enforces the same constraint at the DB layer.
 *
 * When `trackStock` is false we write `stock_quantity = null` — the DB check
 * constraint requires a quantity when tracking, so keeping a stale number would
 * be inconsistent and the field is meaningless without tracking enabled.
 */
export async function updateStockSettings(
  productId: string,
  input: unknown,
): Promise<StockActionResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "edit products"));
  }

  // Validate product id shape before querying (prevents garbage URL params from
  // reaching the DB as a mal-formed uuid parameter).
  const idCheck = z.string().uuid().safeParse(productId);
  if (!idCheck.success) return failure(notFound("product"));

  const parsed = stockSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      invalidInput(
        "The stock settings didn't pass validation.",
        "Quantity and threshold must be whole numbers of 0 or more, and when tracking is on, set how many are in stock.",
      ),
    );
  }

  const { trackStock, stockQuantity, lowStockThreshold } = parsed.data;

  // Canonical storage: quantity is null when not tracking, even if the form
  // sent a number (avoids stale inventory numbers floating around).
  const resolvedQuantity = trackStock
    ? (stockQuantity ?? null)
    : null;

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("products")
    .update({
      track_stock: trackStock,
      stock_quantity: resolvedQuantity,
      low_stock_threshold: lowStockThreshold,
    })
    .eq("id", idCheck.data)
    .eq("owner_id", account.accountId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[stock] updateStockSettings failed", error);
    return failure(serverError("save the stock settings"));
  }
  if (!row) return failure(notFound("product"));

  revalidatePath("/products");
  return { ok: true };
}
