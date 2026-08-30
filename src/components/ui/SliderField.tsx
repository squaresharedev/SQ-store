"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Slider } from "./slider";
import { infoTextClass, labelClass, sliderNumberFieldClass } from "./control-styles";

/**
 * A slider paired with an editable number — the pattern FontSizeField
 * established for text size, generalized for every other drag-to-set value in
 * the design panel (rotation, opacity, roundness, thickness, spacing...).
 * Dragging is for feel; typing is for a value you already know, the way
 * Figma and Canva pair the two on every numeric property.
 *
 * `statusText` stands in for the number in the header row for the handful of
 * values that read better as a word than a digit ("Sharp", "None", "Mixed").
 * `headerAction` replaces it entirely for a control that also carries a reset
 * (see CardStyleControls' edge spacing, which resets to "Auto").
 */
export function SliderField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  valueText,
  statusText,
  headerAction,
  unit,
  labelClassName = labelClass,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  /** Drag granularity for the slider track only; typing accepts any whole
   *  number in range regardless of step. */
  step?: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  valueText?: string;
  /** A word shown instead of the number in the header, e.g. "Sharp" at 0. */
  statusText?: string;
  /** Overrides statusText for a header that also carries a reset action. */
  headerAction?: React.ReactNode;
  /** Static unit shown after the number field, e.g. "px", "%", "°". */
  unit?: string;
  labelClassName?: string;
  disabled?: boolean;
}) {
  // Local draft so a half-typed number ("1" on the way to "18") is not
  // clamped to the minimum under the seller's fingers.
  const [draft, setDraft] = useState<string | null>(null);

  function commit(next: number) {
    setDraft(null);
    onChange(Math.min(max, Math.max(min, Math.round(next))));
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={labelClassName}>{label}</span>
        {headerAction ?? (statusText && <span className={infoTextClass}>{statusText}</span>)}
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Slider
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={onChange}
            ariaLabel={ariaLabel}
            valueText={valueText}
            disabled={disabled}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <input
            id={`${id}-number`}
            type="number"
            inputMode={min < 0 ? "decimal" : "numeric"}
            min={min}
            max={max}
            disabled={disabled}
            value={draft ?? value}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              const parsed = Number(next);
              // Apply live while it is already a usable number; blur below
              // clamps whatever the seller finally stops on.
              if (next !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
                onChange(Math.round(parsed));
              }
            }}
            onBlur={() => {
              const parsed = Number(draft ?? value);
              if (draft !== null && draft !== "" && Number.isFinite(parsed)) {
                commit(parsed);
              } else {
                setDraft(null);
              }
            }}
            className={sliderNumberFieldClass}
          />
          {unit && <span className={cn(infoTextClass, "shrink-0")}>{unit}</span>}
        </div>
      </div>
    </div>
  );
}
