// @vitest-environment node
/**
 * The payout dialog's picture makes one claim: lit pixels are where the money
 * is. These pin that claim per status, and that an in-transit payout never
 * looks as if it had not left or had already arrived.
 */
import { describe, expect, it } from "vitest";
import {
  payoutProgress,
  TRANSIT_RANGE,
  transitProgress,
} from "@/components/payments/payout-progress";
import type { PayoutStatus } from "@/lib/payments/types";

const TRIP = { createdAt: "2026-10-01T00:00:00Z", arrivalDate: "2026-10-05T00:00:00Z" };
const MIDWAY = new Date("2026-10-03T00:00:00Z");
const progress = (status: PayoutStatus, now: Date | null = MIDWAY) =>
  payoutProgress({ ...TRIP, status }, now);

describe("payoutProgress", () => {
  it("lights the whole track only once the money is at the bank", () => {
    expect(progress("paid")).toBe(1);
  });

  it("lights nothing while the money is in the balance", () => {
    // Not left, never leaving, and turned away (the amount is back in the balance).
    for (const status of ["pending", "canceled", "failed"] as const) {
      expect(progress(status), status).toBe(0);
    }
  });

  it("lights an in-transit payout by the calendar", () => {
    expect(progress("in_transit")).toBe(0.5);
    expect(progress("in_transit", new Date("2026-10-02T00:00:00Z"))).toBe(0.25);
  });

  it("treats a status this build does not know as not having left", () => {
    expect(progress("something_new" as PayoutStatus)).toBe(0);
  });
});

describe("transitProgress", () => {
  it("never reads as not left, or as arrived", () => {
    expect(transitProgress(TRIP, new Date("2026-09-01T00:00:00Z"))).toBe(TRANSIT_RANGE.min);
    expect(transitProgress(TRIP, new Date("2026-10-01T00:01:00Z"))).toBe(TRANSIT_RANGE.min);
    expect(transitProgress(TRIP, new Date("2026-12-01T00:00:00Z"))).toBe(TRANSIT_RANGE.max);
    expect(TRANSIT_RANGE.min).toBeGreaterThan(0);
    expect(TRANSIT_RANGE.max).toBeLessThan(1);
  });

  it("sits halfway when it cannot tell", () => {
    expect(transitProgress(TRIP, null)).toBe(0.5);
    expect(transitProgress({ createdAt: "nonsense", arrivalDate: "2026-10-05" }, MIDWAY)).toBe(0.5);
    expect(transitProgress({ ...TRIP, arrivalDate: TRIP.createdAt }, MIDWAY)).toBe(0.5);
  });
});
