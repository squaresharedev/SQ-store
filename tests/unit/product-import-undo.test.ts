// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Taking a CSV import back (lib/products/import-actions.ts undoProductImport):
// who may, what it spends, and exactly which rows the delete can reach.

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

const rateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { productImport: { max: 12, windowSeconds: 3600 } },
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The import half of the module, which the undo never reaches.
vi.mock("@/lib/settings/seller-identity", () => ({ publishBlockedError: vi.fn() }));
vi.mock("@/lib/moderation/auto/check", () => ({ checkMany: vi.fn() }));
vi.mock("@/lib/billing/limits", () => ({
  planLimitError: vi.fn(),
  planLimitErrorFromTrigger: vi.fn(),
  planLimitKeyOf: vi.fn(),
  planRoom: vi.fn(),
}));

type Call = { method: string; args: unknown[] };
/** One chain per delete, in the order they were sent. */
const deletes: Call[][] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      expect(table).toBe("products");
      const calls: Call[] = [];
      deletes.push(calls);
      const chain: Record<string, unknown> = {};
      for (const method of ["delete", "in", "eq", "is", "select"]) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return chain;
        };
      }
      // Every id in the batch was still untouched, so every one goes.
      chain.then = (resolve: (value: unknown) => void) => {
        const ids = calls.find((call) => call.method === "in")?.args[1] as string[];
        return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(resolve);
      };
      return chain;
    },
  }),
}));

import { undoProductImport } from "@/lib/products/import-actions";
import { IMPORT_ROWS_MAX } from "@/lib/products/csv";

const OWNER = "10000000-0000-4000-8000-000000000001";

/** `count` well-formed product ids. */
function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
}

beforeEach(() => {
  deletes.length = 0;
  vi.clearAllMocks();
  getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: OWNER, role: "owner", isOwner: true });
  rateLimitMock.mockResolvedValue(true);
});

describe("undoProductImport", () => {
  it("deletes the import's products in batches, from this store only, and only untouched ones", async () => {
    const result = await undoProductImport(ids(150));

    expect(result).toEqual({ ok: true, deleted: 150 });
    expect(rateLimitMock).toHaveBeenCalledWith("product_import", expect.anything());
    expect(deletes.map((calls) => (calls.find((call) => call.method === "in")?.args[1] as string[]).length)).toEqual([
      100, 50,
    ]);
    for (const calls of deletes) {
      expect(calls).toContainEqual({ method: "eq", args: ["owner_id", OWNER] });
      // A photo, a file or documents added since keeps the product: nothing in
      // storage is ever left without its row.
      expect(calls).toContainEqual({ method: "is", args: ["image_key", null] });
      expect(calls).toContainEqual({ method: "is", args: ["digital_file_key", null] });
      expect(calls).toContainEqual({ method: "eq", args: ["gallery", "[]"] });
      expect(calls).toContainEqual({ method: "eq", args: ["documents", "[]"] });
    }
  });

  it("refuses a member who cannot edit products, before spending or deleting anything", async () => {
    getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: "viewer", role: "viewer", isOwner: false });

    const result = await undoProductImport(ids(2));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("permission_denied");
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(deletes).toHaveLength(0);
  });

  it("refuses once the import budget is spent", async () => {
    rateLimitMock.mockResolvedValue(false);

    const result = await undoProductImport(ids(2));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("rate_limited");
    expect(deletes).toHaveLength(0);
  });

  it("deletes nothing for a list that is not product ids", async () => {
    for (const input of [[], ["not-an-id"], "20000000-0000-4000-8000-000000000000", ids(IMPORT_ROWS_MAX + 1)]) {
      const result = await undoProductImport(input);
      expect(result.ok).toBe(false);
    }
    expect(deletes).toHaveLength(0);
  });
});
