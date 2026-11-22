import { describe, expect, it } from "vitest";
import { resolveInk } from "@/components/product-page/product-page-maps";
import {
  boardInk,
  derivePalette,
  paletteInk,
  paletteInkStyle,
  recolourPalette,
  recolourPaletteIn,
  recolourThemePalette,
  TEXT_CONTRAST_AA,
} from "@/lib/storefront/palette";
import {
  TEXT_VALIGN_CLASSES,
  textStyleColor,
  textStyleSpacing,
  textStyleWeightClass,
  withTextStyle,
} from "@/lib/storefront/text-styles";
import { contrastRatio } from "@/lib/format/color";
import { paletteSwatches, PALETTE_SLOT_ORDER } from "@/lib/theme/palette-swatches";
import { textBlockThemeColor } from "@/lib/theme/color-target";
import {
  DEFAULT_STOREFRONT_CONFIG,
  PALETTE_SLOTS,
  newStorefrontConfig,
  type StorefrontPalette,
  type StorefrontTheme,
} from "@/types/storefront";

const theme = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({ ...DEFAULT_STOREFRONT_CONFIG.theme, ...over });
const PALETTE: StorefrontPalette = {
  background: "#f3eee6",
  text: "#1f1b16",
  accent: "#9a3412",
  surface: "#ffffff",
  muted: "#e6dccd",
};

describe("the board's ink", () => {
  it("is the automatic ink, exactly as before, without a stored palette", () => {
    const plain = theme({ background: { kind: "solid", color: "#111111" } });
    expect(paletteInk(plain)).toBeUndefined();
    expect(boardInk(plain)).toBe(resolveInk(plain));
    expect(paletteInkStyle(plain)).toEqual({});
  });

  it("is the palette's Text colour when it reads on the background", () => {
    const stored = theme({ palette: PALETTE, background: { kind: "solid", color: PALETTE.background } });
    expect(contrastRatio(PALETTE.text, PALETTE.background)).toBeGreaterThanOrEqual(TEXT_CONTRAST_AA);
    expect(boardInk(stored)).toBe(PALETTE.text);
    expect(paletteInkStyle(stored)).toEqual({ color: PALETTE.text });
  });

  it("falls back to the automatic ink when the Text colour would not read", () => {
    const dark = theme({ palette: PALETTE, background: { kind: "solid", color: "#1c2321" } });
    expect(paletteInk(dark)).toBeUndefined();
    expect(boardInk(dark)).toBe(resolveInk(dark));
  });
});

describe("recolouring", () => {
  it("runs through everything the designer's state holds, pages and unknown members too", () => {
    const state = {
      theme: theme({ palette: PALETTE, accent: PALETTE.accent }),
      blocks: [{ type: "shape", color: PALETTE.accent }],
      productPage: { starColor: PALETTE.accent },
      // A member this module has never heard of (a band, say) follows the
      // naming rule and is recoloured with it.
      bands: [{ background: { kind: "solid", color: PALETTE.accent } }],
    };
    const next = recolourPaletteIn(state, "accent", "#0f766e");
    expect(next.theme.accent).toBe("#0f766e");
    expect(next.blocks[0].color).toBe("#0f766e");
    expect(next.productPage.starColor).toBe("#0f766e");
    expect(next.bands[0].background.color).toBe("#0f766e");
  });

  it("changes nothing but the stored palette when the colour is the same", () => {
    const config = newStorefrontConfig();
    const next = recolourPalette(config, "surface", config.theme.palette!.surface);
    expect(next.blocks).toBe(config.blocks);
    expect(next.theme.palette).toEqual(config.theme.palette);
  });

  it("turns a derived palette into a stored one on the first change", () => {
    const legacy = theme({ accent: "#7c2d12" });
    const next = recolourThemePalette(legacy, "accent", "#123456");
    expect(next.palette).toEqual({ ...derivePalette(legacy), accent: "#123456" });
    expect(next.accent).toBe("#123456");
  });
});

describe("the palette as swatches", () => {
  it("is the five slots in order, each named", () => {
    expect(PALETTE_SLOT_ORDER).toEqual([...PALETTE_SLOTS]);
    expect(paletteSwatches(PALETTE).map((swatch) => swatch.value)).toEqual(PALETTE_SLOTS.map((slot) => PALETTE[slot]));
  });

  it("shows a colour two slots share once, under the first slot's name", () => {
    const shared = paletteSwatches({ ...PALETTE, accent: PALETTE.text });
    expect(shared).toHaveLength(4);
    expect(shared[1]).toMatchObject({ value: PALETTE.text, name: "EditorType.panel.palette.slots.text.name" });
  });
});

describe("saved text styles, resolved for a block", () => {
  it("keeps middle as the class every text block has always had", () => {
    expect(TEXT_VALIGN_CLASSES.middle).toBe("justify-center");
    expect(TEXT_VALIGN_CLASSES.top).toBe("justify-start");
    expect(TEXT_VALIGN_CLASSES.bottom).toBe("justify-end");
  });

  it("adds no weight, spacing or colour of its own when nothing is saved", () => {
    expect(textStyleWeightClass(undefined)).toBeUndefined();
    expect(textStyleSpacing({}, undefined)).toEqual({ letterSpacing: undefined, lineHeight: undefined });
    expect(textStyleColor(theme({ accent: "#7c2d12" }), "heading")).toBe("#7c2d12");
    expect(textStyleColor(theme(), "body")).toBeUndefined();
  });

  it("lets a style's own values through, and a block's own over them", () => {
    const saved = { bold: false, letterSpacing: 12, lineHeight: 160, color: "#9a3412" };
    const styled = theme({ textStyles: { label: saved } });
    expect(textStyleWeightClass(saved)).toBe("font-normal");
    expect(textStyleWeightClass({ bold: true })).toBe("font-bold");
    expect(textStyleSpacing({ letterSpacing: 4 }, saved)).toEqual({ letterSpacing: 4, lineHeight: 160 });
    expect(textStyleColor(styled, "label")).toBe("#9a3412");
    expect(textBlockThemeColor("#000000", { variant: "label" }, styled.textStyles)).toBe("#9a3412");
  });

  it("stores nothing for a style put back to its defaults", () => {
    expect(withTextStyle(undefined, "heading", { size: 24, font: "heading" })).toBeUndefined();
    expect(withTextStyle({ label: { uppercase: true } }, "label", { uppercase: undefined })).toBeUndefined();
    expect(withTextStyle({ body: { lineHeight: 160 } }, "heading", { size: 40 })).toEqual({
      body: { lineHeight: 160 },
      heading: { size: 40 },
    });
  });
});
