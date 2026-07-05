"use client";

import type { StorefrontTheme, TextBlock } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { cn } from "@/lib/utils";
import { TEXT_ALIGN_CLASSES, TEXT_VARIANT_CLASSES } from "./config-maps";

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
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col justify-center overflow-hidden whitespace-pre-line p-3",
        TEXT_ALIGN_CLASSES[block.align],
      )}
    >
      <p
        className={cn(
          TEXT_VARIANT_CLASSES[block.variant],
          block.bold && "font-bold",
          block.italic && "italic",
          block.underline && "underline",
        )}
        // Headings pick up the accent; body text stays foreground for
        // readability. Accent is schema-gated hex; re-check regardless.
        style={
          block.variant === "heading" && isStrictHexColor(theme.accent)
            ? { color: theme.accent }
            : undefined
        }
      >
        {block.text || "Empty text block"}
      </p>
    </div>
  );
}
