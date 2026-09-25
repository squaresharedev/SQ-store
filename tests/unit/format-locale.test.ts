import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import messages from "../../messages/en";
import { english } from "../setup/translate";
import { formatBytes, formatPrice } from "@/lib/format";
import { currencySymbol, formatCents } from "@/lib/format/money";
import {
  formatLongDate,
  formatNumericDate,
  formatOrderDate,
  formatOrderDateTime,
} from "@/lib/format/date";
import { formatMoney, formatOrderDate as formatShortOrderDate } from "@/lib/dashboard/format";
import {
  formatDisplayDate,
  formatLongCalendarDate,
  fullDateLabel,
  monthLabel,
  weekdayFullNames,
  weekdayLabels,
} from "@/lib/format/calendar";
import { formatFixed, formatList, formatPercent } from "@/lib/format/intl";
import { countryName, euCountries } from "@/lib/format/country";
import { compactNumber, formatNumber, formatShare } from "@/components/charts/format";
import { moneyCompact, moneyExact } from "@/components/analytics/chart-format";
import { formatBucketLabel, formatWeekdayLabel } from "@/lib/analytics/buckets";
import { formatRelativeTime } from "@/lib/notifications/presentation";
import { formatTakedownDate } from "@/lib/moderation/removal";
import { priceErrorMessage } from "@/lib/products/price";
import { buildShippingProse, type ProseResolver } from "@/lib/shipping/policy-prose";

// Separators differ by ICU version only in WHICH space they use (Czech groups
// with a no-break space), so non-English assertions normalise every space.
const spaces = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("money", () => {
  it("keeps the exact English output", () => {
    expect(formatCents(123450, "EUR", "en")).toBe("€1,234.50");
    expect(formatCents(2500, "USD", "en")).toBe("US$25.00");
    expect(formatPrice(9.5, "EUR", "en")).toBe("€9.50");
    expect(formatMoney({ EUR: 6400, USD: 1200 }, "en")).toBe("€64.00 · US$12.00");
  });

  it("puts the symbol and separators where Czech and German put them", () => {
    expect(spaces(formatCents(123450, "EUR", "cs"))).toBe("1 234,50 €");
    expect(spaces(formatCents(123450, "EUR", "de"))).toBe("1.234,50 €");
  });

  it("never changes the currency the data carries", () => {
    expect(formatCents(2500, "USD", "de")).toContain("$");
    expect(formatCents(2500, "USD", "de")).not.toContain("€");
  });

  it("names the bare sign the same way in every locale", () => {
    expect(currencySymbol("EUR", "en")).toBe("€");
    expect(currencySymbol("EUR", "cs")).toBe("€");
  });
});

describe("dates", () => {
  const iso = "2026-07-02T12:05:00Z";

  it("keeps each surface's English locale", () => {
    expect(formatOrderDate(iso, "en")).toBe("2 Jul 2026");
    expect(formatShortOrderDate(iso, "en")).toBe("2 Jul");
    expect(formatLongDate(iso, "en")).toBe("2 July 2026");
    expect(formatNumericDate(iso, "en")).toBe("7/2/2026");
    expect(formatOrderDateTime("garbage", "en")).toBe("—");
  });

  it("writes month names in the reader's language", () => {
    expect(spaces(formatLongDate(iso, "cs"))).toBe("2. července 2026");
    expect(formatLongDate(iso, "de")).toBe("2. Juli 2026");
    expect(formatOrderDate(iso, "de")).toMatch(/Juli/);
  });

  it("labels the calendar", () => {
    const day = new Date(2026, 6, 4);
    expect(monthLabel(day, "en")).toBe("July 2026");
    expect(formatDisplayDate(day, "en")).toBe("4 Jul 2026");
    expect(fullDateLabel(day, "en")).toMatch(/^Saturday,? 4 July 2026$/);
    expect(weekdayLabels("en")).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayFullNames("en")[6]).toBe("Sunday");
    expect(monthLabel(day, "de")).toBe("Juli 2026");
    expect(weekdayLabels("de")[0]).toBe("Mo");
    expect(weekdayFullNames("cs")[0]).toBe("pondělí");
  });

  it("spells out a fixed calendar date without moving its day", () => {
    expect(formatLongCalendarDate("2026-09-09", "en")).toBe("9 September 2026");
    expect(formatLongCalendarDate("2026-09-09", "de")).toBe("9. September 2026");
    expect(formatLongCalendarDate("not a date", "en")).toBe("not a date");
  });

  it("keeps the takedown date's English", () => {
    expect(formatTakedownDate("2026-09-23T12:00:00Z", "en")).toBe("23 September 2026");
    expect(formatTakedownDate("2026-09-23T12:00:00Z", "de")).toBe("23. September 2026");
  });
});

describe("numbers and percentages", () => {
  it("keeps the exact English chart output", () => {
    expect(formatNumber(1284, "en")).toBe("1,284");
    expect(compactNumber(12_400, "en")).toBe("12.4k");
    expect(formatShare(3, 12, "en")).toBe("25%");
    expect(formatPercent(12.345, "en", 1)).toBe("12.3%");
    expect(formatFixed(2.5, 1, "en")).toBe("2.5");
    expect(formatBytes(1.4 * 1024 * 1024, "en")).toBe("1.4 MB");
  });

  it("uses Czech and German separators and percent spacing", () => {
    expect(spaces(formatNumber(1284.5, "cs"))).toBe("1 284,5");
    expect(formatNumber(1284.5, "de")).toBe("1.284,5");
    expect(spaces(formatShare(3, 12, "cs"))).toBe("25 %");
    expect(spaces(formatPercent(12.3, "de", 1))).toBe("12,3 %");
    expect(formatFixed(2.5, 1, "cs")).toBe("2,5");
    expect(formatBytes(1.4 * 1024 * 1024, "de")).toBe("1,4 MB");
    expect(spaces(compactNumber(12_400, "cs"))).toBe("12,4 tis.");
  });

  it("formats chart money in the reader's locale", () => {
    expect(moneyExact("EUR", "en")(120450)).toBe("€1,204.50");
    expect(moneyCompact("EUR", "en")(120450)).toBe("€1.2k");
    expect(moneyCompact("EUR", "en")(95000)).toBe("€950");
    expect(spaces(moneyCompact("EUR", "cs")(95000))).toBe("950 €");
    expect(spaces(moneyCompact("EUR", "cs")(120450))).toBe("1,2 tis. €");
  });

  it("writes the price ceiling the reader's way", () => {
    expect(english(priceErrorMessage("exceeds_max", "EUR", 100_000_000, "en")).includes("1,000,000")).toBe(true);
    expect(priceErrorMessage("exceeds_max", "EUR", 100_000_000, "de").values?.max).toBe("1.000.000");
  });
});

describe("analytics labels", () => {
  it("keeps English bucket and weekday labels", () => {
    expect(formatBucketLabel("2026-07-02", false, "en")).toBe("Jul 2");
    expect(formatBucketLabel("2026-07-01", true, "en")).toBe("Jul 2026");
    expect(formatWeekdayLabel("Mon", "en")).toBe("Mon");
  });

  it("names months and weekdays in German", () => {
    expect(formatBucketLabel("2026-07-01", true, "de")).toBe("Juli 2026");
    expect(formatWeekdayLabel("Mon", "de")).toBe("Mo");
    expect(formatWeekdayLabel("Sun", "cs")).toBe("ne");
  });
});

describe("lists", () => {
  it("keeps each English separator", () => {
    expect(formatList(["A", "B", "C"], "en", { englishSeparator: ", " })).toBe("A, B, C");
    expect(formatList(["A", "B", "C"], "en", { englishSeparator: " and " })).toBe("A and B and C");
  });

  it("joins the way Czech and German join", () => {
    expect(spaces(formatList(["A", "B", "C"], "cs", { englishSeparator: ", " }))).toBe("A, B a C");
    expect(formatList(["A", "B", "C"], "de", { englishSeparator: " and " })).toBe("A, B und C");
  });
});

describe("country names", () => {
  it("keeps the English list's own names", () => {
    expect(countryName("CZ", "en")).toBe("Czechia");
    expect(countryName("ZZ", "en")).toBeNull();
    expect(euCountries("en")[0]).toEqual({ code: "AT", name: "Austria" });
  });

  it("names countries in the reader's language", () => {
    expect(countryName("DE", "de")).toBe("Deutschland");
    expect(countryName("IE", "cs")).toBe("Irsko");
  });

  it("reaches the generated shipping prose", () => {
    const resolve: ProseResolver = (ref) => english(ref.key, ref.values);
    expect(buildShippingProse({ shipsFrom: "IE" }, resolve, "en").shipping).toBe("Ships from Ireland.");
    expect(buildShippingProse({ shipsFrom: "IE" }, resolve, "cs").shipping).toBe("Ships from Irsko.");
  });
});

describe("relative time messages", () => {
  const now = Date.parse("2026-07-10T12:00:00Z");

  it("keeps the compact English forms", () => {
    const ref = formatRelativeTime("2026-07-10T11:55:00Z", "en", now);
    expect(typeof ref === "string" ? ref : english(ref)).toBe("5m ago");
  });

  it("never groups the count, even where the locale would", () => {
    const t = createTranslator({ locale: "de", messages, timeZone: "UTC" });
    expect(t("Notifications.time.minutesAgo", { count: 1234 })).toBe("1234m ago");
    expect(t("Notifications.time.daysAgo", { count: 1 })).toBe("1d ago");
  });

  it("formats the absolute fallback in the reader's locale", () => {
    expect(formatRelativeTime("2026-06-01T12:00:00Z", "en", now)).toBe("1 Jun 2026");
    expect(formatRelativeTime("2026-06-01T12:00:00Z", "de", now)).toMatch(/Juni|Jun/);
  });
});
