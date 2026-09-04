"use client";

import { PieChart } from "@/components/charts";
import type { ChannelSlice } from "@/lib/analytics/types";
import { moneyExact } from "@/components/analytics/chart-format";
import { CHART_HEIGHT } from "@/components/analytics/chart-layout";
import { TONE } from "@/components/analytics/palette";

// Where the money comes from, a donut from the shared chart kit
// (/dev/charts). The hole carries the total, so the card answers "how much"
// and "from where" in one read.
//
// Zero-revenue channels are dropped rather than passed through as empty
// slices: a legend row reading "Marketplace 0%" next to a ring it contributes
// nothing to is noise, and the card's empty state already covers the case
// where there is no revenue at all.

const CHANNEL_LABELS: Record<ChannelSlice["channel"], string> = {
  embed: "Embed",
  marketplace: "Marketplace",
};

/** Colour is PINNED per channel rather than taken in slice order, so a channel
 *  keeps its identity when the other one is empty and the ring re-sorts. Both
 *  are money, but neither is better than the other, so this is a neutral pair
 *  plus the accent rather than green against something. */
const CHANNEL_COLOR_INDEX: Record<ChannelSlice["channel"], number> = {
  embed: TONE.neutral,
  marketplace: TONE.traffic,
};

export function ChannelSplitChart({
  channels,
  currency,
}: {
  channels: ChannelSlice[];
  currency: string;
}) {
  const items = channels
    .filter((slice) => slice.revenueCents > 0)
    .map((slice) => ({
      label: CHANNEL_LABELS[slice.channel],
      value: slice.revenueCents,
      colorIndex: CHANNEL_COLOR_INDEX[slice.channel],
    }));

  return (
    <div className="flex items-center" style={{ minHeight: CHART_HEIGHT }}>
      <PieChart
        items={items}
        valueFormatter={moneyExact(currency)}
        ariaLabel="Paid revenue by channel"
        className="w-full"
      />
    </div>
  );
}
