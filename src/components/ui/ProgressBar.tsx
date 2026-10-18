import { cn } from "@/lib/utils";
import { meterFillClass, meterTrackClass } from "@/components/ui/surface-styles";

/**
 * Determinate progress track. `value` is 0..1; pass `null` for indeterminate
 * (the total is unknown), which shows a filled track at rest rather than a
 * second animation competing with whatever spinner is already on screen.
 *
 * Exposed as a real `progressbar` so assistive tech reads the percentage
 * instead of inferring it from a visual bar. For a standing fact (a limit half
 * used) rather than work under way, use Meter.
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
      className={cn(meterTrackClass, className)}
    >
      <div
        className={cn(meterFillClass, pct === null && "w-full opacity-60")}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
