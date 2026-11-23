import { describe, expect, it } from "vitest";
import { carouselBlockSchema, parseStoredStorefrontConfig, storefrontConfigSchema } from "@/lib/validation/storefront";
import { backdropHex, bandBehind } from "@/lib/storefront/backdrop";
import {
  DEFAULT_STOREFRONT_CONFIG,
  NEW_STOREFRONT_THEME,
  blockFine,
  blockKey,
  boardProductIds,
  newStorefrontConfig,
  resolveCardStyle,
  type StorefrontBlock,
  type StorefrontConfig,
} from "@/types/storefront";

// THE EDITOR UPGRADE'S CONTRACT (types/storefront.ts, EDITOR UPGRADE CONTRACT).
// Two promises are pinned here. The first is the hard one: a storefront saved
// before the upgrade parses to EXACTLY what it was, so nothing live on a
// seller's website can change. The second is that every new member is bounded.

const PRODUCT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_PRODUCT = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const TEXT = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
const SHAPE = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
const IMAGE = "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc";
const BAND = "ffffffff-aaaa-4bbb-8ccc-dddddddddddd";
const BUTTON = "11111111-2222-4333-8444-555555555555";
const MARQUEE = "22222222-3333-4444-8555-666666666666";
const CAROUSEL = "33333333-4444-4555-8666-777777777777";
const ELSEWHERE = "44444444-5555-4666-8777-888888888888";

/** A carousel block: two products, one of them on no tile. */
function carousel(): Extract<StorefrontBlock, { type: "carousel" }> {
  return { type: "carousel", id: CAROUSEL, productIds: [ELSEWHERE, PRODUCT], x: 0, y: 6, w: 6, h: 2 };
}

/** A storefront as one was stored before the upgrade: every kind of block,
 *  a gradient, a styled tile, a masthead, and none of the new members. */
function legacyConfig(): StorefrontConfig {
  return structuredClone({
    theme: {
      ...DEFAULT_STOREFRONT_CONFIG.theme,
      background: { kind: "gradient", from: "#fef3c7", to: "#f97316", angle: 135 },
      accent: "#7c2d12",
      font: "serif",
      columns: 6,
      rows: 8,
      cornerRadius: 16,
      titleStyle: "shadow",
      chipScale: "cell",
      hoverEffect: "lift",
    },
    blocks: [
      { type: "product", productId: PRODUCT, x: 0, y: 0, w: 2, h: 2, style: { cornerRadius: 40, priceTagPosition: "top-right" } },
      { type: "text", id: TEXT, text: "New in", variant: "heading", align: "left", x: 2, y: 0, w: 2, h: 1, color: "#7c2d12" },
      { type: "shape", id: SHAPE, kind: "circle", color: "#fbbf24", x: 4, y: 0, w: 1, h: 1, opacity: 80 },
      { type: "image", id: IMAGE, key: `elements/${PRODUCT}/${IMAGE}-logo.svg`, alt: "Logo", x: 5, y: 0, w: 1, h: 1 },
    ],
    header: { show: true, name: "Fireside", bio: "Things for long evenings", nameColor: "#7c2d12" },
    embed: { enabled: true, domains: ["example.com"] },
  } as StorefrontConfig);
}

/** The same storefront wearing every new member at once. */
function upgradedConfig(): StorefrontConfig {
  const config = legacyConfig();
  return {
    ...config,
    theme: {
      ...config.theme,
      background: { kind: "gradient", from: "#fef3c7", via: "#fbbf24", to: "#f97316", angle: 135 },
      palette: { background: "#fef3c7", text: "#1c1917", accent: "#7c2d12", surface: "#ffffff", muted: "#e7e1d8" },
      fontPairing: "editorial",
      textStyles: { heading: { font: "heading", size: 40, uppercase: true, color: "#7c2d12" }, label: { letterSpacing: 8 } },
      motion: "lively",
      texture: "light",
      cardColor: "#ffffff",
      whiteBlend: "auto",
      titleBarColor: "#fef3c7",
      titleTextColor: "#1c1917",
      titleFont: "heading",
      photoShape: "arch",
      shadow: "soft",
    },
    blocks: [
      { type: "product", productId: PRODUCT, x: 0, y: 0, w: 2, h: 2, photoEdge: "white", style: { whiteBlend: "on", cardColor: "#fef3c7", shadow: "lifted", photoShape: "circle" } },
      { type: "text", id: TEXT, text: "New in", variant: "label", align: "left", x: 2, y: 0, w: 2, h: 1, valign: "bottom", fine: { left: true } },
      { type: "shape", id: SHAPE, kind: "circle", color: "#fbbf24", x: 4, y: 0, w: 1, h: 1, gradient: { from: "#fbbf24", to: "#f97316", angle: 90 }, shadow: "soft", fine: { right: true, bottom: true } },
      { type: "image", id: IMAGE, key: `elements/${PRODUCT}/${IMAGE}-logo.svg`, alt: "Logo", x: 5, y: 0, w: 1, h: 1, shape: "circle", shadow: "soft" },
      { type: "button", id: BUTTON, label: "Shop the edit", link: { kind: "product", productId: PRODUCT }, look: "outline", x: 0, y: 2, w: 2, h: 1, fine: { top: true } },
      { type: "marquee", id: MARQUEE, text: "Free delivery this week", speed: "slow", x: 0, y: 3, w: 6, h: 1 },
      { type: "product", productId: OTHER_PRODUCT, x: 0, y: 4, w: 2, h: 2 },
    ],
    header: {
      ...config.header!,
      logo: { key: `elements/${PRODUCT}/${IMAGE}-logo.svg`, size: "large" },
      links: [
        { label: "Candles", link: { kind: "band", bandId: BAND } },
        { label: "Journal", link: { kind: "url", url: "https://example.com/journal" } },
        { label: "Outlet", link: { kind: "storefront", storefrontId: ELSEWHERE } },
        { label: "Bestseller", link: { kind: "product", productId: OTHER_PRODUCT } },
      ],
    },
    bands: [
      { id: BAND, y: 2, h: 2, background: { kind: "gradient", from: "#fef3c7", via: "#fbbf24", to: "#f97316", angle: 0 } },
    ],
  } as StorefrontConfig;
}

describe("editor upgrade contract: a storefront saved before it", () => {
  it("parses to exactly what was stored, growing no new member", () => {
    const stored = legacyConfig();
    const parsed = storefrontConfigSchema.parse(structuredClone(stored));
    expect(parsed).toEqual(stored);
    expect(parseStoredStorefrontConfig(structuredClone(stored))).toEqual(stored);
  });

  it("resolves its cards to the look they have always had", () => {
    const card = resolveCardStyle(legacyConfig().theme);
    expect(card.whiteBlend).toBe("off");
    expect(card.shadow).toBe("none");
    expect(card.cardColor).toBeUndefined();
    expect(card.titleBarColor).toBeUndefined();
    expect(card.titleTextColor).toBeUndefined();
    expect(card.titleFont).toBeUndefined();
    expect(card.photoShape).toBeUndefined();
  });

  it("is not what the coded default turns into: the default theme carries none of the new members", () => {
    for (const member of Object.keys(NEW_STOREFRONT_THEME)) {
      if (member in DEFAULT_STOREFRONT_CONFIG.theme) continue;
      expect(DEFAULT_STOREFRONT_CONFIG.theme).not.toHaveProperty(member);
    }
    expect(DEFAULT_STOREFRONT_CONFIG.theme.background).toEqual({ kind: "solid", color: "#ffffff" });
    expect(DEFAULT_STOREFRONT_CONFIG.theme.cornerRadius).toBe(0);
  });
});

describe("editor upgrade contract: a new storefront", () => {
  it("starts from the new defaults, and they are a valid storefront", () => {
    const fresh = newStorefrontConfig();
    expect(fresh.theme).toMatchObject(NEW_STOREFRONT_THEME);
    expect(storefrontConfigSchema.safeParse(fresh).success).toBe(true);
  });

  it("paints its background, accent and cards in its own palette", () => {
    const { palette, background, accent, cardColor } = newStorefrontConfig().theme;
    expect(background).toEqual({ kind: "solid", color: palette!.background });
    expect(accent).toBe(palette!.accent);
    expect(cardColor).toBe(palette!.surface);
  });
});

describe("editor upgrade contract: the new members", () => {
  it("accepts a storefront wearing every one of them, unchanged", () => {
    const config = upgradedConfig();
    const result = storefrontConfigSchema.safeParse(structuredClone(config));
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toEqual(config);
  });

  it("resolves a card's look from the theme, with the tile's own on top", () => {
    const config = upgradedConfig();
    expect(resolveCardStyle(config.theme)).toMatchObject({ whiteBlend: "auto", shadow: "soft", photoShape: "arch", cardColor: "#ffffff", titleFont: "heading" });
    const tile = config.blocks[0];
    expect(tile.type === "product" && resolveCardStyle(config.theme, tile.style)).toMatchObject({ whiteBlend: "on", shadow: "lifted", photoShape: "circle", cardColor: "#fef3c7" });
  });

  it("keys every kind of block apart", () => {
    const keys = upgradedConfig().blocks.map(blockKey);
    expect(keys).toEqual([`p_${PRODUCT}`, `t_${TEXT}`, `s_${SHAPE}`, `i_${IMAGE}`, `b_${BUTTON}`, `m_${MARQUEE}`, `p_${OTHER_PRODUCT}`]);
    expect(blockKey(carousel())).toBe(`c_${CAROUSEL}`);
  });

  it("counts a carousel's products as on the board, each product once", () => {
    const blocks = [...upgradedConfig().blocks, carousel()];
    expect(boardProductIds(blocks).sort()).toEqual([PRODUCT, OTHER_PRODUCT, ELSEWHERE].sort());
  });

  it("reads half-cell steps only off the kinds that carry them", () => {
    const [product, text, , image] = upgradedConfig().blocks;
    expect(blockFine(product)).toBeUndefined();
    expect(blockFine(text)).toEqual({ left: true });
    expect(blockFine(image)).toBeUndefined();
  });

  const refuses = (mutate: (config: Record<string, any>) => void) => {
    const config = structuredClone(upgradedConfig()) as Record<string, any>;
    mutate(config);
    return storefrontConfigSchema.safeParse(config).success === false;
  };

  it("refuses anything that is not a closed value", () => {
    expect(refuses((c) => (c.theme.fontPairing = "comic"))).toBe(true);
    expect(refuses((c) => (c.theme.motion = "spin"))).toBe(true);
    expect(refuses((c) => (c.theme.texture = "url(x)"))).toBe(true);
    expect(refuses((c) => (c.theme.whiteBlend = "multiply"))).toBe(true);
    expect(refuses((c) => (c.theme.shadow = "0 0 4px red"))).toBe(true);
    expect(refuses((c) => (c.theme.photoShape = "star"))).toBe(true);
    expect(refuses((c) => (c.theme.cardColor = "red"))).toBe(true);
    expect(refuses((c) => (c.theme.palette.accent = "rgb(0,0,0)"))).toBe(true);
    expect(refuses((c) => delete c.theme.palette.muted)).toBe(true);
    expect(refuses((c) => (c.theme.textStyles.heading.size = 5000))).toBe(true);
    expect(refuses((c) => (c.theme.textStyles.caption = {}))).toBe(true);
    expect(refuses((c) => (c.theme.background.via = "linear-gradient(red, blue)"))).toBe(true);
    expect(refuses((c) => (c.blocks[1].valign = "baseline"))).toBe(true);
    expect(refuses((c) => (c.blocks[1].fine = { left: false }))).toBe(true);
    expect(refuses((c) => (c.blocks[2].gradient.angle = 361))).toBe(true);
    expect(refuses((c) => (c.blocks[4].look = "ghost"))).toBe(true);
    expect(refuses((c) => (c.blocks[5].speed = "fast"))).toBe(true);
    expect(refuses((c) => (c.bands[0].background = { kind: "css", value: "red" }))).toBe(true);
    expect(refuses((c) => (c.header.logo.size = "huge"))).toBe(true);
  });

  it("refuses a product card with half-cell steps: cards stay on the main grid", () => {
    expect(refuses((c) => (c.blocks[0].fine = { left: true }))).toBe(true);
  });

  it("refuses half-cell steps that leave nothing to draw", () => {
    expect(refuses((c) => (c.blocks[2].fine = { left: true, right: true }))).toBe(true);
    expect(refuses((c) => (c.blocks[1].fine = { top: true, bottom: true }))).toBe(true);
    // Two cells wide can give up half a cell at each end.
    const wide = structuredClone(upgradedConfig()) as Record<string, any>;
    wide.blocks[1].fine = { left: true, right: true };
    expect(storefrontConfigSchema.safeParse(wide).success).toBe(true);
  });

  it("holds a link's address to https on a real domain", () => {
    const withUrl = (url: string) => refuses((c) => (c.header.links[1].link = { kind: "url", url }));
    expect(withUrl("http://example.com")).toBe(true);
    expect(withUrl("javascript:alert(1)")).toBe(true);
    expect(withUrl("https://user:pass@example.com")).toBe(true);
    expect(withUrl("https://localhost/x")).toBe(true);
    expect(withUrl(`https://example.com/${"a".repeat(600)}`)).toBe(true);
    expect(withUrl("https://example.com/shop?ref=1")).toBe(false);
  });

  it("refuses a link to a product or a band this storefront does not hold", () => {
    expect(refuses((c) => (c.blocks[4].link = { kind: "product", productId: ELSEWHERE }))).toBe(true);
    expect(refuses((c) => (c.header.links[0].link = { kind: "band", bandId: ELSEWHERE }))).toBe(true);
    // Any product the board shows will do.
    expect(refuses((c) => (c.blocks[4].link = { kind: "product", productId: OTHER_PRODUCT }))).toBe(false);
  });

  it("refuses more header links than a header holds, and a label with none of its words", () => {
    expect(refuses((c) => c.header.links.push({ label: "Fifth", link: { kind: "url", url: "https://example.com" } }))).toBe(true);
    expect(refuses((c) => (c.header.links[0].label = "   "))).toBe(true);
  });

  it("refuses a band past the board's last row, and two with one id", () => {
    expect(refuses((c) => (c.bands[0].h = 60))).toBe(true);
    expect(refuses((c) => c.bands.push({ ...c.bands[0] }))).toBe(true);
  });

  // THE CAROUSEL: saveable, its shape judged here (whose products they are is
  // the save's question, see storefront-carousel.test.ts).
  it("accepts a carousel block, and reads it back exactly as stored", () => {
    const config = structuredClone(upgradedConfig());
    config.blocks.push({ ...carousel(), y: 5 });
    const parsed = storefrontConfigSchema.safeParse(structuredClone(config));
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.data).toEqual(config);
    expect(parseStoredStorefrontConfig(structuredClone(config))).toEqual(config);
  });

  it("refuses a carousel naming a product twice, none, more than it holds, or anything but a product id", () => {
    const withCarousel = (productIds: unknown) => refuses((c) => c.blocks.push({ ...carousel(), y: 5, productIds }));
    expect(withCarousel([PRODUCT, PRODUCT])).toBe(true);
    expect(withCarousel([])).toBe(true);
    expect(withCarousel(Array.from({ length: 13 }, (_, n) => `33333333-4444-4555-8666-${String(n).padStart(12, "0")}`))).toBe(true);
    expect(withCarousel(["not-a-product"])).toBe(true);
    expect(refuses((c) => c.blocks.push({ ...carousel(), y: 5, style: { shadow: "soft" } }))).toBe(true);
    expect(carouselBlockSchema.safeParse(carousel()).success).toBe(true);
  });

  it("takes a link to a product only a carousel shows, and drops it when the carousel goes", () => {
    const config = structuredClone(upgradedConfig()) as Record<string, any>;
    config.blocks.push({ ...carousel(), y: 5 });
    config.blocks[4].link = { kind: "product", productId: ELSEWHERE };
    expect(storefrontConfigSchema.safeParse(config).success).toBe(true);
    // Stored with the carousel gone, the dead link is repaired, not fatal.
    config.blocks = config.blocks.filter((block: { type: string }) => block.type !== "carousel");
    const read = parseStoredStorefrontConfig(config);
    expect(read).not.toBeNull();
    expect(read!.blocks.some((block) => block.type === "button" && block.id === BUTTON)).toBe(false);
  });

  it("keeps the band's photo to an uploaded image, never an element or a product photo", () => {
    const photo = (key: string) =>
      refuses((c) => (c.bands[0].background = { kind: "image", key, x: 50, y: 50, scale: 100, dim: "dark" }));
    expect(photo(`images/${PRODUCT}/${IMAGE}-hero.jpg`)).toBe(false);
    expect(photo(`elements/${PRODUCT}/${IMAGE}-logo.svg`)).toBe(true);
    expect(photo("https://example.com/x.jpg")).toBe(true);
  });
});

describe("what a block is read against", () => {
  const theme = { background: { kind: "solid", color: "#fef3c7" } } as const;
  const dark = { id: BAND, y: 2, h: 2, background: { kind: "solid", color: "#1c1917" } } as const;
  const photo = { id: ELSEWHERE, y: 6, h: 2, background: { kind: "image", key: "images/a/b-c.jpg", x: 50, y: 50, scale: 100, dim: "light" } } as const;
  const at = (y: number, h = 1): Pick<StorefrontBlock, "y" | "h"> => ({ y, h });

  it("is the board's background off a band, and the band on one", () => {
    expect(backdropHex(theme, [dark, photo], at(0))).toBe("#fef3c7");
    expect(backdropHex(theme, [dark, photo], at(2))).toBe("#1c1917");
    expect(backdropHex(theme, undefined, at(2))).toBe("#fef3c7");
  });

  it("goes by the block's middle, so grazing a band's edge does not count", () => {
    expect(bandBehind([dark], at(0, 3))).toBeNull();
    expect(bandBehind([dark], at(1, 3))).toBe(dark);
  });

  it("answers a veiled photo with its veil", () => {
    expect(backdropHex(theme, [dark, photo], at(6))).toBe("#ffffff");
  });
});

describe("the palette", () => {
  it("is read off what a storefront already wears, and stores nothing", async () => {
    const { derivePalette } = await import("@/lib/storefront/palette");
    const theme = legacyConfig().theme;
    expect(derivePalette(theme)).toMatchObject({ background: "#fef3c7", accent: "#7c2d12", surface: "#ffffff", text: "#171717" });
    expect(theme.palette).toBeUndefined();
  });

  it("recolours everything painted in the colour it replaces", async () => {
    const { recolourPalette } = await import("@/lib/storefront/palette");
    const next = recolourPalette(legacyConfig(), "accent", "#0c4a6e");
    expect(next.theme.accent).toBe("#0c4a6e");
    expect(next.theme.palette?.accent).toBe("#0c4a6e");
    // The heading and the masthead were painted in the old accent.
    expect(next.blocks[1]).toMatchObject({ color: "#0c4a6e" });
    expect(next.header?.nameColor).toBe("#0c4a6e");
    // What was another colour stays as it was.
    expect(next.blocks[2]).toMatchObject({ color: "#fbbf24" });
    expect(storefrontConfigSchema.safeParse(next).success).toBe(true);
  });

  it("leaves a seller's words alone, even when they spell a colour", async () => {
    const { replaceColor } = await import("@/lib/storefront/palette");
    const config = legacyConfig();
    const text = config.blocks[1];
    if (text.type === "text") text.text = "#7c2d12";
    const next = replaceColor(config, "#7c2d12", "#000000");
    expect(next.blocks[1]).toMatchObject({ text: "#7c2d12", color: "#000000" });
  });

  it("moves only the slot when another slot wears the same colour", async () => {
    const { recolourPalette } = await import("@/lib/storefront/palette");
    const config = newStorefrontConfig();
    // A new storefront's text and accent are one colour.
    const next = recolourPalette(config, "accent", "#b91c1c");
    expect(next.theme.accent).toBe("#b91c1c");
    expect(next.theme.palette).toMatchObject({ accent: "#b91c1c", text: config.theme.palette!.text });
  });
});

describe("the saved text styles", () => {
  it("resolve to each style's coded default until the storefront says", async () => {
    const { resolveTextStyle } = await import("@/lib/storefront/text-styles");
    expect(resolveTextStyle(legacyConfig().theme, "heading")).toEqual({ font: "heading", size: 24 });
    expect(resolveTextStyle(legacyConfig().theme, "label")).toEqual({ font: "body", size: 12 });
    expect(resolveTextStyle(upgradedConfig().theme, "heading")).toEqual({ font: "heading", size: 40, uppercase: true, color: "#7c2d12" });
  });
});

describe("words on a band", () => {
  it("keep the ink they would wear anyway wherever it reads there", async () => {
    const { textInkOnBackdrop } = await import("@/lib/storefront/text-styles");
    const theme = legacyConfig().theme;
    // Off a band (no backdrop) nothing is decided here: the automatic colour,
    // or none, comes straight back, as it always was.
    expect(textInkOnBackdrop(theme, undefined, undefined)).toBeUndefined();
    expect(textInkOnBackdrop(theme, "#7c2d12", undefined)).toBe("#7c2d12");
    // On a light band the board's own dark ink and a dark accent both read.
    expect(textInkOnBackdrop(theme, undefined, "#fef3c7")).toBeUndefined();
    expect(textInkOnBackdrop(theme, "#7c2d12", "#fef3c7")).toBe("#7c2d12");
  });

  it("take whichever ink reads where the automatic one would not", async () => {
    const { textInkOnBackdrop } = await import("@/lib/storefront/text-styles");
    const { contrastRatio } = await import("@/lib/format/color");
    const theme = legacyConfig().theme;
    // A dark band under dark words: the board's ink, and a dark accent, give way.
    for (const automatic of [undefined, "#7c2d12"]) {
      const ink = textInkOnBackdrop(theme, automatic, "#1c1917");
      expect(ink).toBeDefined();
      expect(contrastRatio(ink!, "#1c1917")).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("a stored storefront with a link to nothing", () => {
  it("is read back without the dead links, never lost whole", () => {
    const stored = structuredClone(upgradedConfig()) as Record<string, any>;
    // The product the button and a menu entry lead to has left the board.
    stored.blocks = stored.blocks.filter((block: Record<string, unknown>) => block.productId !== PRODUCT);
    stored.header.links.push({ label: "Gone", link: { kind: "product", productId: PRODUCT } });
    stored.header.links.splice(3, 1);
    expect(storefrontConfigSchema.safeParse(stored).success).toBe(false);

    const read = parseStoredStorefrontConfig(stored);
    expect(read).not.toBeNull();
    expect(read!.blocks.some((block) => block.type === "button")).toBe(false);
    expect(read!.blocks.map((block) => block.type)).toContain("marquee");
    expect(read!.header?.links?.map((entry) => entry.label)).toEqual(["Candles", "Journal", "Outlet"]);
    expect(read!.bands).toHaveLength(1);
    expect(read!.theme.palette).toEqual(upgradedConfig().theme.palette);
  });

  it("is still refused when something else is wrong with it too", () => {
    const stored = structuredClone(upgradedConfig()) as Record<string, any>;
    stored.blocks = stored.blocks.filter((block: Record<string, unknown>) => block.productId !== PRODUCT);
    stored.theme.motion = "spin";
    expect(parseStoredStorefrontConfig(stored)).toBeNull();
  });
});
