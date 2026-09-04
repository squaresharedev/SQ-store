import type { ReactNode } from "react";
import { helpTextClass } from "@/components/ui/control-styles";
import { badgeClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import {
  CardBackdrop,
  type CardBackdropTone,
  type CardBackdropVariant,
} from "@/components/ui/CardBackdrop";
import { CountUp } from "@/components/ui/CountUp";
import type { MetricTrend } from "@/lib/dashboard/queries";
import { Sparkline } from "./Sparkline";

/**
 * One headline metric. `value` is pre-formatted by the caller (money always
 * from integer cents); a null value renders the calm zero state instead of a
 * fake number. `pending` marks stubbed metrics that wait on a pipeline:
 * visibly "coming soon", never invented data.
 *
 * `datapoint` publishes the tile's RAW figure to the DOM so a reader that is
 * not a person (a scraper, the future MCP surface) gets the number rather than
 * the rendering of it: "€1,204.50" is a string with a locale and a currency
 * symbol baked in, 120450 is a fact. Optional, because most tiles are read by
 * eyes only; see docs/analytics-datapoints.md for the contract.
 */
export type MetricDatapoint = {
  /** Stable machine id, e.g. "sales.revenue". Part of the published contract. */
  metric: string;
  /** The raw figure. Integer cents for money, a plain count otherwise. */
  value: number;
  /** How to read `value`. */
  unit: "currency_cents" | "count" | "percent" | "days";
  /** ISO currency for `currency_cents` units. */
  currency?: string;
  /** Which analytics source this belongs to (sales, storefront_view, ...). */
  source?: string;
};

export function MetricTile({
  label,
  value,
  hint,
  zeroText = "No sales yet",
  pending = false,
  pendingText = "Available once analytics is connected.",
  emphasis = false,
  trend,
  decoration,
  decorationTone,
  datapoint,
  children,
}: {
  label: string;
  value?: string | null;
  /** Secondary line, e.g. the all-time figure under the 30-day one. */
  hint?: string;
  zeroText?: string;
  pending?: boolean;
  /** What a pending tile says instead of a number. Say what will fill it: the
   *  default predates the analytics pipeline and is only right for a metric
   *  that really is waiting on analytics itself. */
  pendingText?: string;
  /** Render the value as the page's one hero number: large, gradient-filled. */
  emphasis?: boolean;
  /** Show a bare trend line to the right of a (bigger) value. */
  trend?: MetricTrend;
  /** Fade a decorative texture into the corner — for the hero metric only. */
  decoration?: CardBackdropVariant;
  decorationTone?: CardBackdropTone;
  /** Publish the raw figure as data attributes. See MetricDatapoint. */
  datapoint?: MetricDatapoint;
  /** Custom body instead of a single value. */
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-center rounded-md border bg-card p-4 shadow-xs",
        pending ? "border-dashed border-border" : "border-border",
        decoration && "relative overflow-hidden",
      )}
      data-analytics-metric={datapoint?.metric}
      // Pending tiles publish no value at all rather than a zero: a reader must
      // be able to tell "nothing has happened" from "nothing measures this".
      data-analytics-value={
        datapoint && !pending ? String(datapoint.value) : undefined
      }
      data-analytics-unit={datapoint?.unit}
      data-analytics-currency={datapoint?.currency}
      data-analytics-source={datapoint?.source}
      data-analytics-state={datapoint ? (pending ? "awaiting" : "live") : undefined}
    >
      {decoration && (
        <CardBackdrop variant={decoration} corner="tr" tone={decorationTone} />
      )}
      <div className="relative flex items-center justify-between gap-2">
        <span className="font-inter text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {pending && (
          <span className={cn(badgeClass, "font-normal text-muted-foreground")}>
            Coming soon
          </span>
        )}
      </div>

      <div className="relative mt-2">
        {pending ? (
          <p className={helpTextClass}>{pendingText}</p>
        ) : children ? (
          children
        ) : value && trend ? (
          // Bigger value pinned left, bare trend line filling the right.
          <div className="flex items-center gap-3">
            <p className="truncate text-3xl font-semibold text-foreground sm:text-4xl">
              <CountUp value={value} />
            </p>
            <Sparkline
              points={trend.points}
              tone={trend.tone}
              className="ml-auto h-10 w-20 shrink-0 sm:w-28"
            />
          </div>
        ) : value ? (
          <p
            className={cn(
              "truncate",
              emphasis
                ? "text-4xl font-bold text-success sm:text-5xl lg:text-6xl"
                : "text-2xl font-semibold text-foreground",
            )}
          >
            <CountUp value={value} />
          </p>
        ) : (
          <p className="text-base font-medium text-muted-foreground">
            {zeroText}
          </p>
        )}
        {!pending && hint && (
          <p className="mt-1 font-inter text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  );
}
