import { describe, expect, it } from "vitest";
import {
  CORNER_SPOT_LIMIT,
  DEFAULT_STOREFRONT_CONFIG,
  DEFAULT_TITLE_POSITION,
  HOVER_TRANSITION_MS_DEFAULT,
  PRICE_TAG_FLOAT_POSITIONS,
  PRICE_TAG_POSITIONS,
  PRICE_TAG_RADIUS_DEFAULT,
  PRICE_TAG_SIZE_DEFAULT,
  TILE_SPOTS,
  TITLE_INSET_AUTO,
  autoTitleInset,
  blockCornerRadius,
  defaultPriceTagFill,
  mergeCardStyleOverrides,
  resolveCardStyle,
  resolvePriceTagPosition,
  resolveTitlePosition,
  titleBandRow,
  titleOverlaysImage,
  type PriceTagPosition,
  type ProductBlock,
  type ShapeBlock,
  type SpotRow,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";
import { LAYOUT_PRESET_VALUES } from "@/lib/storefront/layout-presets";
import { priceSpots } from "@/lib/storefront/tile-spots";

/**
 * The per-tile style contract: resolveCardStyle is the ONE place theme card
 * defaults and a block's overrides merge, and blockCornerRadius is the one
 * place a renderer asks "how round is this cell". Every renderer (canvas,
 * preview, tile face) goes through these, so pinning them pins the
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
      // Absent everywhere: the title has never moved off its default spot,
      // and its spacing follows the tile's roundness rather than a number.
      titlePosition: DEFAULT_TITLE_POSITION,
      titleInset: undefined,
      // Absent everywhere resolves to the design system's own speed.
      titleHoverMs: HOVER_TRANSITION_MS_DEFAULT,
      priceDisplay: t.priceDisplay,
      priceTagPosition: t.priceTagPosition,
      priceTagFont: "inter",
      priceTagSize: PRICE_TAG_SIZE_DEFAULT,
      priceTagBorderWidth: 0,
      priceTagRadius: PRICE_TAG_RADIUS_DEFAULT,
      // Auto, same as titleInset: scaled by the tile's roundness, not a number.
      priceTagInset: undefined,
      // The three colors stay absent: "unset" is a state, not a hex.
      priceTagColor: undefined,
      priceTagTextColor: undefined,
      priceTagBorderColor: undefined,
      priceHoverMs: HOVER_TRANSITION_MS_DEFAULT,
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
  const ROUND = CORNER_SPOT_LIMIT;
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
      const at = (cornerRadius: number, band: SpotRow | null) =>
        resolvePriceTagPosition(stored as never, {
          cornerRadius,
          titleBand: band,
        });
      expect(at(0, null)).toBe(plain);
      expect(at(ROUND, null)).toBe(round);
      expect(at(0, "bottom")).toBe(overlaid);
      expect(at(ROUND, "bottom")).toBe(both);
    },
  );

  it("never resolves to a bottom spot while the title covers the bottom", () => {
    for (const position of PRICE_TAG_POSITIONS) {
      const resolved = resolvePriceTagPosition(position, {
        cornerRadius: 0,
        titleBand: "bottom",
      });
      expect(resolved.startsWith("bottom-")).toBe(false);
    }
  });

  it("restores the stored spot when the overlay title is turned off", () => {
    // Coercion is a render-time rule; nothing is written back to the config.
    const stored = "bottom-right" as const;
    expect(
      resolvePriceTagPosition(stored, { cornerRadius: 0, titleBand: "bottom" }),
    ).toBe("top-right");
    expect(
      resolvePriceTagPosition(stored, { cornerRadius: 0, titleBand: null }),
    ).toBe("bottom-right");
  });

  // The title can now hold any row, so "get out of the title's way" has to
  // mean the row the title actually holds — not the bottom by assumption.
  it("moves the tag off whichever row the title band holds", () => {
    const at = (position: PriceTagPosition, titleBand: SpotRow) =>
      resolvePriceTagPosition(position, { cornerRadius: 0, titleBand });
    expect(at("top-left", "top")).toBe("bottom-left");
    expect(at("bottom-left", "top")).toBe("bottom-left");
    expect(at("middle-center", "middle")).toBe("bottom-center");
    expect(at("bottom-right", "bottom")).toBe("top-right");
    // A row the title does not hold is left exactly where it was stored.
    expect(at("top-right", "middle")).toBe("top-right");
    expect(at("bottom-center", "top")).toBe("bottom-center");
  });

  it("leaves every spot alone when no band is drawn", () => {
    // A null band is the whole point of the single-field shape: nothing is
    // over the picture, so nothing has to move out of the way.
    for (const position of PRICE_TAG_POSITIONS) {
      expect(
        resolvePriceTagPosition(position, { cornerRadius: 0, titleBand: null }),
      ).toBe(position);
    }
  });
});

/**
 * WHICH row a band actually takes, which is the question the tag's resolver
 * used to be asked in two pieces and answered wrong.
 *
 * The bug this pins: the `bare` layout is an `overlay` title with `showTitle`
 * off, so the tile paints nothing over the picture — and yet every caller was
 * passing `titleOverlaysImage(titleStyle)`, which said "the bottom is taken"
 * and bounced a price tag off the bottom three spots of its own tile.
 */
describe("titleBandRow", () => {
  const card = {
    titleStyle: "overlay" as const,
    titlePosition: "bottom-left" as const,
    showTitle: true,
    cornerRadius: 0,
  };

  it("names the row an overlaid title holds", () => {
    expect(titleBandRow(card)).toBe("bottom");
    expect(titleBandRow({ ...card, titlePosition: "top-right" })).toBe("top");
    expect(titleBandRow({ ...card, titlePosition: "middle-center" })).toBe(
      "middle",
    );
  });

  it("is null for a bar title, which is a row of its own", () => {
    expect(titleBandRow({ ...card, titleStyle: "bar" })).toBeNull();
  });

  it("is null when the title is not shown at all", () => {
    // The `bare` layout, exactly: nothing is drawn, so nothing is reserved.
    expect(titleBandRow({ ...card, showTitle: false })).toBeNull();
    expect(
      titleBandRow({ ...card, titleStyle: "shadow", showTitle: false }),
    ).toBeNull();
  });

  it("resolves the position first, so it names the row that renders", () => {
    // A stored corner on a round tile renders on the center axis; the ROW is
    // unchanged by that, which is what makes reading it here safe.
    expect(
      titleBandRow({ ...card, cornerRadius: CORNER_SPOT_LIMIT }),
    ).toBe("bottom");
  });
});

/**
 * The `bare` layout end to end: the preset a seller picks, run through the two
 * resolvers a tile actually uses. Every floating spot must survive, because
 * the tile draws nothing but the picture and the chip.
 */
describe("the bare layout's price tag", () => {
  it("keeps all seven spots, the bottom three included", () => {
    const bare = LAYOUT_PRESET_VALUES.bare;
    const band = titleBandRow({ ...bare, cornerRadius: 0 });
    expect(band).toBeNull();
    for (const spot of PRICE_TAG_FLOAT_POSITIONS) {
      expect(
        resolvePriceTagPosition(spot, { cornerRadius: 0, titleBand: band }),
      ).toBe(spot);
    }
    // And the spot list the pickers offer agrees with the resolver.
    expect(priceSpots(0, band)).toEqual([...PRICE_TAG_FLOAT_POSITIONS]);
  });
});

/**
 * The title's own placement rule, the mirror of the tag's. Structural for the
 * same reason: the picker resolves through this too, so the spot shown
 * selected is the spot that renders.
 */
describe("resolveTitlePosition", () => {
  it("drops a middle spot to the bottom for a bar, which has no middle", () => {
    expect(
      resolveTitlePosition("middle-center", {
        titleStyle: "bar",
        cornerRadius: 0,
      }),
    ).toBe("bottom-center");
    for (const titleStyle of ["overlay", "shadow"] as const) {
      expect(
        resolveTitlePosition("middle-center", { titleStyle, cornerRadius: 0 }),
      ).toBe("middle-center");
    }
  });

  it("pulls a corner onto the center axis once the corners are clipped away", () => {
    const at = (cornerRadius: number) =>
      resolveTitlePosition("top-left", { titleStyle: "overlay", cornerRadius });
    expect(at(CORNER_SPOT_LIMIT - 1)).toBe("top-left");
    expect(at(CORNER_SPOT_LIMIT)).toBe("top-center");
  });

  it("leaves every spot alone on a square overlaid tile", () => {
    for (const spot of TILE_SPOTS) {
      expect(
        resolveTitlePosition(spot, { titleStyle: "overlay", cornerRadius: 0 }),
      ).toBe(spot);
    }
  });

  it("restores the stored spot when the roundness is eased back", () => {
    // Storage always keeps the seller's choice; only rendering coerces.
    const stored = "bottom-right" as const;
    const style = { titleStyle: "shadow" } as const;
    expect(resolveTitlePosition(stored, { ...style, cornerRadius: 100 })).toBe(
      "bottom-center",
    );
    expect(resolveTitlePosition(stored, { ...style, cornerRadius: 0 })).toBe(
      "bottom-right",
    );
  });
});

/** The auto edge spacing: what holds the words off a rounded corner when the
 *  seller has set no inset of their own. */
describe("autoTitleInset", () => {
  it("stays flush on a square tile and grows with the clip", () => {
    expect(autoTitleInset(0)).toBe(TITLE_INSET_AUTO.min);
    expect(autoTitleInset(60)).toBe(21);
  });

  it("never pads a small tile's words out of existence", () => {
    // A 3x3 tile at full roundness clips at 300px; the band must not take it.
    expect(autoTitleInset(300)).toBe(TITLE_INSET_AUTO.max);
  });

  it("rises monotonically, so more roundness is never less air", () => {
    let previous = -1;
    for (let radius = 0; radius <= 300; radius += 5) {
      const inset = autoTitleInset(radius);
      expect(inset).toBeGreaterThanOrEqual(previous);
      previous = inset;
    }
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
