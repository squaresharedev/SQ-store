/**
 * A store's products the automatic check has not judged yet are asked about a
 * few at a time as the seller visits the products list
 * (lib/products/settle-waiting.ts), instead of all waiting for the sweep.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkManyMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/moderation/auto/check", () => ({
  checkMany: (...args: unknown[]) => checkManyMock(...args),
}));

/** The query the module builds, recorded call by call. */
const calls: { method: string; args: unknown[] }[] = [];
let answer: { data: { id: string }[] | null; error: { message: string } | null } = { data: [], error: null };
function chain() {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "select", "eq", "order"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: "limit", args });
    return Promise.resolve(answer);
  };
  return builder;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => chain() }));

const { settleWaitingProducts } = await import("@/lib/products/settle-waiting");

beforeEach(() => {
  calls.length = 0;
  checkManyMock.mockClear();
  answer = { data: [], error: null };
});

describe("settling a store's waiting products", () => {
  it("asks the check about the oldest few of THIS store's unjudged products", async () => {
    answer = { data: [{ id: "p-1" }, { id: "p-2" }], error: null };
    await settleWaitingProducts("owner-1");

    expect(calls).toEqual(
      expect.arrayContaining([
        { method: "from", args: ["products"] },
        { method: "eq", args: ["owner_id", "owner-1"] },
        // Not "review": a product waiting for a person is a person's to decide.
        { method: "eq", args: ["moderation_status", "pending"] },
        { method: "order", args: ["updated_at", { ascending: true }] },
        { method: "limit", args: [8] },
      ]),
    );
    expect(checkManyMock).toHaveBeenCalledWith("product", ["p-1", "p-2"]);
  });

  it("does nothing when nothing is waiting, or when the read fails", async () => {
    await settleWaitingProducts("owner-1");
    answer = { data: null, error: { message: "boom" } };
    await settleWaitingProducts("owner-1");
    expect(checkManyMock).not.toHaveBeenCalled();
  });

  it("never throws: it runs after the page is sent, with nobody to tell", async () => {
    answer = { data: [{ id: "p-1" }], error: null };
    checkManyMock.mockRejectedValueOnce(new Error("classifier down"));
    await expect(settleWaitingProducts("owner-1")).resolves.toBeUndefined();
  });
});
