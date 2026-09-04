"use client";

import {
  CANVAS_COLUMNS_MAX,
  CANVAS_COLUMNS_MIN,
  CANVAS_ROWS_MAX,
  CANVAS_ROWS_MIN,
  GRID_GAP_MAX,
  type DisplayMode,
  type StorefrontTheme,
} from "@/types/storefront";
import { useId } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SliderField } from "@/components/ui/SliderField";
import { Switch } from "@/components/ui/switch";
import {
  labelClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";

const DISPLAY_MODE_OPTIONS: readonly { value: DisplayMode; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "carousel", label: "Carousel" },
];

/**
 * The canvas group: board size, display mode, the grid gap, and the designer's
 * own grid guides.
 *
 * The guides are an editor view preference rather than a saved theme field, and
 * they sit here BECAUSE of that: under "Theme", beside colours the buyer sees,
 * a switch that only ever affects the seller's own screen read as one more
 * thing being published.
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
  const fieldId = useId();


  return (
    <div className="space-y-4">
      <SliderField
        id={`${fieldId}-columns`}
        label="Canvas width"
        min={CANVAS_COLUMNS_MIN}
        max={CANVAS_COLUMNS_MAX}
        value={theme.columns}
        onChange={(columns) => onCanvasChange(columns, theme.rows)}
        ariaLabel="Canvas width in blocks"
        valueText={`${theme.columns} blocks wide`}
        unit="blocks"
      />

      <div className="space-y-1.5">
        <SliderField
          id={`${fieldId}-rows`}
          label="Canvas height"
          tip="The board can't shrink below the blocks already on it: drag a block up first, then shorten the canvas."
          min={CANVAS_ROWS_MIN}
          max={CANVAS_ROWS_MAX}
          value={theme.rows}
          onChange={(rows) => onCanvasChange(theme.columns, rows)}
          ariaLabel="Canvas height in blocks"
          valueText={`${theme.rows} blocks tall`}
          unit="blocks"
        />
      </div>

      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5">
          <span className={labelClass}>Display mode</span>
          <InfoTip label="What the display modes do">
            Grid lays blocks out on the board exactly as you place them.
            Carousel shows them as one swipeable row instead, which suits a
            narrow embed; block sizes only apply in grid.
          </InfoTip>
        </span>
        <SegmentedControl
          value={theme.displayMode}
          options={DISPLAY_MODE_OPTIONS}
          onChange={(displayMode) => onChange({ ...theme, displayMode })}
          ariaLabel="Display mode"
        />
      </div>

      <SliderField
        id={`${fieldId}-grid-gap`}
        label="Grid density"
        min={0}
        max={GRID_GAP_MAX}
        step={2}
        value={theme.gridGap}
        onChange={(gridGap) => onChange({ ...theme, gridGap })}
        ariaLabel="Grid density"
        valueText={`${theme.gridGap} pixel gap`}
        unit="px"
        statusText={theme.gridGap === 0 ? "No gap" : undefined}
      />

      {/* Editor guide only: buyers never see the empty slots. */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <label htmlFor={`${fieldId}-show-grid`} className={labelClass}>
              Show grid
            </label>
            <InfoTip label="Who sees the grid">
              A guide for you while you design: it draws the empty slots so
              you can see where a block will land. Buyers never see it.
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
