import { recolourPalette } from "@/lib/storefront/palette";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  NEW_STOREFRONT_THEME,
  buyerVisibleBlocks,
  type FontPairing,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontSeller,
  type StorefrontTheme,
} from "@/types/storefront";
import type { StorefrontPageData, StorefrontTileProduct } from "@/types/storefront-page";

// THE EDITOR-TYPE GALLERY'S BOARDS: real storefront configs, drawn by the
// buyer's own renderer. Raw hex and copy are fixtures here (a /dev gallery),
// never in components. Czech and Polish words on purpose: diacritics are where
// a font subset fails (ě š č ř ž ý á í é ů ł ą ę ś ź ż ó ń).

/** The sections the page can show; pictures are taken one section at a time.
 *  Here, not in the client gallery: a server page cannot read a value out of a
 *  client module. */
export const GALLERY_SECTIONS = ["pairings", "color", "text", "legacy", "panels", "embed"] as const;
export type GallerySection = (typeof GALLERY_SECTIONS)[number];

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The two product cards every board shows, by the sample's own photos. */
export type GalleryProducts = { a: StorefrontTileProduct; b: StorefrontTileProduct };

const COPY = {
  name: "Příliš žluťoučký kůň",
  bio: "Ruční keramika z Brna · Zażółć gęślą jaźń",
  heading: "Úpěl ďábelské ódy",
  subheading: "Zażółć gęślą jaźń",
  body: "Každý hrnek je točený ručně. Każdy kubek jest robiony w naszej pracowni, żółty i ciepły.",
  label: "Novinka · Nowość · Šťastné ůterý",
} as const;

/** The type board: a card, a headline, a subheading, body text and a small
 *  label, on a six by four grid that reflows on a phone. */
function typeBlocks(products: GalleryProducts): StorefrontBlock[] {
  return [
    { type: "product", productId: products.a.id, x: 0, y: 0, w: 2, h: 2 },
    { type: "text", id: id(1), text: COPY.heading, variant: "heading", align: "left", x: 2, y: 0, w: 4, h: 1 },
    { type: "text", id: id(2), text: COPY.subheading, variant: "subheading", align: "left", x: 2, y: 1, w: 4, h: 1 },
    { type: "text", id: id(3), text: COPY.body, variant: "body", align: "left", x: 0, y: 2, w: 4, h: 1 },
    { type: "product", productId: products.b.id, x: 4, y: 2, w: 2, h: 2 },
    { type: "text", id: id(4), text: COPY.label, variant: "label", align: "left", x: 0, y: 3, w: 4, h: 1 },
  ];
}

const BASE_THEME: StorefrontTheme = {
  ...DEFAULT_STOREFRONT_CONFIG.theme,
  columns: 6,
  rows: 4,
  titleDisplay: "always",
  priceDisplay: "always",
};

/** A pairing board, on the new-storefront look (palette, cards). */
export function pairingConfig(pairing: FontPairing | undefined, products: GalleryProducts): StorefrontConfig {
  return {
    ...DEFAULT_STOREFRONT_CONFIG,
    theme: { ...BASE_THEME, ...NEW_STOREFRONT_THEME, columns: 6, rows: 4, motion: undefined, fontPairing: pairing },
    header: { show: true, name: COPY.name, bio: COPY.bio },
    blocks: typeBlocks(products),
  };
}

/** The palette board: shapes and words painted in palette colours, so one
 *  change visibly runs through all of them. */
export function paletteConfig(products: GalleryProducts): StorefrontConfig {
  const palette = { background: "#f3eee6", text: "#1f1b16", accent: "#9a3412", surface: "#ffffff", muted: "#e6dccd" };
  return {
    ...DEFAULT_STOREFRONT_CONFIG,
    theme: {
      ...BASE_THEME,
      palette,
      background: { kind: "solid", color: palette.background },
      accent: palette.accent,
      cardColor: palette.surface,
      fontPairing: "editorial",
      cornerRadius: 12,
    },
    header: { show: true, name: COPY.name, bio: COPY.bio, nameColor: palette.accent },
    blocks: [
      { type: "shape", id: id(20), kind: "rounded", color: palette.muted, x: 2, y: 0, w: 4, h: 2 },
      { type: "text", id: id(21), text: COPY.heading, variant: "heading", align: "left", x: 2, y: 0, w: 4, h: 1 },
      { type: "text", id: id(22), text: COPY.subheading, variant: "subheading", align: "left", x: 2, y: 1, w: 4, h: 1, color: palette.accent },
      { type: "product", productId: products.a.id, x: 0, y: 0, w: 2, h: 2 },
      { type: "shape", id: id(23), kind: "circle", color: palette.accent, x: 0, y: 2, w: 1, h: 1 },
      { type: "text", id: id(24), text: COPY.body, variant: "body", align: "left", x: 1, y: 2, w: 3, h: 1 },
      { type: "product", productId: products.b.id, x: 4, y: 2, w: 2, h: 2 },
      { type: "text", id: id(25), text: COPY.label, variant: "label", align: "left", x: 0, y: 3, w: 4, h: 1 },
    ],
  };
}

/** The palette board after two palette changes: a new accent, and a dark
 *  background with a light text colour (every colour that wore the old ones
 *  follows; the muted shape keeps its own). */
export function recolouredPaletteConfig(products: GalleryProducts): StorefrontConfig {
  let config = paletteConfig(products);
  config = recolourPalette(config, "accent", "#f2a65a");
  config = recolourPalette(config, "background", "#1c2321");
  config = recolourPalette(config, "text", "#f5efe6");
  config = recolourPalette(config, "muted", "#2f3b37");
  return config;
}

/** Saved text styles: a big uppercase-free headline, a spaced small label in
 *  the accent, airy body text. */
export function textStylesConfig(products: GalleryProducts): StorefrontConfig {
  const config = pairingConfig("classic", products);
  return {
    ...config,
    theme: {
      ...config.theme,
      textStyles: {
        heading: { size: 40, italic: true },
        subheading: { font: "body", bold: true, uppercase: true, letterSpacing: 12, size: 14 },
        body: { lineHeight: 170 },
        label: { uppercase: true, letterSpacing: 20, color: "#9a3412", bold: true },
      },
    },
  };
}

/** Vertical alignment: three tall boxes, words at the top, the middle and the
 *  bottom. `freeform` lays a muted shape under each so the box shows (and the
 *  board stops reflowing, as any stacked board does). */
export function valignConfig(freeform: boolean): StorefrontConfig {
  const box = (x: number, n: number): StorefrontBlock[] =>
    freeform ? [{ type: "shape", id: id(40 + n), kind: "rounded", color: "#e7e1d8", x, y: 0, w: 2, h: 3 }] : [];
  return {
    ...DEFAULT_STOREFRONT_CONFIG,
    theme: { ...BASE_THEME, ...NEW_STOREFRONT_THEME, motion: undefined, rows: 3, fontPairing: "soft" },
    header: { show: false, name: "", bio: "" },
    blocks: [
      ...box(0, 1),
      { type: "text", id: id(31), text: "Nahoře · Góra", variant: "subheading", align: "center", x: 0, y: 0, w: 2, h: 3, valign: "top" },
      ...box(2, 2),
      { type: "text", id: id(32), text: "Uprostřed · Środek", variant: "subheading", align: "center", x: 2, y: 0, w: 2, h: 3 },
      ...box(4, 3),
      { type: "text", id: id(33), text: "Dole · Dół", variant: "subheading", align: "center", x: 4, y: 0, w: 2, h: 3, valign: "bottom" },
    ],
  };
}

/** A storefront saved before the upgrade: none of this workstream's fields. */
export function legacyConfig(products: GalleryProducts): StorefrontConfig {
  return {
    ...DEFAULT_STOREFRONT_CONFIG,
    theme: {
      ...BASE_THEME,
      background: { kind: "solid", color: "#fef3c7" },
      accent: "#7c2d12",
      font: "serif",
      cornerRadius: 16,
    },
    header: { show: true, name: COPY.name, bio: COPY.bio },
    blocks: typeBlocks(products),
  };
}

/** A config as a buyer's board is handed it (types/storefront-page). */
export function asPage(
  config: StorefrontConfig,
  products: GalleryProducts,
  seller: StorefrontSeller,
  key: string,
): StorefrontPageData {
  return {
    id: key,
    name: COPY.name,
    theme: config.theme,
    ...(config.header ? { header: config.header } : {}),
    blocks: buyerVisibleBlocks(config),
    products: [products.a, products.b],
    tileLook: resolveTileLook({ theme: config.theme, productPage: DEFAULT_PRODUCT_PAGE_CONFIG, cartPage: { enabled: false } }),
    imageUrls: {},
    backgroundImageUrl: null,
    customFontUrl: null,
    seller,
    allowIndexing: false,
    url: "#",
  };
}
