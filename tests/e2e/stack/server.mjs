/**
 * Local Supabase-compatible stack for E2E tests. Boots, in order:
 *
 *   1. embedded PostgreSQL 17 (fresh temp dir, prod schema replayed)
 *   2. PostgREST (tools/postgrest/postgrest.exe) — the real /rest/v1 engine
 *   3. a gateway HTTP server that mimics the Supabase API surface:
 *        /auth/v1/*  → minimal mock GoTrue (password signup/signin/user/logout)
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
import { createHmac, randomUUID } from "node:crypto";
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
const refreshTokens = new Map(); // refresh_token -> user id

async function loadUser(id) {
  const { rows } = await pool.query(
    `select id, email, raw_user_meta_data, created_at, updated_at from auth.users where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

function userJson(row) {
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
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_anonymous: false,
  };
}

function sessionJson(row) {
  const expiresIn = 3600;
  const accessToken = signJwt({
    sub: row.id,
    email: row.email,
    role: "authenticated",
    aud: "authenticated",
    session_id: randomUUID(),
    is_anonymous: false,
    app_metadata: { provider: "email" },
    user_metadata: row.raw_user_meta_data ?? {},
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresIn,
  });
  const refreshToken = randomUUID();
  refreshTokens.set(refreshToken, row.id);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: refreshToken,
    user: userJson(row),
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

async function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, "") || "/";

  if (req.method === "POST" && path === "/signup") {
    const body = await readBody(req);
    if (!body.email || !body.password) {
      return json(res, 400, { error_code: "validation_failed", msg: "email and password required" });
    }
    const email = String(body.email).toLowerCase();
    const existing = await pool.query(`select id from auth.users where lower(email) = $1`, [email]);
    if (existing.rows.length > 0) {
      return json(res, 422, { error_code: "user_already_exists", code: 422, msg: "User already registered" });
    }
    const id = randomUUID();
    await pool.query(
      `insert into auth.users (id, email, encrypted_password, raw_user_meta_data, email_confirmed_at)
       values ($1, $2, $3, $4, now())`,
      [id, email, `plain:${body.password}`, JSON.stringify(body.data ?? {})],
    );
    const row = await loadUser(id);
    return json(res, 200, sessionJson(row));
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
        return json(res, 400, {
          error_code: "invalid_credentials",
          code: 400,
          msg: "Invalid login credentials",
          error_description: "Invalid login credentials",
        });
      }
      return json(res, 200, sessionJson(await loadUser(row.id)));
    }
    if (grant === "refresh_token") {
      const userId = refreshTokens.get(body.refresh_token);
      if (!userId) {
        return json(res, 400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      }
      refreshTokens.delete(body.refresh_token);
      return json(res, 200, sessionJson(await loadUser(userId)));
    }
    return json(res, 400, { error_code: "unsupported_grant_type", msg: `grant ${grant} not supported in e2e stack` });
  }

  if (req.method === "GET" && path === "/user") {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const claims = verifyJwt(token);
    if (!claims || claims.role !== "authenticated") {
      return json(res, 401, { error_code: "no_authorization", msg: "invalid claim: missing sub claim" });
    }
    const row = await loadUser(claims.sub);
    if (!row) return json(res, 401, { error_code: "user_not_found", msg: "User not found" });
    return json(res, 200, userJson(row));
  }

  if (req.method === "PUT" && path === "/user") {
    // updateUser (password change / metadata) — accept and echo.
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const claims = verifyJwt(token);
    if (!claims) return json(res, 401, { msg: "unauthorized" });
    const body = await readBody(req);
    if (body.password) {
      await pool.query(`update auth.users set encrypted_password = $2 where id = $1`, [
        claims.sub,
        `plain:${body.password}`,
      ]);
    }
    return json(res, 200, userJson(await loadUser(claims.sub)));
  }

  if (req.method === "POST" && path === "/logout") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
    return res.end();
  }

  if (path === "/health") return json(res, 200, { description: "e2e mock gotrue", version: "test" });

  return json(res, 404, { msg: `mock gotrue: no route for ${req.method} ${path}` });
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
