"use client";

import type { MarqueeBlock, StorefrontTheme } from "@/types/storefront";

/**
 * The face of a scrolling text strip.
 *
 * CONTRACT STUB (editor upgrade, motion and finish): the block kind exists in
 * the schema and every renderer already dispatches here, so this file is the
 * one place its face is drawn. Until it is built it shows its own words,
 * plainly and still.
 */
export function MarqueeTileContent({
  block,
}: {
  block: MarqueeBlock;
  theme: StorefrontTheme;
  /** The hex the words are read against (see BlockFace). Absent = not known. */
  backdrop?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 text-center text-sm">
      {block.text}
    </div>
  );
}
