import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/format/color";
import {
  BLEND_MAX_CONTRAST_WITH_WHITE,
  LEGACY_CARD_SURFACE,
  blendsInto,
  cardPaint,
  photoShapeStyle,
} from "@/components/storefront/card-look";
import {
  TILE_LABEL_READABLE_PX,
  blockShadowStyle,
  blockTileClipStyle,
  shadowFilter,
  tileBuyButtonPaint,
  tileLabelSize,
} from "@/components/storefront/config-maps";
import {
  cardLookColorField,
  cardLookColorPatch,
  isCardLookColorKind,
  themeWithCardLookColor,
} from "@/lib/storefront/card-look-fields";
import {
  DEFAULT_STOREFRONT_CONFIG,
  PRICE_TAG_SIZE_MIN,
  TILE_TITLE_SIZE,
  TILE_TITLE_SIZE_MIN,
  resolveCardStyle,
  type CardStyleOverrides,
  type ImageBlock,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontTheme,
} from "@/types/storefront";

/**
 * THE CARD LOOK, AS RULES (Photo cards, editor upgrade): what a card paints
 * itself in (card-look), the shadow presets on the cell (config-maps), the
 * readable floor on the tile labels, and the colour fields the pickers show
 * (card-look-fields).
 */

const theme = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({
  ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme),
  ...over,
});
const paint = (over: Partial<StorefrontTheme> = {}, style?: CardStyleOverrides, edge?: "white" | "other") =>
  cardPaint(resolveCardStyle(theme(over), style), edge);

describe("a card with none of the card look", () => {
  it("paints nothing of its own, so its old classes stand", () => {
    expect(paint()).toEqual({ stripBackdrop: LEGACY_CARD_SURFACE, blend: false, blendHover: false });
    // Even with a measured edge: nothing asked for a blend.
    expect(paint({}, undefined, "white")).toEqual({ stripBackdrop: LEGACY_CARD_SURFACE, blend: false, blendHover: false });
  });

  it("keeps a seller's own shadow shade exactly", () => {
    expect(paint({ titleStyle: "shadow", titleShadowColor: "#1e3a8a" }).shade).toBe("#1e3a8a");
  });
});

describe("the card's colour", () => {
  it("paints the photo frame, the strip and the buy row, with an ink that reads on the strip", () => {
    const light = paint({ cardColor: "#f4efe6" });
    expect(light).toMatchObject({ frame: "#f4efe6", strip: "#f4efe6", foot: "#f4efe6", ink: "#171717" });
    expect(light.overlayStrip).toBe("#f4efe6e6");
    const dark = paint({ cardColor: "#1c1917" });
    expect(dark.ink).toBe("#ffffff");
    expect(contrastRatio(dark.ink!, "#1c1917")).toBeGreaterThanOrEqual(4.5);
  });

  it("lets the strip have its own colour, and the name its own, held to a floor", () => {
    expect(paint({ cardColor: "#ffffff", titleBarColor: "#14532d" })).toMatchObject({ strip: "#14532d", ink: "#ffffff" });
    // A chosen ink that reads is drawn as chosen; one that vanishes is not.
    expect(paint({ titleBarColor: "#14532d", titleTextColor: "#fde68a" }).ink).toBe("#fde68a");
    expect(paint({ titleBarColor: "#14532d", titleTextColor: "#166534" }).ink).toBe("#ffffff");
  });

  it("frames a shaped photo in the card's white rather than the old grey gap", () => {
    expect(paint({ photoShape: "circle" }).frame).toBe(LEGACY_CARD_SURFACE);
    expect(paint({ photoShape: "rectangle" }).frame).toBeUndefined();
  });
});

describe("blending a white background", () => {
  it("is off unless asked for", () => {
    expect(paint({ cardColor: "#f4efe6" }, undefined, "white").blend).toBe(false);
  });

  it("on auto, blends only a photo measured white, never one it could not measure", () => {
    expect(paint({ cardColor: "#f4efe6", whiteBlend: "auto" }, undefined, "white").blend).toBe(true);
    expect(paint({ cardColor: "#f4efe6", whiteBlend: "auto" }, undefined, "other").blend).toBe(false);
    expect(paint({ cardColor: "#f4efe6", whiteBlend: "auto" }).blend).toBe(false);
  });

  it("on on, blends every photo, the second photo too", () => {
    expect(paint({ cardColor: "#f4efe6", whiteBlend: "on" })).toMatchObject({ blend: true, blendHover: true });
    // Auto measured the cover, never the second photo.
    expect(paint({ cardColor: "#f4efe6", whiteBlend: "auto" }, undefined, "white").blendHover).toBe(false);
  });

  it("follows the card's own override over the theme", () => {
    expect(paint({ cardColor: "#f4efe6", whiteBlend: "auto" }, { whiteBlend: "off" }, "white").blend).toBe(false);
    expect(paint({ cardColor: "#f4efe6" }, { whiteBlend: "on" }).blend).toBe(true);
  });

  it("never blends into a dark card, which would darken the product with it", () => {
    expect(blendsInto("#f4efe6")).toBe(true);
    expect(blendsInto("#fecaca")).toBe(true);
    expect(blendsInto("#1c1917")).toBe(false);
    expect(blendsInto("#737373")).toBe(false);
    expect(contrastRatio("#737373", "#ffffff")).toBeGreaterThan(BLEND_MAX_CONTRAST_WITH_WHITE);
    expect(paint({ cardColor: "#1c1917", whiteBlend: "on" }).blend).toBe(false);
  });

  it("blends into the old grey frame when the card has no colour", () => {
    expect(paint({ whiteBlend: "on" }).blend).toBe(true);
  });
});

describe("FIX: a shadow title over a white photo", () => {
  it("fades pale, in the colour the photo's edge is drawn in, so the name reads", () => {
    // Unblended: the photo keeps its white.
    expect(paint({ titleStyle: "shadow" }, undefined, "white").shade).toBe("#ffffff");
    // Blended: the edge is the card's colour now.
    expect(paint({ titleStyle: "shadow", cardColor: "#f4efe6", whiteBlend: "auto" }, undefined, "white").shade).toBe("#f4efe6");
    // A seller's dark shade turns too: dark over white is the muddy case.
    expect(paint({ titleStyle: "shadow", titleShadowColor: "#1e3a8a" }, undefined, "white").shade).toBe("#ffffff");
  });

  it("leaves a photo that is not white, or not measured, as it always was", () => {
    expect(paint({ titleStyle: "shadow" }, undefined, "other").shade).toBeUndefined();
    expect(paint({ titleStyle: "shadow" }).shade).toBeUndefined();
  });

  it("keeps a pale shade a seller already chose", () => {
    expect(paint({ titleStyle: "shadow", titleShadowColor: "#fef3c7" }, undefined, "white").shade).toBe("#fef3c7");
  });

  it("holds a chosen name colour to a floor against the fade", () => {
    const shaded = paint({ titleStyle: "shadow", titleTextColor: "#f5f5f5" }, undefined, "white");
    expect(shaded.shadeInk).toBe("#171717");
  });
});

describe("photo shapes", () => {
  it("draws nothing for no shape and for the card's own corners", () => {
    expect(photoShapeStyle(undefined, "card")).toEqual({});
    expect(photoShapeStyle("rectangle", "block")).toEqual({});
  });

  it("cuts the picture with a clip, never by resizing it", () => {
    expect(photoShapeStyle("rounded", "card").clipPath).toMatch(/^inset\(6cqmin round 12cqmin\)$/);
    expect(photoShapeStyle("arch", "card").clipPath).toBe("inset(6cqmin round 9999px 9999px 0 0)");
    expect(photoShapeStyle("arch", "block").clipPath).toBe("inset(0px round 9999px 9999px 0 0)");
    const circle = photoShapeStyle("circle", "card");
    expect(circle.maskImage).toContain("radial-gradient(circle closest-side");
    expect(circle.WebkitMaskImage).toBe(circle.maskImage);
    // An image block is rounded by a share of the grid's cell, like the blur.
    expect(photoShapeStyle("rounded", "block").clipPath).toContain("var(--ss-cell)");
  });
});

const PRODUCT: ProductBlock = { type: "product", productId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", x: 0, y: 0, w: 1, h: 1 };
const IMAGE: ImageBlock = { type: "image", id: "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc", key: "elements/a/b-c.png", alt: "", x: 0, y: 0, w: 1, h: 1 };
const SHAPE: ShapeBlock = { type: "shape", id: "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb", kind: "star", color: "#fbbf24", x: 0, y: 0, w: 1, h: 1 };

describe("shadows", () => {
  it("are drop shadows measured in grid cells, and none is nothing", () => {
    expect(shadowFilter("none")).toBeUndefined();
    expect(shadowFilter("soft")).toMatch(/^drop-shadow\(0 calc\(.*var\(--ss-cell\).*\) rgb\(0 0 0 \/ [\d.]+\)\)$/);
    expect(shadowFilter("lifted")!.match(/drop-shadow\(/g)).toHaveLength(2);
  });

  it("ride on the cell, for a card from its style and for an image or a shape from its own", () => {
    expect(blockShadowStyle(theme(), PRODUCT)).toEqual({});
    expect(blockShadowStyle(theme({ shadow: "soft" }), PRODUCT)).toEqual({ filter: shadowFilter("soft") });
    expect(blockShadowStyle(theme({ shadow: "soft" }), { ...PRODUCT, style: { shadow: "none" } })).toEqual({});
    expect(blockShadowStyle(theme(), { ...IMAGE, shadow: "lifted" })).toEqual({ filter: shadowFilter("lifted") });
    expect(blockShadowStyle(theme(), { ...SHAPE, shadow: "soft" })).toEqual({ filter: shadowFilter("soft") });
    // A theme's card shadow is the cards', never the shapes'.
    expect(blockShadowStyle(theme({ shadow: "soft" }), SHAPE)).toEqual({});
    expect(blockTileClipStyle(theme(), { ...SHAPE, shadow: "soft" }, { w: 1, h: 1 }, undefined)).toMatchObject({
      filter: shadowFilter("soft"),
      borderRadius: "0px",
    });
  });
});

describe("FIX: the tile labels never go under a readable size", () => {
  it("floors the price and the name, on a tile and on a cell-sized board", () => {
    for (const scale of ["tile", "cell"] as const) {
      expect(tileLabelSize(10, PRICE_TAG_SIZE_MIN, scale)).toMatch(new RegExp(`^clamp\\(${TILE_LABEL_READABLE_PX}px, `));
    }
    expect(tileLabelSize(TILE_TITLE_SIZE, TILE_TITLE_SIZE_MIN)).toMatch(new RegExp(`^clamp\\(${TILE_LABEL_READABLE_PX}px, `));
  });

  it("leaves a big authored size its own, higher floor", () => {
    expect(tileLabelSize(24, PRICE_TAG_SIZE_MIN)).toMatch(/^clamp\(18px, /);
  });
});

describe("the buy button on a coloured card", () => {
  const cta = { fill: "#fde68a", text: "#171717", borderColor: "#fde68a", borderWidth: 0, radius: 4 } as Parameters<typeof tileBuyButtonPaint>[1];

  it("keeps an outline's words readable on the card's own colour", () => {
    // Pale yellow words would vanish on white and read on a dark card.
    expect(tileBuyButtonPaint("outline", cta).color).not.toBe("#fde68a");
    expect(tileBuyButtonPaint("outline", cta, {}, "#1c1917").color).toBe("#fde68a");
  });
});

describe("the card look's colour fields", () => {
  it("names its three kinds and nothing else", () => {
    expect(isCardLookColorKind("card-color")).toBe(true);
    expect(isCardLookColorKind("title-text-color")).toBe(true);
    expect(isCardLookColorKind("title-shadow")).toBe(false);
  });

  it("on the theme, unset follows what cards were before: white, the card, a readable ink", () => {
    const t = theme();
    expect(cardLookColorField(t, undefined, "card-color")).toMatchObject({ value: "#ffffff", inherit: { active: true, value: "#ffffff" } });
    const coloured = theme({ cardColor: "#14532d" });
    expect(cardLookColorField(coloured, undefined, "title-bar-color")).toMatchObject({ value: "#14532d", inherit: { active: true } });
    expect(cardLookColorField(coloured, undefined, "title-text-color")).toMatchObject({ value: "#ffffff", inherit: { active: true } });
    expect(cardLookColorField(coloured, undefined, "card-color")).toMatchObject({ value: "#14532d", inherit: { active: false, value: "#ffffff" } });
  });

  it("on a tile, unset follows the theme, and its own colour wins", () => {
    const t = theme({ cardColor: "#14532d" });
    expect(cardLookColorField(t, {}, "card-color")).toMatchObject({
      value: "#14532d",
      inherit: { label: "Storefront.colors.inherit.themeColor.label", value: "#14532d", active: true },
    });
    expect(cardLookColorField(t, { cardColor: "#fef3c7" }, "card-color")).toMatchObject({ value: "#fef3c7", inherit: { active: false, value: "#14532d" } });
  });

  it("writes a tile's patch, and drops a cleared key from the theme", () => {
    expect(cardLookColorPatch("title-bar-color", "#000000")).toEqual({ titleBarColor: "#000000" });
    const set = themeWithCardLookColor(theme(), "card-color", "#fef3c7");
    expect(set.cardColor).toBe("#fef3c7");
    expect(themeWithCardLookColor(set, "card-color", undefined)).toEqual(theme());
    expect(themeWithCardLookColor(set, "card-color", undefined)).not.toHaveProperty("cardColor");
  });
});
