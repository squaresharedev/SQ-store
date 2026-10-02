// SERVER ONLY. A buyer's order page: the thank-you straight after paying, and
// the status page it stays afterwards (from the confirmation email). Reached
// only through the order's credential (lib/orders/order-link.ts), and built
// field by field so nothing a buyer's link can show is a key, an owner id, a
// seller's private data or a full delivery address.
//
// DELIBERATELY NOT the product page's gate. An order is a contract that
// already exists: a product since hidden, a seller since paused or a page
// since switched off must not take the buyer's receipt, download or right to
// withdraw with it. What IS required is the credential, the rate limit, and
// the order belonging to the storefront in the URL.

import { cache } from "react";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { presignGetUrl } from "@/lib/r2";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { resolveCheckoutPage } from "@/lib/storefront/checkout-page";
import { findShippingProfile } from "@/lib/storefront/shipping";
import { isContentVisible } from "@/lib/moderation/removal";
import { getSellerIdentity } from "@/lib/settings/seller-identity";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import { orderNumber, verifyOrderRef } from "@/lib/orders/order-link";
import { parseShipTo } from "@/lib/orders/ship-to";
import { parseOrderSelection } from "@/lib/orders/selection";
import { parseFulfilment } from "@/lib/orders/fulfilment";
import { trackingLinkFor } from "@/lib/orders/carriers";
import { buyerWithdrawal } from "@/lib/orders/withdrawal";
import { parseGallery, parseOptionGroups } from "@/lib/products/detail";
import type { OrderPageData } from "@/types/checkout";

const idSchema = uuidField();

/** The order columns an order page reads. Named, so a new column is never
 *  shown to a buyer by accident. */
const ORDER_PAGE_SELECT =
  "id, storefront_id, seller_id, product_id, product_title, quantity, selected_options, amount_cents, currency, status, buyer_email, ship_to, fulfilment_status, shipped_at, tracking_number, tracking_carrier, created_at, withdrawal_requested_at, supply_consent_at, digital_file_key" as const;

export type OrderRow = {
  id: string;
  storefront_id: string | null;
  seller_id: string;
  product_id: string | null;
  product_title: string;
  quantity: number;
  selected_options: unknown;
  amount_cents: number;
  currency: string;
  status: string;
  buyer_email: string | null;
  ship_to: unknown;
  fulfilment_status: string;
  shipped_at: string | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  created_at: string;
  withdrawal_requested_at: string | null;
  supply_consent_at: string | null;
  digital_file_key: string | null;
};

/** "aoife.byrne@example.test" → "a***@example.test". */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return `${email[0]}***${email.slice(at)}`;
}

/** "PDF", "ZIP"... from a key's extension. Never the name, never the key. */
function formatFromKey(key: string | null): string | null {
  const extension = key?.split("/").pop()?.split(".").pop() ?? "";
  return /^[A-Za-z0-9]{1,5}$/.test(extension) && key?.includes(".") ? extension.toUpperCase() : null;
}

/**
 * Prove an order ref and read its row, or null. Shared by the order page and
 * the routes that act on an order (download, withdraw), so all three accept
 * exactly the same credential. The caller has already spent its own
 * rate-limit token.
 */
export async function readOrderByRef(ref: string): Promise<OrderRow | null> {
  const orderId = await verifyOrderRef(ref);
  if (!orderId) return null;
  const { data, error } = await createAdminClient()
    .from("orders")
    .select(ORDER_PAGE_SELECT)
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error("[order-page] order read failed", error);
    return null;
  }
  return (data as OrderRow | null) ?? null;
}

export const getOrderPage = cache(
  async (storefrontId: string, ref: string): Promise<OrderPageData | null> => {
    if (!idSchema.safeParse(storefrontId).success) return null;
    const key = await clientKey(await headers());
    if (!(await rateLimitKey(key, "order_page", RATE_LIMITS.orderPage))) return null;

    const order = await readOrderByRef(ref);
    if (!order || order.storefront_id !== storefrontId) return null;

    const admin = createAdminClient();
    const [{ data: storefront }, seller, shippingPolicy, { data: product }] = await Promise.all([
      admin.from("storefronts").select("id, name, config").eq("id", storefrontId).maybeSingle(),
      getSellerIdentity(order.seller_id),
      getShippingPolicy(order.seller_id),
      order.product_id
        ? admin
            .from("products")
            .select("image_key, gallery, option_groups, shipping_profile_id, moderation_status")
            .eq("id", order.product_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!storefront) return null;
    const config = parseStoredStorefrontConfig(storefront.config);
    if (!config) return null;

    // The photo of the version bought, when the product is still there: the
    // version's own photo, else the cover. A missing product just means no
    // photo; the order still reads in full from its own snapshot.
    const selection = parseOrderSelection(order.selected_options);
    let photo: OrderPageData["order"]["photo"] = null;
    // A product moderation has taken down loses its picture here too: the
    // order (and the buyer's receipt) stands, but the page must not keep
    // showing content that was removed.
    if (product && isContentVisible(product.moderation_status)) {
      const groups = parseOptionGroups(product.option_groups);
      const chosen = new Set(
        groups.flatMap((group) =>
          group.options
            .filter((option) => selection.some((row) => row.label === group.name && row.value === option.name))
            .map((option) => option.id),
        ),
      );
      const own = parseGallery(product.gallery).find((image) => image.optionId && chosen.has(image.optionId));
      const photoKey = own?.key ?? product.image_key;
      const url = photoKey ? await presignGetUrl(photoKey) : null;
      if (url) photo = { url, alt: order.product_title };
    }

    const theme = config.theme;
    const backgroundImageUrl =
      theme.background.kind === "image" ? await presignGetUrl(theme.background.key) : null;
    const customFontUrl = theme.customFont ? await presignGetUrl(theme.customFont.key) : null;
    const checkoutPage = resolveCheckoutPage(config);
    const pagePhotoUrl = checkoutPage.backgroundImage
      ? await presignGetUrl(checkoutPage.backgroundImage.key)
      : null;

    const shipTo = parseShipTo(order.ship_to);
    const fulfilment = parseFulfilment(order);
    const isDigital = order.fulfilment_status === "not_required";
    const dispatch = isDigital
      ? null
      : (findShippingProfile(shippingPolicy.profiles, product?.shipping_profile_id)?.dispatch ??
          shippingPolicy.dispatch ??
          null);

    return {
      storefront: {
        id: storefront.id,
        name: storefront.name,
        theme,
        ...(config.header ? { header: config.header } : {}),
        productPage: resolveProductPage(config),
        checkoutPage,
        shippingPolicy,
        seller,
        backgroundImageUrl,
        customFontUrl,
        pagePhotoUrl,
      },
      order: {
        ref,
        number: orderNumber(order.id),
        placedAt: order.created_at,
        productId: order.product_id,
        productTitle: order.product_title,
        photo,
        quantity: order.quantity,
        selection,
        amountCents: order.amount_cents,
        currency: order.currency,
        maskedEmail: maskEmail(order.buyer_email),
        firstName: shipTo?.name.split(/\s+/)[0] || null,
        destination: shipTo ? { city: shipTo.city, country: shipTo.country } : null,
        isDigital,
        digitalFormat: isDigital ? formatFromKey(order.digital_file_key) : null,
        fulfilment: fulfilment.status,
        shippedAt: fulfilment.shippedAt,
        trackingNumber: fulfilment.trackingNumber,
        // Built here, where the full address is, so the page gets a finished
        // link and still never holds more of the address than town and country.
        trackingLink: trackingLinkFor(fulfilment, shipTo),
        dispatch: dispatch || null,
        withdrawal: buyerWithdrawal(order, shippingPolicy),
      },
    };
  },
);
