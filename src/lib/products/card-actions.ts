"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
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
import { publishBlockedError } from "@/lib/settings/seller-identity";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { PRODUCT_TITLE_MAX, productIdSchema } from "@/lib/validation/product";
import { msg } from "@/i18n/types";
import { precheck, settleAfterWrite } from "@/lib/moderation/auto/check";
import { planLimitError, planLimitErrorFromTrigger, planLimitKeyOf } from "@/lib/billing/limits";
import type { TablesInsert } from "@/types";
import { PRODUCT_STATUSES, type ProductStatus } from "@/types/product";
import { PRODUCTS_PATH } from "./paths";

/** Shared result shape for quick card-level product writes. */
export type CardActionResult = { ok: true } | ActionFailure;
export type DuplicateActionResult =
  | { ok: true; id: string }
  | ActionFailure;

/** Product status values the card toggle accepts. */
const statusSchema = z.enum(PRODUCT_STATUSES);

/**
 * Quick status toggle for the product card menu (Make active / Make draft).
 *
 * Active is the publish gate: blocked without trader identity. Draft is always
 * allowed. Session, role, and owner checks mirror updateProduct.
 */
export async function setProductStatus(
  productId: string,
  status: ProductStatus,
): Promise<CardActionResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "editProducts"));
  }
  if (!(await rateLimit("product_write", RATE_LIMITS.productWrite))) {
    return failure(rateLimited("editProducts"));
  }

  if (!productIdSchema.safeParse(productId).success) {
    return failure(notFound("product"));
  }
  if (!statusSchema.safeParse(status).success) {
    return failure(invalidInput(msg("Errors.products.invalid.message"), msg("Errors.products.invalid.fix")));
  }

  // Active is the publish status: trader details must be on file.
  if (status === "active") {
    const blocked = await publishBlockedError(account.accountId);
    if (blocked) return failure(blocked);
  }

  const supabase = await createClient();

  // Precheck runs before the write so the moderation wall sees the updated status.
  await precheck("product", productId, { status });

  const { data: row, error } = await supabase
    .from("products")
    .update({ status })
    .eq("id", productId)
    .eq("owner_id", account.accountId)
    .select("id, moderation_status")
    .maybeSingle();

  if (error) {
    console.error("[products] setProductStatus failed", error);
    return failure(serverError("saveProduct"));
  }
  if (!row) return failure(notFound("product"));

  await settleAfterWrite("product", row.id, row.moderation_status);
  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

/**
 * Duplicate a product as a draft, so nothing publishes unintentionally. Copies
 * its words, price, stock, options, details, buy link and shipping profile.
 * Photos, the file and documents are not copied: a stored object belongs to
 * one product, and deleting either would take it from the other. Add-ons start
 * empty. The same plan limit and moderation path as createProduct.
 */
export async function duplicateProduct(
  productId: string,
): Promise<DuplicateActionResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "createProducts"));
  }
  if (!(await rateLimit("product_write", RATE_LIMITS.productWrite))) {
    return failure(rateLimited("createProducts"));
  }

  if (!productIdSchema.safeParse(productId).success) {
    return failure(notFound("product"));
  }

  const overLimit = await planLimitError(account.accountId, "products", account.userId);
  if (overLimit) return failure(overLimit);

  const supabase = await createClient();
  const { data: source, error: readError } = await supabase
    .from("products")
    .select(
      "title, description, price_cents, currency, track_stock, stock_quantity, low_stock_threshold, max_per_order, option_groups, details, purchase_url, shipping_profile_id",
    )
    .eq("id", productId)
    .eq("owner_id", account.accountId)
    .maybeSingle();

  if (readError) {
    console.error("[products] duplicateProduct read failed", readError);
    return failure(serverError("createProduct"));
  }
  if (!source) return failure(notFound("product"));

  // "Copy of …" in the seller's language, kept inside what a save accepts.
  const t = await getTranslations("Products.list");
  const insert: TablesInsert<"products"> = {
    ...source,
    owner_id: account.accountId,
    title: t("duplicateTitle", { title: source.title }).slice(0, PRODUCT_TITLE_MAX),
    status: "draft",
  };

  await precheck("product", null, insert);

  const { data: row, error: insertError } = await supabase
    .from("products")
    .insert(insert)
    .select("id, moderation_status")
    .single();

  if (insertError || !row) {
    if (planLimitKeyOf(insertError)) {
      return failure(await planLimitErrorFromTrigger(account.accountId, "products"));
    }
    console.error("[products] duplicateProduct insert failed", insertError);
    return failure(serverError("createProduct"));
  }

  await settleAfterWrite("product", row.id, row.moderation_status);
  revalidatePath(PRODUCTS_PATH);
  return { ok: true, id: row.id };
}
