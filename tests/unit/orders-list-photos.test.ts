// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE ORDERS LIST'S PHOTOS COST NO EXTRA READS.
 *
 * Each row of /orders shows the photo of what was bought. The photo comes
 * EMBEDDED in the one orders query (PostgREST follows orders.product_id), so a
 * page of rows is one read: never a second query for the products, never one
 * per row, and never one per picture. Signing is local and done once per
 * distinct photo, and every row of one product gets the same URL, so the
 * browser downloads each picture once. These pin all of that, and which
 * photo a row shows.
 */

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_STORE = "99999999-9999-4999-8999-999999999999";
const WALNUT = "aaaaaaaa-0000-4000-8000-000000000001";
const OAK = "aaaaaaaa-0000-4000-8000-000000000002";
const FINISH = "aaaaaaaa-0000-4000-8000-0000000000f0";

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

const presignMock = vi.fn(async (key: string) => `https://r2.test/${key}?signed`);
vi.mock("@/lib/r2", () => ({
  presignGetUrl: (key: string) => presignMock(key),
}));

/** Every table read, and what each asked for. */
const reads: { table: string; columns: string }[] = [];
let stagedRows: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["eq", "match", "is", "not", "in", "gte", "lte", "or", "order", "range"]) {
        chain[method] = () => chain;
      }
      chain.select = (columns: string) => {
        reads.push({ table, columns });
        return chain;
      };
      chain.then = (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
        Promise.resolve({ data: stagedRows, error: null, count: stagedRows.length }).then(resolve, reject);
      return chain;
    },
  }),
}));

import { getOrderGlances, listOrders } from "@/lib/orders/queries";

/** The embedded product, as PostgREST hands it back. */
function product(overrides: Record<string, unknown> = {}) {
  return {
    owner_id: ACCOUNT_ID,
    image_key: "images/lamp.jpg",
    gallery: [],
    option_groups: [],
    moderation_status: "ok",
    ...overrides,
  };
}

function orderRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    product_title: "Lamp",
    selected_options: [],
    quantity: 1,
    status: "paid",
    fulfilment_status: "shipped",
    amount_cents: 2500,
    currency: "EUR",
    channel: "embed",
    created_at: "2026-10-01T10:00:00Z",
    product: product(),
    ...overrides,
  };
}

const TABLE = product({
  image_key: "images/table.jpg",
  gallery: [{ key: "images/table-walnut.jpg", alt: "", optionId: WALNUT }],
  option_groups: [
    {
      id: FINISH,
      name: "Finish",
      display: "chip",
      options: [
        { id: WALNUT, name: "Walnut", available: true },
        { id: OAK, name: "Oak", available: true },
      ],
    },
  ],
});

const ids = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);

beforeEach(() => {
  vi.clearAllMocks();
  reads.length = 0;
  stagedRows = [];
  getActiveAccountMock.mockResolvedValue({ accountId: ACCOUNT_ID, role: "owner" });
});

describe("listOrders: the photo rides along in the one query", () => {
  it("reads the page in ONE query, with the product embedded by its foreign key", async () => {
    stagedRows = [orderRow(ids[0]), orderRow(ids[1])];
    await listOrders();
    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe("orders");
    expect(reads[0].columns).toContain("products!orders_product_id_fkey(");
    expect(reads.some((read) => read.table === "products")).toBe(false);
  });

  it("signs each distinct photo once, and gives every row of a product the same URL", async () => {
    stagedRows = [
      orderRow(ids[0]),
      orderRow(ids[1]),
      orderRow(ids[2]),
      orderRow(ids[3], { product: product({ image_key: "images/cup.jpg" }) }),
    ];
    const { rows } = await listOrders();
    expect(presignMock).toHaveBeenCalledTimes(2);
    expect(rows[0].photoUrl).toBe("https://r2.test/images/lamp.jpg?signed");
    expect(rows[1].photoUrl).toBe(rows[0].photoUrl);
    expect(rows[2].photoUrl).toBe(rows[0].photoUrl);
    expect(rows[3].photoUrl).toBe("https://r2.test/images/cup.jpg?signed");
  });

  it("shows the bought version's own photo, else the cover", async () => {
    stagedRows = [
      orderRow(ids[0], { product: TABLE, selected_options: [{ label: "Finish", value: "Walnut" }] }),
      // Oak has no photo of its own: the cover stands in.
      orderRow(ids[1], { product: TABLE, selected_options: [{ label: "Finish", value: "Oak" }] }),
    ];
    const { rows } = await listOrders();
    expect(rows[0].photoUrl).toBe("https://r2.test/images/table-walnut.jpg?signed");
    expect(rows[1].photoUrl).toBe("https://r2.test/images/table.jpg?signed");
  });

  it("shows no photo for a deleted, photoless, taken-down or foreign product", async () => {
    stagedRows = [
      orderRow(ids[0], { product: null }),
      orderRow(ids[1], { product: product({ image_key: null }) }),
      orderRow(ids[2], { product: product({ moderation_status: "removed" }) }),
      orderRow(ids[3], { product: product({ owner_id: OTHER_STORE }) }),
    ];
    const { rows } = await listOrders();
    expect(rows.map((row) => row.photoUrl)).toEqual([null, null, null, null]);
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("keeps the order itself whole beside its photo", async () => {
    stagedRows = [orderRow(ids[0], { product_title: "Brass lamp", quantity: 2 })];
    const { rows, total } = await listOrders();
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ id: ids[0], productTitle: "Brass lamp", quantity: 2 });
  });
});

describe("getOrderGlances: the overview's Recent orders, one query too", () => {
  it("reads photo and quantity in ONE orders query, no products read", async () => {
    stagedRows = [
      orderRow(ids[0], { quantity: 3 }),
      orderRow(ids[1], { product: product({ moderation_status: "removed" }) }),
    ];
    const glances = await getOrderGlances([ids[0], ids[1]]);
    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe("orders");
    expect(reads[0].columns).toContain("products!orders_product_id_fkey(");
    expect(glances[ids[0]]).toEqual({ quantity: 3, photoUrl: "https://r2.test/images/lamp.jpg?signed" });
    expect(glances[ids[1]]).toEqual({ quantity: 1, photoUrl: null });
  });
});
