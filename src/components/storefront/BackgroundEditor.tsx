"use client";

import { Check } from "lucide-react";
import {
  PATTERN_PRESETS,
  type StorefrontBackground,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Slider } from "@/components/ui/slider";
import { labelClass } from "@/components/ui/control-styles";
import { PATTERN_STYLES, resolveBackgroundStyle } from "./background-presets";

type Kind = StorefrontBackground["kind"];

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: "solid", label: "Color" },
  { value: "gradient", label: "Gradient" },
  { value: "pattern", label: "Pattern" },
];

const DEFAULT_GRADIENT_TO = "#e5e7eb";

/** A base color to carry across type switches. */
function baseColor(background: StorefrontBackground): string {
  return background.kind === "gradient" ? background.from : background.color;
}

function switchKind(
  kind: Kind,
  current: StorefrontBackground,
): StorefrontBackground {
  if (kind === current.kind) return current;
  const base = baseColor(current);
  switch (kind) {
    case "solid":
      return { kind: "solid", color: base };
    case "gradient":
      return { kind: "gradient", from: base, to: DEFAULT_GRADIENT_TO, angle: 160 };
    case "pattern":
      return { kind: "pattern", preset: "dots", color: base };
  }
}

/**
 * Background control: choose a solid color, build a custom two-stop gradient, or
 * pick a texture pattern over a base color. Emits only the structured, schema-
 * safe StorefrontBackground shapes — no free-form CSS ever leaves this component.
 */
export function BackgroundEditor({
  value,
  onChange,
}: {
  value: StorefrontBackground;
  onChange: (background: StorefrontBackground) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className={labelClass}>Background</span>
        <div
          aria-hidden="true"
          style={resolveBackgroundStyle(value)}
          className="h-16 w-full rounded-sm border border-border"
        />
      </div>

      <div role="group" aria-label="Background type" className="flex">
        {KINDS.map((kind, index) => {
          const active = value.kind === kind.value;
          return (
            <button
              key={kind.value}
              type="button"
              onClick={() => onChange(switchKind(kind.value, value))}
              aria-pressed={active}
              className={cn(
                "flex-1 border border-border px-3 py-1.5 font-inter text-xs font-medium",
                "transition-colors duration-180 ease-in-out motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                index > 0 && "-ml-px",
                active
                  ? "z-10 bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {kind.label}
            </button>
          );
        })}
      </div>

      {value.kind === "solid" && (
        <ColorPicker
          id="bg-solid"
          label="Color"
          value={value.color}
          onChange={(color) => onChange({ kind: "solid", color })}
        />
      )}

      {value.kind === "gradient" && (
        <div className="space-y-3">
          <ColorPicker
            id="bg-grad-from"
            label="From"
            value={value.from}
            onChange={(from) => onChange({ ...value, from })}
          />
          <ColorPicker
            id="bg-grad-to"
            label="To"
            value={value.to}
            onChange={(to) => onChange({ ...value, to })}
          />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className={labelClass}>Angle</span>
              <span className="font-inter text-sm text-muted-foreground">
                {value.angle}°
              </span>
            </div>
            <Slider
              min={0}
              max={360}
              step={5}
              value={value.angle}
              onChange={(angle) => onChange({ ...value, angle })}
              ariaLabel="Gradient angle"
              valueText={`${value.angle} degrees`}
            />
          </div>
        </div>
      )}

      {value.kind === "pattern" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className={labelClass}>Pattern</span>
            <div
              role="group"
              aria-label="Patterns"
              className="grid grid-cols-3 gap-2"
            >
              {PATTERN_PRESETS.map((preset) => {
                const selected = value.preset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onChange({ ...value, preset })}
                    aria-label={`${PATTERN_STYLES[preset].label} pattern`}
                    aria-pressed={selected}
                    title={PATTERN_STYLES[preset].label}
                    style={resolveBackgroundStyle({
                      kind: "pattern",
                      preset,
                      color: value.color,
                    })}
                    className={cn(
                      "relative aspect-square rounded-sm border border-border transition-shadow duration-180 ease-in-out",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
                      selected
                        ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                        : "hover:border-foreground/40",
                    )}
                  >
                    {selected && (
                      <Check
                        className="absolute inset-0 m-auto size-4 text-foreground"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <ColorPicker
            id="bg-pattern-color"
            label="Base color"
            value={value.color}
            onChange={(color) => onChange({ ...value, color })}
          />
        </div>
      )}
    </div>
  );
}
