import { describe, expect, it } from "vitest";
import { formatBytes, formatPrice } from "@/lib/format";
import { formatCents, toCurrency } from "@/lib/format/money";
import { formatRelativeTime } from "@/lib/notifications/presentation";

describe("toCurrency", () => {
  it("passes USD through", () => {
    expect(toCurrency("USD")).toBe("USD");
  });
  it("defaults everything else to EUR (primary market)", () => {
    expect(toCurrency("EUR")).toBe("EUR");
    expect(toCurrency("GBP")).toBe("EUR");
    expect(toCurrency("")).toBe("EUR");
    expect(toCurrency("usd")).toBe("EUR"); // case-sensitive by design
  });
});

describe("formatCents", () => {
  it("formats whole euros", () => {
    expect(formatCents(1400, "EUR")).toBe("€14.00");
  });
  it("formats sub-euro amounts", () => {
    expect(formatCents(1, "EUR")).toBe("€0.01");
    expect(formatCents(99, "EUR")).toBe("€0.99");
  });
  it("formats zero", () => {
    expect(formatCents(0, "EUR")).toBe("€0.00");
  });
  it("formats USD with the en-IE symbol convention", () => {
    // en-IE renders USD as US$ — pin it so a locale change is a conscious decision.
    expect(formatCents(2500, "USD")).toBe("US$25.00");
  });
  it("groups thousands", () => {
    expect(formatCents(123_456_789, "EUR")).toBe("€1,234,567.89");
  });
  it("unknown currency falls back to EUR formatting rather than crashing", () => {
    expect(formatCents(500, "XYZ")).toBe("€5.00");
  });
});

describe("formatPrice", () => {
  it("formats major units", () => {
    expect(formatPrice(9.5, "EUR")).toBe("€9.50");
  });
});

describe("formatBytes", () => {
  it("bytes below 1024 stay in B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });
  it("KB boundary", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });
  it("MB with one decimal under 10", () => {
    expect(formatBytes(1.4 * 1024 * 1024)).toBe("1.4 MB");
  });
  it("no decimals from 10 up", () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });
  it("caps at GB for huge values", () => {
    expect(formatBytes(5 * 1024 ** 4)).toBe("5120 GB");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-10T12:00:00Z");

  it("just now under 45s", () => {
    expect(formatRelativeTime("2026-07-10T11:59:30Z", now)).toBe("just now");
  });
  it("minutes", () => {
    expect(formatRelativeTime("2026-07-10T11:55:00Z", now)).toBe("5m ago");
  });
  it("hours", () => {
    expect(formatRelativeTime("2026-07-10T09:00:00Z", now)).toBe("3h ago");
  });
  it("days", () => {
    expect(formatRelativeTime("2026-07-08T12:00:00Z", now)).toBe("2d ago");
  });
  it("absolute date past a week", () => {
    expect(formatRelativeTime("2026-06-01T12:00:00Z", now)).toBe("1 Jun 2026");
  });
  it("invalid ISO renders empty, never NaN text", () => {
    expect(formatRelativeTime("garbage", now)).toBe("");
  });
});
