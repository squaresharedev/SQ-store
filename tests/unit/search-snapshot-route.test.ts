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

/** Recording PostgREST stand-in — same rig as search-route.test.ts, because
 *  the thing worth proving is identical: every query pins its account. */
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
  for (const method of ["select", "eq", "ilike", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      record.calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => builderFor(table) }),
}));

import { GET } from "@/app/api/search/snapshot/route";
import type { SearchSnapshotResponse } from "@/lib/search/types";

const ACCOUNT = {
  accountId: "owner-1",
  role: "owner" as const,
  isOwner: true,
  userId: "user-1",
};

function callsFor(table: string): Call[] {
  return tableCalls.filter((t) => t.table === table).flatMap((t) => t.calls);
}

function eqValue(table: string, column: string): unknown {
  return callsFor(table).find(
    (call) => call.method === "eq" && call.args[0] === column,
  )?.args[1];
}

function limitFor(table: string): unknown {
  return callsFor(table).find((call) => call.method === "limit")?.args[0];
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

describe("GET /api/search/snapshot — gates", () => {
  it("401 when signed out, before any query runs", async () => {
    getUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(tableCalls).toHaveLength(0);
  });

  it("429 once the budget is spent, before any query runs", async () => {
    rateLimit.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(429);
    expect(tableCalls).toHaveLength(0);
  });

  it("401 when the active account cannot be resolved", async () => {
    getActiveAccount.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(tableCalls).toHaveLength(0);
  });
});

describe("GET /api/search/snapshot — account scoping", () => {
  it("pins every store table to the ACTIVE account, not the signed-in user", async () => {
    getActiveAccount.mockResolvedValue({
      accountId: "other-owner",
      role: "editor",
      isOwner: false,
      userId: "user-1",
    });
    await GET();
    expect(eqValue("products", "owner_id")).toBe("other-owner");
    expect(eqValue("storefronts", "owner_id")).toBe("other-owner");
    expect(eqValue("orders", "seller_id")).toBe("other-owner");
    expect(getTeamRoster).toHaveBeenCalledWith("other-owner");
  });

  it("pins notifications to the USER — they follow the person, not the store", async () => {
    getActiveAccount.mockResolvedValue({
      accountId: "other-owner",
      role: "editor",
      isOwner: false,
      userId: "user-1",
    });
    await GET();
    expect(eqValue("notifications", "user_id")).toBe("user-1");
    expect(
      callsFor("notifications").some(
        (call) => call.method === "eq" && call.args[0] === "owner_id",
      ),
    ).toBe(false);
  });

  it("skips the roster entirely for a role without team.read", async () => {
    getActiveAccount.mockResolvedValue({
      accountId: "owner-1",
      role: "nobody",
      isOwner: false,
      userId: "user-1",
    });
    await GET();
    expect(getTeamRoster).not.toHaveBeenCalled();
  });
});

describe("GET /api/search/snapshot — shape", () => {
  it("returns names only — no money, no bodies", async () => {
    tableRows.products = [{ id: "p1", title: "Lamp", status: "active" }];
    tableRows.orders = [
      { id: "o1", product_title: "Lamp", buyer_email: "b@x.com", status: "paid" },
    ];
    const res = await GET();
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("price_cents");
    expect(text).not.toContain("amount_cents");
    expect(text).not.toContain("currency");
    expect(text).not.toContain("body");
  });

  it("selects only the compact columns", async () => {
    await GET();
    const selected = (table: string) =>
      String(callsFor(table).find((c) => c.method === "select")?.args[0]);
    expect(selected("products")).toBe("id, title, status");
    expect(selected("storefronts")).toBe("id, name");
    expect(selected("orders")).toBe("id, product_title, buyer_email, status");
    expect(selected("notifications")).toBe("id, title, read");
  });

  it("caps and orders each source newest-first", async () => {
    await GET();
    expect(limitFor("products")).toBe(300);
    expect(limitFor("orders")).toBe(100);
    expect(limitFor("notifications")).toBe(50);
    for (const table of ["products", "orders", "notifications"]) {
      const order = callsFor(table).find((c) => c.method === "order");
      expect(order?.args[0], table).toBe("created_at");
      expect(order?.args[1], table).toEqual({ ascending: false });
    }
  });

  it("maps the roster to username + email only", async () => {
    getTeamRoster.mockResolvedValue([
      {
        id: "m1",
        member_user_id: "u2",
        invited_email: "vera@x.com",
        role: "viewer",
        status: "active",
        invited_at: "2026-01-01",
        accepted_at: "2026-01-02",
        username: "vera",
        avatar_url: "https://cdn/x.png",
      },
    ]);
    const res = await GET();
    const body = (await res.json()) as SearchSnapshotResponse;
    expect(body.snapshot.team).toEqual([
      {
        id: "m1",
        username: "vera",
        invited_email: "vera@x.com",
        role: "viewer",
        status: "active",
      },
    ]);
    // The avatar URL and timestamps must not ride along.
    expect(JSON.stringify(body)).not.toContain("avatar_url");
  });
});

describe("GET /api/search/snapshot — failure isolation", () => {
  it("one broken table costs its group, not the snapshot", async () => {
    tableErrors.orders = "orders exploded";
    tableRows.products = [{ id: "p1", title: "Lamp", status: "active" }];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchSnapshotResponse;
    expect(body.snapshot.products).toHaveLength(1);
    expect(body.snapshot.orders).toEqual([]);
    warn.mockRestore();
  });

  it("never leaks a database message to the client", async () => {
    tableErrors.products = "relation secret_table does not exist";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET();
    expect(JSON.stringify(await res.json())).not.toContain("secret_table");
    warn.mockRestore();
  });

  it("survives the roster RPC throwing", async () => {
    getTeamRoster.mockRejectedValue(new Error("roster unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchSnapshotResponse;
    expect(body.snapshot.team).toEqual([]);
    warn.mockRestore();
  });
});
