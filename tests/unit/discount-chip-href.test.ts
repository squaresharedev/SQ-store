import { describe, expect, it, vi } from "vitest";

/**
 * Where the discount form sends a seller to change how a sale looks: the Sale
 * chip section of their most recent storefront. A link left out is better
 * than a form that fails to open, so every failure is no link.
 */

const primary = vi.hoisted(() => ({ getPrimaryStorefrontId: vi.fn() }));
vi.mock("@/lib/storefront/queries", () => primary);
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/team/account-context", () => ({ getActiveAccount: vi.fn() }));
vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn() }));

const { saleChipHref } = await import("@/lib/discounts/queries");

describe("saleChipHref", () => {
  it("opens the Sale chip section of the seller's most recent storefront", async () => {
    primary.getPrimaryStorefrontId.mockResolvedValue("abc");
    expect(await saleChipHref()).toBe("/storefront/abc?setting=sale-chip");
  });

  it("is no link without a storefront", async () => {
    primary.getPrimaryStorefrontId.mockResolvedValue(null);
    expect(await saleChipHref()).toBeNull();
  });

  it("is no link when the lookup fails, rather than a form that fails to open", async () => {
    primary.getPrimaryStorefrontId.mockImplementation(async () => {
      throw new Error("connection reset");
    });
    expect(await saleChipHref()).toBeNull();
  });
});
