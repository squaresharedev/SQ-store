import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/format/csv";
import { SIGNAL_KINDS, type SignalKind } from "@/lib/analytics/signals";
import type { AnalyticsSnapshot, SignalBreakdown } from "@/lib/analytics/types";
import {
  ANALYTICS_REPORT_COLUMNS,
  analyticsReportCsv,
  analyticsReportFileName,
  signalColumn,
} from "@/lib/analytics/report-csv";

// The Pro analytics report: the page's own snapshot as a CSV, one row per
// period, joining sales and the signals the store actually records.

function breakdown(kind: SignalKind, series: { date: string; count: number }[] = []): SignalBreakdown {
  return {
    kind,
    totals: { count: 0, valueCents: 0, uniqueVisitors: 0 },
    series: series.map((point) => ({ ...point, valueCents: 0 })),
    channels: [],
    weekdays: [],
    storefronts: [],
  };
}

function snapshot(overrides: Partial<AnalyticsSnapshot> = {}): AnalyticsSnapshot {
  const byKind = Object.fromEntries(SIGNAL_KINDS.map((kind) => [kind, breakdown(kind)])) as Record<
    SignalKind,
    SignalBreakdown
  >;
  byKind.storefront_view = breakdown("storefront_view", [
    { date: "2026-09-01", count: 40 },
    { date: "2026-09-02", count: 12 },
  ]);
  return {
    version: 1,
    range: { from: "2026-09-01", to: "2026-09-02", preset: "custom" },
    currency: "EUR",
    generatedAt: "2026-09-30T12:00:00.000Z",
    sales: {
      available: true,
      totals: {
        revenueCents: 7500,
        sales: 3,
        aovCents: 2500,
        feesCents: 375,
        netRevenueCents: 7125,
        uniqueBuyers: 3,
        repeatBuyers: 0,
        refundedCount: 0,
        refundedCents: 0,
        rangeDays: 2,
        currency: "EUR",
      },
      series: [
        { date: "2026-09-01", revenueCents: 5000, sales: 2, aovCents: 2500 },
        { date: "2026-09-02", revenueCents: 2500, sales: 1, aovCents: 2500 },
      ],
      channels: [],
      topProducts: [],
      weekdays: [],
      statuses: [],
    },
    signals: { available: true, byKind, everRecorded: ["storefront_view"], activeBlockTypes: [] },
    ...overrides,
  };
}

const lines = (csv: string) => csv.replace(CSV_BOM, "").trimEnd().split("\r\n");

describe("analyticsReportCsv", () => {
  it("writes one row per period, sales and recorded signals side by side", () => {
    const [header, first, second] = lines(analyticsReportCsv(snapshot()));
    expect(header).toBe([...ANALYTICS_REPORT_COLUMNS, signalColumn("storefront_view")].join(","));
    expect(first).toBe("2026-09-01,2,50.00,25.00,EUR,40");
    expect(second).toBe("2026-09-02,1,25.00,25.00,EUR,12");
  });

  it("leaves out signal kinds the store has never recorded", () => {
    const csv = analyticsReportCsv(snapshot());
    expect(csv).not.toContain("bookings");
    expect(csv).not.toContain("email_signups");
  });

  it("is just the header for a range with nothing in it", () => {
    const empty = snapshot();
    empty.sales.series = [];
    empty.signals.everRecorded = [];
    expect(lines(analyticsReportCsv(empty))).toEqual([ANALYTICS_REPORT_COLUMNS.join(",")]);
  });
});

describe("analyticsReportFileName", () => {
  it("names the range, and the day it was made for an open end", () => {
    expect(analyticsReportFileName(snapshot())).toBe("square-share-analytics-2026-09-01-to-2026-09-02.csv");
    expect(analyticsReportFileName(snapshot({ range: { from: null, to: null, preset: "all" } }))).toBe(
      "square-share-analytics-2026-09-30-to-2026-09-30.csv",
    );
  });
});
