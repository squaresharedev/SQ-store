import type { CSSProperties } from "react";
import { cssUrl } from "@/components/storefront/background-presets";
import { storefrontBackdropHex } from "@/components/product-page/product-page-maps";
import { bandBackdropHex, bandBehind } from "@/lib/storefront/backdrop";
import { derivePalette } from "@/lib/storefront/palette";
import {
  BANDS_MAX,
  DEFAULT_IMAGE_PLACEMENT,
  blockFootprint,
  blockKey,
  readingOrder,
  type BandBackground,
  type BandDim,
  type GradientFill,
  type HeaderLink,
  type StorefrontBand,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";

// FULL-WIDTH BANDS, as pure data (types/storefront, FULL-WIDTH BANDS): what a
// band paints, which blocks sit on it, and the edits the designer and an
// assistant make to the list. No React, so the board, the canvas, the save
// and the tests all run the same rules.
//
// Raw colours are allowed in THIS file alone, as in background-presets: the
// veils below are token definitions for a storefront's own canvas.

/** A band's id, as the page's anchor a link scrolls to. */
export function bandAnchorId(bandId: string): string {
  return `band-${bandId}`;
}

/** The fragment a link names to reach a band on its own page. */
export function bandFragment(bandId: string): string {
  return `#${bandAnchorId(bandId)}`;
}

/**
 * THE VEILS over a band's photo, strong enough that the ink chosen for it
 * (backdrop.ts answers a veiled photo with the veil's colour) reads at WCAG AA
 * whatever the photo underneath: the light one keeps dark words at 6:1 even
 * over black, the dark one keeps white words at 4.7:1 even over white.
 */
export const BAND_VEILS: Record<Exclude<BandDim, "none">, string> = {
  light: "rgba(255,255,255,0.6)",
  dark: "rgba(0,0,0,0.55)",
};

/** What a band photo shows until its picture arrives (or when it cannot be
 *  signed): a quiet neutral, never a broken image. */
const BAND_PHOTO_BASE = "#d4d4d4";

/** A new band's photo is veiled dark, so words put on it read from the start. */
export const NEW_BAND_PHOTO_DIM: BandDim = "dark";

/**
 * A gradient as CSS. THE SWAP POINT: the motion-and-finish workstream is
 * writing the shared gradient-to-CSS helper; this is the band's own copy until
 * the two are merged, kept to the same shape so it can simply be replaced.
 */
export function gradientCss(fill: GradientFill): string {
  const stops = fill.via ? [fill.from, fill.via, fill.to] : [fill.from, fill.to];
  return `linear-gradient(${fill.angle}deg, ${stops.join(", ")})`;
}

/**
 * READY-MADE GRADIENTS from the storefront's palette, the only gradients a
 * seller is offered for a band (never a gradient editor). Same swap point as
 * gradientCss: the shared palette gradients replace this list on merge. A
 * gradient between two equal colours is left out, since it is a solid.
 */
export function paletteGradients(theme: StorefrontTheme): GradientFill[] {
  const palette = derivePalette(theme);
  const candidates: GradientFill[] = [
    { from: palette.background, to: palette.muted, angle: 180 },
    { from: palette.surface, to: palette.muted, angle: 135 },
    { from: palette.muted, via: palette.surface, to: palette.background, angle: 90 },
    { from: palette.accent, to: palette.text, angle: 135 },
  ];
  const seen = new Set<string>();
  return candidates.filter((fill) => {
    const key = gradientCss(fill).toLowerCase();
    const flat = fill.from.toLowerCase() === fill.to.toLowerCase() && (!fill.via || fill.via.toLowerCase() === fill.to.toLowerCase());
    if (flat || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The palette's colours a band can be painted in, each once, in slot order. */
export function bandSwatches(theme: StorefrontTheme): string[] {
  const palette = derivePalette(theme);
  return [...new Set([palette.muted, palette.surface, palette.accent, palette.text, palette.background].map((hex) => hex.toLowerCase()))];
}

/** The three layers a band is painted in: its fill, a photo, and a veil over
 *  the photo. Only the fill exists for a colour or a gradient. */
export type BandLayers = { fill: CSSProperties; photo?: CSSProperties; veil?: CSSProperties };

/**
 * What a band paints, as safe CSS: every input is schema-checked (strict hex,
 * whole degrees, a placement in bounds) and a photo arrives as a display URL
 * signed on the server, never typed by anyone.
 *
 * A photo COVERS the band (a band is as wide as the page and as tall as its
 * rows, so no single size fits it), centred on the seller's focal point and
 * zoomed past cover by its scale.
 */
export function bandLayers(background: BandBackground, imageUrl?: string | null): BandLayers {
  switch (background.kind) {
    case "solid":
      return { fill: { backgroundColor: background.color } };
    case "gradient":
      return { fill: { backgroundImage: gradientCss(background) } };
    case "image": {
      const placement = { x: background.x, y: background.y, scale: background.scale };
      const origin = `${placement.x}% ${placement.y}%`;
      const veil = background.dim && background.dim !== "none" ? BAND_VEILS[background.dim] : null;
      return {
        fill: { backgroundColor: BAND_PHOTO_BASE },
        ...(imageUrl
          ? {
              photo: {
                backgroundImage: cssUrl(imageUrl),
                backgroundSize: "cover",
                backgroundPosition: origin,
                backgroundRepeat: "no-repeat",
                ...(placement.scale === 100
                  ? {}
                  : { transform: `scale(${placement.scale / 100})`, transformOrigin: origin }),
              },
            }
          : {}),
        ...(veil ? { veil: { backgroundColor: veil } } : {}),
      };
    }
  }
}

/**
 * Where a band's paint reaches: half a gap past its first and last rows (so
 * two bands meet with no seam and a block in its edge row is not flush with
 * it), and out to the full width of whatever the board sits in. That width
 * comes from the frame around the board as --sf-band-bleed (globals.css,
 * .sf-band-frame; the designer sets its own); without one the band is exactly
 * as wide as the board.
 */
export const BAND_EXTENT_STYLE: CSSProperties = {
  top: "calc(var(--grid-gap, 0px) / -2)",
  bottom: "calc(var(--grid-gap, 0px) / -2)",
  left: "calc(-1 * var(--sf-band-bleed, 0px))",
  right: "calc(-1 * var(--sf-band-bleed, 0px))",
};

/** The class on the frame that holds a board with bands (the hosted page's
 *  and the embed frame's), giving them their full width (globals.css). */
export const BAND_FRAME_CLASS = "sf-band-frame";

/** How far the designer's frame reaches past the board on each side: its own
 *  padding (`p-4`), so a band on the canvas runs to the frame's edges. */
export const DESIGNER_BAND_BLEED = "1rem";

/**
 * Which blocks sit on each band: the one behind the block's middle row
 * (bandBehind), read off the cells it covers, so the band a block is read
 * against and the band that follows it on a phone are always the same band.
 */
export function bandMembers(
  bands: readonly StorefrontBand[] | undefined,
  blocks: readonly StorefrontBlock[],
): Map<string, string[]> {
  const members = new Map<string, string[]>();
  if (!bands?.length) return members;
  // In reading order, so each band's first member is its lead (followRows).
  for (const block of readingOrder([...blocks])) {
    const band = bandBehind(bands, blockFootprint(block));
    if (!band) continue;
    const list = members.get(band.id) ?? [];
    list.push(blockKey(block));
    members.set(band.id, list);
  }
  return members;
}

/**
 * The hex BlockFace is handed as `backdrop`, or nothing.
 *
 * Only where it is NEW information. A block sitting on a band is read against
 * the band; a button or a scrolling strip (kinds that did not exist before)
 * always against whatever is behind it. Every other block on the plain board
 * gets nothing, so a face that would pick its ink from a backdrop keeps the
 * ink it has always had there, and no existing storefront changes colour.
 */
export function blockBackdrop(
  theme: Pick<StorefrontTheme, "background">,
  bands: readonly StorefrontBand[] | undefined,
  block: StorefrontBlock,
  /** The band the grid says is DRAWN behind the block on the board as laid
   *  out (GridBlockState.underlayKey), which on a phone can differ from the
   *  one behind its stored rows. Absent = read it off the stored rows. */
  drawnOn?: string | null,
): string | undefined {
  const band =
    drawnOn === undefined
      ? bandBehind(bands, blockFootprint(block))
      : (bands?.find((candidate) => candidate.id === drawnOn) ?? null);
  if (!band && block.type !== "button" && block.type !== "marquee") return undefined;
  return band ? bandBackdropHex(band.background) : storefrontBackdropHex(theme);
}

/** The last row any band reaches, for a board that draws only the rows it
 *  uses: 0 with none. */
export function bandsBottom(bands: readonly StorefrontBand[] | undefined): number {
  return Math.max(0, ...(bands ?? []).map((band) => band.y + band.h));
}

// ── Edits ─────────────────────────────────────────────────────────────────

/** How many rows a new band covers, when the board has them. */
export const NEW_BAND_ROWS = 2;

/**
 * Where a new band goes: the first run of rows no band covers yet, as tall as
 * NEW_BAND_ROWS where there is room, from the top. Null when every row of the
 * board already has a band behind it, or the list is full.
 */
export function newBandRows(
  bands: readonly StorefrontBand[],
  rows: number,
  near?: number,
): { y: number; h: number } | null {
  if (bands.length >= BANDS_MAX) return null;
  const covered = new Set<number>();
  for (const band of bands) for (let row = band.y; row < band.y + band.h; row += 1) covered.add(row);
  const start = near !== undefined ? Math.min(Math.max(0, near), rows - 1) : 0;
  const order = [...Array.from({ length: rows - start }, (_, i) => start + i), ...Array.from({ length: start }, (_, i) => i)];
  for (const y of order) {
    if (covered.has(y)) continue;
    let h = 1;
    while (h < NEW_BAND_ROWS && y + h < rows && !covered.has(y + h)) h += 1;
    return { y, h };
  }
  return null;
}

/** A new band, painted in the palette's muted colour: a quiet section that
 *  reads as one on any storefront. */
export function newBand(id: string, rowsAt: { y: number; h: number }, theme: StorefrontTheme): StorefrontBand {
  return { id, y: rowsAt.y, h: rowsAt.h, background: { kind: "solid", color: derivePalette(theme).muted } };
}

/** A band's rows moved or stretched, held to the board: never above the first
 *  row, never past the last, never shorter than one. */
export function placeBand(band: StorefrontBand, at: { y: number; h: number }, rows: number): StorefrontBand {
  const h = Math.min(Math.max(1, Math.round(at.h)), rows);
  const y = Math.min(Math.max(0, Math.round(at.y)), rows - h);
  return y === band.y && h === band.h ? band : { ...band, y, h };
}

/** The list with one band replaced (by id). */
export function replaceBand(bands: readonly StorefrontBand[], next: StorefrontBand): StorefrontBand[] {
  return bands.map((band) => (band.id === next.id ? next : band));
}

/** A background for a band of the kind asked for, starting from what it has:
 *  the first swatch, the first ready-made gradient, or the photo it had. */
export function backgroundOfKind(
  kind: BandBackground["kind"],
  current: BandBackground,
  theme: StorefrontTheme,
): BandBackground | null {
  if (kind === current.kind) return current;
  if (kind === "solid") return { kind: "solid", color: bandSwatches(theme)[0] };
  if (kind === "gradient") {
    const fill = paletteGradients(theme)[0];
    return fill ? { kind: "gradient", ...fill } : null;
  }
  return null;
}

/** A photo background for a freshly uploaded key: centred, veiled dark. */
export function photoBackground(key: string): BandBackground {
  return { kind: "image", key, ...DEFAULT_IMAGE_PLACEMENT, dim: NEW_BAND_PHOTO_DIM };
}

/** The ids of every band a link on this board leads to, so the panel can say
 *  why one cannot be taken away yet. */
export function linkedBandIds(blocks: readonly StorefrontBlock[], links: readonly HeaderLink[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) if (block.type === "button" && block.link.kind === "band") ids.add(block.link.bandId);
  for (const entry of links ?? []) if (entry.link.kind === "band") ids.add(entry.link.bandId);
  return ids;
}

/**
 * The bands as a save stores them: held to the board's rows (a board made
 * shorter since would otherwise leave a band the schema refuses), and none
 * at all when there are none, so a storefront that never had a band saves
 * exactly as it did.
 */
export function bandsForSave(bands: readonly StorefrontBand[], rows: number): { bands?: StorefrontBand[] } {
  const fitted = bands.flatMap((band) => (band.y >= rows ? [] : [band.y + band.h > rows ? { ...band, h: rows - band.y } : band]));
  return fitted.length > 0 ? { bands: fitted } : {};
}

/** Every photo key the bands hold, each once. */
export function bandPhotoKeys(bands: readonly StorefrontBand[] | undefined): string[] {
  return [...new Set((bands ?? []).flatMap((band) => (band.background.kind === "image" ? [band.background.key] : [])))];
}
