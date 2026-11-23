/**
 * 20261123_product_photo_edge, against the replayed schema.
 *
 * What is at a product photo's edges, stored with the product
 * (src/lib/storefront/photo-edge.ts). What is proven here:
 *   - only 'white', 'other' or nothing is stored;
 *   - the owner and an editor of the store can store it, a viewer and
 *     another seller cannot;
 *   - the answer follows the photo: any write that changes image_key clears
 *     it, the service role's included, so a replaced photo never inherits it;
 *   - storing it is no edit: updated_at, the moderation revision and the
 *     moderation status stay as they were, while every other write still
 *     moves updated_at as before.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, closePool, createUser, expectDbError, type TestUser } from "../db/client";

afterAll(closePool);

const photo = (owner: TestUser) => `images/${owner.id}/${randomUUID()}-photo.jpg`;

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let stranger: TestUser;

beforeAll(async () => {
  owner = await createUser();
  editor = await createUser();
  viewer = await createUser();
  stranger = await createUser();
  await asService(async (q) => {
    for (const [member, role] of [
      [editor, "editor"],
      [viewer, "viewer"],
    ] as const) {
      await q.query(
        `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
         values ($1, $2, $3, $4, 'active', now())`,
        [owner.id, member.id, member.email, role],
      );
    }
  });
});

async function newProduct(): Promise<{ id: string; key: string }> {
  const key = photo(owner);
  const id = await asUser(owner, async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, image_key) values ($1, 'Lamp', 1500, $2) returning id`,
      [owner.id, key],
    );
    return rows[0].id as string;
  });
  return { id, key };
}

const read = (id: string) =>
  asService(async (q) => {
    const { rows } = await q.query(
      `select photo_edge, image_key, updated_at, moderation_rev, moderation_status from public.products where id = $1`,
      [id],
    );
    return rows[0] as {
      photo_edge: string | null;
      image_key: string | null;
      updated_at: Date;
      moderation_rev: number;
      moderation_status: string;
    };
  });

const store = (user: TestUser, id: string, key: string, edge: string) =>
  asUser(user, (q) =>
    q.query(`update public.products set photo_edge = $3 where id = $1 and image_key = $2`, [id, key, edge]),
  );

describe("what may be stored", () => {
  it("is white, other or nothing", async () => {
    const { id, key } = await newProduct();
    expect((await store(owner, id, key, "white")).rowCount).toBe(1);
    expect((await store(owner, id, key, "other")).rowCount).toBe(1);
    const msg = await expectDbError(store(owner, id, key, "grey"));
    expect(msg).toMatch(/products_photo_edge_check/);
    expect((await read(id)).photo_edge).toBe("other");
  });

  it("is stored by the store's owner and editors, never a viewer or another seller", async () => {
    const { id, key } = await newProduct();
    expect((await store(editor, id, key, "white")).rowCount).toBe(1);
    expect((await store(viewer, id, key, "other")).rowCount).toBe(0);
    expect((await store(stranger, id, key, "other")).rowCount).toBe(0);
    expect((await read(id)).photo_edge).toBe("white");
  });

  it("lands nowhere when the photo named is not the product's", async () => {
    const { id } = await newProduct();
    expect((await store(owner, id, photo(owner), "white")).rowCount).toBe(0);
    expect((await read(id)).photo_edge).toBeNull();
  });
});

describe("the answer follows the photo", () => {
  it("is cleared by a new photo, a removed one, and a service-role write alike", async () => {
    const { id, key } = await newProduct();
    await store(owner, id, key, "white");
    const next = photo(owner);
    await asUser(owner, (q) => q.query(`update public.products set image_key = $2 where id = $1`, [id, next]));
    expect(await read(id)).toMatchObject({ image_key: next, photo_edge: null });

    await store(owner, id, next, "white");
    await asUser(owner, (q) => q.query(`update public.products set image_key = null where id = $1`, [id]));
    expect((await read(id)).photo_edge).toBeNull();

    const third = photo(owner);
    await asService((q) => q.query(`update public.products set image_key = $2 where id = $1`, [id, third]));
    await store(owner, id, third, "other");
    await asService((q) => q.query(`update public.products set image_key = $2 where id = $1`, [id, photo(owner)]));
    expect((await read(id)).photo_edge).toBeNull();
  });

  it("stays when the photo stays, whatever else is saved", async () => {
    const { id, key } = await newProduct();
    await store(owner, id, key, "white");
    await asUser(owner, (q) =>
      q.query(`update public.products set title = 'Lamp, oak', image_key = $2 where id = $1`, [id, key]),
    );
    expect((await read(id)).photo_edge).toBe("white");
  });
});

describe("storing it is no edit", () => {
  it("leaves updated_at and the moderation state alone, and nothing else changes that", async () => {
    const { id, key } = await newProduct();
    const before = await read(id);
    await store(owner, id, key, "white");
    const after = await read(id);
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
    expect(after.moderation_rev).toBe(before.moderation_rev);
    expect(after.moderation_status).toBe(before.moderation_status);

    await asUser(owner, (q) => q.query(`update public.products set low_stock_threshold = 4 where id = $1`, [id]));
    expect((await read(id)).updated_at.getTime()).toBeGreaterThan(after.updated_at.getTime());
  });
});
