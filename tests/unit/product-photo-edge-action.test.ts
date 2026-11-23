// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Storing a photo's measured edge on its product (lib/products/photo-edge-
// actions.ts): who may, what may be written, and that it lands only on the
// product's CURRENT photo of the store the caller acts for.

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

const rateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { productPhotoEdge: { max: 300, windowSeconds: 3600 } },
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
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
      for (const method of ["select", "update", "eq", "is"]) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return chain;
        };
      }
      chain.maybeSingle = () => Promise.resolve(responses.shift());
      return chain;
    },
  }),
}));

import { recordPhotoEdge } from "@/lib/products/photo-edge-actions";

const OWNER = "10000000-0000-4000-8000-000000000001";
const EDITOR = "10000000-0000-4000-8000-000000000002";
const PRODUCT = "20000000-0000-4000-8000-000000000003";
const PHOTO = `images/${OWNER}/30000000-0000-4000-8000-000000000004-mug.webp`;
const NEWER = `images/${OWNER}/30000000-0000-4000-8000-000000000005-mug.webp`;

const argsOf = (calls: Call[], method: string) => calls.filter((call) => call.method === method).map((call) => call.args);
const errorCode = (result: Awaited<ReturnType<typeof recordPhotoEdge>>) => (result.ok ? null : result.error.code);

beforeEach(() => {
  queries.length = 0;
  responses = [];
  vi.clearAllMocks();
  getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: OWNER, role: "owner", isOwner: true });
  rateLimitMock.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("storing a photo's edge", () => {
  it("writes the answer onto the product, only while the measured photo is still its photo", async () => {
    responses = [{ data: { id: PRODUCT }, error: null }];
    expect(await recordPhotoEdge({ productId: PRODUCT, photoKey: PHOTO, edge: "white" })).toEqual({ ok: true, edge: "white" });
    expect(queries).toHaveLength(1);
    const [write] = queries;
    expect(argsOf(write, "update")).toEqual([[{ photo_edge: "white" }]]);
    expect(argsOf(write, "eq")).toEqual([
      ["id", PRODUCT],
      ["owner_id", OWNER],
      ["image_key", PHOTO],
    ]);
    // Only a photo with no answer yet is written.
    expect(argsOf(write, "is")).toEqual([["photo_edge", null]]);
    expect(rateLimitMock).toHaveBeenCalledWith("product_photo_edge", { max: 300, windowSeconds: 3600 });
  });

  it("writes on the owner's store for a team editor", async () => {
    getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: EDITOR, role: "editor", isOwner: false });
    responses = [{ data: { id: PRODUCT }, error: null }];
    expect(await recordPhotoEdge({ productId: PRODUCT, photoKey: PHOTO, edge: "other" })).toEqual({ ok: true, edge: "other" });
    expect(argsOf(queries[0], "eq")).toContainEqual(["owner_id", OWNER]);
  });

  it("refuses a member who may not edit products, and a signed-out caller, before any read", async () => {
    getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: EDITOR, role: "viewer", isOwner: false });
    expect(errorCode(await recordPhotoEdge({ productId: PRODUCT, photoKey: PHOTO, edge: "white" }))).toBe("permission_denied");
    getActiveAccountMock.mockResolvedValue(null);
    expect(errorCode(await recordPhotoEdge({ productId: PRODUCT, photoKey: PHOTO, edge: "white" }))).toBe("session_expired");
    expect(queries).toHaveLength(0);
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it("is bounded by its own budget", async () => {
    rateLimitMock.mockResolvedValue(false);
    expect(errorCode(await recordPhotoEdge({ productId: PRODUCT, photoKey: PHOTO, edge: "white" }))).toBe("rate_limited");
    expect(queries).toHaveLength(0);
  });

  it("writes only a value from the list, for a real product id, and nothing else", async () => {
    for (const input of [
      { productId: PRODUCT, photoKey: PHOTO, edge: "grey" },
      { productId: PRODUCT, photoKey: PHOTO, edge: "WHITE" },
      { productId: "not-a-uuid", photoKey: PHOTO, edge: "white" },
      { productId: PRODUCT, photoKey: "", edge: "white" },
      { productId: PRODUCT, photoKey: "x".repeat(601), edge: "white" },
      { productId: PRODUCT, photoKey: PHOTO, edge: "white", photo_edge: "white" },
      { productId: PRODUCT, photoKey: PHOTO, edge: "white", ownerId: EDITOR },
    ]) {
      const result = await recordPhotoEdge(input as never);
      expect(errorCode(result), JSON.stringify(input)).toBe("invalid_input");
    }
    expect(queries).toHaveLength(0);
  });
});

describe("when nothing is written", () => {
  it("reports nothing for a photo the product no longer has: the answer is never laid on its new photo", async () => {
    responses = [
      { data: null, error: null },
      { data: { image_key: NEWER, photo_edge: null }, error: null },
    ];
    expect(await recordPhotoEdge({ productId: PRODUCT, photoKey: PHOTO, edge: "white" })).toEqual({ ok: true, edge: null });
    expect(argsOf(queries[1], "eq")).toEqual([
      ["id", PRODUCT],
      ["owner_id", OWNER],
    ]);
  });

  it("reports the answer already stored for the same photo", async () => {
    responses = [
      { data: null, error: null },
      { data: { image_key: PHOTO, photo_edge: "white" }, error: null },
    ];
    expect(await recordPhotoEdge({ productId: PRODUCT, photoKey: PHOTO, edge: "white" })).toEqual({ ok: true, edge: "white" });
  });

  it("says not found for a product that is not this store's", async () => {
    responses = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    expect(errorCode(await recordPhotoEdge({ productId: PRODUCT, photoKey: PHOTO, edge: "white" }))).toBe("not_found");
  });

  it("says the save failed when the database does", async () => {
    responses = [{ data: null, error: { message: "down" } }];
    expect(errorCode(await recordPhotoEdge({ productId: PRODUCT, photoKey: PHOTO, edge: "white" }))).toBe("server_error");
  });
});
