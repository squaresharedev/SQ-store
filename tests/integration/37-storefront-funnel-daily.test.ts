/**
 * The storefront funnel's daily table (20261012_storefront_funnel_daily),
 * against the replayed schema.
 *
 * What is proven here: a seller reads their own counts and nobody else's,
 * nothing a browser can be writes a row, a day is replaced whole (so the job
 * can run twice), and the table cannot hold anything but a hostname where the
 * site goes.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asUser,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";

let seller: TestUser;
let other: TestUser;

const STORE = randomUUID();
const PRODUCT = randomUUID();

type Row = { seller_id: string; event: string; events: number; referrer_host?: string; product_id?: string };

const rows = (list: Row[]) =>
  JSON.stringify(
    list.map((row) => ({
      store_id: STORE,
      product_id: PRODUCT,
      referrer_host: "",
      placement_id: "",
      ...row,
    })),
  );

const roll = (day: string, list: Row[]) =>
  asService(async (q) =>
    (await q.query(`select public.storefront_funnel_roll_day($1::date, $2::jsonb) as written`, [day, rows(list)]))
      .rows[0].written as number,
  );

const totals = (user: TestUser, account: string, from: string | null = null, to: string | null = null) =>
  asUser(user, async (q) =>
    (
      await q.query(`select public.storefront_funnel_aggregate($1::uuid, $2::date, $3::date) as payload`, [
        account,
        from,
        to,
      ])
    ).rows[0].payload.totals as { event: string; count: number }[],
  );

beforeAll(async () => {
  seller = await createUser(`funnel-seller-${randomUUID().slice(0, 6)}@test.squareshare.to`);
  other = await createUser(`funnel-other-${randomUUID().slice(0, 6)}@test.squareshare.to`);
});

afterAll(closePool);

describe("storefront_funnel_daily", () => {
  it("replaces a day whole, so a second run changes nothing", async () => {
    const day = "2026-10-01";
    const list: Row[] = [
      { seller_id: seller.id, event: "checkout_started", events: 10 },
      { seller_id: seller.id, event: "checkout_expired", events: 4 },
      { seller_id: other.id, event: "checkout_started", events: 99 },
    ];
    expect(await roll(day, list)).toBe(3);
    expect(await roll(day, list)).toBe(3);
    expect(await totals(seller, seller.id)).toEqual([
      { event: "checkout_expired", count: 4 },
      { event: "checkout_started", count: 10 },
    ]);

    // A later run with fewer events for that day is the truth for that day.
    await roll(day, [{ seller_id: seller.id, event: "checkout_started", events: 2 }]);
    expect(await totals(seller, seller.id)).toEqual([{ event: "checkout_started", count: 2 }]);
    // And another day is left alone by it.
    await roll("2026-10-02", [{ seller_id: seller.id, event: "checkout_started", events: 5 }]);
    expect(await totals(seller, seller.id)).toEqual([{ event: "checkout_started", count: 7 }]);
    expect(await totals(seller, seller.id, "2026-10-02", "2026-10-02")).toEqual([
      { event: "checkout_started", count: 5 },
    ]);
  });

  it("adds up groups that differ only in what the table does not keep apart", async () => {
    await roll("2026-10-03", [
      { seller_id: seller.id, event: "order_paid", events: 1 },
      { seller_id: seller.id, event: "order_paid", events: 2 },
    ]);
    expect(await totals(seller, seller.id, "2026-10-03", "2026-10-03")).toEqual([{ event: "order_paid", count: 3 }]);
  });

  it("skips a seller who no longer exists instead of failing the day", async () => {
    expect(
      await roll("2026-10-04", [
        { seller_id: randomUUID(), event: "checkout_started", events: 3 },
        { seller_id: seller.id, event: "checkout_started", events: 1 },
      ]),
    ).toBe(1);
  });

  it("shows a seller their own counts and nobody else's", async () => {
    await roll("2026-10-05", [
      { seller_id: seller.id, event: "embed_view", events: 60 },
      { seller_id: other.id, event: "embed_view", events: 500 },
    ]);
    const mine = await asUser(seller, async (q) =>
      (await q.query(`select distinct seller_id from public.storefront_funnel_daily`)).rows.map((r) => r.seller_id),
    );
    expect(mine).toEqual([seller.id]);
    // Asking the aggregate for another account is answered with nothing.
    expect(await totals(seller, other.id)).toEqual([]);
    expect(await expectDbError(asAnon((q) => q.query(`select * from public.storefront_funnel_daily`)))).toMatch(
      /permission denied/,
    );
    expect(
      await expectDbError(
        asAnon((q) => q.query(`select public.storefront_funnel_aggregate($1::uuid)`, [seller.id])),
      ),
    ).toMatch(/permission denied/);
  });

  it("cannot be written by a seller, by hand or through the job's function", async () => {
    const insert = `insert into public.storefront_funnel_daily
      (seller_id, store_id, product_id, day, event, events)
      values ($1, $2, $3, '2026-10-06', 'order_paid', 1000)`;
    expect(await expectDbError(asUser(seller, (q) => q.query(insert, [seller.id, STORE, PRODUCT])))).toMatch(
      /permission denied|row-level security/,
    );
    expect(
      await expectDbError(
        asUser(seller, (q) => q.query(`update public.storefront_funnel_daily set events = 0 where seller_id = $1`, [other.id])),
      ),
    ).toMatch(/permission denied/);
    expect(
      await expectDbError(asUser(seller, (q) => q.query(`delete from public.storefront_funnel_daily`))),
    ).toMatch(/permission denied/);
    expect(
      await expectDbError(
        asUser(seller, (q) => q.query(`select public.storefront_funnel_roll_day('2026-10-06'::date, '[]'::jsonb)`)),
      ),
    ).toMatch(/permission denied/);
  });

  it("holds a hostname where the site goes, never an address", async () => {
    for (const notHost of ["https://shop.example.com", "shop.example.com/cart", "shop.example.com:8080", "Shop.example.com"]) {
      expect(
        await expectDbError(
          roll("2026-10-07", [{ seller_id: seller.id, event: "embed_view", events: 1, referrer_host: notHost }]),
        ),
        notHost,
      ).toMatch(/check constraint/);
    }
    expect(
      await roll("2026-10-07", [
        { seller_id: seller.id, event: "embed_view", events: 1, referrer_host: "shop.example.com" },
      ]),
    ).toBe(1);
    expect(
      await expectDbError(roll("2026-10-08", [{ seller_id: seller.id, event: "page_scroll", events: 1 }])),
    ).toMatch(/check constraint/);
  });
});
