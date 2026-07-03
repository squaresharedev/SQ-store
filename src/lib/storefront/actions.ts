"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import type { StorefrontConfig } from "@/types/storefront";

export type SaveStorefrontResult =
  | {
      ok: true;
      /** Stable public storefront id (future embed/attribution key). */
      id: string;
      /** Blocks removed because their product no longer exists / isn't owned. */
      droppedBlocks: number;
    }
  | { ok: false; error: string };

/**
 * Save the seller's storefront. Security boundary: session check -> Zod parse
 * (client validation is UX only) -> every block.productId re-checked against
 * the caller's OWN products (never trust client-supplied ids) -> owner-scoped
 * upsert (RLS enforces ownership at the DB too).
 */
export async function saveStorefront(
  input: unknown,
): Promise<SaveStorefrontResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const parsed = storefrontConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid storefront configuration." };
  }

  const supabase = await createClient();

  // Ownership check: keep only product blocks whose product exists AND
  // belongs to the caller. Unknown ids are dropped (a product deleted
  // mid-edit should not block saving), never trusted. Text blocks carry no
  // references, so they pass through as-parsed.
  let blocks = parsed.data.blocks;
  const productIds = blocks
    .filter((block) => block.type === "product")
    .map((block) => block.productId);
  if (productIds.length > 0) {
    const { data: ownedRows, error } = await supabase
      .from("products")
      .select("id")
      .eq("owner_id", user.id)
      .in("id", productIds);
    if (error) {
      console.error("[storefront] ownership check failed", error);
      return { ok: false, error: "Could not save your storefront. Try again." };
    }
    const ownedIds = new Set(ownedRows.map((row) => row.id));
    blocks = blocks.filter(
      (block) => block.type !== "product" || ownedIds.has(block.productId),
    );
  }

  const config: StorefrontConfig = {
    theme: parsed.data.theme,
    // Normalize order to a clean 0..n sequence.
    blocks: blocks
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((block, index) => ({ ...block, order: index })),
  };

  // NOTE(forward-compat): when orders exist, each sale records its channel
  // ('embed' | 'marketplace') plus this storefront's stable `id`, so sellers
  // can split revenue by channel. Do not repurpose or rotate the id.
  const { data: row, error } = await supabase
    .from("storefronts")
    .upsert({ owner_id: user.id, config }, { onConflict: "owner_id" })
    .select("id")
    .single();

  if (error || !row) {
    console.error("[storefront] save failed", error);
    return { ok: false, error: "Could not save your storefront. Try again." };
  }

  revalidatePath("/storefront");
  return {
    ok: true,
    id: row.id,
    droppedBlocks: parsed.data.blocks.length - config.blocks.length,
  };
}
