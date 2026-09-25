/**
 * public.mfa_passkeys: the passkeys that stand in for an authenticator app
 * (20260925_passkey_factors). Each row unlocks one GoTrue TOTP factor whose
 * secret is sealed in it, so the fences here are the passkey path's floor:
 *
 *   - no client role can read, write or even count the table, whatever its
 *     session (a client that could INSERT could plant its own passkey);
 *   - a factor removed by any route takes its passkey with it (the foreign
 *     key), so a key that unlocks nothing can never linger;
 *   - the columns refuse shapes the app never writes.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asSuper,
  asUserWithClaims,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";

const AAL2 = { aal: "aal2", amr: [{ method: "totp", timestamp: 2 }, { method: "password", timestamp: 1 }] };

let carol: TestUser;

async function factorFor(user: TestUser): Promise<string> {
  const id = randomUUID();
  await asSuper((q) =>
    q.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret)
       values ($1, $2, $3, 'totp', 'verified', 'JBSWY3DPEHPK3PXP')`,
      [id, user.id, `passkey:key-${id.slice(0, 6)}`],
    ),
  );
  return id;
}

/** A row the way lib/auth/passkeys.ts writes one. */
function row(userId: string, factorId: string, overrides: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    factor_id: factorId,
    credential_id: `cred_${randomUUID().replace(/-/g, "")}`,
    public_key: "pQECAyYgASFYIFakePublicKeyBytesForTheReplicaOnly0123456789",
    sign_count: 0,
    transports: ["internal", "hybrid"],
    sealed_secret: "AAAAAAAAAAAAAAAAsealedTotpSecretBytesThatAreBase64Url_-012345",
    name: "iPhone",
    ...overrides,
  };
}

async function insert(values: ReturnType<typeof row>) {
  const columns = Object.keys(values);
  await asService((q) =>
    q.query(
      `insert into public.mfa_passkeys (${columns.join(", ")})
       values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(values),
    ),
  );
}

beforeAll(async () => {
  carol = await createUser("passkey-carol@test.squareshare.to", { username: "passkey_carol" });
});

afterAll(async () => {
  await closePool();
});

describe("mfa_passkeys: no client role can touch it", () => {
  it("anon and a fully signed-in owner are both refused, for every verb", async () => {
    const factorId = await factorFor(carol);
    await insert(row(carol.id, factorId));

    const attempts = [
      `select count(*) from public.mfa_passkeys`,
      `select sealed_secret from public.mfa_passkeys where user_id = '${carol.id}'`,
      `insert into public.mfa_passkeys (user_id, factor_id, credential_id, public_key, sealed_secret, name)
       values ('${carol.id}', '${factorId}', 'planted_credential_id_0001', 'planted_public_key_000001', 'planted_sealed_secret_value_that_is_long_enough_0', 'mine')`,
      `update public.mfa_passkeys set sign_count = 0 where user_id = '${carol.id}'`,
      `delete from public.mfa_passkeys where user_id = '${carol.id}'`,
    ];
    for (const sql of attempts) {
      expect(await expectDbError(asAnon((q) => q.query(sql)))).toMatch(/permission denied/);
      // Even the owner, even at aal2: the table is the server's alone.
      expect(await expectDbError(asUserWithClaims(carol, AAL2, (q) => q.query(sql)))).toMatch(
        /permission denied/,
      );
    }
  });

  it("the grants themselves are gone, not merely hidden by RLS", async () => {
    const { rows } = await asSuper((q) =>
      q.query(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'mfa_passkeys'
            and grantee in ('anon', 'authenticated')`,
      ),
    );
    expect(rows).toEqual([]);
  });
});

describe("mfa_passkeys: follows its factor", () => {
  it("removing the GoTrue factor removes the passkey that unlocked it", async () => {
    const factorId = await factorFor(carol);
    await insert(row(carol.id, factorId));
    await asSuper((q) => q.query(`delete from auth.mfa_factors where id = $1`, [factorId]));
    const { rows } = await asService((q) =>
      q.query(`select count(*)::int n from public.mfa_passkeys where factor_id = $1`, [factorId]),
    );
    expect(rows[0].n).toBe(0);
  });

  it("one factor, one passkey; one credential, one row", async () => {
    const factorId = await factorFor(carol);
    const first = row(carol.id, factorId);
    await insert(first);
    expect(await expectDbError(insert(row(carol.id, factorId)))).toMatch(/duplicate key/);
    const other = await factorFor(carol);
    expect(
      await expectDbError(insert(row(carol.id, other, { credential_id: first.credential_id }))),
    ).toMatch(/duplicate key/);
  });

  it("cannot point at a factor that does not exist", async () => {
    expect(await expectDbError(insert(row(carol.id, randomUUID())))).toMatch(/foreign key/);
  });
});

describe("mfa_passkeys: refuses shapes the app never writes", () => {
  it.each([
    ["a credential id that is not base64url", { credential_id: "not base64url!" }],
    ["an unknown transport", { transports: ["carrier-pigeon"] }],
    ["an empty name", { name: "" }],
    ["a name longer than the form allows", { name: "x".repeat(41) }],
    ["a negative counter", { sign_count: -1 }],
    ["a sealed secret that is too short to be one", { sealed_secret: "short" }],
  ])("%s", async (_label, overrides) => {
    const factorId = await factorFor(carol);
    expect(await expectDbError(insert(row(carol.id, factorId, overrides)))).toMatch(/violates check constraint/);
  });
});
