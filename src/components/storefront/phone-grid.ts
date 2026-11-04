import type { GridBlock } from "@/components/grid/gridConstants";
import { phoneLayout } from "@/lib/storefront/mobile-layout";
import {
  MOBILE_LAYOUT_MAX_WIDTH_PX,
  blockKey,
  drawnOnPhone,
  layerOrder,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";

/**
 * A board's phone layout in the shape <Grid narrowLayout> draws, or null when
 * the board has none. Shared by every place a board is drawn for a buyer or
 * previewed for a phone, so they cannot disagree about where a block goes.
 * Depth is the board's own: a block keeps its place in the stack on a phone.
 * Each block is handed over as the phone draws it (drawnOnPhone).
 */
export function phoneGridLayout(
  theme: StorefrontTheme,
  blocks: readonly StorefrontBlock[],
): { maxWidth: number; columns: number; rows: number; blocks: GridBlock<StorefrontBlock>[] } | null {
  const layout = phoneLayout(theme, blocks);
  if (!layout) return null;
  const depths = new Map(layerOrder([...blocks]).map((block, index) => [blockKey(block), index]));
  return {
    maxWidth: MOBILE_LAYOUT_MAX_WIDTH_PX,
    columns: layout.columns,
    rows: layout.rows,
    blocks: layout.placed.map((spot) => {
      const key = blockKey(spot.block);
      return {
        key,
        x: spot.x,
        y: spot.y,
        w: spot.w,
        h: spot.h,
        rotation: spot.block.rotation,
        z: depths.get(key),
        data: drawnOnPhone(spot.block),
      };
    }),
  };
}
