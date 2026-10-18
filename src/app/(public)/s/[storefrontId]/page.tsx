import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { BuyerBusy } from "@/components/product-page/BuyerNotice";
import { PriceRefresh } from "@/components/product-page/PriceRefresh";
import { StorefrontPageView } from "@/components/storefront-page/StorefrontPageView";
import { recordSignal, viewDedupeKey, visitorHash } from "@/lib/analytics/record";
import { PAGE_BUSY } from "@/lib/public/busy";
import { clientKey } from "@/lib/rate-limit";
import { storefrontDisplayName } from "@/lib/storefront/display-name";
import { getPublicStorefrontPage } from "@/lib/storefront/storefront-page";

/**
 * /s/[storefrontId]: a storefront's own hosted page. The whole board a seller
 * designed, for a seller with no website to embed it in, and the page every
 * product page of theirs belongs to.
 *
 * Everything that decides whether this page exists lives in
 * getPublicStorefrontPage (lib/storefront/storefront-page.ts): the id, the rate
 * limit, the storefront, its product pages switch, moderation and the seller's
 * trader identity. This file only turns its `null` into the buyer's not-found,
 * its "not right now" into a try-again, and its result into markup. The loader
 * is React-cached, so generateMetadata and the body share one read.
 */

type Params = { storefrontId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { storefrontId } = await params;
  const result = await getPublicStorefrontPage(storefrontId);
  if (!result || result === PAGE_BUSY) return { robots: { index: false, follow: false } };
  const { page } = result;
  const displayName = storefrontDisplayName(page);
  const t = await getTranslations("ProductPage.storefront");
  // The seller's own line about the shop, when they wrote one.
  const description = page.header?.show && page.header.bio ? page.header.bio : t("description", { store: displayName });
  // The product pages' own switch: a seller who keeps those out of search
  // keeps the shop that lists them out too.
  const allow = page.allowIndexing;

  return {
    title: { absolute: displayName },
    description,
    robots: { index: allow, follow: allow },
    ...(allow ? { alternates: { canonical: page.url } } : {}),
    openGraph: { type: "website", title: displayName, description, siteName: displayName, url: page.url },
    twitter: { card: "summary", title: displayName, description },
  };
}

export default async function StorefrontPage({ params }: { params: Promise<Params> }) {
  const { storefrontId } = await params;
  const result = await getPublicStorefrontPage(storefrontId);
  if (result === PAGE_BUSY) return <BuyerBusy />;
  if (!result) notFound();
  const { page, ownerId, saleEndsInMs } = result;

  // A served page is a storefront view, the same signal the embed records.
  // After the response, so a counter can never slow a buyer down; deduped to
  // one per visitor per storefront per hour; and recordSignal cannot throw.
  // The IP and user agent are hashed with a server-only salt, never stored.
  const requestHeaders = await headers();
  const ip = await clientKey(requestHeaders);
  const userAgent = requestHeaders.get("user-agent");
  after(async () => {
    const hash = await visitorHash(ownerId, [ip, userAgent]);
    await recordSignal({
      accountId: ownerId,
      kind: "storefront_view",
      storefrontId: page.id,
      channel: "direct",
      visitorHash: hash,
      dedupeKey: await viewDedupeKey(page.id, hash),
    });
  });

  return (
    <>
      <StorefrontPageView page={page} />
      {/* A tile on sale stops being true when its sale ends: read the board
          again then, rather than leave an open tab advertising it. */}
      {saleEndsInMs !== null && <PriceRefresh inMs={saleEndsInMs} />}
    </>
  );
}
