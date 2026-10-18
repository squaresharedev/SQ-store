import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { EmbedFrameView } from "@/components/storefront-page/EmbedFrameView";
import { recordSignal, viewDedupeKey, visitorHash } from "@/lib/analytics/record";
import { PAGE_BUSY } from "@/lib/public/busy";
import { clientKey } from "@/lib/rate-limit";
import { storefrontDisplayName } from "@/lib/storefront/display-name";
import { getEmbedFrame } from "@/lib/storefront/embed-frame-loader";

/**
 * /e/[key]/[site]: THE STOREFRONT EMBED'S FRAME. A seller's board, drawn inside
 * their own website by the loader they pasted (public/widget.js).
 *
 * THE ONE RESPONSE IN THE APP THAT MAY BE FRAMED, and only by [site]: the rule
 * in next.config.ts answers this address with `frame-ancestors [site]`, so the
 * browser will not draw it anywhere else. Everything that decides whether
 * there is anything to draw lives in getEmbedFrame (lib/storefront/
 * embed-frame-loader.ts): the key, the visitor's rate limit, embedding being
 * on, [site] being on the seller's list, and the hosted storefront's own gate.
 * The two halves are described together in lib/storefront/embed-frame.ts.
 *
 * EVERY REFUSAL DRAWS NOTHING. Not a message: this document is shown inside
 * someone's website, and "this storefront is unavailable" in the middle of a
 * seller's page is nobody's to act on. A frame that draws nothing never
 * reports a height either, so the loader leaves it collapsed and the page
 * around it looks as if the embed were not there. The not-found and error
 * files beside this one are empty for the same reason.
 */

type Params = { key: string; site: string };

/** A frame, never a page of its own. Opened directly it would be a hosted
 *  storefront by another address, and one no policy could keep to its site:
 *  frame-ancestors has nothing to say about a top-level visit. Browsers name
 *  what a request is for; a document is refused, a frame is served. */
async function isOpenedDirectly(): Promise<boolean> {
  return (await headers()).get("sec-fetch-dest") === "document";
}

/**
 * The [site] segment as it stands in the address. The router hands a page its
 * params percent-encoded, which turns the colon before a development port
 * into %3A; a real site's host has nothing in it to encode. Whatever this
 * yields is still only a claim, checked in full by getEmbedFrame.
 */
function siteSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  if (await isOpenedDirectly()) return {};
  const { key, site } = await params;
  const result = await getEmbedFrame(key, siteSegment(site));
  if (!result || result === PAGE_BUSY) return {};
  // Never indexed: the (public) layout already says so, and so does the
  // X-Robots-Tag this address is served with.
  return { title: { absolute: storefrontDisplayName(result.page) } };
}

export default async function EmbedFramePage({ params }: { params: Promise<Params> }) {
  if (await isOpenedDirectly()) notFound();
  const { key, site } = await params;
  const result = await getEmbedFrame(key, siteSegment(site));
  // Busy is refused like everything else: a try-again notice has no reader in
  // a frame, and the next visitor's load is the retry.
  if (!result || result === PAGE_BUSY) notFound();
  const { page, ownerId } = result;

  // A frame served to an allowed site is a storefront view, filed under the
  // embed. After the response, so a counter can never slow a seller's page
  // down; deduped to one per visitor per storefront per hour; and recordSignal
  // cannot throw. The IP and user agent are hashed with a server-only salt,
  // never stored, and nothing is kept on the visitor's device.
  const requestHeaders = await headers();
  const ip = await clientKey(requestHeaders);
  const userAgent = requestHeaders.get("user-agent");
  after(async () => {
    const hash = await visitorHash(ownerId, [ip, userAgent]);
    await recordSignal({
      accountId: ownerId,
      kind: "storefront_view",
      storefrontId: page.id,
      channel: "embed",
      visitorHash: hash,
      dedupeKey: await viewDedupeKey(page.id, hash),
    });
  });

  return <EmbedFrameView page={page} site={result.site.site} />;
}
