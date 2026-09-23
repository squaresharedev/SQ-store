/**
 * Content moderation, at the level only the database can answer.
 *
 * Three claims are made elsewhere in the codebase that would be worthless if
 * the schema did not actually hold them up:
 *
 *   1. "A seller cannot reverse a takedown." The app never offers them a way
 *      to, but the app is not the only client of this database, and a seller
 *      holds a publishable key and an RLS-permitted UPDATE on their own row.
 *      The guard trigger is the real control, so it is tested as one.
 *   2. "A removal notice reaches the seller." createNotification is best-effort
 *      by contract, so a type CHECK that disagrees with NOTIFICATION_TYPES
 *      loses the notice silently. The insert is tested here rather than
 *      trusted.
 *   3. "Twelve reports on one product is one queue row and one number." That
 *      is the rollup view, and the dedupe indexes that stop one person being
 *      counted as twelve.
 */
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

let seller: TestUser;
let stranger: TestUser;
let staffUser: TestUser;
let adminUserId: string;
let productId: string;
let storefrontId: string;

beforeAll(async () => {
  seller = await createUser("seller-mod@test.squareshare.to");
  stranger = await createUser("stranger-mod@test.squareshare.to");
  staffUser = await createUser("staff-mod@test.squareshare.to");

  adminUserId = await asSuper(async (q) => {
    const { rows } = await q.query(
      `insert into public.admin_users (user_id, role) values ($1, 'staff') returning id`,
      [staffUser.id],
    );
    return rows[0].id;
  });

  productId = await asUser(seller, async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, status)
       values ($1, 'Reported print', 2500, 'active') returning id`,
      [seller.id],
    );
    return rows[0].id;
  });

  storefrontId = await asUser(seller, async (q) => {
    const { rows } = await q.query(
      `insert into public.storefronts (owner_id, name) values ($1, 'Reported shop') returning id`,
      [seller.id],
    );
    return rows[0].id;
  });
});

afterAll(closePool);

describe("moderation columns", () => {
  it("default to visible, so the migration cannot black out the catalogue", async () => {
    const { rows } = await asUser(seller, (q) =>
      q.query(
        `select moderation_status, moderation_ground, moderated_at
           from public.products where id = $1`,
        [productId],
      ),
    );
    expect(rows[0].moderation_status).toBe("ok");
    expect(rows[0].moderation_ground).toBeNull();
    expect(rows[0].moderated_at).toBeNull();
  });

  it("refuse a status outside the vocabulary", async () => {
    const message = await expectDbError(
      asService((q) =>
        q.query(
          `update public.products set moderation_status = 'shadowbanned' where id = $1`,
          [productId],
        ),
      ),
    );
    expect(message).toMatch(/moderation_status_check/);
  });

  it("bound the staff note, which the seller reads verbatim", async () => {
    const message = await expectDbError(
      asService((q) =>
        q.query(
          `update public.products set moderation_note = $2 where id = $1`,
          [productId, "x".repeat(501)],
        ),
      ),
    );
    expect(message).toMatch(/moderation_note_check/);
  });
});

describe("guard_moderation_columns", () => {
  it("lets service_role take a product down", async () => {
    await asService((q) =>
      q.query(
        `update public.products
            set moderation_status = 'removed',
                moderation_ground = 'counterfeit',
                moderation_note   = 'The mark is registered.',
                moderated_at      = now(),
                moderated_by      = $2
          where id = $1`,
        [productId, adminUserId],
      ),
    );

    const { rows } = await asService((q) =>
      q.query(`select moderation_status from public.products where id = $1`, [
        productId,
      ]),
    );
    expect(rows[0].moderation_status).toBe("removed");
  });

  it("refuses the owner's attempt to restore their own product", async () => {
    const message = await expectDbError(
      asUser(seller, (q) =>
        q.query(
          `update public.products set moderation_status = 'ok' where id = $1`,
          [productId],
        ),
      ),
    );
    expect(message).toMatch(/set by SquareShare staff/);

    const { rows } = await asService((q) =>
      q.query(`select moderation_status from public.products where id = $1`, [
        productId,
      ]),
    );
    expect(rows[0].moderation_status).toBe("removed");
  });

  it("refuses the owner rewriting the reason they were given", async () => {
    const message = await expectDbError(
      asUser(seller, (q) =>
        q.query(
          `update public.products set moderation_note = 'nothing to see here' where id = $1`,
          [productId],
        ),
      ),
    );
    expect(message).toMatch(/set by SquareShare staff/);
  });

  it("still lets the owner edit everything else on a removed product", async () => {
    // A takedown is not a lock: the seller has to be able to fix the listing,
    // which is the whole point of telling them what was wrong with it.
    await asUser(seller, (q) =>
      q.query(`update public.products set title = 'Fixed print' where id = $1`, [
        productId,
      ]),
    );

    const { rows } = await asUser(seller, (q) =>
      q.query(`select title from public.products where id = $1`, [productId]),
    );
    expect(rows[0].title).toBe("Fixed print");
  });

  it("guards storefronts on the same terms", async () => {
    await asService((q) =>
      q.query(
        `update public.storefronts set moderation_status = 'removed' where id = $1`,
        [storefrontId],
      ),
    );

    const message = await expectDbError(
      asUser(seller, (q) =>
        q.query(
          `update public.storefronts set moderation_status = 'ok' where id = $1`,
          [storefrontId],
        ),
      ),
    );
    expect(message).toMatch(/set by SquareShare staff/);

    await asService((q) =>
      q.query(
        `update public.storefronts set moderation_status = 'ok' where id = $1`,
        [storefrontId],
      ),
    );
  });
});

/**
 * The pause loop: staff pause, the seller fixes and asks, staff decide again.
 * The column that carries "the seller asked" is what puts a decision back in
 * front of staff, so a seller must not be able to write it themselves (on a
 * REMOVED item that would re-open a final decision at will). SQ-store's
 * server action writes it with service_role after checking the session.
 */
describe("pause and review request", () => {
  let pausedId: string;

  beforeAll(async () => {
    pausedId = await asUser(seller, async (q) => {
      const { rows } = await q.query(
        `insert into public.products (owner_id, title, price_cents, status)
         values ($1, 'Paused print', 1800, 'active') returning id`,
        [seller.id],
      );
      return rows[0].id;
    });
  });

  it("accepts 'paused' as a takedown on products and storefronts", async () => {
    await asService((q) =>
      q.query(
        `update public.products
            set moderation_status = 'paused', moderation_ground = 'other',
                moderation_note = 'Replace the second photo.', moderated_at = now()
          where id = $1`,
        [pausedId],
      ),
    );
    await asService((q) =>
      q.query(`update public.storefronts set moderation_status = 'paused' where id = $1`, [
        storefrontId,
      ]),
    );
    const { rows } = await asService((q) =>
      q.query(
        `select (select moderation_status from public.products where id = $1) as p,
                (select moderation_status from public.storefronts where id = $2) as s`,
        [pausedId, storefrontId],
      ),
    );
    expect(rows[0]).toEqual({ p: "paused", s: "paused" });
    await asService((q) =>
      q.query(`update public.storefronts set moderation_status = 'ok' where id = $1`, [
        storefrontId,
      ]),
    );
  });

  it("starts with nothing waiting on staff", async () => {
    const { rows } = await asUser(seller, (q) =>
      q.query(`select moderation_review_requested_at from public.products where id = $1`, [
        pausedId,
      ]),
    );
    expect(rows[0].moderation_review_requested_at).toBeNull();
  });

  it("refuses the seller setting the review request directly", async () => {
    const message = await expectDbError(
      asUser(seller, (q) =>
        q.query(
          `update public.products set moderation_review_requested_at = now() where id = $1`,
          [pausedId],
        ),
      ),
    );
    expect(message).toMatch(/set by SquareShare staff/);
    expect(message).toMatch(/moderation_review_requested_at/);
  });

  it("lets service_role record the request, and the seller read it back", async () => {
    await asService((q) =>
      q.query(
        `update public.products set moderation_review_requested_at = now()
          where id = $1 and moderation_status = 'paused'`,
        [pausedId],
      ),
    );
    const { rows } = await asUser(seller, (q) =>
      q.query(`select moderation_review_requested_at from public.products where id = $1`, [
        pausedId,
      ]),
    );
    expect(rows[0].moderation_review_requested_at).not.toBeNull();
  });

  it("refuses the seller clearing it again", async () => {
    const message = await expectDbError(
      asUser(seller, (q) =>
        q.query(
          `update public.products set moderation_review_requested_at = null where id = $1`,
          [pausedId],
        ),
      ),
    );
    expect(message).toMatch(/set by SquareShare staff/);
  });

  it("still lets the seller edit the listing while it is paused", async () => {
    // Fixing it is the whole point of a pause.
    await asUser(seller, (q) =>
      q.query(`update public.products set title = 'Paused print, fixed' where id = $1`, [
        pausedId,
      ]),
    );
    const { rows } = await asUser(seller, (q) =>
      q.query(`select title from public.products where id = $1`, [pausedId]),
    );
    expect(rows[0].title).toBe("Paused print, fixed");
  });
});

describe("reports table", () => {
  it("accepts an anonymous notice written by service_role", async () => {
    await asService((q) =>
      q.query(
        `insert into public.reports (target_type, target_id, reason, details, reporter_hash)
         values ('product', $1, 'counterfeit', 'These are fake.', 'hash-anon-1')`,
        [productId],
      ),
    );

    const { rows } = await asService((q) =>
      q.query(`select count(*)::int as n from public.reports where target_id = $1`, [
        productId,
      ]),
    );
    expect(rows[0].n).toBe(1);
  });

  it("counts one reporter once, however many times they click", async () => {
    const message = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.reports (target_type, target_id, reason, reporter_hash)
           values ('product', $1, 'scam', 'hash-anon-1')`,
          [productId],
        ),
      ),
    );
    expect(message).toMatch(/reports_open_dedupe_hash_idx/);
  });

  it("lets a different reporter file on the same target", async () => {
    await asService((q) =>
      q.query(
        `insert into public.reports (target_type, target_id, reason, reporter_hash)
         values ('product', $1, 'counterfeit', 'hash-anon-2')`,
        [productId],
      ),
    );

    const { rows } = await asService((q) =>
      q.query(`select count(*)::int as n from public.reports where target_id = $1`, [
        productId,
      ]),
    );
    expect(rows[0].n).toBe(2);
  });

  it("refuses a reason outside the shared vocabulary", async () => {
    const message = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.reports (target_type, target_id, reason, reporter_hash)
           values ('product', $1, 'nudity', 'hash-anon-3')`,
          [productId],
        ),
      ),
    );
    expect(message).toMatch(/reports_reason_check/);
  });

  it("refuses a target type nothing can render", async () => {
    const message = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.reports (target_type, target_id, reason, reporter_hash)
           values ('comment', $1, 'spam', 'hash-anon-4')`,
          [productId],
        ),
      ),
    );
    expect(message).toMatch(/reports_target_type_check/);
  });

  it("stays unreadable to the reported seller and to the public", async () => {
    const asSeller = await asUser(seller, (q) =>
      q.query(`select id from public.reports where target_id = $1`, [productId]),
    );
    expect(asSeller.rows).toHaveLength(0);

    const asStrangerRows = await asUser(stranger, (q) =>
      q.query(`select id from public.reports where target_id = $1`, [productId]),
    );
    expect(asStrangerRows.rows).toHaveLength(0);

    const anon = await asAnon((q) =>
      q.query(`select id from public.reports where target_id = $1`, [productId]),
    );
    expect(anon.rows).toHaveLength(0);
  });

  it("is readable by staff", async () => {
    const { rows } = await asUser(staffUser, (q) =>
      q.query(`select id from public.reports where target_id = $1`, [productId]),
    );
    expect(rows).toHaveLength(2);
  });

  it("frees the dedupe slot once a report is resolved", async () => {
    await asService((q) =>
      q.query(
        `update public.reports
            set status = 'dismissed', resolved_at = now(), resolved_by = $2
          where target_id = $1`,
        [productId, adminUserId],
      ),
    );

    // Same reporter, same target, after the first was closed: a new problem,
    // not a double click.
    await asService((q) =>
      q.query(
        `insert into public.reports (target_type, target_id, reason, reporter_hash)
         values ('product', $1, 'scam', 'hash-anon-1')`,
        [productId],
      ),
    );

    const { rows } = await asService((q) =>
      q.query(
        `select count(*)::int as n from public.reports
          where target_id = $1 and status = 'open'`,
        [productId],
      ),
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("content_report_scores", () => {
  it("rolls many reports into one row carrying the target's identity", async () => {
    const { rows } = await asService((q) =>
      q.query(
        `select * from public.content_report_scores
          where target_type = 'product' and target_id = $1`,
        [productId],
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].open_reports).toBe(1);
    expect(rows[0].total_reports).toBe(3);
    expect(rows[0].target_title).toBe("Fixed print");
    expect(rows[0].target_owner_id).toBe(seller.id);
    expect(rows[0].moderation_status).toBe("removed");
  });

  it("is not reachable by anyone but the admin panel's service client", async () => {
    // It joins across every seller's products: RLS would hide those columns
    // from a staff member, so the view is service_role only rather than
    // RLS-permitted with silently null joins.
    for (const run of [
      () => asUser(staffUser, (q) => q.query(`select * from public.content_report_scores`)),
      () => asUser(seller, (q) => q.query(`select * from public.content_report_scores`)),
      () => asAnon((q) => q.query(`select * from public.content_report_scores`)),
    ]) {
      const message = await expectDbError(run);
      expect(message).toMatch(/permission denied/i);
    }
  });
});

describe("policy notifications", () => {
  it("insert, so a removal notice is not lost to a stale type CHECK", async () => {
    await asService((q) =>
      q.query(
        `insert into public.notifications (user_id, type, title, body)
         values ($1, 'policy', 'Your product was removed', 'It appeared to offer counterfeit goods.')`,
        [seller.id],
      ),
    );

    const { rows } = await asUser(seller, (q) =>
      q.query(
        `select type, title from public.notifications where user_id = $1 and type = 'policy'`,
        [seller.id],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Your product was removed");
  });

  it("still refuse a type that is in neither list", async () => {
    const message = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.notifications (user_id, type, title, body)
           values ($1, 'moderation', 'x', 'y')`,
          [seller.id],
        ),
      ),
    );
    expect(message).toMatch(/notifications_type_check/);
  });
});
