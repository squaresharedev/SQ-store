/**
 * What counts against a plan's cap, as the app asks it before writing
 * (lib/billing/limits.ts countPlanUsage). It must agree with the database
 * trigger (20261019_removed_content_frees_plan_room): what moderation has
 * removed takes no place; drafts, paused and waiting rows do.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { method: string; args: unknown[] }[] = [];
let answer: { count: number | null; error: { message: string } | null } = { count: 0, error: null };
function chain() {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => void, reject?: (error: unknown) => void) =>
      Promise.resolve(answer).then(resolve, reject),
  };
  for (const method of ["from", "select", "eq", "neq", "in"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  return builder;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => chain() }));

const { countPlanUsage, planRoomRunningLow } = await import("@/lib/billing/limits");

beforeEach(() => {
  calls.length = 0;
  answer = { count: 7, error: null };
});

describe("countPlanUsage", () => {
  it.each(["products", "storefronts"] as const)("leaves out %s moderation removed, and nothing else", async (key) => {
    expect(await countPlanUsage("owner-1", key)).toBe(7);
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: "from", args: [key] },
        { method: "eq", args: ["owner_id", "owner-1"] },
        { method: "neq", args: ["moderation_status", "removed"] },
      ]),
    );
    expect(calls.filter((call) => call.method === "neq")).toHaveLength(1);
  });

  it("counts team seats the way it always has", async () => {
    await countPlanUsage("owner-1", "teamSeats");
    expect(calls.some((call) => call.method === "neq")).toBe(false);
    expect(calls).toEqual(expect.arrayContaining([{ method: "from", args: ["team_members"] }]));
  });

  it("answers null, not zero, when it cannot count", async () => {
    answer = { count: null, error: { message: "down" } };
    expect(await countPlanUsage("owner-1", "products")).toBeNull();
  });
});

// The products list says how full the plan is once the cap is near.
describe("planRoomRunningLow", () => {
  const room = (used: number, cap = 20) => ({ plan: "free" as const, cap, used, left: Math.max(0, cap - used) });

  it("stays quiet while most of the cap is free", () => {
    expect(planRoomRunningLow(room(13))).toBe(false);
  });

  it("speaks from 70 per cent of the cap, and at or over it", () => {
    expect(planRoomRunningLow(room(14))).toBe(true);
    expect(planRoomRunningLow(room(20))).toBe(true);
    expect(planRoomRunningLow(room(25))).toBe(true);
  });

  it("says nothing when nothing caps the store", () => {
    expect(planRoomRunningLow(null)).toBe(false);
  });
});
