import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { freshUser, signUp, userIdByEmail } from "./helpers";
import { ANON_KEY, GATEWAY_URL, signJwt } from "./stack/keys.mjs";

/**
 * THE MARKETPLACE'S HALF OF THE MODERATION WALL, THROUGH ITS OWN WORKER.
 *
 * SQ-app has no test suite of its own, and what it does here cannot be judged
 * from inside one repo: its Worker asks THIS app's check endpoint, and the
 * database both apps share decides what is public. So the spec lives where
 * the stack does and drives the marketplace's API for real:
 *
 *   - a handle is refused or approved by the check, and a profile is public
 *     only under an approved one (going public checks the sign-up handle,
 *     which nobody had looked at),
 *   - a collection is named by the Worker, after the check, and by nobody else,
 *   - an upload is judged by its bytes, not by what it says it is.
 *
 * OPT-IN, because it needs SQ-app's Worker running against this stack, which
 * this repo's Playwright config does not start. In SQ-app, with the stack up
 * (the keys are the ones the stack prints, see stack/keys.mjs):
 *
 *   wrangler dev --port 8787 \
 *     --var SUPABASE_URL:http://127.0.0.1:54321 \
 *     --var SUPABASE_ANON_KEY:<anon key> \
 *     --var SUPABASE_SERVICE_ROLE_KEY:<service key> \
 *     --var MODERATION_CHECK_URL:http://localhost:3100/api/moderation/check \
 *     --var MODERATION_SECRET:<the stack's CRON_SECRET> \
 *     --var NODE_ENV:development
 *
 *   E2E_APP_URL=http://localhost:8787 npx playwright test 73-marketplace
 *
 * THE SESSION IS THE DASHBOARD'S. A cookie belongs to a host, not a port, so
 * signing up on localhost:3100 signs the same browser in to localhost:8787:
 * the local shape of how the two apps share a sign-in on .squareshare.eu.
 *
 * WHAT IS NOT HERE. Artifacts and stored images: both need the object store,
 * which this stack does not have (a valid upload answers 502). The wall they
 * sit behind is proven at the database in tests/integration/37-auto-moderation.
 */

const APP_URL = process.env.E2E_APP_URL;

test.skip(!APP_URL, "set E2E_APP_URL to run the marketplace moderation spec");
test.describe.configure({ timeout: 120_000 });

const api = (path: string) => `${APP_URL}/api${path}`;

async function errorOf(response: APIResponse): Promise<string> {
  return ((await response.json()) as { error?: string }).error ?? "";
}

/** A signed-in person, and what the marketplace knows them as. */
async function signedIn(page: Page, tag: string) {
  const user = freshUser(tag);
  await signUp(page, user);
  return { ...user, id: await userIdByEmail(user.email) };
}

const publicProfile = (page: Page, handle: string) => page.request.get(api(`/profiles/${handle}`));

test("a profile is public only under a handle the check approved", async ({ page }) => {
  const user = await signedIn(page, "mkt");
  const stamp = Date.now().toString(36);

  // Signed up, and private: nobody can see it, and nobody has looked at it.
  expect((await publicProfile(page, user.username)).status()).toBe(404);

  // A handle that breaks the rules is refused before it is stored.
  const refused = await page.request.patch(api("/profiles/me"), {
    data: { username: `mkt_violation_${stamp}` },
  });
  expect(refused.status()).toBe(422);
  expect(await errorOf(refused)).toContain("content moderation");
  const me = (await (await page.request.get(api("/me"))).json()) as { username: string };
  expect(me.username).toBe(user.username);

  // Going public is when the sign-up handle is first checked. It passes, so
  // the profile is listed under it.
  const opened = await page.request.patch(api("/profiles/me"), { data: { isPublic: true } });
  expect(opened.status()).toBe(200);
  expect((await publicProfile(page, user.username)).status()).toBe(200);

  // A new handle is checked on the way in, and the profile moves with it.
  const renamed = `mkt_maker_${stamp}`;
  const saved = await page.request.patch(api("/profiles/me"), { data: { username: renamed } });
  expect(saved.status()).toBe(200);
  expect((await publicProfile(page, renamed)).status()).toBe(200);
  expect((await publicProfile(page, user.username)).status()).toBe(404);

  // Around the Worker, with the same session, straight at the database: the
  // write lands, since nothing stops it, and the profile is simply not public.
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({
    sub: user.id,
    email: user.email,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
  });
  const sneaky = `mkt_sneaky_${stamp}`;
  const direct = await fetch(`${GATEWAY_URL}/rest/v1/profiles?id=eq.${user.id}`, {
    method: "PATCH",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username: sneaky }),
  });
  expect(direct.status).toBe(204);
  expect((await publicProfile(page, sneaky)).status()).toBe(404);
  expect((await publicProfile(page, renamed)).status()).toBe(404);
});

test("a sign-up handle the check will not pass cannot go public", async ({ page }) => {
  // The stand-in reads "unsure" in a handle as its marker; freshUser builds
  // the handle from the tag.
  const user = await signedIn(page, "unsure");
  expect(user.username).toContain("unsure");

  const opened = await page.request.patch(api("/profiles/me"), { data: { isPublic: true } });
  expect(opened.status()).toBe(422);
  expect(await errorOf(opened)).toContain("Your username was not approved");
  expect((await publicProfile(page, user.username)).status()).toBe(404);
});

test("a collection is named by the Worker, after the check, and by nobody else", async ({ page }) => {
  const user = await signedIn(page, "mktcol");

  const refused = await page.request.post(api("/collections"), {
    data: { name: "Things [[violation:hate]] says" },
  });
  expect(refused.status()).toBe(422);
  expect(await errorOf(refused)).toContain("content moderation");

  const created = await page.request.post(api("/collections"), { data: { name: "Lamps I like" } });
  expect(created.status()).toBe(201);
  const collection = (await created.json()) as { id: string; name: string };
  expect(collection.name).toBe("Lamps I like");

  // Renaming is checked the same way; a refusal leaves the name as it was.
  const renamed = await page.request.patch(api(`/collections/${collection.id}`), {
    data: { name: "[[violation]] lamps" },
  });
  expect(renamed.status()).toBe(422);
  const mine = (await (await page.request.get(api("/collections"))).json()) as { name: string }[];
  expect(mine.map((c) => c.name)).toEqual(["Lamps I like"]);

  // The owner still runs their own collection without the server's help.
  const shown = await page.request.patch(api(`/collections/${collection.id}`), {
    data: { isPublic: true },
  });
  expect(shown.status()).toBe(200);

  // And the database refuses a name from anyone but the server.
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({
    sub: user.id,
    email: user.email,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
  });
  const direct = await fetch(`${GATEWAY_URL}/rest/v1/collections`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ owner_id: user.id, name: "Named around the app" }),
  });
  expect(direct.status).toBe(403);
});

test("an upload is judged by its bytes, and nothing is presigned", async ({ page }) => {
  await signedIn(page, "mktup");

  // Says it is a PNG; is a script.
  const disguised = await page.request.post(api("/uploads/image"), {
    multipart: {
      kind: "avatar",
      image: { name: "me.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") },
    },
  });
  expect(disguised.status()).toBe(415);

  // The presigned route this replaced is gone: a browser can no longer write
  // to the bucket itself, which is what let a file be swapped after a check.
  const presign = await page.request.post(api("/uploads/presign"), {
    data: { kind: "artifact", contentType: "image/png", size: 10 },
  });
  expect(presign.status()).toBe(404);
});
