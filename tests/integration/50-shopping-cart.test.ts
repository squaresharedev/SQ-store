/**
 * The shopping cart (20261120_shopping_cart), against the replayed schema.
 *
 * What is proven here is what only the database can hold:
 *
 *   - carts are the service role's alone: no API role reads or writes one,
 *     however it asks, and the table's own checks bound what a cart holds;
 *   - order_place takes a cart's worth of lines (the first on the orders row,
 *     up to 19 more), each with its source, a parcel beside a download, and
 *     the basket's fingerprint and cart on the order, and refuses a 21st line;
 *   - two lines of ONE product (two versions) take their units from one shelf
 *     in the same transaction, so together they can never take more than it
 *     holds, and a shortfall writes no order at all;
 *   - the sweep deletes idle and paid carts and leaves live ones;
 *   - recreating order_place left it the service role's alone.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, closePool, createUser, expectDbError, type TestUser } from "../db/client";
import { SIGNAL_KINDS } from "@/lib/analytics/signals";

let owner: TestUser;
let stranger: TestUser;
let storefront: string;
let vase: string;
let zine: string;
const extras: string[] = [];

const session = () => `cs_test_${randomUUID().replace(/-/g, "")}`;

type Line = { product: string; title: string; price: number; quantity?: number; source?: string; file?: string | null };

/** A cart's order through the one writer: the vase (2), then these lines. */
async function placeOrder(lines: Line[], options: { sessionId?: string; digest?: string; cartId?: string } = {}) {
  const linesTotal = lines.reduce((total, line) => total + line.price * (line.quantity ?? 1), 0);
  const row = {
    seller_id: owner.id,
    product_id: vase,
    storefront_id: storefront,
    channel: "direct",
    status: "paid",
    amount_cents: 2400 * 2 + linesTotal + 450,
    shipping_cents: 450,
    platform_fee_cents: 0,
    currency: "EUR",
    buyer_email: "buyer@example.com",
    product_title: "Stoneware vase",
    product_price_cents: 2400,
    quantity: 2,
    fulfilment_status: "unfulfilled",
    supply_consent_at: new Date().toISOString(),
    checkout_session_id: options.sessionId ?? session(),
    lines_digest: options.digest ?? "a".repeat(64),
    cart_id: options.cartId ?? null,
    add_ons: lines.map((line) => ({
      product_id: line.product,
      source: line.source ?? "cart",
      product_title: line.title,
      product_price_cents: line.price,
      quantity: line.quantity ?? 1,
      amount_cents: line.price * (line.quantity ?? 1),
      discount_cents: 0,
      selected_options: [],
      digital_file_key: line.file ?? null,
    })),
  };
  return asService(
    async (q) =>
      (await q.query(`select public.order_place($1::jsonb) as result`, [JSON.stringify(row)])).rows[0].result as {
        order_id: string;
        duplicate: boolean;
      },
  );
}

const stockOf = (id: string) =>
  asService(
    async (q) =>
      (await q.query(`select stock_quantity from public.products where id = $1`, [id])).rows[0].stock_quantity as number,
  );

beforeAll(async () => {
  owner = await createUser("cart-owner@example.com");
  stranger = await createUser("cart-stranger@example.com");
  await asService(async (q) => {
    storefront = (
      await q.query(`insert into public.storefronts (owner_id, name) values ($1, 'Cart shop') returning id`, [owner.id])
    ).rows[0].id as string;
    const insert = async (title: string, price: number, file: string | null = null) =>
      (
        await q.query(
          `insert into public.products (owner_id, title, price_cents, status, digital_file_key)
           values ($1, $2, $3, 'active', $4) returning id`,
          [owner.id, title, price, file],
        )
      ).rows[0].id as string;
    vase = await insert("Stoneware vase", 2400);
    zine = await insert("Zine", 800, `files/${owner.id}/${randomUUID()}-zine.pdf`);
    for (let n = 0; n < 20; n++) extras.push(await insert(`Print ${n}`, 500));
  });
});

afterAll(async () => {
  await closePool();
});

describe("carts", () => {
  it("are the service role's alone", async () => {
    const cart = await asService(
      async (q) =>
        (await q.query(`insert into public.carts (storefront_id, lines) values ($1, '[]') returning id`, [storefront]))
          .rows[0].id as string,
    );
    // One refused statement per transaction: a refusal aborts the rest of it.
    const anonTries = [
      { sql: `select * from public.carts`, params: [] as unknown[] },
      { sql: `insert into public.carts (storefront_id) values ($1)`, params: [storefront] },
    ];
    for (const attempt of anonTries) {
      const message = await asAnon((q) => expectDbError(q.query(attempt.sql, attempt.params)));
      expect(message, attempt.sql).toMatch(/permission denied/);
    }
    for (const user of [owner, stranger]) {
      for (const sql of [
        `select * from public.carts where id = $1`,
        `update public.carts set lines = '[]' where id = $1`,
        `delete from public.carts where id = $1`,
      ]) {
        const message = await asUser(user, (q) => expectDbError(q.query(sql, [cart])));
        expect(message, `${user.email}: ${sql}`).toMatch(/permission denied/);
      }
    }
  });

  it("hold at most twenty lines, a bounded size, and go with their storefront", async () => {
    const twentyOne = JSON.stringify(Array.from({ length: 21 }, () => ({ productId: vase, quantity: 1 })));
    const big = JSON.stringify([{ note: "x".repeat(9000) }]);
    for (const [lines, check] of [
      [twentyOne, /carts_lines_shape/],
      ["{}", /carts_lines_shape/],
      [big, /carts_lines_size/],
    ] as const) {
      const message = await asService((q) =>
        expectDbError(q.query(`insert into public.carts (storefront_id, lines) values ($1, $2::jsonb)`, [storefront, lines])),
      );
      expect(message).toMatch(check);
    }
    await asService(async (q) => {
      const other = (
        await q.query(`insert into public.storefronts (owner_id, name) values ($1, 'Gone shop') returning id`, [owner.id])
      ).rows[0].id as string;
      await q.query(`insert into public.carts (storefront_id) values ($1)`, [other]);
      await q.query(`delete from public.storefronts where id = $1`, [other]);
      const left = await q.query(`select count(*)::int as n from public.carts where storefront_id = $1`, [other]);
      expect(left.rows[0].n).toBe(0);
    });
  });

  it("are swept when idle for fourteen days, or a day after they are paid", async () => {
    await asService(async (q) => {
      const insert = async (updatedAt: string, orderedAt: string | null) =>
        (
          await q.query(
            `insert into public.carts (storefront_id, updated_at, ordered_at) values ($1, $2, $3) returning id`,
            [storefront, updatedAt, orderedAt],
          )
        ).rows[0].id as string;
      const now = Date.parse("2026-11-20T12:00:00Z");
      const day = 24 * 60 * 60 * 1000;
      const live = await insert(new Date(now - 13 * day).toISOString(), null);
      const idle = await insert(new Date(now - 15 * day).toISOString(), null);
      const paidNow = await insert(new Date(now - 60 * 1000).toISOString(), new Date(now - 60 * 1000).toISOString());
      const paidLong = await insert(new Date(now - 2 * day).toISOString(), new Date(now - 2 * day).toISOString());
      await q.query(`select public.carts_sweep($1)`, [new Date(now).toISOString()]);
      const left = await q.query(`select id from public.carts where id = any($1::uuid[])`, [[live, idle, paidNow, paidLong]]);
      expect(left.rows.map((row) => row.id).sort()).toEqual([live, paidNow].sort());
    });
  });
});

describe("order_place for a cart", () => {
  it("writes every line with its source, a download beside a parcel, and the basket's fingerprint and cart", async () => {
    const cartId = randomUUID();
    const placed = await placeOrder(
      [
        { product: extras[0]!, title: "Print 0", price: 500, quantity: 3 },
        { product: zine, title: "Zine", price: 800, source: "add_on", file: `files/${owner.id}/z-zine.pdf` },
      ],
      { digest: "b".repeat(64), cartId },
    );
    expect(placed.duplicate).toBe(false);
    await asService(async (q) => {
      const order = await q.query(`select lines_digest, cart_id, fulfilment_status from public.orders where id = $1`, [
        placed.order_id,
      ]);
      expect(order.rows[0]).toEqual({ lines_digest: "b".repeat(64), cart_id: cartId, fulfilment_status: "unfulfilled" });
      const lines = await q.query(
        `select product_id, source, quantity, position, digital_file_key is not null as download
           from public.order_add_ons where order_id = $1 order by position`,
        [placed.order_id],
      );
      expect(lines.rows).toEqual([
        { product_id: extras[0], source: "cart", quantity: 3, position: 0, download: false },
        { product_id: zine, source: "add_on", quantity: 1, position: 1, download: true },
      ]);
    });
  });

  it("takes nineteen lines after the first, and refuses a twentieth", async () => {
    const nineteen = extras.slice(0, 19).map((product, n) => ({ product, title: `Print ${n}`, price: 500 }));
    expect((await placeOrder(nineteen)).duplicate).toBe(false);
    const twenty = extras.slice(0, 20).map((product, n) => ({ product, title: `Print ${n}`, price: 500 }));
    await expect(placeOrder(twenty)).rejects.toThrow(/at most 19/);
  });

  it("writes every later line's product and title on the order, from the lines themselves", async () => {
    const placed = await placeOrder([
      { product: extras[2]!, title: "Print 2", price: 500 },
      { product: zine, title: "Zine", price: 800, source: "add_on", file: "files/x/zine.pdf" },
    ]);
    const row = await asService(
      async (q) =>
        (await q.query(`select more_product_ids, more_titles from public.orders where id = $1`, [placed.order_id])).rows[0],
    );
    expect(row).toEqual({ more_product_ids: [extras[2], zine], more_titles: "Print 2 / Zine" });
    // A product's orders, the way the orders list asks (any line is it).
    const found = await asUser(
      owner,
      async (q) =>
        (
          await q.query(
            `select count(*)::int as n from public.orders where id = $1 and (product_id = $2 or more_product_ids @> array[$2]::uuid[])`,
            [placed.order_id, zine],
          )
        ).rows[0].n as number,
    );
    expect(found).toBe(1);
  });

  it("refuses a source it does not know, and a fingerprint that is not one", async () => {
    await expect(placeOrder([{ product: extras[1]!, title: "Print 1", price: 500, source: "elsewhere" }])).rejects.toThrow(
      /order_add_ons_source_check/,
    );
    await expect(placeOrder([], { digest: "not-hex" })).rejects.toThrow(/orders_lines_digest_shape/);
  });

  it("lets two versions of one product take only what its one shelf holds", async () => {
    await asService(async (q) => {
      await q.query(`update public.products set track_stock = true, stock_quantity = 3 where id = $1`, [extras[5]]);
      await q.query(`update public.products set track_stock = false where id = $1`, [vase]);
    });
    // 2 + 2 of a shelf of 3: the second line finds 1 left, so no order at all.
    await expect(
      placeOrder([
        { product: extras[5]!, title: "Print 5 small", price: 500, quantity: 2 },
        { product: extras[5]!, title: "Print 5 large", price: 500, quantity: 2 },
      ]),
    ).rejects.toThrow(/insufficient_stock/);
    expect(await stockOf(extras[5]!)).toBe(3);
    // 2 + 1 fits exactly.
    await placeOrder([
      { product: extras[5]!, title: "Print 5 small", price: 500, quantity: 2 },
      { product: extras[5]!, title: "Print 5 large", price: 500, quantity: 1 },
    ]);
    expect(await stockOf(extras[5]!)).toBe(0);
  });

  it("refunds one line at a time, the last one taking the delivery back, and closes the order when all are", async () => {
    await asService(async (q) => {
      await q.query(`update public.products set track_stock = true, stock_quantity = 10 where id = any($1::uuid[])`, [
        [vase, extras[8]],
      ]);
    });
    // The vase (2 x 24.00), print 8 (3 x 5.00), delivery 4.50: 67.50.
    const placed = await placeOrder([{ product: extras[8]!, title: "Print 8", price: 500, quantity: 3 }]);
    const order = placed.order_id;
    const lineId = await asService(
      async (q) =>
        (await q.query(`select id from public.order_add_ons where order_id = $1`, [order])).rows[0].id as string,
    );
    const amount = (line: string | null) =>
      asService(
        async (q) =>
          (await q.query(`select public.order_line_refund_amount($1, $2) as a`, [order, line])).rows[0].a as
            | number
            | null,
      );
    const refund = (line: string | null, cents: number) =>
      asService(
        async (q) =>
          (
            await q.query(`select public.order_apply_line_refund($1, $2, 'returned', true, $3) as r`, [order, line, cents])
          ).rows[0].r as string,
      );

    expect(await amount(null)).toBe(4800);
    expect(await amount(lineId)).toBe(1500);
    expect(await stockOf(extras[8]!)).toBe(7);

    expect(await refund(lineId, 1500)).toBe("line_refunded");
    expect(await stockOf(extras[8]!)).toBe(10);
    // Once only.
    expect(await amount(lineId)).toBeNull();
    expect(await refund(lineId, 1500)).toBe("already");

    // The last line standing gives back everything left: 48.00 + 4.50.
    expect(await amount(null)).toBe(5250);
    expect(await refund(null, 5250)).toBe("refunded");
    await asService(async (q) => {
      const row = (await q.query(`select status, refund_reason from public.orders where id = $1`, [order])).rows[0];
      expect(row).toEqual({ status: "refunded", refund_reason: "returned" });
      const total = (
        await q.query(`select sum(amount_cents)::int as total from public.order_line_refunds where order_id = $1`, [order])
      ).rows[0].total;
      expect(total).toBe(2400 * 2 + 1500 + 450);
    });
    // A refunded order has nothing left to refund.
    expect(await amount(null)).toBeNull();
  });

  it("answers 'rest' when two lines refunded at once left the delivery behind, and keeps the order paid", async () => {
    const placed = await placeOrder([{ product: extras[9]!, title: "Print 9", price: 500, quantity: 1 }]);
    const order = placed.order_id;
    const lineId = await asService(
      async (q) =>
        (await q.query(`select id from public.order_add_ons where order_id = $1`, [order])).rows[0].id as string,
    );
    // Both priced before either is written (two tabs): neither is the last.
    const [first, second] = await asService(async (q) => {
      const read = async (line: string | null) =>
        (await q.query(`select public.order_line_refund_amount($1, $2) as a`, [order, line])).rows[0].a as number;
      return [await read(null), await read(lineId)];
    });
    expect([first, second]).toEqual([4800, 500]);
    const apply = (line: string | null, cents: number) =>
      asService(
        async (q) =>
          (await q.query(`select public.order_apply_line_refund($1, $2, 'other', false, $3) as r`, [order, line, cents]))
            .rows[0].r as string,
      );
    expect(await apply(null, first)).toBe("line_refunded");
    // Every line back, 4.50 of delivery still owed: the caller refunds the rest.
    expect(await apply(lineId, second)).toBe("rest");
    const status = await asService(
      async (q) => (await q.query(`select status from public.orders where id = $1`, [order])).rows[0].status as string,
    );
    expect(status).toBe("paid");
  });

  it("lets the store read its line refunds and nobody else, and keeps the functions the service role's", async () => {
    const mine = await asUser(owner, async (q) => (await q.query(`select count(*)::int as n from public.order_line_refunds`)).rows[0].n);
    expect(mine).toBeGreaterThan(0);
    const theirs = await asUser(stranger, async (q) => (await q.query(`select count(*)::int as n from public.order_line_refunds`)).rows[0].n);
    expect(theirs).toBe(0);
    for (const sql of [
      `select public.order_line_refund_amount('00000000-0000-4000-8000-000000000000', null)`,
      `select public.order_apply_line_refund('00000000-0000-4000-8000-000000000000', null, 'other', false, 0)`,
      `insert into public.order_line_refunds (order_id, seller_id, amount_cents, reason) values ('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', 1, 'other')`,
    ]) {
      const message = await asUser(owner, (q) => expectDbError(q.query(sql)));
      expect(message, sql).toMatch(/permission denied/);
    }
  });

  it("takes a refunded line out of the figures while its order stands, and counts units by quantity", async () => {
    // A seller of their own, so the figures are this order's alone.
    const seller = await createUser("cart-figures@example.com");
    const [mug, print] = await asService(async (q) => {
      const insert = async (title: string, price: number) =>
        (
          await q.query(
            `insert into public.products (owner_id, title, price_cents, status) values ($1, $2, $3, 'active') returning id`,
            [seller.id, title, price],
          )
        ).rows[0].id as string;
      return [await insert("Mug", 1000), await insert("Print", 500)];
    });
    // Mug x2 (20.00) + print x3 (15.00) + delivery 4.50 = 39.50.
    const order = await asService(
      async (q) =>
        (
          await q.query(`select public.order_place($1::jsonb) as result`, [
            JSON.stringify({
              seller_id: seller.id,
              product_id: mug,
              channel: "direct",
              status: "paid",
              amount_cents: 3950,
              shipping_cents: 450,
              platform_fee_cents: 0,
              currency: "EUR",
              buyer_email: "buyer@example.com",
              product_title: "Mug",
              product_price_cents: 1000,
              quantity: 2,
              fulfilment_status: "unfulfilled",
              checkout_session_id: session(),
              lines_digest: "b".repeat(64),
              add_ons: [
                {
                  product_id: print,
                  source: "cart",
                  product_title: "Print",
                  product_price_cents: 500,
                  quantity: 3,
                  amount_cents: 1500,
                  discount_cents: 0,
                  selected_options: [],
                  digital_file_key: null,
                },
              ],
            }),
          ])
        ).rows[0].result.order_id as string,
    );
    type Figures = {
      byProduct: Record<string, { units_sold: number }>;
      revenue: number;
      analytics: number;
      statuses: { product_id: string; status: string }[];
    };
    const figures = () =>
      asUser(seller, async (q): Promise<Figures> => {
        const sales = (await q.query(`select public.product_sales_aggregate($1) as s`, [seller.id])).rows[0].s;
        const dash = (await q.query(`select public.dashboard_orders_aggregate($1) as d`, [seller.id])).rows[0].d;
        const analytics = (await q.query(`select public.analytics_aggregate($1) as a`, [seller.id])).rows[0].a;
        const statuses = (
          await q.query(`select product_id, status from public.order_lines where order_id = $1 order by is_add_on`, [order])
        ).rows;
        return {
          byProduct: sales.by_product,
          revenue: Number(dash.all_time.revenue_cents),
          analytics: Number(analytics.totals.revenue_cents),
          statuses,
        };
      });

    const before = await figures();
    expect(before.byProduct[mug]!.units_sold).toBe(2);
    expect(before.byProduct[print]!.units_sold).toBe(3);
    expect([before.revenue, before.analytics]).toEqual([3950, 3950]);

    const lineId = await asService(
      async (q) =>
        (await q.query(`select id from public.order_add_ons where order_id = $1`, [order])).rows[0].id as string,
    );
    const outcome = await asService(
      async (q) =>
        (await q.query(`select public.order_apply_line_refund($1, $2, 'returned', false, 1500) as r`, [order, lineId]))
          .rows[0].r as string,
    );
    expect(outcome).toBe("line_refunded");

    const after = await figures();
    expect(after.statuses).toEqual([
      { product_id: mug, status: "paid" },
      { product_id: print, status: "refunded" },
    ]);
    expect(after.byProduct[print]).toBeUndefined();
    expect(after.byProduct[mug]!.units_sold).toBe(2);
    expect([after.revenue, after.analytics]).toEqual([2450, 2450]);
  });

  it("takes the verified badge from a product only once every line of it is refunded", async () => {
    const order = (await placeOrder([
      { product: zine, title: "Zine", price: 800 },
      { product: zine, title: "Zine (signed)", price: 900 },
      { product: extras[19]!, title: "Print 19", price: 500 },
    ])).order_id;
    const review = (product: string) =>
      asService(async (q) => {
        await q.query(
          `insert into public.reviews (product_id, seller_id, order_id, rating, body, author_name, is_verified_buyer, moderation_status)
           values ($1, $2, $3, 5, 'Lovely', 'Aoife', true, 'clean')`,
          [product, owner.id, order],
        );
      });
    await review(zine);
    await review(extras[19]!);
    const verified = (product: string) =>
      asService(
        async (q) =>
          (await q.query(`select is_verified_buyer from public.reviews where order_id = $1 and product_id = $2`, [order, product]))
            .rows[0].is_verified_buyer as boolean,
      );
    const lines = await asService(
      async (q) =>
        (await q.query(`select id, product_id, position from public.order_add_ons where order_id = $1 order by position`, [order]))
          .rows as { id: string; product_id: string }[],
    );
    const refund = (line: string, cents: number) =>
      asService(
        async (q) =>
          (await q.query(`select public.order_apply_line_refund($1, $2, 'returned', false, $3) as r`, [order, line, cents])).rows[0]
            .r as string,
      );
    // One of the zine's two versions refunded: the other is still bought.
    expect(await refund(lines[0]!.id, 800)).toBe("line_refunded");
    expect(await verified(zine)).toBe(true);
    // Both refunded: the zine's review loses its badge; the print's keeps it.
    expect(await refund(lines[1]!.id, 900)).toBe("line_refunded");
    expect(await verified(zine)).toBe(false);
    expect(await verified(extras[19]!)).toBe(true);
  });

  it("accepts every signal kind the app writes, Added to cart included, and no other", async () => {
    // MIRROR: SIGNAL_KINDS (src/lib/analytics/signals.ts) and the CHECK.
    for (const kind of SIGNAL_KINDS) {
      await asService((q) =>
        q.query(
          `insert into public.storefront_signals (account_id, kind, channel, storefront_id) values ($1, $2, 'direct', $3)`,
          [owner.id, kind, storefront],
        ),
      );
    }
    expect(
      await expectDbError(
        asService((q) =>
          q.query(`insert into public.storefront_signals (account_id, kind, channel) values ($1, 'cart_view', 'direct')`, [owner.id]),
        ),
      ),
    ).toMatch(/storefront_signals_kind_check/);
  });

  it("is still the service role's alone after being recreated", async () => {
    const asOwner = await asUser(owner, (q) => expectDbError(q.query(`select public.order_place('{}'::jsonb)`)));
    expect(asOwner).toMatch(/permission denied/);
    const someone = "00000000-0000-4000-8000-000000000000";
    for (const sql of [
      `select public.order_place('{}'::jsonb)`,
      `select public.carts_sweep()`,
      `select * from public.order_lines limit 1`,
      `select public.product_sales_aggregate('${someone}')`,
      `select public.products_ranked_by_metric('${someone}', 'revenue')`,
      `select public.dashboard_orders_aggregate('${someone}')`,
      `select public.analytics_aggregate('${someone}')`,
    ]) {
      const message = await asAnon((q) => expectDbError(q.query(sql)));
      expect(message, sql).toMatch(/permission denied/);
    }
  });
});
