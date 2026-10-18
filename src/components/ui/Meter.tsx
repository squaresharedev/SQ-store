import { cn } from "@/lib/utils";
import { meterFillClass, meterTrackClass } from "@/components/ui/surface-styles";

/** Ink for something in force; muted for something over, off or yet to begin.
 *  `open` is the same tone for a measure with no far end. */
const TONES = {
  ink: { fill: "", open: "from-primary" },
  muted: { fill: "bg-muted-foreground", open: "from-muted-foreground" },
} as const;

export type MeterTone = keyof typeof TONES;

/**
 * A STANDING FACT DRAWN AS A BAR: how much of a limit is used, how far through
 * its run a sale is. The sibling of ProgressBar, which is for work under way.
 *
 * Decorative by contract: the figure it draws is always printed beside it
 * ("3 of 50 uses", "Ends 7 Oct"), so the bar is hidden from assistive tech
 * rather than read out a second time as a bare percentage.
 *
 * `value` is 0..1. Pass `null` for a measure with no far end (a sale with no
 * end date): the fill then fades out instead of stopping somewhere it has not.
 */
export function Meter({
  value,
  tone = "ink",
  className,
}: {
  value: number | null;
  tone?: MeterTone;
  className?: string;
}) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <span aria-hidden="true" data-meter={pct ?? "open"} className={cn(meterTrackClass, "block", className)}>
      <span
        className={cn(
          meterFillClass,
          "block",
          pct === null
            ? ["w-full bg-transparent bg-linear-to-r to-transparent", TONES[tone].open]
            : TONES[tone].fill,
        )}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </span>
  );
}
