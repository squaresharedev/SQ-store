/**
 * SQL aggregate RPCs (20260802_analytics_sql_aggregates): analytics,
 * dashboard, per-product sales and metric ranking, computed in the database.
 *
 * These replaced JS aggregation over CAPPED row reads (5,000 / 1,000 / 500),
 * past which every figure went silently wrong. The tests here prove the three
 * properties the swap depends on:
 *   1. the numbers are right (hand-computed expectations over seeded rows);
 *   2. RLS holds inside the functions (SECURITY INVOKER: another user calling
 *      with a forged seller id gets zeros, a team member with store.read gets
 *      the owner's data);
 *   3. the EUR-only rule matches toCurrency (only the literal 'USD' drops).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asService,
  asUser,
  closePool,
  createUser,
  type TestUser,
} from "../db/client";

let owner: TestUser;
let stranger: TestUser;
let viewer: TestUser;
let productA: string;
let productB: string;

/** Insert one order for `owner`; returns nothing we need. */
async function order(opts: {
  product?: string | null;
  status?: string;
  cents: number;
  fee?: number;
  currency?: string;
  buyer?: string;
  daysAgo?: number;
  channel?: string;
  title?: string;
}): Promise<void> {
  await asService((q) =>
    q.query(
      `insert into public.orders
         (seller_id, product_id, channel, status, amount_cents,
          platform_fee_cents, currency, buyer_email, product_title,
          product_price_cents, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $5,
               now() - ($10 || ' days')::interval)`,
      [
        owner.id,
        opts.product ?? null,
        opts.channel ?? "embed",
        opts.status ?? "paid",
        opts.cents,
        opts.fee ?? 0,
        opts.currency ?? "EUR",
        opts.buyer ?? "buyer@example.test",
        opts.title ?? "Seeded product",
        String(opts.daysAgo ?? 0),
      ],
    ),
  );
}

beforeAll(async () => {
  owner = await createUser("agg-owner@test.squareshare.to");
  stranger = await createUser("agg-stranger@test.squareshare.to");
  viewer = await createUser("agg-viewer@test.squareshare.to");

  // Viewer is an ACTIVE team member with store.read on the owner's store.
  await asService((q) =>
    q.query(
      `insert into public.team_members
         (account_owner_id, invited_email, role, status, member_user_id, accepted_at)
       values ($1, $2, 'viewer', 'active', $3, now())`,
      [owner.id, "agg-viewer@test.squareshare.to", viewer.id],
    ),
  );

  const { rows } = await asService((q) =>
    q.query(
      `insert into public.products (owner_id, title, price_cents, status)
       values ($1, 'Product A', 1000, 'active'), ($1, 'Product B', 2000, 'active')
       returning id`,
      [owner.id],
    ),
  );
  productA = rows[0].id;
  productB = rows[1].id;

  // The fixture the expectations below are hand-computed from:
  //   paid EUR:  A 1000 (x2, same buyer)  +  B 2000 (x3)  = 8000 cents
  //   fees: 6 x 50 on the paid EUR rows counted below     = 250
  //   refunded EUR: 500
  //   USD paid: 9999 (must be invisible to analytics/dashboard)
  //   pending EUR: 700
  await order({ product: productA, cents: 1000, fee: 50, buyer: "repeat@x.test", daysAgo: 1, title: "Product A" });
  await order({ product: productA, cents: 1000, fee: 50, buyer: "repeat@x.test", daysAgo: 2, title: "Product A" });
  await order({ product: productB, cents: 2000, fee: 50, buyer: "one@x.test", daysAgo: 3, title: "Product B" });
  await order({ product: productB, cents: 2000, fee: 50, buyer: "two@x.test", daysAgo: 40, title: "Product B" });
  await order({ product: productB, cents: 2000, fee: 50, buyer: "three@x.test", daysAgo: 45, title: "Product B", channel: "marketplace" });
  await order({ product: productA, cents: 500, fee: 0, status: "refunded", buyer: "four@x.test", daysAgo: 4, title: "Product A" });
  await order({ product: productA, cents: 9999, fee: 0, currency: "USD", buyer: "usd@x.test", daysAgo: 5, title: "Product A" });
  await order({ product: null, cents: 700, fee: 0, status: "pending", buyer: "five@x.test", daysAgo: 6, title: "Deleted product" });
});

afterAll(closePool);

describe("analytics_aggregate", () => {
  it("computes hand-checked totals over the EUR set", async () => {
    const { rows } = await asUser(owner, (q) =>
      q.query(`select public.analytics_aggregate($1) as j`, [owner.id]),
    );
    const j = rows[0].j;
    // paid EUR = 1000+1000+2000+2000+2000; pending 700 excluded; USD excluded.
    expect(j.totals.revenue_cents).toBe(8000);
    expect(j.totals.sales).toBe(5);
    expect(j.totals.fees_cents).toBe(250);
    expect(j.totals.refunded_count).toBe(1);
    expect(j.totals.refunded_cents).toBe(500);
    // Buyers over PAID rows: repeat@x.test (x2), one, two, three = 4 unique.
    expect(j.totals.unique_buyers).toBe(4);
    expect(j.totals.repeat_buyers).toBe(1);
    // Statuses cover the whole EUR set including pending + refunded.
    const statuses = Object.fromEntries(
      j.statuses.map((s: { status: string; count: number }) => [s.status, s.count]),
    );
    expect(statuses.paid).toBe(5);
    expect(statuses.refunded).toBe(1);
    expect(statuses.pending).toBe(1);
    // Top products by paid revenue: B (6000) above A (2000).
    expect(j.top_products[0]).toMatchObject({ title: "Product B", revenue_cents: 6000, sales: 3 });
    expect(j.top_products[1]).toMatchObject({ title: "Product A", revenue_cents: 2000, sales: 2 });
    // Channels: 1 marketplace paid order, 4 embed.
    const byChannel = Object.fromEntries(
      j.channels.map((c: { channel: string; sales: number }) => [c.channel, c.sales]),
    );
    expect(byChannel.marketplace).toBe(1);
    expect(byChannel.embed).toBe(4);
  });

  it("respects the date range bounds inclusively", async () => {
    const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const { rows } = await asUser(owner, (q) =>
      q.query(`select public.analytics_aggregate($1, $2::date) as j`, [owner.id, from]),
    );
    // Orders at daysAgo 1, 2, 3 are inside; 40/45-day-old paid rows are not.
    expect(rows[0].j.totals.sales).toBe(3);
    expect(rows[0].j.totals.revenue_cents).toBe(4000);
  });

  it("returns zeros for a stranger passing the owner's id (RLS)", async () => {
    const { rows } = await asUser(stranger, (q) =>
      q.query(`select public.analytics_aggregate($1) as j`, [owner.id]),
    );
    expect(rows[0].j.totals.sales).toBe(0);
    expect(rows[0].j.totals.revenue_cents).toBe(0);
    expect(rows[0].j.series_days).toEqual([]);
  });

  it("lets an active team member read the owner's numbers (store.read)", async () => {
    const { rows } = await asUser(viewer, (q) =>
      q.query(`select public.analytics_aggregate($1) as j`, [owner.id]),
    );
    expect(rows[0].j.totals.revenue_cents).toBe(8000);
  });
});

describe("dashboard_orders_aggregate", () => {
  it("splits all-time vs last-30d vs prev-30d correctly", async () => {
    const { rows } = await asUser(owner, (q) =>
      q.query(`select public.dashboard_orders_aggregate($1) as j`, [owner.id]),
    );
    const j = rows[0].j;
    expect(j.all_time).toMatchObject({ revenue_cents: 8000, sales: 5 });
    // daysAgo 1,2,3 inside 30d; 40 and 45 in the previous window.
    expect(j.last_30d).toMatchObject({ revenue_cents: 4000, sales: 3 });
    expect(j.prev_30d).toMatchObject({ revenue_cents: 4000, sales: 2 });
    expect(j.refunded_count).toBe(1);
    expect(j.disputed_count).toBe(0);
    // Recent orders: newest first, 5 max, EUR only (USD row invisible).
    expect(j.recent_orders.length).toBe(5);
    expect(j.recent_orders[0].amount_cents).toBe(1000);
    for (const row of j.recent_orders) expect(row.currency).not.toBe("USD");
    // Each row carries its id: the overview's Recent orders card links on it.
    for (const row of j.recent_orders) {
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });

  it("returns zeros for a stranger (RLS)", async () => {
    const { rows } = await asUser(stranger, (q) =>
      q.query(`select public.dashboard_orders_aggregate($1) as j`, [owner.id]),
    );
    expect(rows[0].j.all_time.sales).toBe(0);
    expect(rows[0].j.recent_orders).toEqual([]);
  });
});

describe("product_sales_aggregate", () => {
  it("rolls up paid units and revenue per product, ALL currencies", async () => {
    const { rows } = await asUser(owner, (q) =>
      q.query(`select public.product_sales_aggregate($1) as j`, [owner.id]),
    );
    const j = rows[0].j;
    // A: 2 paid EUR + 1 paid USD = 3 units, 1000+1000+9999 cents.
    expect(j.by_product[productA]).toMatchObject({
      units_sold: 3,
      revenue_cents: 11999,
    });
    expect(j.by_product[productB]).toMatchObject({
      units_sold: 3,
      revenue_cents: 6000,
    });
    // Bestseller by REVENUE: A (11999) over B (6000).
    expect(j.bestseller_id).toBe(productA);
    // The pending null-product order contributes nothing.
    expect(Object.keys(j.by_product)).toHaveLength(2);
  });

  it("is empty for a stranger (RLS)", async () => {
    const { rows } = await asUser(stranger, (q) =>
      q.query(`select public.product_sales_aggregate($1) as j`, [owner.id]),
    );
    expect(rows[0].j.by_product).toEqual({});
    expect(rows[0].j.bestseller_id).toBeNull();
  });
});

describe("products_ranked_by_metric", () => {
  it("ranks the whole catalogue by revenue with an exact total", async () => {
    const { rows } = await asUser(owner, (q) =>
      q.query(
        `select public.products_ranked_by_metric($1, 'revenue') as j`,
        [owner.id],
      ),
    );
    const j = rows[0].j;
    expect(j.total).toBe(2);
    // Revenue: A 11999 > B 6000.
    expect(j.ids).toEqual([productA, productB]);
  });

  it("ranks by units with created_at-desc tiebreak and honours search", async () => {
    const { rows } = await asUser(owner, (q) =>
      q.query(
        `select public.products_ranked_by_metric($1, 'unitsSold', null, 'Product B') as j`,
        [owner.id],
      ),
    );
    expect(rows[0].j.total).toBe(1);
    expect(rows[0].j.ids).toEqual([productB]);
  });

  it("pages with limit/offset", async () => {
    const { rows } = await asUser(owner, (q) =>
      q.query(
        `select public.products_ranked_by_metric($1, 'revenue', null, null, 1, 1) as j`,
        [owner.id],
      ),
    );
    expect(rows[0].j.total).toBe(2);
    expect(rows[0].j.ids).toEqual([productB]);
  });

  it("returns nothing for a stranger (RLS)", async () => {
    const { rows } = await asUser(stranger, (q) =>
      q.query(`select public.products_ranked_by_metric($1, 'revenue') as j`, [owner.id]),
    );
    expect(rows[0].j.total).toBe(0);
    expect(rows[0].j.ids).toEqual([]);
  });
});
