/**
 * What a preview page measured (components/agent/PreviewProbe) and how the
 * server reads it back out of the rendered HTML. Pure, so the probe and the
 * server share one definition.
 */

/** The element the probe writes its measurements into. */
export const PREVIEW_TARGETS_ELEMENT_ID = "ss-preview-targets";

/** A product tile as drawn: page pixels, top-left origin. */
export type MeasuredTile = {
  productId: string;
  title: string;
  status: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PreviewMeasurements = { page: { width: number; height: number }; tiles: MeasuredTile[] };

const ELEMENT_PATTERN = new RegExp(
  `<script[^>]*id="${PREVIEW_TARGETS_ELEMENT_ID}"[^>]*>([\\s\\S]*?)</script>`,
);

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The measurements in a rendered preview page, or null when there are none. */
export function readMeasurements(html: string): PreviewMeasurements | null {
  const match = ELEMENT_PATTERN.exec(html);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as PreviewMeasurements;
    if (!finite(parsed?.page?.width) || !finite(parsed.page.height) || !Array.isArray(parsed.tiles)) return null;
    const tiles = parsed.tiles.filter(
      (tile) =>
        typeof tile?.productId === "string" &&
        typeof tile.title === "string" &&
        typeof tile.status === "string" &&
        [tile.x, tile.y, tile.w, tile.h].every(finite),
    );
    return { page: { width: parsed.page.width, height: parsed.page.height }, tiles };
  } catch {
    return null;
  }
}
