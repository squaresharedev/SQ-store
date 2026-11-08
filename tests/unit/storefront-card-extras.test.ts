import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn(async (key: string) => `https://cdn.test/${key}`) }));

import {
  CARD_BUY_BUTTONS,
  CARD_HOVER_EFFECTS,
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  PRODUCT_PAGE_CTA_MAX,
  TEXT_LETTER_SPACING_MAX,
  TEXT_LETTER_SPACING_MIN,
  TEXT_LINE_HEIGHT_MAX,
  TEXT_LINE_HEIGHT_MIN,
  resolveCardStyle,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import { applyDesignOps } from "@/lib/storefront/design-ops";
import { deriveTileStockState, tileStockState } from "@/lib/stock/badge";
import { toPublicStockState } from "@/lib/stock/public";
import { readRatingSummaries } from "@/lib/reviews/ratings";
import { loadTileExtras, secondPhotoKey, tileExtrasWanted } from "@/lib/storefront/tile-extras";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { tileProduct, type TileProductRow } from "@/lib/storefront/storefront-page";
import { ctaStyle, resolveCta } from "@/components/product-page/product-page-maps";
import {
  cardHoverFrameClass,
  cardHoverZoomClass,
  hoverPhotoClass,
  textSizeStyle,
  textSpacingStyle,
  tileBuyArrowClass,
  tileBuyButtonPaint,
  tileBuyButtonStyle,
} from "@/components/storefront/config-maps";
import { contrastRatio } from "@/lib/format/color";
import { editorEntries, searchEditor } from "@/components/storefront/editor-search";
import { english } from "../setup/translate";

/**
 * The card extras (hover effect, second photo, buy button, stars, low stock)
 * and text spacing, below the components: what the schema lets in, how a
 * tile resolves them, and what the server is allowed to hand a buyer's board.
 * The one rule pinned hardest is the stock one: a card says "low" or "gone",
 * and no number about stock ever leaves the server for a card.
 */

const ids = {
  product: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  other: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  text: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const product: StorefrontBlock = { type: "product", productId: ids.product, x: 0, y: 0, w: 1, h: 1 };
const other: StorefrontBlock = { type: "product", productId: ids.other, x: 1, y: 0, w: 1, h: 1 };
const text: StorefrontBlock = {
  type: "text",
  id: ids.text,
  text: "Hello",
  variant: "body",
  align: "left",
  x: 2,
  y: 0,
  w: 2,
  h: 1,
};

function configWith(blocks: StorefrontBlock[], theme: Partial<StorefrontTheme> = {}): StorefrontConfig {
  const base = structuredClone(DEFAULT_STOREFRONT_CONFIG);
  return { ...base, theme: { ...base.theme, ...theme }, blocks };
}

const parses = (config: StorefrontConfig) => storefrontConfigSchema.safeParse(config).success;

describe("the card extras in the schema", () => {
  it("accepts every effect and button look, on the theme and on a tile", () => {
    for (const hoverEffect of CARD_HOVER_EFFECTS) {
      for (const buyButton of CARD_BUY_BUTTONS) {
        const config = configWith(
          [{ ...product, style: { hoverEffect, buyButton, hoverPhoto: true, showRating: false, showLowStock: true } }],
          { hoverEffect, buyButton, hoverPhoto: false, showRating: true, showLowStock: false },
        );
        expect(storefrontConfigSchema.safeParse(config).error?.issues).toBeUndefined();
      }
    }
  });

  it("refuses anything off the lists", () => {
    expect(parses(configWith([], { hoverEffect: "spin" } as unknown as StorefrontTheme))).toBe(false);
    expect(parses(configWith([{ ...product, style: { buyButton: "huge" } } as unknown as StorefrontBlock]))).toBe(false);
    expect(parses(configWith([], { showRating: "yes" } as unknown as StorefrontTheme))).toBe(false);
  });

  it("keeps a board that never set them parsing and resolving exactly as before", () => {
    const config = configWith([product]);
    expect(parses(config)).toBe(true);
    const card = resolveCardStyle(config.theme);
    expect([card.hoverEffect, card.hoverPhoto, card.buyButton, card.showRating, card.showLowStock]).toEqual([
      "none",
      false,
      "none",
      false,
      false,
    ]);
  });

  it("takes the button's own words and colours, and holds them to the page button's rules", () => {
    const own = { buyButtonLabel: "Grab it", buyButtonColor: "#0a7a3d", buyButtonTextColor: "#fffbe6" };
    expect(parses(configWith([{ ...product, style: own }], own))).toBe(true);
    expect(parses(configWith([{ ...product, style: { buyButtonLabel: "x".repeat(PRODUCT_PAGE_CTA_MAX) } }]))).toBe(true);
    for (const bad of [
      { buyButtonLabel: "x".repeat(PRODUCT_PAGE_CTA_MAX + 1) },
      { buyButtonLabel: "" },
      { buyButtonLabel: "Buy\u0007now" },
      { buyButtonColor: "green" },
      { buyButtonTextColor: "#12345" },
    ]) {
      expect(parses(configWith([{ ...product, style: bad } as StorefrontBlock]))).toBe(false);
      expect(parses(configWith([], bad as Partial<StorefrontTheme>))).toBe(false);
    }
    // A tile follows the theme's cards, field by field, and the page past both.
    const theme = configWith([], { buyButtonLabel: "Shop", buyButtonColor: "#111111" }).theme;
    expect(resolveCardStyle(theme, { buyButtonColor: "#222222" })).toMatchObject({
      buyButtonLabel: "Shop",
      buyButtonColor: "#222222",
      buyButtonTextColor: undefined,
    });
    expect(resolveCardStyle(configWith([]).theme).buyButtonLabel).toBeUndefined();
  });

  it("lets a tile turn off what the theme turned on", () => {
    const theme = configWith([], { buyButton: "solid", showRating: true }).theme;
    expect(resolveCardStyle(theme, { buyButton: "none", showRating: false })).toMatchObject({
      buyButton: "none",
      showRating: false,
    });
    expect(resolveCardStyle(theme)).toMatchObject({ buyButton: "solid", showRating: true });
  });
});

describe("text spacing in the schema", () => {
  it("accepts its whole range as whole numbers and nothing past it", () => {
    for (const letterSpacing of [TEXT_LETTER_SPACING_MIN, 0, TEXT_LETTER_SPACING_MAX]) {
      for (const lineHeight of [TEXT_LINE_HEIGHT_MIN, TEXT_LINE_HEIGHT_MAX]) {
        expect(parses(configWith([{ ...text, letterSpacing, lineHeight }]))).toBe(true);
      }
    }
    for (const bad of [
      { letterSpacing: TEXT_LETTER_SPACING_MIN - 1 },
      { letterSpacing: TEXT_LETTER_SPACING_MAX + 1 },
      { letterSpacing: 2.5 },
      { lineHeight: TEXT_LINE_HEIGHT_MIN - 1 },
      { lineHeight: TEXT_LINE_HEIGHT_MAX + 1 },
      { lineHeight: "1.5" },
    ]) {
      expect(parses(configWith([{ ...text, ...bad } as StorefrontBlock]))).toBe(false);
    }
  });

  it("draws as em and a factor, adding nothing when unset", () => {
    expect(textSpacingStyle({})).toEqual({});
    expect(textSpacingStyle({ letterSpacing: 12, lineHeight: 150 })).toEqual({ letterSpacing: "0.12em", lineHeight: 1.5 });
    expect(textSpacingStyle({ letterSpacing: -5 })).toEqual({ letterSpacing: "-0.05em" });
    // The default the slider rests on is the 1.25 every block always had.
    expect(textSizeStyle(14).lineHeight).toBe(1.25);
  });
});

describe("stock on a card", () => {
  const fields = (stockQuantity: number | null, trackStock = true, lowStockThreshold = 3) => ({
    trackStock,
    stockQuantity,
    lowStockThreshold,
  });

  it("is low at or below the product's own level, gone at zero, and nothing otherwise", () => {
    expect(deriveTileStockState(fields(3))).toBe("low_stock");
    expect(deriveTileStockState(fields(1))).toBe("low_stock");
    expect(deriveTileStockState(fields(0))).toBe("sold_out");
    expect(deriveTileStockState(fields(4))).toBeNull();
    expect(deriveTileStockState(fields(2, false))).toBeNull();
    // A level of zero never says "low": one left is simply in stock.
    expect(deriveTileStockState(fields(1, true, 0))).toBeNull();
  });

  it("takes the state a buyer's board was handed over any counts", () => {
    expect(tileStockState({ ...fields(null, false), stockState: "low_stock" })).toBe("low_stock");
    expect(tileStockState(fields(2))).toBe("low_stock");
  });

  it("leaves the server as a word, never a number", () => {
    const state = toPublicStockState({ track_stock: true, stock_quantity: 2, low_stock_threshold: 5 });
    expect(state).toBe("low_stock");
    expect(JSON.stringify(state)).not.toMatch(/\d/);
  });
});

describe("the tile a buyer's board is handed", () => {
  const row: TileProductRow = {
    id: ids.product,
    title: "Mug",
    price_cents: 1250,
    currency: "EUR",
    image_key: "images/u/cover.webp",
    created_at: null,
    moderation_status: null,
    gallery: [],
    track_stock: true,
    stock_quantity: 2,
    low_stock_threshold: 5,
  };

  it("carries no stock number whatever the row held", async () => {
    const tile = await tileProduct(row, "/s/x/p/y", undefined, { stockState: "low_stock" });
    expect(tile.stockState).toBe("low_stock");
    const json = JSON.stringify(tile);
    expect(json).not.toContain("stock_quantity");
    expect(json).not.toContain("low_stock_threshold");
    expect(json).not.toContain("track_stock");
    // The price is the only number left, and it is not the stock.
    expect(Object.values(tile).filter((value) => typeof value === "number")).toEqual([12.5]);
  });

  it("carries an extra only when its card shows it", async () => {
    const plain = await tileProduct(row, "/s/x/p/y", undefined);
    expect(plain).not.toHaveProperty("hoverImageUrl");
    expect(plain).not.toHaveProperty("rating");
    expect(plain).not.toHaveProperty("stockState");
  });
});

describe("which extras a board asks for", () => {
  it("follows each tile's resolved style", () => {
    const config = configWith(
      [{ ...product, style: { hoverPhoto: true, showRating: false } }, other],
      { showRating: true, showLowStock: true },
    );
    const wanted = tileExtrasWanted(config);
    expect([...wanted.hoverPhoto]).toEqual([ids.product]);
    expect([...wanted.rating]).toEqual([ids.other]);
    expect([...wanted.stock].sort()).toEqual([ids.product, ids.other].sort());
  });

  it("asks for the stock state for a buy button too, which is not offered once none are left", () => {
    const wanted = tileExtrasWanted(configWith([{ ...product, style: { buyButton: "link" } }, other]));
    expect([...wanted.stock]).toEqual([ids.product]);
  });

  it("picks a photo every version shares, else the first, else none", () => {
    const key = (name: string) => `images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-${name}.webp`;
    const red = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    expect(secondPhotoKey([{ key: key("red"), alt: "", optionId: red }, { key: key("all"), alt: "" }])).toBe(key("all"));
    expect(secondPhotoKey([{ key: key("red"), alt: "", optionId: red }])).toBe(key("red"));
    expect(secondPhotoKey([])).toBeNull();
    expect(secondPhotoKey("not a gallery")).toBeNull();
  });
});

describe("loading the extras", () => {
  function client(ratings: { product_id: string; review_count: number; average: number | null }[] | Error) {
    const asked: string[][] = [];
    return {
      asked,
      from: vi.fn(() => ({
        select: () => ({
          in: async (_column: string, run: string[]) => {
            asked.push(run);
            return ratings instanceof Error
              ? { data: null, error: { message: ratings.message } }
              : { data: ratings.filter((row) => run.includes(row.product_id)), error: null };
          },
        }),
      })),
    };
  }
  const gallery = [
    { key: "images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-2.webp", alt: "" },
  ];
  const rows = [
    { id: ids.product, image_key: "images/k/cover.webp", gallery, track_stock: true, stock_quantity: 0, low_stock_threshold: 3 },
    { id: ids.other, image_key: null, gallery, track_stock: true, stock_quantity: 2, low_stock_threshold: 3 },
  ];

  it("signs, reads and works out only what each card shows", async () => {
    const fake = client([{ product_id: ids.other, review_count: 4, average: 4.5 }]);
    const extras = await loadTileExtras(
      fake as never,
      rows,
      { hoverPhoto: new Set([ids.product, ids.other]), rating: new Set([ids.other]), stock: new Set([ids.product]) },
      { reviewsShown: true, context: "test" },
    );
    expect(extras.get(ids.product)).toEqual({ hoverImageUrl: `https://cdn.test/${gallery[0].key}`, stockState: "sold_out" });
    // No cover, so no second photo; no stock asked for, so no state.
    expect(extras.get(ids.other)).toEqual({ rating: { average: 4.5, count: 4 } });
    expect(fake.asked).toEqual([[ids.other]]);
  });

  it("reads no ratings while the product page shows no reviews", async () => {
    const fake = client([{ product_id: ids.other, review_count: 4, average: 4.5 }]);
    const extras = await loadTileExtras(
      fake as never,
      rows,
      { hoverPhoto: new Set(), rating: new Set([ids.other]), stock: new Set() },
      { reviewsShown: false, context: "test" },
    );
    expect(fake.from).not.toHaveBeenCalled();
    expect(extras.get(ids.other)).toEqual({});
  });

  it("leaves the stars out, not the page, when the read fails, and skips products with none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readRatingSummaries(client(new Error("down")) as never, [ids.product], "test")).toEqual(new Map());
    const none = await readRatingSummaries(
      client([{ product_id: ids.product, review_count: 0, average: null }]) as never,
      [ids.product],
      "test",
    );
    expect(none.size).toBe(0);
  });
});

describe("what a card borrows from the product page", () => {
  it("takes the page button's words and colours, its stars and whether it shows reviews", () => {
    const theme = DEFAULT_STOREFRONT_CONFIG.theme;
    const look = resolveTileLook({
      theme,
      productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, ctaLabel: "Get one", ctaColor: "#123456", starColor: "#ff0000" },
    });
    expect(look.buyLabel).toBe("Get one");
    expect(look.buy.fill).toBe("#123456");
    expect(look.starColor).toBe("#ff0000");
    expect(look.reviewsShown).toBe(true);
    expect(
      resolveTileLook({ theme, productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, sections: [{ id: "reviews", show: false }] } })
        .reviewsShown,
    ).toBe(false);
  });

  it("draws a solid button as the page's own, and keeps an outline's words readable", () => {
    const yellow = resolveCta({ ctaColor: "#ffe066" }, DEFAULT_STOREFRONT_CONFIG.theme);
    expect(tileBuyButtonStyle("solid", yellow)).toMatchObject(ctaStyle(yellow));
    const outline = tileBuyButtonStyle("outline", yellow);
    // Pale yellow words on a white card would vanish; they take an ink that reads.
    expect(contrastRatio(String(outline.color), "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(outline.backgroundColor).toBeUndefined();
  });

  it("paints the seller's own colours exactly, and the words follow a fill of their own", () => {
    const page = resolveCta({ ctaColor: "#ffe066" }, DEFAULT_STOREFRONT_CONFIG.theme);
    // Nothing of its own: the page's button, as before.
    expect(tileBuyButtonPaint("solid", page)).toEqual({ color: page.fill, ink: page.text });
    // A dark fill of its own gets light words without being asked.
    expect(tileBuyButtonPaint("solid", page, { buyButtonColor: "#0b3d2e" })).toEqual({ color: "#0b3d2e", ink: "#ffffff" });
    expect(tileBuyButtonPaint("solid", page, { buyButtonColor: "#0b3d2e", buyButtonTextColor: "#ffd166" })).toEqual({
      color: "#0b3d2e",
      ink: "#ffd166",
    });
    // A pale colour the seller chose for an outline is theirs: no legibility nudge.
    expect(tileBuyButtonPaint("outline", page, { buyButtonColor: "#ffe066" })).toEqual({ color: "#ffe066", ink: "#ffe066" });
    expect(tileBuyButtonPaint("link", page, { buyButtonTextColor: "#c1121f" }).ink).toBe("#c1121f");

    const solid = tileBuyButtonStyle("solid", page, { buyButtonColor: "#0b3d2e" });
    expect(solid).toMatchObject({ backgroundColor: "#0b3d2e", color: "#ffffff" });
    const outline = tileBuyButtonStyle("outline", page, { buyButtonColor: "#0b3d2e", buyButtonTextColor: "#c1121f" });
    expect(outline).toMatchObject({ color: "#c1121f" });
    expect(String(outline.boxShadow)).toContain("#0b3d2e");
  });

  it("keeps a page outline in the card's own ink once the card has its own colours", () => {
    const outlined = resolveCta({ ctaColor: "#ffe066", ctaBorderWidth: 2 }, DEFAULT_STOREFRONT_CONFIG.theme);
    expect(String(tileBuyButtonStyle("solid", outlined).boxShadow)).toContain(outlined.borderColor);
    expect(String(tileBuyButtonStyle("solid", outlined, { buyButtonTextColor: "#c1121f" }).boxShadow)).toContain("#c1121f");
  });

  it("moves only the frame for lift and tilt, and nothing for none or zoom", () => {
    expect(cardHoverFrameClass("none", "board")).toBe("");
    expect(cardHoverFrameClass("zoom", "board")).toBe("");
    // Every movement sits behind motion-safe, so reduced motion holds still.
    for (const effect of ["lift", "tilt"] as const) {
      const moving = cardHoverFrameClass(effect, "board").split(" ").filter((name) => name.includes("group-"));
      expect(moving.length).toBeGreaterThan(0);
      expect(moving.every((name) => name.startsWith("motion-safe:"))).toBe(true);
    }
    const arrow = tileBuyArrowClass("board").split(" ").filter((name) => name.includes("group-"));
    expect(arrow).toEqual(["motion-safe:group-hover:translate-x-0.5", "motion-safe:group-focus-within:translate-x-0.5"]);
  });

  it("plays on a buyer's pointer and focus, the designer's pointer alone, and nothing mid-gesture", () => {
    const classes = (trigger: "board" | "pointer" | "still") =>
      [
        cardHoverFrameClass("lift", trigger),
        cardHoverFrameClass("tilt", trigger),
        cardHoverZoomClass(trigger),
        hoverPhotoClass(trigger),
        hoverPhotoClass(trigger, true),
        tileBuyArrowClass(trigger),
      ].join(" ");
    expect(classes("board")).toContain("group-hover:");
    expect(classes("board")).toContain("group-focus-within:");
    // A selected designer tile has focus: focus must not hold an effect on.
    expect(classes("pointer")).toContain("group-hover:");
    expect(classes("pointer")).not.toContain("group-focus-within:");
    expect(classes("still")).not.toContain("group-");
    // A sold-out card's second photo comes in faded, as its cover is.
    expect(hoverPhotoClass("board", true)).toContain("group-hover:opacity-60");
    expect(hoverPhotoClass("board", true)).not.toContain("opacity-100");
  });
});

describe("finding a block's own setting", () => {
  const offered = (blocks: StorefrontBlock[]) =>
    editorEntries(blocks, new Map(), english).map((entry) => entry.id).filter((id) => id.startsWith("setting:"));

  it("offers text spacing only while there is text, and blur while there is a block that blurs", () => {
    expect(offered([product])).not.toContain("setting:text-spacing");
    expect(offered([product])).not.toContain("setting:element-blur");
    expect(offered([text])).toEqual(expect.arrayContaining(["setting:text-spacing", "setting:element-blur"]));
    // The card extras are a storefront's, there whatever is on the board.
    expect(offered([])).toEqual(expect.arrayContaining(["setting:card-hover-effect", "setting:card-low-stock"]));
  });

  it("answers the words a seller types with the right one", () => {
    const first = (query: string) =>
      searchEditor(editorEntries([text, product], new Map(), english), query, english)
        .flatMap((section) => section.hits)
        .find((hit) => hit.entry.id.startsWith("setting:"))?.entry.id;
    expect(first("letter spacing")).toBe("setting:text-spacing");
    expect(first("line height")).toBe("setting:text-spacing");
    expect(first("add to cart")).toBe("setting:card-buy-button");
    expect(first("second photo")).toBe("setting:card-second-photo");
    expect(first("low stock")).toBe("setting:card-low-stock");
    expect(first("zoom on hover")).toBe("setting:card-hover-effect");
    expect(first("star rating")).toBe("setting:card-star-rating");
    expect(first("card button text")).toBe("setting:card-buy-button");
    expect(first("card button colour")).toBe("setting:card-buy-button");
  });
});

describe("the card extras through an assistant", () => {
  it("styles one tile and the whole board with them, and saves", () => {
    const { config } = applyDesignOps(configWith([product]), [
      { op: "style", block: ids.product, changes: { hoverEffect: "zoom", buyButton: "outline", showLowStock: true } },
      { op: "theme", changes: { showRating: true, hoverPhoto: true } },
    ]);
    const tile = config.blocks[0];
    expect(tile.type === "product" && tile.style).toEqual({ hoverEffect: "zoom", buyButton: "outline", showLowStock: true });
    expect(config.theme).toMatchObject({ showRating: true, hoverPhoto: true });
    expect(parses(config)).toBe(true);
  });

  it("gives the buy button its own words and colours, and null hands them back to the page", () => {
    const own = { buyButton: "solid", buyButtonLabel: "Grab it", buyButtonColor: "#0b3d2e", buyButtonTextColor: "#ffd166" };
    const { config } = applyDesignOps(configWith([product]), [
      { op: "style", block: ids.product, changes: own },
      { op: "theme", changes: { buyButtonLabel: "Shop" } },
    ]);
    const tile = config.blocks[0];
    expect(tile.type === "product" && tile.style).toEqual(own);
    expect(config.theme.buyButtonLabel).toBe("Shop");
    expect(parses(config)).toBe(true);

    const back = applyDesignOps(config, [
      { op: "style", block: ids.product, changes: { buyButtonLabel: null, buyButtonColor: null } },
    ]).config.blocks[0];
    expect(back.type === "product" && back.style).toEqual({ buyButton: "solid", buyButtonTextColor: "#ffd166" });
    // Words the page's button could not have are refused at save, as on the page.
    const tooLong = applyDesignOps(config, [
      { op: "style", block: ids.product, changes: { buyButtonLabel: "x".repeat(PRODUCT_PAGE_CTA_MAX + 1) } },
    ]).config;
    expect(parses(tooLong)).toBe(false);
  });

  it("adds text with its own spacing", () => {
    const { config } = applyDesignOps(
      configWith([]),
      [{ op: "add_text", text: "Hi", letterSpacing: 8, lineHeight: 160 }],
      () => ids.text,
    );
    expect(config.blocks[0]).toMatchObject({ type: "text", letterSpacing: 8, lineHeight: 160 });
    expect(parses(config)).toBe(true);
  });

  it("shows them in get_schema, generated from the same schema", () => {
    const schema = JSON.stringify(z.toJSONSchema(storefrontConfigSchema, { io: "input", unrepresentable: "any" }));
    for (const field of [
      "hoverEffect",
      "hoverPhoto",
      "buyButton",
      "buyButtonLabel",
      "buyButtonColor",
      "buyButtonTextColor",
      "showRating",
      "showLowStock",
      "letterSpacing",
      "lineHeight",
    ]) {
      expect(schema).toContain(`"${field}"`);
    }
    expect(schema).toContain('"tilt"');
    expect(schema).toContain('"outline"');
  });
});
