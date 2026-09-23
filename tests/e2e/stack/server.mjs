/**
 * Local Supabase-compatible stack for E2E tests. Boots, in order:
 *
 *   1. embedded PostgreSQL 17 (fresh temp dir, prod schema replayed)
 *   2. PostgREST (tools/postgrest/postgrest.exe) — the real /rest/v1 engine
 *   3. a gateway HTTP server that mimics the Supabase API surface:
 *        /auth/v1/*  → mock GoTrue: password signup/signin, refresh, user,
 *                      scoped logout, PKCE password recovery, and TOTP MFA
 *                      (enroll / challenge / verify / unenroll, the admin
 *                      factor API, and aal/amr/session_id claims)
 *        /rest/v1/*  → proxied to PostgREST
 *        everything else → 404
 *   4. `next dev` on :3100 pointed at the gateway
 *
 * The mock GoTrue mints real HS256 JWTs with the same claims hosted GoTrue
 * uses (sub/email/role), signed with a fixed test secret that PostgREST also
 * validates — so RLS, auth.uid(), and team_jwt_email() all behave exactly
 * like production. No external service is ever contacted.
 *
 * Used as the Playwright webServer command; kill the process to tear down.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..");

import { ANON_KEY, JWT_SECRET, SERVICE_KEY, signJwt } from "./keys.mjs";
import { newSecret, totpValid } from "./totp.mjs";

const PG_PORT = 54322;
const POSTGREST_PORT = 3111;
const GATEWAY_PORT = 54321;
const NEXT_PORT = 3100;
const DB_NAME = "sqstore_e2e";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function verifyJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const sig = createHmac("sha256", JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  if (b64url(sig) !== parts[2]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64"));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Embedded Postgres + schema replay
// ---------------------------------------------------------------------------
const dataDir = mkdtempSync(join(tmpdir(), "sqstore-e2e-pg-"));
const epg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: PG_PORT,
  persistent: false,
});

console.log("[stack] starting embedded postgres...");
await epg.initialise();
await epg.start();
await epg.createDatabase(DB_NAME);

const DB_URL = `postgres://postgres:postgres@localhost:${PG_PORT}/${DB_NAME}`;
const pool = new pg.Pool({ connectionString: DB_URL, max: 5 });

{
  const shim = readFileSync(join(REPO, "tests", "db", "shim.sql"), "utf8");
  const migrations = readFileSync(join(REPO, "tests", "db", "prod-migrations.sql"), "utf8");
  await pool.query(shim);
  await pool.query(migrations);
  console.log("[stack] schema replayed");
}

// ---------------------------------------------------------------------------
// 2. PostgREST
// ---------------------------------------------------------------------------
// PostgREST's Windows build dynamically links libpq — put the embedded
// Postgres bin dir (which ships libpq.dll + friends) on PATH. Resolve the
// platform package THROUGH embedded-postgres (pnpm strict node_modules).
const require = createRequire(import.meta.url);
const epgMain = require.resolve("embedded-postgres"); // …/node_modules/embedded-postgres/dist/…
let probe = dirname(epgMain);
let pgBinDir = "";
while (probe !== dirname(probe)) {
  const candidate = join(probe, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
  if (existsSync(candidate)) {
    pgBinDir = candidate;
    break;
  }
  probe = dirname(probe);
}
if (!pgBinDir) throw new Error("could not locate @embedded-postgres/windows-x64 native/bin for libpq");

const postgrest = spawn(join(REPO, "tools", "postgrest", "postgrest.exe"), [], {
  env: {
    ...process.env,
    PATH: `${pgBinDir};${process.env.PATH}`,
    PGRST_DB_URI: `postgres://authenticator:postgres@localhost:${PG_PORT}/${DB_NAME}`,
    PGRST_DB_SCHEMAS: "public",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_PORT: String(POSTGREST_PORT),
    PGRST_SERVER_HOST: "127.0.0.1",
    PGRST_LOG_LEVEL: "error",
  },
  stdio: ["ignore", "inherit", "inherit"],
});
postgrest.on("exit", (code) => console.log(`[stack] postgrest exited (${code})`));

// wait for PostgREST readiness
for (let i = 0; i < 60; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${POSTGREST_PORT}/`, {
      headers: { Authorization: `Bearer ${ANON_KEY}` },
    });
    if (res.status < 500) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500));
  if (i === 59) throw new Error("PostgREST did not become ready");
}
console.log("[stack] postgrest ready");

// ---------------------------------------------------------------------------
// 3. Gateway: mock GoTrue + REST proxy
// ---------------------------------------------------------------------------
// ---- Sessions ---------------------------------------------------------------
// Real GoTrue keeps a row per session and stamps every access token with its
// `session_id`, its assurance level (`aal`) and how it was proven (`amr`, each
// method with the time it was used). The mock does the same in memory, because
// two-factor authentication is built on exactly those three facts: a session
// that has not passed its second factor is aal1, verifying a code makes it aal2
// and adds a fresh `totp` entry, and signing out (or enabling 2FA) revokes
// other sessions so their tokens stop working at /user.
const sessions = new Map(); // session_id -> { userId, aal, amr: Map<method, unix s>, revoked }
const refreshTokens = new Map(); // refresh_token -> session_id
const challenges = new Map(); // challenge_id -> { factorId, userId, sessionId, expiresAt }
const recoveries = new Map(); // auth_code -> { userId, email, challenge, method, redirectTo }
const lastRecoveryByEmail = new Map(); // email -> { auth_code, redirect_to }

const nowSeconds = () => Math.floor(Date.now() / 1000);

function newSession(userId, method) {
  const id = randomUUID();
  sessions.set(id, {
    userId,
    aal: "aal1",
    amr: new Map([[method, nowSeconds()]]),
    revoked: false,
  });
  return id;
}

function revokeSessions(userId, { except } = {}) {
  for (const [id, session] of sessions) {
    if (session.userId === userId && id !== except) session.revoked = true;
  }
}

async function loadUser(id) {
  const { rows } = await pool.query(
    `select id, email, encrypted_password, raw_user_meta_data, created_at, updated_at from auth.users where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function loadFactors(userId) {
  const { rows } = await pool.query(
    `select id, friendly_name, factor_type::text as factor_type, status::text as status,
            secret, created_at, updated_at, last_challenged_at
       from auth.mfa_factors where user_id = $1 order by created_at`,
    [userId],
  );
  return rows;
}

/** A factor as GoTrue serialises it: never with its secret. */
function factorJson(row) {
  return {
    id: row.id,
    friendly_name: row.friendly_name ?? "",
    factor_type: row.factor_type,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.last_challenged_at ? { last_challenged_at: row.last_challenged_at } : {}),
  };
}

async function userJson(row) {
  const factors = await loadFactors(row.id);
  return {
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email,
    email_confirmed_at: row.created_at,
    confirmed_at: row.created_at,
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    // GoTrue leaves `factors` out entirely when there are none.
    ...(factors.length ? { factors: factors.map(factorJson) } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_anonymous: false,
  };
}

async function sessionResponse(sessionId) {
  const session = sessions.get(sessionId);
  const row = await loadUser(session.userId);
  const expiresIn = 3600;
  const iat = nowSeconds();
  const amr = [...session.amr]
    .map(([method, timestamp]) => ({ method, timestamp }))
    .sort((a, b) => b.timestamp - a.timestamp);
  const accessToken = signJwt({
    sub: row.id,
    email: row.email,
    role: "authenticated",
    aud: "authenticated",
    session_id: sessionId,
    aal: session.aal,
    amr,
    is_anonymous: false,
    app_metadata: { provider: "email" },
    user_metadata: row.raw_user_meta_data ?? {},
    iat,
    exp: iat + expiresIn,
  });
  const refreshToken = randomUUID();
  refreshTokens.set(refreshToken, sessionId);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: iat + expiresIn,
    refresh_token: refreshToken,
    user: await userJson(row),
  };
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "*",
  });
  res.end(text);
}

function fail(res, status, code, msg) {
  return json(res, status, { error_code: code, code: status, msg, error_description: msg });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function bearer(req) {
  return (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
}

/**
 * The caller's session, the way GoTrue resolves it: a valid signature, then a
 * `session_id` that still exists. A token from a revoked session is refused
 * with `session_not_found`, which auth-js turns into "signed out".
 */
function requireSession(req, res) {
  const claims = verifyJwt(bearer(req));
  if (!claims || claims.role !== "authenticated") {
    fail(res, 401, "no_authorization", "invalid claim: missing sub claim");
    return null;
  }
  const session = sessions.get(claims.session_id);
  if (!session || session.revoked || session.userId !== claims.sub) {
    fail(res, 403, "session_not_found", "Session from session_id claim in JWT does not exist");
    return null;
  }
  return { claims, session, sessionId: claims.session_id };
}

function requireServiceRole(req, res) {
  const claims = verifyJwt(bearer(req));
  if (!claims || claims.role !== "service_role") {
    fail(res, 401, "no_authorization", "service role required");
    return false;
  }
  return true;
}

const hasVerifiedFactor = (factors) => factors.some((f) => f.status === "verified");

/** A small SVG standing in for GoTrue's QR code. It carries a `#` on purpose:
 *  GoTrue's own SVG does, and the app must re-encode it before using it in a
 *  data: URL (an unescaped `#` would cut the URL short). */
function fakeQrSvg(uri) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" width="168" height="168">` +
    `<rect width="21" height="21" fill="#ffffff"/>` +
    `<path d="M0 0h7v7H0zM14 0h7v7h-7zM0 14h7v7H0z" fill="#000000"/>` +
    `<desc>${uri.replace(/[<&>]/g, "")}</desc></svg>`
  );
}

async function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, "") || "/";

  if (req.method === "POST" && path === "/signup") {
    const body = await readBody(req);
    if (!body.email || !body.password) {
      return fail(res, 400, "validation_failed", "email and password required");
    }
    const email = String(body.email).toLowerCase();
    const existing = await pool.query(`select id from auth.users where lower(email) = $1`, [email]);
    if (existing.rows.length > 0) {
      return fail(res, 422, "user_already_exists", "User already registered");
    }
    const id = randomUUID();
    await pool.query(
      `insert into auth.users (id, email, encrypted_password, raw_user_meta_data, email_confirmed_at)
       values ($1, $2, $3, $4, now())`,
      [id, email, `plain:${body.password}`, JSON.stringify(body.data ?? {})],
    );
    return json(res, 200, await sessionResponse(newSession(id, "password")));
  }

  if (req.method === "POST" && path === "/token") {
    const grant = url.searchParams.get("grant_type");
    const body = await readBody(req);
    if (grant === "password") {
      const email = String(body.email ?? "").toLowerCase();
      const { rows } = await pool.query(
        `select id, encrypted_password from auth.users where lower(email) = $1`,
        [email],
      );
      const row = rows[0];
      if (!row || row.encrypted_password !== `plain:${body.password}`) {
        return fail(res, 400, "invalid_credentials", "Invalid login credentials");
      }
      return json(res, 200, await sessionResponse(newSession(row.id, "password")));
    }
    if (grant === "refresh_token") {
      const sessionId = refreshTokens.get(body.refresh_token);
      const session = sessionId ? sessions.get(sessionId) : null;
      if (!session || session.revoked) {
        return fail(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      }
      refreshTokens.delete(body.refresh_token);
      return json(res, 200, await sessionResponse(sessionId));
    }
    if (grant === "pkce") {
      // The second half of an emailed link (here: password recovery). The
      // browser that asked for the link holds the verifier; only it can
      // redeem the code.
      const entry = recoveries.get(body.auth_code);
      if (!entry) return fail(res, 404, "flow_state_not_found", "invalid flow state, no valid flow state found");
      const verifier = String(body.code_verifier ?? "");
      const expected =
        entry.method === "s256"
          ? createHash("sha256").update(verifier).digest("base64url")
          : verifier;
      if (!verifier || expected !== entry.challenge) {
        return fail(res, 403, "bad_code_verifier", "code challenge does not match previously saved code verifier");
      }
      recoveries.delete(body.auth_code);
      return json(res, 200, await sessionResponse(newSession(entry.userId, "recovery")));
    }
    return fail(res, 400, "unsupported_grant_type", `grant ${grant} not supported in e2e stack`);
  }

  if (req.method === "POST" && path === "/recover") {
    // resetPasswordForEmail. Nothing is mailed: the link's code is parked for
    // the spec to fetch from /__e2e/last-recovery, which is the only way a
    // test can "open the email". Unknown addresses get the same 200.
    const body = await readBody(req);
    const email = String(body.email ?? "").toLowerCase();
    const { rows } = await pool.query(`select id from auth.users where lower(email) = $1`, [email]);
    if (rows[0]) {
      const authCode = randomUUID();
      recoveries.set(authCode, {
        userId: rows[0].id,
        challenge: body.code_challenge,
        method: body.code_challenge_method,
      });
      lastRecoveryByEmail.set(email, {
        auth_code: authCode,
        redirect_to: url.searchParams.get("redirect_to"),
      });
    }
    return json(res, 200, {});
  }

  if (req.method === "GET" && path === "/user") {
    const auth = requireSession(req, res);
    if (!auth) return;
    const row = await loadUser(auth.claims.sub);
    if (!row) return fail(res, 401, "user_not_found", "User not found");
    return json(res, 200, await userJson(row));
  }

  if (req.method === "PUT" && path === "/user") {
    const auth = requireSession(req, res);
    if (!auth) return;
    const body = await readBody(req);
    // GoTrue's rule: with a verified factor on the account, the password and
    // the email may only be changed from an aal2 session.
    if ((body.password || body.email) && auth.session.aal !== "aal2") {
      if (hasVerifiedFactor(await loadFactors(auth.claims.sub))) {
        return fail(res, 403, "insufficient_aal", "AAL2 session is required to update email or password when MFA is enabled.");
      }
    }
    if (body.password) {
      const current = await loadUser(auth.claims.sub);
      if (current?.encrypted_password === `plain:${body.password}`) {
        return fail(res, 422, "same_password", "New password should be different from the old password.");
      }
      await pool.query(`update auth.users set encrypted_password = $2 where id = $1`, [
        auth.claims.sub,
        `plain:${body.password}`,
      ]);
    }
    return json(res, 200, await userJson(await loadUser(auth.claims.sub)));
  }

  if (req.method === "POST" && path === "/logout") {
    const claims = verifyJwt(bearer(req));
    const session = claims ? sessions.get(claims.session_id) : null;
    if (claims && session && !session.revoked) {
      const scope = url.searchParams.get("scope") ?? "global";
      if (scope === "local") session.revoked = true;
      else if (scope === "others") revokeSessions(session.userId, { except: claims.session_id });
      else revokeSessions(session.userId);
    }
    res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
    return res.end();
  }

  // ---- MFA (the user API) --------------------------------------------------

  if (req.method === "POST" && path === "/factors") {
    const auth = requireSession(req, res);
    if (!auth) return;
    const userId = auth.claims.sub;
    const body = await readBody(req);
    if (body.factor_type !== "totp") {
      return fail(res, 422, "mfa_factor_type_unsupported", "only totp in the e2e stack");
    }
    const factors = await loadFactors(userId);
    if (hasVerifiedFactor(factors) && auth.session.aal !== "aal2") {
      return fail(res, 403, "insufficient_aal", "AAL2 required to enroll a new factor");
    }
    if (factors.length >= 10) {
      return fail(res, 422, "too_many_enrolled_mfa_factors", "Maximum number of verified factors reached, unenroll to continue");
    }
    const friendlyName = String(body.friendly_name ?? "");
    if (friendlyName && factors.some((f) => f.friendly_name === friendlyName)) {
      return fail(res, 422, "mfa_factor_name_conflict", `A factor with the friendly name "${friendlyName}" for this user already exists`);
    }
    const row = await loadUser(userId);
    const secret = newSecret();
    const issuer = String(body.issuer ?? "localhost");
    const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(row.email)}?algorithm=SHA1&digits=6&issuer=${encodeURIComponent(issuer)}&period=30&secret=${secret}`;
    const id = randomUUID();
    await pool.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret)
       values ($1, $2, $3, 'totp', 'unverified', $4)`,
      [id, userId, friendlyName, secret],
    );
    return json(res, 200, {
      id,
      type: "totp",
      friendly_name: friendlyName,
      totp: { qr_code: fakeQrSvg(uri), secret, uri },
    });
  }

  const challengeMatch = path.match(/^\/factors\/([0-9a-f-]{36})\/challenge$/);
  if (req.method === "POST" && challengeMatch) {
    const auth = requireSession(req, res);
    if (!auth) return;
    const factor = (await loadFactors(auth.claims.sub)).find((f) => f.id === challengeMatch[1]);
    if (!factor) return fail(res, 404, "mfa_factor_not_found", "Factor not found");
    const id = randomUUID();
    const expiresAt = nowSeconds() + 300;
    challenges.set(id, {
      factorId: factor.id,
      userId: auth.claims.sub,
      sessionId: auth.sessionId,
      expiresAt,
    });
    await pool.query(`update auth.mfa_factors set last_challenged_at = now() where id = $1`, [factor.id]);
    return json(res, 200, { id, type: "totp", expires_at: expiresAt });
  }

  const verifyMatch = path.match(/^\/factors\/([0-9a-f-]{36})\/verify$/);
  if (req.method === "POST" && verifyMatch) {
    const auth = requireSession(req, res);
    if (!auth) return;
    const body = await readBody(req);
    const challenge = challenges.get(body.challenge_id);
    if (
      !challenge ||
      challenge.factorId !== verifyMatch[1] ||
      challenge.userId !== auth.claims.sub
    ) {
      return fail(res, 404, "mfa_challenge_expired", "MFA factor with the provided challenge ID not found");
    }
    // Single use, whatever the outcome.
    challenges.delete(body.challenge_id);
    if (challenge.expiresAt < nowSeconds()) {
      return fail(res, 422, "mfa_challenge_expired", "MFA challenge has expired, verify against another challenge or create a new challenge.");
    }
    const factor = (await loadFactors(auth.claims.sub)).find((f) => f.id === verifyMatch[1]);
    if (!factor) return fail(res, 404, "mfa_factor_not_found", "Factor not found");
    if (!totpValid(factor.secret, String(body.code ?? ""))) {
      return fail(res, 422, "mfa_verification_failed", "Invalid TOTP code entered");
    }
    if (factor.status !== "verified") {
      await pool.query(
        `update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1`,
        [factor.id],
      );
      // As GoTrue does: verifying a NEW factor signs out every other session.
      revokeSessions(auth.claims.sub, { except: auth.sessionId });
    }
    auth.session.aal = "aal2";
    auth.session.amr.set("totp", nowSeconds());
    return json(res, 200, await sessionResponse(auth.sessionId));
  }

  const unenrollMatch = path.match(/^\/factors\/([0-9a-f-]{36})$/);
  if (req.method === "DELETE" && unenrollMatch) {
    const auth = requireSession(req, res);
    if (!auth) return;
    const factor = (await loadFactors(auth.claims.sub)).find((f) => f.id === unenrollMatch[1]);
    if (!factor) return fail(res, 404, "mfa_factor_not_found", "Factor not found");
    if (factor.status === "verified" && auth.session.aal !== "aal2") {
      return fail(res, 403, "insufficient_aal", "AAL2 required to unenroll verified factor");
    }
    await pool.query(`delete from auth.mfa_factors where id = $1`, [factor.id]);
    return json(res, 200, { id: factor.id });
  }

  // ---- MFA (the admin API, service role only) --------------------------------

  const adminFactors = path.match(/^\/admin\/users\/([0-9a-f-]{36})\/factors$/);
  if (req.method === "GET" && adminFactors) {
    if (!requireServiceRole(req, res)) return;
    return json(res, 200, (await loadFactors(adminFactors[1])).map(factorJson));
  }
  const adminFactor = path.match(/^\/admin\/users\/([0-9a-f-]{36})\/factors\/([0-9a-f-]{36})$/);
  if (req.method === "DELETE" && adminFactor) {
    if (!requireServiceRole(req, res)) return;
    const { rows } = await pool.query(
      `delete from auth.mfa_factors where id = $1 and user_id = $2
       returning id, friendly_name, factor_type::text as factor_type, status::text as status, created_at, updated_at`,
      [adminFactor[2], adminFactor[1]],
    );
    if (!rows[0]) return fail(res, 404, "mfa_factor_not_found", "Factor not found");
    return json(res, 200, factorJson(rows[0]));
  }

  // ---- Test-only hooks (never part of GoTrue) --------------------------------

  if (req.method === "GET" && path === "/__e2e/last-recovery") {
    const email = String(url.searchParams.get("email") ?? "").toLowerCase();
    const entry = lastRecoveryByEmail.get(email);
    return entry ? json(res, 200, entry) : fail(res, 404, "not_found", "no recovery link for that address");
  }

  if (path === "/health") return json(res, 200, { description: "e2e mock gotrue", version: "test" });

  return fail(res, 404, "not_found", `mock gotrue: no route for ${req.method} ${path}`);
}

const gateway = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${GATEWAY_PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*",
    });
    return res.end();
  }

  if (url.pathname.startsWith("/auth/v1")) {
    try {
      return await handleAuth(req, res, url);
    } catch (error) {
      console.error("[stack] auth error", error);
      return json(res, 500, { msg: "mock gotrue error" });
    }
  }

  if (url.pathname.startsWith("/rest/v1")) {
    // Proxy to PostgREST, stripping the prefix.
    const target = `http://127.0.0.1:${POSTGREST_PORT}${url.pathname.replace(/^\/rest\/v1/, "") || "/"}${url.search}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    // supabase-js sends the key in `apikey`; PostgREST only reads Authorization.
    if (!headers.authorization && headers.apikey) {
      headers.authorization = `Bearer ${headers.apikey}`;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const responseHeaders = Object.fromEntries(upstream.headers.entries());
      delete responseHeaders["content-encoding"];
      delete responseHeaders["transfer-encoding"];
      responseHeaders["access-control-allow-origin"] = "*";
      const buf = Buffer.from(await upstream.arrayBuffer());
      responseHeaders["content-length"] = String(buf.length);
      res.writeHead(upstream.status, responseHeaders);
      return res.end(buf);
    } catch (error) {
      console.error("[stack] rest proxy error", error);
      return json(res, 502, { message: "rest proxy error" });
    }
  }

  return json(res, 404, { message: `gateway: no route for ${url.pathname}` });
});

await new Promise((resolve) => gateway.listen(GATEWAY_PORT, "127.0.0.1", resolve));
console.log(`[stack] gateway on :${GATEWAY_PORT} (anon key + service key minted)`);

// ---------------------------------------------------------------------------
// 4. next dev
// ---------------------------------------------------------------------------
// Next's own bin, not `pnpm exec next`: going through the package manager made
// the whole E2E stack depend on pnpm's pre-run dependency check, which fails
// the moment the installed pnpm disagrees with node_modules (a major upgrade is
// enough) and takes every spec down with it. The binary is right there.
const next = spawn(
  process.execPath,
  [join(REPO, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(NEXT_PORT)],
  {
    cwd: REPO,
    env: {
      ...process.env,
      NODE_ENV: "development",
      // Its OWN build dir (see distDir in next.config.ts). The NEXT_PUBLIC_*
      // values below are inlined into the compiled chunks, so sharing `.next`
      // with the developer's own `next dev` leaves the gateway URL baked into
      // whatever this run compiled — and the next ordinary dev session serves
      // it, talking to a mock stack that is no longer running.
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      // Contact-address confirmation ON, which is what makes the publish gate
      // demand a CLICKED link rather than just a typed address. There is no
      // Cloudflare binding here, so under NODE_ENV=development the message
      // goes to the in-memory dev outbox instead of a mail server, and specs
      // read the link back from /dev/emails. Nothing leaves the machine.
      TRANSACTIONAL_EMAIL_FROM: "no-reply@e2e.squareshare.to",
      // R2 deliberately unset by default, so a normal run stays hermetic and
      // the presign route's "not configured" path (503 -> graceful degrade) is
      // what gets exercised. E2E_REAL_R2=1 passes the configured bucket
      // through instead, which is the ONLY way to cover the real upload path
      // end to end; it writes real objects, so it is opt-in, never the default.
      ...(process.env.E2E_REAL_R2 === "1"
        ? {}
        : {
            R2_ACCOUNT_ID: "",
            R2_BUCKET_NAME: "",
            R2_ACCESS_KEY_ID: "",
            R2_SECRET_ACCESS_KEY: "",
          }),
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
next.on("exit", (code) => {
  console.log(`[stack] next dev exited (${code})`);
  shutdown(code ?? 1);
});

// Also write the connection facts for tests that need service-role seeding.
process.env.E2E_GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
console.log(
  JSON.stringify({
    e2e: {
      gateway: `http://127.0.0.1:${GATEWAY_PORT}`,
      next: `http://localhost:${NEXT_PORT}`,
      anonKey: ANON_KEY,
      serviceKey: SERVICE_KEY,
      dbUrl: DB_URL,
    },
  }),
);

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[stack] shutting down...");
  try {
    next.kill();
  } catch {}
  try {
    postgrest.kill();
  } catch {}
  try {
    gateway.close();
  } catch {}
  try {
    await pool.end();
  } catch {}
  try {
    await epg.stop();
  } catch {}
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
