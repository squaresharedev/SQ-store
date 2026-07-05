"use client";

import {
  type Density,
  type DisplayMode,
  type StorefrontTheme,
} from "@/types/storefront";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { helpTextClass, labelClass } from "@/components/ui/control-styles";

const DISPLAY_MODE_OPTIONS: readonly { value: DisplayMode; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "carousel", label: "Carousel" },
];

const DENSITY_OPTIONS: readonly { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfy", label: "Comfy" },
  { value: "spacious", label: "Spacious" },
];

/** Layout controls: display mode and grid density, both persisted. */
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
        <span className={labelClass}>Grid density</span>
        <SegmentedControl
          value={theme.density}
          options={DENSITY_OPTIONS}
          onChange={(density) => onChange({ ...theme, density })}
          ariaLabel="Grid density"
        />
      </div>
    </div>
  );
}
