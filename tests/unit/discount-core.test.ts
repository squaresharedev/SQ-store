import { describe, expect, it } from "vitest";
import { DISCOUNT_CODE_PATTERN, generateDiscountCode, isDiscountCode, normalizeDiscountCode } from "@/lib/discounts/code";
import { discountStatus, saleHasStarted } from "@/lib/discounts/status";
import { summarizeDiscounts } from "@/lib/discounts/summary";
import { fromLocalInstant, shiftInstant, TIME_SLOTS, timeOptions, toLocalInstant } from "@/lib/format/calendar";
import type { DiscountPerformance, DiscountView } from "@/types/discount";

const NOW = new Date("2026-10-03T12:00:00Z");

function view(overrides: Partial<DiscountView> = {}): DiscountView {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "code",
    code: "SUMMER10",
    shareChannel: "Instagram",
    value: { type: "percent", percentOff: 10 },
    appliesTo: "all",
    productIds: [],
    startsAt: "2026-10-01T00:00:00Z",
    endsAt: null,
    usageLimit: null,
    enabled: true,
    createdAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("discount codes", () => {
  it("reads a typed code the way the store stored it", () => {
    expect(normalizeDiscountCode("  summer10 ")).toBe("SUMMER10");
  });

  it("holds codes to letters, digits, - and _, 3 to 24 long", () => {
    for (const ok of ["ABC", "SUMMER-10", "VIP_2026", "A".repeat(24)]) expect(isDiscountCode(ok)).toBe(true);
    for (const bad of ["AB", "A".repeat(25), "-STARTS", "HAS SPACE", "ÉTÉ10", "SUMMER10;", "<B>"]) {
      expect(isDiscountCode(bad)).toBe(false);
    }
  });

  it("generates codes in that shape with no lookalike characters", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateDiscountCode();
      expect(code).toMatch(DISCOUNT_CODE_PATTERN);
      expect(code).toHaveLength(8);
      expect(code).not.toMatch(/[01IO]/);
    }
  });

  it("maps every byte value onto the alphabet evenly", () => {
    // 256 values onto 32 characters: each character exactly 8 times.
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const counts = new Map<string, number>();
    for (const char of generateDiscountCode(256, () => bytes)) counts.set(char, (counts.get(char) ?? 0) + 1);
    expect(counts.size).toBe(32);
    expect(new Set(counts.values())).toEqual(new Set([8]));
  });
});

describe("discountStatus", () => {
  it("reads active, scheduled, ended, paused and used up", () => {
    expect(discountStatus(view(), 0, NOW)).toBe("active");
    expect(discountStatus(view({ startsAt: "2026-10-04T00:00:00Z" }), 0, NOW)).toBe("scheduled");
    expect(discountStatus(view({ endsAt: "2026-10-02T00:00:00Z" }), 0, NOW)).toBe("ended");
    expect(discountStatus(view({ enabled: false }), 0, NOW)).toBe("paused");
    expect(discountStatus(view({ usageLimit: 3 }), 3, NOW)).toBe("used_up");
  });

  it("calls an ended discount ended, whatever else is true of it", () => {
    expect(discountStatus(view({ endsAt: "2026-10-02T00:00:00Z", enabled: false, usageLimit: 1 }), 5, NOW)).toBe(
      "ended",
    );
  });

  it("knows when a sale's terms are frozen", () => {
    expect(saleHasStarted(view({ kind: "automatic", code: null }), NOW)).toBe(true);
    expect(saleHasStarted(view({ kind: "automatic", code: null, startsAt: "2026-10-05T00:00:00Z" }), NOW)).toBe(false);
    expect(saleHasStarted(view(), NOW)).toBe(false);
  });
});

describe("summarizeDiscounts", () => {
  const perf = (discountId: string, orders: number, cents = 0, currency = "EUR"): DiscountPerformance => ({
    discountId,
    uses: orders,
    orders,
    revenue: cents ? [{ currency, cents }] : [],
    given: cents ? [{ currency, cents: Math.round(cents / 10) }] : [],
    lastOrderAt: null,
  });

  it("ranks channels by orders, grouping case and falling back to the code", () => {
    const a = view({ id: "a", code: "INSTA10", shareChannel: "Instagram" });
    const b = view({ id: "b", code: "INSTA20", shareChannel: " instagram " });
    const c = view({ id: "c", code: "NOCHANNEL", shareChannel: null });
    const sale = view({ id: "d", kind: "automatic", code: null, shareChannel: null });
    const summary = summarizeDiscounts(
      [a, b, c, sale],
      new Map([
        ["a", perf("a", 2, 4000)],
        ["b", perf("b", 3, 6000)],
        ["c", perf("c", 1, 2000)],
        ["d", perf("d", 4, 8000)],
      ]),
      new Map(),
      NOW,
    );
    expect(summary.channels).toEqual([
      { label: "Instagram", orders: 5 },
      { label: null, orders: 4 },
      { label: "NOCHANNEL", orders: 1 },
    ]);
    expect(summary.orders).toBe(10);
    expect(summary.revenue).toEqual([{ currency: "EUR", cents: 20000 }]);
  });

  it("lists what is live first and what is over last, newest first within each", () => {
    const summary = summarizeDiscounts(
      [
        view({ id: "ended", endsAt: "2026-10-02T00:00:00Z" }),
        view({ id: "live-new" }),
        view({ id: "off", enabled: false }),
        view({ id: "soon", startsAt: "2026-10-09T00:00:00Z" }),
        view({ id: "spent", usageLimit: 1 }),
        view({ id: "live-old" }),
      ],
      new Map([["spent", perf("spent", 1)]]),
      new Map(),
      NOW,
    );
    expect(summary.items.map((item) => item.discount.id)).toEqual([
      "live-new",
      "live-old",
      "soon",
      "off",
      "spent",
      "ended",
    ]);
  });

  it("keeps a deleted code's orders under its channel, and money per currency", () => {
    const summary = summarizeDiscounts(
      [],
      new Map([
        ["gone", perf("gone", 2, 5000, "USD")],
        ["kept", perf("kept", 1, 1000)],
      ]),
      new Map([
        ["gone", { kind: "code", code: "OLD", shareChannel: "TikTok" }],
        ["kept", { kind: "code", code: "NEW", shareChannel: null }],
      ]),
      NOW,
    );
    expect(summary.items).toEqual([]);
    expect(summary.channels).toEqual([
      { label: "TikTok", orders: 2 },
      { label: "NEW", orders: 1 },
    ]);
    expect(summary.revenue).toEqual([
      { currency: "USD", cents: 5000 },
      { currency: "EUR", cents: 1000 },
    ]);
  });
});

describe("date and time of day", () => {
  it("offers every half hour", () => {
    expect(TIME_SLOTS).toHaveLength(48);
    expect(TIME_SLOTS[0]).toBe("00:00");
    expect(TIME_SLOTS.at(-1)).toBe("23:30");
  });

  it("round-trips a local date and time through an instant", () => {
    const iso = toLocalInstant("2026-10-31", "23:30");
    expect(iso).not.toBeNull();
    expect(fromLocalInstant(iso!)).toEqual({ date: "2026-10-31", time: "23:30" });
  });

  it("reads a moment back to the minute, never rounded, so saving a form cannot move it", () => {
    const iso = toLocalInstant("2026-10-03", "13:41")!;
    expect(fromLocalInstant(iso)).toEqual({ date: "2026-10-03", time: "13:41" });
    expect(toLocalInstant("2026-10-03", fromLocalInstant(iso)!.time)).toBe(iso);
  });

  it("lists a time that falls between two slots in its place, and only then", () => {
    expect(timeOptions("09:00")).toBe(TIME_SLOTS);
    const withOdd = timeOptions("13:41");
    expect(withOdd).toHaveLength(49);
    expect(withOdd.slice(withOdd.indexOf("13:30"), withOdd.indexOf("14:00") + 1)).toEqual(["13:30", "13:41", "14:00"]);
    expect(timeOptions("junk")).toBe(TIME_SLOTS);
  });

  it("refuses junk dates and times", () => {
    expect(toLocalInstant("2026-02-30", "10:00")).toBeNull();
    expect(toLocalInstant("2026-10-31", "24:00")).toBeNull();
    expect(fromLocalInstant("not a date")).toBeNull();
  });

  it("moves an instant by days or months, keeping its time of day", () => {
    const start = toLocalInstant("2026-10-03", "09:00")!;
    expect(fromLocalInstant(shiftInstant(start, { days: 7 })!)).toEqual({ date: "2026-10-10", time: "09:00" });
    expect(fromLocalInstant(shiftInstant(start, { months: 1 })!)).toEqual({ date: "2026-11-03", time: "09:00" });
  });

  it("ends a month on from the 31st on the last day of a shorter month", () => {
    const end = (date: string) => fromLocalInstant(shiftInstant(toLocalInstant(date, "09:00")!, { months: 1 })!)!.date;
    expect(end("2026-01-31")).toBe("2026-02-28");
    expect(end("2028-01-31")).toBe("2028-02-29");
    expect(end("2026-10-31")).toBe("2026-11-30");
    expect(end("2026-12-15")).toBe("2027-01-15");
  });
});
