/**
 * What a preview page measured (components/agent/PreviewProbe) and how the
 * server reads it back out of the rendered HTML. Pure, so the probe and the
 * server share one definition.
 */

/** The element the probe writes its measurements into. */
export const PREVIEW_TARGETS_ELEMENT_ID = "ss-preview-targets";

/**
 * The element the probe lays over a region of the board when one is asked
 * for: invisible, exactly the region's size, so the browser that photographs
 * the page can crop to it by selector (lib/agent/preview/snapshot.ts).
 */
export const PREVIEW_REGION_ELEMENT_ID = "ss-preview-region";

/** The preview page's query parameter naming a region, as `x,y,w,h` in cells. */
export const PREVIEW_REGION_PARAM = "region";

/** A rectangle of board cells, as get_storefront names a block's place. */
export type CellRegion = { x: number; y: number; w: number; h: number };

/** A rectangle in page pixels, top-left origin. */
export type PageBox = { x: number; y: number; w: number; h: number };

/** A product tile as drawn: page pixels, top-left origin. */
export type MeasuredTile = PageBox & {
  productId: string;
  title: string;
  status: string;
};

/** Where the board's grid was drawn, and how many cells it drew each way. */
export type MeasuredBoard = PageBox & { columns: number; rows: number };

export type PreviewMeasurements = {
  page: { width: number; height: number };
  tiles: MeasuredTile[];
  /** The board's grid, when the probe found it. */
  board?: MeasuredBoard;
  /** The region asked for, in page pixels, when one was asked for and drawn. */
  region?: PageBox;
};

/** How large a region may be named, each way: the board's own caps. */
const REGION_CELLS_MAX = 60;

/** A region as the preview page's query carries it. */
export function formatPreviewRegion(region: CellRegion): string {
  return [region.x, region.y, region.w, region.h].join(",");
}

/** A region from the preview page's query, or null for anything else. */
export function parsePreviewRegion(value: string | string[] | undefined): CellRegion | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,2},\d{1,2},\d{1,2},\d{1,2}$/.test(raw)) return null;
  const [x, y, w, h] = raw.split(",").map(Number);
  if (w < 1 || h < 1 || x + w > REGION_CELLS_MAX || y + h > REGION_CELLS_MAX) return null;
  return { x, y, w, h };
}

/**
 * The tracks of a laid-out grid as getComputedStyle resolves them ("190px
 * 190px 190px"), in pixels. Null when the value is not a plain list of
 * lengths, which is the case for a grid that is not laid out.
 */
export function resolvedTracks(value: string): number[] | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0 || parts.some((part) => !/^-?\d+(\.\d+)?px$/.test(part))) return null;
  return parts.map((part) => Number.parseFloat(part));
}

/**
 * The page box of a region of cells, from the grid's own box, its tracks and
 * its gaps: the left edge of the first cell to the right edge of the last.
 * Null when the region does not lie on the grid that was drawn.
 */
export function regionBox(
  grid: { x: number; y: number; columns: number[]; rows: number[]; columnGap: number; rowGap: number },
  region: CellRegion,
): PageBox | null {
  const { columns, rows, columnGap, rowGap } = grid;
  if (region.x + region.w > columns.length || region.y + region.h > rows.length) return null;
  const sum = (tracks: number[], from: number, to: number) => tracks.slice(from, to).reduce((total, size) => total + size, 0);
  return {
    x: grid.x + sum(columns, 0, region.x) + region.x * columnGap,
    y: grid.y + sum(rows, 0, region.y) + region.y * rowGap,
    w: sum(columns, region.x, region.x + region.w) + (region.w - 1) * columnGap,
    h: sum(rows, region.y, region.y + region.h) + (region.h - 1) * rowGap,
  };
}

const ELEMENT_PATTERN = new RegExp(
  `<script[^>]*id="${PREVIEW_TARGETS_ELEMENT_ID}"[^>]*>([\\s\\S]*?)</script>`,
);

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isBox = (value: unknown): value is PageBox => {
  const box = value as PageBox | undefined;
  return !!box && [box.x, box.y, box.w, box.h].every(finite);
};

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
        isBox(tile),
    );
    const board = parsed.board;
    return {
      page: { width: parsed.page.width, height: parsed.page.height },
      tiles,
      ...(isBox(board) && finite(board.columns) && finite(board.rows)
        ? { board: { x: board.x, y: board.y, w: board.w, h: board.h, columns: board.columns, rows: board.rows } }
        : {}),
      ...(isBox(parsed.region) ? { region: { x: parsed.region.x, y: parsed.region.y, w: parsed.region.w, h: parsed.region.h } } : {}),
    };
  } catch {
    return null;
  }
}
