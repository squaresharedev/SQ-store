/**
 * Product reviews (20261025_reviews), against the replayed schema.
 *
 * Four things are proven. The SUMMARY: the triggers keep each product's
 * count, average and breakdown equal to a fresh recount of its public reviews
 * through inserts, edits, deletes, bulk imports and moderation. The COLUMNS:
 * the fences a service-role write cannot climb (one review per order, an
 * imported row never verified, the owner always the product's, a hidden review
 * always has its reason). The SELLER'S WRITE: review_set_visibility and its
 * gates. And ACCESS: members read their store's rows, nobody else reads
 * anything, and no client writes directly.
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

const tag = () => randomUUID().slice(0, 6);

async function seedProduct(seller: TestUser = owner): Promise<string> {
  return asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents) values ($1, $2, 1200) returning id`,
      [seller.id, `Lamp ${tag()}`],
    );
    return rows[0].id as string;
  });
}

async function seedOrder(productId: string, status = "paid"): Promise<string> {
  return asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.orders (seller_id, product_id, channel, status, amount_cents, product_title, product_price_cents)
       values ($1, $2, 'embed', $3, 1200, 'Lamp', 1200) returning id`,
      [owner.id, productId, status],
    );
    return rows[0].id as string;
  });
}

async function seedImport(): Promise<string> {
  return asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.review_imports (seller_id, source, row_count) values ($1, 'judgeme', 3) returning id`,
      [owner.id],
    );
    return rows[0].id as string;
  });
}

/** A native review, written as the buyer route writes it, already through
 *  the automatic check unless told otherwise. */
async function addNative(
  productId: string,
  rating: number,
  orderId?: string,
  moderation: "pending" | "clean" | "held" | "blocked" = "clean",
): Promise<string> {
  const order = orderId ?? (await seedOrder(productId));
  return asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.reviews (product_id, seller_id, order_id, rating, body, author_name, is_verified_buyer, moderation_status)
       values ($1, $2, $3, $4, 'Lovely', 'Aoife', true, $5) returning id`,
      [productId, owner.id, order, rating, moderation],
    );
    return rows[0].id as string;
  });
}

const setVisibility = (user: TestUser, reviewId: string, action: string, reason: string | null = null) =>
  asUser(user, async (q) =>
    (await q.query(`select public.review_set_visibility($1, $2, $3) as outcome`, [reviewId, action, reason])).rows[0]
      .outcome as string,
  );

type Summary = {
  review_count: number;
  rating_sum: number;
  rating_1: number;
  rating_2: number;
  rating_3: number;
  rating_4: number;
  rating_5: number;
  average: string | null;
};

const summaryOf = (productId: string) =>
  asSuper(async (q) =>
    (
      await q.query(
        `select review_count, rating_sum, rating_1, rating_2, rating_3, rating_4, rating_5, average
           from public.product_rating_summaries where product_id = $1`,
        [productId],
      )
    ).rows[0] as Summary | undefined,
  );

beforeAll(async () => {
  owner = await createUser(`owner-rev-${tag()}@test.squareshare.to`);
  editor = await createUser(`editor-rev-${tag()}@test.squareshare.to`);
  viewer = await createUser(`viewer-rev-${tag()}@test.squareshare.to`);
  stranger = await createUser(`stranger-rev-${tag()}@test.squareshare.to`);
  await asService((q) =>
    q.query(
      `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'viewer', 'active', now()), ($1, $4, $5, 'editor', 'active', now())`,
      [owner.id, viewer.id, viewer.email, editor.id, editor.email],
    ),
  );
});

afterAll(closePool);

describe("the rating summary", () => {
  it("counts approved reviews as they arrive", async () => {
    const product = await seedProduct();
    await addNative(product, 5);
    await addNative(product, 4);
    await addNative(product, 4);
    expect(await summaryOf(product)).toEqual({
      review_count: 3,
      rating_sum: 13,
      rating_1: 0,
      rating_2: 0,
      rating_3: 0,
      rating_4: 2,
      rating_5: 1,
      average: "4.33",
    });
  });

  it("follows a review being hidden, re-rated and deleted", async () => {
    const product = await seedProduct();
    const first = await addNative(product, 5);
    const second = await addNative(product, 1);

    await asService((q) =>
      q.query(`update public.reviews set is_approved = false, hidden_reason = 'spam' where id = $1`, [second]),
    );
    expect((await summaryOf(product))?.review_count).toBe(1);
    expect((await summaryOf(product))?.average).toBe("5.00");

    await asService((q) => q.query(`update public.reviews set rating = 3 where id = $1`, [first]));
    expect((await summaryOf(product))?.rating_3).toBe(1);

    await asService((q) => q.query(`delete from public.reviews where id = $1`, [first]));
    expect(await summaryOf(product)).toMatchObject({ review_count: 0, rating_sum: 0, average: null });
  });

  it("recounts a bulk import once, across several products", async () => {
    const [a, b] = [await seedProduct(), await seedProduct()];
    const run = await seedImport();
    await asService((q) =>
      q.query(
        `insert into public.reviews (product_id, seller_id, import_id, source, external_id, rating, author_name, moderation_status)
         values ($1, $3, $4, 'judgeme', 'x1', 5, 'A', 'clean'), ($1, $3, $4, 'judgeme', 'x2', 3, 'B', 'clean'),
                ($2, $3, $4, 'judgeme', 'x3', 2, 'C', 'clean')`,
        [a, b, owner.id, run],
      ),
    );
    expect((await summaryOf(a))?.average).toBe("4.00");
    expect((await summaryOf(b))?.review_count).toBe(1);

    // Undoing the run removes its reviews and their counts.
    await asService((q) => q.query(`delete from public.review_imports where id = $1`, [run]));
    expect((await summaryOf(a))?.review_count).toBe(0);
    expect((await summaryOf(b))?.review_count).toBe(0);
  });

  it("counts nothing the automatic check has not passed", async () => {
    const product = await seedProduct();
    await addNative(product, 5);
    await addNative(product, 1, undefined, "pending");
    const held = await addNative(product, 2, undefined, "held");
    await addNative(product, 1, undefined, "blocked");
    expect((await summaryOf(product))?.review_count).toBe(1);

    // A held review the seller publishes counts from then on.
    expect(await setVisibility(owner, held, "publish")).toBe("published");
    expect(await summaryOf(product)).toMatchObject({ review_count: 2, rating_sum: 7 });
  });

  it("goes with its product", async () => {
    const product = await seedProduct();
    await addNative(product, 4);
    await asService((q) => q.query(`delete from public.products where id = $1`, [product]));
    expect(await summaryOf(product)).toBeUndefined();
  });
});

describe("review columns", () => {
  it("files a review under the product's owner, whatever the writer sent", async () => {
    const product = await seedProduct();
    const order = await seedOrder(product);
    const seller = await asService(async (q) =>
      (
        await q.query(
          `insert into public.reviews (product_id, seller_id, order_id, rating, author_name)
           values ($1, $2, $3, 5, 'Aoife') returning seller_id`,
          [product, stranger.id, order],
        )
      ).rows[0].seller_id as string,
    );
    expect(seller).toBe(owner.id);
  });

  it("takes one review per order", async () => {
    const product = await seedProduct();
    const order = await seedOrder(product);
    await addNative(product, 5, order);
    expect(await expectDbError(addNative(product, 4, order))).toMatch(/reviews_order_unique/);
  });

  it("lands an imported review once, however often its file is imported", async () => {
    const product = await seedProduct();
    const run = await seedImport();
    const insert = () =>
      asService((q) =>
        q.query(
          `insert into public.reviews (product_id, seller_id, import_id, source, external_id, rating, author_name)
           values ($1, $2, $3, 'loox', 'same', 5, 'A')`,
          [product, owner.id, run],
        ),
      );
    await insert();
    expect(await expectDbError(insert())).toMatch(/reviews_external_unique/);
  });

  it("never marks an imported review verified", async () => {
    const product = await seedProduct();
    const run = await seedImport();
    const message = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.reviews (product_id, seller_id, import_id, source, external_id, rating, author_name, is_verified_buyer)
           values ($1, $2, $3, 'yotpo', 'v', 5, 'A', true)`,
          [product, owner.id, run],
        ),
      ),
    );
    expect(message).toMatch(/reviews_imported_not_verified/);
  });

  it("refuses a rating outside 1..5 and a review with no origin", async () => {
    const product = await seedProduct();
    const order = await seedOrder(product);
    expect(
      await expectDbError(
        asService((q) =>
          q.query(
            `insert into public.reviews (product_id, seller_id, order_id, rating, author_name) values ($1, $2, $3, 6, 'A')`,
            [product, owner.id, order],
          ),
        ),
      ),
    ).toMatch(/reviews_rating_range/);
    expect(
      await expectDbError(
        asService((q) =>
          q.query(
            `insert into public.reviews (product_id, seller_id, source, rating, author_name) values ($1, $2, 'judgeme', 5, 'A')`,
            [product, owner.id],
          ),
        ),
      ),
    ).toMatch(/reviews_origin/);
  });

  it("starts every review pending, so nothing is public before it is read", async () => {
    const product = await seedProduct();
    const order = await seedOrder(product);
    const row = await asService(async (q) =>
      (
        await q.query(
          `insert into public.reviews (product_id, seller_id, order_id, rating, author_name)
           values ($1, $2, $3, 5, 'A') returning moderation_status, is_public`,
          [product, owner.id, order],
        )
      ).rows[0],
    );
    expect(row).toEqual({ moderation_status: "pending", is_public: false });
  });

  it("never hides a review without saying why", async () => {
    const product = await seedProduct();
    const review = await addNative(product, 3);
    expect(
      await expectDbError(asService((q) => q.query(`update public.reviews set is_approved = false where id = $1`, [review]))),
    ).toMatch(/reviews_hidden_has_reason/);
    expect(
      await expectDbError(
        asService((q) =>
          q.query(`update public.reviews set is_approved = false, hidden_reason = 'negative' where id = $1`, [review]),
        ),
      ),
    ).toMatch(/reviews_hidden_reason_check/);
  });

  it("takes the verified badge away when the order is refunded", async () => {
    const product = await seedProduct();
    const order = await seedOrder(product);
    const review = await addNative(product, 5, order);
    await asService((q) => q.query(`update public.orders set status = 'refunded' where id = $1`, [order]));
    const verified = await asSuper(async (q) =>
      (await q.query(`select is_verified_buyer from public.reviews where id = $1`, [review])).rows[0]
        .is_verified_buyer as boolean,
    );
    expect(verified).toBe(false);
  });
});

describe("review_set_visibility", () => {
  it("lets the owner and an editor hide with a reason, and show again", async () => {
    const product = await seedProduct();
    const review = await addNative(product, 2);
    expect(await setVisibility(owner, review, "hide", "personal_info")).toBe("hidden");
    expect((await summaryOf(product))?.review_count).toBe(0);
    const row = await asSuper(async (q) =>
      (await q.query(`select hidden_reason, hidden_by from public.reviews where id = $1`, [review])).rows[0],
    );
    expect(row).toEqual({ hidden_reason: "personal_info", hidden_by: owner.id });

    expect(await setVisibility(editor, review, "show")).toBe("shown");
    expect((await summaryOf(product))?.review_count).toBe(1);
    expect(await setVisibility(editor, review, "show")).toBe("unchanged");
  });

  it("refuses any reason but the four, and hiding with none", async () => {
    const product = await seedProduct();
    const review = await addNative(product, 1);
    expect(await setVisibility(owner, review, "hide", "negative")).toBe("invalid");
    expect(await setVisibility(owner, review, "hide")).toBe("invalid");
    expect(await setVisibility(owner, review, "delete")).toBe("invalid");
  });

  it("never publishes what the check blocked", async () => {
    const product = await seedProduct();
    const blocked = await addNative(product, 5, undefined, "blocked");
    const clean = await addNative(product, 5);
    expect(await setVisibility(owner, blocked, "publish")).toBe("blocked");
    expect(await setVisibility(owner, clean, "publish")).toBe("unchanged");
  });

  it("answers a viewer and a stranger as if the review did not exist", async () => {
    const product = await seedProduct();
    const review = await addNative(product, 1);
    expect(await setVisibility(viewer, review, "hide", "spam")).toBe("not_found");
    expect(await setVisibility(stranger, review, "hide", "spam")).toBe("not_found");
    expect((await summaryOf(product))?.review_count).toBe(1);
  });

  it("refuses a password-only session of an account with two-factor on", async () => {
    const guarded = await createUser(`guarded-rev-${tag()}@test.squareshare.to`);
    await asSuper((q) =>
      q.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret)
         values ($1, $2, 'phone', 'totp', 'verified', 'JBSWY3DPEHPK3PXP')`,
        [randomUUID(), guarded.id],
      ),
    );
    const product = await seedProduct(guarded);
    const order = await asService(async (q) =>
      (
        await q.query(
          `insert into public.orders (seller_id, product_id, channel, status, amount_cents, product_title, product_price_cents)
           values ($1, $2, 'embed', 'paid', 1200, 'Lamp', 1200) returning id`,
          [guarded.id, product],
        )
      ).rows[0].id as string,
    );
    const review = await asService(async (q) =>
      (
        await q.query(
          `insert into public.reviews (product_id, seller_id, order_id, rating, author_name, moderation_status)
           values ($1, $2, $3, 1, 'A', 'clean') returning id`,
          [product, guarded.id, order],
        )
      ).rows[0].id as string,
    );
    const call = (claims: Record<string, unknown>) =>
      asUserWithClaims(guarded, claims, async (q) =>
        (await q.query(`select public.review_set_visibility($1, 'hide', 'spam') as outcome`, [review])).rows[0].outcome,
      );
    expect(await call({ aal: "aal1" })).toBe("not_found");
    expect(await call({ aal: "aal2" })).toBe("hidden");
  });

  it("cannot be called by the anonymous role", async () => {
    const product = await seedProduct();
    const review = await addNative(product, 1);
    expect(
      await expectDbError(asAnon((q) => q.query(`select public.review_set_visibility($1, 'hide', 'spam')`, [review]))),
    ).toMatch(/permission denied/);
  });
});

describe("telling the seller", () => {
  it("emails about reviews by default, and the bell takes the review type", async () => {
    const pref = await asSuper(async (q) =>
      (await q.query(`select notify_reviews from public.profiles where id = $1`, [owner.id])).rows[0].notify_reviews,
    );
    expect(pref).toBe(true);
    await asService((q) =>
      q.query(`insert into public.notifications (user_id, type, title) values ($1, 'review', 'New review')`, [owner.id]),
    );
  });
});

describe("access", () => {
  let product: string;
  beforeAll(async () => {
    product = await seedProduct();
    await addNative(product, 5);
  });

  const count = (table: string) => `select count(*)::int as n from public.${table} where ${
    table === "review_imports" ? "seller_id" : "product_id"
  } = $1`;

  it("lets the store's members read its reviews and summary", async () => {
    for (const user of [owner, viewer]) {
      const n = await asUser(user, async (q) => (await q.query(count("reviews"), [product])).rows[0].n);
      expect(n).toBe(1);
      const s = await asUser(user, async (q) => (await q.query(count("product_rating_summaries"), [product])).rows[0].n);
      expect(s).toBe(1);
    }
  });

  it("shows a stranger nothing", async () => {
    const n = await asUser(stranger, async (q) => (await q.query(count("reviews"), [product])).rows[0].n);
    expect(n).toBe(0);
  });

  it("gives the anonymous role no access at all", async () => {
    expect(await expectDbError(asAnon((q) => q.query(count("reviews"), [product])))).toMatch(/permission denied/);
  });

  it("lets no client write, not even the owner", async () => {
    const order = await seedOrder(product);
    expect(
      await expectDbError(
        asUser(owner, (q) =>
          q.query(
            `insert into public.reviews (product_id, seller_id, order_id, rating, author_name) values ($1, $2, $3, 5, 'Me')`,
            [product, owner.id, order],
          ),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await expectDbError(asUser(owner, (q) => q.query(`update public.reviews set is_approved = false`))),
    ).toMatch(/permission denied/);
    expect(
      await expectDbError(asUser(owner, (q) => q.query(`select public.review_summaries_refresh(array[$1]::uuid[])`, [product]))),
    ).toMatch(/permission denied/);
  });
});
