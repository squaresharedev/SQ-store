import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  CardBackdrop,
  type CardBackdropTone,
  type CardBackdropVariant,
} from "@/components/ui/CardBackdrop";
import type { MetricTrend } from "@/lib/dashboard/queries";
import { Sparkline } from "./Sparkline";

/**
 * One headline metric. `value` is pre-formatted by the caller (money always
 * from integer cents); a null value renders the calm zero state instead of a
 * fake number. `pending` marks stubbed metrics (Views/Clicks) that wait on
 * analytics — visibly "coming soon", never invented data.
 */
export function MetricTile({
  label,
  value,
  hint,
  zeroText = "No sales yet",
  pending = false,
  emphasis = false,
  trend,
  decoration,
  decorationTone,
  children,
}: {
  label: string;
  value?: string | null;
  /** Secondary line, e.g. the all-time figure under the 30-day one. */
  hint?: string;
  zeroText?: string;
  pending?: boolean;
  /** Render the value as the page's one hero number: large, gradient-filled. */
  emphasis?: boolean;
  /** Show a bare trend line to the right of a (bigger) value. */
  trend?: MetricTrend;
  /** Fade a decorative texture into the corner — for the hero metric only. */
  decoration?: CardBackdropVariant;
  decorationTone?: CardBackdropTone;
  /** Custom body instead of a single value. */
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-card p-4 shadow-xs",
        pending ? "border-dashed border-border" : "border-border",
        decoration && "relative overflow-hidden",
      )}
    >
      {decoration && (
        <CardBackdrop variant={decoration} corner="tr" tone={decorationTone} />
      )}
      <div className="relative flex items-center justify-between gap-2">
        <span className="font-inter text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {pending && (
          <span className="rounded-full bg-secondary px-2 py-0.5 font-inter text-xs text-muted-foreground">
            Coming soon
          </span>
        )}
      </div>

      <div className="relative mt-2">
        {pending ? (
          <p className="font-inter text-sm text-muted-foreground">
            Available once analytics is connected.
          </p>
        ) : children ? (
          children
        ) : value && trend ? (
          // Bigger value pinned left, bare trend line filling the right.
          <div className="flex items-center gap-3">
            <p className="truncate text-3xl font-semibold text-foreground sm:text-4xl">
              {value}
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
            {value}
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
