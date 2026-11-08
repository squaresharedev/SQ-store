// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The product card's quick writes (lib/products/card-actions.ts): Make active /
// Make draft, and Duplicate. Who may, which gates they pass, and exactly what
// reaches the products table.

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { productWrite: { max: 60, windowSeconds: 60 } },
  rateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values: { title: string }) =>
    key === "duplicateTitle" ? `Copy of ${values.title}` : key,
}));

const publishBlockedMock = vi.fn();
vi.mock("@/lib/settings/seller-identity", () => ({
  publishBlockedError: (...args: unknown[]) => publishBlockedMock(...args),
}));
vi.mock("@/lib/moderation/auto/check", () => ({
  precheck: vi.fn(),
  settleAfterWrite: vi.fn(),
}));

const planLimitMock = vi.fn();
vi.mock("@/lib/billing/limits", () => ({
  planLimitError: (...args: unknown[]) => planLimitMock(...args),
  planLimitErrorFromTrigger: vi.fn(),
  planLimitKeyOf: () => null,
}));

type Call = { method: string; args: unknown[] };
/** One chain per query, in the order they were sent. */
const queries: Call[][] = [];
/** What each query's final call resolves to, in order. */
let responses: unknown[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      expect(table).toBe("products");
      const calls: Call[] = [];
      queries.push(calls);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "eq"]) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return chain;
        };
      }
      chain.maybeSingle = chain.single = () => Promise.resolve(responses.shift());
      return chain;
    },
  }),
}));

import { duplicateProduct, setProductStatus } from "@/lib/products/card-actions";
import { PRODUCT_TITLE_MAX } from "@/lib/validation/product";

const OWNER = "10000000-0000-4000-8000-000000000001";
const PRODUCT = "20000000-0000-4000-8000-000000000002";
const COPY = "20000000-0000-4000-8000-000000000003";
const REFUSAL = { code: "invalid_input", message: { key: "Errors.x" } };

const argsOf = (calls: Call[], method: string) => calls.find((call) => call.method === method)?.args;

beforeEach(() => {
  queries.length = 0;
  responses = [];
  vi.clearAllMocks();
  getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: OWNER, role: "owner", isOwner: true });
  publishBlockedMock.mockResolvedValue(null);
  planLimitMock.mockResolvedValue(null);
});

describe("setProductStatus", () => {
  it("moves a product to draft in this store, with no publish gate to pass", async () => {
    responses = [{ data: { id: PRODUCT, moderation_status: "ok" }, error: null }];

    expect(await setProductStatus(PRODUCT, "draft")).toEqual({ ok: true });
    expect(argsOf(queries[0], "update")).toEqual([{ status: "draft" }]);
    expect(queries[0]).toContainEqual({ method: "eq", args: ["owner_id", OWNER] });
    expect(publishBlockedMock).not.toHaveBeenCalled();
  });

  it("refuses Make active while the seller details are missing, writing nothing", async () => {
    publishBlockedMock.mockResolvedValue(REFUSAL);

    const result = await setProductStatus(PRODUCT, "active");

    expect(result).toEqual({ ok: false, error: REFUSAL });
    expect(queries).toHaveLength(0);
  });

  it("refuses a member who cannot edit products, and a status that is not one", async () => {
    getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: "v", role: "viewer", isOwner: false });
    expect((await setProductStatus(PRODUCT, "active")).ok).toBe(false);

    getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: OWNER, role: "owner", isOwner: true });
    expect((await setProductStatus(PRODUCT, "archived" as never)).ok).toBe(false);
    expect(queries).toHaveLength(0);
  });
});

describe("duplicateProduct", () => {
  const source = {
    title: "Oak lamp",
    description: "Turned by hand.",
    price_cents: 4900,
    currency: "EUR",
    track_stock: true,
    stock_quantity: 4,
    low_stock_threshold: 2,
    max_per_order: 3,
    option_groups: [],
    details: { badges: [] },
    purchase_url: "https://shop.example/oak-lamp",
    shipping_profile_id: null,
  };

  it("adds a draft copy in this store, with no stored photo, file or documents of the original", async () => {
    responses = [{ data: source, error: null }, { data: { id: COPY, moderation_status: "ok" }, error: null }];

    expect(await duplicateProduct(PRODUCT)).toEqual({ ok: true, id: COPY });
    expect(queries[0]).toContainEqual({ method: "eq", args: ["owner_id", OWNER] });
    const [insert] = argsOf(queries[1], "insert") as [Record<string, unknown>];
    expect(insert).toEqual({ ...source, owner_id: OWNER, title: "Copy of Oak lamp", status: "draft" });
    for (const key of ["image_key", "digital_file_key", "gallery", "documents", "add_on_ids"]) {
      expect(insert).not.toHaveProperty(key);
    }
  });

  it("keeps the copy's title inside what a save accepts", async () => {
    const long = "x".repeat(PRODUCT_TITLE_MAX);
    responses = [{ data: { ...source, title: long }, error: null }, { data: { id: COPY }, error: null }];

    await duplicateProduct(PRODUCT);

    const [insert] = argsOf(queries[1], "insert") as [{ title: string }];
    expect(insert.title).toHaveLength(PRODUCT_TITLE_MAX);
    expect(insert.title.startsWith("Copy of ")).toBe(true);
  });

  it("refuses at the plan's product limit before reading or writing anything", async () => {
    planLimitMock.mockResolvedValue(REFUSAL);

    expect(await duplicateProduct(PRODUCT)).toEqual({ ok: false, error: REFUSAL });
    expect(queries).toHaveLength(0);
  });
});
