/**
 * Deterministic test keys shared by the stack server and the Playwright specs.
 * The JWT secret is a fixed test-only value — PostgREST validates against it,
 * the mock GoTrue signs with it, and specs recompute the same anon/service
 * keys for REST seeding. Nothing here is a real credential.
 */
import { createHmac } from "node:crypto";

export const JWT_SECRET = "sqstore-e2e-jwt-secret-with-at-least-32-chars!!";
export const GATEWAY_URL = "http://127.0.0.1:54321";
export const NEXT_URL = "http://localhost:3100";
export const DB_URL = "postgres://postgres:postgres@localhost:54322/sqstore_e2e";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

export const ANON_KEY = signJwt({ role: "anon", iss: "sqstore-e2e", exp: 4102444800 });
export const SERVICE_KEY = signJwt({ role: "service_role", iss: "sqstore-e2e", exp: 4102444800 });
