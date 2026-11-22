"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { StorefrontTheme } from "@/types/storefront";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { InfoTip } from "@/components/ui/InfoTip";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { derivePalette, recolourThemePalette } from "@/lib/storefront/palette";
import { PALETTE_SLOT_LABELS, PALETTE_SLOT_ORDER } from "@/lib/theme/palette-swatches";
import { cn } from "@/lib/utils";

/** The palette's five named swatches, wherever they are shown (this row and
 *  the colour panel's palette section): swatch and name side by side,
 *  wrapping onto a second line as the panel's width asks. */
export const PALETTE_CHIPS_CLASS = "flex flex-wrap gap-x-3 gap-y-2";
/** One swatch with its name beside it. */
export const PALETTE_CHIP_CLASS = "flex items-center gap-1.5";

/**
 * THE PALETTE ROW: the storefront's five named colours, set once for the whole
 * board (Theme). Each swatch is a colour field of its own, and changing one
 * recolours everything painted in the colour it replaces.
 *
 * Inside the designer a swatch opens the left-hand colour panel on its slot,
 * and the designer applies the pick to the WHOLE design (recolourPaletteIn
 * over its undoable state: blocks, header, pages). Without the panel (a
 * gallery, a test) the swatch's own popover can only reach the theme it is
 * handed, so that path recolours the theme alone.
 *
 * A storefront saved before palettes shows the palette derived from what it
 * already wears, and stores nothing until a swatch is changed.
 */
export function PaletteRow({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const tKey = useTranslations();
  const t = useTranslations("EditorType.panel.palette");
  const fieldId = useId();
  const palette = derivePalette(theme);
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5">
        <span className={labelClass}>{t("title")}</span>
        <InfoTip label={t("title")}>{t("hint")}</InfoTip>
      </span>
      {/* Swatch and name side by side, wrapping: five names never fit under
          five swatches in a panel this narrow (and German's are longer). */}
      <div role="group" aria-label={t("group")} className={PALETTE_CHIPS_CLASS}>
        {PALETTE_SLOT_ORDER.map((slot) => {
          const name = tKey(PALETTE_SLOT_LABELS[slot].name);
          const id = `${fieldId}-${slot}`;
          return (
            <div key={slot} className={PALETTE_CHIP_CLASS}>
              <ColorPicker
                id={id}
                compact
                label={name}
                value={palette[slot]}
                onChange={(hex) => onChange(recolourThemePalette(theme, slot, hex))}
                target={{ kind: "palette", slot }}
              />
              {/* A label for the swatch, so the name is a target too. */}
              <label htmlFor={id} className={cn(infoTextClass, "cursor-pointer")}>
                {name}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
