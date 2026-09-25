"use client";

import { useTranslations, useLocale } from "next-intl";
import { BarChart, HBarChart, LineChart, PieChart, formatNumber } from "@/components/charts";
import { formatBucketLabel, formatWeekdayLabel, isMonthlySeries } from "@/lib/analytics/buckets";
import { CHANNEL_LABELS, type SignalChannel, type SignalKind } from "@/lib/analytics/signals";
import type {
  SignalChannelSlice,
  SignalPoint,
  SignalStorefrontSlice,
  SignalWeekdaySlice,
} from "@/lib/analytics/types";

import { CHART_HEIGHT } from "@/components/analytics/chart-layout";
import { TONE } from "@/components/analytics/palette";

// THE PANELS EVERY SIGNAL SOURCE SHARES.
//
// These are generic over the KIND, not written per feature: the same four
// components draw storefront views today and calendar bookings the day that
// block ships, because a signal breakdown has the same shape whatever produced
// it. That is the whole reason the aggregate groups by kind rather than
// returning a bespoke payload per feature. See sources.ts.
//
// Two things travel with every panel so they read as sentences rather than as
// bare integers in a generic frame: the source's count phrase ("12 views",
// "1 booking", from Analytics.sources.<kind>.count), which reaches tooltips
// and the sr-only table twins,
// and its TONE, which is blue for traffic and green for a source that carries
// money (see palette.ts). A booking is income and should not look like a page
// view.

/** Blue unless the caller says this source is money. */
type Toned = { tone?: number };

/** The source's copy, from its catalogue entry. */
function useSourceCopy(kind: SignalKind) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  return {
    t,
    locale,
    /** Series name in the legend, tooltip and table, e.g. "Storefront views". */
    label: t(`sources.${kind}.label`),
    count: (value: number) =>
      t(`sources.${kind}.count`, { count: value, formatted: formatNumber(value, locale) }),
  };
}

export function SignalTrendChart({
  series,
  kind,
  tone = TONE.traffic,
}: Toned & {
  series: SignalPoint[];
  kind: SignalKind;
}) {
  const { t, locale, label, count } = useSourceCopy(kind);
  const monthly = isMonthlySeries(series.map((point) => point.date));
  return (
    <LineChart
      data={series}
      xKey="date"
      series={[{ key: "count", label, colorIndex: tone }]}
      variant="area"
      height={CHART_HEIGHT}
      valueFormatter={count}
      xFormatter={(date) => formatBucketLabel(date, monthly, locale)}
      ariaLabel={t(`sources.${kind}.overTime`)}
    />
  );
}

/** Pinned per channel, so a channel keeps its colour when a sibling is empty
 *  and the ring re-sorts. None of the three is better than the others, so this
 *  is the neutral pair plus the accent, never green against grey. */
const CHANNEL_COLOR_INDEX: Record<SignalChannel, number> = {
  embed: TONE.neutral,
  marketplace: TONE.traffic,
  direct: TONE.faint,
};

export function SignalChannelChart({
  channels,
  kind,
}: {
  channels: SignalChannelSlice[];
  kind: SignalKind;
}) {
  const { t, count } = useSourceCopy(kind);
  const tAll = useTranslations();
  // Channels with nothing in them are dropped rather than shown as 0%: a
  // legend row for a ring segment that does not exist is noise, and the card's
  // empty state already covers "no signals at all".
  const items = channels
    .filter((slice) => slice.count > 0)
    .map((slice) => ({
      label: tAll(CHANNEL_LABELS[slice.channel]),
      value: slice.count,
      colorIndex: CHANNEL_COLOR_INDEX[slice.channel],
    }));

  return (
    <div className="flex items-center" style={{ minHeight: CHART_HEIGHT }}>
      <PieChart
        items={items}
        valueFormatter={count}
        ariaLabel={t(`sources.${kind}.byChannel`)}
        className="w-full"
      />
    </div>
  );
}

export function SignalWeekdayChart({
  weekdays,
  kind,
  tone = TONE.traffic,
}: Toned & {
  weekdays: SignalWeekdaySlice[];
  kind: SignalKind;
}) {
  const { t, locale, label, count } = useSourceCopy(kind);
  return (
    <BarChart
      data={weekdays}
      xKey="weekday"
      xFormatter={(weekday) => formatWeekdayLabel(weekday, locale)}
      series={[{ key: "count", label, colorIndex: tone }]}
      height={CHART_HEIGHT}
      valueFormatter={count}
      ariaLabel={t(`sources.${kind}.byWeekday`)}
    />
  );
}

/** Storefront titles are user content and the axis column is finite. */
const MAX_LABEL = 22;

export function SignalStorefrontsChart({
  storefronts,
  kind,
  tone = TONE.traffic,
}: Toned & {
  storefronts: SignalStorefrontSlice[];
  kind: SignalKind;
}) {
  const { t, label, count } = useSourceCopy(kind);
  // A deleted storefront keeps its counts (the signal rows survive it, by
  // design) but loses its name. Reporting the total under a plain label is
  // more honest than dropping rows and quietly under-reporting the source.
  const data = storefronts.map((slice, index) => ({
    // The key must be unique per row: two deleted storefronts would otherwise
    // collapse into one bar.
    name:
      slice.name ??
      (index > 0
        ? t("signal.deletedStorefrontNumbered", { number: index + 1 })
        : t("signal.deletedStorefront")),
    count: slice.count,
  }));

  return (
    <HBarChart
      data={data}
      xKey="name"
      series={[{ key: "count", label, colorIndex: tone }]}
      categoryWidth={116}
      categoryFormatter={(name) => {
        // Recharts 3.x SVG text nodes lose regular spaces when the browser
        // renders them: "Untitled storefront" becomes "Untitledstorefront".
        // Replace spaces with non-breaking spaces ( ) so SVG preserves
        // them. Applied AFTER the truncation so the ellipsis stays a single
        // visible character.
        const truncated =
          name.length > MAX_LABEL
            ? `${name.slice(0, MAX_LABEL - 1)}…`
            : name;
        return truncated.replace(/ /g, " ");
      }}
      valueFormatter={count}
      ariaLabel={t(`sources.${kind}.byStorefront`)}
    />
  );
}
