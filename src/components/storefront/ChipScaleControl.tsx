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
 * sellers look for it. Four copies of one switch, so each says what it covers
 * (both chips, every card): otherwise the second copy read as a setting of its
 * own, and a product's copy as that tile's. The default is stored as no key,
 * like the other defaults a theme can fall back to.
 *
 * OUT OF THE EDITOR FOR EVERY BOARD THAT HAS NOT USED IT (Photo cards, editor
 * upgrade). "Stay the same" sized every chip on a big card as on a 1x1, which
 * is what made prices unreadable; with the labels' readable floor
 * (TILE_LABEL_READABLE_PX) the choice changes little, and four copies of a
 * switch that changes little were four things to read for nothing. It is drawn
 * only on a board already set to "cell", so that seller can still switch back.
 * The field itself keeps working, and an assistant can still set it.
 */
export function ChipScaleControl({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const t = useTranslations("Storefront.chipScale");
  if ((theme.chipScale ?? DEFAULT_CHIP_SCALE) === DEFAULT_CHIP_SCALE) return null;
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
      <p className={infoTextClass}>{t("everyCard")}</p>
    </div>
  );
}
