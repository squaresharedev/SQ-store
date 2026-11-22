"use client";

import type { ButtonBlock, StorefrontTheme } from "@/types/storefront";

/**
 * The face of a button block: a few words that lead somewhere.
 *
 * CONTRACT STUB (editor upgrade, layout and navigation): the block kind exists
 * in the schema and every renderer already dispatches here, so this file is
 * the one place its face is drawn. Until it is built it shows its own words,
 * plainly.
 */
export function ButtonTileContent({
  block,
}: {
  block: ButtonBlock;
  theme: StorefrontTheme;
  /** The hex the words are read against (see BlockFace). Absent = not known. */
  backdrop?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 text-center text-sm">
      {block.label}
    </div>
  );
}
