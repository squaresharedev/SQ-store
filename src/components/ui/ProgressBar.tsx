import { cn } from "@/lib/utils";

/**
 * Determinate progress track. `value` is 0..1; pass `null` for indeterminate
 * (the total is unknown), which shows a filled track at rest rather than a
 * second animation competing with whatever spinner is already on screen.
 *
 * Exposed as a real `progressbar` so assistive tech reads the percentage
 * instead of inferring it from a visual bar.
 */
export function ProgressBar({
  value,
  label,
  className,
}: {
  /** 0..1, or null when the total length isn't known. */
  value: number | null;
  /** Accessible name, e.g. "Uploading image". */
  label: string;
  className?: string;
}) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      // Omitted while indeterminate, which is how a progressbar signals
      // "working, length unknown".
      aria-valuenow={pct ?? undefined}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-base ease-standard motion-reduce:transition-none",
          pct === null && "w-full opacity-60",
        )}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
