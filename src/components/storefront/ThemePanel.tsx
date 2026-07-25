"use client";

import { useId } from "react";
import type { StorefrontBackground, StorefrontTheme } from "@/types/storefront";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { BackgroundEditor } from "./BackgroundEditor";

/**
 * Theme essentials: background (color / gradient / uploaded image) and
 * accent. Corner roundness lives with the other card controls in
 * CardsSection. Every control is bound to the schema's enums / strict hex
 * rule.
 */
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
  const fieldId = useId();

  function updateBackground(background: StorefrontBackground) {
    onChange({ ...theme, background });
  }

  return (
    <div className="space-y-4">
      <BackgroundEditor
        value={theme.background}
        onChange={updateBackground}
        imageUrl={backgroundImageUrl}
        onImageChange={onBackgroundImageChange}
      />
      <ColorPicker
        id={`${fieldId}-accent`}
        label="Accent"
        value={theme.accent}
        onChange={(accent) => onChange({ ...theme, accent })}
      />
    </div>
  );
}
