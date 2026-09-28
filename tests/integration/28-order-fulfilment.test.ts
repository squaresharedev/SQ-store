/**
 * Order fulfilment (20260927_order_fulfilment), against the replayed schema.
 *
 * Two things are proven here. The COLUMNS: every fence a service-role write
 * cannot climb (the order writer is the service role, so these CHECKs are the
 * only thing between a bug in it and a nonsense row). And the ONE seller write,
 * order_mark_shipped: a definer function, so every gate RLS would have applied
 * is its own job, and each one is exercised with the claims PostgREST sets.
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

type OrderSeed = {
  status?: string;
  fulfilment_status?: string;
  seller?: TestUser;
};

/** One paid, unshipped order (unless told otherwise), written as the writer writes. */
async function seedOrder(seed: OrderSeed = {}): Promise<string> {
  return asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.orders (seller_id, channel, status, amount_cents, platform_fee_cents,
                                  currency, buyer_email, product_title, product_price_cents,
                                  quantity, ship_to, fulfilment_status)
       values ($1, 'embed', $2, 2400, 120, 'EUR', 'buyer@example.com', 'Lamp', 1200, 2,
               '{"name":"Aoife Byrne","line1":"12 Harbour Road","city":"Dublin","country":"IE"}', $3)
       returning id`,
      [(seed.seller ?? owner).id, seed.status ?? "paid", seed.fulfilment_status ?? "unfulfilled"],
    );
    return rows[0].id as string;
  });
}

const markShipped = (user: TestUser, orderId: string, tracking: string | null = null) =>
  asUser(user, async (q) =>
    (await q.query(`select public.order_mark_shipped($1, $2) as outcome`, [orderId, tracking])).rows[0]
      .outcome as string,
  );

const fulfilmentOf = (orderId: string) =>
  asSuper(async (q) =>
    (
      await q.query(
        `select fulfilment_status, shipped_at, tracking_number from public.orders where id = $1`,
        [orderId],
      )
    ).rows[0] as { fulfilment_status: string; shipped_at: Date | null; tracking_number: string | null },
  );

beforeAll(async () => {
  owner = await createUser(`owner-ful-${randomUUID().slice(0, 6)}@test.squareshare.to`);
  editor = await createUser(`editor-ful-${randomUUID().slice(0, 6)}@test.squareshare.to`);
  viewer = await createUser(`viewer-ful-${randomUUID().slice(0, 6)}@test.squareshare.to`);
  stranger = await createUser(`stranger-ful-${randomUUID().slice(0, 6)}@test.squareshare.to`);
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
  it("grants orders.fulfil to owners and editors, never viewers", async () => {
    const can = await asSuper(async (q) =>
      (
        await q.query(
          `select public.team_role_can('owner', 'orders.fulfil') o,
                  public.team_role_can('editor', 'orders.fulfil') e,
                  public.team_role_can('viewer', 'orders.fulfil') v`,
        )
      ).rows[0],
    );
    expect(can).toEqual({ o: true, e: true, v: false });
  });
});

describe("order columns", () => {
  const insert = (columns: string, values: string) =>
    asService((q) =>
      q.query(
        `insert into public.orders (seller_id, channel, amount_cents, product_title, product_price_cents${columns})
         values ($1, 'embed', 100, 'x', 100${values})`,
        [owner.id],
      ),
    );

  it("defaults a new order to one unit, waiting to ship", async () => {
    const { rows } = await asService((q) =>
      q.query(
        `insert into public.orders (seller_id, channel, amount_cents, product_title, product_price_cents)
         values ($1, 'embed', 100, 'x', 100) returning quantity, fulfilment_status, shipped_at`,
        [owner.id],
      ),
    );
    expect(rows[0]).toEqual({ quantity: 1, fulfilment_status: "unfulfilled", shipped_at: null });
  });

  it("refuses a quantity outside 1..100", async () => {
    expect(await expectDbError(insert(", quantity", ", 0"))).toMatch(/orders_quantity_range/);
    expect(await expectDbError(insert(", quantity", ", 101"))).toMatch(/orders_quantity_range/);
  });

  it("refuses an unknown fulfilment status", async () => {
    expect(await expectDbError(insert(", fulfilment_status", ", 'lost'"))).toMatch(
      /orders_fulfilment_status_check/,
    );
  });

  it("holds shipped and shipped_at together", async () => {
    expect(await expectDbError(insert(", fulfilment_status", ", 'shipped'"))).toMatch(
      /orders_shipped_at_matches_status/,
    );
    expect(await expectDbError(insert(", shipped_at", ", now()"))).toMatch(
      /orders_shipped_at_matches_status/,
    );
  });

  it("only takes a tracking number on a shipped order, and only in reference-code characters", async () => {
    expect(await expectDbError(insert(", tracking_number", ", 'RR123456789IE'"))).toMatch(
      /orders_tracking_only_when_shipped/,
    );
    expect(
      await expectDbError(
        insert(", fulfilment_status, shipped_at, tracking_number", ", 'shipped', now(), 'https://evil.example/x'"),
      ),
    ).toMatch(/orders_tracking_number_shape/);
  });

  it("stores an address as an object, and a small one", async () => {
    expect(await expectDbError(insert(", ship_to", `, '["not","an","object"]'`))).toMatch(
      /orders_ship_to_is_object/,
    );
    const huge = JSON.stringify({ name: "x".repeat(5000) });
    expect(await expectDbError(insert(", ship_to", `, '${huge}'`))).toMatch(/orders_ship_to_size/);
  });

  it("checks the buyer's language shape", async () => {
    expect(await expectDbError(insert(", buyer_locale", ", 'english'"))).toMatch(/orders_buyer_locale_shape/);
    await insert(", buyer_locale", ", 'pt-PT'");
  });

  it("records one checkout once: a redelivered payment cannot become a second order", async () => {
    const session = `cs_test_${randomUUID().replace(/-/g, "")}`;
    await insert(", checkout_session_id", `, '${session}'`);
    expect(await expectDbError(insert(", checkout_session_id", `, '${session}'`))).toMatch(
      /orders_checkout_session_id_key/,
    );
    // The writer's own statement: the duplicate is a silent no-op.
    const again = await asService((q) =>
      q.query(
        `insert into public.orders (seller_id, channel, amount_cents, product_title, product_price_cents, checkout_session_id)
         values ($1, 'embed', 100, 'x', 100, $2) on conflict (checkout_session_id) do nothing returning id`,
        [owner.id, session],
      ),
    );
    expect(again.rowCount).toBe(0);
    expect(await expectDbError(insert(", checkout_session_id", ", 'cs test; drop'"))).toMatch(
      /orders_checkout_session_id_shape/,
    );
  });

  it("still lets no client write an order directly", async () => {
    const id = await seedOrder();
    const res = await asUser(owner, (q) =>
      q.query(`update public.orders set fulfilment_status = 'shipped', shipped_at = now() where id = $1`, [id]),
    );
    expect(res.rowCount).toBe(0);
    expect((await fulfilmentOf(id)).fulfilment_status).toBe("unfulfilled");
  });
});

describe("order_mark_shipped", () => {
  it("ships a paid order for its owner, stamped now, with the tracking number", async () => {
    const id = await seedOrder();
    expect(await markShipped(owner, id, "  RR123456789IE ")).toBe("shipped");
    const row = await fulfilmentOf(id);
    expect(row.fulfilment_status).toBe("shipped");
    expect(row.shipped_at).not.toBeNull();
    expect(row.tracking_number).toBe("RR123456789IE");
  });

  it("ships without a tracking number too (blank reads as none)", async () => {
    const id = await seedOrder();
    expect(await markShipped(owner, id, "   ")).toBe("shipped");
    expect((await fulfilmentOf(id)).tracking_number).toBeNull();
  });

  it("on a shipped order, changes only the tracking number, and says when nothing changed", async () => {
    const id = await seedOrder();
    await markShipped(owner, id);
    const shippedAt = (await fulfilmentOf(id)).shipped_at;
    expect(await markShipped(owner, id, "RR000000001IE")).toBe("tracking_updated");
    expect(await markShipped(owner, id, "RR000000001IE")).toBe("unchanged");
    const row = await fulfilmentOf(id);
    expect(row.tracking_number).toBe("RR000000001IE");
    expect(row.shipped_at).toEqual(shippedAt);
  });

  it("lets an editor ship the owner's orders", async () => {
    const id = await seedOrder();
    expect(await markShipped(editor, id)).toBe("shipped");
  });

  it("refuses a viewer and a stranger alike, without saying the order exists", async () => {
    const id = await seedOrder();
    expect(await markShipped(viewer, id)).toBe("not_found");
    expect(await markShipped(stranger, id)).toBe("not_found");
    expect(await markShipped(stranger, randomUUID())).toBe("not_found");
    expect((await fulfilmentOf(id)).fulfilment_status).toBe("unfulfilled");
  });

  it("refuses an order that is not paid, or has nothing to ship", async () => {
    for (const status of ["pending", "refunded", "disputed"]) {
      const id = await seedOrder({ status });
      expect(await markShipped(owner, id)).toBe("not_shippable");
      expect((await fulfilmentOf(id)).fulfilment_status).toBe("unfulfilled");
    }
    const download = await seedOrder({ fulfilment_status: "not_required" });
    expect(await markShipped(owner, download)).toBe("not_shippable");
  });

  it("refuses a tracking number outside the column's character set", async () => {
    const id = await seedOrder();
    expect(await expectDbError(markShipped(owner, id, "<script>"))).toMatch(/orders_tracking_number_shape/);
    expect((await fulfilmentOf(id)).fulfilment_status).toBe("unfulfilled");
  });

  it("refuses a password-only session of an account with 2FA on", async () => {
    const guarded = await createUser(`twofa-ful-${randomUUID().slice(0, 6)}@test.squareshare.to`);
    await asSuper((q) =>
      q.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret)
         values ($1, $2, 'phone', 'totp', 'verified', 'JBSWY3DPEHPK3PXP')`,
        [randomUUID(), guarded.id],
      ),
    );
    const id = await seedOrder({ seller: guarded });
    const call = (claims: Record<string, unknown>) =>
      asUserWithClaims(guarded, claims, async (q) =>
        (await q.query(`select public.order_mark_shipped($1) as outcome`, [id])).rows[0].outcome,
      );
    expect(await call({ aal: "aal1" })).toBe("not_found");
    expect((await fulfilmentOf(id)).fulfilment_status).toBe("unfulfilled");
    expect(await call({ aal: "aal2" })).toBe("shipped");
  });

  it("is not callable without a session", async () => {
    const id = await seedOrder();
    expect(
      await expectDbError(asAnon((q) => q.query(`select public.order_mark_shipped($1)`, [id]))),
    ).toMatch(/permission denied/);
  });
});
