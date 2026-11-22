import { bandFragment } from "@/lib/storefront/bands";
import { storefrontPageUrl } from "@/lib/storefront/product-page-url";
import {
  blockKey,
  type HeaderLink,
  type LinkTarget,
  type LinkTargetKind,
  type StorefrontBand,
  type StorefrontBlock,
  type StorefrontHeader,
} from "@/types/storefront";

// LINKS (types/storefront, LinkTarget): where a button or a header menu entry
// goes, RESOLVED ON THE SERVER into an address before a buyer's page is drawn.
// The page is handed hrefs, never ids to build them from, so a link to a
// product that is not live, a storefront that is not public or a band that is
// gone is simply not there.

/** A link, resolved for the page it is drawn on. */
export type ResolvedLink = {
  /** What the anchor's href is: a page address, an https URL, or a band's
   *  fragment on this page. */
  href: string;
  kind: LinkTargetKind;
};

/** Where a button's resolved link is filed in the page payload. */
export function buttonLinkKey(block: StorefrontBlock): string {
  return blockKey(block);
}

/** Where the header menu's n-th resolved link is filed. */
export function headerLinkKey(index: number): string {
  return `header-${index}`;
}

/** What the server knows about where links may lead, for resolveLinks. */
export type LinkWorld = {
  /** Where a live product's page is, from this surface (the tiles' own
   *  builder, which adds the embed's `via`). Null when it has no page here. */
  productHref: (productId: string) => string | null;
  /** The other storefronts of this store a buyer may open. */
  openStorefronts: ReadonlySet<string>;
  /** The bands this page draws. */
  bands: readonly StorefrontBand[];
};

/** One link resolved, or null when it leads nowhere a buyer may go. */
export function resolveLink(link: LinkTarget, world: LinkWorld): ResolvedLink | null {
  switch (link.kind) {
    case "product": {
      const href = world.productHref(link.productId);
      return href ? { href, kind: "product" } : null;
    }
    case "storefront":
      return world.openStorefronts.has(link.storefrontId)
        ? { href: storefrontPageUrl(link.storefrontId), kind: "storefront" }
        : null;
    case "band":
      return world.bands.some((band) => band.id === link.bandId)
        ? { href: bandFragment(link.bandId), kind: "band" }
        : null;
    case "url":
      return { href: link.url, kind: "url" };
  }
}

/**
 * Every link on a board, resolved: its buttons' (by block key) and its header
 * menu's (by position). A link that leads nowhere is left out, and the caller
 * drops what carried it.
 */
export function resolveLinks(
  blocks: readonly StorefrontBlock[],
  headerLinks: readonly HeaderLink[] | undefined,
  world: LinkWorld,
): Record<string, ResolvedLink> {
  const out: Record<string, ResolvedLink> = {};
  for (const block of blocks) {
    if (block.type !== "button") continue;
    const resolved = resolveLink(block.link, world);
    if (resolved) out[buttonLinkKey(block)] = resolved;
  }
  (headerLinks ?? []).forEach((entry, index) => {
    const resolved = resolveLink(entry.link, world);
    if (resolved) out[headerLinkKey(index)] = resolved;
  });
  return out;
}

/** The other storefronts a board's links name, each once. */
export function linkedStorefrontIds(
  blocks: readonly StorefrontBlock[],
  headerLinks: readonly HeaderLink[] | undefined,
): string[] {
  const ids = new Set<string>();
  for (const block of blocks) if (block.type === "button" && block.link.kind === "storefront") ids.add(block.link.storefrontId);
  for (const entry of headerLinks ?? []) if (entry.link.kind === "storefront") ids.add(entry.link.storefrontId);
  return [...ids];
}

/** The rel every address on the open web is given: no window handle, no
 *  referrer, and no endorsement a crawler could read into it. */
export const EXTERNAL_LINK_REL = "noopener noreferrer nofollow";

/**
 * The anchor attributes for a resolved link on a buyer's page.
 *
 * An address on the open web always opens in a new tab. Inside the embed
 * frame EVERY link does (`newTab`), as the tiles do there: the seller's page
 * stays put behind it, and a band, which is on our hosted page rather than in
 * the frame, is opened there at the band (`pageUrl` is that page).
 */
export function linkAnchorProps(
  link: ResolvedLink,
  { newTab, pageUrl }: { newTab: boolean; pageUrl: string },
): { href: string; target?: "_blank"; rel?: string } {
  if (link.kind === "url") return { href: link.href, target: "_blank", rel: EXTERNAL_LINK_REL };
  const href = link.kind === "band" && newTab ? `${pageUrl}${link.href}` : link.href;
  return newTab ? { href, target: "_blank", rel: "noopener noreferrer" } : { href };
}

/**
 * Whether a header makes a menu row of the masthead: shown, with a logo or a
 * menu link. Where it does, the page's cart joins that menu instead of
 * standing on its own row above the board (StorefrontPageView,
 * EmbedFrameView); a header without either leaves the page exactly as it was.
 */
export function headerHasMenu(header: StorefrontHeader | undefined): boolean {
  return Boolean(header?.show && (header.logo || header.links?.length));
}
