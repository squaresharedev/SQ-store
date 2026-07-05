"use client";

import {
  type DisplayMode,
  type StorefrontTheme,
} from "@/types/storefront";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { helpTextClass, labelClass, stubBadgeClass } from "@/components/ui/control-styles";

const DISPLAY_MODE_OPTIONS: readonly { value: DisplayMode; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "carousel", label: "Carousel" },
];

// Density is a stub — not persisted. Defined locally because it has no schema entry yet.
type Density = "compact" | "comfy" | "spacious";
const DENSITY_OPTIONS: readonly { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfy", label: "Comfy" },
  { value: "spacious", label: "Spacious" },
];

/** Layout controls: display mode (wired) and grid density (stub). */
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
        {/*
         * carousel is wired — it persists to the schema — but the designer
         * only renders a placeholder for it (TODO: real carousel preview).
         */}
        <SegmentedControl
          value={theme.displayMode}
          options={DISPLAY_MODE_OPTIONS}
          onChange={(displayMode) => onChange({ ...theme, displayMode })}
          ariaLabel="Display mode"
        />
        {theme.displayMode === "carousel" && (
          <p className={helpTextClass}>
            Carousel is coming soon. Your storefront still renders as a grid.
          </p>
        )}
      </div>

      {/* TODO(stub): density — UI only, not persisted. */}
      <div className="space-y-1.5">
        <div className="flex items-center">
          <span className={labelClass}>Grid density</span>
          <span className={stubBadgeClass}>Soon</span>
        </div>
        <SegmentedControl
          value="comfy"
          options={DENSITY_OPTIONS}
          onChange={() => {
            // stub — not wired
          }}
          ariaLabel="Grid density"
          disabled
        />
      </div>
    </div>
  );
}
