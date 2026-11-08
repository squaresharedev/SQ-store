"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { StorefrontBackground, StorefrontTheme } from "@/types/storefront";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { infoTextClass } from "@/components/ui/control-styles";
import { BackgroundEditor } from "./BackgroundEditor";
import { LooksSection } from "./LooksSection";

/**
 * Theme essentials: background (color / gradient / uploaded image) and accent.
 * Corner roundness lives with the other card controls in CardsSection, and the
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
  const t = useTranslations("Storefront.themePanel");
  const fieldId = useId();

  function updateBackground(background: StorefrontBackground) {
    onChange({ ...theme, background });
  }

  return (
    <div className="space-y-4">
      <LooksSection theme={theme} onChange={onChange} />
      <BackgroundEditor
        value={theme.background}
        onChange={updateBackground}
        imageUrl={backgroundImageUrl}
        onImageChange={onBackgroundImageChange}
        accent={theme.accent}
      />
      {/* "Accent" is a role, not a thing on the page, so the line under it
          names what it colours. */}
      <div className="space-y-1">
        <ColorPicker
          id={`${fieldId}-accent`}
          label={t("accent")}
          value={theme.accent}
          onChange={(accent) => onChange({ ...theme, accent })}
          target={{ kind: "theme-accent" }}
        />
        <p className={infoTextClass}>{t("accentHint")}</p>
      </div>
    </div>
  );
}
