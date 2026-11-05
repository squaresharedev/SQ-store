# Security audit, 2026-11-03 (overnight)

Follows `C:\Users\edwar\security-audit-skill\squareshare-store\run-1\REPORT.md`
(2026-10-20/21). That run reviewed everything up to commit `594b2bd` and
migration `20261021_*`. This one starts from what was added since: the MCP
server and its OAuth, agent previews, buyer reviews, review import, export and
reminders, product add-ons, terms notices, the sign-in changes, and the two
sibling repos (App, Home) that share the Supabase project.

**Rules of this run.** Code changes are left UNCOMMITTED in the working tree,
for review. SQL changes are new migration files, tested on the embedded
replica (`tests/db`), and NOT applied to production. Production was only read:
catalog queries through the Supabase connector, the security advisors, and one
GoTrue probe that cannot create an account (a too-short password).

**Owner actions, in order:**
1. Check Auth > Hooks: is "Before User Created" set to `signup_intent_gate`?
   If not, turn it on (steps in `wrangler.jsonc`, SIGN-UP GATE). Section 3.
2. Apply `supabase/migrations/20261103_two_factor_review_tables.sql` (1.1),
   then change its header in `tests/db/prod-migrations.sql` to "(applied)".
3. Apply `Home/supabase/migrations/20261103_consent_logs_bounds.sql` to the
   SQ-store project, deploy Home, accept the banner once and check a row
   lands (1.3). Teamster: "Cookie consent records are not being saved".
4. Review and commit the code (list under "Files changed"), deploy, then
   `curl -sI https://dashboard.squareshare.eu/sw.js` shows HSTS and nosniff.
5. Decide on review suppression (3b). Teamster: "Decide how to stop sellers
   hiding genuine bad reviews".

## 1. Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium | A password alone (no second factor) reads a 2FA seller's reviews, imports, rating and funnel tables | Patched (migration, not applied to prod), tested |
| 2 | Low | Upload routes accept a post from any page on a squareshare.eu subdomain, carrying the seller's cookie | Patched, tested (unit + dev server) |
| 3 | Medium (compliance) | squareshare.eu has never stored a cookie consent record: the table does not exist | Migration written (Home), tested on the replica, NOT applied |
| 4 | Low (hardening) | Static files (`sw.js`, `widget.js`, every `/_next/static` chunk) are served without HSTS or nosniff | Patched (`public/_headers`), unit-tested; live after deploy |
| 5 | Low | Anyone can write log lines through `/api/csp-report`: thousands per request, and text that can fake an `[ops alert]` line | Patched, unit-tested, route checked on the dev server |
| 6 | Medium | Every per-IP limit resets for an IPv6 client by changing address within its own /64 | Patched, unit-tested, proven on the dev server |
| 7 | Low | An app can name itself with a quote in its client id and break the OAuth cleanup job's filter | Patched, unit-tested |

### 1.1 Four seller tables skip the two-factor rule (medium)

- **Where:** `reviews`, `review_imports`, `product_rating_summaries`
  (`supabase/migrations/20261025_reviews.sql:466-489`) and
  `storefront_funnel_daily` (`20261012_storefront_funnel_daily.sql:75`). Each
  has its member SELECT policy, but not the RESTRICTIVE
  `"Require two-factor when enrolled"` policy every other seller table carries
  (20260923). Confirmed live on 2026-11-03 (`pg_policies`).
- **Who:** anyone holding a 2FA seller's password, or a team member's. GoTrue
  hands out an aal1 token for a password, and the anon key is public.
- **Exploit:** `GET /rest/v1/reviews?select=*` with that aal1 token returns
  every review of the store: hidden ones (including those hidden for
  `personal_info`, which hold a buyer's personal details), held and blocked
  ones, the order id each came from. The other three tables give import file
  names and counts, rating counts and funnel counts. The same token reads
  nothing from `products`, `orders` and the other seller tables.
- **Not affected:** writes (no client write policy on any of the four;
  `review_set_visibility` checks `mfa_session_ok` itself). Buyers (the server
  reads for them with the service role).
- **Fix:** `supabase/migrations/20261103_two_factor_review_tables.sql` adds the
  same policy to the four tables (rollback in `supabase/rollbacks`). The cause
  was a hand-kept table list in the test, so
  `tests/integration/22-two-factor-rls.test.ts` now also fails for ANY table a
  client role can read that has neither the rule nor an entry in
  `NOT_A_SELLERS_DATA` (public catalogs, each with its reason).
- **Tested:** the replica with the migration: 28 of 28 pass. Without it: 3 fail,
  including "an aal1 token for a 2FA account sees NONE of its own private data"
  (it saw the review).
- **To apply:** run the migration on production, then check
  `select tablename from pg_policies where policyname = 'Require two-factor when enrolled'`
  lists the four. No app change is needed.

### 1.2 Upload routes are reachable from sibling sites (low)

- **Where:** `src/app/api/uploads/{image,element,font,file,document}/route.ts`.
  They authenticate the session cookie and had no origin check, unlike every
  other cookie route that changes something (`isSameOriginRequest`,
  `lib/security/same-origin.ts`).
- **Why it matters:** the session cookie is `Domain=.squareshare.eu;
  SameSite=Lax`. Lax stops a POST from another SITE, but every subdomain of
  squareshare.eu is the same site: the marketing site, the App, the embed host,
  and anything added later. A multipart POST (image, element, font) or a
  `text/plain` one (file, document: the type is a query parameter, the
  request's own Content-Type is never read) needs no CORS preflight. So one XSS
  on any sibling, or a page someone gets hosted there, could make a signed-in
  seller's browser upload files into their storage: R2 cost, the per-store
  upload budget spent, SVG elements and odd rasters dropped into the staff
  moderation queue. Attaching an upload to a product or storefront needs a
  server action, which Next already origin-checks, so nothing became public.
- **Fix:** each route refuses a request that is not same-origin (403, the
  route's existing "no permission" text), before anything else runs.
- **Tested:** `tests/unit/upload-font-route.test.ts` sends same-site,
  cross-site, `none` and header-less posts: all 403, nothing stored. Without the
  check that test fails (`same-site: expected 200 to be 403`). The image route's
  test and e2e spec 31 now send the header a same-origin browser sends. On the
  dev server (:3000), each of the five routes answered 403 to a missing or
  `same-site` origin and 401 (sign in) to `same-origin`. A real headless
  Chromium on `localhost:3000/login`, sending the XHR multipart post the
  uploader sends (`lib/products/upload.ts`), got past the gate on font, image
  and element (401, sign in); from another origin it could not read the answer
  at all. A signed-in upload was not run (signing in on :3000 shares the real
  account's rate-limit bucket, and the e2e upload specs skip without real R2).

### 1.3 The cookie banner's proof of consent is never saved (medium, compliance)

- **Where:** Home, `src/app/api/consent-log/route.ts` inserts into
  `public.consent_logs` with the anon key of the project in
  `NEXT_PUBLIC_SUPABASE_URL` (SQ-store). `Home/supabase/migrations/20260720_consent_logs.sql`
  was never applied there: no such table exists, and it is not in
  `schema_migrations`.
- **Seen live (2026-11-03):** one POST to `https://squareshare.eu/api/consent-log`
  with a valid record answered `500 {"error":"failed to record consent"}`.
  Nothing was written (there is nowhere to write it). Every visitor's choice has
  been lost the same way since the banner shipped.
- **Why it matters:** the route exists because "the cookie alone is not proof".
  GDPR Art. 7(1) puts the burden of showing consent on the controller, and the
  Cookie Policy says records are kept.
- **Fix (written, not applied):** `Home/supabase/migrations/20261103_consent_logs_bounds.sql`
  creates the table if missing and is safe on top of the first migration. It
  also bounds what an anonymous insert may hold (`consent_logs_bounded`: labels
  up to 64 characters, `choices` a small object), since the public anon key can
  insert directly without the route. It leaves insert-only access for `anon` and
  no read for any client role. The route now refuses a `policyVersion` over 64
  characters before it reaches the database.
- **Tested:** on the embedded replica, the migration applies twice cleanly, anon
  inserts a real record, an oversized label is refused by the CHECK, and anon
  cannot select, update or delete. Home typechecks. The route was not run
  locally: the machine had 4.4 GB free, and a second `next dev` needs 4-6 GB.
- **To apply:** run the migration on the SQ-store project, then accept the
  banner on squareshare.eu once and check a row arrives
  (`select count(*) from public.consent_logs`).
- **Same cause, elsewhere:** Home's only other migration,
  `20260925_purchase_intent_clicks.sql`, is missing too (the "I'd pay for this"
  counter in `WaitlistModal`). Nothing applies Home's migrations to the shared
  project, so each one has to be run by hand.

### 1.4 Static files miss the transport headers (low, hardening)

- **Seen live (2026-11-03):** `/login` carries HSTS, nosniff, X-Frame-Options
  and the rest. `/sw.js`, `/widget.js` and `/_next/static/chunks/*.js` carry
  none of them: those files are served by Workers static assets and never pass
  through the Worker that adds them. This is the open item from the previous
  report's section 5.
- **Exposure:** small. Browsers already pin HSTS (with `includeSubDomains`)
  from the HTML responses, and the files are served with correct types.
- **Fix:** a `/*` rule in `public/_headers` with the same two values as
  `next.config.ts`. Cloudflare applies every matching rule, so the font CORS
  rule still holds, and `_headers` never touches Worker responses.
  `tests/unit/static-headers.test.ts` fails if the two files ever disagree.
- **Not verified live:** `next dev` ignores `_headers`, and local workerd does
  not start on this machine. After the next deploy,
  `curl -sI https://dashboard.squareshare.eu/sw.js` should show both headers.

### 1.5 Log injection through the CSP report sink (low)

- **Where:** `src/app/api/csp-report/route.ts`, public and unauthenticated by
  necessity. It logged one line per report in the body, with each field cut to
  300 characters but otherwise as sent.
- **Exploit:** one 64 KB POST of `[{"body":{}},...]` wrote about 5,000 log
  lines (Workers Logs volume and cost, real lines drowned). A `blockedURL` of
  `x\n[ops alert] money taken` put the alert prefix into the log text, which a
  Workers Logs alert rule keyed on `[ops alert]` (the documented way to watch
  `alertOps`, wrangler.jsonc) would fire on. The emailed alerts come from
  `alertOps` itself and cannot be reached this way.
- **Fix:** at most 20 lines per request, and every logged field goes through
  the new `lib/security/log-safe.ts` `logSafe`: control characters, the line
  and paragraph separators, and square brackets are percent-encoded, so a URL
  stays readable and no prefix can be forged.
- **Tested:** `tests/unit/csp-report-route.test.ts` (6): ordinary URLs pass
  unchanged, a forged newline plus prefix comes out encoded, an emoji split
  by the 300-character cut leaves U+FFFD rather than half a pair (found by the
  independent review below), 200 reports give 20 lines, and the route's line
  starts with its own `[csp]` prefix. The dev
  server answered 204 to a forged report (its log is not visible from here).
- **Same shape, also fixed:** `lib/agent/oauth/clients.ts` logged a failed
  client-metadata fetch with the raw `client_id`, which any signed-in visitor
  chooses on `/oauth/authorize` (the URL parser drops a newline when judging
  it, but the log used the raw text). Both lines now go through `logSafe`.
  The 91 agent unit tests pass.

### 1.6 IPv6 clients get a fresh per-IP budget per address (medium)

- **Where:** `clientKey` (`src/lib/rate-limit.ts`) returned the full
  `CF-Connecting-IP`, and every anonymous limit is keyed on it: checkout
  placing (20/h), the order lookup (5/h), the withdrawal form, buyer review
  posts, OAuth client registration and token calls, sign-in, sign-up and
  password reset per client, MFA verification per client, reports, storefront
  and embed page reads, OG images and order downloads.
- **Exploit:** an IPv6 client holds at least a /64 (any home line, phone or
  rented server; clouds hand out /64 to /48 per machine) and can source a
  request from any of its 2^64 addresses. Each new address is a new key, so
  every one of those limits is as good as absent for anyone on IPv6 (the
  squareshare.eu zone has IPv6 on and Pseudo IPv4 off, read through the
  Cloudflare API on 2026-11-03, so the Worker sees the real address). The
  per-target limits that pair with some of them (per email address, per
  order) still hold; the per-client ones (account creation from one client,
  registrations, report floods, scraping) did not.
- **Fix:** `src/lib/security/client-ip.ts` `clientLimitKey`: IPv4 stays as it
  is; an IPv6 address counts as its /64 (`IPV6_CLIENT_PREFIX_GROUPS`);
  IPv4-mapped IPv6 (`::ffff:a.b.c.d`) counts as that IPv4; anything that does
  not parse is kept as it came. `clientKey` returns that key. Checkout used
  the same value as Turnstile's `remoteip`, so it now sends Turnstile the edge
  header itself, as sign-up already did. View de-duplication and the hashed IP
  in security events now also work per /64, which suits both.
- **Tested:** `tests/unit/client-ip.test.ts` (9): one /64 in every written form
  (compressed, uppercase, zoned, dotted tail) is one key, neighbouring /64s are
  not, mapped IPv4 is IPv4, junk passes through. The 15 unit files around
  checkout, rate limits, Turnstile, auth, contact verification, embeds and OG
  images (206 tests) pass. **Dev server:** six order lookups from six
  different addresses in one /64 got 202 five times, then 429; an address in
  the neighbouring /64 still got 202. Before the change all six would have
  passed. (This wrote one hashed rate-limit key in the shared database, for
  the documentation prefix `2001:db8::/32`, and looked up a random storefront,
  so nothing was sent.)

### 1.7 A client id can break the OAuth cleanup's filter (low)

- **Where:** `src/lib/agent/cleanup.ts` deletes registered apps nobody
  connected with `.not("id", "in", "(" + ids.map(id => '"' + id + '"') + ")")`,
  the ids of every connected app quoted by hand with no escaping. A metadata
  app's id is its own URL (`lib/agent/oauth/clients.ts`), and the URL parser
  accepts a raw `"` or `\` in it.
- **Exploit:** anyone can sign up, host a metadata document whose `client_id`
  is `https://evil.example/a"),("b`, and connect their own store to it. Its id
  is then in that list on every run. Most likely PostgREST refuses the filter,
  so unused registrations are never cleaned again (open registration then
  grows the table for good). If the list were ever read short instead, apps
  older than 30 days would be deleted, and their grants cascade
  (`agent_grants.client_id ... on delete cascade`): every connected
  assistant, Claude included, disconnected.
- **Fix, two layers:** a client id holding anything outside printable ASCII, a
  double quote or a backslash is refused before any fetch (`CLIENT_ID_UNSAFE`).
  No real metadata URL contains them, and none of the stored ids do (checked
  live: 1 registered, 1 metadata, 0 unsafe). And the cleanup now quotes each id
  with `quotedFilterValue` (`lib/supabase/ilike.ts`), the escaping `ilikeAny`
  already used for search, moved into one helper both call. Every other `.or()`
  carrying user text already went through `ilikeAny`.
- **Tested:** `tests/unit/agent/client-metadata.test.ts`: three ids that all
  parse as https URLs are refused without a fetch; without the check, the
  test fails (fetch called 3 times). 35 OAuth tests pass.
- **Hardening, not done:** the same list is the ids of EVERY connected app, in
  one request URL. At a few thousand connections it outgrows the URL and the
  cleanup of unused apps fails. A service-role SQL function with `not exists`
  would do it in one statement.

### Independent review of these patches

A separate reviewer, given only the diffs, checked every caller of the upload
routes (the XHR uploader, older Safari through the `Origin` fallback, the
service worker, the MCP agent, scripts and tests: none is refused), the
`_headers` syntax and scope, every reader of the four RLS tables (all reach
them only after `getActiveAccount`, which refuses an aal1 session of an
enrolled account, or with the service role; the agent mints aal2), and the
consent migration (idempotent; `insert` without `select` needs only INSERT).
Replica runs: 22-two-factor-rls, 42-reviews and 37-storefront-funnel-daily,
58 tests, all pass. Its one real catch, the split surrogate in `logSafe`, is
fixed above.

### Files changed (all uncommitted)

Store, only this audit's:
- `supabase/migrations/20261103_two_factor_review_tables.sql`,
  `supabase/rollbacks/20261103_two_factor_review_tables.down.sql`,
  `tests/integration/22-two-factor-rls.test.ts` (1.1)
- `src/app/api/uploads/{image,element,font,file,document}/route.ts`,
  `tests/unit/upload-font-route.test.ts`, `tests/unit/upload-image-route.test.ts`,
  `tests/e2e/31-product-page-fields.spec.ts` (1.2)
- `public/_headers`, `tests/unit/static-headers.test.ts` (1.4)
- `src/app/api/csp-report/route.ts`, `src/lib/security/log-safe.ts`,
  `tests/unit/csp-report-route.test.ts` (1.5)
- `src/lib/security/client-ip.ts`, `tests/unit/client-ip.test.ts` (1.6)
- `src/lib/agent/oauth/clients.ts`, `src/lib/agent/cleanup.ts`,
  `src/lib/supabase/ilike.ts`, `tests/unit/agent/client-metadata.test.ts` (1.5, 1.7)
- this report

Store, MIXED with other sessions' uncommitted work (stage only these hunks):
- `tests/db/prod-migrations.sql`: the block at the very end, "(pending)
  two_factor_review_tables" (1.1)
- `src/lib/rate-limit.ts`: the `clientLimitKey` import and the body and comment
  of `clientKey` (1.6)
- `src/app/api/checkout/[storefrontId]/[productId]/route.ts`: `requestHeaders`
  and the Turnstile `remoteIp` (1.6)

Home: `supabase/migrations/20261103_consent_logs_bounds.sql`,
`src/app/api/consent-log/route.ts` (1.3). App: `worker/routes/collections.ts`.

Gates on the whole working tree after the last change (2026-11-04 ~00:15):
`npx tsc --noEmit` 0 errors; `npx eslint` on every file above, exit 0. Home
and the App worker typecheck.

## 2. Checked and sound

### MCP server and OAuth (`src/lib/agent`, `src/app/oauth`, `src/app/mcp`)

- Redirect URIs match exactly. The only exception is a loopback port (RFC 8252),
  and https or loopback http is required at registration.
- PKCE S256 is mandatory. Codes and refresh tokens are spent in one conditional
  UPDATE, and a replayed code revokes its grant. A reused refresh token past
  10 s revokes the whole connection.
- Tokens are opaque (`sqa_`/`sqr_`), only their SHA-256 is stored, and the
  minted Supabase JWT never leaves the server (5 min, aal2, own key).
- Every request re-reads the grant (revocation is immediate) and re-checks the
  person's team role on the granted store (`getActiveAccount` agent branch).
  Removed members are refused.
- Opt-in scopes start unticked whatever the app asks for. The consent action
  re-judges the whole request and the store, and needs a 2FA step-up when
  enrolled.
- The client metadata fetch (CIMD) and the agent image fetch both refuse
  non-https URLs, address literals and local names, and judge every redirect
  hop.
- The preview token is an HMAC under an HKDF-derived key, lives 2 or 15 minutes,
  and is bound to one storefront and one live grant. The page reads as that
  grant under RLS.
- A password change, sign out everywhere and an account deletion revoke all
  grants (`revokeAllGrantsForUser`).

### Live database (read-only catalog queries, 2026-11-03)

- Every table in `public` and `demo` has RLS on. Views are `security_invoker`
  or not granted to client roles.
- No SECURITY DEFINER function is executable by `anon`. The 12 the advisor
  lists for `authenticated` are the intended RPCs. `order_place` is service-role
  only.
- `guard_contact_proof` stops a seller marking their own email or phone
  verified, and clears proof when the value changes. `moderation_gate` refuses
  every moderation column write from a client role on products, storefronts and
  artifacts.
- `review_set_visibility` checks `mfa_session_ok`, ownership or
  `products.write` on the review's seller, and refuses to publish a `blocked`
  review.

### Other routes

- Cron and ops routes: SHA-256 then constant-time compare, 404 without the
  secret, a secret under 32 characters counts as none.
- `/dev/*` is not in a production build at all (`pageExtensions`), and
  deploy.yml refuses a build that contains it.
- `src/middleware.ts` only overwrites one header; `returnPathFrom` admits only a
  same-origin dashboard path.
- `/api/products/[id]/photo`: active store, `store.read`, raster types only,
  `nosniff`.
- The moderation statement PDF is scoped to the active account; every refusal
  is a 404.
- `/api/storefronts/[id]/{product,checkout}-page` take PATCH, which no other
  origin can send without a CORS preflight.
- Checkout: same-origin, Turnstile, 20 per IP per hour, so pinning a product's
  stock with abandoned checkouts needs many IPs each solving Turnstile.

- `/api/billing/webhook`: bounded raw body, Stripe signature over the raw
  text with a 300 s tolerance, constant-time compare, secret rotation, refused
  when no secret is set. `/api/payments/connect/return` takes no id or
  destination from the request.
- The AI description draft (`lib/products/describe-actions.ts`,
  `lib/suggestions`, being built by another session tonight): role, plan and
  three budgets (person, store, platform per day) before the model is asked;
  the seller's words are fenced and escaped, hidden characters removed both
  ways, the answer schema-bound and length-capped, refusals handled, the test
  model development-only, nothing saved (the save is moderated as usual).
- The personal data export (`/settings/export`) reads only the signed-in
  user's rows, the new add-on lines included.
- Every server-side `fetch` has a fixed target or one judged by
  `isPublicHttpsUrl` (agent images, client metadata). Review import takes no
  photo URLs on purpose. Download file names are whitelisted
  (`sanitizeFilename`); every other `Content-Disposition` name is built by
  the server. Every `.or()` carrying user text is quoted by `ilikeAny`.

### Seller content (direct PostgREST writes included)

- `storefronts.config` and most product columns can be written straight
  through PostgREST, skipping the app's Zod schemas. Every buyer-facing read
  re-parses the stored config through `storefrontConfigSchema`
  (`parseStoredStorefrontConfig`, `buyerFacingStorefront`): an invalid part
  falls back to defaults, so a raw CSS value in a colour field never renders.
  `purchase_url` is re-checked by `purchaseUrlSchema` on read, and React 19
  blocks `javascript:` URLs anyway.
- No `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML` or `eval`
  anywhere in `src`. The MCP Apps view imports server-rendered markup with
  `DOMParser`, strips scripts, and cancels every navigation.
- All mail is plain text (no HTML bodies). Header fields are RFC 2047-encoded.
- The public product payload says only whether a product is digital, never
  its file key.
- `widget.js` only listens to its own frame's window from our origin. The
  service worker only takes same-origin messages.

### GoTrue called directly with a stolen session

From the Auth config read on 2026-10-20 (no Management token tonight to
re-read it): secure email change ON (both inboxes confirm), the current
password is required for a password change, and a low-aal session gets no
MFA-protected access. A second factor enrolled directly through GoTrue cannot
yield aal2, because the access-token hook only mints aal2 for the app's own
verify intents.

### App and Home

Every App worker route was traced: JWTs are verified by `auth.getUser()`, the
CSRF origin check covers state-changing routes, service-role writes pin the
session's user id, uploads accept only sniffed still rasters under
`{kind}/{userId}/`, search escapes LIKE patterns and builds no `.or()` filter
from user text, and private collections and profiles stay private through
RLS. Home renders only developer-written content.

## 3. Open configuration items (owner action, not code)

- **Supabase Auth CAPTCHA is still off for direct GoTrue calls.** A POST to
  `/auth/v1/signup` with the anon key and a disposable address got as far as
  the password rule (422 `weak_password`, now including `pwned`, so leaked-
  password protection is on). Whether the `signup_intent_gate` Before User
  Created hook was switched on could not be read without a Management API token.
  Check it in the dashboard (Auth > Hooks). If it is off, every app-side sign-up
  guard can still be skipped, as in finding 3.2 of the previous report, and
  with it the per-client limits fixed in 1.6. One more consequence worth
  weighing: each direct sign-up sends a confirmation mail, and GoTrue's mail
  budget is project-wide (`rate_limit_email_sent` was 30 an hour on
  2026-10-20). A script can spend it, and for the rest of that hour no real
  person gets a confirmation, a password reset or a magic link. No email
  sign-up has happened since 2026-10-02 (before intents existed), so the
  database holds no evidence either way, and every remaining probe would
  create an account.

## 3b. Owner decisions (platform abuse, not code bugs)

- **A seller can hide a store's genuine bad reviews, and the promise to buyers
  says they cannot.** `review_set_visibility('hide', reason)` takes any of the
  four reasons for any review, with no check that the reason is true and no
  limit, and the rating summary then counts only what is left
  (`product_rating_summaries` counts `is_public` rows). Buyers read
  "sellers can only hide a review that is spam, offensive, shares personal
  details or is not about the product" (`ProductPage.reviews.about`), which
  nothing enforces. Showing only positive reviews is "misrepresenting consumer
  reviews" under the UCPD blacklist (Annex I 23c, added by the Omnibus
  Directive), and FTC 16 CFR 465.7 forbids suppression by rating. Ways to make
  the promise true, from lightest: show "N reviews hidden by the seller" with
  the summary; tell staff when a store hides a large share of its 1 and
  2-star reviews; send hidden reviews of 1 to 2 stars to the moderation queue
  rather than off the page at once. Each changes what buyers see or what staff
  handle, so it is not patched here.
- **Plan limits are not enforced in the database** while
  `billing_switches.plan_limits_enforced` is off (the known pre-launch state).
  Turn it on with billing.
- **Store names become the sender name of order mail** ("{store} via Square
  Share"). A store named after a payment brand passes the classifier (brand
  names are allowed for genuine branded goods), so buyers of that store would
  get mail shown as "PayPal via Square Share" in clients that hide the
  address. Only buyers of that store get these mails; a short exact-match
  list of payment and platform brands for the trader name would close it.

## 4. Hardening notes (no exploit shown)

- `orders` still carries Supabase's default `ALL` grant to `anon` and
  `authenticated` (including TRUNCATE, which RLS does not cover). PostgREST
  cannot issue TRUNCATE, and RLS has no write policy, so nothing is reachable
  today. Revoking is defence in depth.
- `profiles.legal_accepted_at` / `legal_accepted_version` are written by the
  user's own session, so a user can backdate or forge their own acceptance
  record.
- `order_place` does not itself check that an add-on line's product belongs to
  the order's seller (`20261028_product_add_ons.sql:291-328`). It is
  service-role only and the TypeScript quote and record paths both check
  ownership, so nothing reaches it today. A guard inside the loop would make it
  hold for any future caller.
- A pending order holds a single-use code's last slot until it expires (about
  45 minutes). That is the price of closing the race in 20261022. Someone who
  knows the code can keep it from a real buyer by abandoning checkouts.
- A refund made in the Stripe dashboard (`charge.refunded`) never restocks,
  for the main product or its add-ons (`p_restock: false`). Dormant while
  Connect is off.
- `reviews_require_purchase` (`20261027_reviews_buyers_only.sql`) is still not
  in production. Applying it was declined twice by the owner. The buyer route
  enforces the same rule, so this is a missing backstop, not an open path.

- **Sign-in approval spam.** Someone with a 2FA account's password can start an
  approval request 40 times an hour (`mfaApprovalStart` is keyed on the account
  being signed into), and each one reaches the owner's devices. Number matching
  means one cannot be approved by accident, and denials spend the owner's own
  decide budget (30 an hour). Worth a lower start budget, or one per
  requesting client, if it is ever seen.
- **Passkey counter** updates are best-effort (`lib/auth/passkeys.ts`), so a
  failed write leaves a cloned hardware key undetectable once. Platform passkeys
  report 0 and are unaffected.
- **App** (`C:\Squareshare\App`): `DELETE /api/collections/:id` now also filters
  on `owner_id` (RLS already did, so this is a seatbelt; patched, worker
  typechecks). `POST /api/events` has no rate limit, for anonymous visitors by
  design: bound it with a Cloudflare rate-limit rule on app.squareshare.eu.
  `cors.json` still allows browser PUTs to the shared bucket from the app
  origins, though nothing presigns a PUT there any more.
- **Home:** `LegalDocument` passes any link scheme through. Only developer-
  written content reaches it today. That file has another session's
  uncommitted edits, so it was left alone.
- **Review CSV parser** (`lib/products/csv.ts` `parseCsv`) has no cells-per-row
  cap: a 4 MB file of commas is one row of four million cells. A signed-in
  seller can only fail their own request with it.

**Rejected during verification:** a reviewer reported that anyone with the
publishable key could insert a native review straight through PostgREST while
`reviews_require_purchase` is unapplied. Client roles hold SELECT only on
`reviews` (live grants, 2026-11-03); every write is the service role's.

A reviewer reported that a team `viewer`
could hide or publish reviews through `review_set_visibility` because it
checked `store.read`. It checks `products.write`, in the migration (line 388)
and in production. The `store.read` it saw belongs to the tables' SELECT
policies.
