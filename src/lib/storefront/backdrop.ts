import { storefrontBackdropHex } from "@/components/product-page/product-page-maps";
import type { BandBackground, BlockPlacement, StorefrontBand, StorefrontTheme } from "@/types/storefront";

/**
 * WHAT A BLOCK IS READ AGAINST: one hex standing in for whatever is painted
 * behind it, so a face with no colour of its own (a text block, a button, a
 * scrolling strip) can pick the ink that reads there.
 *
 * A block sitting on a full-width band is read against the band; every other
 * block against the board's own background. Pure and React-free: the board
 * (StorefrontBoard, the designer's canvas) asks once per block and hands the
 * answer to BlockFace as `backdrop`.
 *
 * Like storefrontBackdropHex, a single colour is an honest answer for a solid
 * and an approximation for the rest: a gradient answers with the colour it
 * starts from, a photo with the veil laid over it, and a photo with no veil
 * with dark (a photograph is assumed busy, the safe direction for legibility).
 */

const DARK = "#171717";
const LIGHT = "#ffffff";

/** A hex standing in for a band's backdrop. */
export function bandBackdropHex(background: BandBackground): string {
  switch (background.kind) {
    case "solid":
      return background.color;
    case "gradient":
      return background.from;
    case "image":
      return background.dim === "light" ? LIGHT : DARK;
  }
}

/**
 * The band a block sits on, if any: the one behind the block's MIDDLE row.
 * The middle, not any overlap, so a block that only grazes a band's edge is
 * still read against what most of it sits on. Where bands overlap, the later
 * one in the list paints on top and so is the one behind the block.
 */
export function bandBehind(
  bands: readonly StorefrontBand[] | undefined,
  block: Pick<BlockPlacement, "y" | "h">,
): StorefrontBand | null {
  if (!bands?.length) return null;
  const middle = block.y + block.h / 2;
  for (let index = bands.length - 1; index >= 0; index -= 1) {
    const band = bands[index];
    if (middle >= band.y && middle <= band.y + band.h) return band;
  }
  return null;
}

/** The hex a block is read against: its band's, else the board's. */
export function backdropHex(
  theme: Pick<StorefrontTheme, "background">,
  bands: readonly StorefrontBand[] | undefined,
  block: Pick<BlockPlacement, "y" | "h">,
): string {
  const band = bandBehind(bands, block);
  return band ? bandBackdropHex(band.background) : storefrontBackdropHex(theme);
}
