import { describe, expect, it } from "vitest";
import {
  DEFAULT_STOREFRONT_CONFIG,
  PRICE_TAG_POSITIONS,
  PRICE_TAG_RADIUS_DEFAULT,
  PRICE_TAG_SIZE_DEFAULT,
  blockCornerRadius,
  defaultPriceTagFill,
  mergeCardStyleOverrides,
  resolveCardStyle,
  resolvePriceTagPosition,
  titleOverlaysImage,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";

/**
 * The per-tile style contract: resolveCardStyle is the ONE place theme card
 * defaults and a block's overrides merge, and blockCornerRadius is the one
 * place a renderer asks "how round is this cell". Every renderer (canvas,
 * preview, carousel, tile face) goes through these, so pinning them pins the
 * feature's semantics: absent override = follow the theme, present override =
 * that field only.
 */

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function theme(over: Partial<StorefrontTheme> = {}): StorefrontTheme {
  return { ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme), ...over };
}

function productBlock(over: Partial<ProductBlock> = {}): ProductBlock {
  return { type: "product", productId: UUID, x: 0, y: 0, w: 1, h: 1, ...over };
}

describe("resolveCardStyle", () => {
  it("returns the theme's card fields when there are no overrides", () => {
    const t = theme({ cornerRadius: 12, titleStyle: "overlay" });
    expect(resolveCardStyle(t)).toEqual({
      cornerRadius: 12,
      showTitle: t.showTitle,
      titleStyle: "overlay",
      titleDisplay: t.titleDisplay,
      priceDisplay: t.priceDisplay,
      priceTagPosition: t.priceTagPosition,
      priceTagFont: "inter",
      priceTagSize: PRICE_TAG_SIZE_DEFAULT,
      priceTagBorderWidth: 0,
      priceTagRadius: PRICE_TAG_RADIUS_DEFAULT,
      // The three colors stay absent: "unset" is a state, not a hex.
      priceTagColor: undefined,
      priceTagTextColor: undefined,
      priceTagBorderColor: undefined,
    });
  });

  it("applies only the overridden fields; the rest keep following the theme", () => {
    const t = theme({ cornerRadius: 0, titleStyle: "bar", priceTagRadius: 2 });
    const card = resolveCardStyle(t, { cornerRadius: 100, priceTagRadius: 24 });
    expect(card.cornerRadius).toBe(100);
    expect(card.priceTagRadius).toBe(24);
    expect(card.titleStyle).toBe("bar");
    expect(card.showTitle).toBe(t.showTitle);
  });

  it("boolean overrides win even when false (showTitle off for one tile)", () => {
    const card = resolveCardStyle(theme({ showTitle: true }), { showTitle: false });
    expect(card.showTitle).toBe(false);
  });

  it("defaults every price tag field when neither theme nor override sets it", () => {
    // A config saved before any of these existed: absent everywhere.
    const legacy = theme();
    const card = resolveCardStyle(legacy);
    expect(card.priceTagFont).toBe("inter");
    expect(card.priceTagSize).toBe(PRICE_TAG_SIZE_DEFAULT);
    expect(card.priceTagBorderWidth).toBe(0);
    expect(card.priceTagRadius).toBe(PRICE_TAG_RADIUS_DEFAULT);
    expect(resolveCardStyle(legacy, { priceTagSize: 20 }).priceTagSize).toBe(20);
    expect(resolveCardStyle(legacy, { priceTagFont: "mono" }).priceTagFont).toBe("mono");
  });

  it("a tile override wins over a theme value for every price tag field", () => {
    const t = theme({
      priceTagFont: "serif",
      priceTagSize: 10,
      priceTagColor: "#111111",
      priceTagTextColor: "#222222",
      priceTagBorderColor: "#333333",
      priceTagBorderWidth: 1,
      priceTagRadius: 4,
    });
    const card = resolveCardStyle(t, {
      priceTagFont: "mono",
      priceTagSize: 24,
      priceTagColor: "#aaaaaa",
      priceTagTextColor: "#bbbbbb",
      priceTagBorderColor: "#cccccc",
      priceTagBorderWidth: 8,
      priceTagRadius: 24,
    });
    expect(card).toMatchObject({
      priceTagFont: "mono",
      priceTagSize: 24,
      priceTagColor: "#aaaaaa",
      priceTagTextColor: "#bbbbbb",
      priceTagBorderColor: "#cccccc",
      priceTagBorderWidth: 8,
      priceTagRadius: 24,
    });
    // And a tile that overrides nothing still reads the theme's values.
    expect(resolveCardStyle(t)).toMatchObject({
      priceTagFont: "serif",
      priceTagSize: 10,
      priceTagColor: "#111111",
    });
  });

  it("a zero override wins over a non-zero theme value", () => {
    // The one case a `||` merge would get wrong: 0 is a real thickness.
    const card = resolveCardStyle(theme({ priceTagBorderWidth: 4 }), {
      priceTagBorderWidth: 0,
    });
    expect(card.priceTagBorderWidth).toBe(0);
  });

  it("never lets an explicit undefined shadow a theme value", () => {
    const card = resolveCardStyle(theme({ cornerRadius: 40 }), {
      cornerRadius: undefined,
    });
    expect(card.cornerRadius).toBe(40);
  });
});

/**
 * The collision rule. Two structural facts can take a price tag spot away, and
 * this is the only place either is decided — the renderer and the spot picker
 * both call it, which is what keeps the designer honest about where a tag will
 * actually land. The table below IS the contract.
 */
describe("resolvePriceTagPosition", () => {
  const ROUND = 32; // PRICE_TAG_CORNER_LIMIT
  // stored -> [plain, round, overlaid, round + overlaid]
  const TABLE: Record<string, [string, string, string, string]> = {
    below: ["below", "below", "below", "below"],
    hidden: ["hidden", "hidden", "hidden", "hidden"],
    "top-left": ["top-left", "top-center", "top-left", "top-center"],
    "top-center": ["top-center", "top-center", "top-center", "top-center"],
    "top-right": ["top-right", "top-center", "top-right", "top-center"],
    "middle-center": [
      "middle-center",
      "middle-center",
      "middle-center",
      "middle-center",
    ],
    "bottom-left": ["bottom-left", "bottom-center", "top-left", "top-center"],
    "bottom-center": ["bottom-center", "bottom-center", "top-center", "top-center"],
    "bottom-right": ["bottom-right", "bottom-center", "top-right", "top-center"],
  };

  it("covers every stored position", () => {
    // A position added later without a row here would go untested silently.
    expect(Object.keys(TABLE).sort()).toEqual([...PRICE_TAG_POSITIONS].sort());
  });

  it.each(Object.entries(TABLE))(
    "%s resolves per the table",
    (stored, [plain, round, overlaid, both]) => {
      const at = (cornerRadius: number, overlay: boolean) =>
        resolvePriceTagPosition(stored as never, {
          cornerRadius,
          titleOverlaysImage: overlay,
        });
      expect(at(0, false)).toBe(plain);
      expect(at(ROUND, false)).toBe(round);
      expect(at(0, true)).toBe(overlaid);
      expect(at(ROUND, true)).toBe(both);
    },
  );

  it("never resolves to a bottom spot while the title covers the bottom", () => {
    for (const position of PRICE_TAG_POSITIONS) {
      const resolved = resolvePriceTagPosition(position, {
        cornerRadius: 0,
        titleOverlaysImage: true,
      });
      expect(resolved.startsWith("bottom-")).toBe(false);
    }
  });

  it("restores the stored spot when the overlay title is turned off", () => {
    // Coercion is a render-time rule; nothing is written back to the config.
    const stored = "bottom-right" as const;
    expect(
      resolvePriceTagPosition(stored, { cornerRadius: 0, titleOverlaysImage: true }),
    ).toBe("top-right");
    expect(
      resolvePriceTagPosition(stored, { cornerRadius: 0, titleOverlaysImage: false }),
    ).toBe("bottom-right");
  });
});

describe("titleOverlaysImage", () => {
  it("is true for the two styles drawn over the image, false for the bar", () => {
    expect(titleOverlaysImage("overlay")).toBe(true);
    expect(titleOverlaysImage("shadow")).toBe(true);
    expect(titleOverlaysImage("bar")).toBe(false);
  });
});

describe("defaultPriceTagFill", () => {
  it("backs a floated tag and leaves an info-bar price unboxed", () => {
    expect(defaultPriceTagFill("below")).toBe("transparent");
    for (const position of PRICE_TAG_POSITIONS) {
      if (position === "below") continue;
      expect(defaultPriceTagFill(position)).toBe("#ffffff");
    }
  });
});

describe("mergeCardStyleOverrides", () => {
  it("accumulates patches field by field", () => {
    const first = mergeCardStyleOverrides(undefined, { cornerRadius: 100 });
    expect(first).toEqual({ cornerRadius: 100 });
    expect(
      mergeCardStyleOverrides(first, { priceTagRadius: 24 }),
    ).toEqual({ cornerRadius: 100, priceTagRadius: 24 });
  });

  it("clears a single field via an undefined patch value", () => {
    expect(
      mergeCardStyleOverrides(
        { cornerRadius: 100, priceTagRadius: 24 },
        { cornerRadius: undefined },
      ),
    ).toEqual({ priceTagRadius: 24 });
  });

  it("collapses to undefined when the last override is cleared", () => {
    expect(
      mergeCardStyleOverrides({ cornerRadius: 100 }, { cornerRadius: undefined }),
    ).toBeUndefined();
    // A fully-reverted tile must serialize WITHOUT a style key at all, so it
    // round-trips identically to a block never customized.
  });
});

describe("blockCornerRadius", () => {
  it("uses a product block's override when present, the theme otherwise", () => {
    const t = theme({ cornerRadius: 8 });
    expect(blockCornerRadius(t, productBlock())).toBe(8);
    expect(
      blockCornerRadius(t, productBlock({ style: { cornerRadius: 100 } })),
    ).toBe(100);
    // A style object without cornerRadius still follows the theme's radius.
    expect(
      blockCornerRadius(t, productBlock({ style: { priceTagRadius: 24 } })),
    ).toBe(8);
  });

  it("keeps text and shape blocks on the theme radius", () => {
    const t = theme({ cornerRadius: 24 });
    const text: TextBlock = {
      type: "text",
      id: UUID,
      text: "hi",
      variant: "body",
      align: "left",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    };
    const shape: ShapeBlock = {
      type: "shape",
      id: UUID,
      kind: "circle",
      color: "#171717",
      x: 1,
      y: 0,
      w: 1,
      h: 1,
    };
    expect(blockCornerRadius(t, text)).toBe(24);
    expect(blockCornerRadius(t, shape)).toBe(24);
  });
});
