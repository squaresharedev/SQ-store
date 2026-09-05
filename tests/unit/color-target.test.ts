import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHAPE_BORDER_COLOR,
  DEFAULT_TEXT_COLOR,
  colorTargetBlockKey,
  colorTargetKey,
  primaryColorTarget,
  resolveColorTarget,
  textBlockThemeColor,
} from "@/lib/theme/color-target";
import {
  DEFAULT_STOREFRONT_CONFIG,
  DEFAULT_STOREFRONT_HEADER,
  blockKey,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontHeader,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";

const STRICT_HEX = /^#[0-9a-f]{6}$/;

function themeWith(over: Partial<StorefrontTheme> = {}): StorefrontTheme {
  return { ...DEFAULT_STOREFRONT_CONFIG.theme, ...over };
}

function headerWith(over: Partial<StorefrontHeader> = {}): StorefrontHeader {
  // name and bio must be non-empty for the resolver to return a result —
  // DEFAULT_STOREFRONT_HEADER now seeds them as "" (SF-02) so the buyer page
  // shows nothing until the seller fills them in, but these tests need visible
  // lines to exercise the colour-resolution logic.
  return { ...DEFAULT_STOREFRONT_HEADER, show: true, name: "Shop", bio: "Hello", ...over };
}

/** The header is only interesting to the two masthead targets, so the rest of
 *  these cases resolve against a default one rather than repeat it. */
function resolve(
  ref: Parameters<typeof resolveColorTarget>[0],
  theme: StorefrontTheme,
  blocks: Parameters<typeof resolveColorTarget>[2],
  header: StorefrontHeader = DEFAULT_STOREFRONT_HEADER,
) {
  return resolveColorTarget(ref, theme, blocks, header);
}

function shape(over: Partial<ShapeBlock> = {}): ShapeBlock {
  return {
    type: "shape",
    id: "00000000-0000-4000-8000-000000000001",
    kind: "circle",
    color: "#123456",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    ...over,
  };
}

function text(over: Partial<TextBlock> = {}): TextBlock {
  return {
    type: "text",
    id: "00000000-0000-4000-8000-000000000002",
    text: "Hello",
    variant: "body",
    align: "left",
    x: 0,
    y: 1,
    w: 1,
    h: 1,
    ...over,
  };
}

const product: ProductBlock = {
  type: "product",
  productId: "00000000-0000-4000-8000-00000000000a",
  x: 2,
  y: 0,
  w: 1,
  h: 1,
};

// ---------------------------------------------------------------------------
// Theme-level targets
// ---------------------------------------------------------------------------

describe("resolveColorTarget: theme colors", () => {
  it("resolves the accent", () => {
    const out = resolve(
      { kind: "theme-accent" },
      themeWith({ accent: "#ff0000" }),
      [],
    );
    expect(out).toEqual({ label: "Accent", value: "#ff0000" });
  });

  it("resolves a solid background", () => {
    const theme = themeWith({ background: { kind: "solid", color: "#abcdef" } });
    expect(resolve({ kind: "theme-background-solid" }, theme, [])).toEqual({
      label: "Background",
      value: "#abcdef",
    });
  });

  it("resolves both gradient stops", () => {
    const theme = themeWith({
      background: { kind: "gradient", from: "#111111", to: "#222222", angle: 160 },
    });
    expect(
      resolve({ kind: "theme-background-from" }, theme, [])?.value,
    ).toBe("#111111");
    expect(
      resolve({ kind: "theme-background-to" }, theme, [])?.value,
    ).toBe("#222222");
  });

  it("resolves the masthead's two lines, each with its own inherit", () => {
    const theme = themeWith({ accent: "#ff0000" });
    const header = headerWith({ name: "Shop", bio: "Hello" });

    // No override: the name follows the accent, the bio the default ink, and
    // both say so, so the panel can offer "back to the theme".
    expect(resolve({ kind: "header-name" }, theme, [], header)).toEqual({
      label: "Store name",
      value: "#ff0000",
      inherit: { label: "Theme color", value: "#ff0000", active: true },
    });
    expect(resolve({ kind: "header-bio" }, theme, [], header)).toEqual({
      label: "Bio",
      value: DEFAULT_TEXT_COLOR,
      inherit: { label: "Theme color", value: DEFAULT_TEXT_COLOR, active: true },
    });

    // With overrides, the value is the override and inheriting is no longer
    // the active state — but the swatch still points at the theme's color.
    const colored = headerWith({ nameColor: "#0000ff", bioColor: "#00ff00" });
    const name = resolve({ kind: "header-name" }, theme, [], colored);
    expect(name?.value).toBe("#0000ff");
    expect(name?.inherit).toEqual({
      label: "Theme color",
      value: "#ff0000",
      active: false,
    });
    expect(resolve({ kind: "header-bio" }, theme, [], colored)?.value).toBe(
      "#00ff00",
    );
  });

  it("stops resolving a masthead line that is not on screen", () => {
    const theme = themeWith();
    // Hidden header, and a shown header with an empty line: in both cases the
    // panel would be editing something nobody can see, so it closes instead.
    const hidden = headerWith({ show: false });
    expect(resolve({ kind: "header-name" }, theme, [], hidden)).toBeNull();
    expect(resolve({ kind: "header-bio" }, theme, [], hidden)).toBeNull();

    const noBio = headerWith({ name: "Shop", bio: "   " });
    expect(resolve({ kind: "header-name" }, theme, [], noBio)).not.toBeNull();
    expect(resolve({ kind: "header-bio" }, theme, [], noBio)).toBeNull();
  });

  it("re-gates masthead colors read back out of a stored config", () => {
    // Configs are parsed from a jsonb column and these land in a style
    // attribute, so a value that is not strict hex must not travel.
    const header = headerWith({
      nameColor: "red; background:url(x)" as string,
      bioColor: "#FFF" as string,
    });
    const theme = themeWith({ accent: "#123456" });
    expect(resolve({ kind: "header-name" }, theme, [], header)?.value).toMatch(
      STRICT_HEX,
    );
    expect(resolve({ kind: "header-bio" }, theme, [], header)?.value).toBe(
      DEFAULT_TEXT_COLOR,
    );
  });

  it("a solid target does NOT resolve against a gradient background", () => {
    const theme = themeWith({
      background: { kind: "gradient", from: "#111111", to: "#222222", angle: 160 },
    });
    expect(resolve({ kind: "theme-background-solid" }, theme, [])).toBeNull();
  });

  it("gradient targets do NOT resolve against an image background", () => {
    // The panel must close rather than edit a color the background has no slot
    // for — this is the case that would otherwise strand it.
    const theme = themeWith({
      background: { kind: "image", key: "storefronts/a.jpg", x: 50, y: 50, scale: 100 },
    });
    expect(resolve({ kind: "theme-background-from" }, theme, [])).toBeNull();
    expect(resolve({ kind: "theme-background-to" }, theme, [])).toBeNull();
    expect(resolve({ kind: "theme-background-solid" }, theme, [])).toBeNull();
  });

  it("the accent still resolves under an image background", () => {
    const theme = themeWith({
      accent: "#00ff00",
      background: { kind: "image", key: "storefronts/a.jpg", x: 50, y: 50, scale: 100 },
    });
    expect(resolve({ kind: "theme-accent" }, theme, [])?.value).toBe(
      "#00ff00",
    );
  });
});

// ---------------------------------------------------------------------------
// Block targets
// ---------------------------------------------------------------------------

describe("resolveColorTarget: block colors", () => {
  it("resolves a shape fill", () => {
    const block = shape({ color: "#aa0000" });
    const out = resolve(
      { kind: "shape-fill", blockKey: blockKey(block) },
      themeWith(),
      [block],
    );
    expect(out).toEqual({ label: "Fill", value: "#aa0000" });
  });

  it("calls a ring's fill 'Color' — a ring has no fill to speak of", () => {
    const block = shape({ kind: "ring", color: "#aa0000" });
    expect(
      resolve(
        { kind: "shape-fill", blockKey: blockKey(block) },
        themeWith(),
        [block],
      )?.label,
    ).toBe("Color");
  });

  it("resolves a shape border, falling back when none is stored", () => {
    const block = shape();
    expect(
      resolve(
        { kind: "shape-border", blockKey: blockKey(block) },
        themeWith(),
        [block],
      ),
    ).toEqual({ label: "Border color", value: DEFAULT_SHAPE_BORDER_COLOR });
  });

  it("a shape border offers NO inherit — clearing it yields a browser default", () => {
    const block = shape({ borderColor: "#00ff00" });
    const out = resolve(
      { kind: "shape-border", blockKey: blockKey(block) },
      themeWith(),
      [block],
    );
    expect(out?.inherit).toBeUndefined();
  });

  it("resolves a text color override", () => {
    const block = text({ color: "#0000aa" });
    expect(
      resolve(
        { kind: "text-color", blockKey: blockKey(block) },
        themeWith(),
        [block],
      )?.value,
    ).toBe("#0000aa");
  });

  it("a text block with no override follows the theme, and says so", () => {
    const block = text();
    const out = resolve(
      { kind: "text-color", blockKey: blockKey(block) },
      themeWith({ accent: "#ff0000" }),
      [block],
    );
    expect(out?.value).toBe(DEFAULT_TEXT_COLOR);
    expect(out?.inherit).toEqual({
      label: "Theme color",
      value: DEFAULT_TEXT_COLOR,
      active: true,
    });
  });

  it("a heading with no override follows the ACCENT", () => {
    const block = text({ variant: "heading" });
    const out = resolve(
      { kind: "text-color", blockKey: blockKey(block) },
      themeWith({ accent: "#ff0000" }),
      [block],
    );
    expect(out?.value).toBe("#ff0000");
    expect(out?.inherit?.active).toBe(true);
  });

  it("inherit is inactive once an override is stored", () => {
    const block = text({ color: "#0000aa" });
    expect(
      resolve(
        { kind: "text-color", blockKey: blockKey(block) },
        themeWith(),
        [block],
      )?.inherit?.active,
    ).toBe(false);
  });

  it("returns null when the block is gone — deleted, or undone away", () => {
    expect(
      resolve({ kind: "shape-fill", blockKey: "s_missing" }, themeWith(), []),
    ).toBeNull();
  });

  it("returns null when the block is there but the wrong type", () => {
    const block = text();
    expect(
      resolve(
        { kind: "shape-fill", blockKey: blockKey(block) },
        themeWith(),
        [block],
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The price tag: the one target that resolves against either scope
// ---------------------------------------------------------------------------

describe("resolveColorTarget: the price tag", () => {
  it("resolves the theme's own colors when no block is named", () => {
    const theme = themeWith({
      accent: "#ff0000",
      priceTagColor: "#00ff00",
      // Floated, so an unset fill would be the card backing rather than none.
      priceTagPosition: "top-right",
    });
    const fill = resolve({ kind: "price-tag", part: "fill" }, theme, []);
    expect(fill).toEqual({
      label: "Tag color",
      value: "#00ff00",
      inherit: { label: "Card color", value: "#ffffff", active: false },
    });
    // Unset: the dot shows what the tag really renders in, and reads active.
    const text = resolve({ kind: "price-tag", part: "text" }, theme, []);
    expect(text).toMatchObject({
      value: "#ff0000",
      inherit: { value: "#ff0000", active: true },
    });
  });

  it("resolves a tile's override, showing the theme while untouched", () => {
    const theme = themeWith({ priceTagColor: "#00ff00" });
    const key = blockKey(product);
    // No override: the panel shows the theme's value, but as an OVERRIDE it is
    // still unset, so the inherit dot is active.
    expect(
      resolve({ kind: "price-tag", part: "fill", blockKey: key }, theme, [product]),
    ).toMatchObject({
      value: "#00ff00",
      inherit: { label: "Theme color", value: "#00ff00", active: true },
    });

    const styled = { ...product, style: { priceTagColor: "#0000ff" } };
    expect(
      resolve({ kind: "price-tag", part: "fill", blockKey: key }, theme, [styled]),
    ).toMatchObject({ value: "#0000ff", inherit: { active: false } });
  });

  it("says No fill for an info-bar tag, which really has none", () => {
    // defaultPriceTagFill is transparent there, and a dot cannot depict that.
    const below = resolve(
      { kind: "price-tag", part: "fill" },
      themeWith({ priceTagPosition: "below" }),
      [],
    );
    expect(below!.inherit).toMatchObject({ label: "No fill", value: "#ffffff" });
  });

  it("follows white, not the accent, for an unbacked price on a shadow title", () => {
    const out = resolve(
      { kind: "price-tag", part: "text" },
      themeWith({ accent: "#ff0000", titleStyle: "shadow", priceTagPosition: "below" }),
      [],
    );
    expect(out!.inherit!.value).toBe("#ffffff");
  });

  it("stops resolving when the named block is gone", () => {
    // Deleted or undone away: the panel closes rather than editing nothing.
    expect(
      resolve({ kind: "price-tag", part: "fill", blockKey: "p_gone" }, themeWith(), []),
    ).toBeNull();
    // A block of the wrong type never carries a price tag either.
    const s = shape();
    expect(
      resolve(
        { kind: "price-tag", part: "fill", blockKey: blockKey(s) },
        themeWith(),
        [s],
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The strict-hex contract
// ---------------------------------------------------------------------------

describe("resolveColorTarget: hex gating", () => {
  it("falls back rather than passing a malformed stored color through", () => {
    // Configs are validated on save but read back out of jsonb; a bad value
    // must not reach a style attribute.
    const block = shape({ color: "not-a-color" });
    const out = resolve(
      { kind: "shape-fill", blockKey: blockKey(block) },
      themeWith({ accent: "rgba(0,0,0,0.5)" }),
      [block],
    );
    expect(out!.value).toMatch(STRICT_HEX);
    expect(
      resolve({ kind: "theme-accent" }, themeWith({ accent: "#fff" }), [])!
        .value,
    ).toMatch(STRICT_HEX);
  });

  it("lowercases an uppercase stored color", () => {
    expect(
      resolve({ kind: "theme-accent" }, themeWith({ accent: "#ABCDEF" }), [])
        ?.value,
    ).toBe("#abcdef");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("color target helpers", () => {
  it("textBlockThemeColor splits headings from body", () => {
    expect(textBlockThemeColor("#ff0000", { variant: "heading" })).toBe("#ff0000");
    expect(textBlockThemeColor("#ff0000", { variant: "body" })).toBe(DEFAULT_TEXT_COLOR);
  });

  it("colorTargetBlockKey handles the price tag's OPTIONAL block key", () => {
    // `"blockKey" in ref` is true for a price tag ref even when the key holds
    // undefined, which is what made a bare `in` check wrong here.
    expect(colorTargetBlockKey({ kind: "price-tag", part: "fill" })).toBeNull();
    expect(
      colorTargetBlockKey({ kind: "price-tag", part: "fill", blockKey: "p_1" }),
    ).toBe("p_1");
  });

  it("colorTargetKey separates fields that share a kind and a block", () => {
    // The panel remounts on this, so its working HSV starts from the color
    // actually being edited. The tag's three colors share a kind and a block.
    const keys = (["fill", "text", "border"] as const).map((part) =>
      colorTargetKey({ kind: "price-tag", part, blockKey: "p_1" }),
    );
    expect(new Set(keys).size).toBe(3);
    // Theme scope and tile scope are different fields too.
    expect(colorTargetKey({ kind: "price-tag", part: "fill" })).not.toBe(keys[0]);
    // And the pre-existing kinds keep a stable identity of their own.
    expect(colorTargetKey({ kind: "theme-accent" })).not.toBe(
      colorTargetKey({ kind: "theme-background-solid" }),
    );
  });

  it("colorTargetBlockKey names the block, or null for theme colors", () => {
    expect(colorTargetBlockKey({ kind: "shape-fill", blockKey: "s_1" })).toBe("s_1");
    expect(colorTargetBlockKey({ kind: "theme-accent" })).toBeNull();
  });

  it("a shape opens on its fill and a text block on its color", () => {
    const s = shape();
    const t = text();
    expect(primaryColorTarget(s)).toEqual({
      kind: "shape-fill",
      blockKey: blockKey(s),
    });
    expect(primaryColorTarget(t)).toEqual({
      kind: "text-color",
      blockKey: blockKey(t),
    });
  });

  it("a product tile opens nothing — it has no color of its own", () => {
    expect(primaryColorTarget(product)).toBeNull();
  });
});
