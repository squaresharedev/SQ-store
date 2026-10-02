// SERVER ONLY. The hosted checkout's read: everything the page renders, behind
// the product page's own gate (lib/products/purchasable.ts), plus one question
// the product page does not ask: can this product actually be paid for here
// (lib/checkout/availability.ts). Every "no" is the same `null`, which the
// route turns into the same 404 as a product page that does not exist.
//
// The product itself comes from buildProductPageProduct, the builder the
// product page uses, so the checkout cannot describe a product differently
// from the page the buyer just left.

import { cache } from "react";
import { presignGetUrl } from "@/lib/r2";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { loadPurchasable } from "@/lib/products/purchasable";
import { buildProductPageProduct } from "@/lib/products/public";
import { checkoutAvailableFor } from "@/lib/checkout/availability";
import { resolveCheckoutPage } from "@/lib/storefront/checkout-page";
import type { CheckoutPageData } from "@/types/checkout";

export type CheckoutPageResult = {
  page: CheckoutPageData;
  /** For the view signal only. Never placed on `page`. */
  ownerId: string;
};

export const getCheckoutPage = cache(
  async (storefrontId: string, productId: string): Promise<CheckoutPageResult | null> => {
    const gate = await loadPurchasable(storefrontId, productId, {
      action: "checkout_page",
      budget: RATE_LIMITS.checkoutPage,
    });
    if (!gate || !checkoutAvailableFor(gate)) return null;
    const { config, productPage, block, row, seller, shippingPolicy } = gate;

    const product = await buildProductPageProduct(row, {
      soldOutFlag: block.soldOut,
      showStock: productPage.showStock,
    });

    const theme = config.theme;
    const backgroundImageUrl =
      theme.background.kind === "image" ? await presignGetUrl(theme.background.key) : null;
    const customFontUrl = theme.customFont ? await presignGetUrl(theme.customFont.key) : null;
    const checkoutPage = resolveCheckoutPage(config);
    const pagePhotoUrl = checkoutPage.backgroundImage
      ? await presignGetUrl(checkoutPage.backgroundImage.key)
      : null;

    return {
      page: {
        storefront: {
          id: gate.storefront.id,
          name: gate.storefront.name,
          theme,
          ...(config.header ? { header: config.header } : {}),
          productPage,
          checkoutPage,
          shippingPolicy,
          seller,
          backgroundImageUrl,
          customFontUrl,
          pagePhotoUrl,
          checkout: true,
        },
        product,
      },
      ownerId: gate.ownerId,
    };
  },
);
