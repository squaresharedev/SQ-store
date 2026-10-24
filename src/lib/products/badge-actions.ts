"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
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
import { msg } from "@/i18n/types";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/supabase";
import {
  badgeLabelKey,
  badgeLabelSchema,
  badgesSchema,
  productIdSchema,
} from "@/lib/validation/product";
import { badgeRefusal } from "@/lib/products/badge-moderation";
import { parseDetails } from "@/lib/products/detail";
import { withBadgePlacement } from "@/lib/products/badges";
import { precheck, settleAfterWrite } from "@/lib/moderation/auto/check";
import { BADGE_PLACEMENTS, BADGES_ON_PHOTO_MAX, type ProductBadge } from "@/types/product";

/**
 * Judge the words of a badge the seller just wrote, before the form adds it.
 *
 * "Don't let anyone make an inappropriate badge" starts here: a refused badge
 * never joins the form, so it is never part of a save. It is a courtesy check,
 * not the gate: the save judges every badge again (cached, so this answer is
 * what it finds), and the database wall holds anything written around both.
 *
 * `{ ok: true }` also when no answer could be obtained, because refusing to
 * add a badge over a classifier outage helps nobody; the save will ask again.
 */
export async function checkBadgeLabel(label: unknown): Promise<{ ok: true } | ActionFailure> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "editProducts"));
  }
  if (!(await rateLimit("badge_check", RATE_LIMITS.badgeCheck))) {
    return failure(rateLimited("editProducts"));
  }
  const parsed = badgeLabelSchema.safeParse(label);
  if (!parsed.success) {
    return failure(
      invalidInput(msg("Errors.products.invalid.message"), msg("Errors.products.invalid.fix")),
    );
  }
  const refused = await badgeRefusal([parsed.data]);
  return refused ? failure(refused) : { ok: true };
}

/**
 * Move one badge to another place on its product's page: the storefront
 * editor's drag, on the product page artboard. Only the badge's placement
 * changes; its words, its icon and every other fact on the product stay as
 * stored, so this never needs the whole product form.
 *
 * The badge is named by its words (unique per product, see badgesSchema), not
 * by its position, so a list edited elsewhere in the meantime cannot move the
 * wrong one. Answers with the product's badges as stored after the move.
 */
export async function moveProductBadge(
  productId: unknown,
  label: unknown,
  placement: unknown,
): Promise<{ ok: true; badges: ProductBadge[] } | ActionFailure> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "editProducts"));
  }
  if (!(await rateLimit("product_write", RATE_LIMITS.productWrite))) {
    return failure(rateLimited("editProducts"));
  }
  const id = productIdSchema.safeParse(productId);
  if (!id.success) return failure(notFound("product"));
  const words = badgeLabelSchema.safeParse(label);
  const where = z.enum(BADGE_PLACEMENTS).safeParse(placement);
  if (!words.success || !where.success) {
    return failure(
      invalidInput(msg("Errors.products.invalid.message"), msg("Errors.products.invalid.fix")),
    );
  }

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("products")
    .select("details")
    .eq("id", id.data)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (error) {
    console.error("[products] badge move read failed", error);
    return failure(serverError("saveProduct"));
  }
  if (!row) return failure(notFound("product"));

  const stored = parseDetails(row.details).badges ?? [];
  const key = badgeLabelKey(words.data);
  if (!stored.some((badge) => badgeLabelKey(badge.label) === key)) {
    return failure(notFound("product"));
  }
  const moved = withBadgePlacement(stored, words.data, where.data);
  if (!badgesSchema.safeParse(moved).success) {
    return failure(
      invalidInput(msg("Validation.product.badgesOnPhotoTooMany", { maximum: BADGES_ON_PHOTO_MAX })),
    );
  }

  // Everything else in the stored details is written back exactly as it was.
  const raw =
    row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : {};
  const update = { details: { ...raw, badges: moved } as unknown as Json };
  await precheck("product", id.data, update);
  const { data: written, error: writeError } = await supabase
    .from("products")
    .update(update)
    .eq("id", id.data)
    .eq("owner_id", account.accountId)
    .select("id, moderation_status")
    .maybeSingle();
  if (writeError) {
    console.error("[products] badge move failed", writeError);
    return failure(serverError("saveProduct"));
  }
  if (!written) return failure(notFound("product"));
  await settleAfterWrite("product", written.id, written.moderation_status);
  revalidatePath("/products");
  return { ok: true, badges: moved };
}
