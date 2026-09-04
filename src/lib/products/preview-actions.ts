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
import type { ProductPageProduct } from "@/types/product";

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
 */
export type ProductPagePreviewResult =
  | { ok: true; product: ProductPageProduct }
  | { ok: false; error: ActionError };

export async function getProductPagePreviewData(
  productId: string,
  /** The tile's manual sold-out flag on the storefront being edited. */
  soldOutFlag = false,
): Promise<ProductPagePreviewResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "store.read")) {
    return failure(permissionDenied(account.role, "preview product pages"));
  }
  if (!productIdSchema.safeParse(productId).success) {
    return failure(notFound("product"));
  }
  if (!(await rateLimit("product_preview", RATE_LIMITS.productPreview))) {
    return failure(rateLimited("preview product pages"));
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
    return failure(serverError("load the product page preview"));
  }
  if (!data) return failure(notFound("product"));

  return {
    ok: true,
    product: await buildProductPageProduct(data as PublicProductRow, {
      soldOutFlag: soldOutFlag === true,
    }),
  };
}
