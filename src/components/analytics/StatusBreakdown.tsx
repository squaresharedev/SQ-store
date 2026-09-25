"use client";

import { useLocale, useTranslations } from "next-intl";
import { CompositionBar, formatNumber } from "@/components/charts";
import type { StatusSlice } from "@/lib/analytics/types";
import { CHART_HEIGHT } from "@/components/analytics/chart-layout";
import { TONE } from "@/components/analytics/palette";

// The order mix as one divided total bar, the chart kit's CompositionBar
// (/dev/charts), which is the h-subtype built for exactly this: a handful of
// parts of one whole, where the reader wants the shares in words rather than
// to compare angles.
//
// Colours are PINNED per status rather than taken in order, so meaning never
// moves: refunds stay red whether they are the second segment or the last, and
// a range with no disputes does not promote "disputed" into the ink slot.
//
// Presentational only: the parent always passes all four statuses in a fixed
// order, zeros included.


/** The one chart where all three tones appear at once, which is why the mix is
 *  worth reading as a picture: green is money that landed, red is money that
 *  went back, and the two states still in flight stay neutral because neither
 *  is good or bad yet. */
const STATUS_COLOR_INDEX: Record<StatusSlice["status"], number> = {
  paid: TONE.money,
  refunded: TONE.loss,
  disputed: TONE.quiet,
  pending: TONE.faint,
};

export function StatusBreakdown({ statuses }: { statuses: StatusSlice[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const items = statuses.map((slice) => ({
    label: t(`Orders.status.${slice.status}`),
    value: slice.count,
    colorIndex: STATUS_COLOR_INDEX[slice.status],
  }));

  return (
    <div
      className="flex flex-col justify-center"
      style={{ minHeight: CHART_HEIGHT }}
    >
      <CompositionBar
        items={items}
        valueFormatter={(value) => formatNumber(value, locale)}
        ariaLabel={t("Analytics.sales.orderStatus.ariaLabel")}
      />
    </div>
  );
}
