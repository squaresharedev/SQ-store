/**
 * Sign-in approval's three tables (20260927_sign_in_approvals): the sealed
 * secret behind the approval factor, the off switch, and the requests. The
 * fences here are the approval path's floor:
 *
 *   - no client role can read, write or count any of them, whatever its
 *     session: a client that could write a request could approve its OWN
 *     sign-in, and one that could delete an opt-out could switch a way in
 *     back on;
 *   - the factor's secret goes with its GoTrue factor, by any route;
 *   - a request can only ever be approved once (the conditional update the
 *     server relies on), and outlives neither its account nor its factor.
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
const AAL1 = { aal: "aal1", amr: [{ method: "password", timestamp: 1 }] };
const SEALED = "AAAAAAAAAAAAAAAAsealedTotpSecretBytesThatAreBase64Url_-012345";
const HASH = () => randomUUID().replace(/-/g, "").repeat(2);

let dana: TestUser;

async function approvalFactor(user: TestUser, status: "verified" | "unverified" = "verified") {
  const id = randomUUID();
  await asSuper((q) =>
    q.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret)
       values ($1, $2, $3, 'totp', $4, 'JBSWY3DPEHPK3PXP')`,
      [id, user.id, `approval:signed-in-devices-${id.slice(0, 6)}`, status],
    ),
  );
  return id;
}

async function request(user: TestUser, overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    user_id: user.id,
    session_id: randomUUID(),
    token_hash: HASH(),
    browser: "Chrome",
    os: "Windows",
    country: "DE",
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    ...overrides,
  };
  const columns = Object.keys(values);
  const { rows } = await asService((q) =>
    q.query(
      `insert into public.mfa_sign_in_approvals (${columns.join(", ")})
       values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(values),
    ),
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  dana = await createUser("approval-dana@test.squareshare.to", { username: "approval_dana" });
});

afterAll(async () => {
  await closePool();
});

describe("sign-in approval tables: no client role can touch them", () => {
  it("anon, a half-signed-in owner and a fully signed-in owner are all refused", async () => {
    const factorId = await approvalFactor(dana);
    await asService((q) =>
      q.query(
        `insert into public.mfa_approval_factors (factor_id, user_id, sealed_secret) values ($1, $2, $3)`,
        [factorId, dana.id, SEALED],
      ),
    );
    const requestId = await request(dana);

    const attempts = [
      `select count(*) from public.mfa_sign_in_approvals`,
      `select token_hash from public.mfa_sign_in_approvals where user_id = '${dana.id}'`,
      // The attack that matters: the waiting (aal1) session approving itself.
      `update public.mfa_sign_in_approvals set status = 'approved', factor_id = '${factorId}' where id = '${requestId}'`,
      `insert into public.mfa_sign_in_approvals (user_id, session_id, token_hash, expires_at)
       values ('${dana.id}', '${randomUUID()}', '${HASH()}', now() + interval '5 minutes')`,
      `select sealed_secret from public.mfa_approval_factors`,
      `insert into public.mfa_approval_factors (factor_id, user_id, sealed_secret) values ('${factorId}', '${dana.id}', '${SEALED}')`,
      `delete from public.mfa_approval_factors where user_id = '${dana.id}'`,
      `select count(*) from public.mfa_approval_opt_outs`,
      `insert into public.mfa_approval_opt_outs (user_id) values ('${dana.id}')`,
      `delete from public.mfa_approval_opt_outs where user_id = '${dana.id}'`,
    ];
    for (const sql of attempts) {
      expect(await expectDbError(asAnon((q) => q.query(sql))), sql).toMatch(/permission denied/);
      for (const claims of [AAL1, AAL2]) {
        expect(
          await expectDbError(asUserWithClaims(dana, claims, (q) => q.query(sql))),
          `${claims.aal}: ${sql}`,
        ).toMatch(/permission denied/);
      }
    }
  });

  it("the grants themselves are gone, not merely hidden by RLS", async () => {
    const { rows } = await asSuper((q) =>
      q.query(
        `select table_name, grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public'
            and table_name in ('mfa_approval_factors', 'mfa_approval_opt_outs', 'mfa_sign_in_approvals')
            and grantee in ('anon', 'authenticated')`,
      ),
    );
    expect(rows).toEqual([]);
  });
});

describe("mfa_approval_factors: follows its factor", () => {
  it("removing the GoTrue factor removes the sealed secret", async () => {
    const user = await createUser(`approval-${randomUUID().slice(0, 8)}@test.squareshare.to`);
    const factorId = await approvalFactor(user, "unverified");
    await asService((q) =>
      q.query(
        `insert into public.mfa_approval_factors (factor_id, user_id, sealed_secret) values ($1, $2, $3)`,
        [factorId, user.id, SEALED],
      ),
    );
    await asSuper((q) => q.query(`delete from auth.mfa_factors where id = $1`, [factorId]));
    const { rows } = await asService((q) =>
      q.query(`select count(*)::int n from public.mfa_approval_factors where user_id = $1`, [user.id]),
    );
    expect(rows[0].n).toBe(0);
  });

  it("one per account, and never a secret too short to be one", async () => {
    const user = await createUser(`approval-${randomUUID().slice(0, 8)}@test.squareshare.to`);
    const first = await approvalFactor(user);
    const second = await approvalFactor(user);
    const put = (factorId: string, secret = SEALED) =>
      asService((q) =>
        q.query(
          `insert into public.mfa_approval_factors (factor_id, user_id, sealed_secret) values ($1, $2, $3)`,
          [factorId, user.id, secret],
        ),
      );
    await put(first);
    expect(await expectDbError(put(second))).toMatch(/duplicate key/);
    await asService((q) => q.query(`delete from public.mfa_approval_factors where user_id = $1`, [user.id]));
    expect(await expectDbError(put(second, "short"))).toMatch(/violates check constraint/);
  });
});

describe("mfa_sign_in_approvals: decided once", () => {
  it("the conditional update the server uses approves a request exactly once", async () => {
    const factorId = await approvalFactor(dana);
    const id = await request(dana);
    const approve = () =>
      asService((q) =>
        q.query(
          `update public.mfa_sign_in_approvals
              set status = 'approved', decided_at = now(), factor_id = $2
            where id = $1 and user_id = $3 and status = 'pending' and expires_at > now()
            returning id`,
          [id, factorId, dana.id],
        ),
      );
    expect((await approve()).rows).toHaveLength(1);
    expect((await approve()).rows).toHaveLength(0);
  });

  it("an expired request cannot be approved", async () => {
    const factorId = await approvalFactor(dana);
    const id = await request(dana, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const { rows } = await asService((q) =>
      q.query(
        `update public.mfa_sign_in_approvals
            set status = 'approved', decided_at = now(), factor_id = $2
          where id = $1 and status = 'pending' and expires_at > now()
          returning id`,
        [id, factorId],
      ),
    );
    expect(rows).toHaveLength(0);
  });

  it("losing its factor leaves an approved request with nothing to complete", async () => {
    const factorId = await approvalFactor(dana);
    const id = await request(dana, { status: "approved", factor_id: factorId, decided_at: new Date().toISOString() });
    await asSuper((q) => q.query(`delete from auth.mfa_factors where id = $1`, [factorId]));
    const { rows } = await asService((q) =>
      q.query(`select factor_id from public.mfa_sign_in_approvals where id = $1`, [id]),
    );
    expect(rows[0].factor_id).toBeNull();
  });

  it.each([
    ["an unknown status", { status: "maybe" }],
    ["a token hash that is not one", { token_hash: "not-a-hash" }],
    ["a country that is not a code", { country: "Germany" }],
    ["an overlong browser name", { browser: "x".repeat(41) }],
  ])("refuses %s", async (_label, overrides) => {
    expect(await expectDbError(request(dana, overrides))).toMatch(/violates check constraint/);
  });
});
