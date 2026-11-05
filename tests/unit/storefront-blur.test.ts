import { describe, it, expect } from "vitest";
import {
  BLUR_DIRECTIONS,
  BLUR_MAX,
  DEFAULT_STOREFRONT_CONFIG,
  resolveCardStyle,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import {
  blockBlurStyle,
  blurRadius,
  blockBlurCopyStyles,
  photoBlurStyle,
  titleShadowBlurStyle,
} from "@/components/storefront/config-maps";
import { storefrontConfigSchema } from "@/lib/validation/storefront";
import { applyDesignOps } from "@/lib/storefront/design-ops";

/**
 * Blur, wherever a seller can set it: a shape, an element or a text block as a
 * whole, a product's photo, and the shadow fade behind a product's name. What
 * these pin: one bounded 0..BLUR_MAX amount everywhere, sharp when absent, a
 * radius measured against the grid cell rather than in pixels, and the card
 * blurs layering theme -> tile like every other card style.
 */

const ids = {
  text: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  shape: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  image: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  product: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

const text: StorefrontBlock = {
  type: "text",
  id: ids.text,
  text: "Hello",
  variant: "body",
  align: "left",
  x: 0,
  y: 0,
  w: 2,
  h: 1,
};
const shape: StorefrontBlock = {
  type: "shape",
  id: ids.shape,
  kind: "circle",
  color: "#171717",
  x: 2,
  y: 0,
  w: 1,
  h: 1,
};
const image: StorefrontBlock = {
  type: "image",
  id: ids.image,
  key: "elements/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/ffffffff-ffff-4fff-8fff-ffffffffffff-logo.png",
  alt: "",
  x: 3,
  y: 0,
  w: 1,
  h: 1,
};
const product: StorefrontBlock = {
  type: "product",
  productId: ids.product,
  x: 4,
  y: 0,
  w: 1,
  h: 1,
};

function configWith(
  blocks: StorefrontBlock[],
  theme: Partial<StorefrontTheme> = {},
): StorefrontConfig {
  const base = structuredClone(DEFAULT_STOREFRONT_CONFIG);
  return { ...base, theme: { ...base.theme, ...theme }, blocks };
}

describe("blur in the schema", () => {
  it("accepts 0..BLUR_MAX on every block that can blur, and on the card", () => {
    const config = configWith(
      [
        { ...text, blur: 0 },
        { ...shape, blur: BLUR_MAX },
        { ...image, blur: 35 },
        { ...product, style: { titleShadowBlur: 20, photoBlur: 0 } },
      ],
      { titleShadowBlur: 40, photoBlur: 10 },
    );
    expect(storefrontConfigSchema.safeParse(config).error?.issues).toBeUndefined();
  });

  it("accepts every blur direction and nothing else", () => {
    for (const direction of BLUR_DIRECTIONS) {
      const config = configWith(
        [{ ...shape, blur: 20, blurDirection: direction }, { ...product, style: { photoBlurDirection: direction } }],
        { photoBlurDirection: direction },
      );
      expect(storefrontConfigSchema.safeParse(config).error?.issues).toBeUndefined();
    }
    expect(
      storefrontConfigSchema.safeParse(configWith([{ ...text, blurDirection: "diagonal" } as unknown as StorefrontBlock]))
        .success,
    ).toBe(false);
  });

  it("refuses an amount out of range or not whole", () => {
    for (const bad of [-1, BLUR_MAX + 1, 2.5]) {
      expect(storefrontConfigSchema.safeParse(configWith([{ ...shape, blur: bad }])).success).toBe(false);
      expect(storefrontConfigSchema.safeParse(configWith([], { photoBlur: bad })).success).toBe(false);
      expect(
        storefrontConfigSchema.safeParse(configWith([{ ...product, style: { titleShadowBlur: bad } }])).success,
      ).toBe(false);
    }
  });

  it("keeps a product block from carrying a blur of its own", () => {
    // A product's blur is its PHOTO's, a card style; a stray block-level one
    // would be a second, unrendered copy.
    expect(
      storefrontConfigSchema.safeParse(configWith([{ ...product, blur: 10 } as StorefrontBlock])).success,
    ).toBe(false);
  });
});

describe("card blur resolution", () => {
  const theme = (over: Partial<StorefrontTheme> = {}) => ({
    ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme),
    ...over,
  });

  it("is sharp when nobody set one, and runs all over", () => {
    const card = resolveCardStyle(theme());
    expect(card.titleShadowBlur).toBe(0);
    expect(card.photoBlur).toBe(0);
    expect(card.photoBlurDirection).toBe("all");
  });

  it("lets a tile run its photo blur its own way", () => {
    const fromTop = theme({ photoBlurDirection: "top" });
    expect(resolveCardStyle(fromTop).photoBlurDirection).toBe("top");
    expect(resolveCardStyle(fromTop, { photoBlurDirection: "all" }).photoBlurDirection).toBe("all");
  });

  it("follows the theme, and a tile's own value wins, 0 included", () => {
    const blurred = theme({ titleShadowBlur: 40, photoBlur: 25 });
    expect(resolveCardStyle(blurred).photoBlur).toBe(25);
    expect(resolveCardStyle(blurred, { photoBlur: 0 }).photoBlur).toBe(0);
    expect(resolveCardStyle(blurred, { titleShadowBlur: 60 }).titleShadowBlur).toBe(60);
  });
});

describe("blur drawing", () => {
  it("measures the radius against one grid cell, not in pixels", () => {
    expect(blurRadius(BLUR_MAX)).toContain("var(--ss-cell)");
    // The top of the slider is a fifth of a cell...
    expect(blurRadius(BLUR_MAX)).toMatch(/\* 0\.2\)$/);
    // ...reached on an eased curve, so the low end gets the finer steps.
    const share = (amount: number) => Number(/\* ([\d.]+)\)$/.exec(blurRadius(amount))![1]);
    expect(share(50)).toBeLessThan(share(BLUR_MAX) / 2);
    expect(share(25)).toBeLessThan(share(50));
    expect(share(5)).toBeGreaterThan(0);
  });

  it("puts no filter on a sharp block, or on any product", () => {
    expect(blockBlurStyle(shape)).toEqual({});
    expect(blockBlurStyle({ ...shape, blur: 0 })).toEqual({});
    expect(blockBlurStyle(product)).toEqual({});
  });

  it("blurs a shape, an element and a text block as a whole", () => {
    for (const block of [shape, image, text]) {
      const style = blockBlurStyle({ ...block, blur: 30 } as StorefrontBlock);
      expect(style.filter).toBe(`blur(${blurRadius(30)})`);
    }
  });

  it("blurs a product photo from behind, in both spellings", () => {
    const style = photoBlurStyle(20, "all");
    expect(style.backdropFilter).toBe(`blur(${blurRadius(20)})`);
    expect(style.WebkitBackdropFilter).toBe(style.backdropFilter);
    // All over is the whole layer: nothing fades it.
    expect(style.maskImage).toBeUndefined();
  });

  it("fades a photo's blur out from the edge it runs from", () => {
    expect(photoBlurStyle(20, "bottom").maskImage).toBe("linear-gradient(to top, #000, transparent)");
    expect(photoBlurStyle(20, "left").maskImage).toBe("linear-gradient(to right, #000, transparent)");
    expect(photoBlurStyle(20, "top").WebkitMaskImage).toBe("linear-gradient(to bottom, #000, transparent)");
  });

  it("draws a block blurred all over as one filtered face, with no copies", () => {
    const style = blockBlurStyle({ ...shape, blur: 40 } as StorefrontBlock);
    expect(style.maskImage).toBeUndefined();
    expect(blockBlurCopyStyles({ ...shape, blur: 40 } as StorefrontBlock)).toEqual([]);
    expect(blockBlurCopyStyles({ ...shape, blur: 40, blurDirection: "all" } as StorefrontBlock)).toEqual([]);
  });

  it("draws a block blurred from one edge as full, half and no blur, cross-faded", () => {
    const block = { ...shape, blur: 40, blurDirection: "bottom" } as StorefrontBlock;
    const radius = blurRadius(40);
    const face = blockBlurStyle(block);
    const [half, sharp] = blockBlurCopyStyles(block);
    // Full blur on the face, half on the first copy, none on the second.
    expect(face.filter).toBe(`blur(${radius})`);
    expect(half.filter).toBe(`blur(calc(${radius} / 2))`);
    expect(sharp.filter).toBeUndefined();
    // Each runs from the soft edge (the bottom here), its spill let past the tile.
    for (const layer of [face, half, sharp]) {
      expect(layer.maskImage?.startsWith("linear-gradient(to top, ")).toBe(true);
      expect(layer.maskClip).toBe("no-clip");
    }
    // Full fades out by the middle, half peaks there, sharp takes over after it.
    expect(face.maskImage).toMatch(/#000 calc\(.* \* 0\), transparent calc\(.* \* 0\.5\)\)$/);
    expect(half.maskImage).toMatch(/transparent calc\(.* \* 0\), #000 calc\(.* \* 0\.5\), transparent calc\(.* \* 1\)\)$/);
    expect(sharp.maskImage).toMatch(/transparent calc\(.* \* 0\.5\), #000 calc\(.* \* 1\)\)$/);
    // The copies are ADDED to what is under them, so the three sum to the block
    // whatever it is made of (text is see-through between its letters).
    expect(half.mixBlendMode).toBe("plus-lighter");
    expect(sharp.mixBlendMode).toBe("plus-lighter");
  });

  it("gives a sharp block and a product no copies", () => {
    expect(blockBlurCopyStyles({ ...shape, blurDirection: "left" } as StorefrontBlock)).toEqual([]);
    expect(blockBlurCopyStyles(product)).toEqual([]);
  });

  it("fades the shadow's frost away from the edge the words sit on", () => {
    expect(titleShadowBlurStyle("bottom", 30).maskImage).toMatch(/^linear-gradient\(to top, #000/);
    expect(titleShadowBlurStyle("top", 30).maskImage).toMatch(/^linear-gradient\(to bottom, #000/);
    expect(titleShadowBlurStyle("middle", 30).maskImage).toMatch(/transparent\)$/);
    expect(titleShadowBlurStyle("bottom", 30).backdropFilter).toBe(`blur(${blurRadius(30)})`);
  });
});

describe("blur through an assistant", () => {
  it("adds a blurred shape and blurs a text block with a style change", () => {
    const { config } = applyDesignOps(
      configWith([text]),
      [
        { op: "add_shape", kind: "circle", blur: 30, blurDirection: "left" },
        { op: "style", block: ids.text, changes: { blur: 15 } },
      ],
      () => ids.shape,
    );
    const added = config.blocks.find((b) => b.type === "shape");
    const restyled = config.blocks.find((b) => b.type === "text");
    expect(added && "blur" in added && added.blur).toBe(30);
    expect(added && "blurDirection" in added && added.blurDirection).toBe("left");
    expect(restyled && "blur" in restyled && restyled.blur).toBe(15);
    expect(storefrontConfigSchema.safeParse(config).success).toBe(true);
  });

  it("sets a product tile's photo and shadow blur as its own style", () => {
    const { config } = applyDesignOps(configWith([product]), [
      { op: "style", block: ids.product, changes: { photoBlur: 20, titleShadowBlur: 45 } },
    ]);
    const tile = config.blocks[0];
    expect(tile.type === "product" && tile.style).toEqual({ photoBlur: 20, titleShadowBlur: 45 });
  });
});
