/**
 * Seller plans (20260930_seller_plans), against the replayed schema.
 *
 * What is proven here:
 *   - the SQL limit table is the TS catalog, number for number;
 *   - the plan an account is on is decided by paid_until alone;
 *   - no client role can read or write the billing tables, or call the
 *     service-only functions;
 *   - the webhook's snapshot write only ever moves forward in time;
 *   - the storefront, team-seat and product limits hold for a direct insert by
 *     a signed-in client (owner or teammate), lift with a paid plan, and never
 *     apply to the trusted service role; the product limit holds for a batch
 *     insert too, and never removes or blocks editing what a store already has;
 *   - the calculator's sales summary counts exactly what the fee is charged on,
 *     and only for someone allowed to read the orders;
 *   - the order snapshot columns, the permission and the notification type.
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
import { PLANS, PLAN_IDS, PLAN_LIMIT_KEYS } from "../../src/lib/billing/plans";
import { PRICING_SOURCES } from "../../src/lib/billing/paths";

const email = (label: string) => `${label}-${randomUUID().slice(0, 6)}@test.squareshare.to`;

/** A billing row as the webhook would leave it: `plan` paid until `paidUntil`. */
async function setPlan(user: TestUser, plan: "starter" | "pro" | null, paidUntil: string | null) {
  await asSuper((q) =>
    q.query(
      `insert into public.seller_billing (owner_id, stripe_customer_id, plan, status, paid_until)
       values ($1, $2, $3, $4, $5)
       on conflict (owner_id) do update
         set plan = excluded.plan, status = excluded.status, paid_until = excluded.paid_until`,
      [user.id, `cus_${user.id.replace(/-/g, "")}`, plan, plan ? "active" : "none", paidUntil],
    ),
  );
}

const accountPlan = (user: TestUser) =>
  asService(async (q) =>
    (await q.query(`select public.account_plan($1) as plan`, [user.id])).rows[0].plan as string,
  );

const FUTURE = "2999-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";

/** The launch switch (billing_switches), which ships off. */
const setLimitsEnforced = (on: boolean) =>
  asSuper((q) => q.query(`update public.billing_switches set plan_limits_enforced = $1`, [on]));

afterAll(async () => {
  // Other files share this database; leave the switch as the migration ships it.
  await setLimitsEnforced(false);
  await closePool();
});

describe("the limits launch switch", () => {
  let seller: TestUser;
  beforeAll(async () => {
    seller = await createUser(email("switch"));
  });

  it("ships off, so nothing is refused before paid plans are on sale", async () => {
    const [row] = await asSuper(async (q) => (await q.query(`select * from public.billing_switches`)).rows);
    expect(row.plan_limits_enforced).toBe(false);
    const cap = PLANS.free.limits.storefronts as number;
    for (let i = 0; i <= cap; i += 1) {
      await asUser(seller, (q) =>
        q.query(`insert into public.storefronts (owner_id, name) values ($1, $2)`, [seller.id, `Shop ${i}`]),
      );
    }
  });

  it("is closed to every client role", async () => {
    const attempt = asUser(seller, (q) => q.query(`update public.billing_switches set plan_limits_enforced = false`));
    expect(await expectDbError(attempt)).toMatch(/permission denied/);
  });
});

describe("plan_limit mirrors the catalog", () => {
  it("agrees with PLANS for every plan and key", async () => {
    for (const plan of PLAN_IDS) {
      for (const key of PLAN_LIMIT_KEYS) {
        const sql = await asSuper(async (q) =>
          (await q.query(`select public.plan_limit($1, $2) as cap`, [plan, key])).rows[0].cap,
        );
        expect({ plan, key, cap: sql }).toEqual({ plan, key, cap: PLANS[plan].limits[key] });
      }
    }
  });
});

describe("account_plan: the plan in force", () => {
  let seller: TestUser;
  beforeAll(async () => {
    seller = await createUser(email("plan"));
  });

  it("is Free with no billing row", async () => {
    expect(await accountPlan(seller)).toBe("free");
  });

  it("is the paid plan until paid_until, and Free after", async () => {
    await setPlan(seller, "pro", FUTURE);
    expect(await accountPlan(seller)).toBe("pro");
    await setPlan(seller, "pro", PAST);
    expect(await accountPlan(seller)).toBe("free");
  });

  it("is Free for a customer who never subscribed", async () => {
    await setPlan(seller, null, null);
    expect(await accountPlan(seller)).toBe("free");
  });
});

describe("the billing tables are closed to every client role", () => {
  let seller: TestUser;
  beforeAll(async () => {
    seller = await createUser(email("closed"));
    await setPlan(seller, "starter", FUTURE);
  });

  for (const table of ["seller_billing", "stripe_events", "seller_funnel_events"]) {
    it(`${table}: no read for anon or the owner`, async () => {
      expect(await expectDbError(asAnon((q) => q.query(`select * from public.${table}`)))).toMatch(
        /permission denied/,
      );
      expect(
        await expectDbError(asUser(seller, (q) => q.query(`select * from public.${table}`))),
      ).toMatch(/permission denied/);
    });
  }

  it("an owner cannot write their own plan", async () => {
    const attempt = asUser(seller, (q) =>
      q.query(`update public.seller_billing set plan = 'pro', paid_until = $2 where owner_id = $1`, [
        seller.id,
        FUTURE,
      ]),
    );
    expect(await expectDbError(attempt)).toMatch(/permission denied/);
  });

  it("an owner cannot call the service-only functions", async () => {
    expect(
      await expectDbError(
        asUser(seller, (q) => q.query(`select public.account_plan($1)`, [seller.id])),
      ),
    ).toMatch(/permission denied/);
    expect(
      await expectDbError(
        asUser(seller, (q) =>
          q.query(
            `select * from public.billing_apply_snapshot($1, 'cus_x', null, 'pro', 'month', 'active',
               4000, 'EUR', now(), false, null, $2, false, now())`,
            [seller.id, FUTURE],
          ),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("billing_apply_snapshot", () => {
  let seller: TestUser;
  beforeAll(async () => {
    seller = await createUser(email("snap"));
  });

  const apply = (plan: string, syncedAt: string) =>
    asService(async (q) =>
      (
        await q.query(
          `select * from public.billing_apply_snapshot($1, $2, 'sub_1', $3, 'month', 'active',
             4000, 'EUR', $4, false, null, $4, false, $5)`,
          [seller.id, `cus_${seller.id.replace(/-/g, "")}`, plan, FUTURE, syncedAt],
        )
      ).rows[0] as { applied: boolean; previous_plan: string | null },
  );

  it("creates the row, then reports the plan it replaced", async () => {
    expect(await apply("starter", "2026-09-30T10:00:00Z")).toEqual(
      expect.objectContaining({ applied: true, previous_plan: null }),
    );
    expect(await apply("pro", "2026-09-30T11:00:00Z")).toEqual(
      expect.objectContaining({ applied: true, previous_plan: "starter" }),
    );
    expect(await accountPlan(seller)).toBe("pro");
  });

  it("ignores a snapshot older than the one it holds", async () => {
    expect(await apply("starter", "2026-09-30T10:30:00Z")).toEqual(
      expect.objectContaining({ applied: false, previous_plan: "pro" }),
    );
    expect(await accountPlan(seller)).toBe("pro");
  });
});

describe("the storefront limit", () => {
  let owner: TestUser;
  let editor: TestUser;
  const cap = PLANS.free.limits.storefronts as number;

  const create = (user: TestUser, name: string) =>
    asUser(user, (q) =>
      q.query(`insert into public.storefronts (owner_id, name) values ($1, $2)`, [owner.id, name]),
    );

  beforeAll(async () => {
    await setLimitsEnforced(true);
    owner = await createUser(email("sf-owner"));
    editor = await createUser(email("sf-editor"));
    await asService((q) =>
      q.query(
        `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
         values ($1, $2, $3, 'editor', 'active', now())`,
        [owner.id, editor.id, editor.email],
      ),
    );
    // Free's seat limit would refuse the editor above for a client; the
    // service role is trusted, which is how fixtures and support work.
  });

  it(`lets a Free account create ${cap}, and refuses one more`, async () => {
    for (let i = 1; i <= cap; i += 1) await create(owner, `Shop ${i}`);
    expect(await expectDbError(create(owner, "One too many"))).toMatch(/plan_limit_reached:storefronts/);
  });

  it("holds for a teammate creating in the owner's store too", async () => {
    expect(await expectDbError(create(editor, "Editor's extra"))).toMatch(
      /plan_limit_reached:storefronts/,
    );
  });

  it("counts a storefront moved INTO a full account", async () => {
    // The editor may write the owner's store, so RLS lets them move their own
    // storefront into it; the limit is what has to stop that.
    const moved = await asUser(editor, async (q) =>
      (
        await q.query(`insert into public.storefronts (owner_id, name) values ($1, 'Mine') returning id`, [
          editor.id,
        ])
      ).rows[0].id as string,
    );
    const attempt = asUser(editor, (q) =>
      q.query(`update public.storefronts set owner_id = $1 where id = $2`, [owner.id, moved]),
    );
    expect(await expectDbError(attempt)).toMatch(/plan_limit_reached:storefronts/);
  });

  it("never limits the service role", async () => {
    await asService((q) =>
      q.query(`insert into public.storefronts (owner_id, name) values ($1, 'Seeded')`, [owner.id]),
    );
  });

  it("lifts on a paid plan, and comes back when it ends", async () => {
    await setPlan(owner, "pro", FUTURE);
    await create(owner, "On Pro");
    await setPlan(owner, "pro", PAST);
    expect(await expectDbError(create(owner, "After Pro"))).toMatch(/plan_limit_reached:storefronts/);
  });
});

describe("the team-seat limit", () => {
  let owner: TestUser;
  const seats = PLANS.free.limits.teamSeats as number;

  const invite = (address: string) =>
    asUser(owner, (q) =>
      q.query(
        `insert into public.team_members (account_owner_id, invited_email, role, status)
         values ($1, $2, 'viewer', 'invited')`,
        [owner.id, address],
      ),
    );

  beforeAll(async () => {
    await setLimitsEnforced(true);
    owner = await createUser(email("seat-owner"));
  });

  it(`counts the owner, so a Free account can invite ${seats - 1} more`, async () => {
    for (let i = 1; i < seats; i += 1) await invite(email(`invitee${i}`));
    expect(await expectDbError(invite(email("one-more")))).toMatch(/plan_limit_reached:teamSeats/);
  });

  it("counts reviving a revoked seat as a new one", async () => {
    const revoked = email("revoked");
    await asService((q) =>
      q.query(
        `insert into public.team_members (account_owner_id, invited_email, role, status)
         values ($1, $2, 'viewer', 'revoked')`,
        [owner.id, revoked],
      ),
    );
    const revive = asUser(owner, (q) =>
      q.query(
        `update public.team_members set status = 'invited'
          where account_owner_id = $1 and invited_email = $2`,
        [owner.id, revoked],
      ),
    );
    const outcome = await revive.then(
      () => "allowed",
      (err: Error) => err.message,
    );
    // Either RLS forbids the update outright or the limit refuses it; what
    // must never happen is a revived seat past the limit.
    expect(outcome).not.toBe("allowed");
  });
});

describe("the product limit (20261002_product_limits)", () => {
  let owner: TestUser;
  const cap = PLANS.free.limits.products as number;

  /** `count` products in ONE statement, as the CSV import writes them. */
  const createBatch = (user: TestUser, count: number, label: string) =>
    asUser(user, (q) =>
      q.query(
        `insert into public.products (owner_id, title, price_cents)
         select $1, $2 || ' ' || n, 100 from generate_series(1, $3::int) as n`,
        [owner.id, label, count],
      ),
    );

  const countProducts = () =>
    asSuper(async (q) =>
      Number((await q.query(`select count(*) from public.products where owner_id = $1`, [owner.id])).rows[0].count),
    );

  beforeAll(async () => {
    await setLimitsEnforced(true);
    owner = await createUser(email("product-owner"));
  });

  it(`lets a Free account hold ${cap}, and refuses one more`, async () => {
    await createBatch(owner, cap, "Product");
    expect(await expectDbError(createBatch(owner, 1, "One too many"))).toMatch(/plan_limit_reached:products/);
    expect(await countProducts()).toBe(cap);
  });

  it("refuses a whole batch that would cross the cap, writing none of it", async () => {
    const other = await createUser(email("product-batch"));
    const insert = asUser(other, (q) =>
      q.query(
        `insert into public.products (owner_id, title, price_cents)
         select $1, 'Row ' || n, 100 from generate_series(1, $2::int) as n`,
        [other.id, cap + 3],
      ),
    );
    expect(await expectDbError(insert)).toMatch(/plan_limit_reached:products/);
    const written = await asSuper(async (q) =>
      Number((await q.query(`select count(*) from public.products where owner_id = $1`, [other.id])).rows[0].count),
    );
    expect(written).toBe(0);
  });

  it("never touches a product that already exists: editing one at the cap still works", async () => {
    await asUser(owner, (q) =>
      q.query(`update public.products set title = 'Renamed' where owner_id = $1 and title = 'Product 1'`, [owner.id]),
    );
    expect(await countProducts()).toBe(cap);
  });

  it("never limits the service role", async () => {
    await asService((q) =>
      q.query(`insert into public.products (owner_id, title, price_cents) values ($1, 'Seeded', 100)`, [owner.id]),
    );
    expect(await countProducts()).toBe(cap + 1);
  });

  it("makes room again when one is deleted, and lifts on a bigger plan up to ITS cap", async () => {
    // Over the cap by one (the seeded row): deleting one is not enough room.
    await asUser(owner, (q) => q.query(`delete from public.products where owner_id = $1 and title = 'Seeded'`, [owner.id]));
    expect(await expectDbError(createBatch(owner, 1, "Still full"))).toMatch(/plan_limit_reached:products/);
    await asUser(owner, (q) =>
      q.query(`delete from public.products where owner_id = $1 and title = 'Renamed'`, [owner.id]),
    );
    await createBatch(owner, 1, "Room again");

    await setPlan(owner, "starter", FUTURE);
    const starterCap = PLANS.starter.limits.products as number;
    await createBatch(owner, starterCap - cap, "On Starter");
    expect(await expectDbError(createBatch(owner, 1, "Past Starter"))).toMatch(/plan_limit_reached:products/);

    // Back on Free and far over its cap: nothing is removed, nothing can be added.
    await setPlan(owner, "starter", PAST);
    expect(await countProducts()).toBe(starterCap);
    expect(await expectDbError(createBatch(owner, 1, "After Starter"))).toMatch(/plan_limit_reached:products/);
  });

  it("is off with the launch switch, like the other limits", async () => {
    await setLimitsEnforced(false);
    await createBatch(owner, 1, "Switch off");
    await setLimitsEnforced(true);
  });
});

describe("the funnel's entry points mirror PRICING_SOURCES", () => {
  const record = (accountId: string, source: string) =>
    asService((q) =>
      q.query(`insert into public.seller_funnel_events (account_id, kind, source) values ($1, 'pricing_viewed', $2)`, [
        accountId,
        source,
      ]),
    );

  it("accepts every source the app can send, and nothing else", async () => {
    // A source missing from the CHECK makes its funnel insert fail silently
    // (recording is best-effort), so the two lists are compared here.
    const seller = await createUser(email("funnel"));
    for (const source of PRICING_SOURCES) await record(seller.id, source);
    expect(await expectDbError(record(seller.id, "made_up_source"))).toMatch(/seller_funnel_events_source_check/);
  });
});

describe("billing_sales_summary", () => {
  let seller: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    seller = await createUser(email("sales"));
    stranger = await createUser(email("sales-stranger"));
    await asService((q) =>
      q.query(
        `insert into public.orders (seller_id, channel, status, amount_cents, platform_fee_cents, currency,
                                    product_title, product_price_cents, quantity, created_at)
         values ($1, 'direct', 'paid',     2900, 100, 'EUR', 'Mug', 1000, 2, now() - interval '1 day'),
                ($1, 'direct', 'paid',     1500,  50, 'EUR', 'Pin',  500, 3, now() - interval '40 days'),
                ($1, 'direct', 'refunded', 1000,  50, 'EUR', 'Cap', 1000, 1, now() - interval '2 days'),
                ($1, 'direct', 'paid',     1000,  50, 'USD', 'Hat', 1000, 1, now() - interval '2 days')`,
        [seller.id],
      ),
    );
  });

  it("sums the item subtotal of paid EUR sales in the last 30 days", async () => {
    const row = await asService(async (q) =>
      (await q.query(`select * from public.billing_sales_summary($1)`, [seller.id])).rows[0],
    );
    expect(row).toEqual({ subtotal_cents: "2000", sales: 1, fees_cents: "100" });
  });

  it("is not callable by any client, the seller included", async () => {
    for (const user of [seller, stranger]) {
      const attempt = asUser(user, (q) => q.query(`select * from public.billing_sales_summary($1)`, [seller.id]));
      expect(await expectDbError(attempt)).toMatch(/permission denied/);
    }
  });
});

describe("order snapshot columns", () => {
  let seller: TestUser;
  beforeAll(async () => {
    seller = await createUser(email("snapcols"));
  });

  const insert = (columns: string, values: string) =>
    asService((q) =>
      q.query(
        `insert into public.orders (seller_id, channel, amount_cents, product_title, product_price_cents${columns})
         values ($1, 'direct', 1000, 'x', 1000${values})`,
        [seller.id],
      ),
    );

  it("accepts a full snapshot", async () => {
    await insert(", platform_fee_bps, seller_plan, shipping_cents", ", 300, 'starter', 200");
  });

  it("refuses a rate above the whole sale", async () => {
    expect(await expectDbError(insert(", platform_fee_bps", ", 10001"))).toMatch(
      /orders_platform_fee_bps_range/,
    );
  });

  it("refuses an unknown plan", async () => {
    expect(await expectDbError(insert(", seller_plan", ", 'enterprise'"))).toMatch(
      /orders_seller_plan_check/,
    );
  });

  it("refuses delivery worth more than the order", async () => {
    expect(await expectDbError(insert(", shipping_cents", ", 1001"))).toMatch(
      /orders_shipping_cents_range/,
    );
  });
});

describe("permission and notification type", () => {
  it("grants billing.manage to owners only", async () => {
    const can = await asSuper(async (q) =>
      (
        await q.query(
          `select public.team_role_can('owner', 'billing.manage') o,
                  public.team_role_can('editor', 'billing.manage') e,
                  public.team_role_can('viewer', 'billing.manage') v`,
        )
      ).rows[0],
    );
    expect(can).toEqual({ o: true, e: false, v: false });
  });

  it("accepts a billing notification", async () => {
    const user = await createUser(email("notify"));
    await asService((q) =>
      q.query(
        `insert into public.notifications (user_id, type, title, body) values ($1, 'billing', 't', 'b')`,
        [user.id],
      ),
    );
  });
});
