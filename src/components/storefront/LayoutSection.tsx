"use client";

import {
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

/** Layout controls: display mode and the grid gap, both persisted. */
export function LayoutSection({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  return (
    <div className="space-y-4">
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
