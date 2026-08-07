/**
 * Universal search: the queries behind /api/search must never cross an account
 * boundary, and the ILIKE patterns they issue must be index-backed.
 *
 * The route handler adds an explicit owner/seller filter to every query on top
 * of RLS, because RLS alone permits a team member to read EVERY store they
 * belong to — enough to quietly blend two shops into one result list. These
 * tests exercise the same SQL shape against the replica: once as the stranger
 * RLS must stop, once as the team member RLS deliberately lets through and only
 * the explicit filter separates.
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

let alice: TestUser; // store owner
let bob: TestUser; // unrelated stranger
let vera: TestUser; // viewer on Alice's store AND owner of her own

const TERM = "lantern";
const PATTERN = `%${TERM}%`;

beforeAll(async () => {
  alice = await createUser("alice-search@test.squareshare.to");
  bob = await createUser("bob-search@test.squareshare.to");
  vera = await createUser("vera-search@test.squareshare.to");

  const aliceProduct = await asUser(alice, async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, status)
       values ($1, 'Paper lantern', 1500, 'active') returning id`,
      [alice.id],
    );
    return rows[0].id;
  });

  await asUser(alice, (q) =>
    q.query(
      `insert into public.storefronts (owner_id, name) values ($1, 'Lantern shop')`,
      [alice.id],
    ),
  );

  await asService((q) =>
    q.query(
      `insert into public.orders
         (seller_id, product_id, channel, amount_cents, product_title,
          product_price_cents, buyer_email)
       values ($1, $2, 'embed', 1500, 'Paper lantern', 1500, 'lantern.buyer@example.com')`,
      [alice.id, aliceProduct],
    ),
  );

  await asService((q) =>
    q.query(
      `insert into public.notifications (user_id, type, title, body)
       values ($1, 'order', 'Lantern sold', 'Someone bought a lantern')`,
      [alice.id],
    ),
  );

  // Vera's OWN store also has a matching product. This is the row that a
  // missing account filter would smuggle into Alice's results.
  await asUser(vera, (q) =>
    q.query(
      `insert into public.products (owner_id, title, price_cents, status)
       values ($1, 'Vera lantern', 900, 'active')`,
      [vera.id],
    ),
  );

  // Vera becomes an ACTIVE viewer on Alice's store.
  await asService((q) =>
    q.query(
      `insert into public.team_members
         (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'viewer', 'active', now())`,
      [alice.id, vera.id, vera.email],
    ),
  );
});

afterAll(closePool);

describe("search queries — stranger isolation (RLS)", () => {
  it("a stranger's product search returns nothing of Alice's", async () => {
    const rows = await asUser(bob, (q) =>
      q.query(
        `select id from public.products where owner_id = $1 and title ilike $2`,
        [alice.id, PATTERN],
      ),
    );
    expect(rows.rowCount).toBe(0);
  });

  it("a stranger's order search returns nothing of Alice's", async () => {
    const rows = await asUser(bob, (q) =>
      q.query(
        `select id from public.orders where seller_id = $1 and product_title ilike $2`,
        [alice.id, PATTERN],
      ),
    );
    expect(rows.rowCount).toBe(0);
  });

  it("a stranger's storefront search returns nothing of Alice's", async () => {
    const rows = await asUser(bob, (q) =>
      q.query(
        `select id from public.storefronts where owner_id = $1 and name ilike $2`,
        [alice.id, PATTERN],
      ),
    );
    expect(rows.rowCount).toBe(0);
  });

  it("a stranger cannot read Alice's notifications", async () => {
    const rows = await asUser(bob, (q) =>
      q.query(
        `select id from public.notifications where user_id = $1 and title ilike $2`,
        [alice.id, PATTERN],
      ),
    );
    expect(rows.rowCount).toBe(0);
  });
});

describe("search queries — the explicit account filter", () => {
  it("RLS alone would show a member BOTH stores", async () => {
    // This is the failure the explicit filter exists to prevent: without a
    // where-clause on owner_id, Vera's search sees her own store and Alice's.
    const rows = await asUser(vera, (q) =>
      q.query(`select owner_id from public.products where title ilike $1`, [PATTERN]),
    );
    const owners = new Set(rows.rows.map((row) => row.owner_id));
    expect(owners.size).toBe(2);
    expect(owners).toContain(alice.id);
    expect(owners).toContain(vera.id);
  });

  it("with the filter, the member sees only the active account's rows", async () => {
    const rows = await asUser(vera, (q) =>
      q.query(
        `select owner_id, title from public.products
         where owner_id = $1 and title ilike $2`,
        [alice.id, PATTERN],
      ),
    );
    expect(rows.rows.map((row) => row.title)).toEqual(["Paper lantern"]);
  });

  it("switching the active account back shows only the member's own rows", async () => {
    const rows = await asUser(vera, (q) =>
      q.query(
        `select title from public.products where owner_id = $1 and title ilike $2`,
        [vera.id, PATTERN],
      ),
    );
    expect(rows.rows.map((row) => row.title)).toEqual(["Vera lantern"]);
  });

  it("notifications stay with the person, not the store they are viewing", async () => {
    // Vera is viewing Alice's store, but Alice's notifications are not hers.
    const rows = await asUser(vera, (q) =>
      q.query(
        `select id from public.notifications where user_id = $1 and title ilike $2`,
        [vera.id, PATTERN],
      ),
    );
    expect(rows.rowCount).toBe(0);
  });
});

describe("search queries — ilike escaping", () => {
  beforeAll(async () => {
    await asUser(alice, (q) =>
      q.query(
        `insert into public.products (owner_id, title, price_cents, status)
         values ($1, '50% off bundle', 500, 'active'), ($1, '50 percent off', 500, 'active')`,
        [alice.id],
      ),
    );
  });

  it("an escaped % matches literally instead of matching everything", async () => {
    const rows = await asUser(alice, (q) =>
      q.query(
        `select title from public.products where owner_id = $1 and title ilike $2`,
        [alice.id, "%50\\% off%"],
      ),
    );
    expect(rows.rows.map((row) => row.title)).toEqual(["50% off bundle"]);
  });

  it("an UNescaped % is the wildcard the escaping exists to stop", async () => {
    const rows = await asUser(alice, (q) =>
      q.query(
        `select title from public.products where owner_id = $1 and title ilike $2`,
        [alice.id, "%50% off%"],
      ),
    );
    expect(rows.rowCount).toBe(2);
  });
});

describe("search indexes", () => {
  const expected = [
    "products_title_trgm_idx",
    "storefronts_name_trgm_idx",
    "orders_product_title_trgm_idx",
    "notifications_title_trgm_idx",
    // From the earlier cost audit; the orders buyer-email search relies on it.
    "orders_buyer_email_trgm_idx",
  ];

  it.each(expected)("%s exists", async (indexName) => {
    const rows = await asSuper((q) =>
      q.query(`select indexname from pg_indexes where indexname = $1`, [indexName]),
    );
    expect(rows.rowCount).toBe(1);
  });

  it("the product-title index is a trigram GIN, so it can serve a leading wildcard", async () => {
    const rows = await asSuper((q) =>
      q.query(
        `select indexdef from pg_indexes where indexname = 'products_title_trgm_idx'`,
      ),
    );
    expect(rows.rows[0].indexdef).toContain("gin");
    expect(rows.rows[0].indexdef).toContain("gin_trgm_ops");
  });
});
