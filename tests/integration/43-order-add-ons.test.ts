/**
 * "Add to your order" (20261028_product_add_ons), against the replayed schema.
 *
 * What is proven here is what only the database can hold:
 *
 *   - order_place writes each add-on line and takes its stock in the same
 *     transaction, so a shortfall on ANY line writes no order at all, and a
 *     redelivered checkout writes nothing twice;
 *   - an abandoned checkout, the expiry sweep and a refund with restock put
 *     every line's units back;
 *   - a store's members read their own lines, and nobody else reads any;
 *   - products.add_on_ids can only name other products of the same store;
 *   - the per-product numbers credit an add-on to its own product, and an
 *     order without add-ons adds up exactly as it always did.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, closePool, createUser, expectDbError, type TestUser } from "../db/client";

let owner: TestUser;
let viewer: TestUser;
let stranger: TestUser;
let vase: string;
let mug: string;
let coasters: string;
let strangersProduct: string;

const session = () => `cs_test_${randomUUID().replace(/-/g, "")}`;

type Line = { product: string; title: string; price: number; amount?: number; options?: unknown[] };

/** A checkout through the one writer: the vase, plus these lines. */
async function placeOrder(
  lines: Line[],
  options: { status?: "paid" | "pending"; sessionId?: string; expiresAt?: string; quantity?: number } = {},
) {
  const addOnsTotal = lines.reduce((total, line) => total + (line.amount ?? line.price), 0);
  const quantity = options.quantity ?? 1;
  const row = {
    seller_id: owner.id,
    product_id: vase,
    channel: "direct",
    status: options.status ?? "paid",
    amount_cents: 2400 * quantity + addOnsTotal + 450,
    shipping_cents: 450,
    platform_fee_cents: 0,
    currency: "EUR",
    buyer_email: "buyer@example.com",
    product_title: "Stoneware vase",
    product_price_cents: 2400,
    quantity,
    fulfilment_status: "unfulfilled",
    checkout_session_id: options.sessionId ?? session(),
    pending_expires_at: options.expiresAt ?? null,
    add_ons: lines.map((line) => ({
      product_id: line.product,
      product_title: line.title,
      product_price_cents: line.price,
      quantity: 1,
      amount_cents: line.amount ?? line.price,
      discount_cents: line.price - (line.amount ?? line.price),
      selected_options: line.options ?? [],
      digital_file_key: null,
    })),
  };
  return asService(
    async (q) =>
      (await q.query(`select public.order_place($1::jsonb) as result`, [JSON.stringify(row)])).rows[0].result as {
        order_id: string;
        duplicate: boolean;
        add_on_low_stock?: { product_id: string; stock_left: number }[];
      },
  );
}

const stockOf = (id: string) =>
  asService(
    async (q) =>
      (await q.query(`select stock_quantity from public.products where id = $1`, [id])).rows[0].stock_quantity as number,
  );

const setStock = (id: string, quantity: number | null, threshold = 5) =>
  asService((q) =>
    q.query(
      `update public.products set track_stock = $2, stock_quantity = $3, low_stock_threshold = $4 where id = $1`,
      [id, quantity !== null, quantity, threshold],
    ),
  );

const linesOf = (orderId: string) =>
  asService(
    async (q) =>
      (
        await q.query(
          `select product_id, product_title, amount_cents, stock_reserved, position
             from public.order_add_ons where order_id = $1 order by position`,
          [orderId],
        )
      ).rows,
  );

beforeAll(async () => {
  owner = await createUser("add-ons-owner@example.com");
  viewer = await createUser("add-ons-viewer@example.com");
  stranger = await createUser("add-ons-stranger@example.com");
  await asService(async (q) => {
    await q.query(
      `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'viewer', 'active', now())`,
      [owner.id, viewer.id, viewer.email],
    );
    const insert = async (ownerId: string, title: string, price: number) =>
      (
        await q.query(
          `insert into public.products (owner_id, title, price_cents, status) values ($1, $2, $3, 'active') returning id`,
          [ownerId, title, price],
        )
      ).rows[0].id as string;
    vase = await insert(owner.id, "Stoneware vase", 2400);
    mug = await insert(owner.id, "Mug", 1200);
    coasters = await insert(owner.id, "Coasters", 1800);
    strangersProduct = await insert(stranger.id, "Someone else's lamp", 5000);
  });
});

afterAll(closePool);

describe("products.add_on_ids", () => {
  it("takes other products of the same store, in order", async () => {
    await asUser(owner, (q) =>
      q.query(`update public.products set add_on_ids = $2 where id = $1`, [vase, [mug, coasters]]),
    );
    const stored = await asService(
      async (q) => (await q.query(`select add_on_ids from public.products where id = $1`, [vase])).rows[0].add_on_ids,
    );
    expect(stored).toEqual([mug, coasters]);
  });

  it("refuses itself, a repeat, another store's product and a fifth", async () => {
    const set = (ids: string[]) =>
      asUser(owner, (q) => q.query(`update public.products set add_on_ids = $2 where id = $1`, [vase, ids]));
    expect(await expectDbError(set([vase]))).toMatch(/own add-on/);
    expect(await expectDbError(set([mug, mug]))).toMatch(/listed twice/);
    expect(await expectDbError(set([strangersProduct]))).toMatch(/same store/);
    // Five real products of the store: the trigger lets them through and the
    // size check is what refuses.
    const extra = await asService(async (q) =>
      (
        await q.query(
          `insert into public.products (owner_id, title, price_cents, status)
           select $1, 'Extra ' || n, 100, 'draft' from generate_series(1, 3) n returning id`,
          [owner.id],
        )
      ).rows.map((row) => row.id as string),
    );
    expect(await expectDbError(set([mug, coasters, ...extra]))).toMatch(/products_add_on_ids_size/);
  });
});

describe("order_place with add-ons", () => {
  it("writes each line and takes its stock", async () => {
    await setStock(mug, 3, 2);
    await setStock(coasters, 5, 1);
    const placed = await placeOrder([
      { product: mug, title: "Mug", price: 1200 },
      { product: coasters, title: "Coasters", price: 1800, amount: 1350 },
    ]);
    expect(placed.duplicate).toBe(false);
    expect(await linesOf(placed.order_id)).toEqual([
      { product_id: mug, product_title: "Mug", amount_cents: 1200, stock_reserved: 1, position: 0 },
      { product_id: coasters, product_title: "Coasters", amount_cents: 1350, stock_reserved: 1, position: 1 },
    ]);
    expect(await stockOf(mug)).toBe(2);
    expect(await stockOf(coasters)).toBe(4);
    // The mug is now at its low-stock line: the writer is told so.
    expect(placed.add_on_low_stock).toEqual([{ product_id: mug, stock_left: 2 }]);
  });

  it("writes NO order when one line is short, and gives nothing else up", async () => {
    await setStock(vase, 10);
    await setStock(mug, 0);
    await setStock(coasters, 5);
    const before = await asService(
      async (q) => (await q.query(`select count(*)::int as n from public.orders where seller_id = $1`, [owner.id])).rows[0].n,
    );
    expect(
      await expectDbError(
        placeOrder([
          { product: coasters, title: "Coasters", price: 1800 },
          { product: mug, title: "Mug", price: 1200 },
        ]),
      ),
    ).toMatch(/insufficient_stock/);
    const after = await asService(
      async (q) => (await q.query(`select count(*)::int as n from public.orders where seller_id = $1`, [owner.id])).rows[0].n,
    );
    expect(after).toBe(before);
    expect(await stockOf(vase)).toBe(10);
    expect(await stockOf(coasters)).toBe(5);
  });

  it("writes nothing twice for a redelivered checkout, and refuses more than four lines", async () => {
    await setStock(mug, null);
    const sessionId = session();
    const first = await placeOrder([{ product: mug, title: "Mug", price: 1200 }], { sessionId });
    const again = await placeOrder([{ product: mug, title: "Mug", price: 1200 }], { sessionId });
    expect(again).toMatchObject({ order_id: first.order_id, duplicate: true });
    expect(await linesOf(first.order_id)).toHaveLength(1);
    const five = Array.from({ length: 5 }, () => ({ product: mug, title: "Mug", price: 1200 }));
    expect(await expectDbError(placeOrder(five))).toMatch(/at most 4/);
  });
});

describe("giving stock back", () => {
  it("puts every line's units back when an unpaid checkout is released", async () => {
    await setStock(vase, 10);
    await setStock(mug, 4);
    const sessionId = session();
    await placeOrder([{ product: mug, title: "Mug", price: 1200 }], {
      status: "pending",
      sessionId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect([await stockOf(vase), await stockOf(mug)]).toEqual([9, 3]);
    const released = await asService(
      async (q) => (await q.query(`select public.order_release_pending($1) as released`, [sessionId])).rows[0].released,
    );
    expect(released).toBe(true);
    expect([await stockOf(vase), await stockOf(mug)]).toEqual([10, 4]);
  });

  it("puts them back when the sweep expires an unpaid order", async () => {
    await setStock(vase, 10);
    await setStock(mug, 4);
    await placeOrder([{ product: mug, title: "Mug", price: 1200 }], {
      status: "pending",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await stockOf(mug)).toBe(3);
    await asService((q) => q.query(`select public.orders_release_expired(now())`));
    expect([await stockOf(vase), await stockOf(mug)]).toEqual([10, 4]);
  });

  it("puts them back on a refund with restock, and only then", async () => {
    await setStock(vase, 10);
    await setStock(mug, 4);
    const kept = await placeOrder([{ product: mug, title: "Mug", price: 1200 }]);
    await asService((q) => q.query(`select public.order_apply_refund($1, 'other', false)`, [kept.order_id]));
    expect(await stockOf(mug)).toBe(3);
    const back = await placeOrder([{ product: mug, title: "Mug", price: 1200 }]);
    expect(await stockOf(mug)).toBe(2);
    await asService((q) => q.query(`select public.order_apply_refund($1, 'returned', true)`, [back.order_id]));
    expect([await stockOf(vase), await stockOf(mug)]).toEqual([9, 3]);
    expect((await linesOf(back.order_id))[0]?.stock_reserved).toBe(0);
  });
});

describe("who reads the lines", () => {
  it("is the store's own members, and nobody else", async () => {
    await setStock(mug, null);
    const placed = await placeOrder([{ product: mug, title: "Mug", price: 1200 }]);
    const read = (user: TestUser) =>
      asUser(user, async (q) =>
        (await q.query(`select id from public.order_add_ons where order_id = $1`, [placed.order_id])).rows.length,
      );
    expect(await read(owner)).toBe(1);
    expect(await read(viewer)).toBe(1);
    expect(await read(stranger)).toBe(0);
    expect(await expectDbError(asAnon((q) => q.query(`select id from public.order_add_ons limit 1`)))).toMatch(
      /permission denied/,
    );
    expect(
      await expectDbError(
        asUser(owner, (q) =>
          q.query(`update public.order_add_ons set amount_cents = 1 where order_id = $1`, [placed.order_id]),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("per-product numbers", () => {
  it("credit the add-on to its own product, and the order's amount still adds up", async () => {
    await setStock(vase, null);
    await setStock(mug, null);
    await setStock(coasters, null);
    const totals = async () =>
      asUser(owner, async (q) => {
        const { rows } = await q.query(`select public.product_sales_aggregate($1) as result`, [owner.id]);
        return rows[0].result.by_product as Record<string, { units_sold: number; revenue_cents: number }>;
      });
    const before = await totals();
    const placed = await placeOrder([{ product: coasters, title: "Coasters", price: 1800 }]);
    const after = await totals();
    // The coasters' own line, and the vase keeps the rest (delivery included).
    expect(after[coasters]!.units_sold - (before[coasters]?.units_sold ?? 0)).toBe(1);
    expect(after[coasters]!.revenue_cents - (before[coasters]?.revenue_cents ?? 0)).toBe(1800);
    expect(after[vase]!.revenue_cents - before[vase]!.revenue_cents).toBe(2400 + 450);
    const { rows } = await asUser(owner, (q) =>
      q.query(
        `select sum(revenue_cents)::int as lines, (select amount_cents from public.orders where id = $1) as amount
           from public.order_lines where order_id = $1`,
        [placed.order_id],
      ),
    );
    expect(rows[0].lines).toBe(rows[0].amount);
  });
});
