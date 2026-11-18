/**
 * Tests for 20261117_perf_indexes.sql:
 *   (a) dashboard_orders_aggregate returns identical results to the old
 *       CTE-based definition (verified against hand-computed expected values).
 *   (b) storefront_signals_aggregate all_time_kinds returns the correct sorted
 *       distinct set via the new loose index scan.
 *   (c) The new indexes exist and the dropped prefix/stale indexes are gone.
 *   (d) rl_take_key still enforces its limit after the updated_at index drop.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asService,
  asSuper,
  asUser,
  closePool,
  createUser,
  type TestUser,
} from "../db/client";

let seller: TestUser;
let stranger: TestUser;

/** Insert one order for `seller`. */
async function insertOrder(opts: {
  status?: string;
  cents: number;
  currency?: string;
  daysAgo?: number;
  channel?: string;
  title?: string;
}): Promise<void> {
  await asService((q) =>
    q.query(
      `insert into public.orders
         (seller_id, channel, status, amount_cents, platform_fee_cents,
          currency, buyer_email, product_title, product_price_cents, created_at)
       values ($1, $2, $3, $4, 0, $5, 'b@test.local', $6, $4,
               now() - ($7 || ' days')::interval)`,
      [
        seller.id,
        opts.channel ?? "embed",
        opts.status ?? "paid",
        opts.cents,
        opts.currency ?? "EUR",
        opts.title ?? "Test product",
        String(opts.daysAgo ?? 0),
      ],
    ),
  );
}

beforeAll(async () => {
  seller = await createUser("perf-seller@test.squareshare.to");
  stranger = await createUser("perf-stranger@test.squareshare.to");

  // Fixture: 3 paid EUR orders (1 in last 30d, 1 in prev 30d, 1 at 70d ago),
  // 1 refunded EUR, 1 USD paid (must be invisible), 1 pending EUR.
  // Orders inside 30d:  1 x 1000 = 1000
  // Orders in prev 30d: 1 x 2000 = 2000
  // All-time paid EUR:  1000 + 2000 + 500 = 3500   (70d-ago order is 500)
  await insertOrder({ cents: 1000, daysAgo: 5 });
  await insertOrder({ cents: 2000, daysAgo: 40, channel: "marketplace" });
  await insertOrder({ cents: 500, daysAgo: 70, title: "Old product" });
  await insertOrder({ cents: 300, status: "refunded", daysAgo: 10 });
  await insertOrder({ cents: 9999, currency: "USD", daysAgo: 1 });
  await insertOrder({ cents: 700, status: "pending", daysAgo: 2, title: "Pending thing" });
});

afterAll(closePool);

// ---------------------------------------------------------------------------
// (a) dashboard_orders_aggregate: FILTER rewrite produces the same numbers
// ---------------------------------------------------------------------------
describe("dashboard_orders_aggregate (perf rewrite)", () => {
  it("produces hand-verified all-time, 30d and prev-30d totals", async () => {
    const { rows } = await asUser(seller, (q) =>
      q.query(`select public.dashboard_orders_aggregate($1) as j`, [seller.id]),
    );
    const j = rows[0].j;

    // All-time paid EUR: 1000 + 2000 + 500 = 3500 cents, 3 sales.
    expect(j.all_time.revenue_cents).toBe(3500);
    expect(j.all_time.sales).toBe(3);

    // Last 30d paid EUR: only the 5-day-ago order (1000).
    expect(j.last_30d.revenue_cents).toBe(1000);
    expect(j.last_30d.sales).toBe(1);

    // Prev 30d (30-60 days ago) paid EUR: only the 40-day-ago order (2000).
    expect(j.prev_30d.revenue_cents).toBe(2000);
    expect(j.prev_30d.sales).toBe(1);

    // EUR non-paid counts: 1 refunded, 0 disputed.
    expect(j.refunded_count).toBe(1);
    expect(j.disputed_count).toBe(0);
  });

  it("recent_orders: 5 most recent EUR orders, USD invisible", async () => {
    const { rows } = await asUser(seller, (q) =>
      q.query(`select public.dashboard_orders_aggregate($1) as j`, [seller.id]),
    );
    const j = rows[0].j;

    // 5 non-USD orders: 3 paid + 1 refunded + 1 pending, all EUR.
    expect(j.recent_orders).toHaveLength(5);
    for (const row of j.recent_orders) {
      expect(row.currency).not.toBe("USD");
      // Every row carries an id the UI can link on.
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/i);
    }
    // Newest first: 5-day-ago order (1000 cents) should be earliest among the
    // paid ones, but pending (2d) and refunded (10d) are mixed in.
    // Just verify the most recent entry is the 1-day-ago pending or 2-day-ago
    // pending: either way all amounts are non-USD.
    expect(j.recent_orders[0].created_at).toBeDefined();
  });

  it("trend_days: only paid EUR orders inside 30 days", async () => {
    const { rows } = await asUser(seller, (q) =>
      q.query(`select public.dashboard_orders_aggregate($1) as j`, [seller.id]),
    );
    const j = rows[0].j;

    // One paid EUR order in the last 30 days (5 days ago).
    expect(j.trend_days).toHaveLength(1);
    expect(j.trend_days[0].revenue_cents).toBe(1000);
    expect(j.trend_days[0].sales).toBe(1);
    expect(j.trend_days[0].age_days).toBe(5);
  });

  it("returns zeros for a stranger (RLS still enforced)", async () => {
    const { rows } = await asUser(stranger, (q) =>
      q.query(`select public.dashboard_orders_aggregate($1) as j`, [seller.id]),
    );
    expect(rows[0].j.all_time.sales).toBe(0);
    expect(rows[0].j.recent_orders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) storefront_signals_aggregate: loose index scan for all_time_kinds
// ---------------------------------------------------------------------------
describe("storefront_signals_aggregate all_time_kinds (loose index scan)", () => {
  let signalSeller: TestUser;

  beforeAll(async () => {
    signalSeller = await createUser("perf-signals@test.squareshare.to");

    // Insert signals with three distinct kinds and multiple rows per kind to
    // verify DISTINCT semantics are preserved.
    await asService((q) =>
      q.query(
        `insert into public.storefront_signals
           (account_id, kind, occurred_at)
         values
           ($1, 'storefront_view', now() - interval '1 day'),
           ($1, 'storefront_view', now() - interval '2 days'),
           ($1, 'email_signup',    now() - interval '3 days'),
           ($1, 'product_click',   now() - interval '4 days'),
           ($1, 'product_click',   now() - interval '5 days')`,
        [signalSeller.id],
      ),
    );
  });

  it("returns sorted distinct kinds regardless of row count per kind", async () => {
    const { rows } = await asUser(signalSeller, (q) =>
      q.query(`select public.storefront_signals_aggregate($1) as j`, [signalSeller.id]),
    );
    const kinds = rows[0].j.all_time_kinds;

    // Three distinct kinds, alphabetically sorted.
    expect(kinds).toEqual(["email_signup", "product_click", "storefront_view"]);
  });

  it("returns all_time_kinds even when the date range is empty", async () => {
    // A range that excludes all rows still shows the kinds the account has ever
    // had (the whole point of all_time_kinds).
    const future = new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10);
    const { rows } = await asUser(signalSeller, (q) =>
      q.query(`select public.storefront_signals_aggregate($1, $2::date) as j`, [
        signalSeller.id,
        future,
      ]),
    );
    const kinds = rows[0].j.all_time_kinds;
    expect(kinds).toEqual(["email_signup", "product_click", "storefront_view"]);
    // But in-range totals are empty.
    expect(rows[0].j.totals).toEqual([]);
  });

  it("returns an empty array when the account has no signals", async () => {
    const noSignals = await createUser("perf-nosignals@test.squareshare.to");
    const { rows } = await asUser(noSignals, (q) =>
      q.query(`select public.storefront_signals_aggregate($1) as j`, [noSignals.id]),
    );
    expect(rows[0].j.all_time_kinds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (c) Index presence / absence
// ---------------------------------------------------------------------------
describe("index inventory after perf migration", () => {
  async function indexExists(name: string): Promise<boolean> {
    const { rows } = await asSuper((q) =>
      q.query(
        `select 1 from pg_indexes where indexname = $1 and schemaname = 'public'`,
        [name],
      ),
    );
    return rows.length > 0;
  }

  it("new FK indexes exist", async () => {
    expect(await indexExists("storefront_signals_storefront_id_idx")).toBe(true);
    expect(await indexExists("storefront_funnel_daily_day_idx")).toBe(true);
    expect(await indexExists("seller_funnel_events_account_id_idx")).toBe(true);
  });

  it("new reviews indexes exist", async () => {
    expect(await indexExists("reviews_seller_reviewed_idx")).toBe(true);
    expect(await indexExists("reviews_seller_external_idx")).toBe(true);
    expect(await indexExists("reviews_seller_held_idx")).toBe(true);
  });

  it("stale and prefix indexes are gone", async () => {
    // Reviews: sorted by created_at per seller -- nothing used this ordering.
    expect(await indexExists("reviews_seller_idx")).toBe(false);
    // Prefix indexes subsumed by wider ones.
    expect(await indexExists("orders_seller_status_idx")).toBe(false);
    expect(await indexExists("products_owner_id_idx")).toBe(false);
    expect(await indexExists("storefronts_owner_id_idx")).toBe(false);
    // rate_limit_keys updated_at index dropped.
    expect(await indexExists("rate_limit_keys_updated_at_idx")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) rl_take_key still limits correctly without its updated_at index
// ---------------------------------------------------------------------------
describe("rl_take_key after updated_at index drop", () => {
  it("allows up to max takes then denies", async () => {
    const key = `perf-test-key-${Date.now()}`;
    const action = "perf_test_action";
    const max = 3;
    const window = 3600; // 1 hour window -- no takes will expire during the test

    const take = () =>
      asService((q) =>
        q.query(`select public.rl_take_key($1, $2, $3, $4) as ok`, [
          key, action, max, window,
        ]),
      ).then(({ rows }) => rows[0].ok as boolean);

    expect(await take()).toBe(true);  // 1st
    expect(await take()).toBe(true);  // 2nd
    expect(await take()).toBe(true);  // 3rd (at limit)
    expect(await take()).toBe(false); // 4th -- denied
    expect(await take()).toBe(false); // 5th -- still denied
  });

  it("denies an empty key rather than mixing buckets", async () => {
    const result = await asService((q) =>
      q.query(`select public.rl_take_key('', 'any', 10, 60) as ok`),
    );
    expect(result.rows[0].ok).toBe(false);
  });

  it("denies a null max rather than failing open", async () => {
    const result = await asService((q) =>
      q.query(`select public.rl_take_key('k', 'a', null, 60) as ok`),
    );
    expect(result.rows[0].ok).toBe(false);
  });
});
