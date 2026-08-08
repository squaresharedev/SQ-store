/**
 * Likes and follows expose only what their subject already exposes.
 *
 * These tables belong to SQ-app, which shares this database. They shipped with
 * `using (true)` public reads — intended, since like and follower counts are
 * meant to be visible on a public profile. The problem was the other half:
 * `profiles.is_public` defaults to FALSE, so every account is private unless it
 * opts in, and a private account's follow graph and likes were still readable
 * by anyone holding the publishable anon key.
 *
 * Worse than a count leak, because `public_profiles` maps id -> username: a
 * reader could join the two and turn UUID edges into named ones.
 *
 * What these tests pin is the rule that replaced it — visibility of a like or a
 * follow follows the visibility of its subject, plus your own rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, closePool, createUser, type TestUser } from "../db/client";

let publicUser: TestUser; // opted in to the public directory
let privateUser: TestUser; // default posture: private
let stranger: TestUser;

let publicArtifactId: string;
let privateArtifactId: string;

beforeAll(async () => {
  publicUser = await createUser("social-public@test.squareshare.to", {
    username: "social_public",
  });
  privateUser = await createUser("social-private@test.squareshare.to", {
    username: "social_private",
  });
  stranger = await createUser("social-stranger@test.squareshare.to", {
    username: "social_stranger",
  });

  // Both postures set EXPLICITLY rather than leaning on the column default.
  // The default is exactly what drifted: the test replica had is_public
  // defaulting to true while production defaulted to false, so every test that
  // trusted it was asserting against the opposite privacy posture from the real
  // database. Saying which is which here means these tests cannot be quietly
  // inverted by a schema change again.
  await asService((q) =>
    q.query(`update public.profiles set is_public = true where id = $1`, [
      publicUser.id,
    ]),
  );
  await asService((q) =>
    q.query(`update public.profiles set is_public = false where id = any($1)`, [
      [privateUser.id, stranger.id],
    ]),
  );

  publicArtifactId = await asUser(publicUser, async (q) => {
    const { rows } = await q.query(
      `insert into public.artifacts (owner_id, title, image_key)
       values ($1, 'public art', 'images/${publicUser.id}/a.webp') returning id`,
      [publicUser.id],
    );
    return rows[0].id;
  });

  privateArtifactId = await asUser(privateUser, async (q) => {
    const { rows } = await q.query(
      `insert into public.artifacts (owner_id, title, image_key)
       values ($1, 'private art', 'images/${privateUser.id}/b.webp') returning id`,
      [privateUser.id],
    );
    return rows[0].id;
  });

  // Stranger likes both artifacts. Service role, so the insert itself is not
  // what is under test here — the READ is.
  await asService((q) =>
    q.query(
      `insert into public.artifact_likes (artifact_id, user_id)
       values ($1, $3), ($2, $3)`,
      [publicArtifactId, privateArtifactId, stranger.id],
    ),
  );

  // Two follow edges: one touching a public profile, one strictly private.
  await asService((q) =>
    q.query(
      `insert into public.follows (follower_id, followee_id)
       values ($1, $2), ($1, $3)`,
      [stranger.id, publicUser.id, privateUser.id],
    ),
  );
});

afterAll(async () => {
  await closePool();
});

describe("artifact_likes visibility", () => {
  it("lets anyone see likes on a publicly visible artifact", async () => {
    // The product requirement this policy must not break: like counts on
    // public content stay public.
    const { rows } = await asAnon((q) =>
      q.query(`select count(*)::int as n from public.artifact_likes where artifact_id = $1`, [
        publicArtifactId,
      ]),
    );
    expect(rows[0].n).toBe(1);
  });

  it("hides likes on an artifact the reader cannot see", async () => {
    const { rows } = await asAnon((q) =>
      q.query(`select count(*)::int as n from public.artifact_likes where artifact_id = $1`, [
        privateArtifactId,
      ]),
    );
    expect(rows[0].n).toBe(0);
  });

  it("still lets a user see their own like on something now hidden from them", async () => {
    // Otherwise a like becomes impossible to retract once the artifact's owner
    // makes it private.
    const { rows } = await asUser(stranger, (q) =>
      q.query(`select count(*)::int as n from public.artifact_likes where artifact_id = $1`, [
        privateArtifactId,
      ]),
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("follows visibility", () => {
  it("exposes an edge that touches a public profile", async () => {
    const { rows } = await asAnon((q) =>
      q.query(`select count(*)::int as n from public.follows where followee_id = $1`, [
        publicUser.id,
      ]),
    );
    expect(rows[0].n).toBe(1);
  });

  it("hides an edge between two accounts that never opted in", async () => {
    // The finding this migration answers: a private account's follow graph was
    // readable by anyone with the publishable anon key.
    const { rows } = await asAnon((q) =>
      q.query(`select count(*)::int as n from public.follows where followee_id = $1`, [
        privateUser.id,
      ]),
    );
    expect(rows[0].n).toBe(0);
  });

  it("lets both parties see their own private edge", async () => {
    for (const party of [stranger, privateUser]) {
      const { rows } = await asUser(party, (q) =>
        q.query(`select count(*)::int as n from public.follows where followee_id = $1`, [
          privateUser.id,
        ]),
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it("does not let an unrelated signed-in user read a private edge", async () => {
    // Signed in is not the same as entitled: publicUser is a party to neither
    // end of the stranger -> privateUser edge.
    const { rows } = await asUser(publicUser, (q) =>
      q.query(`select count(*)::int as n from public.follows where followee_id = $1`, [
        privateUser.id,
      ]),
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("waitlist_signups insert is bounded", () => {
  it("still accepts what the marketing site actually sends", async () => {
    // squareshare.eu inserts { email, source } from the browser with the anon
    // key. Breaking that would take the live waitlist form down.
    await asAnon((q) =>
      q.query(
        `insert into public.waitlist_signups (email, source) values ($1, 'landing')`,
        [`ok-${Date.now()}@test.squareshare.to`],
      ),
    );
    const { rows } = await asService((q) =>
      q.query(`select count(*)::int as n from public.waitlist_signups`),
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("refuses a client-chosen owner_id", async () => {
    await expect(
      asAnon((q) =>
        q.query(
          `insert into public.waitlist_signups (email, owner_id) values ($1, $2)`,
          [`bad-${Date.now()}@test.squareshare.to`, publicUser.id],
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses an unbounded email", async () => {
    await expect(
      asAnon((q) =>
        q.query(`insert into public.waitlist_signups (email) values ($1)`, [
          "a".repeat(300) + "@test.squareshare.to",
        ]),
      ),
    ).rejects.toThrow();
  });
});
