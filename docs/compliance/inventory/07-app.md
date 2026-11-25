# 07: Write-path inventory, the App repo (SQ-app)

Part 7 of 9 of the compliance write-path inventory for the Czech-only beta
(R1 to R8). Investigation only: nothing was changed, built, run or called.
Every claim cites `file:line`; paths are repo-prefixed (`App/`, `Store/`,
`SQ-system/` = `C:\Squareshare\System\SQ-system`, `Home/`). Anything not opened
is marked (inferred).

Date of reading: 2026-11-22. App HEAD: `b580143` (the only commit, "Initial
commit").

---

## 0. Headline findings

1. **App has no commerce path at all.** No Stripe dependency or code, no
   price, currency, product, storefront, cart, checkout, order or refund
   handling, and no link from App to any Store buyer page. The only outbound
   links to Store are the central login URL and a server-to-server content
   check. A buyer cannot get from App to paying today. (Sections 3, 4.)
2. **App has no seller sign-up, onboarding, country or currency selection, and
   no geography logic.** It has no login page; it redirects to Store's login.
   (Section 5.)
3. **The only commerce-adjacent write is a dormant bridge:** `POST /api/artifacts`
   writes `artifacts.product_id` from the request body with no ownership check,
   but the SPA always sends `null`, and nothing in App ever reads or displays
   it. (Section 4.2.)
4. **No discovery feed or ranker exists.** `algorithm.md` is a plan; the only
   built pieces are event capture (switched off by a hardcoded consent `false`)
   and an uncalled `reportPenalty()` function. Search orders results
   alphabetically. (Section 7.)
5. **Reports:** signed-in only, filed into the shared `reports` table through
   the caller's RLS session. The UI can report artifacts only (a hover pill on
   each card); the API also accepts `profile`, `product`, `storefront`, but no
   UI sends those, and no collection can be reported. (Section 6.)
6. **App is very likely not live.** `wrangler.jsonc` has no `routes` entry, so
   the Worker is not bound to `app.squareshare.eu` (CUTOVER item 7), and a
   2026-10-11 memory note says it is "deployed nowhere; the marketplace has no
   data". Not verified against production (forbidden by the brief). (Section 1.)
7. **For R1 to R6, App has no path that matters today.** Where a non-CZ
   seller's content could surface: public profiles, public collections and
   search show any public account regardless of country, because App has no
   access to seller country in its public reads. No price or currency can
   surface, because App renders none. (Section 9.)

---

## 1. Repo state: what App is and whether it is live

| Fact | Evidence |
|---|---|
| App is the curation app: personal positioned grids of "artifacts" in "collections", shared at `/:username`; one Cloudflare Worker serves the Vite SPA and a Hono API under `/api/*`. | `App/README.md:3-6`, `App/worker/index.ts:15-26`, `App/wrangler.jsonc:15-19` |
| It is the hosted marketplace (Stage 3 surface) per the owner. | memory `content-moderation-architecture.md:45-47` (dated 2026-09-26) |
| Auth, database and storage are shared with Store: Supabase session cookie on `.squareshare.eu` set by Store's login; no login page in App. | `App/README.md:8-18`, `App/src/App.tsx:14-18` |
| The Worker is NOT bound to a hostname: `wrangler.jsonc` has no `routes` key; CUTOVER says adding `{ "pattern": "app.squareshare.eu", "custom_domain": true }` is a pending manual step. | `App/wrangler.jsonc:1-65` (no `routes`), `App/CUTOVER.md:130-143` |
| Memory, 2026-10-11: "SQ-app's code is NOT committed or deployed (it is deployed nowhere; the marketplace has no data)". | memory `auto-moderation-wall.md:19-22`, `:186-188` |
| CUTOVER items 1 to 9 are all still listed as manual steps (packages token, R2 secrets, CORS, CDN domain, hostname, Store `redirect_to`). | `App/CUTOVER.md:14-163` |
| Shared packages are local junctions into SQ-system, not registry installs; `package.json` asks for `^0.1.0` while the junctioned `schemas` source is version `0.5.0`. | `App/README.md:134-149`; junction listing of `App/node_modules/@squaresharedev/*`; `App/package.json:19-21`; `SQ-system/packages/schemas/package.json:3` |
| README is stale in two places: it says there is no privileged key and moderation is a no-op, while the working tree uses the service role and calls Store's content check. | `App/README.md:13-15`, `:151-156` vs `App/worker/lib/supabase.ts:62-75`, `App/worker/lib/moderation.ts:38-60` |

### 1.1 Uncommitted files (working tree vs HEAD `b580143`)

Modified (25): `.env.example`, `CUTOVER.md`, `RISKS.md`, `algorithm.md`,
`index.html`, `src/components/ArtifactCard.tsx`, `src/components/ReportModal.tsx`,
`src/components/StudioPage.tsx`, `src/lib/api.ts`, `src/lib/seo.ts`,
`src/types/index.ts`, `worker/env.ts`, `worker/lib/database.types.ts`,
`worker/lib/dto.ts`, `worker/lib/moderation.ts`, `worker/lib/r2.ts`,
`worker/lib/supabase.ts`, `worker/routes/artifacts.ts`,
`worker/routes/collections.ts`, `worker/routes/events.ts`,
`worker/routes/profiles.ts`, `worker/routes/reports.ts`,
`worker/routes/search.ts`, `worker/routes/uploads.ts`, `wrangler.jsonc`.

Untracked (3): `public/og-image.jpg`, `worker/lib/moderation-contract.ts`,
`worker/lib/ranking.ts`.

Unchanged since the commit (relevant ones): `worker/index.ts`,
`worker/routes/auth.ts`, `worker/routes/config.ts`, `worker/lib/csrf.ts`,
`worker/lib/rate-limit.ts`, `worker/lib/social.ts`, `src/App.tsx`,
`src/lib/events.ts`, `src/lib/config.ts`, `src/components/PublicProfilePage.tsx`,
`src/components/PublicCollectionPage.tsx`, `src/components/PublicGrid.tsx`,
`src/components/ArtifactReadOnlyCard.tsx`, `src/components/ArtifactDetailModal.tsx`,
`src/components/SettingsPage.tsx`, `src/components/StudioLayout.tsx`,
`package.json`.

In this report, **[U]** marks a finding that sits in an uncommitted file and
**[C]** one in a file unchanged since the commit. Notable working-tree changes:
the upload route changed from `POST /api/uploads/presign` (HEAD
`worker/routes/uploads.ts:38-39`) to `POST /api/uploads/image`; collection
create moved from the session client (HEAD `worker/routes/collections.ts:47-58`)
to the service role; the report vocabulary and target types were widened; the
whole Store content-check client is new.

---

## 2. Every worker endpoint

### 2.1 Middleware and plumbing (apply to all routes)

| Piece | Behaviour | Evidence |
|---|---|---|
| Base path | `/api`; only `/api/*` reaches the Worker, everything else is static assets with SPA fallback. | `App/worker/index.ts:27-28`, `App/wrangler.jsonc:15-19` [C] |
| CSRF | For POST/PUT/PATCH/DELETE, an `Origin` header (if present) must match `Host`; requests with no `Origin` pass. | `App/worker/lib/csrf.ts:4-31` [C] |
| Supabase client | One RLS-scoped client per request: `SUPABASE_URL` + `SUPABASE_ANON_KEY` (publishable) + the caller's cookies. | `App/worker/lib/supabase.ts:51-60` [U] |
| Service-role client | `serviceClient(env)` from the `SUPABASE_SERVICE_ROLE_KEY` secret; null if unset. Used for collection name writes. `/api/events` builds its own service client. | `App/worker/lib/supabase.ts:62-75` [U], `App/worker/routes/events.ts:137-139` [U], `App/worker/env.ts:25-30` [U] |
| `requireUser` | 401 for guests; also 401 (with `aal2Required`) for a session that owes its second factor. | `App/worker/lib/supabase.ts:87-116` [U] |
| Rate limit | `rl_take(p_action, p_max, p_window_seconds)` RPC via the session client; keyed on `auth.uid()` (inferred from comment). | `App/worker/lib/rate-limit.ts:3-26` [C] |
| Store content check (outbound) | `POST {MODERATION_CHECK_URL}` with `Authorization: Bearer {MODERATION_SECRET}`, 15 s timeout, bodies `{target}`, `{text}`, `{handle}`, `{avatar}`. Any failure is "not approved". | `App/worker/lib/moderation.ts:34-60`, `:67-109` [U]; URL var `App/wrangler.jsonc:63` [U] |
| R2 (outbound) | S3 API PUT/HEAD/DELETE on bucket `squareshare-products` with `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`. | `App/worker/lib/r2.ts:40-56`, `:76-156` [U]; `App/wrangler.jsonc:41-42` |
| Errors | JSON 404 for unknown routes, 500 for unhandled errors. | `App/worker/index.ts:40-44` [C] |

Keys: the publishable key is a `wrangler.jsonc` var (`App/wrangler.jsonc:38`);
the service-role key, R2 keys and `MODERATION_SECRET` are Worker secrets
(`App/wrangler.jsonc:21-26`, `App/.env.example:24-48`). Values not copied.

### 2.2 Endpoint table

"Session" = anon/publishable key plus the caller's session cookie, under RLS.
"Service" = service-role key (bypasses RLS).

| # | Method and path | Auth | Reads | Writes (key) | Rate limit | Evidence |
|---|---|---|---|---|---|---|
| 1 | `GET /api/config` | none | wrangler vars only | none | none | `App/worker/routes/config.ts:8-15` [C] |
| 2 | `GET /api/me` | `requireUser` | `profiles` `select("*")` own row (session) | none. Response is `meDto` (id, email, username, avatar, isPublic, createdAt); all other profile columns, including `tax_country`, are read but dropped. | none | `App/worker/routes/auth.ts:11-30` [C], `App/worker/lib/dto.ts:60-69` [U] |
| 3 | `POST /api/auth/logout` | none (acts on the cookie) | none | `auth.signOut()` (GoTrue; clears shared cookies) | none | `App/worker/routes/auth.ts:37-44` [C] |
| 4 | `GET /api/profiles/:username` | anon OK; optional viewer | `public_profiles` (id, username, avatar_url; case-insensitive), `collections` (owner, `is_public=true`), `artifacts` + `artifact_likes(count)` filtered `moderation_status='ok'`, `follows` counts, viewer's `follows` row, viewer's `artifact_likes` (all session) | none | none | `App/worker/routes/profiles.ts:66-78`, `:88-186` (gate at `:124`) [U] |
| 5 | `POST /api/profiles/:username/follow` | `requireUser` | `public_profiles` | `follows` insert (session) | `sq_app_follow` 60/h | `App/worker/routes/profiles.ts:26`, `:194-222` [U] |
| 6 | `DELETE /api/profiles/:username/follow` | `requireUser` | `public_profiles` | `follows` delete (session) | none | `App/worker/routes/profiles.ts:225-247` [U] |
| 7 | `PATCH /api/profiles/me` | `requireUser` | `profiles.username` own row (session); R2 HEAD of the avatar key | `profiles` update of `username`, `is_public`, `avatar_url`, `updated_at` (session). Before storing: Store check of the handle and the avatar. | none | `App/worker/routes/profiles.ts:35-46`, `:264-338` [U] |
| 8 | `GET /api/collections` | `requireUser` | own `collections` (session) | none | none | `App/worker/routes/collections.ts:28-42` [U] |
| 9 | `POST /api/collections` | `requireUser` | none | Store text check, then `collections` insert (**service**, `owner_id` pinned to the user) | none | `App/worker/routes/collections.ts:45-76` (insert `:59-70`) [U] |
| 10 | `PATCH /api/collections/:id` | `requireUser` | none | `collections` update of `is_public`, `sort_order`, `updated_at` (session); then, if renamed, `name` update (**service**, pinned to id and owner) | none | `App/worker/routes/collections.ts:79-132` (service `:111-125`) [U] |
| 11 | `DELETE /api/collections/:id` | `requireUser` | none | `collections` delete (session); artifacts released by FK `ON DELETE SET NULL` | none | `App/worker/routes/collections.ts:136-155` [U]; `App/RISKS.md:48-82` |
| 12 | `GET /api/artifacts[?collectionId]` | `requireUser` | own `artifacts` + `artifact_likes` (session) | none | none | `App/worker/routes/artifacts.ts:30-60` [U] |
| 13 | `POST /api/artifacts/:id/like` | `requireUser` | `artifacts` visibility (session) | `artifact_likes` insert (session) | none | `App/worker/routes/artifacts.ts:68-93` [U] |
| 14 | `DELETE /api/artifacts/:id/like` | `requireUser` | none | `artifact_likes` delete (session) | none | `App/worker/routes/artifacts.ts:96-111` [U] |
| 15 | `POST /api/artifacts` | `requireUser` | own `collections` row; R2 HEAD | Store text check; `artifacts` insert incl. **`product_id` from the body** (session); Store `settleArtifact`; on removal, deletes the row (session) and the R2 object | none | `App/worker/routes/artifacts.ts:115-212` (insert `:174-192`, `product_id` `:179`) [U] |
| 16 | `PATCH /api/artifacts/placements` | `requireUser` | none | `artifacts` grid fields, up to 500 parallel updates (session) | none | `App/worker/routes/artifacts.ts:220-258` [U] |
| 17 | `PATCH /api/artifacts/:id` | `requireUser` | none | Store text check if reworded; `artifacts` update of title, description, offsets, placement (session; `productId` not accepted); Store `settleArtifact` | none | `App/worker/routes/artifacts.ts:18-23`, `:261-316` [U] |
| 18 | `DELETE /api/artifacts/:id` | `requireUser` | none | `artifacts` delete (session); R2 delete only for the caller's own key | none | `App/worker/routes/artifacts.ts:321-348` [U] |
| 19 | `POST /api/uploads/image` | `requireUser` | none | R2 PUT under a key the Worker mints (`artifacts/` or `avatars/{userId}/{uuid}-{name}`); avatar: Store check, R2 DELETE on refusal. Magic-byte sniff (still JPEG/PNG/WebP), 10 MB / 2 MB caps. | `sq_app_presign` 30/h | `App/worker/routes/uploads.ts:15-19`, `:43-101` [U]; `App/worker/lib/r2.ts:33-38`, `:107-128`, `:160-163` [U] |
| 20 | `POST /api/reports` | `requireUser` | target check: `public_profiles` (profile) or `artifacts`/`products`/`storefronts` `id, moderation_status` (session) | `reports` insert (session) | `sq_app_report` 10/h | `App/worker/routes/reports.ts:34`, `:61-136` [U] |
| 21 | `GET /api/search?q=` | anon OK | `public_profiles` (username ilike), `collections` (`is_public`, name ilike), `public_profiles` owner lookup (session) | none | `sq_app_search` 120/h, signed-in only, fails open | `App/worker/routes/search.ts:14-93` [U] |
| 22 | `POST /api/events` | **none required**; `user_id` from session if any | none | `interaction_events` bulk insert, up to 50 rows per request (**service**) | none | `App/worker/routes/events.ts:47`, `:108-149` [U] |

### 2.3 Writes by table (App only)

| Table / store | Columns App writes | Key | Endpoint(s) |
|---|---|---|---|
| `profiles` (shared with Store; same row is the seller's profile) | `username`, `is_public`, `avatar_url`, `updated_at` | session | #7 |
| `collections` | `owner_id`, `name`, `is_public`, `sort_order`, `updated_at`; delete | service (create, `name`), session (rest) | #9, #10, #11 |
| `artifacts` | all grid/meta columns plus `product_id` on insert; delete | session | #15 to #18 |
| `artifact_likes` | insert/delete | session | #13, #14 |
| `follows` | insert/delete | session | #5, #6 |
| `reports` | `target_type`, `target_id`, `reporter_id`, `reason`, `details`, optional `reporter_email` | session | #20 |
| `interaction_events` | `user_id`, `session_id`, `event_type`, `artifact_id`, `profile_id`, `collection_id`, `surface`, `position`, `dwell_ms`, `metadata` | service | #22 |
| `rate_limits` | via `rl_take` (inferred: definer function writes it) | session RPC | #5, #19, #20, #21 |
| R2 `artifacts/*`, `avatars/*` | objects | R2 keys | #15, #18, #19, #7 (HEAD) |
| Store-side moderation state | outcomes and approvals recorded by Store when App asks (inferred from comments) | Store's own | #7, #9, #10, #15, #17, #19 via `App/worker/lib/moderation.ts:62-109`, `Store/src/app/api/moderation/check/route.ts:21-35`, `:65-101` |

**App never writes:** `products`, `storefronts`, `orders`, prices/plans,
discounts, `team_members`, `waitlist_signups`, anything Stripe. App reads
`products`/`storefronts` only for `id, moderation_status` in the report target
check (`App/worker/routes/reports.ts:100-105`) [U]. The RPC list App's types
know includes `decrement_stock` (`App/worker/lib/database.types.ts:909-912`),
but no App code calls it (only `rl_take` is called:
`App/worker/lib/rate-limit.ts:19`).

---

## 3. Stripe, checkout and the buyer's path to paying

| Question | Answer | Evidence |
|---|---|---|
| Any Stripe dependency? | No. Dependencies are dnd-kit, `@squaresharedev/{db,grid,schemas}`, Supabase, aws4fetch, clsx, hono, lucide, react, react-router, tailwind-merge, zod. | `App/package.json:15-33` [C] |
| Any `stripe`, `checkout`, `price`, `currency`, `refund`, `payment`, `cart` in App code? | None in `src/` or `worker/` except the generated DB types and the reserved `purchase` event name. | grep over `App/src`, `App/worker` (word-bounded); matches only in `App/worker/lib/database.types.ts` and `App/worker/routes/events.ts:38`, `App/src/lib/events.ts:18-30` |
| Does App link to Store's hosted product, storefront, cart or checkout pages? | No. The only outbound navigations are to `loginUrl` and a `placehold.co` image fallback; one `mailto:`. | `App/src/lib/config.ts:45-48`, `App/src/App.tsx:70`, `App/src/components/StudioLayout.tsx:60`, `App/src/components/ArtifactModal.tsx:79`, `App/src/components/SettingsPage.tsx:735` |
| Does App embed Store pages (iframe, widget.js)? | No `iframe`, no widget script, no storefront renderer. Public grids render artifacts with `PositionedGrid` from the grid package. | `App/src/components/PublicGrid.tsx:1-70` [C] |
| Does App display a price or a "Buy" control anywhere? | No. Public artifact cards show image, title, description, like and report pills; the detail modal shows image, title, description. | `App/src/components/ArtifactReadOnlyCard.tsx:39-101` [C], `App/src/components/ArtifactDetailModal.tsx:77-155` [C] |
| Does App create orders or refunds? | No write to `orders` anywhere. | Section 2.3 |

**Conclusion: there is no buyer path from App to paying, of its own or via
Store.**

---

## 4. Anything that creates or changes sellers, products, storefronts, prices

### 4.1 Sellers / profiles

- `PATCH /api/profiles/me` changes the shared `profiles` row's `username`,
  `is_public` and `avatar_url` (`App/worker/routes/profiles.ts:264-338`) [U].
  It is the same row Store uses for the seller (`profiles` carries
  `is_seller`, `tax_country`, `tax_business_name`, `tax_vat_id`:
  `App/worker/lib/database.types.ts:555-571`). App never writes or reads
  `is_seller`, `tax_*`, `seller_*`, `display_name` in code (grep: only in
  `database.types.ts`).
- App's DB types are a hand-curated subset and are behind the live schema:
  Store added `profiles.seller_address`, `seller_email`, `seller_phone`
  (`Store/supabase/migrations/20260905_seller_identity_on_profile.sql:37-39`),
  which `App/worker/lib/database.types.ts:555-622` does not list. Memory
  `content-moderation-architecture.md:32-36` says the file is deliberately a
  subset.

### 4.2 Products: the dormant `product_id` bridge

| Fact | Evidence |
|---|---|
| The shared `artifactSchema` accepts `productId: uuid | null` ("References a store product (uuid) when the artifact is shoppable"). Same in v0.1.0. | `SQ-system/packages/schemas/src/app.ts:83-84`; `git show v0.1.0:packages/schemas/src/app.ts` lines 81-82 |
| `POST /api/artifacts` writes `product_id: parsed.data.productId` with no check that the product exists for, or belongs to, the caller (only the FK applies). | `App/worker/routes/artifacts.ts:174-192` (`:179`) [U] |
| DB: `product_id uuid references public.products(id) on delete set null`, described as "a dormant commerce bridge", "Unused by the curation rebuild's v1". Insert policy checks only `owner_id = auth.uid()`. | `Store/supabase/migrations/20260711_curation_foundation.sql:115-117`, `:133-134`, `:148-150` |
| The SPA always sends `productId: null`. | `App/src/lib/api.ts:331-342` (`:336`) [U] |
| `PATCH /api/artifacts/:id` cannot change it (omitted from the update schema). | `App/worker/routes/artifacts.ts:18-23` [U] |
| No App DTO returns it (owner or public), so nothing displays it. | `App/worker/lib/dto.ts:10-47` [U] |

So: a crafted API call (or a direct PostgREST insert with the publishable key,
inferred) can link an artifact to any existing product id, but App has no read
path for the link. If a "shoppable artifact" feature is built later, this is
the column it would use.

### 4.3 Storefronts, prices, currencies

None. App has no code that creates, edits, prices, or converts anything for
sale. `products.currency`, `products.price_cents`, `orders.currency` exist only
in the generated types (`App/worker/lib/database.types.ts:477`, `:489`, `:410`).

---

## 5. Sign-up, onboarding and seller-related flows

| Question | Answer | Evidence |
|---|---|---|
| Sign-up or login page in App? | No. Protected views redirect to `LOGIN_URL?redirect_to=<url>` (Store's `/login`). | `App/README.md:10-12`, `App/src/lib/config.ts:44-48` [C], `App/wrangler.jsonc:49-51`, `App/STORE_LOGIN_SPEC.md:1-16` |
| Who creates the profile row? | Store's on-signup trigger `handle_new_user` (inferred; App only states it). | `App/worker/routes/auth.ts:7-9`, `:23-28` [C] |
| `ui-export/components/AuthPage.tsx` has a signup form. Is it built? | No. `tsconfig.app.json` includes only `src`; the Vite entry is `src/main.tsx`; README calls `ui-export/` "input, not code". | `App/tsconfig.app.json:24`, `App/index.html:31`, `App/README.md:29` |
| Seller onboarding, Stripe Connect onboarding, trader identity? | None. | grep (no `seller`, `stripe`, `trader` in `App/src`, `App/worker` code) |
| Country or currency selection? | None. | Section 8 |
| Geography logic (IP country, `cf-ipcountry`, `Intl`, locale routing)? | None. | Section 8 |
| What can a signed-in user set? | Username, public/private, avatar (Settings Profile and Security tabs). The password form is a stub. | `App/src/components/SettingsPage.tsx:16-26`, `:592-596`, `:633-660` [C]; `App/src/lib/api.ts:386-397` [U] |

---

## 6. Reports and moderation

### 6.1 The endpoint (`POST /api/reports`) [U]

| Aspect | Detail | Evidence |
|---|---|---|
| Auth | Signed in only (`requireUser`); a deliberate contrast with Store's anonymous, IP-limited endpoint for hosted product pages. | `App/worker/routes/reports.ts:18-26`, `:61` |
| Schema | `targetType` in `artifact`, `profile`, `product`, `storefront`; `targetId` uuid; `reason` in `illegal`, `sexual`, `violence`, `hate`, `counterfeit`, `scam`, `spam`, `other`; `details` up to 1000 chars; optional `reporterEmail` ("EU Digital Services Act, Art. 16"). Strict object. | `App/worker/lib/moderation-contract.ts:36-45`, `:57-62`, `:66`, `:70-84` (untracked) |
| Rate limit | 10 per user per hour. | `App/worker/routes/reports.ts:34`, `:77-79` |
| Target check | Profile: must be in `public_profiles`. Artifact/product/storefront: row read with `id, moderation_status` through the caller's RLS. If already not `ok`, answers 201 and writes nothing. | `App/worker/routes/reports.ts:89-116`; `App/worker/lib/moderation-contract.ts:99-102` |
| Product/storefront reachability | The route's own comment says products and storefronts "have no RLS policy granting a marketplace visitor a read", so the check only resolves for rows the caller can see; otherwise 404 "That product no longer exists." (inferred consequence; RLS not verified). | `App/worker/routes/reports.ts:81-85`, `:110` |
| Where it is filed | Shared `reports` table, session key, `reporter_id = user.id`. Duplicate open report from the same reporter (23505) answered as success. No read endpoint. | `App/worker/routes/reports.ts:11-31`, `:118-135` |
| Dependency | The widened reason list needs the Admin repo's `0007_content_reports.sql` CHECK in prod, or inserts fail. | `App/worker/lib/moderation-contract.ts:29-35` |
| Side event | On success the client emits a `report` interaction event (only if consent, which is hardcoded off). | `App/src/lib/api.ts:417-427` [U], `App/src/lib/events.ts:59-61` [C] |

### 6.2 The UI (`ReportModal`) [U]

| Aspect | Detail | Evidence |
|---|---|---|
| Target types the modal supports | `artifact` or `profile` only (no product, storefront, collection). | `App/src/components/ReportModal.tsx:29-35` |
| Reasons shown | Eight labels matching the contract; no preselection; submit disabled until chosen. | `App/src/components/ReportModal.tsx:13-22`, `:37-40`, `:136-142` |
| Fields | Reason radio, optional details (maxLength 1000). `reporterEmail` is NOT collected. | `App/src/components/ReportModal.tsx:56-61`, `:116-127` |
| Copy | "Reports are reviewed by the SquareShare team and are never shown publicly." | `App/src/components/ReportModal.tsx:88-90` |
| Where it is opened | Artifact cards on public profile pages and public collection pages (flag pill), and the owner's own studio cards. | `App/src/components/PublicProfilePage.tsx:124-133`, `:299` [C]; `App/src/components/PublicCollectionPage.tsx:105-114`, `:214-216` [C]; `App/src/components/StudioPage.tsx:354`, `:413-419` [U] |
| Visibility of the control | The like/report pills are `opacity-0` until `group-hover`. | `App/src/components/ArtifactReadOnlyCard.tsx:67-101` (`:69`) [C] |
| Anonymous visitors | Clicking report redirects to Store's login. | `App/src/components/PublicProfilePage.tsx:126-128`, `App/src/components/PublicCollectionPage.tsx:107-109` [C] |
| Profile report | The page's state type allows `profile`, but the only setter sets `artifact`; there is no "report this profile" button. | `App/src/components/PublicProfilePage.tsx:33`, `:130` [C] |
| Detail modal | No report control. | `App/src/components/ArtifactDetailModal.tsx:53-160` [C] |

### 6.3 Moderation gates on reads and writes

- Public artifact reads filter `moderation_status = 'ok'` in the query
  (`App/worker/routes/profiles.ts:120-124`) [U] and the DB policy enforces the
  same (`Store/supabase/migrations/20261013_marketplace_moderation.sql:50-65`).
- Handles, avatars, collection names, artifact titles and descriptions are
  checked by Store before or right after storing; failure is never approval
  (`App/worker/lib/moderation.ts:3-23`) [U].
- `artifacts.image_key` must be `artifacts/{auth.uid()}/{uuid}-{name}`,
  enforced by a DB trigger for the `authenticated` role
  (`Store/supabase/migrations/20261105_object_keys_anywhere.sql:130-161`).

---

## 7. Feed and ranking

### 7.1 What exists

| Item | State | Evidence |
|---|---|---|
| Discovery feed endpoint or page | **None.** No route lists content across users; routes are per-username, own-content, search. | Section 2.2; `App/src/App.tsx:19-43` [C] |
| Ranker | **None.** `algorithm.md` status: "Planning. We are not building ranking yet." | `App/algorithm.md:1-3`, `:59-71` |
| `reportPenalty()` | Implemented, uncalled (no import anywhere). Multiplier in [0.05, 1]: sensitivity 2, half-life 14 days, floor 0.05. | `App/worker/lib/ranking.ts:37-79` (untracked); grep shows no caller |
| Event capture | Client emitter and `/api/events` exist; the consent gate `hasAnalyticsConsent()` returns `false`, so the client sends nothing. | `App/src/lib/events.ts:53-61`, `:136-158` [C]; `App/worker/routes/events.ts:108-149` [U] |
| `interaction_events` table | Store migration header: "NOT APPLIED TO PRODUCTION as of 2026-08-07". | `Store/supabase/migrations/20260720_interaction_events.sql:1-10` |

### 7.2 Orderings that exist today (what a P2B "main parameters" disclosure would describe)

| Surface | Order | Evidence |
|---|---|---|
| Public profile collections | owner's `sort_order` ascending | `App/worker/routes/profiles.ts:110-115` [U] |
| Public profile / collection artifacts | owner's `sort_order` ascending, owner's grid positions | `App/worker/routes/profiles.ts:116-125` [U] |
| Search, users | `username` ascending, max 10 | `App/worker/routes/search.ts:15`, `:43-48` [U] |
| Search, collections | `name` ascending, max 10 (20 fetched, then filtered to publicly resolvable owners) | `App/worker/routes/search.ts:49-56`, `:87-90` [U] |

No seller, product or offer is ranked anywhere.

### 7.3 Planned ranking parameters (from `algorithm.md`, not built)

Cold start: recency, popularity, category match, editorial boosts
(`App/algorithm.md:31`). Later: content embeddings, collaborative signal,
learned ranker (`:33-35`). Ranking features: signal weights, recency decay,
creator affinity, position bias, novelty (`:45`). Intent weights, purchase
highest (`:24`, `:49`). Report pressure multiplier (`:50`, an uncommitted
addition). Freshness decay, diversity cap per creator, exploration slots,
separate following/discovery feeds, weights in config (`:52-56`). Event
vocabulary includes `purchase` (`:102`), also reserved in code
(`App/worker/routes/events.ts:28-43`, `App/src/lib/events.ts:18-34`).

### 7.4 Products for sale, prices and currency formatting in the feed

None: no product appears in any App response, and no price or currency is
formatted anywhere (Section 3).

---

## 8. Country, currency, region and locale literals

Exhaustive grep over `App/src`, `App/worker`, `App/index.html`,
`App/wrangler.jsonc`, `App/vite.config.ts`, `App/package.json`,
`App/cors.json`, `App/.env.example`, `App/tsconfig*.json`, `App/eslint.config.js`
for country, countries, region, locale, lang, `Intl`, `toLocale*`,
`navigator.language`, CZK, EUR, USD, CZ, Czech, `cs-CZ`, `en-*`, i18n, hreflang,
`og:locale`, timeZone, geo, `cf-ipcountry`, EU.

| Literal / list | Kind | Evidence |
|---|---|---|
| `<html lang="en">` | page language | `App/index.html:2` [U file, line unchanged] |
| `new Date(col.createdAt).toLocaleDateString()` | date in the browser's default locale (no locale argument) | `App/src/components/ProfilePage.tsx:467` [C] |
| `region: "auto"` | AWS SigV4 region for R2, not geography | `App/worker/lib/r2.ts:51` [U] |
| "EU Digital Services Act, Art. 16" | comment on `reporterEmail` | `App/src/lib/api.ts:124`, `App/worker/lib/moderation-contract.ts:80` |
| `profiles.tax_country` | DB column in generated types; never referenced by App code | `App/worker/lib/database.types.ts:570`, `:589`, `:608` |
| `products.currency`, `orders.currency` | DB columns in generated types; never referenced by App code | `App/worker/lib/database.types.ts:477`, `:410` |
| `.squareshare.eu` hosts | domains, not regions | `App/wrangler.jsonc:47-63`, `App/cors.json:7-8`, `App/index.html:19`, `:27` |

**Locales shipped:** English only. There is no i18n library
(`App/package.json:15-33`), no message files, and all UI copy is hardcoded
English in components (for example `App/src/components/SettingsPage.tsx:16-26`,
`App/src/components/ReportModal.tsx:13-22`). No currency, country or region
list exists anywhere in App.

---

## 9. What App would need for the Czech-only beta (facts only)

### 9.1 Rule by rule

| Rule | App path today | Facts |
|---|---|---|
| R1 seller in CZ | None that sells | App neither onboards sellers nor reads seller country. Its public reads see only `public_profiles` id/username/avatar (`App/worker/routes/profiles.ts:72`, `App/RISKS.md:87-90`). The one country column App's types know (`profiles.tax_country`) appears only in own-row `select("*")` reads and is dropped (`App/worker/routes/auth.ts:14-18`, `App/worker/routes/profiles.ts:320-324`, `App/worker/lib/dto.ts:60-69`). |
| R2 CZK only | None | No price or currency is read or rendered (Section 3). |
| R3 delivery to CZ | None | No address, shipping or checkout code. |
| R4 billing country CZ | None | Same. |
| R5 collab checkout | None | No cart or multi-seller code. |
| R6 server enforcement | None in App | No checkout exists in App to enforce. |
| R7 public messaging | No copy exists | Placement facts in 9.3. |
| R8 waitlist | None in App | Facts in 9.4. |

### 9.2 Where a non-CZ seller's content could surface in App

| Surface | Why | Evidence |
|---|---|---|
| `/:username` public profile (grid + collections) | Any public, approved profile resolves; no country filter possible from the data App reads. | `App/worker/routes/profiles.ts:88-186` [U]; `App/src/App.tsx:37` [C] |
| `/:username/c/:id` public collection | Same data source. | `App/src/components/PublicCollectionPage.tsx:46-54` [C] |
| Search (users and collections) | No country filter. | `App/worker/routes/search.ts:42-90` [U] |
| Future: shoppable artifacts | Via `artifacts.product_id`, if ever read. | Section 4.2 |
| Future: storefront feed | Report targets for `product`/`storefront` were added "for when the storefront feed lands". | `App/src/lib/api.ts:118-120` [U], `App/worker/lib/moderation-contract.ts:49-56` |
| Future: discovery feed | `algorithm.md` plan. | Section 7.3 |

A non-CZK price cannot surface today, because App renders no price.

### 9.3 Where R7 messaging could go (existing surfaces)

| Surface | Fact | Evidence |
|---|---|---|
| No landing page | `/` redirects to `/studio`, which sends a guest to Store's login. | `App/src/App.tsx:22` [C], `App/src/components/StudioLayout.tsx:43-47` [C] |
| Anonymous surfaces | `/:username`, `/:username/c/:id`, `/guidelines`, `/privacy`, 404. Public routes sit outside `StudioLayout`, so there is no shared public header or footer. | `App/src/App.tsx:24-40` [C] |
| Default meta description | "Curate the things you love on a personal grid." | `App/index.html:7`, `:18`, `:26` [U]; `App/src/lib/seo.ts:17` [U] |
| Signed-in shell | `StudioLayout` (sidebar, mobile nav), Settings tabs. | `App/src/components/StudioLayout.tsx:97-135` [C], `App/src/components/SettingsPage.tsx:16-26` [C] |
| Config pattern | Non-secret config lives in `wrangler.jsonc` vars and reaches the SPA through `GET /api/config` (3 fields today). An allowed-country list could follow this pattern; none exists. | `App/wrangler.jsonc:21-27`, `App/worker/routes/config.ts:8-15` [C], `App/src/lib/config.ts:6-42` [C] |

### 9.4 Waitlist (R8) facts

- App has no waitlist form or route (Section 2.2).
- The shared DB has `waitlist_signups` with `email`, `list_id`, `owner_id`,
  `source`, `created_at` and **no country column** per App's types
  (`App/worker/lib/database.types.ts:837-863`).
- Home writes that table with `email` and `source` only
  (`Home/src/app/api/waitlist/route.ts:85-86`).

### 9.5 Related legal needs, as App stands

| Need | State in App | Evidence |
|---|---|---|
| "Report this product" on every storefront (DSA Art. 16) | App has no storefront or product page. Artifacts have a hover-revealed report pill; reporting requires an account; `reporterEmail` not collected by the UI; no profile or collection report control. | Section 6.2 |
| Seller visibly named | Public pages show only `@username`; no business name, address or seller label. | `App/src/components/PublicProfilePage.tsx:200-228` (`:209`) [C] |
| Trader / non-trader indication | None. | grep (no `trader` in App code) |
| Ranking disclosure (P2B) | Nothing ranks sellers yet; search is alphabetical. | Section 7.2 |
| Operator identity on App's legal pages | App's Privacy Policy and Guidelines name no operator; support address is `support@allgrid.app`. | `App/src/components/PrivacyPolicyPage.tsx:1-30` [C], `App/src/components/SettingsPage.tsx:735` [C] |

---

## 10. Could not determine

1. **Whether App is deployed anywhere.** Code says not bound to a hostname
   (`App/wrangler.jsonc` has no `routes`); memory from 2026-10-11 says
   deployed nowhere. Not checked against Cloudflare or production (forbidden).
2. **Whether the Worker secrets are set** (`SUPABASE_SERVICE_ROLE_KEY`,
   `R2_*`, `MODERATION_SECRET`). Without `MODERATION_SECRET`, handles, avatars
   and collection names cannot be saved (`App/wrangler.jsonc:56-63`).
3. **Whether `interaction_events` exists in production.** Store's migration
   header says not applied as of 2026-08-07
   (`Store/supabase/migrations/20260720_interaction_events.sql:1-10`); if still
   absent, `POST /api/events` would 500 (moot while consent is off).
4. **RLS on `products` and `storefronts` for a marketplace visitor.** No
   select policy for them was found in `Store/supabase/migrations` by grep;
   memory says production predates the migrations. Only App's comment
   (`App/worker/routes/reports.ts:81-85`) was read.
5. **Whether production's `reports` CHECKs accept App's widened reasons and
   target types** (`App/worker/lib/moderation-contract.ts:29-35`).
6. **Which `@squaresharedev/schemas` a deploy would use.** `package.json`
   pins `^0.1.0`; the lockfile is incomplete (`App/README.md:96-100`). With
   registry 0.1.x, `imageKey` is a loose string (works). With the local
   junction (0.5.0 source), `imageObjectKeySchema` requires an `images/`
   prefix (`SQ-system/packages/schemas/src/object-key.ts:29-30`, `:43-46`)
   while App mints `artifacts/...` (`App/worker/lib/r2.ts:35-38`) and the DB
   requires `artifacts/...`
   (`Store/supabase/migrations/20261105_object_keys_anywhere.sql:147`), so
   `POST /api/artifacts` would answer 400 against the junctioned package
   (inferred from the schemas; not run).
7. **Whether `public_profiles` exposes `display_name` in production.** App's
   types say it does (`App/worker/lib/database.types.ts:878-895`); `RISKS.md`
   says three columns. App selects only id/username/avatar either way.
8. **How the hover-only report pill behaves on touch devices** (not run).
9. **What Store's `checkTarget`/`checkHandle`/`checkAvatar` write** when App
   asks (not opened; described only by comments).

---

## 11. Incidental observations (not compliance rules, but met on the way)

- `POST /api/events` accepts unauthenticated requests and writes with the
  service role, up to 50 rows each, with no rate limit; requests without an
  `Origin` header pass the CSRF check (`App/worker/routes/events.ts:108-149`,
  `App/worker/lib/csrf.ts:9-17`) [U].
- `App/worker/lib/moderation-contract.ts:24` stores the report text regex
  class with raw control bytes (0x00, 0x1F, 0x7F) instead of `\u` escapes.
  There is no line terminator inside the literal, so it parses; tools flag the
  file as binary. The committed predecessor used textual escapes
  (HEAD `worker/routes/reports.ts`, `MULTILINE_TEXT_PATTERN`).
- `GET /api/me` and `PATCH /api/profiles/me` read `profiles` with
  `select("*")`, so seller and tax columns reach the Worker before the DTO
  drops them (`App/worker/routes/auth.ts:14-18`,
  `App/worker/routes/profiles.ts:320-324`).
