/**
 * Pricing config (20261011_pricing_config), against the replayed schema.
 *
 * What is proven here is what the migration promises and nothing in TypeScript
 * could hold on its own:
 *
 *   - the seeded numbers ARE the ones the code's fixtures carry, and each
 *     Postgres enum is its TypeScript list;
 *   - plan_prices is append-only: one open row per plan and interval, a change
 *     goes through plan_price_change, and a price that was in force can be
 *     neither edited nor deleted;
 *   - a client reads the config and can write none of it, and cannot reach a
 *     waiver, a switch or the ledger's writer at all;
 *   - the fee ledger is insert-only and idempotent, files every row under the
 *     ORDER's seller, and a store's team reads only its own;
 *   - order_place writes the whole fee, and refuses parts that do not add up.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asSuper,
  asUser,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";
import { ENTITLEMENT_SEED, PLAN_PRICE_SEED } from "../../src/lib/billing/pricing-seed";
import { FEATURE_KEYS, FEE_ENTRY_KINDS, PLAN_IDS } from "../../src/lib/pricing/enums";

let owner: TestUser;
let viewer: TestUser;
let stranger: TestUser;
let productId: string;

const session = () => `cs_test_${randomUUID().replace(/-/g, "")}`;

/** The query must be refused, with a message that says why. */
const refused = async (run: Promise<unknown>, pattern: RegExp) =>
  expect(await expectDbError(run)).toMatch(pattern);

type Fees = {
  amount?: number;
  platformFee?: number;
  adFee?: number;
  adRate?: number | null;
  applicationFee?: number | null;
  capped?: boolean;
  seller?: TestUser;
};

/** A paid order through the one writer, with the fee parts given. */
async function placeOrder(fees: Fees = {}): Promise<string> {
  const row = {
    seller_id: (fees.seller ?? owner).id,
    product_id: productId,
    channel: "direct",
    status: "paid",
    amount_cents: fees.amount ?? 2500,
    platform_fee_cents: fees.platformFee ?? 125,
    platform_fee_bps: 500,
    seller_plan: "free",
    ad_rate_bps: fees.adRate ?? null,
    ad_fee_cents: fees.adFee ?? 0,
    application_fee_cents:
      fees.applicationFee === undefined ? (fees.platformFee ?? 125) + (fees.adFee ?? 0) : fees.applicationFee,
    fee_capped: fees.capped ?? false,
    currency: "EUR",
    buyer_email: "buyer@example.com",
    product_title: "Stoneware vase",
    product_price_cents: 2500,
    quantity: 1,
    fulfilment_status: "unfulfilled",
    checkout_session_id: session(),
  };
  return asService(async (q) =>
    (await q.query(`select public.order_place($1::jsonb) as result`, [JSON.stringify(row)])).rows[0].result
      .order_id as string,
  );
}

const record = (orderId: string, kind: string, amount: number, key: string, feeId: string | null = null) =>
  asService(async (q) =>
    (
      await q.query(`select public.fee_ledger_record($1, $2::public.fee_entry_kind, $3, $4, $5, false) as written`, [
        orderId,
        kind,
        amount,
        key,
        feeId,
      ])
    ).rows[0].written as boolean,
  );

const enumLabels = (name: string) =>
  asSuper(async (q) =>
    (
      await q.query(
        `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = $1 and t.typnamespace = 'public'::regnamespace order by e.enumsortorder`,
        [name],
      )
    ).rows.map((row) => row.enumlabel as string),
  );

beforeAll(async () => {
  owner = await createUser("pricing-owner@example.com");
  viewer = await createUser("pricing-viewer@example.com");
  stranger = await createUser("pricing-stranger@example.com");
  await asService(async (q) => {
    await q.query(
      `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'viewer', 'active', now())`,
      [owner.id, viewer.id, viewer.email],
    );
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, status)
       values ($1, 'Stoneware vase', 2500, 'active') returning id`,
      [owner.id],
    );
    productId = rows[0].id as string;
  });
});

afterAll(closePool);

describe("the vocabulary", () => {
  it("has each Postgres enum match its TypeScript list, in order", async () => {
    expect(await enumLabels("plan_id")).toEqual([...PLAN_IDS]);
    expect(await enumLabels("fee_entry_kind")).toEqual([...FEE_ENTRY_KINDS]);
    expect(await enumLabels("feature_key")).toEqual([...FEATURE_KEYS]);
  });

  it("lists the three plans, cheapest first", async () => {
    const { rows } = await asSuper((q) => q.query(`select id::text, name from public.plans order by sort_order`));
    expect(rows).toEqual([
      { id: "free", name: "Free" },
      { id: "starter", name: "Starter" },
      { id: "pro", name: "Pro" },
    ]);
  });
});

describe("the seed", () => {
  it("is PLAN_PRICE_SEED, number for number", async () => {
    const { rows } = await asSuper((q) =>
      q.query(
        `select p.plan_id::text as "planId", p.version, p.billing_interval as interval,
                p.price_cents as "priceCents", p.list_price_cents as "listPriceCents", p.currency,
                p.direct_fee_bps as "directFeeBps", p.marketplace_fee_bps as "marketplaceFeeBps",
                p.stripe_lookup_key as "stripeLookupKey", p.effective_from, p.effective_to
           from public.plan_prices p join public.plans pl on pl.id = p.plan_id
          where p.version = 1
          order by pl.sort_order, p.billing_interval`,
      ),
    );
    expect(
      rows.map(({ effective_from, effective_to, ...row }) => ({
        ...row,
        effectiveFrom: Date.parse((effective_from as Date).toISOString()),
        effectiveTo: effective_to,
      })),
    ).toEqual(
      PLAN_PRICE_SEED.map((price) => ({ ...price, effectiveFrom: Date.parse(price.effectiveFrom) })),
    );
  });

  it("is ENTITLEMENT_SEED, feature for feature", async () => {
    const { rows } = await asSuper((q) =>
      q.query(`select plan_id::text as plan, feature::text as feature from public.plan_entitlements`),
    );
    for (const plan of PLAN_IDS) {
      const stored = rows.filter((row) => row.plan === plan).map((row) => row.feature as string);
      expect({ plan, features: stored.sort() }).toEqual({ plan, features: [...ENTITLEMENT_SEED[plan]].sort() });
    }
  });

  it("ships every switch off", async () => {
    const { rows } = await asSuper((q) =>
      q.query(`select plan_limits_enforced, fees_enabled, entitlements_enforced from public.billing_switches`),
    );
    expect(rows).toEqual([{ plan_limits_enforced: false, fees_enabled: false, entitlements_enforced: false }]);
  });
});

describe("plan_prices is append-only", () => {
  it("refuses an edit of a row in force, and its deletion", async () => {
    await refused(
      asSuper((q) => q.query(`update public.plan_prices set direct_fee_bps = 0 where plan_id = 'pro' and version = 1`)),
      /never edited/,
    );
    await refused(
      asSuper((q) => q.query(`delete from public.plan_prices where plan_id = 'pro' and version = 1`)),
      /never deleted/,
    );
  });

  it("refuses a second open row for the same plan and interval", async () => {
    await refused(
      asSuper((q) =>
        q.query(
          `insert into public.plan_prices (plan_id, version, price_cents, direct_fee_bps, marketplace_fee_bps, stripe_lookup_key)
           values ('pro', 99, 4900, 50, 600, 'pro_month_eur_v99')`,
        ),
      ),
      /plan_prices_one_open_idx/,
    );
  });

  it("refuses a Free plan with a price, a paid plan without one, and a rate over a whole", async () => {
    const insert = (values: string) =>
      asSuper((q) =>
        q.query(
          `insert into public.plan_prices (plan_id, version, billing_interval, price_cents, direct_fee_bps,
                                           marketplace_fee_bps, stripe_lookup_key, effective_from, effective_to)
           values (${values}, '2020-01-01', '2020-02-01')`,
        ),
      );
    await refused(insert(`'free', 50, 'month', 500, 500, 800, null`), /plan_prices_free_or_billable/);
    await refused(insert(`'starter', 50, 'month', 0, 200, 700, 'starter_month_eur_v50'`), /plan_prices_free_or_billable/);
    await refused(insert(`'starter', 50, 'month', 1200, 200, 700, null`), /plan_prices_free_or_billable/);
    await refused(insert(`'starter', 50, 'month', 1200, 10001, 700, 'starter_month_eur_v50'`), /plan_prices_direct_fee_range/);
    await refused(insert(`'starter', 50, 'week', 1200, 200, 700, 'starter_week_eur_v50'`), /plan_prices_interval_check/);
  });

  it("changes a fee by closing the open row and opening the next, keeping the Stripe price", async () => {
    // Inside a transaction that is rolled back: the seed stays as it was for
    // every other test in the file.
    await asSuper(async (q) => {
      await q.query("begin");
      try {
        const at = "2031-01-01T00:00:00Z";
        const { rows } = await q.query(
          `select version, price_cents, direct_fee_bps, stripe_lookup_key, effective_to
             from public.plan_price_change('starter', 1200, 150, 700, 'month', null, $1)`,
          [at],
        );
        expect(rows[0]).toMatchObject({
          version: 2,
          price_cents: 1200,
          direct_fee_bps: 150,
          // The subscription price did not move, so the same Stripe Price bills it.
          stripe_lookup_key: "starter_month_eur_v1",
          effective_to: null,
        });
        const closed = await q.query(
          `select effective_to from public.plan_prices where plan_id = 'starter' and version = 1`,
        );
        expect((closed.rows[0].effective_to as Date).toISOString()).toBe("2031-01-01T00:00:00.000Z");
        // In force today: still the first row. From 2031: the second.
        const inForce = (when: string) =>
          q.query(
            `select version from public.plan_prices
              where plan_id = 'starter' and effective_from <= $1::timestamptz
                and (effective_to is null or effective_to > $1::timestamptz)`,
            [when],
          );
        expect((await inForce("2030-06-01T00:00:00Z")).rows).toEqual([{ version: 1 }]);
        expect((await inForce(at)).rows).toEqual([{ version: 2 }]);

        // A new PRICE needs a new Stripe Price, under a new key.
        const priced = await q.query(
          `select version, stripe_lookup_key from public.plan_price_change('starter', 1500, 150, 700, 'month', null, '2032-01-01T00:00:00Z')`,
        );
        expect(priced.rows[0]).toEqual({ version: 3, stripe_lookup_key: "starter_month_eur_v3" });

        // A change dated before the open row is not a change.
        await q.query("savepoint backwards");
        await expect(
          q.query(`select public.plan_price_change('starter', 1500, 150, 700, 'month', null, '2031-06-01T00:00:00Z')`),
        ).rejects.toThrow(/must start after/);
        await q.query("rollback to savepoint backwards");

        // A scheduled row that never came into force may be called off.
        await q.query(`delete from public.plan_prices where plan_id = 'starter' and version = 3`);
      } finally {
        await q.query("rollback");
      }
    });
    const { rows } = await asSuper((q) =>
      q.query(`select count(*)::int as n from public.plan_prices where plan_id = 'starter'`),
    );
    expect(rows[0].n).toBe(1);
  });

  it("opens yearly billing with a yearly row, under its own key", async () => {
    await asSuper(async (q) => {
      await q.query("begin");
      try {
        const { rows } = await q.query(
          `select version, billing_interval, stripe_lookup_key from public.plan_price_change('pro', 39000, 50, 600, 'year')`,
        );
        expect(rows[0]).toEqual({ version: 1, billing_interval: "year", stripe_lookup_key: "pro_year_eur_v1" });
      } finally {
        await q.query("rollback");
      }
    });
  });
});

describe("who may touch the config", () => {
  it("lets a signed-in user read plans, prices and entitlements, and write none of them", async () => {
    const counts = await asUser(stranger, async (q) => ({
      plans: (await q.query(`select count(*)::int as n from public.plans`)).rows[0].n,
      prices: (await q.query(`select count(*)::int as n from public.plan_prices`)).rows[0].n,
      entitlements: (await q.query(`select count(*)::int as n from public.plan_entitlements`)).rows[0].n,
    }));
    expect(counts).toEqual({ plans: 3, prices: 3, entitlements: 11 });

    await refused(
      asUser(stranger, (q) => q.query(`update public.plan_prices set effective_to = now() where plan_id = 'pro'`)),
      /permission denied/,
    );
    await refused(
      asUser(stranger, (q) =>
        q.query(`insert into public.plan_entitlements (plan_id, feature) values ('free', 'analytics')`),
      ),
      /permission denied/,
    );
    await refused(
      asUser(stranger, (q) => q.query(`select public.plan_price_change('pro', 100, 0, 0)`)),
      /permission denied/,
    );
  });

  it("shows a signed-out visitor nothing", async () => {
    for (const table of ["plans", "plan_prices", "plan_entitlements", "fee_ledger", "seller_fee_waivers"]) {
      await refused(asAnon((q) => q.query(`select 1 from public.${table}`)), /permission denied/);
    }
  });

  it("keeps waivers and switches out of every client's reach", async () => {
    await asService((q) =>
      q.query(`insert into public.seller_fee_waivers (owner_id) values ($1) on conflict do nothing`, [owner.id]),
    );
    await refused(asUser(owner, (q) => q.query(`select 1 from public.seller_fee_waivers`)), /permission denied/);
    await refused(
      asUser(stranger, (q) => q.query(`insert into public.seller_fee_waivers (owner_id) values ($1)`, [stranger.id])),
      /permission denied/,
    );
    await refused(
      asUser(owner, (q) => q.query(`update public.billing_switches set fees_enabled = false`)),
      /permission denied/,
    );
    await refused(
      asService((q) =>
        q.query(`insert into public.seller_fee_waivers (owner_id, reason) values ($1, 'friend of the house')`, [
          stranger.id,
        ]),
      ),
      /seller_fee_waivers_reason_check/,
    );
  });
});

describe("order_place and the whole fee", () => {
  it("writes the ad fee, the application fee and the cap flag", async () => {
    const orderId = await placeOrder({ platformFee: 200, adFee: 250, adRate: 1000 });
    const { rows } = await asSuper((q) =>
      q.query(
        `select platform_fee_cents, ad_rate_bps, ad_fee_cents, application_fee_cents, fee_capped
           from public.orders where id = $1`,
        [orderId],
      ),
    );
    expect(rows[0]).toEqual({
      platform_fee_cents: 200,
      ad_rate_bps: 1000,
      ad_fee_cents: 250,
      application_fee_cents: 450,
      fee_capped: false,
    });
  });

  it("still takes an order from the released app, which sends none of the new keys", async () => {
    const orderId = await asService(async (q) =>
      (
        await q.query(`select public.order_place($1::jsonb) as result`, [
          JSON.stringify({
            seller_id: owner.id,
            product_id: productId,
            channel: "direct",
            status: "paid",
            amount_cents: 2500,
            platform_fee_cents: 125,
            currency: "EUR",
            product_title: "Stoneware vase",
            product_price_cents: 2500,
            checkout_session_id: session(),
          }),
        ])
      ).rows[0].result.order_id as string,
    );
    const { rows } = await asSuper((q) =>
      q.query(`select ad_rate_bps, ad_fee_cents, application_fee_cents, fee_capped from public.orders where id = $1`, [
        orderId,
      ]),
    );
    expect(rows[0]).toEqual({ ad_rate_bps: null, ad_fee_cents: 0, application_fee_cents: null, fee_capped: false });
  });

  it("refuses fee parts that do not add up, and a fee larger than the sale", async () => {
    await refused(placeOrder({ platformFee: 200, adFee: 250, applicationFee: 400 }), /orders_application_fee_parts/);
    await refused(
      placeOrder({ amount: 100, platformFee: 200, applicationFee: 200 }),
      /orders_application_fee_range/,
    );
    await refused(placeOrder({ adRate: 0 }), /orders_ad_rate_bps_range/);
  });
});

describe("the fee ledger", () => {
  it("writes a row once per entry key, filed under the order's own seller and currency", async () => {
    const orderId = await placeOrder();
    expect(await record(orderId, "platform_fee", 125, `${orderId}:platform_fee`, "fee_1abc")).toBe(true);
    // The same payment event, delivered again.
    expect(await record(orderId, "platform_fee", 125, `${orderId}:platform_fee`, "fee_1abc")).toBe(false);

    const { rows } = await asSuper((q) =>
      q.query(
        `select seller_id, kind::text, amount_cents, currency, stripe_application_fee_id, livemode
           from public.fee_ledger where order_id = $1`,
        [orderId],
      ),
    );
    expect(rows).toEqual([
      {
        seller_id: owner.id,
        kind: "platform_fee",
        amount_cents: 125,
        currency: "EUR",
        stripe_application_fee_id: "fee_1abc",
        livemode: false,
      },
    ]);
  });

  it("holds a fee positive and a refund negative, and knows only its own kinds", async () => {
    const orderId = await placeOrder();
    await refused(record(orderId, "platform_fee", -125, `${orderId}:a`), /fee_ledger_amount_sign/);
    await refused(record(orderId, "platform_fee", 0, `${orderId}:b`), /fee_ledger_amount_sign/);
    await refused(record(orderId, "platform_fee_refund", 125, `${orderId}:c`), /fee_ledger_amount_sign/);
    await refused(record(orderId, "tip", 125, `${orderId}:d`), /invalid input value for enum/);
    await refused(record(randomUUID(), "platform_fee", 125, "nobody:platform_fee"), /no such order/);
  });

  it("can be neither edited nor emptied by the service role", async () => {
    const orderId = await placeOrder();
    await record(orderId, "platform_fee", 125, `${orderId}:platform_fee`);
    await refused(
      asService((q) => q.query(`update public.fee_ledger set amount_cents = 1 where order_id = $1`, [orderId])),
      /permission denied/,
    );
    await refused(
      asService((q) => q.query(`delete from public.fee_ledger where order_id = $1`, [orderId])),
      /permission denied/,
    );
    await refused(asService((q) => q.query(`truncate public.fee_ledger`)), /permission denied/);
  });

  it("is read by the store's owner and team, and by nobody else", async () => {
    const orderId = await placeOrder();
    await record(orderId, "platform_fee", 125, `${orderId}:platform_fee`);
    const seen = (user: TestUser) =>
      asUser(user, async (q) =>
        (await q.query(`select count(*)::int as n from public.fee_ledger where order_id = $1`, [orderId])).rows[0].n,
      );
    expect(await seen(owner)).toBe(1);
    expect(await seen(viewer)).toBe(1);
    expect(await seen(stranger)).toBe(0);

    await refused(
      asUser(owner, (q) =>
        q.query(`insert into public.fee_ledger (order_id, seller_id, kind, amount_cents, currency, entry_key)
                 values ($1, $2, 'platform_fee_refund', -125, 'EUR', 'forged')`, [orderId, owner.id]),
      ),
      /permission denied/,
    );
    await refused(
      asUser(owner, (q) =>
        q.query(`select public.fee_ledger_record($1, 'platform_fee_refund', -125, 'forged')`, [orderId]),
      ),
      /permission denied/,
    );
  });

  it("adds up what a store was charged and given back, for the caller's own store only", async () => {
    const seller = await createUser("pricing-summary@example.com");
    const first = await placeOrder({ seller, platformFee: 200, adFee: 250, adRate: 1000 });
    const second = await placeOrder({ seller });
    await record(first, "platform_fee", 200, `${first}:platform_fee`);
    await record(first, "ad_fee", 250, `${first}:ad_fee`);
    await record(second, "platform_fee", 125, `${second}:platform_fee`);
    await record(first, "platform_fee_refund", -40, `fr_1:platform_fee_refund`);
    await record(first, "ad_fee_refund", -50, `fr_1:ad_fee_refund`);

    const summary = (user: TestUser) =>
      asUser(user, async (q) =>
        (
          await q.query(
            `select currency, charged_cents::int, refunded_cents::int, net_cents::int
               from public.fee_ledger_summary($1, now() - interval '1 day', now() + interval '1 day')`,
            [seller.id],
          )
        ).rows,
      );
    expect(await summary(seller)).toEqual([{ currency: "EUR", charged_cents: 575, refunded_cents: 90, net_cents: 485 }]);
    // Another seller asking about this store adds up nothing.
    expect(await summary(stranger)).toEqual([]);
  });

  it("outlives the order and the account it was collected from", async () => {
    const seller = await createUser("pricing-leaving@example.com");
    const orderId = await placeOrder({ seller });
    await record(orderId, "platform_fee", 125, `${orderId}:platform_fee`);
    await asSuper((q) => q.query(`delete from public.orders where id = $1`, [orderId]));
    const { rows } = await asSuper((q) =>
      q.query(`select order_id, seller_id, amount_cents from public.fee_ledger where entry_key = $1`, [
        `${orderId}:platform_fee`,
      ]),
    );
    expect(rows).toEqual([{ order_id: null, seller_id: seller.id, amount_cents: 125 }]);
  });
});

describe("billing_sales_30d", () => {
  it("sums the whole amount paid, the marketplace's sales apart", async () => {
    const seller = await createUser("pricing-sales@example.com");
    await placeOrder({ seller, amount: 2500 });
    await placeOrder({ seller, amount: 4000, platformFee: 200 });
    const marketplaceOrder = await placeOrder({ seller, amount: 1000, platformFee: 80 });
    const refunded = await placeOrder({ seller, amount: 9900 });
    await asSuper(async (q) => {
      await q.query(`update public.orders set channel = 'marketplace' where id = $1`, [marketplaceOrder]);
      await q.query(`update public.orders set status = 'refunded' where id = $1`, [refunded]);
    });
    const { rows } = await asService((q) =>
      q.query(
        `select direct_cents::int, marketplace_cents::int, sales, fees_cents::int from public.billing_sales_30d($1)`,
        [seller.id],
      ),
    );
    expect(rows[0]).toEqual({ direct_cents: 6500, marketplace_cents: 1000, sales: 3, fees_cents: 405 });
    await refused(asUser(seller, (q) => q.query(`select * from public.billing_sales_30d($1)`, [seller.id])), /permission denied/);
  });
});
