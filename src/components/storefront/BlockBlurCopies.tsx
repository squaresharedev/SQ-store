"use client";

import type { StorefrontBlock, StorefrontTheme } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { BlockFace } from "./BlockFace";
import { TILE_FACE_CLASS, blockBlurCopyStyles } from "./config-maps";

/**
 * THE COPIES THAT MAKE A BLOCK BLUR FROM ONE EDGE: the block again at half
 * blur and sharp, exactly over its fully blurred face, each fading in as the
 * one under it fades out and added to it (see blockBlurStyle for why a
 * one-edge blur is three cross-faded layers). Rendered straight after the
 * face, in the same frame, by every surface that draws a tile.
 *
 * Nothing for a block that is sharp or blurred all over, so most tiles never
 * draw any. Pictures only: the face already tells assistive tech what the
 * block is, and the pointer passes through to the tile underneath.
 */
export function BlockBlurCopies({
  block,
  theme,
  imageUrl,
}: {
  block: StorefrontBlock;
  theme: StorefrontTheme;
  /** Image blocks only: the same signed URL the face is drawing. */
  imageUrl?: string | null;
}) {
  return blockBlurCopyStyles(block).map((style, index) => (
    <div
      key={index}
      aria-hidden="true"
      inert
      data-blur-copy=""
      className={cn(TILE_FACE_CLASS, "pointer-events-none absolute inset-0")}
      style={style}
    >
      <BlockFace block={block} product={null} theme={theme} imageUrl={imageUrl} />
    </div>
  ));
}
