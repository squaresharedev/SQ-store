import { describe, expect, it } from "vitest";
import type { CSSProperties } from "react";
import {
  DEFAULT_STOREFRONT_CONFIG,
  tileCovers,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import {
  TILE_COVER_INSET_PX,
  blockTileClipStyle,
} from "@/components/storefront/config-maps";

/**
 * A block layered under a product on the same cells is part of that tile, so
 * nothing of it may show past the card: not its corners when the card is
 * rounder, and not the rim two identical antialiased edges leak. The pixels
 * are checked in the browser (the dev gallery's "Sharp square under a product"
 * cases); these pin the rules that decide them.
 */

const theme: StorefrontTheme = {
  ...DEFAULT_STOREFRONT_CONFIG.theme,
  cornerRadius: 8,
};

/** A 2x2 black square at the origin. Its key is `s_${id}`. */
function square(id: string, extra: Partial<ShapeBlock> = {}): ShapeBlock {
  return {
    type: "shape",
    id,
    kind: "square",
    color: "#000000",
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    ...extra,
  };
}

/** A 2x2 product tile at the origin. Its key is `p_${productId}`. */
function product(productId: string, extra: Partial<ProductBlock> = {}): ProductBlock {
  return { type: "product", productId, x: 0, y: 0, w: 2, h: 2, ...extra };
}

const clipOf = (style: CSSProperties) =>
  (style as Record<string, unknown>)["--tile-cover-clip"];

describe("tileCovers", () => {
  it("covers a block with the product painted above it on the same cells", () => {
    const covers = tileCovers(theme, [square("a", { z: 0 }), product("p", { z: 1 })]);
    expect(covers.get("s_a")).toEqual([{ key: "p_p", cornerRadius: 8 }]);
    // The card on top has nothing over it.
    expect(covers.has("p_p")).toBe(false);
  });

  it("reads the product's own roundness, not the theme's", () => {
    const covers = tileCovers(theme, [
      square("a", { z: 0 }),
      product("p", { z: 1, style: { cornerRadius: 24 } }),
    ]);
    expect(covers.get("s_a")).toEqual([{ key: "p_p", cornerRadius: 24 }]);
  });

  it("covers nothing when the product is BEHIND the block", () => {
    const covers = tileCovers(theme, [square("a", { z: 1 }), product("p", { z: 0 })]);
    expect(covers.size).toBe(0);
  });

  it("needs the same cells and the same tilt", () => {
    expect(
      tileCovers(theme, [square("a", { z: 0 }), product("p", { z: 1, x: 1 })]).size,
    ).toBe(0);
    expect(
      tileCovers(theme, [square("a", { z: 0 }), product("p", { z: 1, w: 3 })]).size,
    ).toBe(0);
    expect(
      tileCovers(theme, [square("a", { z: 0 }), product("p", { z: 1, rotation: 15 })])
        .size,
    ).toBe(0);
    // Turned together, they still share one outline.
    expect(
      tileCovers(theme, [
        square("a", { z: 0, rotation: 15 }),
        product("p", { z: 1, rotation: 15 }),
      ]).size,
    ).toBe(1);
  });

  it("only products cover: a shape on top of a shape is left alone", () => {
    const covers = tileCovers(theme, [square("a", { z: 0 }), square("b", { z: 1 })]);
    expect(covers.size).toBe(0);
  });

  it("lists every product above, and a product under another is covered too", () => {
    const covers = tileCovers(theme, [
      square("a", { z: 0 }),
      product("low", { z: 1 }),
      product("high", { z: 2, style: { cornerRadius: 40 } }),
    ]);
    expect(covers.get("s_a")).toEqual([
      { key: "p_high", cornerRadius: 40 },
      { key: "p_low", cornerRadius: 8 },
    ]);
    expect(covers.get("p_low")).toEqual([{ key: "p_high", cornerRadius: 40 }]);
  });
});

describe("blockTileClipStyle", () => {
  const shape = square("a");
  const placement = { w: 2, h: 2 };

  it("leaves an uncovered block exactly as it was", () => {
    const style = blockTileClipStyle(theme, shape, placement, undefined);
    expect(style.borderRadius).toBe("16px");
    expect(clipOf(style)).toBeUndefined();
  });

  it("takes a rounder cover's corners and pulls its face in past the edge", () => {
    const style = blockTileClipStyle(theme, shape, placement, [
      { key: "p_p", cornerRadius: 24 },
    ]);
    // 24 scaled by the 2-cell span.
    expect(style.borderRadius).toBe("48px");
    expect(clipOf(style)).toBe(
      `inset(${TILE_COVER_INSET_PX}px round ${48 - TILE_COVER_INSET_PX}px)`,
    );
  });

  it("never gets sharper than its own roundness under a sharper card", () => {
    const style = blockTileClipStyle(theme, shape, placement, [
      { key: "p_p", cornerRadius: 0 },
    ]);
    expect(style.borderRadius).toBe("16px");
    // The straight edges still coincide, so the inset still applies.
    expect(clipOf(style)).toBe(
      `inset(${TILE_COVER_INSET_PX}px round ${16 - TILE_COVER_INSET_PX}px)`,
    );
  });

  it("follows the least round of several covers, the one that hides the least", () => {
    const style = blockTileClipStyle(theme, shape, placement, [
      { key: "p_high", cornerRadius: 40 },
      { key: "p_low", cornerRadius: 12 },
    ]);
    expect(style.borderRadius).toBe("24px");
  });

  it("ignores a cover that is being dragged, resized or turned off it", () => {
    const style = blockTileClipStyle(
      theme,
      shape,
      placement,
      [{ key: "p_p", cornerRadius: 24 }],
      new Set(["p_p"]),
    );
    expect(style.borderRadius).toBe("16px");
    expect(clipOf(style)).toBeUndefined();
  });

  it("ignores its cover while the block itself is dragged out from under it", () => {
    const style = blockTileClipStyle(
      theme,
      shape,
      placement,
      [{ key: "p_p", cornerRadius: 24 }],
      new Set(["s_a"]),
    );
    expect(clipOf(style)).toBeUndefined();
  });

  it("stays covered when one group move carries both", () => {
    const style = blockTileClipStyle(
      theme,
      shape,
      placement,
      [{ key: "p_p", cornerRadius: 24 }],
      new Set(["p_p", "s_a"]),
    );
    expect(style.borderRadius).toBe("48px");
    expect(clipOf(style)).toBeDefined();
  });

  it("keeps the covers that are still in place when only one leaves", () => {
    const style = blockTileClipStyle(
      theme,
      shape,
      placement,
      [
        { key: "p_high", cornerRadius: 40 },
        { key: "p_low", cornerRadius: 24 },
      ],
      new Set(["p_low"]),
    );
    expect(style.borderRadius).toBe("80px");
    expect(clipOf(style)).toBeDefined();
  });
});
