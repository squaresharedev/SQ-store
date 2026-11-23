"use server";

import { z } from "zod";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  failure,
  invalidInput,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionFailure,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { productIdSchema } from "@/lib/validation/product";
import { readPhotoEdge } from "@/lib/storefront/photo-edge";
import { msg } from "@/i18n/types";
import { PHOTO_EDGES, type PhotoEdge } from "@/types/product";

/**
 * STORE A PHOTO'S MEASURED EDGE ON ITS PRODUCT (lib/storefront/photo-edge).
 *
 * Called by the seller's own browser, never by a person's click: as a photo is
 * uploaded (ProductForm), and when the designer or the Products list measures
 * a photo that has no answer yet (usePhotoEdgeBackfill). So a refusal is quiet
 * on the page: the photo just stays unmeasured, and is asked about again on a
 * later visit.
 *
 * WHAT IT WRITES, AND ONLY THAT:
 *   - a value from the enum (PHOTO_EDGES), never anything else;
 *   - for the product's CURRENT photo. The caller names the photo it measured
 *     (its storage key), and the update matches only while that photo is still
 *     the product's, in the same statement, so an answer about a replaced
 *     photo lands nowhere (and the database clears an answer when the photo
 *     changes, whoever changes it);
 *   - for a product of the store the caller acts for (the active account, so a
 *     team member writes on the owner's store), with products.write, exactly
 *     as every product write is checked. RLS asks the same at the database.
 *
 * NOT CONTENT. photo_edge is not a moderated column, so this neither re-checks
 * nor holds the product, and the database leaves updated_at alone (migration
 * 20261123_product_photo_edge). Nothing is revalidated either: no page has to
 * be drawn again for it, and the caller lays the answer on what it shows.
 *
 * RATE LIMITED like every other owner write (rl_take), on a budget of its own
 * (productPhotoEdge), so a stuck loop is bounded and measuring a catalogue
 * never spends the seller's product edits.
 */

const recordPhotoEdgeSchema = z.strictObject({
  productId: productIdSchema,
  /** The storage key of the photo that was measured: compared, never stored
   *  or used to reach a file. The same bound as a product's own key. */
  photoKey: z.string().min(1).max(600),
  edge: z.enum(PHOTO_EDGES),
});

export type RecordPhotoEdgeInput = z.input<typeof recordPhotoEdgeSchema>;

/** `edge` is what the product now holds for THAT photo: the answer, or null
 *  when the photo is no longer the product's (replaced or removed meanwhile). */
export type RecordPhotoEdgeResult = { ok: true; edge: PhotoEdge | null } | ActionFailure;

export async function recordPhotoEdge(input: RecordPhotoEdgeInput): Promise<RecordPhotoEdgeResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "editProducts"));
  }
  if (!(await rateLimit("product_photo_edge", RATE_LIMITS.productPhotoEdge))) {
    return failure(rateLimited("editProducts"));
  }

  const parsed = recordPhotoEdgeSchema.safeParse(input);
  if (!parsed.success) {
    return failure(invalidInput(msg("Errors.products.invalid.message"), msg("Errors.products.invalid.fix")));
  }
  const { productId, photoKey, edge } = parsed.data;

  const supabase = await createClient();
  // Only a photo with no answer yet is written: measuring is deterministic, so
  // an answer already stored for this photo stays, and a repeated write never
  // touches the row (no filter is built from text: search-input-hardening).
  const { data: written, error } = await supabase
    .from("products")
    .update({ photo_edge: edge })
    .eq("id", productId)
    .eq("owner_id", account.accountId)
    .eq("image_key", photoKey)
    .is("photo_edge", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[products] recordPhotoEdge failed", error.message);
    return failure(serverError("saveProduct"));
  }
  if (written) return { ok: true, edge };

  // Nothing was written: the answer was there already, the photo is no longer
  // the product's, or the product is not this store's. Say which.
  const { data: row, error: readError } = await supabase
    .from("products")
    .select("image_key, photo_edge")
    .eq("id", productId)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (readError) {
    console.error("[products] recordPhotoEdge read failed", readError.message);
    return failure(serverError("saveProduct"));
  }
  if (!row) return failure(notFound("product"));
  return { ok: true, edge: row.image_key === photoKey ? (readPhotoEdge(row) ?? null) : null };
}
