/**
 * Two-factor hardening (20260930_two_factor_hardening), at the database:
 *
 *   - the Custom Access Token hook lets every ordinary token through untouched,
 *     and a second-factor token only against a fresh, single-use intent the
 *     app wrote for that exact account and session. GoTrue runs the hook inside
 *     its verify transaction, so its refusal rolls the whole verify back: a
 *     code guessed straight at the auth server earns nothing;
 *   - no client role can call the hook, or read or write the intents and the
 *     approval opt-ins;
 *   - an approval's number is two digits;
 *   - staff tables answer only a fully verified (aal2) session.
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

let erin: TestUser;

type HookResult = { claims?: Record<string, unknown>; error?: { http_code: number; message: string } };

/** The event GoTrue sends the hook, for a token of `method` on `sessionId`. */
function event(user: TestUser, sessionId: string, method: string) {
  return {
    user_id: user.id,
    authentication_method: method,
    claims: {
      sub: user.id,
      session_id: sessionId,
      aal: method === "password" ? "aal1" : "aal2",
      role: "authenticated",
    },
  };
}

async function gate(payload: unknown): Promise<HookResult> {
  const { rows } = await asSuper((q) =>
    q.query("select public.mfa_access_token_gate($1::jsonb) as result", [JSON.stringify(payload)]),
  );
  return rows[0].result as HookResult;
}

async function intent(user: TestUser, sessionId: string, secondsLeft = 60) {
  await asService((q) =>
    q.query(
      `insert into public.mfa_verify_intents (user_id, session_id, expires_at)
       values ($1, $2, now() + make_interval(secs => $3))`,
      [user.id, sessionId, secondsLeft],
    ),
  );
}

async function intentsLeft(user: TestUser): Promise<number> {
  const { rows } = await asSuper((q) =>
    q.query("select count(*)::int as n from public.mfa_verify_intents where user_id = $1", [user.id]),
  );
  return rows[0].n as number;
}

beforeAll(async () => {
  erin = await createUser("hardening-erin@test.squareshare.to", { username: "hardening_erin" });
});

afterAll(async () => {
  await closePool();
});

describe("mfa_access_token_gate: the access token hook", () => {
  it("passes every ordinary token through unchanged", async () => {
    for (const method of ["password", "token_refresh", "otp", "oauth", "magiclink", "recovery"]) {
      const payload = event(erin, randomUUID(), method);
      expect(await gate(payload), method).toEqual({ claims: payload.claims });
    }
  });

  it("refuses a second-factor token the app did not authorise", async () => {
    for (const method of ["totp", "mfa/totp", "mfa/phone", "mfa/webauthn"]) {
      const result = await gate(event(erin, randomUUID(), method));
      expect(result.claims, method).toBeUndefined();
      expect(result.error?.http_code, method).toBe(403);
    }
  });

  it("issues one against a fresh intent for that account and session, and spends it", async () => {
    const session = randomUUID();
    await intent(erin, session);
    const payload = event(erin, session, "totp");
    expect(await gate(payload)).toEqual({ claims: payload.claims });
    expect(await intentsLeft(erin)).toBe(0);
    // Single use: the same session guessing again gets nothing.
    expect((await gate(payload)).error?.http_code).toBe(403);
  });

  it("an intent for another session, another account, or one that has lapsed opens nothing", async () => {
    const session = randomUUID();
    await intent(erin, session);
    expect((await gate(event(erin, randomUUID(), "totp"))).error?.http_code).toBe(403);
    const other = await createUser();
    expect((await gate(event(other, session, "totp"))).error?.http_code).toBe(403);
    // Still there, untouched by the refusals.
    expect(await intentsLeft(erin)).toBe(1);
    await asSuper((q) => q.query("delete from public.mfa_verify_intents where user_id = $1", [erin.id]));

    const lapsed = randomUUID();
    await intent(erin, lapsed, -1);
    expect((await gate(event(erin, lapsed, "totp"))).error?.http_code).toBe(403);
    await asSuper((q) => q.query("delete from public.mfa_verify_intents where user_id = $1", [erin.id]));
  });

  it("a malformed event is refused, never waved through", async () => {
    expect((await gate({ authentication_method: "totp", user_id: "nope", claims: {} })).error?.http_code).toBe(403);
    expect((await gate({ authentication_method: "totp", claims: { session_id: "" } })).error?.http_code).toBe(403);
  });

  it("no client role can call it", async () => {
    const payload = JSON.stringify(event(erin, randomUUID(), "password"));
    const call = "select public.mfa_access_token_gate($1::jsonb)";
    expect(await expectDbError(asAnon((q) => q.query(call, [payload])))).toMatch(/permission denied/);
    expect(await expectDbError(asUserWithClaims(erin, AAL2, (q) => q.query(call, [payload])))).toMatch(
      /permission denied/,
    );
  });
});

describe("the new tables: no client role can touch them", () => {
  it("anon and a fully signed-in owner are refused", async () => {
    for (const table of ["mfa_verify_intents", "mfa_approval_opt_ins"]) {
      expect(await expectDbError(asAnon((q) => q.query(`select * from public.${table}`))), table).toMatch(
        /permission denied/,
      );
      expect(
        await expectDbError(asUserWithClaims(erin, AAL2, (q) => q.query(`select * from public.${table}`))),
        table,
      ).toMatch(/permission denied/);
    }
    expect(
      await expectDbError(
        asUserWithClaims(erin, AAL2, (q) =>
          q.query(
            `insert into public.mfa_verify_intents (user_id, session_id, expires_at)
             values ($1, $2, now() + interval '1 minute')`,
            [erin.id, randomUUID()],
          ),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await expectDbError(
        asUserWithClaims(erin, AAL2, (q) =>
          q.query("insert into public.mfa_approval_opt_ins (user_id) values ($1)", [erin.id]),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("mfa_sign_in_approvals.match_code", () => {
  it("is two digits or nothing", async () => {
    const insert = (code: number | null) =>
      asService((q) =>
        q.query(
          `insert into public.mfa_sign_in_approvals
             (user_id, session_id, token_hash, expires_at, match_code)
           values ($1, $2, $3, now() + interval '5 minutes', $4)`,
          [erin.id, randomUUID(), randomUUID().replace(/-/g, "").repeat(2), code],
        ),
      );
    await insert(10);
    await insert(99);
    await insert(null);
    for (const bad of [9, 100, -5]) {
      expect(await expectDbError(insert(bad)), String(bad)).toMatch(/check constraint/);
    }
  });
});

describe("staff tables need a fully verified session", () => {
  let staffer: TestUser;

  beforeAll(async () => {
    staffer = await createUser("hardening-staff@test.squareshare.to", { username: "hardening_staff" });
    await asSuper((q) =>
      q.query("insert into public.admin_users (user_id, role) values ($1, 'staff')", [staffer.id]),
    );
  });

  afterAll(async () => {
    await asSuper((q) => q.query("delete from public.admin_users where user_id = $1", [staffer.id]));
  });

  it("an aal2 staff session reads them; the same account at aal1 sees nothing", async () => {
    const read = (claims: Record<string, unknown>) =>
      asUserWithClaims(staffer, claims, (q) =>
        q.query<{ n: number }>("select count(*)::int as n from public.admin_users"),
      );
    expect((await read(AAL2)).rows[0].n).toBeGreaterThan(0);
    expect((await read(AAL1)).rows[0].n).toBe(0);
  });

  it("an aal1 staff session cannot write the audit log", async () => {
    const { rows } = await asSuper((q) =>
      q.query<{ id: string }>("select id from public.admin_users where user_id = $1", [staffer.id]),
    );
    const write = (claims: Record<string, unknown>) =>
      asUserWithClaims(staffer, claims, (q) =>
        q.query(
          "insert into public.admin_audit_log (admin_user_id, action) values ($1, 'test.hardening')",
          [rows[0].id],
        ),
      );
    expect(await expectDbError(write(AAL1))).toMatch(/row-level security/);
    await write(AAL2);
    await asSuper((q) => q.query("delete from public.admin_audit_log where action = 'test.hardening'"));
  });
});
