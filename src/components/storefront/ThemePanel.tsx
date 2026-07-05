"use client";

import { useId } from "react";
import {
  STOREFRONT_RADII,
  type StorefrontRadius,
  type StorefrontTheme,
} from "@/types/storefront";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Slider } from "@/components/ui/slider";
import { labelClass } from "@/components/ui/control-styles";
import { BackgroundEditor } from "./BackgroundEditor";

const RADIUS_LABELS: Record<StorefrontRadius, string> = {
  none: "Square",
  sm: "Small",
  md: "Medium",
  lg: "Large",
};

/**
 * Theme essentials: background, accent, corners. Card-level appearance
 * (shape, style, price tag) lives in CardsSection. Every control is bound to
 * the schema's enums / strict hex rule.
 */
export function ThemePanel({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const fieldId = useId();
  const radiusIndex = STOREFRONT_RADII.indexOf(theme.radius);

  return (
    <div className="space-y-4">
      <BackgroundEditor
        value={theme.background}
        onChange={(background) => onChange({ ...theme, background })}
      />
      <ColorPicker
        id={`${fieldId}-accent`}
        label="Accent"
        value={theme.accent}
        onChange={(accent) => onChange({ ...theme, accent })}
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={labelClass}>Corners</span>
          <span className="font-inter text-sm text-muted-foreground">
            {RADIUS_LABELS[theme.radius]}
          </span>
        </div>
        <Slider
          min={0}
          max={STOREFRONT_RADII.length - 1}
          value={radiusIndex < 0 ? 0 : radiusIndex}
          onChange={(index) =>
            onChange({ ...theme, radius: STOREFRONT_RADII[index] })
          }
          ariaLabel="Corner roundness"
          valueText={RADIUS_LABELS[theme.radius]}
        />
      </div>
    </div>
  );
}
