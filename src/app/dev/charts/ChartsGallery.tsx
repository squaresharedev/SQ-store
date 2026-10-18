"use client";

import { helpTextClass } from "@/components/ui/control-styles";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { ChartCard } from "@/components/analytics/ChartCard";
import { RevenueHero } from "@/components/analytics/RevenueHero";
import { HERO_RANGE, heroSeries } from "./hero-fixtures";
import {
  BarChart,
  CompositionBar,
  HBarChart,
  LineChart,
  PieChart,
  formatNumber,
} from "@/components/charts";

// Deterministic sample data (no Date/random — server and client render the
// same text). Money is integer cents, like the real analytics feed.

const euro = (cents: number) => `€${formatNumber(Math.round(cents / 100), "en")}`;
const euroCompact = (cents: number) => {
  const units = Math.round(cents / 100);
  if (Math.abs(units) < 1000) return `€${units}`;
  return `€${Math.round(units / 100) / 10}k`;
};

const WEEKLY_REVENUE = [
  { week: "May 4", revenue: 48_200, refunds: 2_400 },
  { week: "May 11", revenue: 54_900, refunds: 1_800 },
  { week: "May 18", revenue: 51_300, refunds: 4_100 },
  { week: "May 25", revenue: 63_800, refunds: 2_200 },
  { week: "Jun 1", revenue: 59_400, refunds: 5_600 },
  { week: "Jun 8", revenue: 71_900, refunds: 3_000 },
  { week: "Jun 15", revenue: 68_200, refunds: 2_700 },
  { week: "Jun 22", revenue: 79_500, refunds: 4_800 },
  { week: "Jun 29", revenue: 74_100, refunds: 3_500 },
  { week: "Jul 6", revenue: 86_400, refunds: 2_900 },
  { week: "Jul 13", revenue: 91_200, refunds: 6_200 },
  { week: "Jul 20", revenue: 97_800, refunds: 3_800 },
];

const DAILY_SESSIONS = [
  { day: "Jul 8", sessions: 342 },
  { day: "Jul 9", sessions: 418 },
  { day: "Jul 10", sessions: 386 },
  { day: "Jul 11", sessions: 472 },
  { day: "Jul 12", sessions: 519 },
  { day: "Jul 13", sessions: 445 },
  { day: "Jul 14", sessions: 501 },
  { day: "Jul 15", sessions: 548 },
  { day: "Jul 16", sessions: 507 },
  { day: "Jul 17", sessions: 611 },
  { day: "Jul 18", sessions: 584 },
  { day: "Jul 19", sessions: 656 },
  { day: "Jul 20", sessions: 640 },
];

const WEEKDAY_ORDERS = [
  { weekday: "Mon", thisWeek: 14, lastWeek: 11 },
  { weekday: "Tue", thisWeek: 18, lastWeek: 15 },
  { weekday: "Wed", thisWeek: 12, lastWeek: 16 },
  { weekday: "Thu", thisWeek: 21, lastWeek: 14 },
  { weekday: "Fri", thisWeek: 26, lastWeek: 22 },
  { weekday: "Sat", thisWeek: 31, lastWeek: 27 },
  { weekday: "Sun", thisWeek: 19, lastWeek: 21 },
];

const MONTHLY_CHANNELS = [
  { month: "Feb", embed: 21_400, marketplace: 14_800, direct: 6_100 },
  { month: "Mar", embed: 25_900, marketplace: 16_300, direct: 7_400 },
  { month: "Apr", embed: 23_700, marketplace: 19_800, direct: 6_800 },
  { month: "May", embed: 29_800, marketplace: 22_400, direct: 9_200 },
  { month: "Jun", embed: 34_100, marketplace: 24_900, direct: 8_600 },
  { month: "Jul", embed: 38_600, marketplace: 27_200, direct: 11_300 },
];

const TOP_PRODUCTS = [
  { product: "Acid Tee", revenue: 84_200 },
  { product: "A2 Poster", revenue: 61_800 },
  { product: "Sticker Pack", revenue: 43_500 },
  { product: "Tote Bag", revenue: 32_900 },
  { product: "Hoodie", revenue: 28_400 },
  { product: "Enamel Pin", revenue: 17_600 },
];

const PRODUCT_MONTHS = [
  { product: "Acid Tee", jun: 38_100, jul: 46_100 },
  { product: "A2 Poster", jun: 33_400, jul: 28_400 },
  { product: "Sticker Pack", jun: 18_900, jul: 24_600 },
  { product: "Tote Bag", jun: 15_200, jul: 17_700 },
];

// Statuses pin their colours so meaning stays fixed across filtered views:
// healthy ink, neutral greys for the in-limbo states, red only where money
// went backwards (mirrors the analytics StatusBreakdown).
const ORDER_STATUS = [
  { label: "Paid", value: 164, colorIndex: 0 }, // ink
  { label: "Pending", value: 23, colorIndex: 2 }, // light grey
  { label: "Refunded", value: 11, colorIndex: 5 }, // red — semantic
  { label: "Disputed", value: 3, color: "var(--chart-4)" }, // faintest grey
];

const CHANNEL_REVENUE = [
  { label: "Embed", value: 38_600 },
  { label: "Marketplace", value: 27_200 },
  { label: "Direct", value: 11_300 },
];

// Eight categories — two beyond the fold, so the pie demos the automatic
// "Other" tail.
const CATEGORY_SALES = [
  { label: "Apparel", value: 212 },
  { label: "Prints", value: 168 },
  { label: "Stickers", value: 131 },
  { label: "Accessories", value: 89 },
  { label: "Homeware", value: 54 },
  { label: "Music", value: 38 },
  { label: "Zines", value: 21 },
  { label: "Misc", value: 12 },
];


type HeroSpecimen = {
  title: string;
  note: string;
  series: ReturnType<typeof heroSeries>;
  /** The period before, for the versus specimens. */
  previous?: ReturnType<typeof heroSeries>;
  range?: { from: string; to: string };
};

// The analytics revenue hero, once per shape that changes where its figure
// sits: the figure takes the top corner the line leaves free.
const HERO_SPECIMENS: HeroSpecimen[] = [
  {
    title: "Bleed — versus the previous period, up",
    note: "The period before is the dashed grey line, first day on first day; the change is stated under the figure",
    series: heroSeries((day) => 22_000 + day * 2_100 + Math.sin(day * 1.7) * 9_000),
    previous: heroSeries((day) => 18_000 + day * 1_300 + Math.sin(day * 1.1 + 2) * 8_000),
  },
  {
    title: "Bleed — versus the previous period, down",
    note: "A slower period: the dashed line runs above, and the change is stated without turning red",
    series: heroSeries((day) => 70_000 - day * 1_500 + Math.sin(day * 1.3) * 9_000),
    previous: heroSeries((day) => 82_000 - day * 900 + Math.sin(day * 0.9 + 1) * 10_000),
  },
  {
    title: "Bleed — one value",
    note: "A one-day range: the point is marked and a dotted level runs through it, with the day before as a grey point",
    series: heroSeries(() => 48_500).slice(0, 1),
    previous: heroSeries(() => 31_000).slice(0, 1),
    range: { from: "2026-09-01", to: "2026-09-01" },
  },
  {
    title: "Bleed — going up",
    note: "Low on the left, so the figure sits top left and the value labels run down the right",
    series: heroSeries((day) => 9_000 + day * 2_600 + Math.sin(day * 1.7) * 9_000),
  },
  {
    title: "Bleed — going down",
    note: "Low on the right, so the figure moves top right and the value labels move left",
    series: heroSeries((day) => 88_000 - day * 2_400 + Math.sin(day * 1.3) * 10_000),
  },
  {
    title: "Bleed — one early spike",
    note: "Rising overall, but the room is on the right: the corner is judged on where the line is low",
    series: heroSeries((day) => (day === 2 ? 120_000 : 8_000 + day * 900 + Math.cos(day) * 5_000)),
  },
  {
    title: "Bleed — empty range",
    note: "No sales: the same chart lying flat, grey, with words where the figure would be",
    series: [],
  },
];

export function ChartsGallery() {
  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Chart kit</h1>
        <p className={helpTextClass}>
          Reusable analytics graphs (components/charts) — every family and
          subtype, with sample data. Dev-only route.
        </p>
      </div>

      {/* The one chart that is not a card: the analytics revenue hero, in its
          frame of corner marks. */}
      {HERO_SPECIMENS.map((specimen) => {
        const revenueCents = specimen.series.reduce((sum, point) => sum + point.revenueCents, 0);
        return (
          <section key={specimen.title} className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">{specimen.title}</h2>
              <p className={helpTextClass}>{specimen.note}</p>
            </div>
            <RevenueHero
              series={specimen.series}
              range={specimen.range ?? HERO_RANGE}
              revenueCents={revenueCents}
              netRevenueCents={Math.round(revenueCents * 0.95)}
              currency="EUR"
              empty={specimen.series.length === 0}
              previous={
                specimen.previous && {
                  revenueCents: specimen.previous.reduce((sum, point) => sum + point.revenueCents, 0),
                  series: specimen.previous,
                }
              }
            />
          </section>
        );
      })}

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard
          title="Line — multi-series"
          description="Ink leads; refunds pinned red because red means money going back"
        >
          <LineChart
            data={WEEKLY_REVENUE}
            xKey="week"
            series={[
              { key: "revenue", label: "Revenue" },
              { key: "refunds", label: "Refunds", colorIndex: 5 },
            ]}
            valueFormatter={euro}
            axisValueFormatter={euroCompact}
            ariaLabel="Weekly revenue and refunds"
          />
        </ChartCard>

        <ChartCard
          title="Line — area"
          description={'variant="area", single series (near-black ink, gradient wash)'}
        >
          <LineChart
            data={DAILY_SESSIONS}
            xKey="day"
            series={[{ key: "sessions", label: "Sessions" }]}
            variant="area"
            ariaLabel="Daily storefront sessions"
          />
        </ChartCard>

        <ChartCard
          title="Line — versus a reference"
          description="reference: true. The previous period is dashed, thin and behind; the legend names both"
        >
          <LineChart
            data={DAILY_SESSIONS.map((point, index) => ({
              ...point,
              before: Math.round(point.sessions * (0.78 + ((index * 7) % 5) / 20)),
            }))}
            xKey="day"
            series={[
              { key: "sessions", label: "Sessions", colorIndex: 3 },
              { key: "before", label: "Previous period", colorIndex: 1, reference: true },
            ]}
            variant="area"
            ariaLabel="Daily sessions versus the previous period"
          />
        </ChartCard>

        <ChartCard
          title="Line — one value"
          description="A line needs two points. One value is a marked point with a dotted level through it"
        >
          <LineChart
            data={[{ day: "Jul 20", sessions: 640 }]}
            xKey="day"
            series={[{ key: "sessions", label: "Sessions", colorIndex: 3 }]}
            variant="area"
            ariaLabel="Sessions on one day"
          />
        </ChartCard>

        <ChartCard
          title="Line — one value among gaps"
          description="Thirteen days, one of them with a value (an average with a single sale): the point sits on its own day"
        >
          <LineChart
            data={DAILY_SESSIONS.map((point, index) => ({
              day: point.day,
              sessions: index === 8 ? point.sessions : null,
            }))}
            xKey="day"
            series={[{ key: "sessions", label: "Sessions", colorIndex: 4 }]}
            connectNulls
            ariaLabel="Sessions with a single recorded day"
          />
        </ChartCard>

        <ChartCard
          title="Bars — grouped"
          description="This week in ink, last week recedes to grey"
        >
          <BarChart
            data={WEEKDAY_ORDERS}
            xKey="weekday"
            series={[
              { key: "thisWeek", label: "This week" },
              { key: "lastWeek", label: "Last week" },
            ]}
            ariaLabel="Orders by weekday"
          />
        </ChartCard>

        <ChartCard
          title="Bars — stacked"
          description="Monochrome stack: ink, grey, light grey with 2px surface gaps"
        >
          <BarChart
            data={MONTHLY_CHANNELS}
            xKey="month"
            series={[
              { key: "embed", label: "Embed" },
              { key: "marketplace", label: "Marketplace" },
              { key: "direct", label: "Direct" },
            ]}
            variant="stacked"
            valueFormatter={euro}
            axisValueFormatter={euroCompact}
            ariaLabel="Monthly revenue by channel"
          />
        </ChartCard>

        <ChartCard
          title="Horizontal bars — single series"
          description="One series wears the ink; rows size to content"
        >
          <HBarChart
            data={TOP_PRODUCTS}
            xKey="product"
            series={[{ key: "revenue", label: "Revenue" }]}
            valueFormatter={euro}
            axisValueFormatter={euroCompact}
            ariaLabel="Top products by revenue"
          />
        </ChartCard>

        <ChartCard
          title="Horizontal bars — grouped"
          description="Current month pinned to ink, June recedes — colour follows the entity"
        >
          <HBarChart
            data={PRODUCT_MONTHS}
            xKey="product"
            series={[
              { key: "jun", label: "June", colorIndex: 1 },
              { key: "jul", label: "July", colorIndex: 0 },
            ]}
            valueFormatter={euro}
            axisValueFormatter={euroCompact}
            ariaLabel="Product revenue, June vs July"
          />
        </ChartCard>

        <ChartCard
          title="Composition bar"
          description="The one-line horizontal subtype: the bar is the total, sections are the mix"
        >
          <div className="flex h-64 flex-col justify-center">
            <CompositionBar items={ORDER_STATUS} ariaLabel="Order status mix" />
          </div>
        </ChartCard>

        <ChartCard
          title="Donut"
          description="Monochrome ring, headline total in the hole; hover a row to trace it"
        >
          <div className="flex h-64 items-center">
            <PieChart
              items={CHANNEL_REVENUE}
              valueFormatter={euro}
              ariaLabel="Revenue by channel"
              className="w-full"
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Pie — with automatic fold"
          description={'variant="pie"; 8 categories fold to 4 + "Other" — blue enters as the 4th slot'}
        >
          <div className="flex h-64 items-center">
            <PieChart
              items={CATEGORY_SALES}
              variant="pie"
              ariaLabel="Sales by category"
              className="w-full"
            />
          </div>
        </ChartCard>
      </div>
    </main>
  );
}
