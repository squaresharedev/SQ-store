"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import {
  headerStyleValue,
  type HeaderLine,
  type StorefrontHeader,
  type StorefrontTheme,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { headerThemeColors } from "@/lib/theme/color-target";
import { fontPresentation } from "@/lib/theme/storefront-fonts";
import { cn } from "@/lib/utils";
import { TEXT_ALIGN_CLASSES, textSizeStyle } from "./config-maps";

/**
 * The storefront masthead (store name + bio) rendered above the grid — shared
 * by the designer canvas and the list-card preview so they can never drift.
 * Plain text nodes only (schema caps + strips control chars). Each line takes
 * its own color and size when the seller set one, and otherwise inherits: the
 * name from the theme accent (exactly like text-block headings), the bio from
 * the default ink. Renders nothing when hidden or empty. `compact` scales it
 * down for small previews.
 *
 * In the DESIGNER (and only there) each line is also a target: `onSelectLine`
 * makes it clickable, which is how the left-hand panel is aimed at it. Without
 * that prop this is inert markup, so the buyer-facing previews stay exactly
 * what they always were.
 */
export function StorefrontMasthead({
  header,
  theme,
  compact = false,
  activeLine = null,
  onSelectLine,
}: {
  header: StorefrontHeader;
  theme: StorefrontTheme;
  compact?: boolean;
  /** The line the style panel is currently editing, if any. */
  activeLine?: HeaderLine | null;
  /** Present only in the editor: makes each line selectable. */
  onSelectLine?: (line: HeaderLine) => void;
}) {
  const name = header.name.trim();
  const bio = header.bio.trim();
  if (!header.show || (!name && !bio)) return null;

  // Every color is re-gated on the way out: a config is parsed from a jsonb
  // column and these land in a style attribute.
  const inherited = headerThemeColors(theme.accent);
  const nameColor = isStrictHexColor(header.nameColor ?? "")
    ? header.nameColor
    : inherited.name;
  const bioColor = isStrictHexColor(header.bioColor ?? "")
    ? header.bioColor
    : // No override: keep inheriting the surrounding foreground rather than
      // painting the default ink, so a dark canvas still reads as it always did.
      undefined;

  // A stored size replaces the line's class-driven scale, so the two never
  // fight over the same property. The compact preview keeps its own small type
  // whatever the storefront says: a 72px store name would fill a list card.
  const sizeOf = (line: HeaderLine): number | undefined => {
    const size = headerStyleValue(header, line, "size");
    return compact ? undefined : size;
  };

  /** A line's typeface. Absent (or an uploaded face this canvas could not
   *  resolve) leaves it inheriting, exactly as a text block does. */
  const fontOf = (line: HeaderLine) =>
    fontPresentation(headerStyleValue(header, line, "font"));

  const styleOf = (line: HeaderLine, color?: string): CSSProperties => {
    const size = sizeOf(line);
    return {
      ...(size ? textSizeStyle(size) : undefined),
      ...(color ? { color } : undefined),
      ...fontOf(line).style,
    };
  };

  /** Bold / italic / underline / alignment, as tokenized classes. The compact
   *  preview keeps the formatting (it is what the line IS) but not the
   *  alignment, which only means something at full width.
   *
   *  A line with no alignment of its own emits no class at all, rather than an
   *  explicit `text-left`: "unstyled" should look the same in the DOM as it
   *  does in storage, and inheriting is what the masthead has always done. */
  const alignOf = (line: HeaderLine) => headerStyleValue(header, line, "align");
  const formatClass = (line: HeaderLine) =>
    cn(
      headerStyleValue(header, line, "bold") && "font-bold",
      headerStyleValue(header, line, "italic") && "italic",
      headerStyleValue(header, line, "underline") && "underline",
      !compact && alignOf(line) && TEXT_ALIGN_CLASSES[alignOf(line)!],
      fontOf(line).className,
    );

  /** Editor-only: the hit area, its keyboard equivalent, and the ring that
   *  says which line the style panel is on. Empty outside the designer. */
  const selectable = (line: HeaderLine) =>
    onSelectLine
      ? {
          role: "button" as const,
          tabIndex: 0,
          "aria-label": `Style the store ${line}`,
          "aria-pressed": activeLine === line,
          onClick: () => onSelectLine(line),
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onSelectLine(line);
          },
        }
      : {};

  const selectableClass = (line: HeaderLine) =>
    onSelectLine &&
    cn(
      "cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      activeLine === line
        ? "ring-2 ring-ring ring-offset-1"
        : "hover:ring-1 hover:ring-border",
    );

  return (
    <div className={cn("space-y-1", compact ? "mb-2" : "mb-4")}>
      {name && (
        <h2
          {...selectable("name")}
          className={cn(
            // The line's own weight beats this default, so a seller who asked
            // for bold gets 700 rather than the masthead's semibold.
            "font-semibold",
            compact ? "truncate text-sm" : !sizeOf("name") && "text-xl sm:text-2xl",
            formatClass("name"),
            selectableClass("name"),
          )}
          style={styleOf("name", nameColor)}
        >
          {header.name}
        </h2>
      )}
      {bio && (
        <p
          {...selectable("bio")}
          className={cn(
            "whitespace-pre-line",
            compact ? "truncate text-xs" : !sizeOf("bio") && "text-sm",
            formatClass("bio"),
            selectableClass("bio"),
          )}
          style={styleOf("bio", bioColor)}
        >
          {header.bio}
        </p>
      )}
    </div>
  );
}
