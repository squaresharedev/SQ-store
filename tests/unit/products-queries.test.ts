// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

// Presigning is an HMAC per row and irrelevant here; keep it cheap and
// deterministic so row counts are what the assertions are about.
vi.mock("@/lib/r2", () => ({
  presignGetUrl: async (key: string) => `signed:${key}`,
}));

/** One recorded builder chain: the table, and every filter/modifier call. */
type Call = { method: string; args: unknown[] };

type Recorded = { table: string; calls: Call[] };

const recorded: Recorded[] = [];

/** What the next awaited chain resolves to, keyed by table. Arrays are
 *  consumed in order so a single test can stage several reads. */
const responses = new Map<string, { data: unknown; error: unknown; count?: number }[]>();

function stageResponse(
  table: string,
  response: { data: unknown; error?: unknown; count?: number },
) {
  const queue = responses.get(table) ?? [];
  queue.push({ error: null, ...response });
  responses.set(table, queue);
}

/**
 * Chainable, thenable Supabase stub. Every filter/modifier returns the same
 * proxy and records itself; awaiting it pops the staged response for the table.
 */
function makeChain(table: string): Record<string, unknown> {
  const entry: Recorded = { table, calls: [] };
  recorded.push(entry);

  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "neq",
    "ilike",
    "in",
    "not",
    "order",
    "range",
    "limit",
  ]) {
    chain[method] = (...args: unknown[]) => {
      entry.calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (
    resolve: (value: unknown) => void,
    reject?: (reason: unknown) => void,
  ) => {
    const queue = responses.get(table) ?? [];
    const next = queue.shift() ?? { data: [], error: null, count: 0 };
    return Promise.resolve(next).then(resolve, reject);
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => makeChain(table) }),
}));

// ---- imports -------------------------------------------------------------

import { listProducts, listAllProducts } from "@/lib/products/queries";

// ---- helpers -------------------------------------------------------------

const OWNER = "10000000-0000-4000-8000-000000000001";

function ownerAccount() {
  return { accountId: OWNER, userId: OWNER, role: "owner" as const, isOwner: true };
}

function productRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Product ${id}`,
    description: "",
    price_cents: 1000,
    currency: "EUR",
    status: "active",
    image_key: null,
    digital_file_key: null,
    track_stock: false,
    stock_quantity: null,
    low_stock_threshold: 5,
    ...overrides,
  };
}

/** Every recorded call across all chains for a table. */
function callsFor(table: string): Call[] {
  return recorded.filter((r) => r.table === table).flatMap((r) => r.calls);
}

function argsOf(table: string, method: string): unknown[][] {
  return callsFor(table)
    .filter((call) => call.method === method)
    .map((call) => call.args);
}

beforeEach(() => {
  recorded.length = 0;
  responses.clear();
  vi.clearAllMocks();
  getActiveAccountMock.mockResolvedValue(ownerAccount());
});

// ==========================================================================

describe("listProducts - account scoping", () => {
  it("returns an empty page when there is no session, without querying", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    const result = await listProducts();
    expect(result).toEqual({ rows: [], total: 0, page: 1, pageSize: 24 });
    expect(recorded).toHaveLength(0);
  });

  it("always constrains the read to the ACTIVE account", async () => {
    // RLS lets a team member read every store they belong to, so the explicit
    // owner_id filter is what keeps one store's list from mixing in another's.
    stageResponse("products", { data: [productRow("a")], count: 1 });
    await listProducts();
    expect(argsOf("products", "eq")).toContainEqual(["owner_id", OWNER]);
  });
});

describe("listProducts - filters", () => {
  it("applies a status filter only when one is set", async () => {
    stageResponse("products", { data: [], count: 0 });
    await listProducts({ filters: { status: "draft" } });
    expect(argsOf("products", "eq")).toContainEqual(["status", "draft"]);

    recorded.length = 0;
    stageResponse("products", { data: [], count: 0 });
    await listProducts({});
    expect(argsOf("products", "eq").map((a) => a[0])).not.toContain("status");
  });

  it("searches the title with the term escaped and wrapped for contains", async () => {
    stageResponse("products", { data: [], count: 0 });
    await listProducts({ filters: { search: "50% off" } });
    expect(argsOf("products", "ilike")).toEqual([["title", "%50\\% off%"]]);
  });

  it("ignores a whitespace-only search rather than matching everything", async () => {
    stageResponse("products", { data: [], count: 0 });
    await listProducts({ filters: { search: "   " } });
    expect(argsOf("products", "ilike")).toHaveLength(0);
  });
});

describe("listProducts - pagination", () => {
  it("clamps page and page size into range", async () => {
    stageResponse("products", { data: [], count: 0 });
    const tooSmall = await listProducts({ page: -5, pageSize: 0 });
    expect(tooSmall.page).toBe(1);
    expect(tooSmall.pageSize).toBe(1);

    recorded.length = 0;
    stageResponse("products", { data: [], count: 0 });
    const tooBig = await listProducts({ pageSize: 10_000 });
    expect(tooBig.pageSize).toBe(96);
  });

  it("truncates fractional paging input instead of producing a fractional range", async () => {
    stageResponse("products", { data: [], count: 0 });
    await listProducts({ page: 2.7, pageSize: 10.9 });
    // page 2, size 10 -> rows 10..19
    expect(argsOf("products", "range")).toEqual([[10, 19]]);
  });

  it("asks for the matching row count so the page control can be built", async () => {
    stageResponse("products", { data: [productRow("a")], count: 137 });
    const result = await listProducts();
    expect(argsOf("products", "select")[0][1]).toEqual({ count: "exact" });
    expect(result.total).toBe(137);
  });

  it("orders by a stable tiebreak so a row can't straddle two pages", async () => {
    stageResponse("products", { data: [], count: 0 });
    await listProducts({ sort: "title" });
    const orders = argsOf("products", "order");
    expect(orders[0]).toEqual(["title", { ascending: true }]);
    expect(orders[1]).toEqual(["id", { ascending: true }]);
  });
});

describe("listProducts - sorting", () => {
  it("maps each column-backed sort to its column and direction", async () => {
    const cases = [
      ["default", "created_at", false],
      ["title", "title", true],
      ["priceHigh", "price_cents", false],
      ["priceLow", "price_cents", true],
    ] as const;

    for (const [sort, column, ascending] of cases) {
      recorded.length = 0;
      responses.clear();
      stageResponse("products", { data: [], count: 0 });
      await listProducts({ sort });
      expect(argsOf("products", "order")[0], sort).toEqual([
        column,
        { ascending },
      ]);
    }
  });

  it("ranks a metric sort across the whole catalogue, not just one page", async () => {
    // Ids come back newest-first; "b" outsells "a" despite being older.
    stageResponse("products", {
      data: [{ id: "a", created_at: "2026-02-01" }, { id: "b", created_at: "2026-01-01" }],
    });
    stageResponse("orders", {
      data: [
        { product_id: "b", amount_cents: 5000, currency: "EUR" },
        { product_id: "b", amount_cents: 5000, currency: "EUR" },
        { product_id: "a", amount_cents: 1000, currency: "EUR" },
      ],
    });
    stageResponse("products", { data: [productRow("a"), productRow("b")] });

    const result = await listProducts({ sort: "revenue" });

    expect(result.rows.map((p) => p.id)).toEqual(["b", "a"]);
    expect(result.total).toBe(2);
    // Only the page's ids are hydrated.
    expect(argsOf("products", "in")).toEqual([["id", ["b", "a"]]]);
  });

  it("keeps products with no sales, ranked below every seller", async () => {
    stageResponse("products", {
      data: [{ id: "sold", created_at: "2026-01-02" }, { id: "never", created_at: "2026-01-01" }],
    });
    stageResponse("orders", {
      data: [{ product_id: "sold", amount_cents: 100, currency: "EUR" }],
    });
    stageResponse("products", { data: [productRow("never"), productRow("sold")] });

    const result = await listProducts({ sort: "unitsSold" });
    expect(result.rows.map((p) => p.id)).toEqual(["sold", "never"]);
  });

  it("scopes the metric sort's id read to the account too", async () => {
    stageResponse("products", { data: [] });
    stageResponse("orders", { data: [] });
    const result = await listProducts({ sort: "revenue" });
    expect(argsOf("products", "eq")).toContainEqual(["owner_id", OWNER]);
    expect(result.rows).toEqual([]);
  });
});

describe("listProducts - failures", () => {
  it("surfaces a read error instead of rendering a silently empty store", async () => {
    stageResponse("products", { data: null, error: { message: "boom" } });
    await expect(listProducts()).rejects.toThrow(/boom/);
  });
});

describe("listAllProducts", () => {
  it("returns the whole catalogue for the storefront picker, account-scoped", async () => {
    stageResponse("products", { data: [productRow("a"), productRow("b")] });
    const rows = await listAllProducts();
    expect(rows.map((p) => p.id)).toEqual(["a", "b"]);
    expect(argsOf("products", "eq")).toContainEqual(["owner_id", OWNER]);
    // No paging: the picker must be able to place any product.
    expect(argsOf("products", "range")).toHaveLength(0);
  });

  it("returns nothing when signed out", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    expect(await listAllProducts()).toEqual([]);
  });
});
