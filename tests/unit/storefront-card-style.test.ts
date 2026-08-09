import { describe, expect, it } from "vitest";
import {
  DEFAULT_STOREFRONT_CONFIG,
  blockCornerRadius,
  mergeCardStyleOverrides,
  resolveCardStyle,
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
      priceTagStyle: t.priceTagStyle,
      priceTagSize: "md",
    });
  });

  it("applies only the overridden fields; the rest keep following the theme", () => {
    const t = theme({ cornerRadius: 0, titleStyle: "bar", priceTagStyle: "plain" });
    const card = resolveCardStyle(t, { cornerRadius: 100, priceTagStyle: "pill" });
    expect(card.cornerRadius).toBe(100);
    expect(card.priceTagStyle).toBe("pill");
    expect(card.titleStyle).toBe("bar");
    expect(card.showTitle).toBe(t.showTitle);
  });

  it("boolean overrides win even when false (showTitle off for one tile)", () => {
    const card = resolveCardStyle(theme({ showTitle: true }), { showTitle: false });
    expect(card.showTitle).toBe(false);
  });

  it("defaults priceTagSize to md when neither theme nor override set it", () => {
    const legacy = theme();
    delete legacy.priceTagSize;
    expect(resolveCardStyle(legacy).priceTagSize).toBe("md");
    expect(resolveCardStyle(legacy, { priceTagSize: "lg" }).priceTagSize).toBe("lg");
  });

  it("never lets an explicit undefined shadow a theme value", () => {
    const card = resolveCardStyle(theme({ cornerRadius: 40 }), {
      cornerRadius: undefined,
    });
    expect(card.cornerRadius).toBe(40);
  });
});

describe("mergeCardStyleOverrides", () => {
  it("accumulates patches field by field", () => {
    const first = mergeCardStyleOverrides(undefined, { cornerRadius: 100 });
    expect(first).toEqual({ cornerRadius: 100 });
    expect(
      mergeCardStyleOverrides(first, { priceTagStyle: "pill" }),
    ).toEqual({ cornerRadius: 100, priceTagStyle: "pill" });
  });

  it("clears a single field via an undefined patch value", () => {
    expect(
      mergeCardStyleOverrides(
        { cornerRadius: 100, priceTagStyle: "pill" },
        { cornerRadius: undefined },
      ),
    ).toEqual({ priceTagStyle: "pill" });
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
      blockCornerRadius(t, productBlock({ style: { priceTagStyle: "pill" } })),
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
