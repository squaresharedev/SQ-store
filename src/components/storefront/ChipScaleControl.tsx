"use client";

import { useTranslations } from "next-intl";
import {
  CHIP_SCALES,
  DEFAULT_CHIP_SCALE,
  type ChipScale,
  type StorefrontTheme,
} from "@/types/storefront";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { infoTextClass, strongLabelClass } from "@/components/ui/control-styles";

/**
 * Whether bigger tiles wear bigger chips (CHIP_SCALES): one switch for the
 * whole board, shown wherever a seller sizes a chip: the theme's Price tag and
 * Sale chip sections, and the same two in a product's own settings, where most
 * sellers look for it. There it says that it is the board's, not the tile's
 * (`onEveryCard`). The default is stored as no key, like the other defaults
 * a theme can fall back to.
 */
export function ChipScaleControl({
  theme,
  onChange,
  onEveryCard = false,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
  /** Shown in one product's settings: says the switch changes every card. */
  onEveryCard?: boolean;
}) {
  const t = useTranslations("Storefront.chipScale");
  const select = (chipScale: ChipScale) => {
    const next = { ...theme };
    if (chipScale === DEFAULT_CHIP_SCALE) delete next.chipScale;
    else next.chipScale = chipScale;
    onChange(next);
  };
  return (
    <div className="space-y-1.5" data-chip-scale-control="">
      <span className={strongLabelClass}>{t("label")}</span>
      <SegmentedControl
        value={theme.chipScale ?? DEFAULT_CHIP_SCALE}
        options={CHIP_SCALES.map((scale) => ({ value: scale, label: t(scale) }))}
        onChange={select}
        ariaLabel={t("label")}
      />
      {onEveryCard && <p className={infoTextClass}>{t("everyCard")}</p>}
    </div>
  );
}
