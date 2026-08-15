import { describe, it, expect } from "vitest";
import { collectStorefrontColors } from "@/lib/theme/palette";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type ShapeBlock,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";

const STRICT_HEX = /^#[0-9a-f]{6}$/;

function themeWith(over: Partial<StorefrontTheme> = {}): StorefrontTheme {
  return { ...DEFAULT_STOREFRONT_CONFIG.theme, ...over };
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

// ---------------------------------------------------------------------------
// collectStorefrontColors — what the canvas is actually wearing
// ---------------------------------------------------------------------------

describe("collectStorefrontColors", () => {
  it("includes the theme accent", () => {
    expect(collectStorefrontColors(themeWith({ accent: "#ff0000" }), [])).toContain(
      "#ff0000",
    );
  });

  it("includes a solid background color", () => {
    const theme = themeWith({ background: { kind: "solid", color: "#abcdef" } });
    expect(collectStorefrontColors(theme, [])).toContain("#abcdef");
  });

  it("includes both gradient stops", () => {
    const theme = themeWith({
      background: { kind: "gradient", from: "#111111", to: "#222222", angle: 160 },
    });
    const colors = collectStorefrontColors(theme, []);
    expect(colors).toContain("#111111");
    expect(colors).toContain("#222222");
  });

  it("an image background contributes nothing — it holds a key, not a hex", () => {
    const theme = themeWith({
      accent: "#ff0000",
      background: { kind: "image", key: "storefronts/a.jpg", x: 50, y: 50, scale: 100 },
    });
    expect(collectStorefrontColors(theme, [])).toEqual(["#ff0000"]);
  });

  it("includes a shape fill and its border color", () => {
    const colors = collectStorefrontColors(themeWith(), [
      shape({ color: "#aa0000", borderColor: "#00aa00" }),
    ]);
    expect(colors).toContain("#aa0000");
    expect(colors).toContain("#00aa00");
  });

  it("includes a text block's color override", () => {
    expect(
      collectStorefrontColors(themeWith(), [text({ color: "#0000aa" })]),
    ).toContain("#0000aa");
  });

  it("a text block with no override contributes nothing", () => {
    const bare = collectStorefrontColors(themeWith(), []);
    expect(collectStorefrontColors(themeWith(), [text()])).toEqual(bare);
  });

  it("product blocks contribute nothing — they follow the theme", () => {
    const bare = collectStorefrontColors(themeWith(), []);
    const withProduct = collectStorefrontColors(themeWith(), [
      {
        type: "product",
        productId: "00000000-0000-4000-8000-00000000000a",
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      },
    ]);
    expect(withProduct).toEqual(bare);
  });

  it("includes the masthead's colors, and nothing when it inherits", () => {
    const header = {
      show: true,
      name: "Shop",
      bio: "Hello",
      nameColor: "#aa0000",
      bioColor: "#00aa00",
    };
    const colors = collectStorefrontColors(themeWith(), [], header);
    expect(colors).toContain("#aa0000");
    expect(colors).toContain("#00aa00");

    // Inheriting adds nothing new: the accent is already in the list.
    const bare = collectStorefrontColors(themeWith(), []);
    expect(
      collectStorefrontColors(themeWith(), [], {
        show: true,
        name: "Shop",
        bio: "Hello",
      }),
    ).toEqual(bare);
  });

  it("deduplicates a color used in more than one place", () => {
    const colors = collectStorefrontColors(themeWith({ accent: "#abcdef" }), [
      shape({ color: "#abcdef" }),
    ]);
    expect(colors.filter((c) => c === "#abcdef")).toHaveLength(1);
  });

  it("normalises to lowercase", () => {
    expect(collectStorefrontColors(themeWith({ accent: "#ABCDEF" }), [])).toContain(
      "#abcdef",
    );
  });

  it("drops anything that is not strict 6-digit hex", () => {
    // Configs are schema-validated on save, but they come back out of a jsonb
    // column — the gate is what keeps a bad row out of a style attribute.
    const theme = themeWith({ accent: "rgba(0,0,0,0.5)" });
    const colors = collectStorefrontColors(theme, [shape({ color: "#fff" })]);
    expect(colors).not.toContain("rgba(0,0,0,0.5)");
    expect(colors).not.toContain("#fff");
    colors.forEach((c) => expect(c).toMatch(STRICT_HEX));
  });

  it("orders theme before blocks, and blocks in array order", () => {
    const theme = themeWith({
      accent: "#aaaaaa",
      background: { kind: "solid", color: "#bbbbbb" },
    });
    const colors = collectStorefrontColors(theme, [
      shape({ color: "#cccccc" }),
      shape({ id: "00000000-0000-4000-8000-000000000003", color: "#dddddd" }),
    ]);
    expect(colors).toEqual(["#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd"]);
  });
});
