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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  helpTextClass,
  infoTextClass,
  labelClass,
} from "@/components/ui/control-styles";

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
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={labelClass}>Canvas width</span>
          <span className={helpTextClass}>{theme.columns} blocks</span>
        </div>
        <Slider
          min={CANVAS_COLUMNS_MIN}
          max={CANVAS_COLUMNS_MAX}
          value={theme.columns}
          onChange={(columns) => onCanvasChange(columns, theme.rows)}
          ariaLabel="Canvas width in blocks"
          valueText={`${theme.columns} blocks wide`}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={labelClass}>Canvas height</span>
          <span className={helpTextClass}>{theme.rows} blocks</span>
        </div>
        <Slider
          min={CANVAS_ROWS_MIN}
          max={CANVAS_ROWS_MAX}
          value={theme.rows}
          onChange={(rows) => onCanvasChange(theme.columns, rows)}
          ariaLabel="Canvas height in blocks"
          valueText={`${theme.rows} blocks tall`}
        />
        <p className={helpTextClass}>
          The board can&rsquo;t shrink below the blocks already on it.
        </p>
      </div>

      <div className="space-y-1.5">
        <span className={labelClass}>Display mode</span>
        <SegmentedControl
          value={theme.displayMode}
          options={DISPLAY_MODE_OPTIONS}
          onChange={(displayMode) => onChange({ ...theme, displayMode })}
          ariaLabel="Display mode"
        />
        {theme.displayMode === "carousel" && (
          <p className={helpTextClass}>
            Blocks show as a swipeable row. Block sizes apply in grid mode.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={labelClass}>Grid density</span>
          <span className={helpTextClass}>
            {theme.gridGap === 0 ? "No gap" : `${theme.gridGap}px gap`}
          </span>
        </div>
        <Slider
          min={0}
          max={GRID_GAP_MAX}
          step={2}
          value={theme.gridGap}
          onChange={(gridGap) => onChange({ ...theme, gridGap })}
          ariaLabel="Grid density"
          valueText={`${theme.gridGap} pixel gap`}
        />
      </div>

      {/* Editor guide only: buyers never see the empty slots. */}
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
