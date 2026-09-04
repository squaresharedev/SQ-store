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
import { getPublicProductPage } from "@/lib/products/public";
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
  const description = summary(product.description, `${product.title} from ${storefront.name}.`);
  const hero = product.images[0]?.url;
  return {
    title: { absolute: `${product.title} | ${storefront.name}` },
    description,
    robots: { index: allow, follow: allow },
    ...(allow ? { alternates: { canonical: page.productUrl } } : {}),
    openGraph: {
      type: "website",
      title: product.title,
      description,
      siteName: storefront.name,
      url: page.productUrl,
      // The signed hero URL is good for at least an hour at share time, which
      // is when the card scraper fetches it.
      ...(hero ? { images: [{ url: hero, alt: product.images[0]?.alt ?? product.title }] } : {}),
    },
    twitter: {
      card: hero ? "summary_large_image" : "summary",
      title: product.title,
      description,
      ...(hero ? { images: [hero] } : {}),
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

  return (
    <main>
      <ProductPageView
        page={page}
        mode="public"
        initialOptionIds={requestedOptions(query, collectOptionIds(page.product.optionGroups))}
      />
    </main>
  );
}
