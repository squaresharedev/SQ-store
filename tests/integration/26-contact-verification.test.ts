/**
 * Contact verification, at the level only the database can answer.
 *
 * The app promises that a seller's contact email and phone are shown as
 * PROVEN only after a code sent to them was typed back. That promise is worth
 * nothing if the database lets the seller write the proof themselves: the
 * seller holds a publishable key and an RLS-permitted UPDATE on their own
 * profile row, and the app is not the only client of this database. So the
 * real controls live here, and are tested here:
 *
 *   1. guard_contact_proof: only the service role grants a proof, and a
 *      changed value loses its proof whoever changed it.
 *   2. contact_verifications: invisible and unwritable to every client role.
 *   3. issue/redeem: one live code per channel, bound to the stored value,
 *      a counted attempt per guess, a ceiling, an expiry, single use, and no
 *      proof for a value that changed after the code went out.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

const RIGHT = "a".repeat(64);
const WRONG = "b".repeat(64);
const MAX_ATTEMPTS = 5;
const EMAIL = "hello@studio-builderboy.at";
const PHONE = "+353871234567";

let seller: TestUser;

afterAll(closePool);

beforeEach(async () => {
  seller = await createUser();
  await asService((q) =>
    q.query(`update public.profiles set seller_email = $2, seller_phone = $3 where id = $1`, [
      seller.id,
      EMAIL,
      PHONE,
    ]),
  );
});

const proofs = (user: TestUser = seller) =>
  asSuper(async (q) => {
    const { rows } = await q.query(
      `select seller_email, seller_email_verified_at, seller_phone, seller_phone_verified_at
         from public.profiles where id = $1`,
      [user.id],
    );
    return rows[0] as {
      seller_email: string | null;
      seller_email_verified_at: Date | null;
      seller_phone: string | null;
      seller_phone_verified_at: Date | null;
    };
  });

const issue = (channel: string, hash = RIGHT, ttl = 900, owner = seller.id) =>
  asService(async (q) => {
    const { rows } = await q.query(
      `select public.issue_contact_verification($1, $2, $3, $4) as target`,
      [owner, channel, hash, ttl],
    );
    return rows[0].target as string | null;
  });

const redeem = (channel: string, hash: string, owner = seller.id) =>
  asService(async (q) => {
    const { rows } = await q.query(
      `select public.redeem_contact_verification($1, $2, $3, $4) as outcome`,
      [owner, channel, hash, MAX_ATTEMPTS],
    );
    return rows[0].outcome as string;
  });

describe("guard_contact_proof: a seller cannot prove their own contact details", () => {
  it("refuses a seller setting either proof directly", async () => {
    for (const column of ["seller_email_verified_at", "seller_phone_verified_at"]) {
      const message = await expectDbError(
        asUser(seller, (q) =>
          q.query(`update public.profiles set ${column} = now() where id = $1`, [seller.id]),
        ),
      );
      expect(message, column).toMatch(/confirmed with a code/i);
    }
    const row = await proofs();
    expect(row.seller_email_verified_at).toBeNull();
    expect(row.seller_phone_verified_at).toBeNull();
  });

  it("drops the proof when the seller changes the value, even in the same statement", async () => {
    await asService((q) =>
      q.query(
        `update public.profiles
            set seller_email_verified_at = now(), seller_phone_verified_at = now()
          where id = $1`,
        [seller.id],
      ),
    );

    // Verify your own address, then swap in somebody else's: the proof must
    // not travel with it.
    await asUser(seller, (q) =>
      q.query(`update public.profiles set seller_email = 'ceo@other.eu' where id = $1`, [seller.id]),
    );
    await asUser(seller, (q) =>
      q.query(`update public.profiles set seller_phone = '+353861111111' where id = $1`, [seller.id]),
    );

    const row = await proofs();
    expect(row.seller_email).toBe("ceo@other.eu");
    expect(row.seller_email_verified_at).toBeNull();
    expect(row.seller_phone_verified_at).toBeNull();
  });

  it("lets a seller edit anything else, or clear a proof, without a fuss", async () => {
    await asService((q) =>
      q.query(`update public.profiles set seller_email_verified_at = now() where id = $1`, [seller.id]),
    );
    await asUser(seller, (q) =>
      q.query(`update public.profiles set tax_business_name = 'Renamed Ltd' where id = $1`, [seller.id]),
    );
    expect((await proofs()).seller_email_verified_at).not.toBeNull();

    await asUser(seller, (q) =>
      q.query(`update public.profiles set seller_email_verified_at = null where id = $1`, [seller.id]),
    );
    expect((await proofs()).seller_email_verified_at).toBeNull();
  });

  it("honours the service role setting a value and its proof together (fixtures)", async () => {
    await asService((q) =>
      q.query(
        `update public.profiles set seller_email = 'fixture@studio.eu', seller_email_verified_at = now()
          where id = $1`,
        [seller.id],
      ),
    );
    expect((await proofs()).seller_email_verified_at).not.toBeNull();

    // ...but even the service role loses the proof by changing the value alone.
    await asService((q) =>
      q.query(`update public.profiles set seller_email = 'other@studio.eu' where id = $1`, [seller.id]),
    );
    expect((await proofs()).seller_email_verified_at).toBeNull();
  });
});

describe("contact_verifications: no client role can see or touch it", () => {
  it("refuses the seller and the anonymous role outright", async () => {
    await issue("email");
    for (const [who, run] of [
      ["authenticated", asUser.bind(null, seller)],
      ["anon", asAnon],
    ] as const) {
      const read = await expectDbError(
        (run as typeof asAnon)((q) => q.query(`select * from public.contact_verifications`)),
      );
      expect(read, who).toMatch(/permission denied/i);
      const write = await expectDbError(
        (run as typeof asAnon)((q) =>
          q.query(
            `insert into public.contact_verifications (owner_id, channel, target, code_hash, expires_at)
             values ($1, 'email', 'x@y.eu', $2, now() + interval '1 hour')`,
            [seller.id, RIGHT],
          ),
        ),
      );
      expect(write, who).toMatch(/permission denied/i);
    }
  });

  it("will not let a client call issue or redeem at all", async () => {
    for (const sql of [
      `select public.issue_contact_verification($1, 'email', '${RIGHT}', 900)`,
      `select public.redeem_contact_verification($1, 'email', '${RIGHT}', 5)`,
    ]) {
      const message = await expectDbError(asUser(seller, (q) => q.query(sql, [seller.id])));
      expect(message).toMatch(/permission denied/i);
    }
  });

  it("stores only a digest-shaped hash, never a raw code", async () => {
    const message = await expectDbError(issue("email", "12345678"));
    expect(message).toMatch(/code_hash_shape/);
  });
});

describe("issue_contact_verification", () => {
  it("binds the code to the STORED value and hands that value back", async () => {
    expect(await issue("email")).toBe(EMAIL);
    expect(await issue("phone")).toBe(PHONE);
  });

  it("keeps one live code per channel: a resend replaces, never adds", async () => {
    await issue("email", WRONG);
    await issue("email", RIGHT);
    const rows = await asSuper(async (q) =>
      (
        await q.query(`select code_hash from public.contact_verifications where owner_id = $1 and channel = 'email'`, [
          seller.id,
        ])
      ).rows,
    );
    expect(rows).toEqual([{ code_hash: RIGHT }]);
    // The replaced code is dead.
    expect(await redeem("email", WRONG)).toBe("mismatch");
  });

  it("has nothing to issue for a missing or already proven value", async () => {
    await asService((q) =>
      q.query(`update public.profiles set seller_phone = null where id = $1`, [seller.id]),
    );
    expect(await issue("phone")).toBeNull();

    await asService((q) =>
      q.query(`update public.profiles set seller_email_verified_at = now() where id = $1`, [seller.id]),
    );
    expect(await issue("email")).toBeNull();
  });

  it("refuses an unknown channel or a lifetime out of range", async () => {
    expect(await expectDbError(issue("fax"))).toMatch(/unknown contact channel/);
    expect(await expectDbError(issue("email", RIGHT, 10))).toMatch(/lifetime/);
    expect(await expectDbError(issue("email", RIGHT, 86_400))).toMatch(/lifetime/);
  });
});

describe("redeem_contact_verification", () => {
  it("proves exactly the value the code went to, once", async () => {
    await issue("email");
    expect(await redeem("email", RIGHT)).toBe("verified");
    const row = await proofs();
    expect(row.seller_email_verified_at).not.toBeNull();
    expect(row.seller_phone_verified_at).toBeNull(); // the other channel is untouched

    // Single use: the same code again finds nothing to redeem.
    expect(await redeem("email", RIGHT)).toBe("none");
  });

  it("counts every wrong guess and burns the code at the ceiling, right code or not", async () => {
    await issue("phone");
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      expect(await redeem("phone", WRONG)).toBe("mismatch");
    }
    expect(await redeem("phone", WRONG)).toBe("locked");
    // Guessing right AFTER the ceiling proves nothing.
    expect(await redeem("phone", RIGHT)).toBe("locked");
    expect((await proofs()).seller_phone_verified_at).toBeNull();

    const attempts = await asSuper(async (q) =>
      (
        await q.query(`select attempts from public.contact_verifications where owner_id = $1`, [
          seller.id,
        ])
      ).rows[0].attempts,
    );
    expect(attempts).toBe(MAX_ATTEMPTS);
  });

  it("refuses an expired code", async () => {
    await issue("email");
    await asSuper((q) =>
      q.query(
        `update public.contact_verifications
            set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
          where owner_id = $1`,
        [seller.id],
      ),
    );
    expect(await redeem("email", RIGHT)).toBe("expired");
    expect((await proofs()).seller_email_verified_at).toBeNull();
  });

  it("proves nothing when the value changed after the code went out", async () => {
    await issue("email");
    await asUser(seller, (q) =>
      q.query(`update public.profiles set seller_email = 'new@studio-builderboy.at' where id = $1`, [
        seller.id,
      ]),
    );
    expect(await redeem("email", RIGHT)).toBe("stale");
    expect((await proofs()).seller_email_verified_at).toBeNull();
  });

  it("is one account's business: another account's code proves nothing here", async () => {
    const other = await createUser();
    await asService((q) =>
      q.query(`update public.profiles set seller_email = $2 where id = $1`, [other.id, EMAIL]),
    );
    await issue("email", RIGHT, 900, other.id);
    expect(await redeem("email", RIGHT)).toBe("none");
    expect((await proofs()).seller_email_verified_at).toBeNull();
    expect((await proofs(other)).seller_email_verified_at).toBeNull();
  });

  it("answers 'none' when no code was ever sent", async () => {
    expect(await redeem("email", RIGHT)).toBe("none");
  });
});
