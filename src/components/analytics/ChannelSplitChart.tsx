"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ChannelSlice } from "@/lib/analytics/types";
import { formatCents } from "@/lib/format/money";
import {
  CHART,
  tooltipLabelClass,
  tooltipValueClass,
  tooltipWrapperClass,
} from "@/components/analytics/chart-theme";

// Embed vs marketplace revenue donut (paid orders). Presentational only: the
// parent fetches via getAnalytics and always passes both channels (embed
// first, zeros included). Total revenue sits in the donut's centre.

const CHANNEL_LABELS: Record<ChannelSlice["channel"], string> = {
  embed: "Embed",
  marketplace: "Marketplace",
};

/** Slice colours by channel — the accent goes to embed, marketplace stays muted. */
const CHANNEL_COLORS: Record<ChannelSlice["channel"], string> = {
  embed: CHART.seriesPrimary,
  marketplace: CHART.seriesMuted,
};

// Structural subset of recharts' tooltip content props — typing only what the
// tooltip reads keeps it compatible with the wide ValueType/NameType generics.
type SliceTooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  currency: string;
};

function SliceTooltip({ active, payload, currency }: SliceTooltipProps) {
  const slice = payload?.[0]?.payload as ChannelSlice | undefined;
  if (!active || !slice) return null;
  return (
    <div className={tooltipWrapperClass}>
      <p className={tooltipLabelClass}>{CHANNEL_LABELS[slice.channel]}</p>
      <p className={tooltipValueClass}>{formatCents(slice.revenueCents, currency)}</p>
      <p className={tooltipLabelClass}>
        {slice.sales} {slice.sales === 1 ? "sale" : "sales"}
      </p>
    </div>
  );
}

export function ChannelSplitChart({
  channels,
  currency,
}: {
  channels: ChannelSlice[];
  currency: string;
}) {
  const totalCents = channels.reduce((sum, slice) => sum + slice.revenueCents, 0);
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
      <div className="relative h-64 w-64 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) => (
                <SliceTooltip active={active} payload={payload} currency={currency} />
              )}
            />
            <Pie
              data={channels}
              dataKey="revenueCents"
              nameKey="channel"
              innerRadius="60%"
              outerRadius="80%"
              strokeWidth={0}
              isAnimationActive={false}
            >
              {channels.map((slice) => (
                <Cell key={slice.channel} fill={CHANNEL_COLORS[slice.channel]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Centred total — the donut's headline number. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-inter text-xs text-muted-foreground">Total</span>
          <span className="text-lg font-semibold text-foreground">
            {formatCents(totalCents, currency)}
          </span>
        </div>
      </div>
      <ul className="flex flex-col gap-3">
        {channels.map((slice) => (
          <li key={slice.channel} className="flex items-center gap-3">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: CHANNEL_COLORS[slice.channel] }}
            />
            <div className="font-inter text-sm">
              <span className="text-foreground">{CHANNEL_LABELS[slice.channel]}</span>
              <span className="ml-2 font-semibold text-foreground">
                {formatCents(slice.revenueCents, currency)}
              </span>
              <span className="ml-2 text-muted-foreground">
                {slice.sales} {slice.sales === 1 ? "sale" : "sales"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
