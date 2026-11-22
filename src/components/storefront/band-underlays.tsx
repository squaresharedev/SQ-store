import type { ReactNode } from "react";
import { followRows, type GridBlock, type GridUnderlay } from "@/components/grid/gridConstants";
import { bandMembers } from "@/lib/storefront/bands";
import type { StorefrontBand, StorefrontBlock } from "@/types/storefront";
import { BandPaint } from "./BandPaint";

/**
 * A board's bands in the shape <Grid underlays> draws: each one's rows, the
 * blocks sitting on it (which it follows on a phone), and its paint. Shared
 * by the buyer's board and the designer's canvas so the two agree on which
 * blocks a band carries. Undefined with no bands, so a board without any
 * hands the grid nothing new.
 */
export function bandUnderlays(
  bands: readonly StorefrontBand[] | undefined,
  blocks: readonly StorefrontBlock[],
  options: {
    /** A band photo's display URL. */
    imageUrl: (band: StorefrontBand) => string | null | undefined;
    /** Put the band's anchor on its paint (buyer pages; never the canvas). */
    anchor: boolean;
    /** The editor's controls for a band, when there are any. */
    chrome?: (band: StorefrontBand) => ReactNode;
  },
): GridUnderlay[] | undefined {
  if (!bands?.length) return undefined;
  const members = bandMembers(bands, blocks);
  return bands.map((band) => ({
    key: band.id,
    y: band.y,
    h: band.h,
    members: members.get(band.id) ?? [],
    node: <BandPaint band={band} imageUrl={options.imageUrl(band)} anchor={options.anchor} />,
    ...(options.chrome ? { chrome: options.chrome(band) } : {}),
  }));
}

/**
 * Underlays moved onto a board that is DRAWN from other placements than the
 * rows they name (the designer's editable phone board, which the grid lays
 * out as placed): each runs from the first to the last of its blocks there,
 * as the grid's own reflow does, and one with none of them is left out.
 */
export function followUnderlays(
  underlays: GridUnderlay[] | undefined,
  placed: readonly GridBlock<unknown>[],
): GridUnderlay[] | undefined {
  return underlays?.flatMap((underlay) => {
    const rows = followRows(underlay.members ?? [], placed);
    return rows ? [{ ...underlay, ...rows, chrome: undefined }] : [];
  });
}
