"use client";

import { Check } from "lucide-react";
import { BACKGROUND_PRESETS } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { cn } from "@/lib/utils";
import { ColorInput } from "@/components/ui/color-input";
import { labelClass } from "@/components/ui/control-styles";
import { BACKGROUND_PRESET_STYLES } from "./background-presets";

/** Last-valid-hex fallback keeps the custom input usable while a preset is
 *  selected (the native color swatch requires a hex value). */
const CUSTOM_HEX_FALLBACK = "#ffffff";

/**
 * Background control: a swatch grid of allowlisted presets plus the strict-hex
 * custom input. Emits either a preset KEY or a hex string — the two shapes the
 * schema's background union accepts. No free-form CSS ever leaves this
 * component.
 */
export function BackgroundPresetPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (background: string) => void;
}) {
  const customActive = isStrictHexColor(value);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className={labelClass}>Background</span>
        <div role="group" aria-label="Background presets" className="grid grid-cols-4 gap-2">
          {BACKGROUND_PRESETS.map((preset) => {
            const { label, style } = BACKGROUND_PRESET_STYLES[preset];
            const selected = value === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => onChange(preset)}
                aria-label={`${label} background`}
                aria-pressed={selected}
                title={label}
                style={style}
                className={cn(
                  "relative aspect-square rounded-sm border border-border transition-shadow duration-180 ease-in-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "motion-reduce:transition-none",
                  selected
                    ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                    : "hover:border-foreground/40",
                )}
              >
                {selected && (
                  <Check
                    className={cn(
                      "absolute inset-0 m-auto size-4",
                      // The one dark preset needs a light check mark.
                      preset === "ink" ? "text-background" : "text-foreground",
                    )}
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ColorInput
        id="storefront-background-custom"
        label={customActive ? "Custom color (active)" : "Custom color"}
        value={customActive ? value : CUSTOM_HEX_FALLBACK}
        onChange={onChange}
      />
    </div>
  );
}
