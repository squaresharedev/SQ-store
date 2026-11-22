import { BAND_EXTENT_STYLE, bandAnchorId, bandLayers } from "@/lib/storefront/bands";
import type { StorefrontBand } from "@/types/storefront";

/**
 * WHAT A FULL-WIDTH BAND PAINTS: its colour, gradient or photo (with the veil
 * that keeps words on it readable), reaching past the board to the full width
 * of whatever the board sits in (BAND_EXTENT_STYLE). Drawn by the grid in the
 * layer under every block, on the buyer's board and on the designer's canvas
 * alike, so the two cannot disagree.
 *
 * Carries the band's anchor (`id`), which is what a link to the band scrolls
 * to; the canvas leaves it off, since an editor is no page to link into.
 * Pictures only: nothing here is for a screen reader, and it takes no presses.
 */
export function BandPaint({
  band,
  imageUrl,
  anchor = true,
}: {
  band: StorefrontBand;
  /** The band photo's display URL, signed on the server (or local, right after
   *  an upload). Absent draws the photo's quiet placeholder. */
  imageUrl?: string | null;
  anchor?: boolean;
}) {
  const layers = bandLayers(band.background, imageUrl);
  return (
    <div
      id={anchor ? bandAnchorId(band.id) : undefined}
      data-band={band.id}
      className="pointer-events-none absolute scroll-mt-16 overflow-hidden"
      style={{ ...BAND_EXTENT_STYLE, ...layers.fill }}
    >
      {layers.photo && <div className="absolute inset-0" style={layers.photo} />}
      {layers.veil && <div className="absolute inset-0" style={layers.veil} />}
    </div>
  );
}
