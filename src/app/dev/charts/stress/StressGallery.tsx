"use client";

import type { ReactNode } from "react";
import { helpTextClass } from "@/components/ui/control-styles";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { AovTrendChart } from "@/components/analytics/AovTrendChart";
import { ChannelSplitChart } from "@/components/analytics/ChannelSplitChart";
import { ChartCard } from "@/components/analytics/ChartCard";
import { RevenueHero } from "@/components/analytics/RevenueHero";
import { SignalTrendChart } from "@/components/analytics/SignalCharts";
import { StatusBreakdown } from "@/components/analytics/StatusBreakdown";
import { TopProductsChart } from "@/components/analytics/TopProductsChart";
import { WeekdayChart } from "@/components/analytics/WeekdayChart";
import { DAY_MS, WEEKDAYS, toIsoDay } from "@/lib/analytics/buckets";
import type { RevenuePoint, WeekdaySlice } from "@/lib/analytics/types";

// Deterministic data (no Date.now, no random): the server and the browser
// render the same thing, and a failing case fails the same way twice.

const START = Date.UTC(2026, 0, 1);

/** `count` daily buckets from 1 January 2026, `cents(day)` each. */
function days(count: number, cents: (day: number) => number, orderCents = 4_000): RevenuePoint[] {
  return Array.from({ length: count }, (_, day) => {
    const revenueCents = Math.max(0, Math.round(cents(day)));
    const sales = revenueCents > 0 ? Math.max(1, Math.round(revenueCents / orderCents)) : 0;
    return {
      date: toIsoDay(START + day * DAY_MS),
      revenueCents,
      sales,
      aovCents: sales > 0 ? Math.round(revenueCents / sales) : 0,
    };
  });
}

/** `count` monthly buckets from January 2023. */
function months(count: number, cents: (month: number) => number): RevenuePoint[] {
  return Array.from({ length: count }, (_, month) => {
    const revenueCents = Math.round(cents(month));
    const sales = Math.round(revenueCents / 4_000);
    return {
      date: `${2023 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}-01`,
      revenueCents,
      sales,
      aovCents: 4_000,
    };
  });
}

const total = (series: RevenuePoint[]) => series.reduce((sum, point) => sum + point.revenueCents, 0);
const rangeOf = (series: RevenuePoint[]) => ({
  from: series[0]?.date ?? null,
  to: series[series.length - 1]?.date ?? null,
});

const wave = (day: number) => 40_000 + Math.sin(day * 1.3) * 22_000 + day * 900;

type HeroCase = { id: string; what: string; series: RevenuePoint[]; previous?: RevenuePoint[]; empty?: boolean };

const HERO_CASES: HeroCase[] = [
  {
    id: "hero-billions",
    what: "Nearly a billion: the longest figure the page can be asked to print",
    series: days(30, (day) => 3_100_000_000 + Math.sin(day) * 900_000_000),
    previous: days(30, (day) => 2_000_000_000 + Math.cos(day) * 500_000_000),
  },
  {
    id: "hero-cents",
    what: "A few cents: an axis with no whole unit on it",
    series: days(30, (day) => (day % 4 === 0 ? 1 : 0), 1),
  },
  { id: "hero-two-days", what: "Two days: the shortest line there is", series: days(2, (day) => 20_000 + day * 15_000) },
  {
    id: "hero-flat",
    what: "The same amount every day: a line with no height",
    series: days(30, () => 25_000),
    previous: days(30, () => 25_000),
  },
  {
    id: "hero-first-day-only",
    what: "Everything sold on the first day",
    series: days(30, (day) => (day === 0 ? 480_000 : 0)),
  },
  {
    id: "hero-last-day-only",
    what: "Everything sold on the last day",
    series: days(30, (day) => (day === 29 ? 480_000 : 0)),
  },
  {
    id: "hero-dwarfed",
    what: "A previous period a hundred times larger than this one",
    series: days(30, (day) => wave(day) / 100),
    previous: days(30, wave),
  },
  { id: "hero-quarter", what: "92 days: the most daily buckets a range can have", series: days(92, wave) },
  { id: "hero-three-years", what: "Three years, bucketed by month", series: months(36, (month) => 900_000 + month * 60_000) },
  {
    id: "hero-empty-range",
    what: "A bounded range with no sales",
    series: [],
    empty: true,
  },
];

/** A week of sales split by product, in the shape the analytics feed sends. */
function week(products: string[], rows: [title: string | null, sales: number[]][]) {
  const weekdays: WeekdaySlice[] = WEEKDAYS.map((weekday, day) => {
    const parts = rows.map(([title, sales]) => ({ title, sales: sales[day] })).filter((part) => part.sales > 0);
    const sales = parts.reduce((sum, part) => sum + part.sales, 0);
    return { weekday, sales, revenueCents: sales * 2_400, products: parts };
  });
  return { weekdays, products };
}

const LONG_TITLE = "Hand-thrown stoneware serving bowl with a speckled oatmeal glaze, large";

const WEEK_CASES: { id: string; what: string; data: ReturnType<typeof week> }[] = [
  {
    id: "week-one-sale",
    what: "A single sale all week: the axis must count in whole sales",
    data: week(["Oak lamp"], [["Oak lamp", [0, 0, 1, 0, 0, 0, 0]]]),
  },
  {
    id: "week-long-titles",
    what: "Product titles that are a sentence, an emoji, another script, and nothing",
    data: week(
      [LONG_TITLE, "🕯️ Bougie", "مصباح خشبي", ""],
      [
        [LONG_TITLE, [4, 2, 3, 1, 5, 9, 6]],
        ["🕯️ Bougie", [2, 1, 0, 2, 3, 4, 2]],
        ["مصباح خشبي", [1, 0, 2, 1, 0, 3, 1]],
        ["", [0, 1, 1, 0, 2, 1, 0]],
        [null, [3, 2, 1, 4, 2, 6, 3]],
      ],
    ),
  },
  {
    id: "week-thousands",
    what: "Tens of thousands of sales a day",
    data: week(
      ["Oak lamp", "Vase"],
      [
        ["Oak lamp", [12_400, 9_800, 11_200, 10_050, 15_900, 28_700, 19_300]],
        ["Vase", [4_100, 3_900, 5_200, 4_800, 6_100, 12_000, 8_800]],
        [null, [900, 700, 800, 650, 1_200, 2_400, 1_500]],
      ],
    ),
  },
  {
    id: "week-no-split",
    what: "No product split available: the plain bars",
    data: {
      weekdays: WEEKDAYS.map((weekday, day) => ({ weekday, sales: [3, 0, 2, 0, 1, 5, 0][day], revenueCents: 0, products: [] })),
      products: [],
    },
  },
];

function Case({ id, what, children }: { id: string; what: string; children: ReactNode }) {
  return (
    <section data-stress-case={id} className="min-w-0 space-y-3">
      <div>
        <h2 className="font-mono text-sm font-semibold text-foreground">{id}</h2>
        <p className={helpTextClass}>{what}</p>
      </div>
      {children}
    </section>
  );
}

export function StressGallery() {
  const oneSaleDay = days(30, (day) => (day === 11 ? 12_990 : 0), 12_990);
  const signals = (count: (day: number) => number) =>
    days(30, () => 0).map((point, day) => ({ date: point.date, count: count(day), valueCents: 0 }));

  return (
    <main className={cn(pageShellClass, "space-y-12")}>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Chart kit — stress cases</h1>
        <p className={cn(helpTextClass, "max-w-3xl")}>
          The analytics charts on the worst data a store can produce. Each block is one case, named
          for what is wrong with its data. Dev-only route, walked by the chart stress spec.
        </p>
      </div>

      {HERO_CASES.map((hero) => (
        <Case key={hero.id} id={hero.id} what={hero.what}>
          <RevenueHero
            series={hero.series}
            range={hero.empty ? { from: "2026-01-01", to: "2026-01-30" } : rangeOf(hero.series)}
            revenueCents={total(hero.series)}
            netRevenueCents={Math.round(total(hero.series) * 0.95)}
            currency="EUR"
            empty={hero.empty ?? false}
            previous={hero.previous && { revenueCents: total(hero.previous), series: hero.previous }}
          />
        </Case>
      ))}

      <div className="grid gap-x-4 gap-y-12 lg:grid-cols-2">
        {WEEK_CASES.map((weekCase) => (
          <Case key={weekCase.id} id={weekCase.id} what={weekCase.what}>
            <ChartCard title="Sales by weekday">
              <WeekdayChart weekdays={weekCase.data.weekdays} products={weekCase.data.products} />
            </ChartCard>
          </Case>
        ))}

        <Case id="aov-one-sale-day" what="One day with a sale in thirty: an average with a single value">
          <ChartCard title="Average order value">
            <AovTrendChart series={oneSaleDay} currency="EUR" />
          </ChartCard>
        </Case>

        <Case id="aov-millions" what="Orders worth millions, against a previous period worth cents">
          <ChartCard title="Average order value">
            <AovTrendChart
              series={days(30, (day) => 450_000_000 + Math.sin(day) * 120_000_000, 450_000_000)}
              previous={days(30, () => 250, 250)}
              currency="EUR"
            />
          </ChartCard>
        </Case>

        <Case id="views-ones" what="One view on a few days: counts must stay whole on the axis">
          <ChartCard title="Storefront views">
            <SignalTrendChart
              kind="storefront_view"
              series={signals((day) => (day % 5 === 0 ? 1 : 0))}
              previous={signals((day) => (day % 7 === 0 ? 2 : 0))}
            />
          </ChartCard>
        </Case>

        <Case id="views-millions" what="Millions of views a day">
          <ChartCard title="Storefront views">
            <SignalTrendChart kind="storefront_view" series={signals((day) => 2_400_000 + day * 310_000)} />
          </ChartCard>
        </Case>

        <Case id="top-products-long" what="Top products with titles of every awkward length">
          <ChartCard title="Top products">
            <TopProductsChart
              currency="EUR"
              products={[
                { title: LONG_TITLE, revenueCents: 98_765_432_109, sales: 4_000 },
                { title: "🕯️ Bougie", revenueCents: 1_200_000, sales: 300 },
                { title: "مصباح خشبي", revenueCents: 990, sales: 1 },
                { title: "", revenueCents: 1, sales: 1 },
              ]}
            />
          </ChartCard>
        </Case>

        <Case id="channels-lopsided" what="One channel with nearly everything, one with a single cent">
          <ChartCard title="Channels">
            <ChannelSplitChart
              currency="EUR"
              channels={[
                { channel: "embed", revenueCents: 98_765_432_109, sales: 9_000 },
                { channel: "marketplace", revenueCents: 1, sales: 1 },
                { channel: "direct", revenueCents: 0, sales: 0 },
                { channel: "button", revenueCents: 250_000, sales: 20 },
              ]}
            />
          </ChartCard>
        </Case>

        <Case id="statuses-lopsided" what="A million paid orders and one of each of the rest">
          <ChartCard title="Order status">
            <StatusBreakdown
              statuses={[
                { status: "paid", count: 1_000_000 },
                { status: "refunded", count: 1 },
                { status: "disputed", count: 1 },
                { status: "pending", count: 1 },
              ]}
            />
          </ChartCard>
        </Case>
      </div>
    </main>
  );
}
