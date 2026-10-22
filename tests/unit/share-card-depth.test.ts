import { describe, expect, it } from "vitest";
import { analyzeCutout } from "@/lib/share-card/cutout/analyze";
import { MASK_EDGE, MIN_MASK_CONFIDENCE, maskConfidence, sharpenMask } from "@/lib/share-card/cutout/refine";
import { SHARE_CARD_FALLBACK_HUES, shareCardPalette } from "@/lib/share-card/palette";
import { headlineLines, repeatToLength } from "@/lib/share-card/text";
import { contrastRatio, hexToHsv } from "@/lib/format/color";

/** A w x h RGBA image of transparent pixels, with an opaque rectangle of
 *  `rgb` painted from (x0, y0) to (x1, y1) exclusive. */
function image(w: number, h: number, rect: [number, number, number, number], rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  const [x0, y0, x1, y1] = rect;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const o = (y * w + x) * 4;
      data.set([...rgb, 255], o);
    }
  }
  return data;
}

describe("analyzeCutout", () => {
  it("finds the product's box and says it was not cropped", () => {
    const result = analyzeCutout(image(100, 80, [20, 10, 70, 60], [200, 40, 40]), 100, 80);
    expect(result.box).toEqual({ x: 20, y: 10, width: 50, height: 50 });
    expect(result.bleeds).toEqual({ top: false, right: false, bottom: false, left: false });
    expect(result.coverage).toBeCloseTo((50 * 50) / (100 * 80), 5);
  });

  it("says where the photo cropped the product", () => {
    const result = analyzeCutout(image(100, 80, [30, 20, 100, 80], [40, 40, 40]), 100, 80);
    expect(result.bleeds).toEqual({ top: false, right: true, bottom: true, left: false });
  });

  it("reads a coloured product's hue, and a grey one as having none", () => {
    const red = analyzeCutout(image(40, 40, [5, 5, 35, 35], [210, 40, 30]), 40, 40).colour;
    expect(red?.colourful).toBe(true);
    expect(red?.hsv.h).toBeLessThan(15);
    const grey = analyzeCutout(image(40, 40, [5, 5, 35, 35], [90, 92, 95]), 40, 40).colour;
    expect(grey?.colourful).toBe(false);
  });

  it("finds nothing in a photo the model emptied", () => {
    const result = analyzeCutout(new Uint8ClampedArray(10 * 10 * 4), 10, 10);
    expect(result.box).toBeNull();
    expect(result.colour).toBeNull();
  });
});

describe("maskConfidence", () => {
  const mask = (alphas: number[]) => new Uint8ClampedArray(alphas.flatMap((a) => [0, 0, 0, a]));

  it("is the share of the product the model is sure of", () => {
    // Background (0) does not count; 3 of the 4 product pixels are sure.
    expect(maskConfidence(mask([0, 0, 255, 250, 200, 90]))).toBeCloseTo(3 / 4, 5);
  });

  it("calls a see-through product unsure, below the bar a card uses", () => {
    expect(maskConfidence(mask([0, 80, 90, 100, 120, 255]))).toBeLessThan(MIN_MASK_CONFIDENCE);
    expect(maskConfidence(mask([0, 0, 0]))).toBe(0);
  });
});

describe("sharpenMask", () => {
  it("drops the haze, keeps the product, feathers between", () => {
    const px = (alpha: number) => new Uint8ClampedArray([0, 0, 0, alpha]);
    const haze = px(Math.floor(MASK_EDGE.low * 255) - 5);
    const solid = px(Math.ceil(MASK_EDGE.high * 255) + 5);
    const middle = px(Math.round(((MASK_EDGE.low + MASK_EDGE.high) / 2) * 255));
    sharpenMask(haze);
    sharpenMask(solid);
    sharpenMask(middle);
    expect(haze[3]).toBe(0);
    expect(solid[3]).toBe(255);
    expect(middle[3]).toBeGreaterThan(100);
    expect(middle[3]).toBeLessThan(155);
  });
});

describe("shareCardPalette", () => {
  const oak = { hex: "#a8703c", hsv: hexToHsv("#a8703c")!, colourful: true };

  it("keeps a light card in the product's own hue, with ink that reads", () => {
    const palette = shareCardPalette(oak, "light", SHARE_CARD_FALLBACK_HUES.cream);
    expect(Math.abs(hexToHsv(palette.ground)!.h - oak.hsv.h)).toBeLessThan(3);
    expect(contrastRatio(palette.ink, palette.ground)).toBeGreaterThan(7);
    expect(contrastRatio(palette.accentInk, palette.accent)).toBeGreaterThan(3);
  });

  it("turns a vivid card to the opposite hue, so the product stands out", () => {
    const palette = shareCardPalette(oak, "vivid", SHARE_CARD_FALLBACK_HUES.signal);
    const hue = hexToHsv(palette.ground)!.h;
    // The angular distance between the two hues: 180 is the opposite one.
    expect(Math.abs(((hue - oak.hsv.h + 540) % 360) - 180)).toBeGreaterThan(177);
    expect(contrastRatio(palette.ink, palette.ground)).toBeGreaterThan(4.5);
  });

  it("gives a grey product the template's own hue, and a dark card light ink", () => {
    const grey = { hex: "#5a5c5f", hsv: hexToHsv("#5a5c5f")!, colourful: false };
    const palette = shareCardPalette(grey, "deep", SHARE_CARD_FALLBACK_HUES.cobalt);
    expect(Math.abs(hexToHsv(palette.ground)!.h - SHARE_CARD_FALLBACK_HUES.cobalt)).toBeLessThan(3);
    expect(contrastRatio(palette.ink, palette.ground)).toBeGreaterThan(7);
  });
});

describe("headlineLines", () => {
  it("keeps a long title's leading words, never ending on a dangling short one", () => {
    expect(headlineLines("Brushed Steel Wristwatch with a Hand-Stitched Leather Strap", 3, 26)).toEqual([
      "Brushed",
      "Steel",
      "Wristwatch",
    ]);
  });

  it("balances the lines it uses", () => {
    expect(headlineLines("Loft Oak Bookshelf", 2, 18)).toEqual(["Loft Oak", "Bookshelf"]);
    expect(headlineLines("Lamp", 3, 26)).toEqual(["Lamp"]);
  });

  it("keeps a first word even past the budget", () => {
    expect(headlineLines("Supercalifragilisticexpialidocious lamp", 2, 10)).toEqual([
      "Supercalifragilisticexpialidocious",
    ]);
  });

  it("repeats a phrase to at least the length asked", () => {
    expect(repeatToLength("ab • ", 12)).toBe("ab • ab • ab • ");
    expect(repeatToLength("", 12)).toBe("");
  });
});
