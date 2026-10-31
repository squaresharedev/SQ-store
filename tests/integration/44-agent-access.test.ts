/**
 * Agent access, at the database. These tables say who approved what, and hold
 * the hashes of every credential an assistant has. No client role may touch them
 * at all: a token that could read its own grant could find out what else exists.
 *
 * Also pinned: what the JWT minted for an agent request gets from row level
 * security, because that is the whole of why one is minted (lib/agent/mint.ts).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asSuper,
  asUser,
  asUserWithClaims,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";

const AGENT_TABLES = [
  "agent_clients",
  "agent_grants",
  "agent_auth_codes",
  "agent_tokens",
  "agent_uploads",
  "agent_audit_log",
];

/** The claims mintAgentJwt signs. */
const MINTED = { aal: "aal2", is_anonymous: false };
/** What a phished password buys from GoTrue. */
const AAL1 = { aal: "aal1", amr: [{ method: "password", timestamp: 1 }] };

let owner: TestUser;
let stranger: TestUser;
let enrolled: TestUser;

beforeAll(async () => {
  owner = await createUser();
  stranger = await createUser();
  enrolled = await createUser();
  await asSuper((q) =>
    q.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret)
       values ($1, $2, 'phone', 'totp', 'verified', 'JBSWY3DPEHPK3PXP')`,
      [randomUUID(), enrolled.id],
    ),
  );
  await asService(async (q) => {
    await q.query(
      `insert into public.products (owner_id, title, price_cents, currency, status)
       values ($1, 'Owner lamp', 1200, 'EUR', 'draft'),
              ($2, 'Enrolled lamp', 1200, 'EUR', 'draft')`,
      [owner.id, enrolled.id],
    );
  });
});

afterAll(async () => {
  await closePool();
});

describe("the agent tables", () => {
  for (const table of AGENT_TABLES) {
    it(`${table} is closed to anon`, async () => {
      await expectDbError(asAnon((q) => q.query(`select 1 from public.${table} limit 1`)));
    });

    it(`${table} is closed to a signed-in user, even at aal2`, async () => {
      await expectDbError(asUser(owner, (q) => q.query(`select 1 from public.${table} limit 1`)));
      await expectDbError(asUserWithClaims(owner, MINTED, (q) => q.query(`select 1 from public.${table} limit 1`)));
    });

    it(`${table} has row level security on, with no policy to open it`, async () => {
      const { rows } = await asSuper((q) =>
        q.query(
          `select c.relrowsecurity as rls,
                  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = $1`,
          [table],
        ),
      );
      expect(rows[0].rls).toBe(true);
      expect(Number(rows[0].policies)).toBe(0);
    });
  }

  it("lets the service role write what the app needs", async () => {
    const clientId = `app_${randomUUID()}`;
    await asService(async (q) => {
      await q.query(
        `insert into public.agent_clients (id, kind, name, redirect_uris) values ($1, 'registered', 'Test', '{https://a.example/cb}')`,
        [clientId],
      );
      const { rows } = await q.query(
        `insert into public.agent_grants (user_id, account_id, client_id, scopes, resource)
         values ($1, $1, $2, '{store:read}', 'https://x/mcp') returning id`,
        [owner.id, clientId],
      );
      await q.query(
        `insert into public.agent_tokens (token_hash, grant_id, kind, expires_at)
         values ($1, $2, 'access', now() + interval '1 hour')`,
        [randomUUID(), rows[0].id],
      );
    });
  });

  it("allows one live connection per app, person and store, so approving again must replace it", async () => {
    const clientId = `app_${randomUUID()}`;
    await asService(async (q) => {
      await q.query(
        `insert into public.agent_clients (id, kind, name, redirect_uris) values ($1, 'registered', 'Test', '{https://a.example/cb}')`,
        [clientId],
      );
      await q.query(
        `insert into public.agent_grants (user_id, account_id, client_id, scopes, resource)
         values ($1, $1, $2, '{store:read}', 'https://x/mcp')`,
        [stranger.id, clientId],
      );
    });
    await expectDbError(
      asService((q) =>
        q.query(
          `insert into public.agent_grants (user_id, account_id, client_id, scopes, resource)
           values ($1, $1, $2, '{store:read}', 'https://x/mcp')`,
          [stranger.id, clientId],
        ),
      ),
    );
  });

  it("drops a person's grants and tokens with their account, and keeps the trail", async () => {
    const gone = await createUser();
    const clientId = `app_${randomUUID()}`;
    const tokenHash = randomUUID();
    const grantId = await asService(async (q) => {
      await q.query(
        `insert into public.agent_clients (id, kind, name, redirect_uris) values ($1, 'registered', 'Test', '{https://a.example/cb}')`,
        [clientId],
      );
      const { rows } = await q.query(
        `insert into public.agent_grants (user_id, account_id, client_id, scopes, resource)
         values ($1, $1, $2, '{store:read}', 'https://x/mcp') returning id`,
        [gone.id, clientId],
      );
      await q.query(
        `insert into public.agent_tokens (token_hash, grant_id, kind, expires_at)
         values ($1, $2, 'access', now() + interval '1 hour')`,
        [tokenHash, rows[0].id],
      );
      await q.query(
        `insert into public.agent_audit_log (grant_id, account_id, tool, outcome) values ($1, $2, 'get_store', 'ok')`,
        [rows[0].id, gone.id],
      );
      return rows[0].id as string;
    });

    await asSuper((q) => q.query(`delete from auth.users where id = $1`, [gone.id]));

    await asService(async (q) => {
      const tokens = await q.query(`select 1 from public.agent_tokens where token_hash = $1`, [tokenHash]);
      expect(tokens.rowCount).toBe(0);
      const trail = await q.query(`select grant_id from public.agent_audit_log where account_id = $1`, [gone.id]);
      expect(trail.rowCount).toBe(1);
      expect(trail.rows[0].grant_id).toBeNull();
      expect(grantId).toBeTruthy();
    });
  });
});

describe("what a minted JWT gets from row level security", () => {
  it("reads the person's own store", async () => {
    const { rows } = await asUserWithClaims(owner, MINTED, (q) =>
      q.query(`select title from public.products where owner_id = $1`, [owner.id]),
    );
    expect(rows.map((row) => row.title)).toEqual(["Owner lamp"]);
  });

  it("reads nothing of anyone else's store", async () => {
    const { rows } = await asUserWithClaims(stranger, MINTED, (q) =>
      q.query(`select title from public.products where owner_id = $1`, [owner.id]),
    );
    expect(rows).toHaveLength(0);
  });

  it("gets past the two-factor policy for an enrolled account, as its consent did", async () => {
    const { rows } = await asUserWithClaims(enrolled, MINTED, (q) =>
      q.query(`select title from public.products where owner_id = $1`, [enrolled.id]),
    );
    expect(rows.map((row) => row.title)).toEqual(["Enrolled lamp"]);
  });

  it("is the only thing that does: the same account at aal1 still reads nothing", async () => {
    const { rows } = await asUserWithClaims(enrolled, AAL1, (q) =>
      q.query(`select title from public.products where owner_id = $1`, [enrolled.id]),
    );
    expect(rows).toHaveLength(0);
  });

  it("can spend a rate limit budget, under its own name", async () => {
    const { rows } = await asUserWithClaims(owner, MINTED, (q) =>
      q.query(`select public.rl_take('agent:product_write', 5, 60) as allowed`),
    );
    expect(rows[0].allowed).toBe(true);
  });
});
