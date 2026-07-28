"use client";

import { useId } from "react";
import type { StorefrontBackground, StorefrontTheme } from "@/types/storefront";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Switch } from "@/components/ui/switch";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { BackgroundEditor } from "./BackgroundEditor";

/**
 * Theme essentials: background (color / gradient / uploaded image), accent,
 * and the designer's grid guides. Corner roundness lives with the other card
 * controls in CardsSection. Every control is bound to the schema's enums /
 * strict hex rule.
 */
export function ThemePanel({
  theme,
  onChange,
  backgroundImageUrl,
  onBackgroundImageChange,
  showGrid,
  onShowGridChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
  /** Display URL for an image background (signed or local object URL). */
  backgroundImageUrl: string | null;
  onBackgroundImageChange: (url: string | null) => void;
  /** Editor-only view preference, not part of the saved config. */
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
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

      {/* Editor guide only: buyers never see the empty slots, so this is a
          view preference rather than a saved theme field. */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${fieldId}-show-grid`} className={labelClass}>
            Show grid
          </label>
          <Switch
            id={`${fieldId}-show-grid`}
            checked={showGrid}
            onCheckedChange={onShowGridChange}
          />
        </div>
        <p className={infoTextClass}>
          Empty slots while you design. Never shown to buyers.
        </p>
      </div>
    </div>
  );
}
