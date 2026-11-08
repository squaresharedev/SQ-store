# Security audit, 2026-11-03 (overnight) and 2026-11-05 (second pass)

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

**Second pass (2026-11-05).** Seven reviewers, one area each, read every
seller action, dashboard route, buyer surface, auth flow, file path, money
path, CI file and the two sibling repos; the live database was read through
the Supabase connector. Every claim was re-read against the source before it
was kept (four were rejected, see the end of section 2b). Same rules: code
uncommitted, SQL as new migrations tested on the replica, production read only.

**Owner actions from the first pass: all done, and verified live 2026-11-05.**
The Before User Created hook runs `signup_intent_gate` (auth log, 2026-11-04
18:26), and a direct `POST /auth/v1/signup` now answers 403 "Sign up on Square
Share.". The four two-factor policies are live. Home's `consent_logs` exists
and the first record landed (2026-11-04 18:34). The code was committed
(`7abc199`) and deployed: `sw.js` carries HSTS and nosniff.

**Done 2026-11-06:** the 14 `database-backup-*` artifacts are deleted and the
backup workflow is disabled on GitHub; the new `backup.yml` (no schedule,
refuses on a public repo) and the deletion job's uploader check are committed.
That commit also fixes the three test breaks that kept `7abc199` from
deploying (storefront action mocks, the 2FA migration's probe entry, the
replica's table lists).

**Owner actions now, in order:**
1. ~~Delete the database backups in the public repo's Actions artifacts~~
   (done 2026-11-06, see above).
2. Apply, in this order, `supabase/migrations/20261031_terms_notices.sql`
   (not security, but every deploy since `7abc199` needs it),
   `20261105_object_keys_anywhere.sql` (1.8, 1.9), then
   `20261105_write_bounds.sql` (1.11, 1.12). The Supabase connector declines
   `apply_migration` from a Claude Code session, so this is the SQL editor
   (or allowing the connector's writes). The schema gate now names all
   three, so nothing deploys until they are in. Then change their headers in
   `tests/db/prod-migrations.sql` to "(applied)" and re-run the deploy.
3. Review, commit and deploy: Store (deletion job, `backup.yml`), App
   (`worker/routes/artifacts.ts`, before App goes live), Home
   (`next.config.ts`, `public/_headers`). List under "Files changed, second
   pass".
4. DMARC to `p=quarantine` once Brevo's reports show the real mail passing
   (1.13).
5. Upgrade Next.js to 16.4.1 or later in Store and Home, in its own session
   with the full test suite (1.14).
6. Decide on review suppression (3b). Teamster: "Decide how to stop sellers
   hiding genuine bad reviews".

## 1. Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium | A password alone (no second factor) reads a 2FA seller's reviews, imports, rating and funnel tables | Fixed, **live** (applied 2026-11-04) |
| 2 | Low | Upload routes accept a post from any page on a squareshare.eu subdomain, carrying the seller's cookie | Fixed, deployed |
| 3 | Medium (compliance) | squareshare.eu has never stored a cookie consent record: the table does not exist | Fixed, **live** (applied 2026-11-04, first record landed) |
| 4 | Low (hardening) | Static files (`sw.js`, `widget.js`, every `/_next/static` chunk) are served without HSTS or nosniff | Fixed, deployed, seen live |
| 5 | Low | Anyone can write log lines through `/api/csp-report`: thousands per request, and text that can fake an `[ops alert]` line | Patched, unit-tested, route checked on the dev server |
| 6 | Medium | Every per-IP limit resets for an IPv6 client by changing address within its own /64 | Patched, unit-tested, proven on the dev server |
| 7 | Low | An app can name itself with a quote in its client id and break the OAuth cleanup job's filter | Patched, unit-tested |
| **Second pass** | | | |
| 8 | **High** | Any seller can make the account-deletion job delete other sellers' files (photos, paid downloads), by naming them anywhere in their own rows | Patched (migration NOT applied + job), tested |
| 9 | **High** (dormant: App not live) | Any App user can delete any object in the bucket the Store shares, through an artifact naming it | Patched (migration NOT applied + App Worker), tested |
| 10 | **High** | Every nightly encrypted production dump is downloadable by anyone signed in to GitHub (public repo artifacts) | Patched (`backup.yml`, not pushed); owner deletes the 15 artifacts |
| 11 | Medium | Any free account can fill the database through PostgREST (32 MB bodies, unbounded columns and row counts); anonymous inserts have no end | Patched (migration NOT applied), tested |
| 12 | Low | A team member can point their profile picture at their own server and see when (and from where) the owner opens the team page | Patched (same migration), tested |
| 13 | Medium (owner, DNS) | DMARC is `p=none`: mail forged as @squareshare.eu is not refused by receivers | Owner action |
| 14 | Medium (owner) | Next.js 16.2.9 is below the fixes for five critical advisories (none reachable in this configuration) | Owner action |
| 15 | Low (hardening) | squareshare.eu sends no HSTS, nosniff or Referrer-Policy | Patched (Home, not deployed) |

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

### Files changed, first pass (committed in `7abc199`, deployed)

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

### 1.8 The deletion job deletes whatever a seller names (high)

- **Where:** `src/lib/account-deletion/run.ts` and `object-keys.ts`
  (`collectObjectKeys`), against `guard_object_keys`
  (`20261021_object_key_ownership.sql`).
- **What:** the job finds a store's files BY SHAPE: every string anywhere in
  a product or storefront row that looks like an object key, in any column,
  and deletes each from R2 with the service role. The guard only judged
  `image_key`, `digital_file_key`, `gallery[].key`, `documents[].key` and
  `key` properties of a storefront config, and only fired when those columns
  changed.
- **Exploit:** a seller (any free account) reads other sellers' keys off any
  public page (every presigned photo URL carries one; a buyer's download URL
  carries the paid file's). They write them straight through PostgREST into
  their own `products.details` (16 KB, about 150 keys a row), `option_groups`,
  `title`, `description`, or under any other property of a storefront config,
  then ask for their own account to be deleted. Fourteen days later the job
  removes those sellers' photos, storefront images, fonts and paid downloads,
  and forgets their moderation approvals. Nothing on the victims' side shows
  it coming.
- **Fix, two layers:** `20261105_object_keys_anywhere.sql` makes the guard
  judge every key-shaped string anywhere in the row (`object_key_strings_in`
  over `to_jsonb(new)`) on every insert and update, as well as the named
  places; the rule is unchanged (a key new to the row must be the writer's own
  upload). And the job now deletes only keys uploaded by the account or its
  team (`keysUploadedBy`, `storeUploaders`), whatever a row says.
- **Live:** no production row holds a key from outside its store (checked by
  shape over every column, 2026-11-05), so it has not been used.
- **Tested:** `41-object-key-ownership` gains three cases (a stranger's key in
  details, options, title, description, a config text block, and an insert;
  own keys and path-like text still pass). `tests/unit/account-deletion.test.ts`
  proves the job keeps a stranger's planted keys out of what it deletes.

### 1.9 App can delete any file in the shared bucket (high, dormant)

- **Where:** App `worker/routes/artifacts.ts` (`DELETE /api/artifacts/:id`)
  and `public.artifacts.image_key`. App's `R2_BUCKET_NAME` is
  `squareshare-products`, the Store's bucket.
- **Exploit:** an App user inserts an artifact straight through PostgREST
  (`artifacts_owner_all` allows any row they own) with `image_key` set to any
  object in the bucket: a seller's product photo, a paid download. Then
  `DELETE /api/artifacts/:id`: the Worker deletes the row under RLS and evicts
  the row's key with its own R2 credentials. The create route checks the key
  (`isOwnObjectKey`); the delete trusted the row.
- **Dormant:** `app.squareshare.eu` does not resolve yet (App's `CUTOVER.md`
  step 7), and production holds no artifacts. It goes live at the cutover.
- **Fix, two layers:** the same migration adds `guard_artifact_image_key`
  (a client may only write `artifacts/{own id}/{uuid}-{name}`), and the delete
  route evicts only `isOwnObjectKey(key, "artifact", user.id)`.
- **Tested:** `41-object-key-ownership` (another user's App key, any Store key
  and a URL refused on insert; a swap to another user's key refused on
  update). Existing tests 15 and 37 now use real-shaped keys of the writer's
  own. App worker: typecheck and lint exit 0.

### 1.10 Production backups in a public repo's artifacts (high)

- **Where:** `.github/workflows/backup.yml`; the repo `squaresharedev/SQ-store`
  is public (the GitHub API answers it without a token).
- **What:** every night's encrypted `pg_dump` of `public` and `auth` (every
  account's email and password hash, buyers' names and addresses) was an
  Actions artifact for 14 days, and the artifacts of a public repository can
  be downloaded by anyone signed in to GitHub. 15 were listed on 2026-11-05,
  about 2 MB each. Only the GPG passphrase stands between them and the data;
  any leak of it, now or later, opens every copy ever downloaded.
- **Fix:** the schedule is gone (the org has been on Supabase Pro since
  2026-10-28, which keeps daily backups), and the job refuses to run at all
  while the repository is public. **Owner:** delete the existing artifacts
  (Actions, each `Database backup` run, Artifacts), and push the workflow. If
  an off-site copy is still wanted, make the repo private or send the file to
  a private bucket.
- **Tested:** the workflow parses (js-yaml), with only `workflow_dispatch`
  and the refusal as its first step. It has not run (needs a push).

### 1.11 Any free account can fill the database (medium)

- **Where:** client-writable columns with no size bound
  (`products.title`/`description`, `storefronts.config`/`brief`,
  `profiles.avatar_url`, `rate_limits.action` through `rl_take`), no ceiling
  on products or storefronts per account (plans cap neither while the switch
  is off; Pro storefronts are unlimited when it is on), and anonymous inserts
  into `waitlist_signups` and `consent_logs` with no limit at all.
- **Seen live:** the Supabase gateway accepted a 32 MB request body (sent to a
  function that does not exist, so nothing was stored). The database is 54 MB
  today; one account with a few hundred requests could add gigabytes. The
  anonymous tables are written at `vnyfndqpdllwhvhinjoi.supabase.co`, where no
  squareshare.eu edge rule applies.
- **Fix:** `20261105_write_bounds.sql`: size checks far above the app's own
  limits; a per-account ceiling for client writers (2000 products, product
  import's own ceiling; 200 storefronts); a platform-wide cap on anonymous
  inserts (120 consent records and 60 waitlist sign-ups a minute) with the
  row's time forced to now(). The numbers are tunable; under a flood the
  anonymous caps also refuse real visitors for that minute, which is the
  trade for a table that cannot grow without end.
- **Tested:** `47-write-bounds` (8 cases); all fail without the migration.

### 1.12 A member's picture URL is anyone's server (low)

- **Where:** `profiles.avatar_url` took any text; `team_roster` returns it and
  `MemberRow` draws it as a plain `<img>` for the owner and admins (the CSP
  that would stop it is report-only).
- **Fix:** in the same migration, a client may only set a picture that
  moderation approved: the `avatar:<url>` record both upload paths write
  before they set the URL (Store `lib/settings/avatar.ts`, App
  `worker/routes/profiles.ts`). Clearing it still works.
- **Tested:** `47-write-bounds`; test 23 updated (the owner's own session can
  no longer set an unapproved picture at all).

### 1.13 DMARC does not enforce (medium, owner)

`_dmarc.squareshare.eu` is `v=DMARC1; p=none` and SPF ends `~all`. DKIM is set
up (Brevo's `brevo1`/`brevo2` selectors resolve), so the real mail can align.
With `p=none` a receiver takes no action on mail forged as
`@squareshare.eu`: a "your payout is on hold" mail to a seller is one SMTP
session away. Read Brevo's DMARC reports (`rua`), and once only Brevo and
Cloudflare send for the domain, set `p=quarantine`, later `p=reject`.

### 1.14 Next.js below the critical fixes (medium, owner)

Store and Home run `next` 16.2.9; `pnpm audit --prod` reports 6 critical
advisories in Store (2 in Home), patched in 16.3.3 to 16.4.1. None is reachable
as configured: no `images.remotePatterns` (the optimizer refuses outside
URLs), no `"use cache"`, no `next/og`, and Workers rather than Windows. One
config change (an R2 origin in `remotePatterns`) would open the image
optimizer ones. Upgrade in its own session, with the full unit, db and e2e
suites.

### 1.15 squareshare.eu sends no transport headers (low)

The apex is the only host whose HSTS covers every subdomain, and it sent none
(nor nosniff or Referrer-Policy). Home `next.config.ts` now sends HSTS
(`includeSubDomains`, no `preload`: submitting to the preload lists is a
separate decision), nosniff and Referrer-Policy, with the same for static
files in `public/_headers`, and drops `x-powered-by`. Every subdomain found
(`www`, `dashboard`, `embed`, `admin`) is served over HTTPS by Cloudflare.
Checked by loading the config and calling `headers()`; no Home dev server was
started (1.4 GB of memory free, two dev stacks running). Live after Home's
next deploy.

### Files changed, second pass (all uncommitted)

Store:
- `supabase/migrations/20261105_object_keys_anywhere.sql`,
  `supabase/rollbacks/20261105_object_keys_anywhere.down.sql`,
  `src/lib/account-deletion/run.ts`, `src/lib/account-deletion/object-keys.ts`,
  `tests/unit/account-deletion.test.ts`,
  `tests/integration/41-object-key-ownership.test.ts`,
  `tests/integration/15-rls-collections-artifacts.test.ts`,
  `tests/integration/37-auto-moderation.test.ts` (1.8, 1.9)
- `supabase/migrations/20261105_write_bounds.sql`,
  `supabase/rollbacks/20261105_write_bounds.down.sql`,
  `tests/integration/47-write-bounds.test.ts`,
  `tests/integration/23-public-profiles-directory.test.ts` (1.11, 1.12)
- `.github/workflows/backup.yml` (1.10)
- `tests/db/prod-migrations.sql`: the 2FA block's header now "(applied
  2026-11-04)", and three blocks appended at the end: Home's
  consent_logs_bounds (applied) and the two pending migrations
- this report

App: `worker/routes/artifacts.ts` (the delete route only; the file also holds
another session's uncommitted edits). Home: `next.config.ts`, `public/_headers`.

Gates: `npx tsc --noEmit` 0 errors (Store); eslint exit 0 on every changed
Store file and App's route; App worker typecheck exit 0. Replica: 8 db files,
164 tests, all pass; the 11 new security cases all fail on a HEAD worktree
without the two migrations. `account-deletion` unit tests: 22 pass.

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

## 2b. Checked and sound, second pass (2026-11-05)

- **Seller actions and dashboard routes:** all 25 seller `"use server"` files
  and every dashboard route reach data through `getActiveAccount` and a role
  check, with an explicit store predicate on every service-role read and
  write (`getDiscount`, `getOrderById`, `listStorefronts`, `team_roster`
  traced). MCP tools run the same actions inside the grant's context.
- **Live database:** every client-callable SECURITY DEFINER RPC checks
  `mfa_session_ok` and then ownership or the team permission
  (`order_mark_shipped`, `order_refund`, `team_accept_invite`, `team_roster`,
  `rl_take`). `team_members_guard` freezes identity columns, never grants
  ownership, binds an accepted invite to the invited email, and refuses any
  role above the actor's. `guard_seller_text` and `guard_contact_proof`
  hold. Storage: three public buckets of platform images, no client policies.
  Realtime: only `notifications`, under RLS; no channel policies, so private
  channels deny everyone. Only `public` and `graphql_public` are exposed
  (PostgREST's own error, 2026-11-05).
- **Auth:** `safeInternalPath` and `afterChallenge` refuse every open-redirect
  form; recovery codes 80-bit, hashed, spent atomically; contact codes
  HMAC-bound to owner, channel and value; WebAuthn requires user
  verification; sign-in approval tokens are 32 random bytes, spent once. Both
  hooks run in production (`mfa_access_token_gate` on every refresh,
  `signup_intent_gate` on sign-up).
- **Buyer surface:** colours re-gated as strict hex before any `style`, font
  URLs and `cssUrl` quoted and escaped, text tiles plain React text, JSON-LD
  escaped; downloads re-prove the order link on every click; the embed's
  `frame-ancestors` hosts are `[a-z0-9.-]+` only; no open redirect in cancel,
  lookup or unsubscribe.
- **Files and mail:** five upload routes sniff bytes; SVGs are stored as
  attachments; CSV cells formula-escaped; PDF text never reaches PDF syntax;
  mail links come from `NEXT_PUBLIC_APP_URL`, never the Host header.
- **Money:** prices re-derived server-side; code usage re-checked under a row
  lock; stock taken atomically with add-ons; the test provider needs a
  development build; both webhooks resolve the account from the database, not
  the event.
- **Infra:** no secret in any repo's history; no source maps or dotfiles
  served; no dangling CNAME among the subdomains found; no `pull_request_target`
  or expression injection in any workflow.

**Rejected during verification (second pass):**
- "App's `cors.json` PUT lets an XSS overwrite approved images" (medium):
  CORS only decides whether a page may read a response. Writing to R2 still
  needs a SigV4 signature, and nothing presigns a PUT any more.
- "The MCP Apps view-kit has no `postMessage` origin check" (low): in MCP Apps
  the parent is the assistant's host, whose origin the view cannot know;
  checking `event.source === window.parent` is the protocol's pattern.
- "No DKIM for squareshare.eu" (part of a high): Brevo's `brevo1._domainkey`
  and `brevo2._domainkey` resolve. The DMARC half stands (1.13).
- "The two GoTrue hooks may be off" (unsure): both are in the auth logs.

**Hardening notes (second pass, no exploit shown):**
- App and Home ship no CSP at all, and the Store's is report-only. Give App
  one before its cutover: it renders user content on a same-site host.
- Home's waitlist answers 409 for an address already on it (and PostgREST's
  unique error says the same to a direct insert). Low value either way.
- Product documents (PDFs) open inline from R2; a seller's PDF can carry
  JavaScript, which modern viewers restrict. `response-content-disposition`
  would make them downloads, at a cost to buyers who just want to read one.
- One-time sign-in and recovery links are spent by the first GET: a mail
  scanner that follows links can use one before the person does. A
  confirm-with-a-button page fixes it.
- The sign-in approval match number has a 0.35% modulo bias (no attack: it is
  chosen from a list on the approving device).
- No Permissions-Policy, COOP or `poweredByHeader: false` on the dashboard;
  deploy.yml passes `secrets: inherit` to the e2e workflow.
- `pg_net`'s functions and `demo.signal_emit` are executable by anon; neither
  schema is exposed, so neither is reachable.
- `.env.local` on the dev machine holds a Supabase management token and live
  mail and model keys; keep it to what local work needs.
- Imported reviews count toward a product's rating like native ones (labelled
  per review, not in the average); `reviews_require_purchase` is still
  unapplied (known).

## 3. Open configuration items (owner action, not code)

- **Closed 2026-11-04:** the Before User Created hook is on, and a direct
  sign-up is refused (verified 2026-11-05). The text below is the state the
  first pass found.
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

## 5. Third pass, 2026-11-07: input sanitization and rate-limit coverage

Asked: every input, checked for any way to run code anywhere but the
author's own machine, and every entry point checked for a rate limit. Three
reviewers swept browser-side injection, server-side injection and limiter
coverage; every claim below was re-read against the source. Code is left
UNCOMMITTED for review, as in the earlier passes.

**Fixed:**

| # | Severity | Finding | Fix |
|---|---|---|---|
| 16 | Medium | CSV exports (orders, reviews, analytics) quoted a cell only for `,` `"` and line breaks. Excel in a comma-decimal locale (cs, de, pl, fr, ...) splits a double-clicked CSV on `;`, so a buyer- or seller-typed `Ada;=HYPERLINK(...)` became a second cell holding a live formula on the seller's machine | `lib/format/csv.ts` quotes `;` too, and the formula guard also catches a formula after leading spaces and the full-width `＝＋－＠`. `tests/unit/orders-csv.test.ts` |
| 17 | Low | `/oauth/revoke` (public, no auth) buffered the whole body before checking its 4 KB cap, and ran a lookup for any string | `readBoundedText`, and only a token shaped like ours (`isCredential`, `lib/agent/oauth/crypto.ts`) reaches the database. `tests/unit/agent/request-bounds.test.ts` |
| 18 | Low | `/mcp` had no body cap (the inline-image comment assumed one) and parsed the body twice: a token holder could make the Worker buffer the platform maximum per call | Read once, up to 5 MB (`MCP_REQUEST_BYTES_MAX`), 413 past it; the SDK gets the same bytes. Same test file |
| 19 | Low | No limiter on: the product photo proxy (`api/products/[id]/photo`), the Stripe Connect return (one Stripe read on the platform key per hit), accepting a team invite (both surfaces) | `productPhoto` budget; `billingRead` on the Connect refresh (over it, the page shows what we last knew); `teamMembership` in `lib/team/accept.ts` |
| 20 | Hardening | `lib/discounts/public.ts` had its own PostgREST quoting helper that escaped nothing (its callers only pass ISO timestamps) | Uses the shared `quotedFilterValue` |
| 21 | Low | Home's `/api/waitlist` (forwards to n8n) and `/api/consent-log` had no limit | Workers Rate Limiting bindings (`WAITLIST_LIMITER` 5/min, `CONSENT_LIMITER` 20/min per client, IPv6 as its /64) in Home `wrangler.jsonc` + `src/lib/rate-limit.ts`; fail open. Not deployed |

**Checked and sound (no change):** no raw-HTML sink in Store (React 19 SSR
escapes `</script` and `</style` in raw-text elements, checked by rendering;
JSON-LD also escapes `<`); every email is plain text, and SMTP bodies are
base64 with RFC 2047 headers, so no header or `DATA` injection; storefront
config, colours and fonts are re-validated on every read path (`parseStoredStorefrontConfig`
in the embed, hosted page, buyer face and gates); custom fonts take a derived
family name and a gated URL; seller URLs are https-only on the read side; SVGs
are refused if scriptable, stored as `attachment` and only drawn through
`<img>`; the photo proxy passes rasters only; `safeInternalPath` covers every
redirect; every user-text PostgREST filter goes through `quotedFilterValue` /
`escapeIlike`; no dynamic SQL takes a parameter; server fetches of user URLs go
through `isPublicHttpsUrl` per hop; object keys are server-built and sanitized;
webhooks verify signatures on the raw bounded body first; Content-Disposition
names are server-built.

**Left unlimited on purpose:** cheap reads of the caller's own data
(notification snapshot and bootstrap, roster and storefront pages), sign-out,
`setLocale`, `cancelAccountDeletion` (the undo of a destructive action must
never be refused), `acceptLegal` (on the Terms gate's critical path; an
idempotent upsert), `/api/csp-report` (already capped per request; a limiter
would add a database write per report). Google sign-in and the passkey option
calls make no server-side state (a URL; a sealed slip), so a reviewer's "costly"
flag on them was rejected. For a raw request flood on public endpoints the
right tool is a Cloudflare rate-limiting rule at the edge, not a database
limiter.

**Still open from earlier passes (owner):** `20261105_write_bounds.sql` is not
applied (checked live 2026-11-07: `guard_anonymous_insert_rate` absent), so
anyone with the public key can still insert waitlist and consent rows straight
into PostgREST without limit, past Home's new route limits.
