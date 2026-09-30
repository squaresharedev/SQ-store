import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { checkoutViewDedupeKey, recordSignal, visitorHash } from "@/lib/analytics/record";
import { checkoutProviderFor } from "@/lib/checkout/availability";
import { getCheckoutPage } from "@/lib/checkout/page";
import { strictSelection } from "@/lib/checkout/selection";
import { QUANTITY_QUERY_PARAM, requestedQuantity } from "@/lib/products/quantity";
import { clientKey } from "@/lib/rate-limit";
import {
  OPTION_QUERY_PARAM,
  firstValue,
  productPagePath,
  requestedOptions,
  type SearchParams,
} from "@/lib/storefront/product-page-url";
import { collectOptionIds } from "@/lib/validation/product";

/**
 * /s/[storefrontId]/p/[productId]/checkout: the hosted checkout a product
 * page's button leads to.
 *
 * Everything that decides whether this page exists lives in getCheckoutPage
 * (lib/checkout/page.ts): the product page's own gate, plus whether a payment
 * can actually be taken for this product. This file turns its `null` into the
 * same not-found as a missing product page and its result into markup.
 *
 * `?o=` and `?q=` carry the version and quantity from the product page, read
 * exactly as the product page reads them. An ORDER needs more than a page
 * does, though: exactly one available option in every group. A link that
 * does not say that (a hand-edited one, or a version that sold out in the
 * minute between the two pages) goes back to the product page to choose,
 * rather than checking out a version nobody picked.
 *
 * Never indexed (the public group's layout says so) and never cached: every
 * render mints its own attempt id, and prices and stock are read live.
 */

type Params = { storefrontId: string; productId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { storefrontId, productId } = await params;
  const result = await getCheckoutPage(storefrontId, productId);
  if (!result) return { robots: { index: false, follow: false } };
  const { storefront } = result.page;
  const t = await getTranslations("ProductPage.checkout.metadata");
  const store = storefront.seller.businessName || storefront.name;
  return {
    title: { absolute: t("title", { store }) },
    robots: { index: false, follow: false },
  };
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ storefrontId, productId }, query] = await Promise.all([params, searchParams]);
  const result = await getCheckoutPage(storefrontId, productId);
  if (!result) notFound();
  const { page, ownerId } = result;
  const { product } = page;

  // Back to the product page, carrying whatever the link did say, when this
  // checkout cannot be for a specific, available version (or cannot be at all
  // because it has sold out: the product page says so better than a form).
  const optionIds = requestedOptions(query, collectOptionIds(product.optionGroups));
  if (product.soldOut || !strictSelection(product.optionGroups, optionIds)) {
    const back = new URLSearchParams();
    const o = firstValue(query[OPTION_QUERY_PARAM]);
    if (o) back.set(OPTION_QUERY_PARAM, o);
    redirect(`${productPagePath(storefrontId, productId)}${back.size > 0 ? `?${back}` : ""}`);
  }

  const requestHeaders = await headers();
  const ip = await clientKey(requestHeaders);
  const userAgent = requestHeaders.get("user-agent");
  // Cloudflare's own reading of where the request came from, to start the
  // delivery picker on the buyer's country when the seller ships there. A
  // default only: the buyer changes it with one tap, and nothing is decided by
  // it.
  const country = requestHeaders.get("cf-ipcountry");

  after(async () => {
    const hash = await visitorHash(ownerId, [ip, userAgent]);
    await recordSignal({
      accountId: ownerId,
      kind: "checkout_view",
      storefrontId: page.storefront.id,
      channel: "direct",
      blockId: `p_${product.id}`,
      visitorHash: hash,
      dedupeKey: await checkoutViewDedupeKey(product.id, hash),
    });
  });

  return (
    <main>
      <CheckoutView
        page={page}
        mode="public"
        optionIds={optionIds}
        initialQuantity={requestedQuantity(query[QUANTITY_QUERY_PARAM], product.maxQuantity)}
        // One per render: the order route derives the payment's idempotency
        // key from it, so a double click (or a retried request) records one
        // order, not two.
        attemptId={crypto.randomUUID()}
        provider={checkoutProviderFor(ownerId)}
        initialCountry={country}
      />
    </main>
  );
}
