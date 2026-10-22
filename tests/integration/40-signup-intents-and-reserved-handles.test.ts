/**
 * Security audit 2026-10-20, against the replayed schema:
 *   20261021_signup_intents   (sign-up only through the app)
 *   20261021_reserved_usernames (reserved handles refused by the database)
 *
 * What is proven here:
 *   - signup_intent_gate refuses an email sign-up with no intent, allows one
 *     with a fresh intent and SPENDS it (a second sign-up needs a second
 *     intent), ignores an expired intent or one for another address, and lets
 *     OAuth sign-ups through untouched;
 *   - no client role can read or write signup_intents, or call the gate;
 *   - the hash the gate recomputes is the one src/lib/auth/signup-intent.ts
 *     writes (sha256 of the trimmed, lower-cased address);
 *   - an owner can no longer give themselves a reserved handle through a
 *     direct update, and a signup whose metadata names one (or whose Google
 *     name slugifies to one) still gets an account, without the handle.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSuper, asUser, closePool, createUser, expectDbError } from "../db/client";
import { signupIntentHash } from "../../src/lib/auth/signup-intent";

afterAll(closePool);

const address = (label: string) => `${label}-${randomUUID().slice(0, 6)}@test.squareshare.to`;

/** The event GoTrue sends the Before User Created hook, as documented. */
const event = (email: string, provider = "email", extra: Record<string, unknown> = {}) => ({
  metadata: { uuid: randomUUID(), time: new Date().toISOString(), name: "before-user-created", ip_address: "203.0.113.9" },
  user: {
    id: randomUUID(),
    aud: "authenticated",
    role: "",
    email,
    phone: "",
    app_metadata: { provider, providers: [provider] },
    user_metadata: {},
    identities: [],
    is_anonymous: false,
    ...extra,
  },
});

const gate = (payload: unknown) =>
  asSuper(async (q) => {
    const { rows } = await q.query<{ r: Record<string, unknown> }>(
      `select public.signup_intent_gate($1::jsonb) as r`,
      [JSON.stringify(payload)],
    );
    return rows[0].r;
  });

/** An intent as the app writes it: the app's own hash, as the service role. */
const writeIntent = async (email: string, expiresInSeconds = 300) => {
  const hash = await signupIntentHash(email);
  await asService((q) =>
    q.query(
      `insert into public.signup_intents (email_hash, expires_at)
       values ($1, now() + make_interval(secs => $2))`,
      [hash, expiresInSeconds],
    ),
  );
};

describe("signup_intent_gate", () => {
  it("refuses an email sign-up the app never approved", async () => {
    const r = await gate(event(address("stranger")));
    expect(r).toHaveProperty("error.http_code", 403);
  });

  it("allows one with a fresh intent, and spends it", async () => {
    const email = address("approved");
    await writeIntent(email);
    expect(await gate(event(email))).toEqual({});
    // Single use: the same intent cannot create a second account.
    expect(await gate(event(email))).toHaveProperty("error.http_code", 403);
  });

  it("matches the address the way the app hashed it (case and spaces)", async () => {
    const email = address("cased");
    await writeIntent(`  ${email.toUpperCase()} `);
    expect(await gate(event(email))).toEqual({});
  });

  it("ignores an expired intent and one for another address", async () => {
    const email = address("late");
    await writeIntent(email, -1);
    expect(await gate(event(email))).toHaveProperty("error.http_code", 403);

    await writeIntent(address("someone-else"));
    expect(await gate(event(email))).toHaveProperty("error.http_code", 403);
  });

  it("lets an OAuth sign-up through without an intent", async () => {
    expect(await gate(event(address("google"), "google"))).toEqual({});
  });

  it("refuses an anonymous user", async () => {
    const r = await gate(event("", "email", { is_anonymous: true }));
    expect(r).toHaveProperty("error.http_code", 403);
  });

  it("is out of every client role's reach", async () => {
    for (const run of [asAnon, (fn: Parameters<typeof asAnon>[0]) => asUser({ id: randomUUID(), email: "x@test.squareshare.to" }, fn)]) {
      expect(await expectDbError(run((q) => q.query(`select * from public.signup_intents`)))).toMatch(/permission denied/i);
      expect(
        await expectDbError(
          run((q) => q.query(`insert into public.signup_intents (email_hash, expires_at) values (repeat('a', 64), now())`)),
        ),
      ).toMatch(/permission denied/i);
      expect(
        await expectDbError(run((q) => q.query(`select public.signup_intent_gate('{}'::jsonb)`))),
      ).toMatch(/permission denied/i);
    }
  });
});

describe("reserved handles", () => {
  it("cannot be taken through a direct profile update", async () => {
    const owner = await createUser();
    const msg = await expectDbError(
      asUser(owner, (q) =>
        q.query(`update public.profiles set username = 'Support' where id = $1`, [owner.id]),
      ),
    );
    expect(msg).toMatch(/profiles_username_not_reserved/);

    // An ordinary handle still goes through.
    const { rowCount } = await asUser(owner, (q) =>
      q.query(`update public.profiles set username = $2 where id = $1`, [owner.id, `maker_${owner.id.slice(0, 6)}`]),
    );
    expect(rowCount).toBe(1);
  });

  it("are dropped at signup instead of failing it", async () => {
    const asked = await createUser(undefined, { username: "squareshare" });
    const google = await createUser(undefined, { full_name: "Admin" });
    const { rows } = await asSuper((q) =>
      q.query<{ id: string; username: string | null }>(
        `select id, username from public.profiles where id = any($1::uuid[])`,
        [[asked.id, google.id]],
      ),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.username).toBeNull();
  });
});
