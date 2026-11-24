"use client";

import { ArrowRight } from "lucide-react";
import { buttonBlockPaint, BUTTON_FACE_CLASS, buttonLabelClass } from "@/lib/storefront/button-paint";
import { resolveCta, storefrontBackdropHex } from "@/components/product-page/product-page-maps";
import type { TileLook } from "@/lib/storefront/tile-look";
import type { ButtonBlock, StorefrontTheme } from "@/types/storefront";
import { cn } from "@/lib/utils";

/**
 * The face of a button block: a few words that lead somewhere.
 *
 * THE BLOCK IS THE BUTTON. It fills its cells (half cells, usually: a new
 * button is two cells wide and half a cell tall), so sizing the block sizes
 * the button, and on a buyer's board the whole of it is the link (the board
 * wraps it in the anchor; this face only paints). Its paint is the
 * storefront's own button, the one the product page and the cards wear
 * (TileLook.buy): solid is that button; outline and link carry its colour in
 * the words, swapped for an ink that reads where it would not on what the
 * button sits on (`backdrop`).
 */
export function ButtonTileContent({
  block,
  theme,
  backdrop,
  look,
}: {
  block: ButtonBlock;
  theme: StorefrontTheme;
  /** The hex the words are read against (see BlockFace). Absent = the board's
   *  own background. */
  backdrop?: string;
  /** What the board's buttons are painted from. Absent = the theme's accent,
   *  as the product page's button is with nothing of its own. */
  look?: TileLook;
}) {
  const cta = look?.buy ?? resolveCta({}, theme);
  const kind = block.look ?? "solid";
  const paint = buttonBlockPaint(kind, cta, backdrop ?? storefrontBackdropHex(theme));
  return (
    <div className={BUTTON_FACE_CLASS} data-button-look={kind}>
      <span className={cn("flex min-w-0 max-w-full items-center justify-center gap-1.5 px-3", kind !== "link" && "size-full")} style={paint}>
        <span className={buttonLabelClass(kind)}>{block.label}</span>
        {kind === "link" && <ArrowRight className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />}
      </span>
    </div>
  );
}

