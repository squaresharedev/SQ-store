"use client";

import type { CSSProperties } from "react";
import type { MarqueeBlock, StorefrontTheme } from "@/types/storefront";
import { resolveTextStyle } from "@/lib/storefront/text-styles";
import { fontRoleStyle } from "@/lib/theme/font-roles";
import { marqueeInk, marqueeTrack } from "@/lib/storefront/marquee";
import { cn } from "@/lib/utils";
import { TEXT_VARIANT_WEIGHT_CLASSES } from "./config-maps";
import { useEditorSlots } from "./editor-slots";

/**
 * The face of a SCROLLING TEXT STRIP: one line of words crossing its block,
 * over and over (lib/storefront/marquee; the moving is CSS, globals.css).
 *
 * Set in a saved text style (resolveTextStyle, Small label unless the strip
 * names another) in that style's face of the pairing (fontRoleStyle), so it
 * matches the board's other words with nothing configured. Its ink: its own
 * colour, else the style's, else one that reads on `backdrop`.
 *
 * READ ONCE. The words are in the page once, for screen readers; the moving
 * copies are decoration and hidden from them. The strip pauses under the
 * pointer and while it has focus (on a buyer's page it takes focus, so a
 * keyboard can stop it), and under reduced motion it stands still, showing
 * the words once. The words are a React text node, never markup.
 */
export function MarqueeTileContent({
  block,
  theme,
  backdrop,
}: {
  block: MarqueeBlock;
  theme: StorefrontTheme;
  /** The hex the words are read against (see BlockFace). Absent = not known. */
  backdrop?: string;
}) {
  // The designer's canvas handles its own focus and keys; only a buyer's page
  // needs the strip to be reachable by keyboard to pause it.
  const inDesigner = useEditorSlots().InlineTextEditor !== null;
  const variant = block.variant ?? "label";
  const style = resolveTextStyle(theme, variant);
  const ink = marqueeInk(block, style, backdrop);
  const { copies, halfChars } = marqueeTrack(block.text);

  return (
    <div
      className={cn(
        // relative: the screen reader copy (sr-only) is positioned, and must not
        // escape the strip and widen the page.
        "board-marquee relative flex min-h-0 flex-1 items-center overflow-hidden outline-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current",
        style.bold === undefined ? TEXT_VARIANT_WEIGHT_CLASSES[variant] : style.bold ? "font-bold" : "font-normal",
        style.italic && "italic",
        style.uppercase && "uppercase",
      )}
      data-speed={block.speed ?? "normal"}
      tabIndex={inDesigner ? undefined : 0}
      style={{
        ...fontRoleStyle(style.font),
        fontSize: `${style.size}px`,
        ...(style.letterSpacing !== undefined ? { letterSpacing: `${style.letterSpacing / 100}em` } : {}),
        ...(ink ? { color: ink } : {}),
      }}
    >
      <span className="sr-only">{block.text}</span>
      <div
        aria-hidden="true"
        className="board-marquee-track flex w-max shrink-0"
        style={{ "--marquee-chars": halfChars } as CSSProperties}
      >
        {Array.from({ length: copies * 2 }, (_, index) => (
          <span key={index} className="board-marquee-copy shrink-0 whitespace-nowrap">
            {block.text}
          </span>
        ))}
      </div>
    </div>
  );
}
