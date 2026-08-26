"use client";

import {
  resolveCardStyle,
  type CardStyleOverrides,
  type StorefrontTheme,
} from "@/types/storefront";
import { CardStyleControls } from "./CardStyleControls";

/**
 * Card appearance for the whole theme: the shared CardStyleControls working on
 * the theme's own card fields (the same component each product tile's inspector
 * uses on its overrides). A patch from the controls spreads straight into the
 * theme.
 *
 * The sold-out badge used to live here and now sits in SoldOutSection, beside
 * the switch that hides sold-out products outright: the two answer one question
 * between them, and splitting them across "Cards" and "Advanced" meant neither
 * place answered it.
 */
export function CardsSection({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  function applyPatch(patch: CardStyleOverrides) {
    onChange({ ...theme, ...patch });
  }

  return (
    <CardStyleControls value={resolveCardStyle(theme)} onChange={applyPatch} />
  );
}
