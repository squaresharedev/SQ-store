// SERVER ONLY. A cart's checkout page: the checkout a buyer reaches from their
// cart (/s/[storefrontId]/checkout?cart=<id>). The same page as "Buy now"'s,
// behind the same gate, with the cart's lines in place of one product.
//
// It exists only for a cart that can be paid as it stands. A cart with any
// line the quote would refuse (sold out, no longer sold, a version gone, too
// many), an empty one or one already paid sends the buyer back to the cart,
// where each line says what is wrong: the checkout never quietly drops a line
// the buyer saw.

import { cache } from "react";
import { headers } from "next/headers";
import { presignGetUrl } from "@/lib/r2";
import { signPagePhoto } from "@/lib/storefront/uploads";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { gatePurchasableLines } from "@/lib/products/purchasable";
import { PAGE_BUSY, type PageBusy } from "@/lib/public/busy";
import { buildProductPageProduct, gatePricing } from "@/lib/products/public";
import { checkoutProviderFor } from "@/lib/checkout/availability";
import { resolveCheckoutPage } from "@/lib/storefront/checkout-page";
import { assessLines, priceAssessedLines, type AssessedLine } from "@/lib/checkout/quote";
import { selectionChips, strictSelection } from "@/lib/checkout/selection";
import { parseOptionGroups } from "@/lib/products/detail";
import { cartLaunched } from "@/lib/cart/availability";
import { readCart } from "@/lib/cart/store";
import { linePhoto } from "@/lib/cart/photo";
import { fileFormatFromKey } from "@/lib/products/file-format";
import { createAdminClient } from "@/lib/supabase/admin";
import { cartPagePath } from "@/lib/storefront/product-page-url";
import { uuidField } from "@/lib/validation/inputs";
import type { CheckoutCartLine, CheckoutPageData } from "@/types/checkout";

export type CartCheckoutResult =
  | { kind: "page"; page: CheckoutPageData; ownerId: string }
  /** Not payable as it stands: back to the cart. */
  | { kind: "toCart" };

const RATE_ACTION = "checkout_page";
const idSchema = uuidField();

export const getCartCheckoutPage = cache(
  async (storefrontId: string, cartId: string): Promise<CartCheckoutResult | PageBusy | null> => {
    if (!idSchema.safeParse(storefrontId).success || !idSchema.safeParse(cartId).success) return null;
    if (!cartLaunched()) return null;
    // Spent before the first read, as every buyer page does.
    if (!(await rateLimitKey(await clientKey(await headers()), RATE_ACTION, RATE_LIMITS.checkoutPage))) {
      return PAGE_BUSY;
    }
    const cart = await readCart(createAdminClient(), cartId, storefrontId);
    if (cart === "error") return PAGE_BUSY;
    if (!cart || cart.closed || cart.lines.length === 0) return { kind: "toCart" };

    const gate = await gatePurchasableLines(
      storefrontId,
      cart.lines.map((line) => line.productId),
      { spentBy: RATE_ACTION },
    );
    if (gate === PAGE_BUSY) return PAGE_BUSY;
    if (!gate) return null;
    const { store } = gate;
    if (!(await checkoutProviderFor(store.ownerId))) return null;

    const assessed = assessLines(
      gate,
      cart.lines.map((line) => ({
        productId: line.productId,
        optionIds: line.optionIds,
        quantity: line.quantity,
        source: line.source,
      })),
    );
    if (assessed.some((line) => !line.ok)) return { kind: "toCart" };
    const sellable = assessed as Extract<AssessedLine, { ok: true }>[];
    const priced = priceAssessedLines(sellable, null);

    // The first line is the page's product: the same builder as the product
    // page, so it is described the same way.
    const first = sellable[0]!;
    const product = await buildProductPageProduct(first.item.row, {
      soldOutFlag: first.item.block?.soldOut,
      showStock: store.productPage.showStock,
      pricing: await gatePricing({ ...store, ...first.item }),
    });

    const lines: CheckoutCartLine[] = await Promise.all(
      sellable.map(async (line, index) => {
        const at = priced.lines[index]!;
        const groups = parseOptionGroups(line.item.row.option_groups);
        const optionIds = cart.lines[index]!.optionIds;
        const selection = strictSelection(groups, optionIds) ?? {};
        return {
          productId: line.productId,
          optionIds,
          quantity: line.quantity,
          source: line.source,
          regularUnitCents: line.item.row.price_cents,
          saleUnitCents: at.unitPriceCents < line.item.row.price_cents ? at.unitPriceCents : null,
          isDigital: line.isDigital,
          digitalFormat: fileFormatFromKey(line.item.row.digital_file_key),
          shippingProfileId: line.item.row.shipping_profile_id,
          title: line.item.row.title,
          photo: await linePhoto(line.item, optionIds),
          chips: selectionChips(groups, selection),
          unitCents: at.unitPriceCents,
        };
      }),
    );

    const { config, productPage } = store;
    const theme = config.theme;
    const checkoutPage = resolveCheckoutPage(config);
    const [backgroundImageUrl, customFontUrl, pagePhoto] = await Promise.all([
      theme.background.kind === "image" ? presignGetUrl(theme.background.key) : Promise.resolve(null),
      theme.customFont ? presignGetUrl(theme.customFont.key) : Promise.resolve(null),
      signPagePhoto(checkoutPage.backgroundImage),
    ]);

    return {
      kind: "page",
      ownerId: store.ownerId,
      page: {
        storefront: {
          id: store.storefront.id,
          name: store.storefront.name,
          theme,
          ...(config.header ? { header: config.header } : {}),
          productPage,
          checkoutPage,
          shippingPolicy: store.shippingPolicy,
          seller: store.seller,
          backgroundImageUrl,
          customFontUrl,
          pagePhoto,
          checkout: true,
        },
        product,
        cart: { id: cart.id, lines, editHref: cartPagePath(storefrontId) },
      },
    };
  },
);
