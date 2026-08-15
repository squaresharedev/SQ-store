"use client";

import type { CardStyleOverrides, StorefrontTheme } from "@/types/storefront";
import { PriceTagControls } from "./PriceTagControls";

/**
 * Price tag appearance for the whole theme: the shared PriceTagControls
 * working on the theme's own price tag fields (the same component each product
 * tile's inspector uses on its overrides).
 */
export function PriceTagSection({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  /**
   * Unlike the card fields, three of these are optional: clearing a color
   * emits `undefined`, and spreading that would leave a key holding nothing.
   * Drop it instead, so a theme whose colors were set and cleared is
   * indistinguishable from one that never had them — the same rule
   * mergeCardStyleOverrides applies on the per-tile side.
   */
  function applyPatch(patch: CardStyleOverrides) {
    const next: Record<string, unknown> = { ...theme, ...patch };
    for (const key of Object.keys(patch)) {
      if (next[key] === undefined) delete next[key];
    }
    onChange(next as StorefrontTheme);
  }

  // No `overrides`: this IS the theme layer, so an unset color reads as unset
  // rather than as "following" something behind it.
  return <PriceTagControls theme={theme} onChange={applyPatch} scope="theme" />;
}
