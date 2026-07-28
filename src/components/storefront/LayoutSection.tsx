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
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Slider } from "@/components/ui/slider";
import { helpTextClass, labelClass } from "@/components/ui/control-styles";

const DISPLAY_MODE_OPTIONS: readonly { value: DisplayMode; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "carousel", label: "Carousel" },
];

/** Layout controls: canvas size, display mode, and the grid gap. */
export function LayoutSection({
  theme,
  onChange,
  onCanvasChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
  /** Canvas resize goes through the designer, which refuses to shrink the
   *  board smaller than the blocks already on it. */
  onCanvasChange: (columns: number, rows: number) => void;
}) {
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
    </div>
  );
}
