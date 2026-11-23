"use client";

import type { StorefrontBackground, StorefrontTheme } from "@/types/storefront";
import { BackgroundEditor } from "./BackgroundEditor";
import { derivePalette, withBackground } from "@/lib/storefront/palette";
import { LooksSection } from "./LooksSection";
import { PaletteRow } from "./PaletteRow";

/**
 * Theme essentials: the palette (the one place the accent and a plain
 * background colour are chosen) and the background's kind (color / gradient /
 * uploaded image). Corner roundness lives with the other card controls in CardsSection, and the
 * designer's grid guides live in the sibling "Canvas" section of this same
 * Theme group (see ControlsPanel) — they are an editor view preference, never
 * a saved theme value, and sitting here implied otherwise. Every control is
 * bound to the schema's enums / strict hex rule.
 */
/** Looks come FIRST: a whole-storefront starting point is the cheapest way out
 *  of a design that has gone wrong, and it belongs above the two controls it
 *  is a shortcut over. */
export function ThemePanel({
  theme,
  onChange,
  backgroundImageUrl,
  onBackgroundImageChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
  /** Display URL for an image background (signed or local object URL). */
  backgroundImageUrl: string | null;
  onBackgroundImageChange: (url: string | null) => void;
}) {
  function updateBackground(background: StorefrontBackground) {
    onChange(withBackground(theme, background));
  }

  return (
    <div className="space-y-4">
      <LooksSection theme={theme} onChange={onChange} />
      {/* Palette first: the five colours every picker below opens on, and
          where the accent and a plain background colour are set. */}
      <PaletteRow theme={theme} onChange={onChange} backgroundImageUrl={backgroundImageUrl} />
      <BackgroundEditor
        value={theme.background}
        onChange={updateBackground}
        imageUrl={backgroundImageUrl}
        onImageChange={onBackgroundImageChange}
        accent={theme.accent}
        palette={derivePalette(theme)}
      />
    </div>
  );
}
