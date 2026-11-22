import { contrastRatio, readableInkOn } from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/predicates";
import type { GradientFill, PaletteSlot, StorefrontPalette } from "@/types/storefront";

/**
 * GRADIENTS, as pure data: the one place a GradientFill becomes CSS, and the
 * READY-MADE gradients a seller picks from, built from the storefront's own
 * palette. The board background, shape fills and (workstream 3) bands all
 * draw the same GradientFill through here. No React and no editor imports, so
 * any renderer, the MCP and the tests can use it.
 *
 * There is no gradient editor anywhere: a seller picks a swatch. The recipes
 * below name palette SLOTS, never colours, so every ready-made gradient is in
 * the storefront's own colours and follows the palette when it changes (a
 * recolour replaces the hex wherever it is worn, `from`/`via`/`to` included).
 */

/** The stops of a gradient, in order: two, or three with a middle. */
export function gradientStops(fill: GradientFill): string[] {
  return fill.via === undefined ? [fill.from, fill.to] : [fill.from, fill.via, fill.to];
}

/**
 * A GradientFill as a CSS `linear-gradient(...)`, or null when any stop is not
 * strict hex or the angle is not a number (a caller then draws its solid
 * colour). A two-stop gradient is spelled exactly as the background always
 * spelled it, so existing storefronts produce the same string; a third stop
 * appears only when `via` is present.
 */
export function gradientCss(fill: GradientFill): string | null {
  const stops = gradientStops(fill);
  if (!stops.every(isStrictHexColor) || !Number.isFinite(fill.angle)) return null;
  return `linear-gradient(${Math.round(fill.angle)}deg, ${stops.join(", ")})`;
}

const sameHex = (a: string | undefined, b: string | undefined) =>
  a?.toLowerCase() === b?.toLowerCase();

/** Same stops (case aside) and the same angle. */
export function sameGradient(a: GradientFill | undefined, b: GradientFill | undefined): boolean {
  if (!a || !b) return false;
  return sameHex(a.from, b.from) && sameHex(a.via, b.via) && sameHex(a.to, b.to) && a.angle === b.angle;
}

/**
 * Where a gradient line runs inside a 100 x 100 box, CSS's own way: through
 * the centre at `angle` (0 up, 90 right), long enough that the corners land on
 * the first and last stop. For an SVG `linearGradient` in user space, so a
 * shape drawn as a path matches one drawn as a box. Exact on a square tile; a
 * stretched one tilts it a little, as it stretches the shape itself.
 */
export function gradientLine(angle: number): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const half = (Math.abs(dx) + Math.abs(dy)) * 50;
  // `+ 0` turns a negative zero into a plain one.
  const round = (value: number) => Math.round(value * 100) / 100 + 0;
  return {
    x1: round(50 - dx * half),
    y1: round(50 - dy * half),
    x2: round(50 + dx * half),
    y2: round(50 + dy * half),
  };
}

// ── Ready-made gradients ──────────────────────────────────────────────────

/**
 * What a ready-made is for:
 *   - `backdrop`: words sit on it (the board background, a band). Every stop
 *     keeps the ink the board picks for its first stop readable, and each one
 *     STARTS at the palette's background, so choosing one never changes the
 *     colour a derived palette reads off the board.
 *   - `fill`: decoration (a shape). Any palette colours.
 */
export type GradientPurpose = "backdrop" | "fill";

/** One ready-made, as palette slots. */
type Recipe = { from: PaletteSlot; via?: PaletteSlot; to: PaletteSlot; angle: number };

/** Ids are stored nowhere (a pick stores the colours): they name the swatch. */
export const BACKDROP_GRADIENT_IDS = ["soft", "light", "glow", "wash", "sunset"] as const;
export const FILL_GRADIENT_IDS = ["accent", "deep", "bright", "dusk", "ink"] as const;
export type GradientId = (typeof BACKDROP_GRADIENT_IDS)[number] | (typeof FILL_GRADIENT_IDS)[number];

const BACKDROP_RECIPES: Record<(typeof BACKDROP_GRADIENT_IDS)[number], Recipe> = {
  soft: { from: "background", to: "muted", angle: 180 },
  light: { from: "background", to: "surface", angle: 180 },
  glow: { from: "background", via: "surface", to: "muted", angle: 160 },
  wash: { from: "background", to: "accent", angle: 160 },
  sunset: { from: "background", via: "muted", to: "accent", angle: 135 },
};

const FILL_RECIPES: Record<(typeof FILL_GRADIENT_IDS)[number], Recipe> = {
  accent: { from: "accent", to: "muted", angle: 135 },
  deep: { from: "accent", to: "text", angle: 135 },
  bright: { from: "surface", to: "accent", angle: 135 },
  dusk: { from: "muted", via: "accent", to: "text", angle: 135 },
  ink: { from: "text", to: "muted", angle: 180 },
};

/**
 * WCAG AA for body text: what every stop of a backdrop gradient must keep
 * against the ink the board reads on its first stop (readableInkOn(from), the
 * same rule resolveInk applies to the board).
 */
export const BACKDROP_GRADIENT_MIN_CONTRAST = 4.5;

/** Does the board's ink read on every stop of this gradient? */
export function inkReadsAcross(fill: GradientFill): boolean {
  const ink = readableInkOn(fill.from);
  return gradientStops(fill).every((stop) => contrastRatio(ink, stop) >= BACKDROP_GRADIENT_MIN_CONTRAST);
}

export type ReadyGradient = { id: GradientId; fill: GradientFill };

/** A recipe in this palette's colours. A middle that repeats an end is dropped:
 *  it would only be a two-colour gradient spelled three ways. */
function fillFor(palette: StorefrontPalette, recipe: Recipe): GradientFill {
  const from = palette[recipe.from];
  const to = palette[recipe.to];
  const via = recipe.via ? palette[recipe.via] : undefined;
  return via === undefined || sameHex(via, from) || sameHex(via, to)
    ? { from, to, angle: recipe.angle }
    : { from, via, to, angle: recipe.angle };
}

/**
 * How far apart (WCAG contrast) a gradient's two most different stops must be
 * to read as a gradient rather than a flat colour. A backdrop is a whole page,
 * where a faint shift is the point; a fill is a small shape, where one that
 * faint is only a muddy solid.
 */
const MIN_STOP_SPREAD: Record<GradientPurpose, number> = { backdrop: 1.03, fill: 1.25 };

/** The contrast between a gradient's two most different stops. */
function stopSpread(stops: readonly string[]): number {
  let widest = 1;
  for (const a of stops) for (const b of stops) widest = Math.max(widest, contrastRatio(a, b));
  return widest;
}

/**
 * The ready-made gradients for this palette, in order, at most five. A recipe
 * is left out when its colours are one, or too close to tell apart
 * (MIN_STOP_SPREAD), when it repeats one already offered, and, for a
 * backdrop, when the board's words would not read on all of it.
 */
export function paletteGradients(palette: StorefrontPalette, purpose: GradientPurpose): ReadyGradient[] {
  const recipes: [GradientId, Recipe][] =
    purpose === "backdrop"
      ? BACKDROP_GRADIENT_IDS.map((id) => [id, BACKDROP_RECIPES[id]])
      : FILL_GRADIENT_IDS.map((id) => [id, FILL_RECIPES[id]]);
  const offered: ReadyGradient[] = [];
  for (const [id, recipe] of recipes) {
    const fill = fillFor(palette, recipe);
    const stops = gradientStops(fill);
    if (stopSpread(stops) < MIN_STOP_SPREAD[purpose]) continue;
    if (offered.some((other) => sameGradient(other.fill, fill))) continue;
    if (purpose === "backdrop" && !inkReadsAcross(fill)) continue;
    offered.push({ id, fill });
  }
  return offered;
}

/** The ready-made a stored gradient is, if it is one. */
export function readyGradientId(
  value: GradientFill | undefined,
  offered: readonly ReadyGradient[],
): GradientId | null {
  return offered.find((ready) => sameGradient(ready.fill, value))?.id ?? null;
}
