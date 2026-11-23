import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "../setup/render";
import { StorefrontPageView } from "@/components/storefront-page/StorefrontPageView";
import { EmbedFrameView } from "@/components/storefront-page/EmbedFrameView";
import { CarouselTileContent } from "@/components/storefront/CarouselTileContent";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { DEFAULT_PRODUCT_PAGE_CONFIG, DEFAULT_STOREFRONT_CONFIG, type CarouselBlock } from "@/types/storefront";
import type { Product } from "@/types/product";
import type { StorefrontPageData } from "@/types/storefront-page";

/**
 * THE CAROUSEL'S FACE, below a browser: a named region holding a list of
 * product cards in the carousel's order, each a link to its product's page
 * (a new tab inside the embed frame), and a previous and a next arrow with
 * names of their own that step the row a page at a time, smoothly unless the
 * reader asked for less motion. jsdom has no layout, so the row's width is
 * stated: wider content than box is what brings the arrows in.
 */

const LAMP = "aaaaaaaa-0000-4000-8000-000000000001";
const MUG = "aaaaaaaa-0000-4000-8000-000000000002";
const VASE = "aaaaaaaa-0000-4000-8000-000000000003";
const CAROUSEL = "c0000000-0000-4000-8000-000000000001";

const scrollBy = vi.fn();
let rowWidth = 1000;
const spies: { mockRestore: () => void }[] = [];

beforeAll(() => {
  // The observer reports the row as soon as it is watched, as a browser does.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback();
      }
      unobserve() {}
      disconnect() {}
    },
  );
  // The board is 1200 wide; the carousel's row shows 400 of its content.
  spies.push(
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "UL" ? 400 : 1200;
    }),
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "UL" ? rowWidth : 1200;
    }),
  );
  (HTMLElement.prototype as unknown as { scrollBy: typeof scrollBy }).scrollBy = scrollBy;
});
afterAll(() => {
  for (const spy of spies) spy.mockRestore();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  scrollBy.mockReset();
  rowWidth = 1000;
});
afterEach(cleanup);

const carousel = (productIds: string[]): CarouselBlock => ({ type: "carousel", id: CAROUSEL, productIds, x: 0, y: 0, w: 6, h: 2 });

function page(productIds: string[]): StorefrontPageData {
  const theme = { ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme), rows: 4 };
  const tile = (id: string, title: string) => ({ id, title, price: 10, currency: "EUR" as const, imageUrl: null, href: `/s/sf/p/${id}` });
  return {
    id: "sf",
    name: "Shop",
    theme,
    blocks: [carousel(productIds)],
    // The payload carries no VASE: a buyer may not see it.
    products: [tile(LAMP, "Lamp"), tile(MUG, "Mug")],
    tileLook: resolveTileLook({ theme, productPage: DEFAULT_PRODUCT_PAGE_CONFIG, cartPage: { enabled: false } }),
    imageUrls: {},
    backgroundImageUrl: null,
    customFontUrl: null,
    seller: {},
    allowIndexing: false,
    url: "https://app.example/s/sf",
  };
}

describe("a carousel on a buyer's board", () => {
  it("is a named region with a card per product it may show, in the carousel's order", () => {
    render(<StorefrontPageView page={page([MUG, VASE, LAMP])} />);
    const region = screen.getByRole("region", { name: "2 products" });
    expect(region.getAttribute("aria-roledescription")).toBe("carousel");
    const cards = within(region).getAllByRole("listitem");
    expect(cards.map((card) => card.getAttribute("data-carousel-card"))).toEqual([MUG, LAMP]);
  });

  it("makes each card the way to its product's page, as a product card is", () => {
    render(<StorefrontPageView page={page([MUG, LAMP])} />);
    const links = within(screen.getByRole("region", { name: "2 products" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([`/s/sf/p/${MUG}`, `/s/sf/p/${LAMP}`]);
    expect(links[0].getAttribute("data-storefront-tile")).toBe(MUG);
    expect(links[0].hasAttribute("target")).toBe(false);
    expect(links[0].textContent).toContain("Mug");
  });

  it("opens a card in a tab of its own inside the embed frame", () => {
    render(<EmbedFrameView page={page([MUG, LAMP])} />);
    const link = within(screen.getByRole("region", { name: "2 products" })).getAllByRole("link")[0] as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  it("steps a page at a time with named arrows, faded and still at an end", () => {
    render(<StorefrontPageView page={page([MUG, LAMP])} />);
    const previous = screen.getByRole("button", { name: "Previous products" });
    const next = screen.getByRole("button", { name: "Next products" });
    // At the start: going back is offered but does nothing, and keeps focus.
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(next.hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(previous);
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.click(next);
    expect(scrollBy).toHaveBeenCalledWith({ left: 400, behavior: "smooth" });
    // Both are buttons a keyboard reaches, controlling the row.
    const list = within(screen.getByRole("region", { name: "2 products" })).getByRole("list");
    for (const arrow of [previous, next]) {
      expect(arrow.tagName).toBe("BUTTON");
      expect(arrow.getAttribute("type")).toBe("button");
      expect(arrow.getAttribute("aria-controls")).toBe(list.id);
    }
  });

  it("jumps instead of gliding for a reader who asked for less motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    render(<StorefrontPageView page={page([MUG, LAMP])} />);
    fireEvent.click(screen.getByRole("button", { name: "Next products" }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 400, behavior: "auto" });
    vi.stubGlobal("matchMedia", undefined);
  });

  it("draws no arrows when every card already fits", () => {
    rowWidth = 400;
    render(<StorefrontPageView page={page([MUG, LAMP])} />);
    expect(screen.queryByRole("button", { name: "Next products" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "2 products" })).getAllByRole("link")).toHaveLength(2);
  });
});

describe("a carousel on the seller's own board", () => {
  const product = (id: string, title: string): Product => ({
    id,
    title,
    description: "",
    price: 12,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 0,
    maxPerOrder: 1,
  });
  const catalog = new Map([
    [LAMP, product(LAMP, "Lamp")],
    [MUG, product(MUG, "Mug")],
  ]);

  it("draws the cards from the catalogue, leading nowhere", () => {
    const theme = DEFAULT_STOREFRONT_CONFIG.theme;
    render(<CarouselTileContent block={carousel([LAMP, MUG])} theme={theme} cards={{ product: (id) => catalog.get(id) ?? null }} />);
    const region = screen.getByRole("region", { name: "2 products" });
    expect(within(region).queryAllByRole("link")).toHaveLength(0);
    expect(region.textContent).toContain("Lamp");
    expect(region.textContent).toContain("Mug");
  });

  it("shows a quiet empty row, with no words, when none of its products is known", () => {
    const { container } = render(
      <CarouselTileContent block={carousel([VASE])} theme={DEFAULT_STOREFRONT_CONFIG.theme} cards={{ product: () => null }} />,
    );
    expect(container.querySelector("[data-carousel]")).toBeNull();
    expect(screen.queryByRole("region", { name: /product/ })).toBeNull();
    expect(container.textContent).toBe("");
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
