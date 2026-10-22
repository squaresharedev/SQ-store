import { hsvToHex, type Hsv } from "@/lib/format/color";

/**
 * What a share card needs to know about a product photo once its background
 * is gone: where the product is, whether the photographer cropped it, and the
 * colour it is. Pure arithmetic over RGBA pixels, safe anywhere, so the rules
 * are unit tested without a model or a browser.
 */

/** Alpha from which a pixel counts as product: a soft edge's outer half
 *  belongs to the background. */
const SOLID_ALPHA = 128;

/** Alpha from which a pixel is solid enough to say what colour the product
 *  is (edges blend into the old background and lie about it). */
const COLOUR_ALPHA = 220;

/** How far from the photo's edge, in pixels, a product still touches it. */
const EDGE_REACH = 2;

/** The share of an edge the product must cover before it counts as cut off
 *  there, so a stray pixel of fringe does not count. */
const BLEED_SHARE = 0.03;

/** Hue buckets for the product's colour: 15 degrees each. */
const HUE_BUCKETS = 24;

/** Below this mean chroma (saturation x value, 0..1) the product is a grey,
 *  a black or a white, and has no colour of its own to build a palette on. */
const COLOURFUL_CHROMA = 0.1;

/** Every how-many pixels the colour pass samples: a 1024 x 1024 mask is a
 *  million pixels and the answer does not need all of them. */
const COLOUR_STRIDE = 7;

export type CutoutBox = { x: number; y: number; width: number; height: number };

export type CutoutEdge = "top" | "right" | "bottom" | "left";

export type SubjectColour = {
  /** The colour most of the product is, as strict hex. */
  hex: string;
  /** The same in HSV (hue 0-360, saturation and value 0-100). */
  hsv: Hsv;
  /** False for a grey, black or white product: nothing to build a palette on. */
  colourful: boolean;
};

export type CutoutAnalysis = {
  /** The product's bounds in the photo, in pixels; null when nothing is left. */
  box: CutoutBox | null;
  /** Edges of the photo the product runs off: it was cropped there. */
  bleeds: Record<CutoutEdge, boolean>;
  /** The share of the photo the product covers, 0..1. */
  coverage: number;
  colour: SubjectColour | null;
};

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : (d / max) * 100, v: (max / 255) * 100 };
}

export function analyzeCutout(rgba: ArrayLike<number>, width: number, height: number): CutoutAnalysis {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let solid = 0;
  const edgeHits: Record<CutoutEdge, number> = { top: 0, right: 0, bottom: 0, left: 0 };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] < SOLID_ALPHA) continue;
      solid += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (y < EDGE_REACH) edgeHits.top += 1;
      if (y >= height - EDGE_REACH) edgeHits.bottom += 1;
      if (x < EDGE_REACH) edgeHits.left += 1;
      if (x >= width - EDGE_REACH) edgeHits.right += 1;
    }
  }

  const bleeds: Record<CutoutEdge, boolean> = {
    top: edgeHits.top > width * EDGE_REACH * BLEED_SHARE,
    bottom: edgeHits.bottom > width * EDGE_REACH * BLEED_SHARE,
    left: edgeHits.left > height * EDGE_REACH * BLEED_SHARE,
    right: edgeHits.right > height * EDGE_REACH * BLEED_SHARE,
  };

  if (maxX < 0) {
    return { box: null, bleeds, coverage: 0, colour: null };
  }

  return {
    box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    bleeds,
    coverage: solid / (width * height),
    colour: subjectColour(rgba, width * height),
  };
}

/**
 * The product's colour: the hue most of its coloured pixels share, weighted
 * by how coloured each one is, so a mint pot with a green plant in it reads
 * as mint and a black watch with an orange face reads as black. A product
 * with too little colour anywhere is reported as its mean grey.
 */
function subjectColour(rgba: ArrayLike<number>, pixels: number): SubjectColour | null {
  const weight = new Float64Array(HUE_BUCKETS);
  const sums = Array.from({ length: HUE_BUCKETS }, () => [0, 0, 0]);
  const mean = [0, 0, 0];
  let counted = 0;
  let chroma = 0;

  for (let i = 0; i < pixels; i += COLOUR_STRIDE) {
    const o = i * 4;
    if (rgba[o + 3] < COLOUR_ALPHA) continue;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const { h, s, v } = rgbToHsv(r, g, b);
    const c = (s / 100) * (v / 100);
    counted += 1;
    chroma += c;
    mean[0] += r;
    mean[1] += g;
    mean[2] += b;
    const bucket = Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
    weight[bucket] += c;
    sums[bucket][0] += r * c;
    sums[bucket][1] += g * c;
    sums[bucket][2] += b * c;
  }
  if (counted === 0) return null;

  const colourful = chroma / counted >= COLOURFUL_CHROMA;
  let rgb = mean.map((channel) => channel / counted);
  if (colourful) {
    let best = 0;
    for (let k = 1; k < HUE_BUCKETS; k += 1) if (weight[k] > weight[best]) best = k;
    rgb = sums[best].map((channel) => channel / weight[best]);
  }
  const hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  return { hex: hsvToHex(hsv), hsv, colourful };
}
