import type { ReactNode } from "react";
import { ChartNoAxesColumn } from "lucide-react";
import { helpTextClass } from "@/components/ui/control-styles";
import { badgeClass, cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * Card chrome shared by every analytics chart — same surface as MetricTile.
 *
 * Three body states, and they are three because collapsing any two of them
 * tells a seller something untrue:
 *
 *   populated: the chart.
 *   empty:     this IS measured, and the answer for this range is nothing.
 *   awaiting:  nothing measures this yet, so there is no answer to give.
 *               Dashed border and a "Coming soon" badge, matching the
 *               precedent set by MetricTile's pending state.
 *
 * When `empty`, the placeholder holds the chart's height so the layout never
 * jumps between ranges.
 *
 * The card also publishes what it is drawing (`panel` / `source`) as data
 * attributes, so a machine reader can find "the storefront_view trend" without
 * matching on a heading string. See docs/analytics-datapoints.md.
 */
export function ChartCard({
  title,
  description,
  children,
  empty,
  emptyText = "No sales in this range",
  awaiting,
  panel,
  source,
  headingLevel: Heading = "h2",
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  empty?: boolean;
  emptyText?: string;
  /** Nothing produces this data yet. The string says what will. */
  awaiting?: string;
  /** Machine id for what this panel shows, e.g. "trend" or "channels". */
  panel?: string;
  /** Machine id of the analytics source, e.g. "sales" or "storefront_view". */
  source?: string;
  /**
   * The card title's heading level. h2 by default (a card sitting directly
   * under a page h1); sections that add their own h2 pass h3, because a
   * skipped level is a real navigation break for a screen reader, not a
   * styling detail.
   */
  headingLevel?: "h2" | "h3";
  className?: string;
}) {
  const state = awaiting ? "awaiting" : empty ? "empty" : "live";

  return (
    <div
      className={cn(
        cardClass,
        "p-4",
        awaiting && "border-dashed",
        // min-w-0 matters inside the grid rows below: without it a chart's
        // ResponsiveContainer can push a grid column past the viewport and
        // give the whole page a horizontal scrollbar on a phone.
        "min-w-0",
        className,
      )}
      data-analytics-panel={panel}
      data-analytics-source={source}
      data-analytics-state={panel ? state : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Heading className="text-base font-semibold text-foreground">
            {title}
          </Heading>
          {description && (
            <InfoTip label={`How to read ${title}`}>{description}</InfoTip>
          )}
        </div>
        {awaiting && (
          <span
            className={cn(badgeClass, "shrink-0 font-normal text-muted-foreground")}
          >
            Coming soon
          </span>
        )}
      </div>

      <div className="mt-4">
        {awaiting ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2">
            <ChartNoAxesColumn
              className="size-5 text-muted-foreground/60"
              aria-hidden="true"
            />
            <p className="max-w-xs text-center font-inter text-sm text-muted-foreground">
              {awaiting}
            </p>
          </div>
        ) : empty ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2">
            <ChartNoAxesColumn
              className="size-5 text-muted-foreground/60"
              aria-hidden="true"
            />
            <p className={helpTextClass}>{emptyText}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
