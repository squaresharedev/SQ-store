import { describe, expect, it, vi } from "vitest";

/**
 * Where the discount form sends a seller to change how a sale looks: the Sale
 * chip section of their most recent storefront, named, so a seller with
 * several knows which one opens. A link left out is better than a form that
 * fails to open, so every failure is no link.
 */

const primary = vi.hoisted(() => ({ getPrimaryStorefront: vi.fn() }));
vi.mock("@/lib/storefront/queries", () => primary);
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/team/account-context", () => ({ getActiveAccount: vi.fn() }));
vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn() }));

const { saleChipLink } = await import("@/lib/discounts/queries");

describe("saleChipLink", () => {
  it("opens the Sale chip section of the seller's most recent storefront, and names it", async () => {
    primary.getPrimaryStorefront.mockResolvedValue({ id: "abc", name: "Clay House" });
    expect(await saleChipLink()).toEqual({ href: "/storefront/abc?setting=sale-chip", storefrontName: "Clay House" });
  });

  it("is no link without a storefront", async () => {
    primary.getPrimaryStorefront.mockResolvedValue(null);
    expect(await saleChipLink()).toBeNull();
  });

  it("is no link when the lookup fails, rather than a form that fails to open", async () => {
    primary.getPrimaryStorefront.mockImplementation(async () => {
      throw new Error("connection reset");
    });
    expect(await saleChipLink()).toBeNull();
  });
});
