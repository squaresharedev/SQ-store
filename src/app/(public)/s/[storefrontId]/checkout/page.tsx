import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { checkoutViewDedupeKey, recordSignal, visitorHash } from "@/lib/analytics/record";
import { checkoutProviderFor } from "@/lib/checkout/availability";
import { getCartCheckoutPage } from "@/lib/checkout/cart-page";
import { PAGE_BUSY } from "@/lib/public/busy";
import { BuyerBusy } from "@/components/product-page/BuyerNotice";
import { clientKey } from "@/lib/rate-limit";
import {
  CART_QUERY_PARAM,
  cartPagePath,
  firstValue,
  requestedVia,
  type SearchParams,
} from "@/lib/storefront/product-page-url";

/**
 * /s/[storefrontId]/checkout?cart=<id>: a cart's checkout. The same page as
 * "Buy now"'s (components/checkout/CheckoutView), with the cart's lines.
 *
 * Everything that decides whether it exists lives in getCartCheckoutPage
 * (lib/checkout/cart-page.ts). A cart that cannot be paid as it stands (a
 * line sold out, gone, or changed; an empty or paid cart) goes back to the
 * cart, where each line says what is wrong.
 *
 * Never indexed, never cached (next.config.ts purchase headers): every render
 * mints its own attempt id, and prices and stock are read live.
 */

type Params = { storefrontId: string };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ProductPage.cart");
  return { title: { absolute: t("title") }, robots: { index: false, follow: false } };
}

export default async function CartCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ storefrontId }, query] = await Promise.all([params, searchParams]);
  const cartId = firstValue(query[CART_QUERY_PARAM])?.toLowerCase() ?? "";
  const result = await getCartCheckoutPage(storefrontId, cartId);
  if (result === PAGE_BUSY) return <BuyerBusy />;
  if (!result) notFound();
  if (result.kind === "toCart") redirect(cartPagePath(storefrontId));
  const { page, ownerId } = result;
  const via = requestedVia(query);

  const requestHeaders = await headers();
  const ip = await clientKey(requestHeaders);
  const userAgent = requestHeaders.get("user-agent");
  // Cloudflare's own reading of where the request came from: a default for
  // the delivery picker, decided nothing by.
  const country = requestHeaders.get("cf-ipcountry");

  after(async () => {
    const hash = await visitorHash(ownerId, [ip, userAgent]);
    await recordSignal({
      accountId: ownerId,
      kind: "checkout_view",
      storefrontId: page.storefront.id,
      channel: via ?? "direct",
      blockId: `p_${page.product.id}`,
      visitorHash: hash,
      dedupeKey: await checkoutViewDedupeKey(page.product.id, hash),
    });
  });

  return (
    <main>
      <CheckoutView
        page={page}
        mode="public"
        // One per render: the order route derives the payment's idempotency
        // key from it, so a double click (or a retried request) records one
        // order, not two.
        attemptId={crypto.randomUUID()}
        provider={await checkoutProviderFor(ownerId)}
        initialCountry={country}
        via={via}
      />
    </main>
  );
}
