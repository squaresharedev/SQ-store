"use client";

import { patchThemeCardStyle, type StorefrontTheme } from "@/types/storefront";
import { ChipScaleControl } from "./ChipScaleControl";
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
  // Unlike the card fields, three of these are optional: clearing a color
  // emits `undefined`, which patchThemeCardStyle drops. No `overrides`: this
  // IS the theme layer, so an unset color reads as unset rather than as
  // "following" something behind it.
  return (
    <PriceTagControls
      theme={theme}
      onChange={(patch) => onChange(patchThemeCardStyle(theme, patch))}
      scope="theme"
      afterSize={<ChipScaleControl theme={theme} onChange={onChange} />}
    />
  );
}
