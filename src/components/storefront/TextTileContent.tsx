"use client";

import type { StorefrontTheme, TextBlock } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { cn } from "@/lib/utils";
import {
  FONT_CLASSES,
  TEXT_ALIGN_CLASSES,
  TEXT_SIZE_CLASSES,
  TEXT_VARIANT_CLASSES,
  TEXT_VARIANT_WEIGHT_CLASSES,
} from "./config-maps";

/**
 * The text face of a grid tile — always a plain React text node, never markup.
 * Editing (content, style, alignment) lives in the side panel
 * (TextBlockEditor); this component only renders the current text.
 */
export function TextTileContent({
  block,
  theme,
}: {
  block: TextBlock;
  theme: StorefrontTheme;
}) {
  // An explicit block color wins; else headings pick up the accent and other
  // variants stay foreground. Every color is re-gated before touching style.
  const color =
    block.color && isStrictHexColor(block.color)
      ? block.color
      : block.variant === "heading" && isStrictHexColor(theme.accent)
        ? theme.accent
        : undefined;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col justify-center overflow-hidden whitespace-pre-line p-3",
        TEXT_ALIGN_CLASSES[block.align],
        // Per-block font override; absent = inherit the canvas font.
        block.font && FONT_CLASSES[block.font],
      )}
    >
      <p
        className={cn(
          // Explicit size replaces the variant's scale; the variant keeps
          // supplying the weight so heading/subheading/body stay distinct.
          block.fontSize
            ? cn(
                TEXT_SIZE_CLASSES[block.fontSize],
                TEXT_VARIANT_WEIGHT_CLASSES[block.variant],
              )
            : TEXT_VARIANT_CLASSES[block.variant],
          block.bold && "font-bold",
          block.italic && "italic",
          block.underline && "underline",
        )}
        style={color ? { color } : undefined}
      >
        {block.text || "Empty text block"}
      </p>
    </div>
  );
}
