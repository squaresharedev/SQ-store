"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  "aria-labelledby"?: string;
}

/**
 * Brand toggle: pill track (radius-full is for round things per styles.md §3),
 * black when on, neutral when off. Purely presentational — pair it with a
 * hidden input when the value must submit with a form.
 */
export function Switch({
  checked,
  onCheckedChange,
  id,
  disabled,
  ...aria
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      suppressHydrationWarning
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2",
        "transition-colors duration-base ease-standard motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:opacity-50 disabled:pointer-events-none",
        // On reads as the primary action colour; off is a plain control
        // surface, so the two states never rely on hue alone.
        checked ? "border-primary bg-primary" : "border-input bg-input",
      )}
      {...aria}
    >
      <span
        aria-hidden
        className={cn(
          // The knob rides on top of both track colours, so it takes the
          // foreground-on-primary token rather than a literal white.
          "pointer-events-none block size-4 rounded-full bg-primary-foreground shadow-sm",
          "transition-transform duration-base ease-standard motion-reduce:transition-none",
          checked ? "translate-x-5.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
