import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "../setup/render";
import { ProductTileContent } from "@/components/storefront/ProductTileContent";
import { ProductPrice } from "@/components/product-page/ProductPrice";
import { DiscountExample } from "@/components/discounts/DiscountExample";
import {
  DEFAULT_STOREFRONT_CONFIG,
  resolveCardStyle,
  resolveSaleBadgePosition,
  type CardStyleOverrides,
  type StorefrontTheme,
} from "@/types/storefront";
import type { Product, ProductSale, ProductTileSale } from "@/types/product";

/**
 * A SALE, WHERE A BUYER SEES IT: on a product's tile, on its page, and in the
 * example the discount form shows a seller.
 *
 * While a sale runs the REGULAR price is struck through beside the price, on
 * the tile and the page alike. The tile's sale chip says what the sale takes
 * off that struck price (in percent, in money, or a word); the page's
 * PERCENTAGE is only ever the one the server proved (measured against the
 * lowest price of the 30 days before), and where there is none the page calls
 * the struck price the regular price.
 */

afterEach(cleanup);

const THEME: StorefrontTheme = {
  ...DEFAULT_STOREFRONT_CONFIG.theme,
  priceDisplay: "always",
  priceTagPosition: "below",
};

function product(sale?: ProductTileSale): Product {
  return {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    title: "Alder rocking chair",
    description: "",
    price: 745,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 3,
    maxPerOrder: 10,
    ...(sale ? { sale } : {}),
  };
}

const ON_SALE: ProductTileSale = { price: 670.5, offerPercent: 10 };
const chip = () => document.querySelector<HTMLElement>("[data-tile-price]")!;
const was = () => document.querySelector<HTMLElement>("[data-tile-price-was]");
const badge = () => document.querySelector<HTMLElement>("[data-tile-sale-badge]");

function tile(sale: ProductTileSale | undefined, theme: Partial<StorefrontTheme> = {}, extra: { soldOut?: boolean; overrides?: CardStyleOverrides } = {}) {
  return render(
    <ProductTileContent
      product={product(sale)}
      theme={{ ...THEME, ...theme }}
      soldOut={extra.soldOut}
      overrides={extra.overrides}
    />,
  );
}

describe("a product tile's price", () => {
  it("is the listed price, and nothing else, without a sale", () => {
    tile(undefined);
    expect(chip()).toHaveTextContent(/^€745\.00$/);
    expect(was()).toBeNull();
    expect(badge()).toBeNull();
  });

  it("is the sale price with the regular price struck through beside it", () => {
    tile(ON_SALE);
    expect(was()).toHaveTextContent("€745.00");
    expect(was()?.tagName).toBe("DEL");
    // Seen as two prices; heard once, as a sentence.
    const seen = [...chip().querySelectorAll("[aria-hidden='true']")].map((node) => node.textContent);
    expect(seen).toEqual(["€745.00", "€670.50"]);
    expect(chip().querySelector(".sr-only")).toHaveTextContent("Was €745.00, now €670.50");
  });

  it("strikes the regular price through however little comes off", () => {
    tile({ price: 744.9, offerPercent: null });
    expect(was()).toHaveTextContent("€745.00");
  });

  it("lets the struck price give way to the price: its size is a test of the room the tile has", () => {
    tile(ON_SALE, { priceTagPosition: "bottom-right" });
    // The expression the browser resolves: zero when both prices do not fit
    // the tile, the struck price's own size when they do (measured for real in
    // the storefront sale spec; here, that the rule is on the element).
    expect(was()!.style.getPropertyValue("--tag-was-size")).toMatch(
      /^clamp\(0px, calc\(\(\(100cqw - 2 \* var\(--tag-inset, 8px\)\) - var\(--tag-font-size\) \* /,
    );
    expect(was()!.style.fontSize).toBe("var(--tag-was-size)");
  });

  it("gives the two prices less of the title band than of the picture, so the name keeps some", () => {
    tile(ON_SALE);
    expect(document.querySelector("[data-title-band] [data-tile-price-was]")).toHaveTextContent("€745.00");
    expect(was()!.style.getPropertyValue("--tag-was-size")).toMatch(/^clamp\(0px, calc\(\(60cqw - /);
  });

  it("keeps a hidden price hidden, sale or not", () => {
    tile(ON_SALE, { priceTagPosition: "hidden" });
    expect(document.querySelector("[data-tile-price]")).toBeNull();
  });
});

describe("the sale chip on a tile", () => {
  it("is there by default, saying how much the sale takes off the struck price", () => {
    tile(ON_SALE);
    expect(badge()).toHaveTextContent(/^-10%$/);
    expect(badge()).toHaveAttribute("data-tile-sale-badge", "percent");
    expect(badge()).toHaveAttribute("data-sale-chip-look", "pill");
  });

  it("says the amount where under 1% comes off, rather than a percentage of nothing", () => {
    tile({ price: 744.9, offerPercent: null });
    expect(badge()).toHaveTextContent(/^-€0\.10$/);
  });

  it.each([
    ["amount", 670.5, "-€74.50"],
    ["amount", 740, "-€5"],
    ["sale", 670.5, "Sale"],
  ] as const)("says the seller's choice: %s at %s is %s", (saleBadge, now, words) => {
    tile({ price: now, offerPercent: 10 }, { saleBadge });
    expect(badge()).toHaveTextContent(new RegExp(`^${words.replace(/[.$]/g, "\\$&")}$`));
  });

  it("is not drawn when the seller hides it, without a sale, or on a tile that is sold out", () => {
    tile(ON_SALE, { saleBadge: "hidden" });
    expect(badge()).toBeNull();
    cleanup();
    tile(undefined);
    expect(badge()).toBeNull();
    cleanup();
    tile(ON_SALE, {}, { soldOut: true });
    expect(badge()).toBeNull();
  });

  it("is filled with the theme accent, or the seller's own colour, in an ink that reads on it", () => {
    tile(ON_SALE, { accent: "#1f4d3a" });
    expect(badge()!.style.backgroundColor).toBe("rgb(31, 77, 58)");
    expect(badge()!.style.color).toBe("rgb(255, 255, 255)");
    cleanup();
    tile(ON_SALE, { accent: "#1f4d3a", saleBadgeColor: "#fde047" });
    expect(badge()!.style.backgroundColor).toBe("rgb(253, 224, 71)");
    // Dark ink on a pale fill: the words are never left unreadable.
    expect(badge()!.style.color).not.toBe("rgb(255, 255, 255)");
  });

  it("can be set for one tile alone, over the storefront's own choice", () => {
    tile(
      ON_SALE,
      { saleBadge: "hidden" },
      { overrides: { saleBadge: "amount", saleBadgeLook: "sticker", saleBadgeColor: "#dc2626" } },
    );
    expect(badge()).toHaveTextContent("-€74.50");
    expect(badge()).toHaveAttribute("data-sale-chip-look", "sticker");
    expect(badge()!.style.backgroundColor).toBe("rgb(220, 38, 38)");
  });
});

describe("the sale chip's looks", () => {
  it("draws a pill, a round sticker at a tilt, a flag hanging from the edge, and a ribbon across the corner", () => {
    tile(ON_SALE, { saleBadgeLook: "pill" });
    expect(badge()!.className).toContain("rounded-full");
    cleanup();
    tile(ON_SALE, { saleBadgeLook: "sticker" });
    expect(badge()!.className).toContain("rounded-full");
    expect(["1", "1 / 1"]).toContain(badge()!.style.aspectRatio);
    expect(badge()!.style.rotate).toBe("-10deg");
    cleanup();
    tile(ON_SALE, { saleBadgeLook: "flag" });
    // Flush against the photo's top edge, notched at its tail below.
    expect(badge()!.className).toContain("top-0");
    expect(badge()!.style.clipPath).toContain("calc(100% - 0.5em)");
    cleanup();
    tile(ON_SALE, { saleBadgeLook: "ribbon" });
    // A box in the corner that clips a band turned across it, words and all.
    expect(badge()!.className).toContain("overflow-hidden");
    const band = badge()!.querySelector<HTMLElement>("span")!;
    expect(band.style.rotate).toBe("-45deg");
    expect(band).toHaveTextContent("-10%");
    expect(band.style.backgroundColor).not.toBe("");
  });

  it("turns the ribbon the right way in every corner", () => {
    const turn = (saleBadgePosition: "top-left" | "top-right" | "bottom-left" | "bottom-right") => {
      tile(ON_SALE, { saleBadgeLook: "ribbon", saleBadgePosition });
      const rotate = badge()!.querySelector<HTMLElement>("span")!.style.rotate;
      cleanup();
      return rotate;
    };
    expect([turn("top-left"), turn("top-right"), turn("bottom-left"), turn("bottom-right")]).toEqual([
      "-45deg",
      "45deg",
      "45deg",
      "-45deg",
    ]);
  });

  it("hangs a ribbon as a flag where it has no corner to cross", () => {
    tile(ON_SALE, { saleBadgeLook: "ribbon", saleBadgePosition: "top-center" });
    expect(badge()).toHaveAttribute("data-sale-chip-look", "flag");
    cleanup();
    // A tile too round to have corners moves the chip off them, and with it the ribbon.
    tile(ON_SALE, { saleBadgeLook: "ribbon", cornerRadius: 100 });
    expect(badge()).toHaveAttribute("data-sale-chip-look", "flag");
  });

  it("gives way, in every look, when it shares the price's row on a tile too narrow for both", () => {
    for (const saleBadgeLook of ["pill", "sticker", "flag", "ribbon"] as const) {
      tile(ON_SALE, { saleBadgeLook, priceTagPosition: "top-left", titleStyle: "overlay", saleBadgePosition: "top-left" });
      expect(badge()!.style.getPropertyValue("--tag-badge-room"), saleBadgeLook).toMatch(/^clamp\(0px, /);
      const size = saleBadgeLook === "ribbon" ? badge()!.style.width : badge()!.style.maxWidth;
      expect(size, saleBadgeLook).toContain("var(--tag-badge-room)");
      cleanup();
    }
  });
});

describe("where the sale chip sits", () => {
  const at = (
    position: Parameters<typeof resolveSaleBadgePosition>[0],
    opts: Partial<Parameters<typeof resolveSaleBadgePosition>[1]> = {},
  ) => resolveSaleBadgePosition(position, { cornerRadius: 0, titleBand: null, priceTag: "below", ...opts });

  it("is where the seller put it when nothing is in the way", () => {
    expect(at("top-left")).toBe("top-left");
    expect(at("bottom-right")).toBe("bottom-right");
  });

  it("never shares a row with a floated price: two chips side by side collide on a small tile", () => {
    expect(at("top-left", { priceTag: "top-left" })).toBe("bottom-left");
    // Not even from the far corner of the price's row.
    expect(at("top-right", { priceTag: "top-left" })).toBe("bottom-right");
    expect(at("bottom-right", { priceTag: "bottom-center" })).toBe("top-right");
    // A price in the title band, or hidden, holds no row of the picture.
    expect(at("top-left", { priceTag: "below" })).toBe("top-left");
    expect(at("top-left", { priceTag: "hidden" })).toBe("top-left");
  });

  it("keeps off the row an overlaid title band holds", () => {
    expect(at("bottom-left", { titleBand: "bottom" })).toBe("top-left");
  });

  it("shares the price's row from the far corner when the title band holds the other edge", () => {
    // No free edge, and the middle of the picture is the last place for a chip.
    expect(at("bottom-left", { titleBand: "bottom", priceTag: "top-left" })).toBe("top-right");
    expect(at("top-right", { titleBand: "top", priceTag: "bottom-right" })).toBe("bottom-left");
    // A price in the middle of its row leaves no far corner: the middle it is.
    expect(at("bottom-left", { titleBand: "bottom", priceTag: "top-center" })).toBe("middle-center");
    // And an edge when it is the middle that is taken.
    expect(at("middle-center", { priceTag: "middle-center" })).toBe("top-center");
    expect(at("middle-center", { priceTag: "middle-center", titleBand: "top" })).toBe("bottom-center");
  });

  it("gives way, when it shares the price's row, on a tile too narrow for both: the price never moves", () => {
    tile(ON_SALE, { priceTagPosition: "top-left", titleStyle: "overlay", saleBadgePosition: "top-left" });
    // Its room is a test the browser resolves against the tile as it came out:
    // the row, less the insets, less the price chip beside it.
    const room = badge()!.style.getPropertyValue("--tag-badge-room");
    expect(room).toMatch(/^clamp\(0px, calc\(\(\(100cqw - 3 \* var\(--tag-inset, 8px\) - var\(--tag-font-size\) \* /);
    expect(badge()!.style.maxWidth).toBe("var(--tag-badge-room)");
    expect(badge()!.className).toContain("overflow-hidden");
    // The struck price makes room for the chip before the chip gives way.
    expect(was()!.style.getPropertyValue("--tag-was-size")).toMatch(/^clamp\(0px, calc\(\(\(100cqw - 3 \* var\(--tag-inset, 8px\) /);
    cleanup();
    // On a row of its own it is simply a chip.
    tile(ON_SALE, { priceTagPosition: "top-left" });
    expect(badge()!.style.getPropertyValue("--tag-badge-room")).toBe("");
    expect(badge()!.style.maxWidth).toBe("");
  });

  it("sizes every chip from one grid cell when the board asks for the same size on every card", () => {
    tile(ON_SALE, { priceTagPosition: "top-left", chipScale: "cell" });
    // Both chips measure against the grid's cell, falling back to their own
    // tile only outside a grid (--ss-in-grid 0).
    for (const node of [badge()!, chip()]) {
      expect(node.style.getPropertyValue("--tag-font-size")).toMatch(/var\(--ss-cell\) \* [\d.]+ \* var\(--ss-in-grid\)/);
    }
    cleanup();
    tile(ON_SALE, { priceTagPosition: "top-left" });
    for (const node of [badge()!, chip()]) {
      expect(node.style.getPropertyValue("--tag-font-size")).not.toContain("--ss-cell");
    }
  });

  it("uses the middle of a row on a tile too round to have corners", () => {
    expect(at("top-left", { cornerRadius: 100 })).toBe("top-center");
    expect(at("top-left", { cornerRadius: 100, priceTag: "top-center" })).toBe("bottom-center");
    expect(at("top-left", { cornerRadius: 100, priceTag: "top-center", titleBand: "bottom" })).toBe("middle-center");
  });

  it("defaults to the percentage at the top left, following the theme accent", () => {
    expect(resolveCardStyle(DEFAULT_STOREFRONT_CONFIG.theme)).toMatchObject({
      saleBadge: "percent",
      saleBadgeLook: "pill",
      saleBadgePosition: "top-left",
      saleBadgeColor: undefined,
    });
  });
});

describe("a sale on the product page", () => {
  const sale = (over: Partial<ProductSale> = {}): ProductSale => ({
    regularPriceCents: 2400,
    priorPriceCents: 2400,
    percentOff: 25,
    offerPercent: 25,
    endsAt: null,
    ...over,
  });
  const price = (value: ProductSale | null, saleStyle?: "strike" | "slash") =>
    render(
      <ProductPrice
        priceCents={value ? 1800 : 2400}
        currency="EUR"
        sale={value}
        saleStyle={saleStyle}
        priceNote="none"
        shippingNote="none"
        isDigital={false}
        ink="#171717"
      />,
    );
  const struck = () => document.querySelector<HTMLElement>("[data-product-sale-was]");
  const ticket = () => document.querySelector<HTMLElement>("[data-product-sale-ticket]");

  it("shows the plain price, and no ticket, without a sale", () => {
    price(null);
    expect(struck()).toBeNull();
    expect(ticket()).toBeNull();
    expect(document.body).toHaveTextContent("€24.00");
  });

  it("crosses the regular price out, with the percentage and what the crossed-out price is", () => {
    price(sale());
    expect(struck()).toHaveTextContent("€24.00");
    expect(struck()?.tagName).toBe("DEL");
    expect(document.querySelector("[data-product-sale-percent]")).toHaveTextContent("-25%");
    expect(ticket()).toHaveAttribute("data-product-sale-ticket", "proven");
    expect(ticket()).toHaveTextContent("Crossed-out price: the lowest price in the 30 days before this sale.");
  });

  it("states the lower earlier price in figures, and measures the percentage against it", () => {
    price(sale({ priorPriceCents: 2040, percentOff: 11 }));
    expect(struck()).toHaveTextContent("€24.00");
    expect(document.querySelector("[data-product-sale-percent]")).toHaveTextContent("-11%");
    expect(ticket()).toHaveTextContent(
      "Crossed-out price: the regular price. Lowest price in the 30 days before this sale: €20.40.",
    );
  });

  it("still crosses the regular price out when a sale as deep ran before, claiming no percentage", () => {
    price(sale({ priorPriceCents: 1800, percentOff: null }));
    expect(struck()).toHaveTextContent("€24.00");
    expect(document.querySelector("[data-product-sale-percent]")).toBeNull();
    expect(ticket()).toHaveTextContent("Lowest price in the 30 days before this sale: €18.00.");
  });

  it("calls the crossed-out price the regular price when the records cannot say more", () => {
    price(sale({ priorPriceCents: null, percentOff: null }));
    expect(struck()).toHaveTextContent("€24.00");
    expect(document.querySelector("[data-product-sale-percent]")).toBeNull();
    expect(ticket()).toHaveAttribute("data-product-sale-ticket", "regular");
    expect(ticket()).toHaveTextContent(/^Crossed-out price: the regular price\.$/);
  });

  it("offers two looks of the same fact: a line through it, or a stroke across it", () => {
    price(sale());
    expect(document.querySelector("[data-product-sale]")).toHaveAttribute("data-product-sale", "strike");
    expect(struck()!.className).not.toContain("ss-price-slash");
    cleanup();
    price(sale(), "slash");
    expect(document.querySelector("[data-product-sale]")).toHaveAttribute("data-product-sale", "slash");
    // The stroke replaces the line, and the regular price moves in front.
    expect(struck()!.className).toContain("ss-price-slash");
    expect(struck()!.className).toContain("order-first");
    // Same words either way, and the same sentence for a screen reader.
    expect(struck()).toHaveTextContent("€24.00");
    expect(document.querySelector("[data-product-sale] .sr-only")).toHaveTextContent("Was €24.00, now €18.00");
  });
});

describe("the discount form's example", () => {
  const mug = { id: "p1", title: "Blue mug", priceCents: 2400, currency: "EUR" as const, imageUrl: "/mug.webp" };
  const example = () => document.querySelector<HTMLElement>("[data-discount-example]")!;

  it("shows the product, the regular price struck through, the new price, and what comes off", () => {
    render(<DiscountExample product={mug} value={{ type: "percent", percentOff: 10 }} nowCents={2160} />);
    expect(example().querySelector("img")).toHaveAttribute("src", "/mug.webp");
    expect(example().querySelector("[data-discount-example-off]")).toHaveTextContent("-10%");
    expect(example().querySelector("[data-discount-example-was]")).toHaveTextContent("€24.00");
    expect(example().querySelector("[data-discount-example-was]")?.tagName).toBe("DEL");
    expect(example().querySelector("[data-discount-example-now]")).toHaveTextContent("€21.60");
    expect(example()).toHaveAttribute("data-discount-example", "2160");
  });

  it("is heard as one sentence, and the picture is kept from a screen reader", () => {
    render(<DiscountExample product={mug} value={{ type: "percent", percentOff: 10 }} nowCents={2160} />);
    expect(example().querySelector("figcaption")).toHaveTextContent("Example: Blue mug at €24.00 costs €21.60.");
    for (const part of example().querySelectorAll(":scope > div")) expect(part).toHaveAttribute("aria-hidden", "true");
  });

  it("stamps an amount as what really comes off this product, not as what was typed", () => {
    // 5.00 off a 0.80 sticker stops at the smallest payment: 0.30 comes off.
    const sticker = { id: "p2", title: "Sticker", priceCents: 80, currency: "EUR" as const, imageUrl: null };
    render(<DiscountExample product={sticker} value={{ type: "amount", amountOffCents: 500, currency: "EUR" }} nowCents={50} />);
    expect(example().querySelector("[data-discount-example-off]")).toHaveTextContent("-€0.30");
    expect(example().querySelector("[data-discount-example-now]")).toHaveTextContent("€0.50");
    // No photo: the placeholder, not a broken image.
    expect(example().querySelector("img")).toBeNull();
  });
});
