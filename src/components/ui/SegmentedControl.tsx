"use client";

import { cn } from "@/lib/utils";

/**
 * SegmentedControl — generic button-group control for a fixed set of options.
 * Modeled on the "Background type" row in BackgroundEditor. Each segment is a
 * type="button" with aria-pressed; the active segment is solid primary, idle
 * segments are background-colored with hover accent. Focus ring from
 * control-styles FOCUS_RING pattern. Buttons are sharp (rounded-none).
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  disabled,
}: {
  value: T;
  /**
   * A segment may be `disabled` on its own, for a choice that exists but is
   * not available to this user right now — the product form's "Active" for a
   * seller who has not completed the trader details publishing requires. The
   * option stays visible on purpose: removing it would hide that the choice
   * exists at all, and the surface around the control is where the reason
   * belongs.
   */
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  id?: string;
  /** Disables every segment. Prefer a per-option flag when only one is barred. */
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      id={id}
      className={cn("flex", disabled && "pointer-events-none opacity-50")}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 border border-border px-3 py-1.5 font-inter text-xs font-medium",
              "transition-colors duration-base ease-standard motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "disabled:opacity-50 disabled:pointer-events-none",
              index > 0 && "-ml-px",
              active
                ? "z-10 bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
