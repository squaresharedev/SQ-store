// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * listStorefronts paging contract. The list used to fetch one silently-capped
 * page (100 rows, no count): storefront #101 simply did not exist as far as
 * the UI could tell. The fix returns { rows, total } with an EXACT count and
 * takes an offset, so the UI can say "Showing X of N" and load the rest. These
 * tests pin that contract.
 */

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

type Call = { method: string; args: unknown[] };
const calls: Call[] = [];
let response: { data: unknown; error: unknown; count?: number } = {
  data: [],
  error: null,
  count: 0,
};

function makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "range", "limit", "is"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => void, reject?: (r: unknown) => void) =>
    Promise.resolve(response).then(resolve, reject);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => makeChain() }),
}));

import { listStorefronts } from "@/lib/storefront/queries";

const OWNER = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  calls.length = 0;
  response = { data: [], error: null, count: 0 };
  vi.clearAllMocks();
  getActiveAccountMock.mockResolvedValue({
    accountId: OWNER,
    userId: OWNER,
    role: "owner",
    isOwner: true,
  });
});

describe("listStorefronts paging", () => {
  it("asks for an exact count so truncation is visible, not silent", async () => {
    response = { data: [], error: null, count: 137 };
    const page = await listStorefronts();
    expect(page.total).toBe(137);
    const select = calls.find((c) => c.method === "select");
    expect(select?.args[1]).toEqual({ count: "exact" });
  });

  it("windows with range from the requested offset, clamped and truncated", async () => {
    await listStorefronts(230.9);
    const range = calls.find((c) => c.method === "range");
    // offset truncated to 230; window is one bound page (100 rows).
    expect(range?.args).toEqual([230, 329]);

    calls.length = 0;
    await listStorefronts(-5);
    expect(calls.find((c) => c.method === "range")?.args).toEqual([0, 99]);
  });

  it("orders with a stable id tiebreak so pages cannot skip rows on ties", async () => {
    await listStorefronts();
    const orders = calls.filter((c) => c.method === "order");
    expect(orders[0]?.args[0]).toBe("updated_at");
    expect(orders[1]?.args).toEqual(["id", { ascending: true }]);
  });

  it("throws on a read failure instead of faking an empty list", async () => {
    response = { data: null, error: { message: "boom" }, count: undefined };
    await expect(listStorefronts()).rejects.toThrow(/boom/);
  });

  it("returns an empty page without querying when signed out", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const page = await listStorefronts();
    expect(page).toEqual({ rows: [], total: 0 });
    expect(calls).toHaveLength(0);
  });
});
