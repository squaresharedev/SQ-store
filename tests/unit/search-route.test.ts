// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));

const getActiveAccount = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccount(),
}));

const getTeamRoster = vi.fn(async () => [] as unknown[]);
vi.mock("@/lib/team/queries", () => ({
  getTeamRoster: (...args: unknown[]) => getTeamRoster(...(args as [])),
}));

const rateLimit = vi.fn(async () => true);
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...real, rateLimit: () => rateLimit() };
});

/**
 * A recording stand-in for the PostgREST query builder. Every filter call is
 * captured so a test can assert the ACCOUNT SCOPE was applied — the one thing
 * in this route that, if dropped, silently mixes another store's rows into a
 * team member's results.
 */
type Call = { method: string; args: unknown[] };
type TableCall = { table: string; calls: Call[] };

let tableCalls: TableCall[] = [];
let tableRows: Record<string, unknown[]> = {};
let tableErrors: Record<string, string | undefined> = {};

function builderFor(table: string) {
  const record: TableCall = { table, calls: [] };
  tableCalls.push(record);

  const result = {
    get data() {
      return tableRows[table] ?? [];
    },
    get error() {
      const message = tableErrors[table];
      return message ? { message } : null;
    },
  };

  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "ilike", "or", "order", "limit", "in", "range"]) {
    builder[method] = (...args: unknown[]) => {
      record.calls.push({ method, args });
      return builder;
    };
  }
  // Awaiting the builder resolves to the {data,error} envelope, as PostgREST does.
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => builderFor(table) }),
}));

import { GET } from "@/app/api/search/route";
import type { SearchApiResponse } from "@/lib/search/types";

const ACCOUNT = {
  accountId: "owner-1",
  role: "owner" as const,
  isOwner: true,
  userId: "user-1",
};

function request(q?: string, types?: string): Request {
  const url = new URL("http://localhost/api/search");
  if (q !== undefined) url.searchParams.set("q", q);
  if (types !== undefined) url.searchParams.set("types", types);
  return new Request(url);
}

/** Every filter call made against `table`, across all queries in the request. */
function callsFor(table: string): Call[] {
  return tableCalls.filter((t) => t.table === table).flatMap((t) => t.calls);
}

/** The value passed to `.eq(column, …)` for `table`, if any. */
function eqValue(table: string, column: string): unknown {
  return callsFor(table).find(
    (call) => call.method === "eq" && call.args[0] === column,
  )?.args[1];
}

function ilikePatterns(table: string): string[] {
  return callsFor(table)
    .filter((call) => call.method === "ilike")
    .map((call) => String(call.args[1]));
}

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls = [];
  tableRows = {};
  tableErrors = {};
  rateLimit.mockResolvedValue(true);
  getUser.mockResolvedValue({ id: "user-1" });
  getActiveAccount.mockResolvedValue(ACCOUNT);
  getTeamRoster.mockResolvedValue([]);
});

describe("GET /api/search — gates", () => {
  it("401 when signed out, before any query runs", async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(request("shoes"));
    expect(res.status).toBe(401);
    expect(tableCalls).toHaveLength(0);
  });

  it("429 once the budget is spent, before any query runs", async () => {
    rateLimit.mockResolvedValue(false);
    const res = await GET(request("shoes"));
    expect(res.status).toBe(429);
    expect(tableCalls).toHaveLength(0);
  });

  it("401 when the active account cannot be resolved", async () => {
    getActiveAccount.mockResolvedValue(null);
    const res = await GET(request("shoes"));
    expect(res.status).toBe(401);
    expect(tableCalls).toHaveLength(0);
  });

  it("400 for a missing, empty, single-character or oversized query", async () => {
    for (const q of [undefined, "", "   ", "a", " a ", "x".repeat(101)]) {
      tableCalls = [];
      const res = await GET(request(q));
      expect(res.status, JSON.stringify(q)).toBe(400);
      expect(tableCalls).toHaveLength(0);
    }
  });

  it("400 for a query carrying control characters", async () => {
    const res = await GET(request(`shoes${String.fromCharCode(0)}`));
    expect(res.status).toBe(400);
  });

  it("spends the budget before validating, so a garbage flood is still bounded", async () => {
    await GET(request("a"));
    expect(rateLimit).toHaveBeenCalled();
  });
});

describe("GET /api/search — account scoping", () => {
  it("pins products to the ACTIVE account, not the signed-in user", async () => {
    // A team member viewing someone else's store: the two ids differ, and every
    // store query must use the account id. RLS would happily return both.
    getActiveAccount.mockResolvedValue({
      accountId: "other-owner",
      role: "editor",
      isOwner: false,
      userId: "user-1",
    });
    await GET(request("shoes"));
    expect(eqValue("products", "owner_id")).toBe("other-owner");
    expect(eqValue("storefronts", "owner_id")).toBe("other-owner");
    expect(eqValue("orders", "seller_id")).toBe("other-owner");
  });

  it("scopes notifications to the USER, never the account", async () => {
    getActiveAccount.mockResolvedValue({
      accountId: "other-owner",
      role: "editor",
      isOwner: false,
      userId: "user-1",
    });
    await GET(request("shoes"));
    // Notifications follow the person across stores; scoping them to the
    // account would show one member another member's mail.
    expect(eqValue("notifications", "user_id")).toBe("user-1");
    expect(callsFor("notifications").some(
      (call) => call.method === "eq" && call.args[0] === "owner_id",
    )).toBe(false);
  });

  it("scopes the roster read to the active account", async () => {
    await GET(request("shoes"));
    expect(getTeamRoster).toHaveBeenCalledWith("owner-1");
  });

  it("every store table carries an account filter — no unscoped query", async () => {
    await GET(request("shoes"));
    for (const [table, column] of [
      ["products", "owner_id"],
      ["storefronts", "owner_id"],
      ["orders", "seller_id"],
      ["notifications", "user_id"],
    ] as const) {
      expect(eqValue(table, column), `${table} is unscoped`).toBeTruthy();
    }
  });
});

describe("GET /api/search — matching", () => {
  it("wraps the term in wildcards for a contains match", async () => {
    await GET(request("shoes"));
    expect(ilikePatterns("products")).toEqual(["%shoes%"]);
  });

  it("escapes ilike wildcards so they match literally", async () => {
    await GET(request("50% off_now"));
    // % and _ are ilike metacharacters; unescaped they would match anything.
    expect(ilikePatterns("products")[0]).toBe("%50\\% off\\_now%");
  });

  it("handles commas, periods and parentheses without breaking the filter", async () => {
    // The reason this route uses two ilike queries instead of one `.or()`:
    // PostgREST parses the or= value, so these characters would corrupt it.
    for (const term of ["shoes, red", "v1.2 (blue)", "a,b,c"]) {
      tableCalls = [];
      const res = await GET(request(term));
      expect(res.status, term).toBe(200);
      expect(ilikePatterns("products")[0], term).toBe(`%${term}%`);
    }
  });

  it("never uses PostgREST or() — a comma in the term would corrupt it", async () => {
    await GET(request("shoes, red"));
    expect(tableCalls.flatMap((t) => t.calls).some((c) => c.method === "or")).toBe(false);
  });

  it("searches orders on both product title and buyer email", async () => {
    await GET(request("shoes"));
    const columns = callsFor("orders")
      .filter((call) => call.method === "ilike")
      .map((call) => call.args[0]);
    expect(columns).toContain("product_title");
    expect(columns).toContain("buyer_email");
  });

  it("trims the query before searching", async () => {
    await GET(request("  shoes  "));
    expect(ilikePatterns("products")).toEqual(["%shoes%"]);
  });
});

describe("GET /api/search — results", () => {
  it("returns grouped results with hrefs the palette can navigate to", async () => {
    tableRows.products = [
      { id: "p1", title: "Blue shoes", status: "active", price_cents: 2500, currency: "EUR" },
      { id: "p2", title: "Shoe rack", status: "draft", price_cents: 900, currency: "EUR" },
    ];
    const res = await GET(request("shoe"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchApiResponse;
    const products = body.groups.find((g) => g.type === "product");
    expect(products?.label).toBe("Products");
    // "Shoe rack" starts with the term, "Blue shoes" only contains it.
    expect(products?.results[0]?.title).toBe("Shoe rack");
    expect(products?.results[0]?.href).toBe("/products/p2/edit");
    expect(products?.results[0]?.badge).toBe("Draft");
    expect(products?.results[1]?.badge).toBeUndefined();
  });

  it("deduplicates an order that matched on both columns", async () => {
    tableRows.orders = [
      {
        id: "o1",
        product_title: "Shoes",
        buyer_email: "shoes@example.com",
        status: "paid",
        amount_cents: 1000,
        currency: "EUR",
        created_at: "2026-01-01",
      },
    ];
    const res = await GET(request("shoes"));
    const body = (await res.json()) as SearchApiResponse;
    expect(body.groups.find((g) => g.type === "order")?.results).toHaveLength(1);
  });

  it("sends an order result to its highlighted ROW, never the detail panel", async () => {
    tableRows.orders = [
      {
        id: "o1",
        product_title: "Shoes",
        buyer_email: "shoes@example.com",
        status: "paid",
        amount_cents: 1000,
        currency: "EUR",
        created_at: "2026-01-01",
      },
    ];
    const res = await GET(request("shoes"));
    const body = (await res.json()) as SearchApiResponse;
    const href = body.groups.find((g) => g.type === "order")?.results[0]?.href;
    // `?order=` is the param that OPENS the panel — this must not be it.
    expect(href).not.toContain("order=o1");
    expect(href).toBe("/orders?q=shoes%40example.com&highlight=o1");
  });

  it("omits empty groups instead of returning hollow headings", async () => {
    const res = await GET(request("nothingmatches"));
    const body = (await res.json()) as SearchApiResponse;
    expect(body.groups).toEqual([]);
  });

  it("returns 200 with no groups when nothing matched — not an error", async () => {
    // The client tells "nothing found" from "request failed" by status alone.
    const res = await GET(request("nothingmatches"));
    expect(res.status).toBe(200);
  });

  it("echoes the parsed query back", async () => {
    const res = await GET(request("  shoes  "));
    expect(((await res.json()) as SearchApiResponse).query).toBe("shoes");
  });

  it("narrows to the requested types", async () => {
    await GET(request("shoes", "product"));
    expect(tableCalls.map((t) => t.table)).toEqual(["products"]);
  });

  it("ignores unknown type names rather than returning nothing", async () => {
    await GET(request("shoes", "product,telepathy"));
    expect(tableCalls.map((t) => t.table)).toEqual(["products"]);
  });

  it("falls back to every type when the narrowing param is junk", async () => {
    await GET(request("shoes", "telepathy"));
    expect(tableCalls.map((t) => t.table)).toContain("products");
    expect(tableCalls.map((t) => t.table)).toContain("orders");
  });
});

describe("GET /api/search — failure isolation", () => {
  it("one broken table does not take the others down", async () => {
    tableErrors.orders = "orders exploded";
    tableRows.products = [
      { id: "p1", title: "Shoes", status: "active", price_cents: 100, currency: "EUR" },
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(request("shoes"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchApiResponse;
    expect(body.groups.find((g) => g.type === "product")?.results).toHaveLength(1);
    expect(body.groups.find((g) => g.type === "order")).toBeUndefined();
    warn.mockRestore();
  });

  it("never leaks a database message to the client", async () => {
    tableErrors.products = "relation secret_table does not exist";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(request("shoes"));
    expect(JSON.stringify(await res.json())).not.toContain("secret_table");
    warn.mockRestore();
  });

  it("survives the roster RPC throwing", async () => {
    getTeamRoster.mockRejectedValue(new Error("roster unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(request("shoes"));
    expect(res.status).toBe(200);
    warn.mockRestore();
  });
});

describe("GET /api/search — permissions", () => {
  it("skips the roster entirely for a role without team.read", async () => {
    // Cosmetic gate mirroring the TS permission map; the RPC self-gates too.
    getActiveAccount.mockResolvedValue({
      accountId: "owner-1",
      role: "nobody",
      isOwner: false,
      userId: "user-1",
    });
    await GET(request("shoes"));
    expect(getTeamRoster).not.toHaveBeenCalled();
  });

  it("reads the roster for a viewer, who can see the team", async () => {
    getActiveAccount.mockResolvedValue({
      accountId: "owner-1",
      role: "viewer",
      isOwner: false,
      userId: "user-1",
    });
    await GET(request("shoes"));
    expect(getTeamRoster).toHaveBeenCalledWith("owner-1");
  });
});
