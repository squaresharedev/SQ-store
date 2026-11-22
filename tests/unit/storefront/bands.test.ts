import { describe, expect, it } from "vitest";
import {
  BAND_VEILS,
  bandAnchorId,
  bandFragment,
  bandLayers,
  bandMembers,
  bandPhotoKeys,
  bandsBottom,
  bandsForSave,
  bandSwatches,
  backgroundOfKind,
  blockBackdrop,
  gradientCss,
  linkedBandIds,
  newBand,
  newBandRows,
  paletteGradients,
  photoBackground,
  placeBand,
} from "@/lib/storefront/bands";
import { contrastRatio, mixHex } from "@/lib/format/color";
import {
  BANDS_MAX,
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontBand,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";

const theme: StorefrontTheme = { ...DEFAULT_STOREFRONT_CONFIG.theme, background: { kind: "solid", color: "#fef3c7" }, rows: 10 };
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const dark: StorefrontBand = { id: A, y: 2, h: 2, background: { kind: "solid", color: "#1c1917" } };
const photo: StorefrontBand = { id: B, y: 6, h: 2, background: { kind: "image", key: "images/u/p.jpg", x: 50, y: 50, scale: 100, dim: "light" } };

const text = (id: string, x: number, y: number, w = 1, h = 1): StorefrontBlock => ({
  type: "text", id, text: "Hi", variant: "body", align: "left", x, y, w, h,
});
const button = (id: string, y: number): StorefrontBlock => ({
  type: "button", id, label: "Go", link: { kind: "url", url: "https://example.com" }, x: 0, y, w: 2, h: 1,
});

describe("a band's paint", () => {
  it("is a colour, a gradient of two or three stops, or a photo under its veil", () => {
    expect(bandLayers({ kind: "solid", color: "#123456" })).toEqual({ fill: { backgroundColor: "#123456" } });
    expect(gradientCss({ from: "#000000", to: "#ffffff", angle: 90 })).toBe("linear-gradient(90deg, #000000, #ffffff)");
    expect(gradientCss({ from: "#000000", via: "#ff0000", to: "#ffffff", angle: 45 })).toBe(
      "linear-gradient(45deg, #000000, #ff0000, #ffffff)",
    );
    const layers = bandLayers(photo.background, "https://r2.example/p.jpg");
    expect(layers.photo?.backgroundImage).toBe('url("https://r2.example/p.jpg")');
    expect(layers.photo?.backgroundSize).toBe("cover");
    expect(layers.photo?.transform).toBeUndefined();
    expect(layers.veil).toEqual({ backgroundColor: BAND_VEILS.light });
  });

  it("zooms a photo past cover by its scale, about its focal point", () => {
    const layers = bandLayers({ kind: "image", key: "images/u/p.jpg", x: 20, y: 80, scale: 150 }, "blob:x");
    expect(layers.photo).toMatchObject({ transform: "scale(1.5)", transformOrigin: "20% 80%", backgroundPosition: "20% 80%" });
    expect(layers.veil).toBeUndefined();
  });

  it("shows a quiet placeholder, never a broken picture, before the photo is signed", () => {
    const layers = bandLayers(photo.background, null);
    expect(layers.photo).toBeUndefined();
    expect(layers.fill.backgroundColor).toMatch(/^#/);
  });

  it("veils a photo strongly enough for the chosen ink to read at AA over any picture", () => {
    // A light veil over pure black, read with the dark ink; a dark one over
    // pure white, read with white. Alphas from BAND_VEILS.
    const lightAlpha = Number(BAND_VEILS.light.match(/[\d.]+\)$/)![0].slice(0, -1));
    const darkAlpha = Number(BAND_VEILS.dark.match(/[\d.]+\)$/)![0].slice(0, -1));
    expect(contrastRatio("#171717", mixHex("#000000", "#ffffff", lightAlpha))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ffffff", mixHex("#ffffff", "#000000", darkAlpha))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the palette's offer for a band", () => {
  it("is the palette's colours, each once", () => {
    const swatches = bandSwatches(theme);
    expect(new Set(swatches).size).toBe(swatches.length);
    expect(swatches).toContain("#fef3c7");
  });

  it("is a few ready-made gradients, none of them a flat colour", () => {
    const fills = paletteGradients(theme);
    expect(fills.length).toBeGreaterThanOrEqual(2);
    for (const fill of fills) expect(fill.from.toLowerCase() === fill.to.toLowerCase() && !fill.via).toBe(false);
  });

  it("switches kind from what the band has: a swatch, a gradient, or nothing until a photo is chosen", () => {
    expect(backgroundOfKind("solid", dark.background, theme)).toBe(dark.background);
    expect(backgroundOfKind("gradient", dark.background, theme)?.kind).toBe("gradient");
    expect(backgroundOfKind("image", dark.background, theme)).toBeNull();
    expect(photoBackground("images/u/new.jpg")).toEqual({ kind: "image", key: "images/u/new.jpg", x: 50, y: 50, scale: 100, dim: "dark" });
  });
});

describe("which blocks sit on a band", () => {
  it("goes by each block's middle row, and lists them in reading order", () => {
    const blocks = [text("t3", 3, 3), text("t1", 0, 2), text("t2", 0, 1, 1, 3), text("off", 0, 5)];
    const members = bandMembers([dark, photo], blocks);
    expect(members.get(A)).toEqual(["t_t2", "t_t1", "t_t3"]);
    expect(members.get(B)).toBeUndefined();
    expect(bandMembers(undefined, blocks).size).toBe(0);
  });
});

describe("what a block's words are read against", () => {
  it("is news only on a band, or for a kind new enough to ask", () => {
    expect(blockBackdrop(theme, [dark], text("t", 0, 0))).toBeUndefined();
    expect(blockBackdrop(theme, undefined, text("t", 0, 2))).toBeUndefined();
    expect(blockBackdrop(theme, [dark], text("t", 0, 2))).toBe("#1c1917");
    expect(blockBackdrop(theme, [dark], button("b", 0))).toBe("#fef3c7");
    expect(blockBackdrop(theme, [dark, photo], button("b", 6))).toBe("#ffffff");
  });

  it("follows the band the grid says is drawn behind the block, where it says one", () => {
    expect(blockBackdrop(theme, [dark], text("t", 0, 2), null)).toBeUndefined();
    expect(blockBackdrop(theme, [dark], text("t", 0, 9), A)).toBe("#1c1917");
    expect(blockBackdrop(theme, [dark], button("b", 2), null)).toBe("#fef3c7");
  });
});

describe("band edits", () => {
  it("finds the first rows no band covers, two where there is room", () => {
    expect(newBandRows([], 10)).toEqual({ y: 0, h: 2 });
    expect(newBandRows([dark], 10)).toEqual({ y: 0, h: 2 });
    expect(newBandRows([{ ...dark, y: 1, h: 3 }], 10)).toEqual({ y: 0, h: 1 });
    expect(newBandRows([{ ...dark, y: 0, h: 10 }], 10)).toBeNull();
    const full = Array.from({ length: BANDS_MAX }, (_, index) => ({ ...dark, id: String(index), y: 9, h: 1 }));
    expect(newBandRows(full, 10)).toBeNull();
  });

  it("starts a new band in the palette's muted colour", () => {
    expect(newBand("id", { y: 1, h: 2 }, theme)).toMatchObject({ id: "id", y: 1, h: 2, background: { kind: "solid" } });
  });

  it("holds a moved or stretched band to the board", () => {
    expect(placeBand(dark, { y: -3, h: 2 }, 10)).toMatchObject({ y: 0, h: 2 });
    expect(placeBand(dark, { y: 9, h: 2 }, 10)).toMatchObject({ y: 8, h: 2 });
    expect(placeBand(dark, { y: 2, h: 0 }, 10)).toMatchObject({ y: 2, h: 1 });
    expect(placeBand(dark, { y: 2, h: 2 }, 10)).toBe(dark);
  });

  it("saves bands held to the board's rows, and nothing at all without any", () => {
    expect(bandsForSave([], 10)).toEqual({});
    expect(bandsForSave([dark, photo], 7)).toEqual({ bands: [dark, { ...photo, h: 1 }] });
    expect(bandsForSave([photo], 6)).toEqual({});
  });

  it("knows which bands a link leads to, and which photos the bands hold", () => {
    const linked = linkedBandIds(
      [{ type: "button", id: "b", label: "Go", link: { kind: "band", bandId: A }, x: 0, y: 0, w: 1, h: 1 }],
      [{ label: "Photo", link: { kind: "band", bandId: B } }],
    );
    expect([...linked].sort()).toEqual([A, B].sort());
    expect(bandPhotoKeys([dark, photo, { ...photo, id: "c" }])).toEqual(["images/u/p.jpg"]);
    expect(bandsBottom([dark, photo])).toBe(8);
    expect(bandsBottom(undefined)).toBe(0);
  });

  it("names a band's anchor from its id", () => {
    expect(bandAnchorId(A)).toBe(`band-${A}`);
    expect(bandFragment(A)).toBe(`#band-${A}`);
  });
});
