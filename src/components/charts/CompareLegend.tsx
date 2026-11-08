import { CHART } from "@/components/charts/theme";
import { cn } from "@/lib/utils";

/**
 * The key over a chart that reads one line against another (ScrubChart's
 * `compare`): the measured line, solid in its colour, and the period before,
 * dashed in grey. Short words, set to the right over the plot.
 */
export function CompareLegend({
  now,
  before,
  color,
  className,
}: {
  now: string;
  before: string;
  /** The measured line's colour, a CHART token. */
  color: string;
  className?: string;
}) {
  return (
    <div className={cn("flex justify-end gap-4 font-inter text-xs text-muted-foreground", className)}>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />
        {now}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 border-t border-dashed" style={{ borderColor: CHART.series3 }} aria-hidden />
        {before}
      </span>
    </div>
  );
}
