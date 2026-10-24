// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withBadgePlacement } from "@/lib/products/badges";
import type { ProductBadge } from "@/types/product";

// The storefront editor's badge drag: one badge's placement, saved without the
// product form. Same fakes as products-actions.test.ts, cut down to what this
// action touches.

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({ getActiveAccount: () => getActiveAccountMock() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dbFn = vi.fn();
const db: any = {};
for (const m of ["from", "select", "update", "eq"]) db[m] = vi.fn(() => db);
db.maybeSingle = vi.fn(() => dbFn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (...args: unknown[]) => db.from(...args) }),
}));

const precheckMock = vi.fn(async (..._args: unknown[]) => {});
const settleMock = vi.fn(async (..._args: unknown[]) => "ok");
vi.mock("@/lib/moderation/auto/check", () => ({
  precheck: (...args: unknown[]) => precheckMock(...args),
  settleAfterWrite: (...args: unknown[]) => settleMock(...args),
  checkBadgeText: vi.fn(async () => ({ verdict: "clean" })),
}));

const rateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

const { moveProductBadge } = await import("@/lib/products/badge-actions");

const OWNER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const BADGES: ProductBadge[] = [
  { icon: "heart", label: "Loved by 250+ people" },
  { icon: "leaf", label: "Eco friendly", color: "green", placement: "photo-top-left" },
];
const STORED = { materials: "Oak", badges: BADGES };

beforeEach(() => {
  vi.clearAllMocks();
  getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: OWNER, role: "owner", isOwner: true });
  rateLimitMock.mockResolvedValue(true);
});

describe("withBadgePlacement", () => {
  it("moves only the named badge, and stores beside as no placement", () => {
    expect(withBadgePlacement(BADGES, "eco FRIENDLY", "beside")).toEqual([
      BADGES[0],
      { icon: "leaf", label: "Eco friendly", color: "green" },
    ]);
    expect(withBadgePlacement(BADGES, "Loved by 250+ people", "photo-bottom-right")[0]).toEqual({
      icon: "heart",
      label: "Loved by 250+ people",
      placement: "photo-bottom-right",
    });
  });
});

describe("moveProductBadge", () => {
  it("writes the moved badge and keeps the rest of the details as stored", async () => {
    dbFn
      .mockResolvedValueOnce({ data: { details: STORED }, error: null })
      .mockResolvedValueOnce({ data: { id: PRODUCT, moderation_status: "ok" }, error: null });
    const result = await moveProductBadge(PRODUCT, "Loved by 250+ people", "photo-top-right");
    expect(result).toEqual({
      ok: true,
      badges: [{ ...BADGES[0], placement: "photo-top-right" }, BADGES[1]],
    });
    const update = db.update.mock.calls[0][0];
    expect(update.details.materials).toBe("Oak");
    expect(update.details.badges[0].placement).toBe("photo-top-right");
    expect(db.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(precheckMock).toHaveBeenCalledBefore(db.update);
    expect(settleMock).toHaveBeenCalledWith("product", PRODUCT, "ok");
  });

  it("refuses a fourth badge on the photo", async () => {
    const full: ProductBadge[] = [
      ...BADGES,
      { icon: "star", label: "Top rated", placement: "photo-top-right" },
      { icon: "gift", label: "Gift ready", placement: "photo-bottom-left" },
    ];
    dbFn.mockResolvedValueOnce({ data: { details: { badges: full } }, error: null });
    const result = await moveProductBadge(PRODUCT, "Loved by 250+ people", "photo-bottom-right");
    expect(result.ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses a badge the product does not carry, and a place that does not exist", async () => {
    dbFn.mockResolvedValueOnce({ data: { details: STORED }, error: null });
    expect((await moveProductBadge(PRODUCT, "Not here", "beside")).ok).toBe(false);
    expect((await moveProductBadge(PRODUCT, "Eco friendly", "the-moon")).ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses a viewer, and a product that is not theirs", async () => {
    getActiveAccountMock.mockResolvedValueOnce({ accountId: OWNER, userId: OWNER, role: "viewer", isOwner: false });
    expect((await moveProductBadge(PRODUCT, "Eco friendly", "beside")).ok).toBe(false);
    dbFn.mockResolvedValueOnce({ data: null, error: null });
    expect((await moveProductBadge(PRODUCT, "Eco friendly", "beside")).ok).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("stops at the rate limit", async () => {
    rateLimitMock.mockResolvedValueOnce(false);
    expect((await moveProductBadge(PRODUCT, "Eco friendly", "beside")).ok).toBe(false);
    expect(dbFn).not.toHaveBeenCalled();
  });
});
