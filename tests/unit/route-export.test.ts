// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: unknown };

const getUser = vi.fn<() => Promise<QueryResult>>();
const tables: Record<string, QueryResult> = {};
const filters: Record<string, unknown[]> = {};

function chain(table: string) {
  const result = tables[table] ?? { data: [], error: null };
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters[table] = [col, val];
      return builder;
    },
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

import { GET } from "@/app/settings/export/route";

const USER = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  email: "me@example.com",
  created_at: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(filters)) delete filters[k];
});

describe("GET /settings/export", () => {
  it("401 when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null } as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("exports ONLY session-scoped data with download headers", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null } as never);
    tables.profiles = { data: { id: USER.id, display_name: "Me" }, error: null };
    tables.products = { data: [{ id: "p1", owner_id: USER.id }], error: null };
    tables.storefronts = { data: [{ id: "s1", owner_id: USER.id }], error: null };

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
