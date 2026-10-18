// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: unknown };

const getUser = vi.fn<() => Promise<QueryResult>>();
const tables: Record<string, QueryResult> = {};
const filters: Record<string, unknown[]> = {};
/** Every filter a table was read with (team_members is read twice). */
const everyFilter: Record<string, unknown[][]> = {};
/** The columns each table was asked for. */
const selected: Record<string, string> = {};

function chain(table: string) {
  const result = tables[table] ?? { data: [], error: null };
  const builder = {
    select: (columns: string) => {
      selected[table] = columns;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      filters[table] = [col, val];
      (everyFilter[table] ??= []).push([col, val]);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: QueryResult) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => getUser() },
    from: (table: string) => chain(table),
  }),
}));

// The cancellation feedback is a service-role read (the table has no client
// grant), through the same recorded chain.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => chain(table) }),
}));

// The route takes from the dataExport budget before querying. Allowed by
// default here; the 429 test flips it. The real limiter is covered by its own
// suite; what matters in THIS suite is that the route respects the answer.
const rateLimit = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: (...args: unknown[]) => rateLimit(...(args as [])),
}));

// The plan comes from the service-role billing read. Scoped by the id it is
// handed, which must be the session's: recorded here so the test can say so.
const readAccountBilling = vi.fn();
vi.mock("@/lib/billing/account-plan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/account-plan")>()),
  readAccountBilling: (...args: unknown[]) => readAccountBilling(...args),
}));

import { GET } from "@/app/settings/export/route";
import { FREE_BILLING } from "@/lib/billing/account-plan";

const USER = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  email: "me@example.com",
  created_at: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue(true);
  readAccountBilling.mockResolvedValue({ ok: true, billing: { ...FREE_BILLING, customerId: "cus_secret", subscriptionId: "sub_secret" } });
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(filters)) delete filters[k];
  for (const k of Object.keys(everyFilter)) delete everyFilter[k];
  for (const k of Object.keys(selected)) delete selected[k];
});

describe("GET /settings/export", () => {
  it("401 when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null } as never);
    const res = await GET();
    expect(res.status).toBe(401);
    // Signed-out callers must not spend anyone's budget.
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("429 when the export budget is exhausted — before any query runs", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null } as never);
    rateLimit.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(429);
    // The refusal happened before the expensive reads: no table was touched.
    expect(Object.keys(filters)).toEqual([]);
  });

  it("exports ONLY session-scoped data with download headers", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null } as never);
    tables.profiles = { data: { id: USER.id, username: "me" }, error: null };
    tables.products = { data: [{ id: "p1", owner_id: USER.id }], error: null };
    tables.storefronts = { data: [{ id: "s1", owner_id: USER.id }], error: null };
    tables.plan_cancellations = { data: [{ plan: "starter", reason: "unused", detail: "Back in spring" }], error: null };

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="square-share-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.json();
    expect(body.account).toEqual({
      id: USER.id,
      email: USER.email,
      created_at: USER.created_at,
    });
    expect(body.products).toHaveLength(1);
    expect(body.storefronts).toHaveLength(1);

    // Every table query was filtered by the SESSION user id — never a param.
    expect(filters.profiles).toEqual(["id", USER.id]);
    expect(filters.products).toEqual(["owner_id", USER.id]);
    expect(filters.storefronts).toEqual(["owner_id", USER.id]);
    expect(filters.plan_cancellations).toEqual(["owner_id", USER.id]);
    expect(body.plan_cancellations).toEqual([{ plan: "starter", reason: "unused", detail: "Back in spring" }]);
    expect(readAccountBilling).toHaveBeenCalledWith(USER.id);

    // The rest of what we hold about THIS person, each keyed on the session.
    expect(filters.orders).toEqual(["seller_id", USER.id]);
    expect(filters.notifications).toEqual(["user_id", USER.id]);
    expect(filters.security_events).toEqual(["user_id", USER.id]);
    expect(everyFilter.team_members).toEqual([
      ["account_owner_id", USER.id],
      ["member_user_id", USER.id],
    ]);
    expect(body).toMatchObject({
      orders: [],
      notifications: [],
      security_events: [],
      team: { invited: [], member_of: [] },
      truncated: { orders: false, notifications: false, security_events: false },
    });
    // A buyer's email and address are another person's data: never selected.
    expect(selected.orders).not.toMatch(/buyer_email|ship_to|gift_message|payment_ref|checkout_session_id/);
    // Nor the salted IP digest on the security log.
    expect(selected.security_events).not.toMatch(/ip_hash|meta/);

    // The plan is exported; the Stripe ids behind it are not.
    expect(body.billing).toMatchObject({ plan: "free", status: "none" });
    expect(JSON.stringify(body)).not.toMatch(/cus_secret|sub_secret/);
  });

  it("500 when one of the wider reads errors: an export missing its orders is not the whole file", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null } as never);
    tables.orders = { data: null, error: { message: "boom" } };
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("500 when the cancellation read errors too", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null } as never);
    tables.plan_cancellations = { data: null, error: { message: "boom" } };
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("500 when any query errors — no partial export", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null } as never);
    tables.profiles = { data: null, error: { message: "boom" } };
    tables.products = { data: [], error: null };
    tables.storefronts = { data: [], error: null };
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
