"use client";

import { ChartCard } from "@/components/analytics/ChartCard";
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

const euro = (cents: number) => `€${formatNumber(Math.round(cents / 100))}`;
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

export function ChartsGallery() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Chart kit</h1>
        <p className="font-inter text-sm text-muted-foreground">
          Reusable analytics graphs (components/charts) — every family and
          subtype, with sample data. Dev-only route.
        </p>
      </div>

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
