import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ProductPageView } from "@/components/product-page/ProductPageView";
import {
  productViewDedupeKey,
  recordSignal,
  visitorHash,
} from "@/lib/analytics/record";
import { getPublicProductPage, resolveDisplayName } from "@/lib/products/public";
import { clientKey } from "@/lib/rate-limit";
import {
  LEGACY_VARIANT_QUERY_PARAM,
  OPTION_QUERY_PARAM,
} from "@/lib/storefront/product-page-url";
import { uuidField } from "@/lib/validation/inputs";
import { collectOptionIds } from "@/lib/validation/product";
import { OPTIONS_TOTAL_MAX } from "@/types/product";

/**
 * /s/[storefrontId]/p/[productId]: the hosted product page a buyer lands on
 * from a product tile.
 *
 * Everything that decides whether this page exists lives in
 * getPublicProductPage (lib/products/public.ts): ids, rate limit, storefront,
 * placement, product status and ownership. This file only turns its `null`
 * into the segment's not-found and its result into markup. The loader is
 * React-cached, so generateMetadata and the body share one read.
 *
 * `?o=<id>,<id>` preselects one option per group, and the older single-colour
 * `?v=<id>` is still read so links shared before option groups existed keep
 * landing on the version they named. Every id is checked against the
 * product's OWN options and anything else is dropped, so the URL can never
 * name a version the product does not have.
 */

type Params = { storefrontId: string; productId: string };
type SearchParams = { [key: string]: string | string[] | undefined };

const optionIdSchema = uuidField("That option");

/** A repeated parameter arrives as an array; take the first, as one address
 *  bar can only mean one selection. */
function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * The option ids the URL asks for, filtered to ones this product actually has.
 * The split is capped before anything is examined: a product can never have
 * more than OPTIONS_TOTAL_MAX options, so a longer parameter is a scan, not a
 * selection, and there is no reason to walk it.
 */
function requestedOptions(searchParams: SearchParams, optionIds: ReadonlySet<string>): string[] {
  const raw = [
    ...(firstValue(searchParams[OPTION_QUERY_PARAM])?.split(",").slice(0, OPTIONS_TOTAL_MAX) ?? []),
    firstValue(searchParams[LEGACY_VARIANT_QUERY_PARAM]) ?? "",
  ];
  const wanted = new Set<string>();
  for (const value of raw) {
    const id = value.trim();
    if (!id || wanted.has(id) || !optionIds.has(id)) continue;
    if (!optionIdSchema.safeParse(id).success) continue;
    wanted.add(id);
  }
  return [...wanted];
}

/** Description for search and share cards: first 160 characters, one line. */
function summary(text: string, fallback: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return fallback;
  return flat.length > 160 ? `${flat.slice(0, 159).trimEnd()}…` : flat;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { storefrontId, productId } = await params;
  const result = await getPublicProductPage(storefrontId, productId);
  if (!result) return { robots: { index: false, follow: false } };
  const { page } = result;
  const { product, storefront } = page;
  const allow = storefront.productPage.allowIndexing;

  // BUY-05: the buyer-facing store name — business name beats the header's
  // display name, which in turn beats the internal row name. Matches what
  // SellerBlock prints on the page so the tab title and the on-page identity
  // agree on whose store this is.
  const displayName = resolveDisplayName(page);
  const description = summary(product.description, `${product.title} from ${displayName}.`);

  // BUY-01: the og:image points at a STABLE route that 302-redirects to a
  // freshly signed R2 URL on every scrape. The presigned URL the product row
  // carries expires in ~2 h, so it is fine for the page itself but breaks
  // every social card the moment the network re-scrapes it. The stable route
  // never expires; only the redirect destination does, and that is fetched
  // fresh each time.
  const hasImage = product.images.length > 0;
  const origin = new URL(page.productUrl).origin;
  const ogImageUrl = `${origin}/api/og/p/${product.id}`;

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
  if (!result) notFound();
  const { page, ownerId } = result;

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
      channel: "direct",
      blockId: `p_${page.product.id}`,
      visitorHash: hash,
      dedupeKey: await productViewDedupeKey(page.product.id, hash),
    });
  });

  // BUY-07: Product + Offer JSON-LD, emitted from the same data that fills the
  // meta tags above so the two can never disagree. Only claim availability and
  // price that the page itself is showing.
  //
  // WHY THE `<` IS PRE-ESCAPED. A script's text child is emitted raw, so a
  // seller who puts a closing script tag in a product title would otherwise
  // break out of the block. React does defend against that on the server (it
  // rewrites the sequence to unicode escapes), but it does NOT produce the same
  // text on the client, so the two disagree and React discards and re-renders
  // the whole tree on every product page load. Escaping `<` ourselves is the
  // fix for both at once: `<` is valid JSON, it cannot close the element,
  // and server and client now emit identical text.
  const displayName = resolveDisplayName(page);
  const origin = new URL(page.productUrl).origin;
  const ogImageUrl = `${origin}/api/og/p/${page.product.id}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: page.product.title,
    ...(page.product.description
      ? { description: page.product.description.replace(/\s+/g, " ").trim().slice(0, 500) }
      : {}),
    ...(page.product.images.length > 0 ? { image: ogImageUrl } : {}),
    offers: {
      "@type": "Offer",
      price: (page.product.priceCents / 100).toFixed(2),
      priceCurrency: page.product.currency,
      availability: page.product.soldOut
        ? "https://schema.org/OutOfStock"
        : page.product.stock?.state === "low_stock"
          ? "https://schema.org/LimitedAvailability"
          : "https://schema.org/InStock",
      url: page.productUrl,
      seller: {
        "@type": "Organization",
        name: displayName,
      },
    },
  };

  return (
    <>
      <script type="application/ld+json" id="product-jsonld">
        {JSON.stringify(jsonLd).replace(/</g, "\\u003c")}
      </script>
      <main>
        <ProductPageView
          page={page}
          mode="public"
          initialOptionIds={requestedOptions(query, collectOptionIds(page.product.optionGroups))}
        />
      </main>
    </>
  );
}
