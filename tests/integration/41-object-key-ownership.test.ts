/**
 * 20261021_object_key_ownership, against the replayed schema.
 *
 * A storage key that is NEW to a product or storefront must be the writer's
 * own upload, through any path, including a direct PostgREST update the app's
 * isOwnedObjectKey never sees. What is proven here:
 *   - a seller cannot put another seller's key on their own product (image,
 *     gallery, document or download) or in their storefront's config;
 *   - nor an arbitrary https:// address;
 *   - their own uploads go through, on insert and update;
 *   - keys already on the row stay valid whoever uploaded them: an editor can
 *     save the owner's product without touching the owner's photo, and add
 *     their own;
 *   - the service role is not gated (seeding, admin tools, the deletion job).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, closePool, createUser, expectDbError, type TestUser } from "../db/client";

afterAll(closePool);

const key = (prefix: string, owner: TestUser) => `${prefix}/${owner.id}/${randomUUID()}-photo.jpg`;

let alice: TestUser;
let bob: TestUser;
let editor: TestUser;
let productId: string;
let storefrontId: string;

beforeAll(async () => {
  alice = await createUser();
  bob = await createUser();
  editor = await createUser();
  await asService((q) =>
    q.query(
      `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'editor', 'active', now())`,
      [alice.id, editor.id, editor.email],
    ),
  );
  productId = await asUser(alice, async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, image_key)
       values ($1, 'Lamp', 1500, $2) returning id`,
      [alice.id, key("images", alice)],
    );
    return rows[0].id;
  });
  storefrontId = await asUser(alice, async (q) => {
    const { rows } = await q.query(
      `insert into public.storefronts (owner_id, name) values ($1, 'Alice shop') returning id`,
      [alice.id],
    );
    return rows[0].id;
  });
});

describe("a key new to the row", () => {
  it("cannot be another seller's upload", async () => {
    const theirs = key("images", bob);
    for (const sql of [
      `update public.products set image_key = $2 where id = $1`,
      `update public.products set gallery = jsonb_build_array(jsonb_build_object('key', $2::text, 'alt', '')) where id = $1`,
      `update public.products set documents = jsonb_build_array(jsonb_build_object('key', $2::text, 'label', 'Manual')) where id = $1`,
    ]) {
      const msg = await expectDbError(asUser(alice, (q) => q.query(sql, [productId, theirs])));
      expect(msg).toMatch(/uploading it, not by naming it/);
    }
    const file = await expectDbError(
      asUser(alice, (q) =>
        q.query(`update public.products set digital_file_key = $2 where id = $1`, [productId, key("files", bob)]),
      ),
    );
    expect(file).toMatch(/uploading it, not by naming it/);
  });

  it("cannot be someone else's upload inside a storefront config", async () => {
    const msg = await expectDbError(
      asUser(alice, (q) =>
        q.query(
          `update public.storefronts
              set config = jsonb_build_object('theme', jsonb_build_object('customFont', jsonb_build_object('key', $2::text)))
            where id = $1`,
          [storefrontId, key("fonts", bob)],
        ),
      ),
    );
    expect(msg).toMatch(/uploading it, not by naming it/);
  });

  it("cannot be an address on another website", async () => {
    const msg = await expectDbError(
      asUser(alice, (q) =>
        q.query(`update public.products set image_key = 'https://example.net/a.jpg' where id = $1`, [productId]),
      ),
    );
    expect(msg).toMatch(/uploading it, not by naming it/);
  });

  it("goes through when it is the writer's own upload", async () => {
    const mine = key("images", alice);
    const { rowCount } = await asUser(alice, (q) =>
      q.query(
        `update public.products
            set gallery = jsonb_build_array(jsonb_build_object('key', $2::text, 'alt', '')) where id = $1`,
        [productId, mine],
      ),
    );
    expect(rowCount).toBe(1);
  });
});

describe("keys already on the row", () => {
  it("stay valid for a teammate who saves without touching them, and theirs can be added", async () => {
    const { rowCount } = await asUser(editor, (q) =>
      q.query(
        `update public.products
            set image_key = image_key,
                gallery = coalesce(gallery, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('key', $2::text, 'alt', ''))
          where id = $1`,
        [productId, key("images", editor)],
      ),
    );
    expect(rowCount).toBe(1);
  });
});

describe("the service role", () => {
  it("is not gated", async () => {
    const { rowCount } = await asService((q) =>
      q.query(`update public.products set image_key = $2 where id = $1`, [productId, key("images", bob)]),
    );
    expect(rowCount).toBe(1);
  });
});
