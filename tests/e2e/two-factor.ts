import { expect, type BrowserContext, type Page } from "@playwright/test";
import { ANON_KEY, GATEWAY_URL, signJwt } from "./stack/keys.mjs";
import { STEP_SECONDS, stepAt, totp } from "./stack/totp.mjs";
import { clearAuthRateLimits } from "./helpers";

/**
 * Two-factor helpers for the e2e specs. The spec plays the part of the phone:
 * it reads the setup key off the screen (as a person would type it into an
 * app) and computes codes with the same RFC 6238 implementation the mock
 * GoTrue checks them with.
 */

const APP_URL = "http://localhost:3100";

/** A phone with an authenticator app on it: one secret, and the codes it has
 *  already handed out (the app refuses to reuse a code, see the replay guard). */
export type Authenticator = { secret: string; used: Set<string> };

export function authenticator(secret: string): Authenticator {
  return { secret, used: new Set() };
}

/**
 * The next code the app would show that has not been used yet. Waits for the
 * next 30-second step when the current code has already been spent, exactly
 * what a person does when told "that code has already been used".
 */
export async function nextCode(app: Authenticator): Promise<string> {
  const deadline = Date.now() + (STEP_SECONDS + 5) * 1000;
  for (;;) {
    const code = totp(app.secret);
    if (!app.used.has(code)) {
      // Not in the last second of its step: a code that expires between the
      // spec typing it and the server checking it would be a flaky failure
      // for a reason no person could hit (GoTrue's one-step skew absorbs it,
      // but there is no need to lean on that).
      const intoStep = (Date.now() / 1000) % STEP_SECONDS;
      if (intoStep < STEP_SECONDS - 1) {
        app.used.add(code);
        return code;
      }
    }
    if (Date.now() > deadline) throw new Error("no fresh TOTP code within one step");
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** `count` distinct six-digit codes, each certainly wrong right now (and in
 *  the steps either side, which GoTrue also accepts). */
export function wrongCodes(app: Authenticator, count: number): string[] {
  const step = stepAt();
  const valid = new Set([
    totp(app.secret, step - 1),
    totp(app.secret, step),
    totp(app.secret, step + 1),
    totp(app.secret, step + 2),
  ]);
  const out: string[] = [];
  for (let n = 0; out.length < count; n += 1) {
    const guess = String((123457 + n * 7919) % 1_000_000).padStart(6, "0");
    if (!valid.has(guess) && !out.includes(guess)) out.push(guess);
  }
  return out;
}

/** One certainly-wrong code. */
export function wrongCode(app: Authenticator): string {
  return wrongCodes(app, 1)[0];
}

/**
 * Turn 2FA on through the real Settings › Security UI, for a signed-in user
 * who has a password. Returns the phone and the recovery codes shown.
 */
export async function enableTwoFactor(
  page: Page,
  password: string,
  options: { name?: string } = {},
): Promise<{ app: Authenticator; recoveryCodes: string[] }> {
  await clearAuthRateLimits();
  await page.goto("/settings/security");
  await page.waitForLoadState("networkidle").catch(() => {});
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  if (options.name) await dialog.getByLabel("Name this authenticator").fill(options.name);
  await dialog.getByLabel("Current password").fill(password);
  await dialog.getByRole("button", { name: "Continue" }).click();

  const key = dialog.getByLabel("Setup key", { exact: true });
  await expect(key).toBeVisible({ timeout: 20_000 });
  const secret = ((await key.textContent()) ?? "").replace(/\s+/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  const app = authenticator(secret);

  await dialog.getByLabel("6-digit code from the app").fill(await nextCode(app));
  await dialog.getByRole("button", { name: "Verify and turn on" }).click();

  const list = dialog.getByRole("list", { name: "Recovery codes" });
  await expect(list).toBeVisible({ timeout: 20_000 });
  const recoveryCodes = (await list.getByRole("listitem").allTextContents()).map((c) => c.trim());
  expect(recoveryCodes).toHaveLength(10);

  await dialog.getByLabel(/saved my recovery codes/i).check();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-two-factor-status="on"]')).toBeVisible({ timeout: 20_000 });
  return { app, recoveryCodes };
}

/** Password step of sign-in, stopping at the 2FA challenge. */
export async function signInToChallenge(
  page: Page,
  user: { email: string; password: string },
  next?: string,
  options: { clearLimits?: boolean } = {},
) {
  // Clearing the ledger also clears the replay guard, so a spec about replay
  // passes clearLimits: false.
  if (options.clearLimits !== false) await clearAuthRateLimits();
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.locator('input[name="identifier"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('button[name="intent"]').click();
  await page.waitForURL(/\/login\/two-factor/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Type a code into the challenge. The box submits itself at six digits. */
export async function enterChallengeCode(page: Page, code: string) {
  const box = page.getByLabel("Authentication code");
  await expect(box).toBeEditable({ timeout: 20_000 });
  await box.fill(code);
}

/** Password + authenticator, all the way to `next` (default the dashboard). */
export async function signInWithTwoFactor(
  page: Page,
  user: { email: string; password: string },
  app: Authenticator,
  next = /\/dashboard/,
) {
  await signInToChallenge(page, user);
  await enterChallengeCode(page, await nextCode(app));
  await page.waitForURL(next, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// The session cookie
// ---------------------------------------------------------------------------

const AUTH_COOKIE = /^sb-[^.]+-auth-token(\.\d+)?$/;
const CHUNK = 3180;

type Session = { access_token: string; [key: string]: unknown };

async function readSessionCookie(context: BrowserContext) {
  const cookies = (await context.cookies(APP_URL)).filter((c) => AUTH_COOKIE.test(c.name));
  if (cookies.length === 0) throw new Error("no auth cookie");
  const base = cookies.find((c) => !/\.\d+$/.test(c.name));
  const name = (base ?? cookies[0]).name.replace(/\.\d+$/, "");
  const raw = base
    ? base.value
    : cookies
        .filter((c) => /\.\d+$/.test(c.name))
        .sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()))
        .map((c) => c.value)
        .join("");
  const value = decodeURIComponent(raw);
  const session = JSON.parse(
    Buffer.from(value.replace(/^base64-/, ""), "base64url").toString("utf8"),
  ) as Session;
  return { name, cookies, session };
}

/** The current session's access token, as the browser holds it. */
export async function accessToken(context: BrowserContext): Promise<string> {
  return (await readSessionCookie(context)).session.access_token;
}

export function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

/**
 * Make the session's second factor look `seconds` older than it is, by
 * re-signing its access token with earlier `amr` timestamps. The mock GoTrue
 * still recognises the session (same session_id, valid signature), so this is
 * exactly "the person verified a code a while ago", without making a spec
 * wait out a ten-minute window.
 */
export async function ageSecondFactor(context: BrowserContext, seconds: number) {
  const { name, cookies, session } = await readSessionCookie(context);
  const claims = claimsOf(session.access_token);
  const amr = (claims.amr as { method: string; timestamp: number }[]).map((entry) => ({
    ...entry,
    timestamp: entry.timestamp - seconds,
  }));
  session.access_token = signJwt({ ...claims, amr });

  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const template = cookies[0];
  await context.clearCookies({ name: AUTH_COOKIE });
  const pieces =
    encoded.length <= CHUNK
      ? [{ name, value: encoded }]
      : Array.from({ length: Math.ceil(encoded.length / CHUNK) }, (_, i) => ({
          name: `${name}.${i}`,
          value: encoded.slice(i * CHUNK, (i + 1) * CHUNK),
        }));
  await context.addCookies(
    pieces.map((piece) => ({
      ...piece,
      domain: template.domain,
      path: template.path,
      httpOnly: template.httpOnly,
      secure: template.secure,
      sameSite: template.sameSite,
      expires: template.expires,
    })),
  );
}

// ---------------------------------------------------------------------------
// Straight to the API, as an attacker with the anon key would
// ---------------------------------------------------------------------------

/** GoTrue's password grant, called directly: the aal1 token a phished password buys. */
export async function passwordToken(email: string, password: string) {
  const res = await fetch(`${GATEWAY_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok, `password grant -> ${res.status}`).toBe(true);
  return (await res.json()) as { access_token: string; user: { id: string; factors?: { id: string; status: string }[] } };
}

/** Challenge + verify over the raw API: the aal2 token a code buys. */
export async function verifiedToken(aal1Token: string, factorId: string, code: string) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${aal1Token}`,
    "Content-Type": "application/json",
  };
  const challenge = await fetch(`${GATEWAY_URL}/auth/v1/factors/${factorId}/challenge`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const { id } = (await challenge.json()) as { id: string };
  const verify = await fetch(`${GATEWAY_URL}/auth/v1/factors/${factorId}/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ challenge_id: id, code }),
  });
  expect(verify.ok, `verify -> ${verify.status}`).toBe(true);
  return ((await verify.json()) as { access_token: string }).access_token;
}

/** PostgREST as the holder of `token`. */
export async function restAs(token: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${GATEWAY_URL}/rest/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

/** The recovery link the mock GoTrue would have emailed, as an app path. */
export async function recoveryLinkFor(email: string): Promise<string> {
  let body: { auth_code: string; redirect_to: string } | null = null;
  await expect(async () => {
    const res = await fetch(
      `${GATEWAY_URL}/auth/v1/__e2e/last-recovery?email=${encodeURIComponent(email)}`,
    );
    expect(res.ok).toBe(true);
    body = await res.json();
  }).toPass({ timeout: 15_000 });
  const target = new URL(body!.redirect_to);
  target.searchParams.set("code", body!.auth_code);
  return target.pathname + target.search;
}
