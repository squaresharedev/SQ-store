// @vitest-environment node
import { describe, expect, it } from "vitest";
import { activeGrant, grantedPlan, planRank } from "@/lib/billing/grants";

const NOW = new Date("2026-10-19T12:00:00Z");
const row = (fields: Partial<{ plan: string | null; starts_at: string | null; ends_at: string | null }> = {}) => ({
  plan: "pro",
  starts_at: "2026-10-01T00:00:00Z",
  ends_at: "2026-11-01T00:00:00Z",
  ...fields,
});

describe("activeGrant: whether a staff grant applies right now", () => {
  it("applies between its start and its end", () => {
    expect(activeGrant(row(), NOW)).toEqual({
      plan: "pro",
      startsAt: "2026-10-01T00:00:00Z",
      endsAt: "2026-11-01T00:00:00Z",
    });
  });

  it("applies for good with no end date", () => {
    expect(activeGrant(row({ ends_at: null }), NOW)?.endsAt).toBeNull();
  });

  it("does not apply with no row, before it starts, or once it has ended", () => {
    expect(activeGrant(null, NOW)).toBeNull();
    expect(activeGrant(undefined, NOW)).toBeNull();
    expect(activeGrant(row({ starts_at: "2026-10-20T00:00:00Z" }), NOW)).toBeNull();
    expect(activeGrant(row({ ends_at: "2026-10-19T12:00:00Z" }), NOW)).toBeNull();
    expect(activeGrant(row({ ends_at: "2026-10-01T00:00:00Z" }), NOW)).toBeNull();
  });

  it("refuses what it cannot read: an unknown plan, Free, or a broken date", () => {
    expect(activeGrant(row({ plan: "enterprise" }), NOW)).toBeNull();
    expect(activeGrant(row({ plan: "free" }), NOW)).toBeNull();
    expect(activeGrant(row({ starts_at: null }), NOW)).toBeNull();
    expect(activeGrant(row({ ends_at: "soon" }), NOW)).toBeNull();
  });
});

describe("grantedPlan: the higher of what is paid for and what was given", () => {
  const grant = (plan: "starter" | "pro") => ({ plan, startsAt: "2026-10-01T00:00:00Z", endsAt: null });

  it("ranks plans cheapest first", () => {
    expect(planRank("free")).toBeLessThan(planRank("starter"));
    expect(planRank("starter")).toBeLessThan(planRank("pro"));
  });

  it("lifts Free to the grant", () => {
    expect(grantedPlan("free", grant("starter"))).toEqual({ plan: "starter", source: "granted" });
  });

  it("lifts a cheaper paid plan to a higher grant", () => {
    expect(grantedPlan("starter", grant("pro"))).toEqual({ plan: "pro", source: "granted" });
  });

  it("never lowers a paid plan, and a tie goes to the paid plan", () => {
    expect(grantedPlan("pro", grant("starter"))).toEqual({ plan: "pro", source: "paid" });
    expect(grantedPlan("pro", grant("pro"))).toEqual({ plan: "pro", source: "paid" });
  });

  it("is the paid plan, or Free, without a grant", () => {
    expect(grantedPlan("free", null)).toEqual({ plan: "free", source: "free" });
    expect(grantedPlan("starter", null)).toEqual({ plan: "starter", source: "paid" });
  });
});
