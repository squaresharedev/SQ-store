import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { BuyerBusy } from "@/components/product-page/BuyerNotice";
import { PriceRefresh } from "@/components/product-page/PriceRefresh";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  productClickDedupeKey,
  productViewDedupeKey,
  recordSignal,
  visitorHash,
} from "@/lib/analytics/record";
import { getPublicProductPage, resolveDisplayName } from "@/lib/products/public";
import { getProductReviews } from "@/lib/reviews/queries";
import { PAGE_BUSY } from "@/lib/public/busy";
import { appUrl } from "@/lib/app-url";
import { clipText } from "@/lib/format/text";
import { productOgImagePath } from "@/lib/products/paths";
import { QUANTITY_QUERY_PARAM, requestedQuantity } from "@/lib/products/quantity";
import { clientKey } from "@/lib/rate-limit";
import { productStructuredData } from "@/lib/seo/structured-data";
import {
  requestedAddOns,
  requestedOptions,
  requestedVia,
  type SearchParams,
} from "@/lib/storefront/product-page-url";
import { collectOptionIds } from "@/lib/validation/product";

/**
 * /s/[storefrontId]/p/[productId]: the hosted product page a buyer lands on
 * from a product tile (or from an add-on's details on a tile's page).
 *
 * Everything that decides whether this page exists lives in
 * getPublicProductPage (lib/products/public.ts): ids, rate limit, storefront,
 * placement, product status and ownership. This file only turns its `null`
 * into the segment's not-found, its "not right now" into a try-again, and its
 * result into markup. The loader is
 * React-cached, so generateMetadata and the body share one read.
 *
 * `?o=<id>,<id>` preselects one option per group, and the older single-colour
 * `?v=<id>` is still read so links shared before option groups existed keep
 * landing on the version they named. Every id is checked against the
 * product's OWN options and anything else is dropped, so the URL can never
 * name a version the product does not have.
 *
 * `?q=<n>` preselects the quantity, under the same rule: it is measured against
 * the product's own per-order limit here, on the server, and anything outside
 * it falls back to one. That is a rule about what gets RENDERED — the number is
 * display state, and lib/products/order-quantity.ts is what a sale has to pass.
 *
 * `?via=button|embed` names how the buyer arrived (the seller's own buy button,
 * a storefront tile). The view is filed under that channel and the marker is
 * handed on to the checkout link; anything unknown reads as `direct`.
 */

type Params = { storefrontId: string; productId: string };

/** Description for search and share cards: first 160 characters, one line. */
function summary(text: string, fallback: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return fallback;
  return flat.length > 160 ? `${clipText(flat, 159).trimEnd()}…` : flat;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { storefrontId, productId } = await params;
  const result = await getPublicProductPage(storefrontId, productId);
  if (!result || result === PAGE_BUSY) return { robots: { index: false, follow: false } };
  const { page } = result;
  const { product, storefront } = page;
  const allow = storefront.productPage.allowIndexing;

  // BUY-05: the buyer-facing store name — business name beats the header's
  // display name, which in turn beats the internal row name. Matches what
  // SellerBlock prints on the page so the tab title and the on-page identity
  // agree on whose store this is.
  const displayName = resolveDisplayName(page);
  const t = await getTranslations("ProductPage.metadata");
  const description = summary(
    product.description,
    t("descriptionFallback", { title: product.title, store: displayName }),
  );

  // BUY-01: the og:image points at a STABLE route that 302-redirects to a
  // freshly signed R2 URL on every scrape. The presigned URL the product row
  // carries expires in ~2 h, so it is fine for the page itself but breaks
  // every social card the moment the network re-scrapes it. The stable route
  // never expires; only the redirect destination does, and that is fetched
  // fresh each time.
  const hasImage = product.images.length > 0;
  const ogImageUrl = appUrl(productOgImagePath(product.id));

  return {
    title: { absolute: `${product.title} | ${displayName}` },
    description,
    robots: { index: allow, follow: allow },
    ...(allow ? { alternates: { canonical: page.productUrl } } : {}),
    openGraph: {
      type: "website",
      title: product.title,
      description,
      siteName: displayName,
      url: page.productUrl,
      ...(hasImage
        ? { images: [{ url: ogImageUrl, alt: product.images[0]?.alt ?? product.title }] }
        : {}),
    },
    twitter: {
      card: hasImage ? "summary_large_image" : "summary",
      title: product.title,
      description,
      ...(hasImage ? { images: [ogImageUrl] } : {}),
    },
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ storefrontId, productId }, query] = await Promise.all([params, searchParams]);
  const result = await getPublicProductPage(storefrontId, productId);
  if (result === PAGE_BUSY) return <BuyerBusy />;
  if (!result) notFound();
  const { page, ownerId, saleEndsInMs } = result;
  const via = requestedVia(query);
  // Read after the gate above, never before it: a product the page refuses
  // has no reviews to show. Null (a failed read) just leaves the section out.
  const reviews = await getProductReviews(page.product.id);

  // A served page is a product view. Recorded after the response so a counter
  // can never slow a buyer down, deduped per visitor per product per hour, and
  // recordSignal cannot throw. Same privacy rules as the embed's view: the IP
  // and user agent are hashed with a server-only salt and never stored.
  const requestHeaders = await headers();
  const ip = await clientKey(requestHeaders);
  const userAgent = requestHeaders.get("user-agent");
  after(async () => {
    const hash = await visitorHash(ownerId, [ip, userAgent]);
    await recordSignal({
      accountId: ownerId,
      kind: "product_view",
      storefrontId: page.storefront.id,
      channel: via ?? "direct",
      blockId: `p_${page.product.id}`,
      visitorHash: hash,
      dedupeKey: await productViewDedupeKey(page.product.id, hash),
    });
    // A CLICK ON AN EMBED TILE, counted where it lands. The tile is a plain
    // link to this page carrying `via=embed`, so the request the buyer asked
    // for IS the click: nothing on the seller's site has to report it, which
    // is what lets the embed run there with no beacon, no cookie and nothing
    // kept on the visitor's device. Deduped like the view beside it. The
    // marker is attribution and anyone can type it, so read the figure as a
    // guide, like the channel split it belongs to.
    if (via === "embed") {
      await recordSignal({
        accountId: ownerId,
        kind: "product_click",
        storefrontId: page.storefront.id,
        channel: "embed",
        blockId: `p_${page.product.id}`,
        visitorHash: hash,
        dedupeKey: await productClickDedupeKey(page.product.id, hash),
      });
    }
  });

  const displayName = resolveDisplayName(page);

  return (
    <>
      <JsonLd id="product-jsonld" data={productStructuredData(page, displayName, reviews)} />
      <main>
        <ProductPageView
          page={page}
          mode="public"
          via={via}
          reviews={reviews}
          initialOptionIds={requestedOptions(query, collectOptionIds(page.product.optionGroups))}
          // `?q=` is read exactly the way `?o=` above is: whatever the address
          // bar says, measured against what THIS product allows, with anything
          // else falling back to one. The number that lands here has already
          // been through the product's own limit, so a hand-edited link opens
          // on a legal page rather than an error — and, since it decides only
          // what is drawn, a forged one buys nothing (see order-quantity.ts).
          initialQuantity={requestedQuantity(
            query[QUANTITY_QUERY_PARAM],
            page.product.maxQuantity,
          )}
          // `?a=`, limited to the add-ons actually on offer here.
          initialAddOns={requestedAddOns(
            query,
            (page.addOns ?? []).map((card) => card.id),
          )}
        />
      </main>
      {/* The sale price stops being true when the sale ends: read the page
          again then, rather than leave an open tab advertising it. */}
      {saleEndsInMs !== null && <PriceRefresh inMs={saleEndsInMs} />}
    </>
  );
}
