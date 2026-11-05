"use server";

import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  failure,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionError,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { productIdSchema } from "@/lib/validation/product";
import {
  PUBLIC_PRODUCT_SELECT,
  buildProductPageProduct,
  type PublicProductRow,
} from "@/lib/products/public";
import { loadPreviewPricing } from "@/lib/discounts/storefront-preview";
import { toCurrency } from "@/lib/format/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAddOnCards } from "@/lib/products/add-ons";
import { listHiddenAddOns } from "@/lib/products/add-on-choices";
import { parseAddOnIds } from "@/lib/products/detail";
import type { AddOnCard, HiddenAddOn, ProductPageProduct } from "@/types/product";

/**
 * What the editor's product-page preview needs for ONE product: the same
 * buyer-safe shape the public route serves, built by the same function, so the
 * preview can never show a seller something a buyer would not see (or hide
 * something they would).
 *
 * Loaded on demand for the product being previewed rather than for the whole
 * catalogue at editor load: a gallery is a presign per photo, and the seller
 * looks at one page at a time. Owner-scoped through the active account, so a
 * team member previews the store they are editing; RLS re-checks at the DB.
 * Drafts preview fine here (the public route is what refuses them).
 *
 * PRICED AS A BUYER SEES IT: a running sale sets the price here exactly as it
 * does on the public page (lib/discounts/storefront-preview.ts), so the page a
 * seller previews and the tile beside it on the canvas say the same number.
 *
 * Beside the add-ons a buyer is offered come the ones they are not (`hidden`),
 * which only the seller's preview draws, faded with the reason.
 */
export type ProductPagePreviewResult =
  | { ok: true; product: ProductPageProduct; addOns: AddOnCard[]; hidden: HiddenAddOn[] }
  | { ok: false; error: ActionError };

export async function getProductPagePreviewData(
  productId: string,
  /** The tile's manual sold-out flag on the storefront being edited. */
  soldOutFlag = false,
  /** The storefront's productPage.showStock, so the preview's quantity ceiling
   *  discloses exactly what a buyer's would — see publicQuantityLimit. */
  showStock = false,
): Promise<ProductPagePreviewResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "store.read")) {
    return failure(permissionDenied(account.role, "previewProductPages"));
  }
  if (!productIdSchema.safeParse(productId).success) {
    return failure(notFound("product"));
  }
  if (!(await rateLimit("product_preview", RATE_LIMITS.productPreview))) {
    return failure(rateLimited("previewProductPages"));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT)
    .eq("id", productId)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (error) {
    console.error("[products] preview read failed", error);
    return failure(serverError("loadProductPagePreview"));
  }
  if (!data) return failure(notFound("product"));

  const row = data as PublicProductRow;
  const pricing = await loadPreviewPricing(account.accountId, [
    {
      id: row.id,
      price: row.price_cents / 100,
      currency: toCurrency(row.currency),
      listedAt: row.created_at ?? null,
    },
  ]);

  const product = await buildProductPageProduct(row, {
    soldOutFlag: soldOutFlag === true,
    showStock: showStock === true,
    pricing: pricing.get(row.id),
  });
  // Exactly the add-ons a buyer would be offered (active, same kind, same
  // currency, in stock), read with the service role but only ever for the
  // active account's own products. A preview whose sales cannot be read shows
  // the regular prices, like the rest of the designer.
  const host = { isDigital: product.isDigital, currency: product.currency };
  const addOns = await loadAddOnCards(createAdminClient(), {
    ownerId: account.accountId,
    ids: row.add_on_ids,
    ...host,
    now: new Date(),
    unreadableSales: "regular",
    withRatings: true,
  });
  const hidden = await listHiddenAddOns(
    parseAddOnIds(row.add_on_ids),
    addOns.map((card) => card.id),
    host,
  );

  return { ok: true, product, addOns, hidden };
}
