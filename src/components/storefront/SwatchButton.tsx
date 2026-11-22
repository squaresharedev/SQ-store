"use client";

import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";

/**
 * One choice of paint: a round swatch (a palette colour) or a wide one (a
 * ready-made gradient), with a tick on the one in use. The layout panels'
 * palette-first pickers are rows of these.
 */
export function SwatchButton({
  fill,
  label,
  active,
  onClick,
  wide = false,
}: {
  /** What the swatch shows: a background colour or image. */
  fill: CSSProperties;
  /** Its name for assistive tech (and a tooltip). */
  label: string;
  active: boolean;
  onClick: () => void;
  /** A gradient reads better as a short bar than as a dot. */
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-8 shrink-0 items-center justify-center border border-border",
        wide ? "w-14 rounded-sm" : "w-8 rounded-full",
        active && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        transitionClass,
        focusRingClass,
      )}
      style={fill}
    >
      {active && (
        <span className="flex size-4 items-center justify-center rounded-full bg-background/90 text-foreground">
          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
        </span>
      )}
    </button>
  );
}
