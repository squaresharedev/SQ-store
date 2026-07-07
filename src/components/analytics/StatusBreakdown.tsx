"use client";

import type { StatusSlice } from "@/lib/analytics/types";
import { CHART } from "@/components/analytics/chart-theme";

// Order mix by status — one proportional distribution bar plus a legend, the
// crispest way to read a 4-part split. Token-styled divs (no Recharts): the
// sharp segments match the brand's square identity. Presentational only: the
// parent fetches via getAnalytics and always passes all four statuses in a
// fixed order, zeros included.

const STATUS_LABELS: Record<StatusSlice["status"], string> = {
  paid: "Paid",
  refunded: "Refunded",
  disputed: "Disputed",
  pending: "Pending",
};

/** Segment colours: healthy accent for paid, semantic red for refunds,
 *  quieter neutrals for the in-limbo states — all from the chart ramp. */
const STATUS_COLORS: Record<StatusSlice["status"], string> = {
  paid: CHART.series1,
  refunded: CHART.negative,
  disputed: CHART.series3,
  pending: CHART.series4,
};

export function StatusBreakdown({ statuses }: { statuses: StatusSlice[] }) {
  const total = statuses.reduce((sum, slice) => sum + slice.count, 0);
  const present = statuses.filter((slice) => slice.count > 0);

  return (
    <div className="flex h-64 flex-col justify-center gap-6">
      {/* The distribution bar — widths are data-proportional, colours tokens. */}
      <div className="flex h-3 w-full gap-px overflow-hidden bg-muted">
        {present.map((slice) => (
          <div
            key={slice.status}
            className="h-full"
            style={{
              width: `${(slice.count / total) * 100}%`,
              backgroundColor: STATUS_COLORS[slice.status],
            }}
          />
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-x-6 gap-y-3">
        {statuses.map((slice) => {
          const share = total > 0 ? Math.round((slice.count / total) * 100) : 0;
          return (
            <li key={slice.status} className="flex items-center gap-3">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[slice.status] }}
              />
              <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2 font-inter text-sm">
                <span className="text-foreground">
                  {STATUS_LABELS[slice.status]}
                </span>
                <span className="text-muted-foreground">
                  {slice.count} · {share}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
