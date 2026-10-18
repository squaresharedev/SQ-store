/**
 * Order lifecycle (20261008_order_lifecycle), against the replayed schema.
 *
 * What is proven here is what the migration promises and nothing in TypeScript
 * could hold on its own:
 *
 *   - order_place is ATOMIC and IDEMPOTENT: an order and its stock happen
 *     together or not at all, two buyers cannot both have the last unit, and a
 *     repeated checkout takes nothing twice;
 *   - an unpaid order gives its stock back when it is abandoned, and only an
 *     order that was really a reservation is ever swept;
 *   - order_refund is the seller's second write, behind every gate a policy
 *     would have applied, and stock comes back at most once.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asSuper,
  asUser,
  asUserWithClaims,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let stranger: TestUser;

/** A product of the owner's, tracking stock unless told otherwise. */
async function seedProduct(stock: number | null, threshold = 2): Promise<string> {
  return asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, status, track_stock, stock_quantity, low_stock_threshold)
       values ($1, 'Stoneware vase', 2400, 'active', $2, $3, $4) returning id`,
      [owner.id, stock !== null, stock, threshold],
    );
    return rows[0].id as string;
  });
}

const session = () => `cs_test_${randomUUID().replace(/-/g, "")}`;

type Place = {
  productId: string | null;
  quantity?: number;
  status?: "paid" | "pending";
  checkoutSessionId?: string;
  pendingExpiresAt?: string;
  seller?: TestUser;
};

/** The row the order writer sends, as JSON. */
function orderJson(place: Place): string {
  return JSON.stringify({
    seller_id: (place.seller ?? owner).id,
    product_id: place.productId,
    channel: "direct",
    status: place.status ?? "paid",
    amount_cents: 2400 * (place.quantity ?? 1),
    platform_fee_cents: 120,
    currency: "EUR",
    buyer_email: "buyer@example.com",
    product_title: "Stoneware vase",
    product_price_cents: 2400,
    quantity: place.quantity ?? 1,
    fulfilment_status: "unfulfilled",
    checkout_session_id: place.checkoutSessionId ?? session(),
    ...(place.pendingExpiresAt ? { pending_expires_at: place.pendingExpiresAt } : {}),
  });
}

type Placed = { order_id: string; duplicate: boolean; stock_left: number | null; low_stock: boolean };

const place = (input: Place) =>
  asService(async (q) =>
    (await q.query(`select public.order_place($1::jsonb) as result`, [orderJson(input)])).rows[0]
      .result as Placed,
  );

const stockOf = (productId: string) =>
  asSuper(async (q) =>
    (await q.query(`select stock_quantity from public.products where id = $1`, [productId])).rows[0]
      .stock_quantity as number | null,
  );

const orderOf = (orderId: string) =>
  asSuper(async (q) =>
    (
      await q.query(
        `select status, stock_reserved, refunded_at, refund_reason, pending_expires_at, payment_ref
           from public.orders where id = $1`,
        [orderId],
      )
    ).rows[0] as
      | {
          status: string;
          stock_reserved: number;
          refunded_at: Date | null;
          refund_reason: string | null;
          pending_expires_at: Date | null;
          payment_ref: string | null;
        }
      | undefined,
  );

const ordersFor = (checkoutSessionId: string) =>
  asSuper(async (q) =>
    (
      await q.query(`select count(*)::int as n from public.orders where checkout_session_id = $1`, [
        checkoutSessionId,
      ])
    ).rows[0].n as number,
  );

const refund = (user: TestUser, orderId: string, reason = "cancelled", restock = false) =>
  asUser(user, async (q) =>
    (await q.query(`select public.order_refund($1, $2, $3) as outcome`, [orderId, reason, restock]))
      .rows[0].outcome as string,
  );

beforeAll(async () => {
  owner = await createUser(`owner-life-${randomUUID().slice(0, 6)}@test.squareshare.to`);
  editor = await createUser(`editor-life-${randomUUID().slice(0, 6)}@test.squareshare.to`);
  viewer = await createUser(`viewer-life-${randomUUID().slice(0, 6)}@test.squareshare.to`);
  stranger = await createUser(`stranger-life-${randomUUID().slice(0, 6)}@test.squareshare.to`);
  await asService((q) =>
    q.query(
      `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'editor', 'active', now()), ($1, $4, $5, 'viewer', 'active', now())`,
      [owner.id, editor.id, editor.email, viewer.id, viewer.email],
    ),
  );
});

afterAll(closePool);

describe("the permission mirror", () => {
  it("grants orders.refund to the owner alone", async () => {
    const can = await asSuper(async (q) =>
      (
        await q.query(
          `select public.team_role_can('owner', 'orders.refund') o,
                  public.team_role_can('editor', 'orders.refund') e,
                  public.team_role_can('viewer', 'orders.refund') v`,
        )
      ).rows[0],
    );
    expect(can).toEqual({ o: true, e: false, v: false });
  });
});

describe("order_place", () => {
  it("writes the order and takes its stock together", async () => {
    const product = await seedProduct(9);
    const result = await place({ productId: product, quantity: 2 });

    expect(result.duplicate).toBe(false);
    expect(result.stock_left).toBe(7);
    expect(result.low_stock).toBe(false);
    expect(await stockOf(product)).toBe(7);
    expect(await orderOf(result.order_id)).toMatchObject({ status: "paid", stock_reserved: 2 });
  });

  it("says when what is left has reached the low-stock threshold", async () => {
    const product = await seedProduct(3, 2);
    expect((await place({ productId: product })).low_stock).toBe(true);
  });

  it("refuses when there are too few, and leaves no order behind", async () => {
    const product = await seedProduct(1);
    const checkoutSessionId = session();
    expect(
      await expectDbError(place({ productId: product, quantity: 2, checkoutSessionId })),
    ).toMatch(/insufficient_stock/);
    expect(await stockOf(product)).toBe(1);
    expect(await ordersFor(checkoutSessionId)).toBe(0);
  });

  it("gives the last unit to exactly one of two buyers who ask at once", async () => {
    const product = await seedProduct(1);
    const outcomes = await Promise.allSettled([
      place({ productId: product }),
      place({ productId: product }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(await stockOf(product)).toBe(0);
  });

  it("answers a repeated checkout with its order, and takes nothing twice", async () => {
    const product = await seedProduct(5);
    const checkoutSessionId = session();
    const first = await place({ productId: product, checkoutSessionId });
    const again = await place({ productId: product, checkoutSessionId });

    expect(again).toEqual({ order_id: first.order_id, duplicate: true });
    expect(await stockOf(product)).toBe(4);
    expect(await ordersFor(checkoutSessionId)).toBe(1);
  });

  it("leaves an untracked product's stock alone, and reserves nothing", async () => {
    const product = await seedProduct(null);
    const result = await place({ productId: product, quantity: 3 });
    expect(result.stock_left).toBeNull();
    expect(await stockOf(product)).toBeNull();
    expect((await orderOf(result.order_id))?.stock_reserved).toBe(0);
  });

  it("keeps a waiting time only on an order that is waiting", async () => {
    const product = await seedProduct(5);
    const expires = new Date(Date.now() + 30 * 60_000).toISOString();
    const pending = await place({ productId: product, status: "pending", pendingExpiresAt: expires });
    const paid = await place({ productId: product, status: "paid", pendingExpiresAt: expires });
    expect((await orderOf(pending.order_id))?.pending_expires_at).not.toBeNull();
    expect((await orderOf(paid.order_id))?.pending_expires_at).toBeNull();
  });

  it("refuses a status it is not the writer of, and an order with no checkout", async () => {
    const product = await seedProduct(5);
    expect(
      await expectDbError(
        asService((q) =>
          q.query(`select public.order_place($1::jsonb)`, [
            orderJson({ productId: product }).replace('"paid"', '"refunded"'),
          ]),
        ),
      ),
    ).toMatch(/status must be paid or pending/);
    expect(
      await expectDbError(
        asService((q) =>
          q.query(`select public.order_place(($1::jsonb) - 'checkout_session_id')`, [
            orderJson({ productId: product }),
          ]),
        ),
      ),
    ).toMatch(/checkout_session_id is required/);
    expect(await stockOf(product)).toBe(5);
  });

  it("belongs to the server: no seller session and no visitor can call it", async () => {
    const product = await seedProduct(5);
    const call = (q: { query: (sql: string, values: unknown[]) => Promise<unknown> }) =>
      q.query(`select public.order_place($1::jsonb)`, [orderJson({ productId: product })]);
    expect(await expectDbError(asUser(owner, call))).toMatch(/permission denied/);
    expect(await expectDbError(asAnon(call))).toMatch(/permission denied/);
    expect(await stockOf(product)).toBe(5);
  });
});

describe("a payment confirmed", () => {
  const confirm = (checkoutSessionId: string, ref: string | null = null) =>
    asService(async (q) =>
      (await q.query(`select public.order_confirm_paid($1, $2) as result`, [checkoutSessionId, ref]))
        .rows[0].result as { order_id: string | null; changed: boolean; status?: string },
    );

  it("turns the waiting order into a paid one, once", async () => {
    const product = await seedProduct(5);
    const checkoutSessionId = session();
    const placed = await place({
      productId: product,
      status: "pending",
      checkoutSessionId,
      pendingExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });

    expect(await confirm(checkoutSessionId, "pi_3Example")).toEqual({
      order_id: placed.order_id,
      changed: true,
    });
    expect(await orderOf(placed.order_id)).toMatchObject({
      status: "paid",
      pending_expires_at: null,
      payment_ref: "pi_3Example",
    });
    // A second delivery of the same event changes nothing and still names the order.
    expect(await confirm(checkoutSessionId, "pi_3Example")).toMatchObject({
      order_id: placed.order_id,
      changed: false,
      status: "paid",
    });
    // The stock was taken when the order was placed, not when it was paid for.
    expect(await stockOf(product)).toBe(4);
  });

  it("names no order when there is none to confirm", async () => {
    expect(await confirm(session())).toMatchObject({ order_id: null, changed: false });
  });
});

describe("an unpaid order abandoned", () => {
  const release = (checkoutSessionId: string) =>
    asService(async (q) =>
      (await q.query(`select public.order_release_pending($1) as released`, [checkoutSessionId]))
        .rows[0].released as boolean,
    );
  const sweep = (now: Date) =>
    asService(async (q) =>
      (await q.query(`select public.orders_release_expired($1) as n`, [now.toISOString()])).rows[0]
        .n as number,
    );

  it("is deleted, and its units go back on the shelf", async () => {
    const product = await seedProduct(5);
    const checkoutSessionId = session();
    const placed = await place({ productId: product, quantity: 2, status: "pending", checkoutSessionId });
    expect(await stockOf(product)).toBe(3);

    expect(await release(checkoutSessionId)).toBe(true);
    expect(await stockOf(product)).toBe(5);
    expect(await orderOf(placed.order_id)).toBeUndefined();
    // Nothing left to release a second time.
    expect(await release(checkoutSessionId)).toBe(false);
    expect(await stockOf(product)).toBe(5);
  });

  it("is never a paid order", async () => {
    const product = await seedProduct(5);
    const checkoutSessionId = session();
    const placed = await place({ productId: product, checkoutSessionId });
    expect(await release(checkoutSessionId)).toBe(false);
    expect((await orderOf(placed.order_id))?.status).toBe("paid");
    expect(await stockOf(product)).toBe(4);
  });

  it("is swept once its time has passed, and not before", async () => {
    const product = await seedProduct(10);
    const soon = new Date(Date.now() + 10 * 60_000);
    const later = new Date(Date.now() + 60 * 60_000);
    const expiring = await place({
      productId: product,
      quantity: 3,
      status: "pending",
      pendingExpiresAt: soon.toISOString(),
    });
    const waiting = await place({
      productId: product,
      quantity: 2,
      status: "pending",
      pendingExpiresAt: later.toISOString(),
    });
    expect(await stockOf(product)).toBe(5);

    // Other suites' orders may be swept too; what matters is these two.
    await sweep(new Date(soon.getTime() + 60_000));
    expect(await orderOf(expiring.order_id)).toBeUndefined();
    expect((await orderOf(waiting.order_id))?.status).toBe("pending");
    expect(await stockOf(product)).toBe(8);
  });

  it("leaves alone a pending row that was never a reservation", async () => {
    // The demo sales simulator writes pending orders of its own: no checkout,
    // no waiting time. The sweep must not take those for abandoned payments.
    const id = await asService(async (q) =>
      (
        await q.query(
          `insert into public.orders (seller_id, channel, status, amount_cents, product_title, product_price_cents)
           values ($1, 'embed', 'pending', 100, 'x', 100) returning id`,
          [owner.id],
        )
      ).rows[0].id as string,
    );
    await sweep(new Date(Date.now() + 365 * 24 * 60 * 60_000));
    expect((await orderOf(id))?.status).toBe("pending");
  });
});

describe("order_refund", () => {
  it("takes a paid order back, with its reason, and out of the To ship queue", async () => {
    const product = await seedProduct(5);
    const placed = await place({ productId: product });

    expect(await refund(owner, placed.order_id, "cancelled")).toBe("refunded");
    const order = await orderOf(placed.order_id);
    expect(order).toMatchObject({ status: "refunded", refund_reason: "cancelled" });
    expect(order?.refunded_at).not.toBeNull();

    const toShip = await asSuper(async (q) =>
      (
        await q.query(
          `select count(*)::int as n from public.orders
            where id = $1 and status = 'paid' and fulfilment_status = 'unfulfilled'`,
          [placed.order_id],
        )
      ).rows[0].n,
    );
    expect(toShip).toBe(0);
  });

  it("puts the units back when asked, and only once", async () => {
    const product = await seedProduct(5);
    const placed = await place({ productId: product, quantity: 2 });
    expect(await stockOf(product)).toBe(3);

    expect(await refund(owner, placed.order_id, "returned", true)).toBe("refunded");
    expect(await stockOf(product)).toBe(5);
    expect((await orderOf(placed.order_id))?.stock_reserved).toBe(0);
    // Already refunded: nothing more to give back.
    expect(await refund(owner, placed.order_id, "returned", true)).toBe("not_refundable");
    expect(await stockOf(product)).toBe(5);
  });

  it("keeps the units off the shelf unless asked", async () => {
    const product = await seedProduct(5);
    const placed = await place({ productId: product, quantity: 2 });
    expect(await refund(owner, placed.order_id, "other", false)).toBe("refunded");
    expect(await stockOf(product)).toBe(3);
  });

  it("is the owner's alone: an editor, a viewer and a stranger all get not_found", async () => {
    const product = await seedProduct(5);
    const placed = await place({ productId: product });
    for (const user of [editor, viewer, stranger]) {
      expect(await refund(user, placed.order_id)).toBe("not_found");
    }
    expect((await orderOf(placed.order_id))?.status).toBe("paid");
  });

  it("refuses an order that is not paid, and a reason it does not know", async () => {
    const product = await seedProduct(5);
    const pending = await place({ productId: product, status: "pending" });
    expect(await refund(owner, pending.order_id)).toBe("not_refundable");

    const paid = await place({ productId: product });
    expect(await refund(owner, paid.order_id, "because")).toBe("not_refundable");
    expect((await orderOf(paid.order_id))?.status).toBe("paid");
  });

  it("refuses a password-only session of an account with 2FA on", async () => {
    const guarded = await createUser(`twofa-life-${randomUUID().slice(0, 6)}@test.squareshare.to`);
    await asSuper((q) =>
      q.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret)
         values ($1, $2, 'phone', 'totp', 'verified', 'JBSWY3DPEHPK3PXP')`,
        [randomUUID(), guarded.id],
      ),
    );
    const placed = await place({ productId: null, seller: guarded });
    const call = (claims: Record<string, unknown>) =>
      asUserWithClaims(guarded, claims, async (q) =>
        (await q.query(`select public.order_refund($1, 'other') as outcome`, [placed.order_id]))
          .rows[0].outcome,
      );
    expect(await call({ aal: "aal1" })).toBe("not_found");
    expect((await orderOf(placed.order_id))?.status).toBe("paid");
    expect(await call({ aal: "aal2" })).toBe("refunded");
  });

  it("is not callable without a session, and its ungated half not by a seller", async () => {
    const product = await seedProduct(5);
    const placed = await place({ productId: product });
    expect(
      await expectDbError(
        asAnon((q) => q.query(`select public.order_refund($1, 'other')`, [placed.order_id])),
      ),
    ).toMatch(/permission denied/);
    expect(
      await expectDbError(
        asUser(owner, (q) =>
          q.query(`select public.order_apply_refund($1, 'other')`, [placed.order_id]),
        ),
      ),
    ).toMatch(/permission denied/);
    expect((await orderOf(placed.order_id))?.status).toBe("paid");
  });
});

describe("a code's uses", () => {
  it("stop counting an order that was taken back", async () => {
    const product = await seedProduct(null);
    const discountId = await asService(async (q) =>
      (
        await q.query(
          `insert into public.discounts (owner_id, kind, code, value_type, percent_off)
           values ($1, 'code', $2, 'percent', 10) returning id`,
          [owner.id, `LIFE${randomUUID().slice(0, 6).toUpperCase()}`],
        )
      ).rows[0].id as string,
    );
    const withCode = async () => {
      const placed = await place({ productId: product });
      await asService((q) =>
        q.query(`update public.orders set discount_code_id = $2, discount_id = $2 where id = $1`, [
          placed.order_id,
          discountId,
        ]),
      );
      return placed.order_id;
    };
    const kept = await withCode();
    const takenBack = await withCode();
    await refund(owner, takenBack, "returned");

    const uses = await asUser(owner, async (q) =>
      (
        await q.query(`select uses, orders from public.discount_performance($1) where discount_id = $2`, [
          owner.id,
          discountId,
        ])
      ).rows[0],
    );
    expect(uses).toEqual({ uses: 1, orders: 1 });
    expect(kept).toBeTruthy();
  });
});
