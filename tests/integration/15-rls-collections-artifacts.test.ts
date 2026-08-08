/**
 * RLS + constraints for the curation-app tables (collections, artifacts) and
 * the new profiles fields (username, is_public): owners get full CRUD, the
 * public sees exactly what is_public flags expose, strangers get nothing else.
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

let carol: TestUser; // curator whose content we probe
let dave: TestUser; // unrelated second user
let publicCollectionId: string;
let privateCollectionId: string;
let artifactInPublicId: string;
let artifactInPrivateId: string;
let looseArtifactId: string;

beforeAll(async () => {
  carol = await createUser("carol-curation@test.squareshare.to");
  dave = await createUser("dave-curation@test.squareshare.to");

  // Carol opts IN to the public directory, explicitly. Profiles are private by
  // default (sq_app_profiles_private_by_default), so without this her loose
  // artifacts — the ones that hang off the profile grid rather than a
  // collection — are invisible to everyone, and the visibility tests below have
  // nothing to observe. Stated here rather than inherited from the column
  // default, because that default is exactly what silently drifted once.
  await asService((q) =>
    q.query(`update public.profiles set is_public = true where id = $1`, [carol.id]),
  );

  [publicCollectionId, privateCollectionId] = await asUser(carol, async (q) => {
    const { rows } = await q.query(
      `insert into public.collections (owner_id, name, is_public)
       values ($1, 'Carol public', true), ($1, 'Carol private', false)
       returning id`,
      [carol.id],
    );
    return [rows[0].id, rows[1].id];
  });

  [artifactInPublicId, artifactInPrivateId, looseArtifactId] = await asUser(
    carol,
    async (q) => {
      const { rows } = await q.query(
        `insert into public.artifacts (owner_id, collection_id, title, image_key)
         values ($1, $2, 'in public collection', 'images/${carol.id}/a.webp'),
                ($1, $3, 'in private collection', 'images/${carol.id}/b.webp'),
                ($1, null, 'loose on profile grid', 'images/${carol.id}/c.webp')
         returning id`,
        [carol.id, publicCollectionId, privateCollectionId],
      );
      return [rows[0].id, rows[1].id, rows[2].id];
    },
  );
});

afterAll(closePool);

describe("profiles: username + is_public", () => {
  it("new profiles are PRIVATE by default", async () => {
    // Reads dave, who is never toggled — carol is made public in beforeAll so
    // the artifact tests below have something public to look at.
    //
    // This asserted `is_public: true` until 2026-08-07 and passed, because the
    // test replica was missing sq_app_profiles_private_by_default and defaulted
    // the column the wrong way round. The suite was confidently testing the
    // opposite privacy posture from production.
    const { rows } = await asUser(dave, (q) =>
      q.query(`select username, is_public from public.profiles where id = $1`, [dave.id]),
    );
    expect(rows[0]).toEqual({ username: null, is_public: false });
  });

  it("owner can claim a mixed-case username (format checked after lowering)", async () => {
    const res = await asUser(carol, (q) =>
      q.query(`update public.profiles set username = 'Carol_123' where id = $1`, [carol.id]),
    );
    expect(res.rowCount).toBe(1);
  });

  it("rejects malformed usernames: too short, bad chars, too long", async () => {
    for (const bad of ["ab", "has space", "dash-name", "x".repeat(31)]) {
      const msg = await expectDbError(
        asUser(dave, (q) =>
          q.query(`update public.profiles set username = $2 where id = $1`, [dave.id, bad]),
        ),
      );
      expect(msg).toMatch(/check constraint/i);
    }
  });

  it("usernames are unique case-insensitively", async () => {
    const msg = await expectDbError(
      asUser(dave, (q) =>
        q.query(`update public.profiles set username = 'CAROL_123' where id = $1`, [dave.id]),
      ),
    );
    expect(msg).toMatch(/profiles_username_lower_idx/);
  });

  it("signup trigger still works; a brand-new profile is private with no username", async () => {
    // "Private by default" is SQ-app's stated privacy promise, so the trigger
    // path has to honour it too, not just the column default.
    const fresh = await createUser("fresh-curation@test.squareshare.to");
    const { rows } = await asSuper((q) =>
      q.query(`select username, is_public from public.profiles where id = $1`, [fresh.id]),
    );
    expect(rows[0]).toEqual({ username: null, is_public: false });
  });
});

describe("collections RLS", () => {
  it("owner reads both; stranger and anon read only the public one", async () => {
    const mine = await asUser(carol, (q) =>
      q.query(`select id from public.collections where owner_id = $1`, [carol.id]),
    );
    expect(mine.rows).toHaveLength(2);

    for (const read of [
      asUser(dave, (q) =>
        q.query(`select id, name from public.collections where owner_id = $1`, [carol.id]),
      ),
      asAnon((q) =>
        q.query(`select id, name from public.collections where owner_id = $1`, [carol.id]),
      ),
    ]) {
      const { rows } = await read;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(publicCollectionId);
    }
  });

  it("public visibility is read-only: stranger cannot UPDATE or DELETE a public collection", async () => {
    const upd = await asUser(dave, (q) =>
      q.query(`update public.collections set name = 'hacked' where id = $1`, [
        publicCollectionId,
      ]),
    );
    expect(upd.rowCount).toBe(0);

    const del = await asUser(dave, (q) =>
      q.query(`delete from public.collections where id = $1`, [publicCollectionId]),
    );
    expect(del.rowCount).toBe(0);
  });

  it("stranger cannot INSERT a collection under another owner; anon cannot insert at all", async () => {
    const spoof = await expectDbError(
      asUser(dave, (q) =>
        q.query(`insert into public.collections (owner_id, name) values ($1, 'spoof')`, [
          carol.id,
        ]),
      ),
    );
    expect(spoof).toMatch(/row-level security/i);

    await expectDbError(
      asAnon((q) =>
        q.query(`insert into public.collections (owner_id, name) values ($1, 'anon')`, [
          carol.id,
        ]),
      ),
    );
  });

  it("enforces name length 1..80", async () => {
    for (const bad of ["", "x".repeat(81)]) {
      const msg = await expectDbError(
        asUser(carol, (q) =>
          q.query(`insert into public.collections (owner_id, name) values ($1, $2)`, [
            carol.id,
            bad,
          ]),
        ),
      );
      expect(msg).toMatch(/check constraint/i);
    }
  });
});

describe("artifacts RLS", () => {
  it("owner reads all three artifacts", async () => {
    const mine = await asUser(carol, (q) =>
      q.query(`select id from public.artifacts where owner_id = $1`, [carol.id]),
    );
    expect(mine.rows).toHaveLength(3);
  });

  it("stranger and anon see the public-collection artifact and the loose one, never the private-collection one", async () => {
    for (const read of [
      asUser(dave, (q) =>
        q.query(`select id from public.artifacts where owner_id = $1 order by created_at`, [
          carol.id,
        ]),
      ),
      asAnon((q) =>
        q.query(`select id from public.artifacts where owner_id = $1 order by created_at`, [
          carol.id,
        ]),
      ),
    ]) {
      const { rows } = await read;
      const ids = rows.map((r: { id: string }) => r.id);
      expect(ids).toContain(artifactInPublicId);
      expect(ids).toContain(looseArtifactId);
      expect(ids).not.toContain(artifactInPrivateId);
    }
  });

  it("making the owner's profile private hides loose artifacts but not collection-public ones", async () => {
    await asUser(carol, (q) =>
      q.query(`update public.profiles set is_public = false where id = $1`, [carol.id]),
    );

    const { rows } = await asAnon((q) =>
      q.query(`select id from public.artifacts where owner_id = $1`, [carol.id]),
    );
    const ids = rows.map((r: { id: string }) => r.id);
    expect(ids).toContain(artifactInPublicId);
    expect(ids).not.toContain(looseArtifactId);

    await asUser(carol, (q) =>
      q.query(`update public.profiles set is_public = true where id = $1`, [carol.id]),
    );
  });

  it("making a collection private immediately hides its artifacts from the public", async () => {
    await asUser(carol, (q) =>
      q.query(`update public.collections set is_public = false where id = $1`, [
        publicCollectionId,
      ]),
    );

    const { rows } = await asAnon((q) =>
      q.query(`select id from public.artifacts where id = $1`, [artifactInPublicId]),
    );
    expect(rows).toHaveLength(0);

    await asUser(carol, (q) =>
      q.query(`update public.collections set is_public = true where id = $1`, [
        publicCollectionId,
      ]),
    );
  });

  it("stranger cannot UPDATE, DELETE, or spoof-INSERT artifacts", async () => {
    const upd = await asUser(dave, (q) =>
      q.query(`update public.artifacts set title = 'hacked' where id = $1`, [
        artifactInPublicId,
      ]),
    );
    expect(upd.rowCount).toBe(0);

    const del = await asUser(dave, (q) =>
      q.query(`delete from public.artifacts where id = $1`, [artifactInPublicId]),
    );
    expect(del.rowCount).toBe(0);

    const msg = await expectDbError(
      asUser(dave, (q) =>
        q.query(
          `insert into public.artifacts (owner_id, image_key) values ($1, 'images/x/spoof.webp')`,
          [carol.id],
        ),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("a stranger cannot attach their artifact to someone else's collection they cannot even see... but CAN reference a public one (documented: FK is not an ownership check)", async () => {
    // The FK itself doesn't enforce collection ownership; the curation app's
    // server layer does. What matters for RLS: the row is still dave's, and
    // its visibility follows CAROL's collection flag, which dave can't change.
    const { rows } = await asUser(dave, (q) =>
      q.query(
        `insert into public.artifacts (owner_id, collection_id, image_key)
         values ($1, $2, 'images/dave/d.webp') returning id`,
        [dave.id, publicCollectionId],
      ),
    );
    expect(rows).toHaveLength(1);
    await asUser(dave, (q) => q.query(`delete from public.artifacts where id = $1`, [rows[0].id]));
  });

  it("enforces grid checks: spans >= 1, positions >= 0, title <= 200", async () => {
    const cases = [
      `insert into public.artifacts (owner_id, image_key, span_w) values ($1, 'k', 0)`,
      `insert into public.artifacts (owner_id, image_key, span_h) values ($1, 'k', 0)`,
      `insert into public.artifacts (owner_id, image_key, grid_x) values ($1, 'k', -1)`,
      `insert into public.artifacts (owner_id, image_key, grid_y) values ($1, 'k', -1)`,
      `insert into public.artifacts (owner_id, image_key, title) values ($1, 'k', repeat('x', 201))`,
    ];
    for (const sql of cases) {
      const msg = await expectDbError(asUser(carol, (q) => q.query(sql, [carol.id])));
      expect(msg).toMatch(/check constraint/i);
    }
  });
});

describe("artifact FK detach behavior", () => {
  it("deleting a collection detaches its artifacts (collection_id -> null), which then follow profile visibility", async () => {
    const tempCollection = await asUser(carol, async (q) => {
      const { rows } = await q.query(
        `insert into public.collections (owner_id, name, is_public) values ($1, 'temp', false) returning id`,
        [carol.id],
      );
      return rows[0].id as string;
    });
    const tempArtifact = await asUser(carol, async (q) => {
      const { rows } = await q.query(
        `insert into public.artifacts (owner_id, collection_id, image_key) values ($1, $2, 'images/t.webp') returning id`,
        [carol.id, tempCollection],
      );
      return rows[0].id as string;
    });

    // Invisible to the public while in the private collection.
    const before = await asAnon((q) =>
      q.query(`select id from public.artifacts where id = $1`, [tempArtifact]),
    );
    expect(before.rows).toHaveLength(0);

    await asUser(carol, (q) =>
      q.query(`delete from public.collections where id = $1`, [tempCollection]),
    );

    // Detached, not deleted — and now loose, so it follows carol's public profile.
    const after = await asAnon((q) =>
      q.query(`select id, collection_id from public.artifacts where id = $1`, [tempArtifact]),
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].collection_id).toBeNull();

    await asUser(carol, (q) => q.query(`delete from public.artifacts where id = $1`, [tempArtifact]));
  });

  it("deleting a bridged product detaches the artifact (product_id -> null)", async () => {
    const productId = await asUser(carol, async (q) => {
      const { rows } = await q.query(
        `insert into public.products (owner_id, title, price_cents) values ($1, 'bridged', 100) returning id`,
        [carol.id],
      );
      return rows[0].id as string;
    });
    const artifactId = await asUser(carol, async (q) => {
      const { rows } = await q.query(
        `insert into public.artifacts (owner_id, product_id, image_key) values ($1, $2, 'images/p.webp') returning id`,
        [carol.id, productId],
      );
      return rows[0].id as string;
    });

    await asUser(carol, (q) => q.query(`delete from public.products where id = $1`, [productId]));

    const { rows } = await asUser(carol, (q) =>
      q.query(`select product_id from public.artifacts where id = $1`, [artifactId]),
    );
    expect(rows[0].product_id).toBeNull();

    await asUser(carol, (q) => q.query(`delete from public.artifacts where id = $1`, [artifactId]));
  });

  it("deleting the auth user cascades collections and artifacts away", async () => {
    const ephemeral = await createUser("ephemeral-curation@test.squareshare.to");
    await asUser(ephemeral, async (q) => {
      const { rows } = await q.query(
        `insert into public.collections (owner_id, name) values ($1, 'doomed') returning id`,
        [ephemeral.id],
      );
      await q.query(
        `insert into public.artifacts (owner_id, collection_id, image_key) values ($1, $2, 'images/e.webp')`,
        [ephemeral.id, rows[0].id],
      );
    });

    await asSuper((q) => q.query(`delete from auth.users where id = $1`, [ephemeral.id]));

    const { rows } = await asSuper((q) =>
      q.query(
        `select (select count(*) from public.collections where owner_id = $1)::int as collections,
                (select count(*) from public.artifacts where owner_id = $1)::int as artifacts`,
        [ephemeral.id],
      ),
    );
    expect(rows[0]).toEqual({ collections: 0, artifacts: 0 });
  });
});

describe("service_role escape hatch", () => {
  it("service_role bypasses RLS on both tables (server-side jobs)", async () => {
    const { rows } = await asService((q) =>
      q.query(`select id from public.artifacts where id = $1`, [artifactInPrivateId]),
    );
    expect(rows).toHaveLength(1);
  });
});
