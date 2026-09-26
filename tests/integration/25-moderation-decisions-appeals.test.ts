/**
 * Moderation decisions and appeals, at the level only the database can answer
 * (20260926_moderation_decisions_and_appeals).
 *
 * The app says four things that are worthless unless the schema holds them:
 *
 *   1. A seller cannot rewrite what they were told to fix, or which decision
 *      their banner (and its downloadable statement) belongs to. The guard
 *      trigger now covers moderation_fields and moderation_decision_id.
 *   2. Decisions and appeals are READ-ONLY to sellers: they are written by
 *      staff (the admin panel) and by SQ-store's own server action, both with
 *      service_role, after checks the seller's session cannot skip.
 *   3. A decision belongs to its store: the owner and that store's team read
 *      it, nobody else does.
 *   4. One appeal per decision, and the vocabularies match the app's.
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
let viewer: TestUser;
let stranger: TestUser;
let adminUserId: string;
let productId: string;
let decisionId: string;

beforeAll(async () => {
  seller = await createUser("seller-decisions@test.squareshare.to");
  viewer = await createUser("viewer-decisions@test.squareshare.to");
  stranger = await createUser("stranger-decisions@test.squareshare.to");
  const staff = await createUser("staff-decisions@test.squareshare.to");

  adminUserId = await asSuper(async (q) => {
    const { rows } = await q.query(
      `insert into public.admin_users (user_id, role) values ($1, 'staff') returning id`,
      [staff.id],
    );
    return rows[0].id;
  });

  await asService((q) =>
    q.query(
      `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'viewer', 'active', now())`,
      [seller.id, viewer.id, viewer.email],
    ),
  );

  productId = await asUser(seller, async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, status)
       values ($1, 'Paused print', 2500, 'active') returning id`,
      [seller.id],
    );
    return rows[0].id;
  });

  // The admin panel's takedown, as it writes it: the decision, then the row.
  decisionId = await asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.moderation_decisions
         (target_type, target_id, owner_id, target_title, action, ground, note, fields,
          report_count, report_reasons, decided_by)
       values ('product', $1, $2, 'Paused print', 'paused', 'counterfeit',
               'Remove the logo from the main photo.', '{photos,title}', 2, '{counterfeit}', $3)
       returning id`,
      [productId, seller.id, adminUserId],
    );
    await q.query(
      `update public.products
          set moderation_status = 'paused', moderation_ground = 'counterfeit',
              moderation_note = 'Remove the logo from the main photo.', moderated_at = now(),
              moderation_fields = '{photos,title}', moderation_decision_id = $2
        where id = $1`,
      [productId, rows[0].id],
    );
    return rows[0].id;
  });
});

afterAll(closePool);

describe("what the seller was told to fix", () => {
  it("cannot be cleared or rewritten by the seller", async () => {
    for (const statement of [
      `update public.products set moderation_fields = null where id = $1`,
      `update public.products set moderation_fields = '{description}' where id = $1`,
      `update public.products set moderation_decision_id = null where id = $1`,
    ]) {
      const message = await expectDbError(asUser(seller, (q) => q.query(statement, [productId])));
      expect(message).toMatch(/set by SquareShare staff/);
    }
    const { rows } = await asService((q) =>
      q.query(
        `select moderation_fields, moderation_decision_id from public.products where id = $1`,
        [productId],
      ),
    );
    expect(rows[0].moderation_fields).toEqual(["photos", "title"]);
    expect(rows[0].moderation_decision_id).toBe(decisionId);
  });

  it("still lets the seller fix the product itself", async () => {
    await asUser(seller, (q) =>
      q.query(`update public.products set title = 'Paused print, no logo' where id = $1`, [
        productId,
      ]),
    );
  });

  it("only admits parts the app knows how to show", async () => {
    const message = await expectDbError(
      asService((q) =>
        q.query(`update public.products set moderation_fields = '{hologram}' where id = $1`, [
          productId,
        ]),
      ),
    );
    expect(message).toMatch(/products_moderation_fields_check/);
    // A storefront part is not a product part.
    const other = await expectDbError(
      asService((q) =>
        q.query(`update public.products set moderation_fields = '{header}' where id = $1`, [
          productId,
        ]),
      ),
    );
    expect(other).toMatch(/products_moderation_fields_check/);
  });
});

describe("moderation_decisions", () => {
  it("is readable by the store's owner and its team", async () => {
    for (const reader of [seller, viewer]) {
      const { rows } = await asUser(reader, (q) =>
        q.query(`select id, fields, report_count from public.moderation_decisions where id = $1`, [
          decisionId,
        ]),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].fields).toEqual(["photos", "title"]);
    }
  });

  it("is invisible to anyone else", async () => {
    const { rows } = await asUser(stranger, (q) =>
      q.query(`select id from public.moderation_decisions where id = $1`, [decisionId]),
    );
    expect(rows).toHaveLength(0);
    const anon = await expectDbError(
      asAnon((q) => q.query(`select id from public.moderation_decisions`)),
    );
    expect(anon).toMatch(/permission denied/);
  });

  it("cannot be written or rewritten by the seller", async () => {
    const insert = await expectDbError(
      asUser(seller, (q) =>
        q.query(
          `insert into public.moderation_decisions
             (target_type, target_id, owner_id, target_title, action, ground)
           values ('product', $1, $2, 'x', 'removed', 'spam')`,
          [productId, seller.id],
        ),
      ),
    );
    expect(insert).toMatch(/permission denied/);
    const update = await expectDbError(
      asUser(seller, (q) =>
        q.query(`update public.moderation_decisions set note = 'fine' where id = $1`, [decisionId]),
      ),
    );
    expect(update).toMatch(/permission denied/);
  });

  it("refuses a field from the other target type and an unknown report reason", async () => {
    const fields = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.moderation_decisions
             (target_type, target_id, owner_id, target_title, action, ground, fields)
           values ('storefront', $1, $2, 'x', 'paused', 'spam', '{purchaseLink}')`,
          [productId, seller.id],
        ),
      ),
    );
    expect(fields).toMatch(/moderation_decisions_fields_check/);
    const reasons = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.moderation_decisions
             (target_type, target_id, owner_id, target_title, action, ground, report_reasons)
           values ('product', $1, $2, 'x', 'paused', 'spam', '{nudity}')`,
          [productId, seller.id],
        ),
      ),
    );
    expect(reasons).toMatch(/moderation_decisions_reasons_check/);
  });
});

describe("moderation_appeals", () => {
  let appealId: string;

  it("cannot be filed by the seller directly, only through the server", async () => {
    const message = await expectDbError(
      asUser(seller, (q) =>
        q.query(
          `insert into public.moderation_appeals
             (decision_id, target_type, target_id, owner_id, message)
           values ($1, 'product', $2, $3, 'This was our own registered mark.')`,
          [decisionId, productId, seller.id],
        ),
      ),
    );
    expect(message).toMatch(/permission denied/);
  });

  it("takes one appeal per decision, with a real explanation", async () => {
    const short = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.moderation_appeals
             (decision_id, target_type, target_id, owner_id, message)
           values ($1, 'product', $2, $3, 'wrong')`,
          [decisionId, productId, seller.id],
        ),
      ),
    );
    expect(short).toMatch(/moderation_appeals_message_check/);

    appealId = await asService(async (q) => {
      const { rows } = await q.query(
        `insert into public.moderation_appeals
           (decision_id, target_type, target_id, owner_id, filed_by, message)
         values ($1, 'product', $2, $3, $3, 'This was our own registered mark, see the register.')
         returning id`,
        [decisionId, productId, seller.id],
      );
      return rows[0].id;
    });

    const second = await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.moderation_appeals
             (decision_id, target_type, target_id, owner_id, message)
           values ($1, 'product', $2, $3, 'Asking again, louder this time around.')`,
          [decisionId, productId, seller.id],
        ),
      ),
    );
    expect(second).toMatch(/moderation_appeals_one_per_decision/);
  });

  it("is read by the store and nobody else, and never rewritten by it", async () => {
    const own = await asUser(viewer, (q) =>
      q.query(`select status from public.moderation_appeals where id = $1`, [appealId]),
    );
    expect(own.rows).toEqual([{ status: "open" }]);

    const theirs = await asUser(stranger, (q) =>
      q.query(`select id from public.moderation_appeals where id = $1`, [appealId]),
    );
    expect(theirs.rows).toHaveLength(0);

    const rewrite = await expectDbError(
      asUser(seller, (q) =>
        q.query(`update public.moderation_appeals set status = 'overturned' where id = $1`, [
          appealId,
        ]),
      ),
    );
    expect(rewrite).toMatch(/permission denied/);
  });

  it("records an answer only together with when it was given", async () => {
    const half = await expectDbError(
      asService((q) =>
        q.query(`update public.moderation_appeals set status = 'upheld' where id = $1`, [appealId]),
      ),
    );
    expect(half).toMatch(/moderation_appeals_decided_check/);

    await asService((q) =>
      q.query(
        `update public.moderation_appeals
            set status = 'upheld', decided_at = now(), decided_by = $2,
                decision_note = 'The logo is still on the packaging.'
          where id = $1`,
        [appealId, adminUserId],
      ),
    );
  });

  it("goes with its decision", async () => {
    await asService(async (q) => {
      await q.query(`update public.products set moderation_decision_id = null where id = $1`, [
        productId,
      ]);
      await q.query(`delete from public.moderation_decisions where id = $1`, [decisionId]);
    });
    const { rows } = await asService((q) =>
      q.query(`select id from public.moderation_appeals where id = $1`, [appealId]),
    );
    expect(rows).toHaveLength(0);
  });
});
