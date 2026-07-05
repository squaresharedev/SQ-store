"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { STOCK_QUANTITY_MAX } from "@/lib/validation/product";

// Stock settings server action. Follows the same session-check → Zod parse →
// owner-scoped mutation pattern as lib/products/actions.ts. The owner sets an
// ABSOLUTE quantity (not a delta): a single atomic UPDATE — no read-modify-write
// race — so restocking is safe under concurrent writes.

/** Mirrors lib/products/actions.ts result shape for uniform client handling. */
export type StockActionResult = { ok: true } | { ok: false; error: string };

const GENERIC_WRITE_ERROR = "Could not save stock settings. Try again.";

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
  const user = await getUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  // Validate product id shape before querying (prevents garbage URL params from
  // reaching the DB as a mal-formed uuid parameter).
  const idCheck = z.string().uuid().safeParse(productId);
  if (!idCheck.success) return { ok: false, error: "Product not found." };

  const parsed = stockSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid stock settings." };

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
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[stock] updateStockSettings failed", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  if (!row) return { ok: false, error: "Product not found." };

  revalidatePath("/products");
  return { ok: true };
}
