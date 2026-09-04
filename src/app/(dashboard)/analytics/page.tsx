import type { Metadata } from "next";
import { pageShellClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { getAnalyticsSnapshot } from "@/lib/analytics/queries";
import type { AnalyticsRange, RangePreset } from "@/lib/analytics/types";
import { AnalyticsPage } from "@/components/analytics/AnalyticsPage";

export const metadata: Metadata = {
  title: "Analytics",
};

// PROTECTED by (dashboard)/layout.tsx. Reads are owner-scoped (session + RLS)
// and strictly read-only against orders. The date range lives in the URL so
// views are shareable and back/forward works:
//   (none)          -> last 30 days (default)
//   ?range=all      -> all time
//   ?from=&to=      -> custom inclusive bounds (either side optional)

type SearchParams = { [key: string]: string | string[] | undefined };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Today minus (days - 1) as ISO "YYYY-MM-DD" — a `days`-day inclusive window. */
function isoDaysBack(days: number): string {
  return new Date(Date.now() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** Whitelist-parse the URL params; anything malformed falls back to 30d. */
function parseParams(params: SearchParams): {
  preset: RangePreset;
  /** Custom bounds echoed back to the picker (empty for presets). */
  custom: AnalyticsRange;
  /** The bounds the query actually runs with. */
  effective: AnalyticsRange;
} {
  const from = first(params.from);
  const to = first(params.to);
  const validFrom = from && ISO_DATE.test(from) ? from : null;
  const validTo = to && ISO_DATE.test(to) ? to : null;
  if (validFrom || validTo) {
    const custom = { from: validFrom, to: validTo };
    return { preset: "custom", custom, effective: custom };
  }
  if (first(params.range) === "all") {
    return {
      preset: "all",
      custom: { from: null, to: null },
      effective: { from: null, to: null },
    };
  }
  return {
    preset: "30d",
    custom: { from: null, to: null },
    effective: { from: isoDaysBack(DEFAULT_WINDOW_DAYS), to: null },
  };
}

export default async function AnalyticsRoutePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { preset, custom, effective } = parseParams(await searchParams);
  // One payload for the whole page: the charts render it and the page also
  // publishes it verbatim as machine-readable JSON, so the two cannot drift.
  const snapshot = await getAnalyticsSnapshot(effective, preset);

  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader
        title="Analytics"
        subtitle="Sales, storefront views and everything else your store is doing."
      />
      <AnalyticsPage snapshot={snapshot} custom={custom} />
    </main>
  );
}
