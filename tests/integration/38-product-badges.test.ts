/**
 * Badges and the moderation wall, at the level only the database can answer.
 *
 * Badges live inside `products.details`, which is a moderated column, so the
 * claim is that they need no wall of their own: a seller writing one straight
 * through the API (no app, no badge check) is hidden until that exact text is
 * approved, a badge's words are part of the row's fingerprint, and a badge
 * that breaks the rules pauses the listing with a fix field the decision's
 * CHECK accepts. Tested through the roles PostgREST uses, like 37.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, closePool, createUser, type TestUser } from "../db/client";

type Claim = { rev: number; lines: string[]; text_subject: string | null };

let seller: TestUser;

const BADGES = [
  { icon: "heart", label: "Loved by 250+ people" },
  { icon: "leaf", label: "Eco friendly" },
];

async function insertWithBadges(badges: unknown): Promise<string> {
  return asUser(seller, async (q) => {
    const { rows } = await q.query(
      `insert into public.products (owner_id, title, price_cents, status, details)
       values ($1, 'Badge bench', 4900, 'active', $2::jsonb) returning id`,
      [seller.id, JSON.stringify({ materials: "Oak", badges })],
    );
    return rows[0].id as string;
  });
}

async function setDetails(id: string, details: unknown) {
  await asUser(seller, (q) =>
    q.query(`update public.products set details = $2::jsonb where id = $1`, [id, JSON.stringify(details)]),
  );
}

async function status(id: string) {
  const { rows } = await asService((q) =>
    q.query(`select moderation_status as status, moderation_fields as fields from public.products where id = $1`, [id]),
  );
  return rows[0] as { status: string; fields: string[] | null };
}

async function claim(id: string): Promise<Claim> {
  const { rows } = await asService((q) => q.query(`select public.moderation_claim('product', $1) as c`, [id]));
  return rows[0].c as Claim;
}

async function judge(subject: string, verdict: string, ground: string | null = null) {
  await asService((q) =>
    q.query(
      `insert into public.moderation_checks (subject, verdict, ground, source, model)
       values ($1, $2, $3, 'model', 'test') on conflict (subject) do nothing`,
      [subject, verdict, ground],
    ),
  );
}

async function settle(id: string, rev: number, ground: string | null = null, fields: string[] | null = null) {
  const { rows } = await asService((q) =>
    q.query(`select public.moderation_settle('product', $1, $2, $3, $4) as r`, [id, rev, ground, fields]),
  );
  return rows[0].r as { outcome: string };
}

async function approve(id: string) {
  const c = await claim(id);
  if (c.text_subject) await judge(c.text_subject, "clean");
  return settle(id, c.rev);
}

beforeAll(async () => {
  seller = await createUser("seller-badges@test.squareshare.to");
});

afterAll(closePool);

describe("badges behind the moderation wall", () => {
  it("are hidden until approved when a seller writes them straight to the table", async () => {
    const id = await insertWithBadges(BADGES);
    expect((await status(id)).status).toBe("pending");
  });

  it("are part of the text the checker is shown, field by field", async () => {
    const id = await insertWithBadges(BADGES);
    const { lines } = await claim(id);
    expect(lines).toEqual(
      expect.arrayContaining([
        "details.badges[].label=Loved by 250+ people",
        "details.badges[].label=Eco friendly",
        "details.badges[].icon=heart",
        "details.materials=Oak",
      ]),
    );
  });

  it("take a live product back to pending the moment one is added", async () => {
    const id = await insertWithBadges([]);
    expect((await approve(id)).outcome).toBe("ok");
    expect((await status(id)).status).toBe("ok");

    await setDetails(id, { materials: "Oak", badges: [{ icon: "star", label: "Best weed in town" }] });

    expect((await status(id)).status).toBe("pending");
  });

  it("can be reordered on a live product without hiding it: order is not content", async () => {
    const id = await insertWithBadges(BADGES);
    await approve(id);
    expect((await status(id)).status).toBe("ok");

    await setDetails(id, { materials: "Oak", badges: [...BADGES].reverse() });

    expect((await status(id)).status).toBe("ok");
  });

  it("carry their colour and place in the text the checker sees, so a move is judged like a word", async () => {
    const id = await insertWithBadges(BADGES);
    await approve(id);
    expect((await status(id)).status).toBe("ok");

    // Written straight to the table, with nobody judging it first: hidden.
    const moved = [{ ...BADGES[0], color: "red", placement: "photo-top-left" }, BADGES[1]];
    await setDetails(id, { materials: "Oak", badges: moved });
    expect((await status(id)).status).toBe("pending");
    const { lines } = await claim(id);
    expect(lines).toEqual(
      expect.arrayContaining(["details.badges[].color=red", "details.badges[].placement=photo-top-left"]),
    );

    // Once that exact version is judged (what the app's precheck does before
    // its own write), the same write passes the wall inline.
    await approve(id);
    expect((await status(id)).status).toBe("ok");
    await setDetails(id, { materials: "Oak", badges: [...moved].reverse() });
    expect((await status(id)).status).toBe("ok");
  });

  it("pause the listing when one breaks the rules, naming a fix field the decision accepts", async () => {
    const id = await insertWithBadges([{ icon: "star", label: "18+ only" }]);
    const c = await claim(id);
    await judge(c.text_subject!, "violation", "other");
    // "specs" is what fixFieldForPath gives "details.badges[].label".
    expect((await settle(id, c.rev, "other", ["specs"])).outcome).toBe("paused");
    expect(await status(id)).toEqual({ status: "paused", fields: ["specs"] });
  });
});
