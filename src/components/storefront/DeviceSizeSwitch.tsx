"use client";

import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";

export type PreviewDevice = "desktop" | "mobile";

/**
 * The desktop/mobile toggle pair, shared by the product page artboard's own
 * frame (that page's preview width) and the canvas-level switch floating
 * above the board (the whole editor's design/mobile view) — one control, one
 * pair of tooltips, so a seller only ever learns it once.
 */
export function DeviceSizeSwitch({
  device,
  onChange,
  labels,
  className,
  buttonSizeClass = "size-7",
  iconSizeClass = "size-3.5",
}: {
  device: PreviewDevice;
  onChange: (device: PreviewDevice) => void;
  /** Tooltip/aria-label text per device, phrased for the calling context. */
  labels: Record<PreviewDevice, string>;
  className?: string;
  buttonSizeClass?: string;
  iconSizeClass?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {(["desktop", "mobile"] as const).map((id) => {
        const Icon = id === "desktop" ? Monitor : Smartphone;
        return (
          // The product's own tooltip rather than `title=""`: this pair floats
          // over the canvas beside the toolbar's tips, and an OS tooltip
          // arriving a second late in a different typeface reads as a
          // different application.
          <Tooltip key={id} label={labels[id]}>
            <button
              type="button"
              onClick={() => onChange(id)}
              aria-pressed={device === id}
              aria-label={labels[id]}
              className={cn(
                "flex items-center justify-center rounded-sm border transition-colors duration-base ease-standard",
                buttonSizeClass,
                device === id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className={iconSizeClass} strokeWidth={2} aria-hidden="true" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
