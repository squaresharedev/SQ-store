// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sweep is called every five minutes by a scheduled workflow (--fail), so
 * what it answers BEFORE its migration exists decides whether that schedule is
 * red for the minutes between the deploy and the migration. The rest of the
 * checker is exercised against a real database in
 * tests/integration/37-auto-moderation.test.ts; this is the one seam that has
 * to be answered without one.
 */
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn() }));
vi.mock("@/lib/moderation/admin-ping", () => ({ pingAdminModeration: vi.fn() }));

import { sweep } from "@/lib/moderation/auto/check";

beforeEach(() => {
  rpc.mockReset();
});

describe("the sweep before its migration is applied", () => {
  it("has nothing to do, and says so instead of failing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.moderation_due" },
    });
    await expect(sweep()).resolves.toEqual({ checked: 0, outcomes: {}, more: false });
    await expect(sweep({ dryRun: true })).resolves.toMatchObject({ checked: 0, more: false });
  });

  it("still fails loudly on any other database error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(sweep()).rejects.toThrow(/reading the worklist failed/);
  });
});
