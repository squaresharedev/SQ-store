// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/products/[id]/photo: a member's same-origin copy of a product's
// photo. Pinned here: it names the photo it served (PHOTO_KEY_HEADER), so a
// measurement of its pixels is stored against that photo and no later one.

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({ getActiveAccount: () => getActiveAccountMock() }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { productPhoto: { max: 300, windowSeconds: 3600 } },
  rateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn(async (key: string) => `https://bucket.r2.test/${key}?sig=1`) }));

let row: { image_key: string | null } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: row, error: null }),
    };
    return { from: () => chain };
  },
}));

import { GET } from "@/app/api/products/[id]/photo/route";
import { PHOTO_KEY_HEADER } from "@/lib/storefront/photo-edge";

const OWNER = "10000000-0000-4000-8000-000000000001";
const PRODUCT = "20000000-0000-4000-8000-000000000002";
const KEY = `images/${OWNER}/30000000-0000-4000-8000-000000000003-mug.webp`;

const ask = () => GET(new Request("http://localhost/api"), { params: Promise.resolve({ id: PRODUCT }) });

beforeEach(() => {
  getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: OWNER, role: "owner", isOwner: true });
  row = { image_key: KEY };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the product photo route", () => {
  it("serves the photo and names which photo it is", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get(PHOTO_KEY_HEADER)).toBe(KEY);
  });

  it("names nothing when there is no photo to serve", async () => {
    row = { image_key: null };
    const response = await ask();
    expect(response.status).toBe(404);
    expect(response.headers.get(PHOTO_KEY_HEADER)).toBeNull();
  });
});
