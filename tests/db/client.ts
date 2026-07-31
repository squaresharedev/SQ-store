/**
 * Test-side database helpers that reproduce how PostgREST executes queries on
 * hosted Supabase:
 *
 *   - every request runs in a transaction
 *   - `request.jwt.claims` is set (transaction-local) from the caller's JWT
 *   - the connection switches to the `anon` / `authenticated` role
 *
 * RLS policies + grants therefore behave byte-for-byte like production.
 * `asService` switches to `service_role` (BYPASSRLS), matching the admin
 * client used by server-only code paths.
 */
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { inject } from "vitest";

export interface TestUser {
  id: string;
  email: string;
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: inject("dbUrl"), max: 20 });
  }
  return pool;
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
}

type Runner<T> = (q: PoolClient) => Promise<T>;

async function inRole<T>(
  role: "anon" | "authenticated" | "service_role",
  claims: Record<string, unknown> | null,
  fn: Runner<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    if (claims) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
    }
    await client.query(`set local role ${role}`);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Run queries as a signed-in user (RLS enforced, like the app's server client). */
export function asUser<T>(user: TestUser, fn: Runner<T>): Promise<T> {
  return inRole(
    "authenticated",
    { sub: user.id, email: user.email, role: "authenticated" },
    fn,
  );
}

/** Run queries as the anonymous (signed-out) API role. */
export function asAnon<T>(fn: Runner<T>): Promise<T> {
  return inRole("anon", { role: "anon" }, fn);
}

/** Run queries as service_role (BYPASSRLS) — the server-only admin client. */
export function asService<T>(fn: Runner<T>): Promise<T> {
  return inRole("service_role", { role: "service_role" }, fn);
}

/** Run raw superuser queries (fixtures / assertions outside the API surface). */
export async function asSuper<T>(fn: Runner<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Create an auth user the way GoTrue would: inserting into auth.users fires
 * the production triggers (profile row + team owner membership seeding).
 */
export async function createUser(
  email?: string,
  meta: Record<string, unknown> = {},
): Promise<TestUser> {
  const id = randomUUID();
  const resolvedEmail =
    email ?? `user-${id.slice(0, 8)}@test.squareshare.to`;
  await asSuper((q) =>
    q.query(
      `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
       values ($1, lower($2), $3, now())`,
      [id, resolvedEmail, JSON.stringify(meta)],
    ),
  );
  return { id, email: resolvedEmail.toLowerCase() };
}

/** Expect the callback to throw a Postgres error; returns the error message. */
export async function expectDbError(
  run: Promise<unknown> | (() => Promise<unknown>),
): Promise<string> {
  try {
    await (typeof run === "function" ? run() : run);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the query to be rejected, but it succeeded");
}
