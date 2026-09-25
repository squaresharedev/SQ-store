"use client";

import {
  CANVAS_COLUMNS_MAX,
  CANVAS_COLUMNS_MIN,
  CANVAS_ROWS_MAX,
  CANVAS_ROWS_MIN,
  GRID_GAP_MAX,
  type StorefrontTheme,
} from "@/types/storefront";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { SliderField } from "@/components/ui/SliderField";
import { Switch } from "@/components/ui/switch";
import {
  labelClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * The Canvas section of the Theme group: board size, the grid gap, and the
 * designer's own grid guides.
 *
 * The guides are an editor view preference rather than a saved theme field, and
 * they sit in this section BECAUSE of that: beside colours the buyer sees, a
 * switch that only ever affects the seller's own screen read as one more thing
 * being published, so it stays in its own labelled sibling rather than folded
 * into the same list.
 */
export function LayoutSection({
  theme,
  onChange,
  onCanvasChange,
  showGrid,
  onShowGridChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
  /** Canvas resize goes through the designer, which refuses to shrink the
   *  board smaller than the blocks already on it. */
  onCanvasChange: (columns: number, rows: number) => void;
  /** Editor-only view preference, not part of the saved config. */
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
}) {
  const t = useTranslations("Storefront.layout");
  const fieldId = useId();

  return (
    <div className="space-y-4">
      <SliderField
        id={`${fieldId}-columns`}
        label={t("canvasWidth")}
        min={CANVAS_COLUMNS_MIN}
        max={CANVAS_COLUMNS_MAX}
        value={theme.columns}
        onChange={(columns) => onCanvasChange(columns, theme.rows)}
        ariaLabel={t("canvasWidthAriaLabel")}
        valueText={t("blocksWide", { n: theme.columns })}
        unit="blocks"
      />

      <div className="space-y-1.5">
        <SliderField
          id={`${fieldId}-rows`}
          label={t("canvasHeight")}
          tip={t("heightTip")}
          min={CANVAS_ROWS_MIN}
          max={CANVAS_ROWS_MAX}
          value={theme.rows}
          onChange={(rows) => onCanvasChange(theme.columns, rows)}
          ariaLabel={t("canvasHeightAriaLabel")}
          valueText={t("blocksTall", { n: theme.rows })}
          unit="blocks"
        />
      </div>

      <SliderField
        id={`${fieldId}-grid-gap`}
        label={t("gridDensity")}
        min={0}
        max={GRID_GAP_MAX}
        step={2}
        value={theme.gridGap}
        onChange={(gridGap) => onChange({ ...theme, gridGap })}
        ariaLabel={t("gridDensityAriaLabel")}
        valueText={t("gridGapValue", { n: theme.gridGap })}
        unit="px"
        statusText={theme.gridGap === 0 ? t("noGap") : undefined}
      />

      {/* Editor guide only: buyers never see the empty slots. */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <label htmlFor={`${fieldId}-show-grid`} className={labelClass}>
              {t("showGrid")}
            </label>
            <InfoTip label={t("gridInfoLabel")}>
              {t("gridInfoBody")}
            </InfoTip>
          </span>
          <Switch
            id={`${fieldId}-show-grid`}
            checked={showGrid}
            onCheckedChange={onShowGridChange}
          />
        </div>
      </div>
    </div>
  );
}
