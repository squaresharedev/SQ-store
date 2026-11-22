import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "../setup/render";
import { StorefrontPageView } from "@/components/storefront-page/StorefrontPageView";
import { EmbedFrameView } from "@/components/storefront-page/EmbedFrameView";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { BAND_FRAME_CLASS, bandAnchorId } from "@/lib/storefront/bands";
import { EXTERNAL_LINK_REL } from "@/lib/storefront/links";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontBand,
  type StorefrontBlock,
} from "@/types/storefront";
import type { StorefrontPageData } from "@/types/storefront-page";

/**
 * The layout workstream on a buyer's board, below a browser: bands drawn in
 * the grid and given their full width by the frame, buttons as links that
 * lead where the server resolved, half-cell insets painted on the cell, and a
 * board with none of it drawn exactly as before.
 */

afterEach(cleanup);
let width = 1200;
let widthSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
});
afterAll(() => {
  widthSpy.mockRestore();
  vi.unstubAllGlobals();
});

const PRODUCT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DARK = "0b1e7a10-0000-4000-8000-000000000001";
const EMPTY = "0b1e7a10-0000-4000-8000-000000000002";

const bands: StorefrontBand[] = [
  { id: DARK, y: 0, h: 2, background: { kind: "solid", color: "#1c1917" } },
  { id: EMPTY, y: 4, h: 1, background: { kind: "gradient", from: "#fef3c7", to: "#fbcfe8", angle: 90 } },
];
const blocks: StorefrontBlock[] = [
  { type: "text", id: "t1", text: "Hello", variant: "heading", align: "left", x: 0, y: 0, w: 4, h: 1, fine: { top: true } },
  { type: "button", id: "web", label: "Journal", link: { kind: "url", url: "https://example.com/j" }, look: "outline", x: 0, y: 1, w: 2, h: 1, fine: { bottom: true } },
  { type: "button", id: "buy", label: "Buy", link: { kind: "product", productId: PRODUCT }, x: 2, y: 1, w: 2, h: 1 },
  { type: "product", productId: PRODUCT, x: 0, y: 2, w: 2, h: 2 },
];

function page(over: Partial<StorefrontPageData> = {}): StorefrontPageData {
  const theme = { ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme), rows: 6 };
  return {
    id: "sf",
    name: "Shop",
    theme,
    blocks,
    products: [{ id: PRODUCT, title: "Mug", price: 10, currency: "EUR", imageUrl: null, href: `/s/sf/p/${PRODUCT}` }],
    tileLook: resolveTileLook({ theme, productPage: DEFAULT_PRODUCT_PAGE_CONFIG, cartPage: { enabled: false } }),
    imageUrls: {},
    backgroundImageUrl: null,
    customFontUrl: null,
    seller: {},
    allowIndexing: false,
    url: "https://app.example/s/sf",
    bands,
    links: {
      b_web: { kind: "url", href: "https://example.com/j" },
      b_buy: { kind: "product", href: `/s/sf/p/${PRODUCT}` },
    },
    ...over,
  };
}

describe("a board with bands", () => {
  it("draws each band in the grid, under the blocks, with its anchor", () => {
    width = 1200;
    const { container } = render(<StorefrontPageView page={page()} />);
    const underlays = container.querySelectorAll("[data-grid-underlay]");
    expect([...underlays].map((node) => node.getAttribute("data-grid-underlay"))).toEqual([DARK, EMPTY]);
    expect((underlays[0] as HTMLElement).style.gridRow).toBe("1 / span 2");
    const paint = container.querySelector(`#${CSS.escape(bandAnchorId(DARK))}`) as HTMLElement;
    expect(paint.style.backgroundColor).toBe("rgb(28, 25, 23)");
    // Under the free cells and every block: first in the grid, at level 0.
    expect(container.querySelector(".ss-grid")?.firstElementChild).toBe(underlays[0]);
    expect((underlays[0] as HTMLElement).style.zIndex).toBe("0");
  });

  it("gives the bands the hosted page's full width, and the embed frame's", () => {
    const hosted = render(<StorefrontPageView page={page()} />);
    expect(hosted.container.querySelector("main")?.className).toContain(BAND_FRAME_CLASS);
    expect(hosted.container.querySelector("[data-storefront-page]")?.className).toContain("overflow-x-clip");
    cleanup();
    const embed = render(<EmbedFrameView page={page()} />);
    expect(embed.container.querySelector(`.${BAND_FRAME_CLASS}`)).not.toBeNull();
    expect(embed.container.querySelector("[data-embed-frame]")?.className).toContain("overflow-x-clip");
  });

  it("follows its blocks on a phone, and leaves out one with nothing on it", () => {
    width = 300;
    const { container } = render(<StorefrontPageView page={page()} />);
    const underlays = [...container.querySelectorAll("[data-grid-underlay]")];
    expect(underlays.map((node) => node.getAttribute("data-grid-underlay"))).toEqual([DARK]);
    width = 1200;
  });
});

describe("a button on a buyer's board", () => {
  it("opens an address on the web in a new tab, never followed", () => {
    const { container } = render(<StorefrontPageView page={page()} />);
    const web = container.querySelector('[data-storefront-button="web"]') as HTMLAnchorElement;
    expect(web.getAttribute("href")).toBe("https://example.com/j");
    expect(web.target).toBe("_blank");
    expect(web.rel).toBe(EXTERNAL_LINK_REL);
    const buy = container.querySelector('[data-storefront-button="buy"]') as HTMLAnchorElement;
    expect(buy.getAttribute("href")).toBe(`/s/sf/p/${PRODUCT}`);
    expect(buy.hasAttribute("target")).toBe(false);
  });

  it("opens every link in a new tab inside the embed frame", () => {
    const { container } = render(<EmbedFrameView page={page()} />);
    const buy = container.querySelector('[data-storefront-button="buy"]') as HTMLAnchorElement;
    expect(buy.target).toBe("_blank");
    expect(buy.rel).toBe("noopener noreferrer");
  });

  it("is not a link at all without a resolved address", () => {
    const { container } = render(<StorefrontPageView page={page({ links: undefined })} />);
    expect(container.querySelector("[data-storefront-button]")).toBeNull();
  });

  it("puts its words in an ink that reads on the band it sits on", () => {
    const { container } = render(<StorefrontPageView page={page()} />);
    const face = container.querySelector('[data-storefront-button="web"] [data-button-look="outline"] > span') as HTMLElement;
    expect(face.style.color).toBe("rgb(255, 255, 255)");
  });
});

describe("half-cell insets", () => {
  it("paint the cell on its half cells", () => {
    const { container } = render(<StorefrontPageView page={page()} />);
    const cell = container.querySelector('[data-grid-key="t_t1"]') as HTMLElement;
    expect(cell.style.top).toContain("0.5 / 1");
    expect(cell.style.height).toContain("calc(100% -");
  });
});

describe("a board with none of the layout fields", () => {
  it("is drawn with nothing new: no band, no frame class, no clip, no inset paint", () => {
    const legacy = page({
      bands: undefined,
      links: undefined,
      blocks: [
        { type: "text", id: "t", text: "Hello", variant: "heading", align: "left", x: 0, y: 0, w: 4, h: 1 },
        { type: "product", productId: PRODUCT, x: 0, y: 1, w: 2, h: 2 },
      ],
    });
    const { container } = render(<StorefrontPageView page={legacy} />);
    expect(container.querySelector("[data-grid-underlay]")).toBeNull();
    expect(container.querySelector(`.${BAND_FRAME_CLASS}`)).toBeNull();
    expect(container.querySelector("[data-storefront-page]")?.className).not.toContain("overflow-x-clip");
    expect(container.querySelector("main")?.className).toBe("mx-auto w-full max-w-[76rem] flex-1 px-4 py-6 @md:px-6 @3xl:px-10");
    for (const cell of container.querySelectorAll<HTMLElement>("[data-grid-cell]")) {
      expect(cell.style.width).toBe("");
      expect(cell.style.left).toBe("");
      expect(cell.style.top).toBe("");
    }
  });
});

describe("the header's logo and menu", () => {
  const withMenu = (over: Partial<StorefrontPageData> = {}) =>
    page({
      header: {
        show: true,
        name: "Shop",
        bio: "",
        logo: { key: "elements/u/logo.svg", size: "small" },
        links: [
          { label: "Buy", link: { kind: "product", productId: PRODUCT } },
          { label: "Journal", link: { kind: "url", url: "https://example.com/j" } },
        ],
      },
      logoUrl: "https://r2.example/logo.svg",
      links: {
        b_web: { kind: "url", href: "https://example.com/j" },
        b_buy: { kind: "product", href: `/s/sf/p/${PRODUCT}` },
        "header-0": { kind: "product", href: `/s/sf/p/${PRODUCT}` },
        "header-1": { kind: "url", href: "https://example.com/j" },
      },
      ...over,
    });

  it("draws the logo and the resolved links beside the name", () => {
    const { container } = render(<StorefrontPageView page={withMenu()} />);
    const logo = container.querySelector("[data-masthead-logo]") as HTMLImageElement;
    expect(logo.getAttribute("src")).toBe("https://r2.example/logo.svg");
    expect(logo.className).toContain("h-8");
    const links = [...container.querySelectorAll<HTMLAnchorElement>("[data-masthead-nav] a")];
    expect(links.map((link) => link.textContent)).toEqual(["Buy", "Journal"]);
    expect(links[1].rel).toBe(EXTERNAL_LINK_REL);
  });

  it("leaves out a menu entry the server could not resolve", () => {
    const { container } = render(<StorefrontPageView page={withMenu({ links: { "header-1": { kind: "url", href: "https://example.com/j" } } })} />);
    expect([...container.querySelectorAll("[data-masthead-nav] a")].map((link) => link.textContent)).toEqual(["Journal"]);
  });

  it("takes the cart into its menu, and the page draws no cart row of its own", () => {
    const { container } = render(<StorefrontPageView page={withMenu({ cart: {} })} />);
    expect(container.querySelector("[data-masthead-nav] [data-cart-button], [data-masthead-nav] button, [data-masthead-nav] a[href*='cart']")).not.toBeNull();
    expect(container.querySelector(".sticky")).toBeNull();
  });

  it("keeps a header without either exactly as it was, cart row and all", () => {
    const { container } = render(<StorefrontPageView page={page({ header: { show: true, name: "Shop", bio: "Hi" }, cart: {} })} />);
    expect(container.querySelector("[data-masthead-row]")).toBeNull();
    expect(container.querySelector(".sticky")).not.toBeNull();
    const masthead = container.querySelector("main > div") as HTMLElement;
    expect(masthead.className).toBe("space-y-1 mb-4");
  });
});
