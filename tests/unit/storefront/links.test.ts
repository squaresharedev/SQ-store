import { describe, expect, it } from "vitest";
import {
  EXTERNAL_LINK_REL,
  buttonLinkKey,
  headerLinkKey,
  linkAnchorProps,
  linkedStorefrontIds,
  resolveLink,
  resolveLinks,
  type LinkWorld,
} from "@/lib/storefront/links";
import { storefrontPageUrl } from "@/lib/storefront/product-page-url";
import type { StorefrontBlock } from "@/types/storefront";

const LIVE = "11111111-1111-4111-8111-111111111111";
const DRAFT = "22222222-2222-4222-8222-222222222222";
const OPEN = "33333333-3333-4333-8333-333333333333";
const CLOSED = "44444444-4444-4444-8444-444444444444";
const BAND = "55555555-5555-4555-8555-555555555555";

const world: LinkWorld = {
  productHref: (id) => (id === LIVE ? `/s/sf/p/${id}?via=embed` : null),
  openStorefronts: new Set([OPEN]),
  bands: [{ id: BAND, y: 0, h: 1, background: { kind: "solid", color: "#000000" } }],
};

const button = (id: string, link: Extract<StorefrontBlock, { type: "button" }>["link"]): StorefrontBlock => ({
  type: "button", id, label: "Go", link, x: 0, y: 0, w: 2, h: 1,
});

describe("resolving a link on the server", () => {
  it("leads a product to its page as the tiles' builder makes it, and only while it is live", () => {
    expect(resolveLink({ kind: "product", productId: LIVE }, world)).toEqual({ kind: "product", href: `/s/sf/p/${LIVE}?via=embed` });
    expect(resolveLink({ kind: "product", productId: DRAFT }, world)).toBeNull();
  });

  it("leads to another storefront only while buyers may open it", () => {
    expect(resolveLink({ kind: "storefront", storefrontId: OPEN }, world)).toEqual({ kind: "storefront", href: storefrontPageUrl(OPEN) });
    expect(resolveLink({ kind: "storefront", storefrontId: CLOSED }, world)).toBeNull();
  });

  it("leads to a band on this page by its anchor, and to an address as it is", () => {
    expect(resolveLink({ kind: "band", bandId: BAND }, world)).toEqual({ kind: "band", href: `#band-${BAND}` });
    expect(resolveLink({ kind: "band", bandId: CLOSED }, world)).toBeNull();
    expect(resolveLink({ kind: "url", url: "https://example.com/a" }, world)).toEqual({ kind: "url", href: "https://example.com/a" });
  });

  it("files every resolved link by its button, and the menu's by position, leaving out the dead", () => {
    const blocks = [button("a", { kind: "product", productId: LIVE }), button("b", { kind: "product", productId: DRAFT })];
    const links = resolveLinks(blocks, [{ label: "Band", link: { kind: "band", bandId: BAND } }], world);
    expect(Object.keys(links).sort()).toEqual([buttonLinkKey(blocks[0]), headerLinkKey(0)].sort());
  });

  it("names the other storefronts a board's links lead to, each once", () => {
    expect(
      linkedStorefrontIds(
        [button("a", { kind: "storefront", storefrontId: OPEN }), button("b", { kind: "storefront", storefrontId: OPEN })],
        [{ label: "x", link: { kind: "storefront", storefrontId: CLOSED } }],
      ),
    ).toEqual([OPEN, CLOSED]);
  });
});

describe("a link's anchor on a buyer's page", () => {
  const hosted = { newTab: false, pageUrl: "https://app.example/s/sf" };
  const embed = { newTab: true, pageUrl: "https://app.example/s/sf" };

  it("opens an address on the web in a new tab, never followed and never handed a referrer", () => {
    expect(linkAnchorProps({ kind: "url", href: "https://x.example" }, hosted)).toEqual({
      href: "https://x.example",
      target: "_blank",
      rel: EXTERNAL_LINK_REL,
    });
    expect(EXTERNAL_LINK_REL.split(" ").sort()).toEqual(["nofollow", "noopener", "noreferrer"]);
  });

  it("stays in the tab on the hosted page, and opens a new one from the embed frame", () => {
    expect(linkAnchorProps({ kind: "product", href: "/s/sf/p/1" }, hosted)).toEqual({ href: "/s/sf/p/1" });
    expect(linkAnchorProps({ kind: "product", href: "/s/sf/p/1" }, embed)).toEqual({
      href: "/s/sf/p/1",
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });

  it("scrolls to a band in place, or opens the hosted page at it from the embed frame", () => {
    expect(linkAnchorProps({ kind: "band", href: "#band-1" }, hosted)).toEqual({ href: "#band-1" });
    expect(linkAnchorProps({ kind: "band", href: "#band-1" }, embed)).toMatchObject({
      href: "https://app.example/s/sf#band-1",
      target: "_blank",
    });
  });
});
