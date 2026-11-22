"use client";

import { useTranslations } from "next-intl";
import type { GradientFill, StorefrontPalette } from "@/types/storefront";
import {
  gradientCss,
  paletteGradients,
  readyGradientId,
  type GradientPurpose,
} from "@/lib/storefront/gradients";
import { cn } from "@/lib/utils";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";
import { COLOR_ROW_DOT } from "@/components/ui/color-row-styles";

/**
 * THE READY-MADE GRADIENTS, as a row of swatches: the storefront's own
 * palette, mixed for it (lib/storefront/gradients). The only way a gradient is
 * chosen in the editor; there is no gradient editor. A swatch is pressed when
 * the stored gradient is that ready-made, colour for colour.
 *
 * Drawn like the colour picker's inline dots (color-row-styles), so a gradient
 * reads as one more colour choice beside them. Renders nothing when the
 * palette offers no gradient (every slot one colour).
 */
export function GradientSwatches({
  palette,
  purpose,
  value,
  onPick,
  label,
}: {
  palette: StorefrontPalette;
  purpose: GradientPurpose;
  /** The gradient worn now, if any. */
  value: GradientFill | undefined;
  onPick: (fill: GradientFill) => void;
  /** The group's accessible name. */
  label: string;
}) {
  const t = useTranslations("EditorFinish.panel.gradient");
  const offered = paletteGradients(palette, purpose);
  const active = readyGradientId(value, offered);
  if (offered.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {offered.map(({ id, fill }) => {
        const name = t(`names.${id}`);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active === id}
            aria-label={name}
            title={name}
            onClick={() => onPick(fill)}
            className={cn(
              COLOR_ROW_DOT.cell,
              COLOR_ROW_DOT.hover,
              active === id ? COLOR_ROW_DOT.active : COLOR_ROW_DOT.idle,
              transitionClass,
              focusRingClass,
            )}
            style={{ backgroundImage: gradientCss(fill) ?? undefined }}
          />
        );
      })}
    </div>
  );
}
