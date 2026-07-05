"use client";

import type { StorefrontHeader, StorefrontTheme } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { cn } from "@/lib/utils";

/**
 * The storefront masthead (store name + bio) rendered above the grid — shared
 * by the designer canvas and the list-card preview so they can never drift.
 * Plain text nodes only (schema caps + strips control chars); the name takes
 * the theme accent exactly like text-block headings do. Renders nothing when
 * hidden or empty. `compact` scales it down for small previews.
 */
export function StorefrontMasthead({
  header,
  theme,
  compact = false,
}: {
  header: StorefrontHeader;
  theme: StorefrontTheme;
  compact?: boolean;
}) {
  const name = header.name.trim();
  const bio = header.bio.trim();
  if (!header.show || (!name && !bio)) return null;

  return (
    <div className={cn("space-y-1", compact ? "mb-2" : "mb-4")}>
      {name && (
        <h2
          className={cn(
            "font-semibold",
            compact ? "truncate text-sm" : "text-xl sm:text-2xl",
          )}
          style={
            isStrictHexColor(theme.accent) ? { color: theme.accent } : undefined
          }
        >
          {header.name}
        </h2>
      )}
      {bio && (
        <p
          className={cn(
            "whitespace-pre-line",
            compact ? "truncate text-xs" : "text-sm",
          )}
        >
          {header.bio}
        </p>
      )}
    </div>
  );
}
