import { describe, it, expect } from "vitest";
import {
  DEFAULT_STOREFRONT_CONFIG,
  DEFAULT_STOREFRONT_HEADER,
  PRICE_TAG_SHADOW_TEXT,
  resolveCardStyle,
  type ProductBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import {
  priceTagAutoTextColor,
  resolveColorTarget,
} from "@/lib/theme/color-target";
import {
  titleShadowBackdrop,
  titleShadowInk,
  titleShadowStyle,
} from "@/components/storefront/config-maps";
import { storefrontConfigSchema } from "@/lib/validation/storefront";

/**
 * The `shadow` title style (the Gallery layout's fade) takes a seller-chosen
 * tint. What these pin: an unset color renders exactly the black gradient it
 * always did, the words and an unfilled price stay readable on a light tint,
 * and the color layers theme -> tile like the price tag's colors.
 */

function themeWith(over: Partial<StorefrontTheme> = {}): StorefrontTheme {
  return { ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme), ...over };
}

const product: ProductBlock = {
  type: "product",
  productId: "00000000-0000-4000-8000-00000000000a",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

describe("titleShadowStyle", () => {
  it("renders the original black alphas when no color is set", () => {
    expect(titleShadowStyle("bottom", undefined).backgroundImage).toBe(
      "linear-gradient(to top, #000000b3, #00000059, #00000000)",
    );
    expect(titleShadowStyle("top", undefined).backgroundImage).toBe(
      "linear-gradient(to bottom, #000000b3, #00000059, #00000000)",
    );
    expect(titleShadowStyle("middle", undefined).backgroundImage).toBe(
      "linear-gradient(to bottom, #00000000, #0000008c, #00000000)",
    );
  });

  it("tints the gradient with the seller's color", () => {
    expect(titleShadowStyle("bottom", "#1E3A8A").backgroundImage).toBe(
      "linear-gradient(to top, #1e3a8ab3, #1e3a8a59, #1e3a8a00)",
    );
  });

  it("never lets a malformed stored value into the style attribute", () => {
    expect(
      titleShadowStyle("bottom", "red;background:url(x)").backgroundImage,
    ).toBe("linear-gradient(to top, #000000b3, #00000059, #00000000)");
  });
});

describe("shadow ink and backdrop", () => {
  it("keeps white words on a dark shade and flips to dark on a light one", () => {
    expect(titleShadowInk(undefined)).toBe("#ffffff");
    expect(titleShadowInk("#1e3a8a")).toBe("#ffffff");
    expect(titleShadowInk("#fde68a")).toBe("#171717");
  });

  it("keeps the legibility backdrop at #3d3d3d for the default black", () => {
    expect(titleShadowBackdrop(undefined)).toBe("#3d3d3d");
    expect(titleShadowBackdrop("#ffffff")).toBe("#f0f0f0");
  });

  it("an unbacked price on a light shade follows dark ink, not white", () => {
    const base = { titleStyle: "shadow", priceTagPosition: "below" } as const;
    expect(
      priceTagAutoTextColor(resolveCardStyle(themeWith(base)), "#ff0000"),
    ).toBe(PRICE_TAG_SHADOW_TEXT);
    expect(
      priceTagAutoTextColor(
        resolveCardStyle(themeWith({ ...base, titleShadowColor: "#ffffff" })),
        "#ff0000",
      ),
    ).toBe("#171717");
  });
});

describe("resolveColorTarget: title-shadow", () => {
  const resolve = (
    ref: Parameters<typeof resolveColorTarget>[0],
    theme: StorefrontTheme,
    blocks: Parameters<typeof resolveColorTarget>[2],
  ) => resolveColorTarget(ref, theme, blocks, DEFAULT_STOREFRONT_HEADER);

  it("resolves the theme's own tint, defaulting to black", () => {
    expect(resolve({ kind: "title-shadow" }, themeWith(), [])).toEqual({
      label: "Shadow color",
      value: "#000000",
      inherit: { label: "Default", value: "#000000", active: true },
    });
  });

  it("a tile follows the theme's tint until it sets its own", () => {
    const theme = themeWith({ titleShadowColor: "#123456" });
    const key = `p_${product.productId}`;
    expect(
      resolve({ kind: "title-shadow", blockKey: key }, theme, [product]),
    ).toMatchObject({
      value: "#123456",
      inherit: { label: "Theme color", value: "#123456", active: true },
    });
    const styled = { ...product, style: { titleShadowColor: "#abcdef" } };
    expect(
      resolve({ kind: "title-shadow", blockKey: key }, theme, [styled]),
    ).toMatchObject({ value: "#abcdef", inherit: { active: false } });
  });

  it("stops resolving when the named block is gone", () => {
    expect(
      resolve({ kind: "title-shadow", blockKey: "p_gone" }, themeWith(), []),
    ).toBeNull();
  });
});

describe("validation", () => {
  function parse(themeOver: object, styleOver?: object) {
    const config = structuredClone(DEFAULT_STOREFRONT_CONFIG);
    Object.assign(config.theme, themeOver);
    if (styleOver) {
      config.blocks = [{ ...product, style: styleOver } as ProductBlock];
    }
    return storefrontConfigSchema.safeParse(config).success;
  }

  it("accepts a strict hex on the theme and on a tile override", () => {
    expect(parse({})).toBe(true);
    expect(parse({ titleShadowColor: "#1e3a8a" })).toBe(true);
    expect(parse({}, { titleShadowColor: "#fde68a" })).toBe(true);
  });

  it("rejects anything that is not strict 6-digit hex", () => {
    for (const bad of ["red", "#fff", "rgba(0,0,0,.5)"]) {
      expect(parse({ titleShadowColor: bad })).toBe(false);
      expect(parse({}, { titleShadowColor: bad })).toBe(false);
    }
  });
});
