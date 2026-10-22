/**
 * The moderation wall, at the level only the database can answer.
 *
 * The claim made everywhere else is "nothing a seller writes is public until
 * that exact version has been approved". An app can only promise that for the
 * writes that go through it, and a seller holds a publishable key and an
 * RLS-permitted INSERT/UPDATE on their own rows. So the promise is kept by
 * moderation_gate, and it is tested here as the control it is: through the
 * same roles PostgREST uses, with no application code in the way.
 */
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

/** The seller's id, and so the uploader segment of every key below: a key new
 *  to a row must be the writer's own upload (20261021_object_key_ownership). */
const SELLER_ID = "11111111-1111-4111-8111-111111111111";

const IMAGE_KEY =
  "images/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222-mug.jpg";
const OTHER_IMAGE_KEY =
  "images/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333-cup.jpg";
const PDF_KEY =
  "documents/11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444444-manual.pdf";
const FONT_KEY =
  "fonts/11111111-1111-4111-8111-111111111111/55555555-5555-4555-8555-555555555555-brand.woff2";

type Claim = {
  rev: number;
  status: string;
  checked: boolean;
  owner_id: string;
  title: string;
  lines: string[];
  text_subject: string | null;
  media: { kind: string; key: string; subject: string; path: string }[];
};

let seller: TestUser;
let other: TestUser;

async function insertProduct(
  user: TestUser,
  fields: { title: string; description?: string; image_key?: string | null },
): Promise<string> {
  return asUser(user, async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, description, image_key, price_cents, status)
       values ($1, $2, $3, $4, 2500, 'active') returning id`,
      [user.id, fields.title, fields.description ?? null, fields.image_key ?? null],
    );
    return rows[0].id as string;
  });
}

async function state(table: string, id: string) {
  const { rows } = await asService((q) =>
    q.query(
      `select moderation_status as status, moderation_rev as rev,
              moderation_checked_at as checked_at, moderation_ground as ground
         from public.${table} where id = $1`,
      [id],
    ),
  );
  return rows[0] as { status: string; rev: number; checked_at: string | null; ground: string | null };
}

async function claim(type: string, id: string): Promise<Claim> {
  const { rows } = await asService((q) =>
    q.query(`select public.moderation_claim($1, $2) as c`, [type, id]),
  );
  return rows[0].c as Claim;
}

/** What the checker does once it has an answer for a part. */
async function judge(subject: string, verdict: string, ground: string | null = null) {
  await asService((q) =>
    q.query(
      `insert into public.moderation_checks (subject, verdict, ground, source, model)
       values ($1, $2, $3, 'model', 'test')
       on conflict (subject) do nothing`,
      [subject, verdict, ground],
    ),
  );
}

async function settle(
  type: string,
  id: string,
  rev: number,
  ground: string | null = null,
  fields: string[] | null = null,
) {
  const { rows } = await asService((q) =>
    q.query(`select public.moderation_settle($1, $2, $3, $4, $5) as r`, [
      type,
      id,
      rev,
      ground,
      fields,
    ]),
  );
  return rows[0].r as { outcome: string; decision_id?: string; fields?: string[] };
}

/** Judge every part clean and settle: the happy path, start to finish. */
async function approve(type: string, id: string) {
  const c = await claim(type, id);
  if (c.text_subject) await judge(c.text_subject, "clean");
  for (const part of c.media) await judge(part.subject, "clean");
  return settle(type, id, c.rev);
}

beforeAll(async () => {
  seller = await createUser("seller-wall@test.squareshare.to", {}, SELLER_ID);
  other = await createUser("other-wall@test.squareshare.to");
});

afterAll(closePool);

describe("a seller's write", () => {
  it("starts hidden, whatever route it came by", async () => {
    const id = await insertProduct(seller, { title: "Wall mug one" });
    const row = await state("products", id);
    expect(row.status).toBe("pending");
    expect(row.rev).toBe(1);
    expect(row.checked_at).toBeNull();
  });

  it("cannot arrive already approved", async () => {
    const id = await asUser(seller, async (q) => {
      const { rows } = await q.query(
        `insert into public.products
           (owner_id, title, price_cents, status, moderation_status, moderation_checked_at, moderation_rev)
         values ($1, 'Wall mug smuggled', 2500, 'active', 'ok', now(), 99) returning id`,
        [seller.id],
      );
      return rows[0].id as string;
    });
    const row = await state("products", id);
    expect(row.status).toBe("pending");
    expect(row.rev).toBe(1);
    expect(row.checked_at).toBeNull();
  });

  it("cannot move the revision or the audit marker afterwards", async () => {
    const id = await insertProduct(seller, { title: "Wall mug guarded" });
    for (const assignment of ["moderation_rev = 7", "moderation_checked_at = now()", "moderation_status = 'ok'"]) {
      const message = await expectDbError(
        asUser(seller, (q) =>
          q.query(`update public.products set ${assignment} where id = $1`, [id]),
        ),
      );
      expect(message).toMatch(/set by SquareShare staff/);
    }
  });

  it("is left alone when written by the server's own role", async () => {
    const id = await asService(async (q) => {
      const { rows } = await q.query(
        `insert into public.products (owner_id, title, price_cents, status)
         values ($1, 'Wall mug seeded', 2500, 'active') returning id`,
        [seller.id],
      );
      return rows[0].id as string;
    });
    const row = await state("products", id);
    // Live, as a fixture expects, and on the audit list because nothing has
    // looked at it.
    expect(row.status).toBe("ok");
    expect(row.checked_at).toBeNull();
    const { rows } = await asService((q) =>
      q.query(`select target_id from public.moderation_due(200)`),
    );
    expect(rows.map((r) => r.target_id)).toContain(id);
  });
});

describe("the parts of a row", () => {
  it("are its words, its images and its PDFs, and nothing that cannot carry words", async () => {
    const id = await asUser(seller, async (q) => {
      const { rows } = await q.query(
        `insert into public.products
           (owner_id, title, description, image_key, gallery, documents, details, price_cents, status)
         values ($1, 'Parts mug', 'Glazed by hand.', $2, $3::jsonb, $4::jsonb, $5::jsonb, 2500, 'active')
         returning id`,
        [
          seller.id,
          IMAGE_KEY,
          JSON.stringify([{ key: OTHER_IMAGE_KEY, alt: "Side view" }]),
          JSON.stringify([{ key: PDF_KEY, label: "Care sheet" }]),
          JSON.stringify({
            materials: "Stoneware",
            accent: "#ff8800",
            ref: "9b2f6c1e-3d4a-4f5b-8c6d-7e8f9a0b1c2d",
            font: FONT_KEY,
          }),
        ],
      );
      return rows[0].id as string;
    });

    const c = await claim("product", id);
    expect(c.lines).toEqual(
      expect.arrayContaining([
        "title=Parts mug",
        "description=Glazed by hand.",
        "gallery[].alt=Side view",
        "documents[].label=Care sheet",
        "details.materials=Stoneware",
      ]),
    );
    // A colour, an id and a font file are not text anybody can object to.
    expect(c.lines.join("\n")).not.toMatch(/ff8800|9b2f6c1e|fonts\//);
    expect(c.text_subject).toMatch(/^text:[0-9a-f]{32}$/);
    expect(c.media.map((m) => m.subject).sort()).toEqual(
      [`image:${IMAGE_KEY}`, `image:${OTHER_IMAGE_KEY}`, `pdf:${PDF_KEY}`].sort(),
    );
    expect(c.media.find((m) => m.key === OTHER_IMAGE_KEY)?.path).toBe("gallery[].key");
  });

  it("are the same before the write as after it", async () => {
    const id = await insertProduct(seller, { title: "Preview mug", description: "First words." });
    const { rows } = await asService((q) =>
      q.query(`select public.moderation_preview('product', $1, $2::jsonb) as p`, [
        id,
        JSON.stringify({ description: "Second words.", price_cents: 100 }),
      ]),
    );
    const preview = rows[0].p as Claim;
    expect(preview.lines).toEqual(
      expect.arrayContaining(["title=Preview mug", "description=Second words."]),
    );

    await asUser(seller, (q) =>
      q.query(`update public.products set description = 'Second words.' where id = $1`, [id]),
    );
    expect((await claim("product", id)).text_subject).toBe(preview.text_subject);
  });
});

describe("settling", () => {
  it("does nothing while a part is still unjudged", async () => {
    const id = await insertProduct(seller, { title: "Unjudged mug", image_key: IMAGE_KEY });
    const c = await claim("product", id);
    await judge(c.text_subject!, "clean");
    expect((await settle("product", id, c.rev)).outcome).toBe("unchecked");
    expect((await state("products", id)).status).toBe("pending");
  });

  it("publishes once every part is clean", async () => {
    const id = await insertProduct(seller, { title: "Clean mug", image_key: IMAGE_KEY });
    expect((await approve("product", id)).outcome).toBe("ok");
    const row = await state("products", id);
    expect(row.status).toBe("ok");
    expect(row.checked_at).not.toBeNull();
  });

  it("refuses an outcome worked out for words that have since changed", async () => {
    const id = await insertProduct(seller, { title: "Stale mug" });
    const before = await claim("product", id);
    await judge(before.text_subject!, "clean");
    await asUser(seller, (q) =>
      q.query(`update public.products set title = 'Stale mug, rewritten' where id = $1`, [id]),
    );
    expect((await settle("product", id, before.rev)).outcome).toBe("stale");
    expect((await state("products", id)).status).toBe("pending");
  });

  it("cannot be talked into publishing: only the approved list decides", async () => {
    const id = await insertProduct(seller, { title: "Refused mug" });
    const c = await claim("product", id);
    await judge(c.text_subject!, "violation", "hate");
    // A caller passing no ground and no fields still cannot get 'ok'.
    const result = await settle("product", id, c.rev);
    expect(result.outcome).toBe("paused");
    expect((await state("products", id)).status).toBe("paused");
  });
});

describe("an approved row", () => {
  let id: string;

  beforeAll(async () => {
    id = await insertProduct(seller, { title: "Live mug", description: "Approved words." });
    await approve("product", id);
  });

  it("stays live through an edit that changes no content", async () => {
    await asUser(seller, (q) =>
      q.query(`update public.products set price_cents = 2600, status = 'draft' where id = $1`, [id]),
    );
    const row = await state("products", id);
    expect(row.status).toBe("ok");
    expect(row.rev).toBe(1);
  });

  it("goes back to pending the moment its words change", async () => {
    await asUser(seller, (q) =>
      q.query(`update public.products set description = 'Brand new words.' where id = $1`, [id]),
    );
    const row = await state("products", id);
    expect(row.status).toBe("pending");
    expect(row.rev).toBe(2);
    expect(row.checked_at).toBeNull();
  });

  it("passes inline when the new content is already on the approved list", async () => {
    // Back to the exact words that were approved: nothing to wait for.
    await asUser(seller, (q) =>
      q.query(`update public.products set description = 'Approved words.' where id = $1`, [id]),
    );
    const row = await state("products", id);
    expect(row.status).toBe("ok");
    expect(row.checked_at).not.toBeNull();
  });

  it("is hidden again by a new image nobody has judged", async () => {
    await asUser(seller, (q) =>
      q.query(`update public.products set image_key = $2 where id = $1`, [
        id,
        "images/11111111-1111-4111-8111-111111111111/66666666-6666-4666-8666-666666666666-new.jpg",
      ]),
    );
    expect((await state("products", id)).status).toBe("pending");
  });
});

describe("a violation", () => {
  let id: string;
  let decisionId: string;

  it("pauses the listing and records an automated decision", async () => {
    id = await insertProduct(seller, { title: "Banned mug", description: "Words that break the rules." });
    const c = await claim("product", id);
    await judge(c.text_subject!, "violation", "illegal");
    const result = await settle("product", id, c.rev, "illegal", ["description"]);
    expect(result.outcome).toBe("paused");
    decisionId = result.decision_id!;

    const { rows } = await asService((q) =>
      q.query(
        `select p.moderation_status, p.moderation_ground, p.moderation_fields, p.moderation_decision_id,
                d.automated, d.action, d.ground, d.fields, d.decided_by, d.target_title
           from public.products p
           join public.moderation_decisions d on d.id = p.moderation_decision_id
          where p.id = $1`,
        [id],
      ),
    );
    expect(rows[0]).toMatchObject({
      moderation_status: "paused",
      moderation_ground: "illegal",
      moderation_fields: ["description"],
      moderation_decision_id: decisionId,
      automated: true,
      action: "paused",
      ground: "illegal",
      fields: ["description"],
      decided_by: null,
      target_title: "Banned mug",
    });
  });

  it("lets the seller read the decision, as they can a person's", async () => {
    const { rows } = await asUser(seller, (q) =>
      q.query(`select automated from public.moderation_decisions where id = $1`, [decisionId]),
    );
    expect(rows).toEqual([{ automated: true }]);
    const stranger = await asUser(other, (q) =>
      q.query(`select automated from public.moderation_decisions where id = $1`, [decisionId]),
    );
    expect(stranger.rows).toHaveLength(0);
  });

  it("is checked again when the seller edits, with no person in the loop", async () => {
    await asUser(seller, (q) =>
      q.query(`update public.products set description = 'Rewritten, harmless.' where id = $1`, [id]),
    );
    const { rows } = await asService((q) =>
      q.query(
        `select moderation_status, moderation_ground, moderation_fields, moderation_decision_id
           from public.products where id = $1`,
        [id],
      ),
    );
    // The old finding is gone with the words it was about.
    expect(rows[0]).toEqual({
      moderation_status: "pending",
      moderation_ground: null,
      moderation_fields: null,
      moderation_decision_id: null,
    });
    expect((await approve("product", id)).outcome).toBe("ok");
  });

  it("removes an artifact, which has no way to be fixed and sent back", async () => {
    const artifactId = await asUser(seller, async (q) => {
      const { rows } = await q.query(
        `insert into public.artifacts (owner_id, title, image_key) values ($1, 'Wall artifact', $2) returning id`,
        [
          seller.id,
          "artifacts/11111111-1111-4111-8111-111111111111/77777777-7777-4777-8777-777777777777-art.jpg",
        ],
      );
      return rows[0].id as string;
    });
    expect((await state("artifacts", artifactId)).status).toBe("pending");
    const c = await claim("artifact", artifactId);
    await judge(c.text_subject!, "clean");
    await judge(c.media[0].subject, "violation", "sexual");
    expect((await settle("artifact", artifactId, c.rev)).outcome).toBe("removed");
    const row = await state("artifacts", artifactId);
    expect(row.status).toBe("removed");
    expect(row.ground).toBe("sexual");
  });
});

describe("a pause a person imposed", () => {
  it("is not undone by an edit: that person decides", async () => {
    const id = await insertProduct(seller, { title: "Staff paused mug" });
    await approve("product", id);
    await asService((q) =>
      q.query(
        `with d as (
           insert into public.moderation_decisions
             (target_type, target_id, owner_id, target_title, action, ground, fields)
           values ('product', $1, $2, 'Staff paused mug', 'paused', 'other', array['title'])
           returning id)
         update public.products
            set moderation_status = 'paused', moderation_ground = 'other',
                moderation_fields = array['title'], moderation_decision_id = (select id from d)
          where id = $1`,
        [id, seller.id],
      ),
    );
    await asUser(seller, (q) =>
      q.query(`update public.products set title = 'Staff paused mug, fixed' where id = $1`, [id]),
    );
    const row = await state("products", id);
    expect(row.status).toBe("paused");
    expect(row.ground).toBe("other");
  });

  it("nor is a removal", async () => {
    const id = await insertProduct(seller, { title: "Removed mug" });
    await asService((q) =>
      q.query(`update public.products set moderation_status = 'removed' where id = $1`, [id]),
    );
    await asUser(seller, (q) =>
      q.query(`update public.products set title = 'Removed mug, renamed' where id = $1`, [id]),
    );
    expect((await state("products", id)).status).toBe("removed");
  });
});

describe("an unsure verdict", () => {
  const heldImage =
    "images/11111111-1111-4111-8111-111111111111/88888888-8888-4888-8888-888888888888-held.jpg";
  let id: string;

  it("holds the row for a person", async () => {
    id = await insertProduct(seller, { title: "Held mug", image_key: heldImage });
    const c = await claim("product", id);
    await judge(c.text_subject!, "clean");
    await judge(`image:${heldImage}`, "unsure");
    expect((await settle("product", id, c.rev)).outcome).toBe("review");
    expect((await state("products", id)).status).toBe("review");
  });

  it("remembers a person's approval against the exact parts approved", async () => {
    // What the admin panel's restore does.
    await asService((q) =>
      q.query(`update public.products set moderation_status = 'ok' where id = $1`, [id]),
    );
    const { rows } = await asService((q) =>
      q.query(`select verdict, source from public.moderation_checks where subject = $1`, [
        `image:${heldImage}`,
      ]),
    );
    expect(rows).toEqual([{ verdict: "clean", source: "staff" }]);
  });

  it("so the same photo on another listing is not held twice", async () => {
    const second = await insertProduct(seller, { title: "Held mug", image_key: heldImage });
    // Same words, same photo, both approved: live with no check at all.
    expect((await state("products", second)).status).toBe("ok");
  });

  it("and the classifier cannot overwrite what a person decided", async () => {
    await judge(`image:${heldImage}`, "violation", "sexual");
    const { rows } = await asService((q) =>
      q.query(`select verdict, source from public.moderation_checks where subject = $1`, [
        `image:${heldImage}`,
      ]),
    );
    expect(rows).toEqual([{ verdict: "clean", source: "staff" }]);
  });
});

describe("a storefront", () => {
  let id: string;
  const config = (text: string, colour: string, x: number) => ({
    theme: { background: { kind: "color", color: colour } },
    header: { name: "Wall shop", bio: "Things for walls." },
    blocks: [
      { id: "0f8fad5b-d9cb-469f-a165-70867728950e", type: "text", text, x, y: 0, w: 2, h: 1 },
    ],
  });

  beforeAll(async () => {
    id = await asUser(other, async (q) => {
      const { rows } = await q.query(
        `insert into public.storefronts (owner_id, name, config) values ($1, 'Wall shop', $2::jsonb) returning id`,
        [other.id, JSON.stringify(config("Welcome in.", "#ffffff", 0))],
      );
      return rows[0].id as string;
    });
    await approve("storefront", id);
  });

  it("stays live when only the layout or a colour changes", async () => {
    await asUser(other, (q) =>
      q.query(`update public.storefronts set config = $2::jsonb where id = $1`, [
        id,
        JSON.stringify(config("Welcome in.", "#000000", 4)),
      ]),
    );
    expect((await state("storefronts", id)).status).toBe("ok");
  });

  it("is hidden when its words change", async () => {
    await asUser(other, (q) =>
      q.query(`update public.storefronts set config = $2::jsonb where id = $1`, [
        id,
        JSON.stringify(config("Something else entirely.", "#000000", 4)),
      ]),
    );
    expect((await state("storefronts", id)).status).toBe("pending");
  });
});

describe("the approved list and its functions", () => {
  it("are out of reach of a browser", async () => {
    for (const run of [
      () => asUser(seller, (q) => q.query(`select * from public.moderation_checks`)),
      () => asAnon((q) => q.query(`select * from public.moderation_checks`)),
      () =>
        asUser(seller, (q) =>
          q.query(`insert into public.moderation_checks (subject, verdict, source) values ('text:x', 'clean', 'staff')`),
        ),
      () => asUser(seller, (q) => q.query(`select public.moderation_all_clear('{}'::jsonb)`)),
      () => asUser(seller, (q) => q.query(`select public.moderation_claim('product', gen_random_uuid())`)),
      () =>
        asUser(seller, (q) =>
          q.query(`select public.moderation_settle('product', gen_random_uuid(), 1, null, null)`),
        ),
      () => asUser(seller, (q) => q.query(`select * from public.moderation_due(5)`)),
      () => asAnon((q) => q.query(`select public.moderation_recheck_all()`)),
    ]) {
      const message = await expectDbError(run());
      expect(message).toMatch(/permission denied/i);
    }
  });

  it("can be asked to look at everything again without hiding anything", async () => {
    const id = await insertProduct(seller, { title: "Recheck mug" });
    await approve("product", id);
    await asService((q) => q.query(`select public.moderation_recheck_all()`));

    const row = await state("products", id);
    expect(row.status).toBe("ok");
    expect(row.checked_at).toBeNull();
    const { rows } = await asService((q) =>
      q.query(
        `select source, count(*)::int as n from public.moderation_checks
          where subject not like 'handle:%' and subject not like 'avatar:%'
          group by source`,
      ),
    );
    // The classifier's answers about rows are gone; a person's stand. (What it
    // said about a handle or a picture is kept: see "the marketplace" below.)
    expect(rows.find((r) => r.source === "model")).toBeUndefined();
    expect(rows.find((r) => r.source === "staff")?.n).toBeGreaterThan(0);
  });
});

describe("the marketplace", () => {
  const artifactKey =
    "artifacts/11111111-1111-4111-8111-111111111111/99999999-9999-4999-8999-999999999999-art.jpg";
  let artifactId: string;

  const seenByAnyone = async () =>
    (await asAnon((q) => q.query(`select id from public.artifacts where id = $1`, [artifactId])))
      .rows.length;

  beforeAll(async () => {
    // A public profile under an approved handle, so a loose artifact has
    // somewhere to show: the tests below are then about the artifact alone.
    await judge("handle:wall_maker", "clean");
    await asUser(other, (q) =>
      q.query(`update public.profiles set username = 'wall_maker', is_public = true where id = $1`, [
        other.id,
      ]),
    );
    artifactId = await asUser(other, async (q) => {
      const { rows } = await q.query(
        `insert into public.artifacts (owner_id, title, image_key) values ($1, 'Wall piece', $2) returning id`,
        [other.id, artifactKey],
      );
      return rows[0].id as string;
    });
  });

  it("shows a visitor nothing that has not been approved, straight from the database", async () => {
    // The marketplace's public reads are RLS, not a server page: the gate has
    // to be in the policy, or it is one REST call away from not existing.
    expect((await state("artifacts", artifactId)).status).toBe("pending");
    expect(await seenByAnyone()).toBe(0);
    // Its owner still sees it, to know where it stands.
    const own = await asUser(other, (q) =>
      q.query(`select moderation_status from public.artifacts where id = $1`, [artifactId]),
    );
    expect(own.rows).toEqual([{ moderation_status: "pending" }]);

    expect((await approve("artifact", artifactId)).outcome).toBe("ok");
    expect(await seenByAnyone()).toBe(1);
  });

  it("hides it again the moment it is taken down", async () => {
    await asService((q) =>
      q.query(`update public.artifacts set moderation_status = 'removed' where id = $1`, [artifactId]),
    );
    expect(await seenByAnyone()).toBe(0);
    await asService((q) =>
      q.query(`update public.artifacts set moderation_status = 'ok' where id = $1`, [artifactId]),
    );
  });

  it("hides a profile's loose work when its handle is no longer an approved one", async () => {
    // The handle and the picture reach the public through the directory, and
    // the directory asks the approved list. A new handle nobody checked takes
    // the profile out of it, and what hangs off the profile goes with it.
    expect(await seenByAnyone()).toBe(1);
    await asUser(other, (q) =>
      q.query(`update public.profiles set username = 'wall_unchecked' where id = $1`, [other.id]),
    );
    const listed = await asAnon((q) =>
      q.query(`select id from public.public_profiles where id = $1`, [other.id]),
    );
    expect(listed.rows).toHaveLength(0);
    expect(await seenByAnyone()).toBe(0);
  });

  it("lets nobody but the server name a collection", async () => {
    const refused = await expectDbError(
      asUser(other, (q) =>
        q.query(`insert into public.collections (owner_id, name) values ($1, 'Named directly')`, [
          other.id,
        ]),
      ),
    );
    expect(refused).toMatch(/checked before it is saved/);

    const id = await asService(async (q) => {
      const { rows } = await q.query(
        `insert into public.collections (owner_id, name) values ($1, 'Named by the server') returning id`,
        [other.id],
      );
      return rows[0].id as string;
    });
    // The owner still runs their own collection: order and visibility are theirs.
    await asUser(other, (q) =>
      q.query(`update public.collections set is_public = true, sort_order = 3 where id = $1`, [id]),
    );
    const renamed = await expectDbError(
      asUser(other, (q) =>
        q.query(`update public.collections set name = 'Renamed directly' where id = $1`, [id]),
      ),
    );
    expect(renamed).toMatch(/checked before it is saved/);
  });

  it("keeps a handle's approval when the policy changes, and forgets a row's", async () => {
    await judge("text:00000000000000000000000000000000", "clean");
    await asService((q) => q.query(`select public.moderation_recheck_all()`));
    const { rows } = await asService((q) =>
      q.query(
        `select subject from public.moderation_checks
          where subject in ('handle:wall_maker', 'text:00000000000000000000000000000000')`,
      ),
    );
    // Rows are found again by the sweep, so forgetting their verdicts gets
    // them re-judged. A handle has no row to find: forgetting it would only
    // unlist the profile.
    expect(rows).toEqual([{ subject: "handle:wall_maker" }]);
  });
});

describe("seller text on the profile", () => {
  it("cannot be written by the seller directly", async () => {
    for (const assignment of [
      "tax_business_name = 'Direct Ltd'",
      "seller_bio = 'Direct bio'",
      `shipping_policy = '{"dispatch":"direct"}'::jsonb`,
    ]) {
      const message = await expectDbError(
        asUser(seller, (q) =>
          q.query(`update public.profiles set ${assignment} where id = $1`, [seller.id]),
        ),
      );
      expect(message).toMatch(/checked before it is saved/);
    }
  });

  it("is written by the server once the words have been checked", async () => {
    await asService((q) =>
      q.query(`update public.profiles set tax_business_name = 'Checked Ltd', seller_bio = 'Checked bio' where id = $1`, [
        seller.id,
      ]),
    );
    const { rows } = await asUser(seller, (q) =>
      q.query(`select tax_business_name, seller_bio from public.profiles where id = $1`, [seller.id]),
    );
    expect(rows[0]).toEqual({ tax_business_name: "Checked Ltd", seller_bio: "Checked bio" });
  });

  it("leaves every other profile column the seller's to edit", async () => {
    await asUser(seller, (q) =>
      q.query(`update public.profiles set seller_address = '1 Wall Street, Dublin' where id = $1`, [
        seller.id,
      ]),
    );
    const { rows } = await asUser(seller, (q) =>
      q.query(`select seller_address from public.profiles where id = $1`, [seller.id]),
    );
    expect(rows[0].seller_address).toBe("1 Wall Street, Dublin");
  });
});
