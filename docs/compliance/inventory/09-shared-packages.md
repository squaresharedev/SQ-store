# Inventory 09: shared packages and existing constants

Part 9 of 9 of the read-only inventory for the Czech-only beta (sellers in CZ,
prices in CZK, delivery to CZ, configuration-driven and EU-ready). Question
answered here: where can the single market-config module live, and what does
each repo do today with packages, copies and country, currency and locale
constants.

Investigation only, 2026-11-22. Nothing was changed, built, installed or run.
No network, Stripe, Supabase or MCP calls. Evidence is file:line on disk.

Path prefixes used below:

| Prefix | Path on disk | Repo |
|---|---|---|
| `SQ-system/` | `C:\Squareshare\System\SQ-system` | shared packages workspace |
| `SQ-store/` | `C:\Squareshare\Store` | seller dashboard, buyer pages, checkout, MCP |
| `SQ-admin/` | `C:\Squareshare\Admin` | staff panel |
| `SQ-app/` | `C:\Squareshare\App` | marketplace SPA + Hono worker |
| `SQ-home/` | `C:\Squareshare\Home` | marketing site |
| `SQ-docs/` | `C:\Squareshare\Docs` | documentation site |

Working-tree state at the time of reading: SQ-system has 9 uncommitted entries
(7 modified files, 2 untracked package folders, see 1.1). SQ-store was clean
apart from the orchestrator's untracked `COMPLIANCE_PROGRESS.md`. SQ-app has 28
uncommitted entries. All findings describe the working trees as they are.

---

## 0. Headline findings

1. **No mechanism exists today by which one TypeScript module is shared by
   Store, Admin, App, Home and Docs at build time.** Store and Admin consume no
   `@squaresharedev/*` package at all. App declares three packages from the
   registry but resolves them through local directory junctions into the
   SQ-system working tree. Home installs a committed, built copy of one package
   (`consent`). Docs installs two packages from SQ-system source by a relative
   `file:` path and checks SQ-system out beside itself in CI. Details in 1.3 to 1.5.
2. **The GitHub Packages route has been blocked since July 2026**: every
   machine and CI token found is fine-grained or lacks `read:packages`
   (SQ-app/README.md:134-149, SQ-docs/README.md:122-134,
   SQ-home/docs/CONSENT_INTEGRATION.md:27-28). The two newest packages
   (`moderation`, `pricing`) are not even committed in SQ-system, so they have
   never been published.
3. **"One list, several copies" is kept honest only inside a single repo.**
   Store has good in-repo drift tests (an SQL-parsing test for order channels,
   an SQL-parsing test for reserved usernames, a list-equality test for
   shipping vs operating countries, a DB test for plan limits). **No test
   anywhere compares a copy in one repo with a copy in another repo** (pricing,
   moderation vocabulary, Terms prose vs `OPERATING_COUNTRIES`, Home's vendored
   consent). Some in-repo tests hard-code the SQL list as literals rather than
   reading the SQL, and the notification-type test is stale (6 of 9 types).
4. **Today's market constants all live in SQ-store** (`OPERATING_COUNTRIES`,
   `EU_COUNTRIES`, `SHIPPING_COUNTRY_CODES`, `SMS_REGIONS`, `CURRENCIES`,
   `BILLING_CURRENCY`, `DOLLAR_COUNTRIES`, `LOCALES`). The EU member list is
   typed out literally **four times** in Store alone. Admin, App, Home and Docs
   hold no country or currency list, only EUR assumptions (Admin `formatEuros`,
   Home's `€` and its refusal of a non-EUR price list).
5. **The two-currency world (EUR, USD) is hard-coded in more than lists**:
   `toCurrency()` folds every non-USD value to EUR (SQ-store/src/lib/format/money.ts:12-14)
   and is used by checkout quoting; SQL aggregates treat `currency <> 'USD'` as
   EUR in at least 8 function definitions; `products.currency` has a CHECK
   `in ('EUR','USD')` in production (replayed at SQ-store/tests/db/prod-migrations.sql:157).
   A CZK product cannot be stored today, and if it could, several read paths
   would show it as euros. This must change wherever the config lives.
6. **No SQL constraint anywhere lists countries.** Country columns have shape
   checks only (`^[A-Z]{2}$`). Currency has list CHECKs on three tables and
   shape checks on three more.
7. **Precedents exist for every option**: a public JSON endpoint read by
   another repo with a fallback (plan prices, Store to Home), a single-row DB
   config table read by both the app and a trigger (`billing_switches`), an SQL
   function mirrored from TS with a DB test (`plan_limit`, `team_role_can`,
   `username_is_reserved`), a copy script (Home's `sync-consent.mjs`), and a
   multi-repo CI checkout (Docs).
8. **Narrowing an existing enum is not free.** Store reuses its write-side Zod
   enums on read paths: a stored shipping policy that names a country or
   currency outside the list parses to an EMPTY policy
   (SQ-store/src/lib/settings/shipping-policy.ts:54-58). Pointing
   `SHIPPING_COUNTRY_CODES` or `CURRENCIES` at `["CZ"]` / `["CZK"]` would
   silently blank the shipping terms of every existing non-CZ seller. The
   market config must be separate from the "what can be stored and read" enums.

---

## 1. The SQ-system packages

### 1.1 Workspace facts

| Fact | Evidence |
|---|---|
| pnpm workspace over `packages/*`, root `sq-system` private, pnpm 11.9.0 | SQ-system/pnpm-workspace.yaml:1-2, SQ-system/package.json:2-7 |
| Root description still names four packages (tokens, grid, schemas, db) | SQ-system/package.json:5 |
| Scope `@squaresharedev` routed to GitHub Packages; no credential in repo | SQ-system/.npmrc:1-4 |
| Publish: on a pushed `v*` tag, build, `pnpm test`, `pnpm -r publish` to GitHub Packages with the workflow's `GITHUB_TOKEN` (`packages: write`) | SQ-system/.github/workflows/publish.yml:8-11, 13-15, 40-48 |
| The workflow comment says versions bump together "across all four packages"; README says "all five" | SQ-system/.github/workflows/publish.yml:4-5, SQ-system/README.md:199 |
| Tests run only in the publish workflow (no workflow on push or PR) | SQ-system/.github/workflows/ contains only publish.yml |
| Tags: `v0.1.0` (74b2cd4, 2026-07-11), `v0.2.0` (eb71114, 2026-07-28), `v0.3.0` (04d5c49, 2026-08-07); `main` == `origin/main` (ccb4ecd) | `git tag`, `git rev-list` (read-only) |
| `dist/` is gitignored, so a git checkout carries no built output | SQ-system/.gitignore:2 |
| Consumers named in the README: SQ-store and SQ-app only | SQ-system/README.md:4-6 |
| Registry read needs a classic PAT with `read:packages` even for reads | SQ-system/README.md:23-33 |
| Tests live outside `src/` so they never ship | SQ-system/vitest.config.mts:3-9 |

Uncommitted working tree (9 entries): `README.md` (+4/-1, adds moderation
and pricing rows), `docs/moderation.md` (+16 lines on product badges),
`packages/schemas/package.json` (version 0.3.0 to 0.5.0),
`packages/schemas/src/agent-meta.ts` (+13), `storefront-validation.ts`
(+62/-15), `storefront.ts` (+167/-18: image placement, card styles, shape
bounds),
`pnpm-lock.yaml` (importers for moderation and pricing), and untracked
`packages/moderation/` and `packages/pricing/`.

### 1.2 Per package

"Built" compares the newest file in `src/` with the newest in `dist/` on disk.
"Published" is what can be inferred from tags and notes; the registry itself
was not queried (see section 6).

| Package | Name, version | What it holds | Built on disk | Published | Tests |
|---|---|---|---|---|---|
| tokens | `@squaresharedev/tokens` 0.3.0 (SQ-system/packages/tokens/package.json:2-3) | Tailwind v4 `@theme` CSS tokens + control-style class constants (SQ-system/README.md:10) | yes (dist 2026-08-07 newer than src 2026-07-11) | tags v0.1.0 to v0.3.0 include it; publish success not verifiable | none |
| grid | `@squaresharedev/grid` 0.3.0 (packages/grid/package.json:2-3) | bento grid, flow and positioned modes (README.md:11) | yes | as tokens | none |
| schemas | `@squaresharedev/schemas` **0.5.0 in the working tree, 0.3.0 committed** (packages/schemas/package.json:3, `git diff`) | StorefrontConfig + validation mirror, Artifact/Collection, object-key contract, agent introspection (README.md:12) | **stale**: dist 2026-08-07, src 2026-08-18 plus uncommitted edits | 0.3.0 at most; 0.4.0 and 0.5.0 never tagged | 3 files, about 24 cases (packages/schemas/test/*.test.ts) |
| db | `@squaresharedev/db` 0.3.0 | Supabase client factories + `AUTH_COOKIE_OPTIONS` (README.md:13) | yes | as tokens | packages/db/test/cookie-options.test.ts (6 cases) |
| consent | `@squaresharedev/consent` 0.3.0 | consent engine, `sq_consent` cookie, React banner (README.md:14) | yes | introduced after v0.1.0 (commit 4823cee "cookie content"), in v0.2.0 and v0.3.0 | packages/consent/test/cookie.test.ts (3 cases) |
| moderation | `@squaresharedev/moderation` 0.1.0 (packages/moderation/package.json:2-3) | report vocabulary, removal grounds, fix fields, auto-check states, ranking penalty (README.md:15 in the uncommitted diff) | **stale and partial**: dist 2026-09-18 lacks `auto.js` and `decisions.js`, src 2026-10-10 | **never**: folder is untracked in git, so no tag contains it | packages/moderation/test/moderation.test.ts (28 cases) |
| pricing | `@squaresharedev/pricing` 0.1.0 (packages/pricing/package.json:2-3) | plan/origin/fee/feature vocabulary, `computeFees`, plan price rows; currency only as a 3-letter shape (packages/pricing/src/plan-price.ts:33) | yes (dist 2026-10-10 21:03 after src 21:01) | **never**: untracked; SQ-store/docs/pricing-build-status.md:55-57 says "Not done: package published" | packages/pricing/test/pricing.test.ts (17 cases) |

Lockstep versioning is already broken: 0.3.0 (four packages), 0.5.0
(schemas), 0.1.0 (moderation, pricing).

No package holds a country list, an EU list, a currency enum or a locale
list. `@squaresharedev/schemas` carries no country or currency enum at all
(grep of packages/schemas/src for currency/country/locale returns only price
tag display enums).

### 1.3 Who consumes what, and how

| Repo | Package manager | `@squaresharedev/*` in package.json | Lockfile | node_modules | Real mechanism |
|---|---|---|---|---|---|
| SQ-store | pnpm (CI pins pnpm 10) | **none** (SQ-store/package.json:35-84) | none | none | **Not consumed.** Only the scope mapping is staged (SQ-store/.npmrc:7) plus a guarded registry-auth step in CI (SQ-store/.github/workflows/deploy.yml:8-10, 57, 75-77). Store keeps hand-made copies instead: pricing (src/lib/pricing/*), moderation (src/lib/moderation/removal.ts:18-23, src/lib/validation/reports.ts:25), storefront contract (memory note; Store's own types/storefront.ts) |
| SQ-admin | npm (`package-lock.json`, `npm ci` in CI) | **none** (SQ-admin/package.json:14-36) | none | none | **Not consumed.** Own copies of the moderation vocabulary (SQ-admin/src/lib/moderation/content.ts:20, 155, 234, 337) |
| SQ-app | pnpm | `db`, `grid`, `schemas` at `^0.1.0` (SQ-app/package.json:19-21) | **absent** from SQ-app/pnpm-lock.yaml | `consent`, `db`, `grid`, `schemas`, `tokens` are **symlinks into C:/Squareshare/System/SQ-system/packages/** | Registry dependency on paper, **junctions to the SQ-system working tree** in practice (SQ-app/README.md:134-149). CI install runs `--no-frozen-lockfile` with a token that lacks Packages read (SQ-app/README.md:87-100; SQ-app/pnpm-workspace.yaml:6-11 disables pre-run dependency verification for this reason). Moderation is a hand copy: SQ-app/worker/lib/moderation-contract.ts:1-16 (untracked), SQ-app/worker/lib/ranking.ts:1-5 |
| SQ-home | npm (`package-lock.json`, `legacy-peer-deps`) | `consent` as `file:vendor/squaresharedev-consent` (SQ-home/package.json:19) | SQ-home/package-lock.json:12, 6034-6035, 15362-15371 | symlink to `vendor/squaresharedev-consent` | **Vendored built copy**, refreshed by hand with SQ-home/scripts/sync-consent.mjs:1-41 (copies `dist/` + `styles.css`, strips scripts). Reason given: Workers Builds has no working token (sync-consent.mjs:3-5). Today the copy is byte-identical to SQ-system's dist (`diff -r`), but nothing checks it |
| SQ-docs | pnpm 11.9.0 | `consent` and `tokens` as `file:../System/SQ-system/packages/...` (SQ-docs/package.json:21-22) | SQ-docs/pnpm-lock.yaml:11-14, 1355-1366, 5206-5211 | pnpm store copies | **Source path outside the repo.** CI checks SQ-system out at `System/SQ-system`, builds tokens and consent, then installs (SQ-docs/.github/workflows/pages.yml:28-55, lighthouse.yml:36-61). README explains the registry 403 (SQ-docs/README.md:19-21, 122-134) |

### 1.4 Notes per consumer

- **Store's README-level intent and reality differ.** SQ-store/docs/agent-surface.md:205-210
  records that the storefront contract was never mirrored into
  `@squaresharedev/schemas` because the package "was already well behind
  Store". The memory note agent-surface-and-schemas-package.md (2026-08-15 drift
  check) agrees: Store does not depend on the schemas package.
- **App is the only code consumer** (imports at SQ-app/src/components/ArtifactCard.tsx:3,
  SQ-app/worker/env.ts:2, SQ-app/worker/routes/artifacts.ts:7,
  SQ-app/worker/routes/collections.ts:2), and it builds against whatever the
  SQ-system working tree holds, including uncommitted schemas 0.5.0 sources
  and a stale `dist/`.
- **Home** pins the consent artifact at version 0.3.0 with its peer on
  tokens `^0.3.0` (SQ-home/vendor/squaresharedev-consent/package.json).
- **Docs** is the only repo whose CI genuinely builds a shared package from
  SQ-system source. Its production deploy is by hand from a laptop
  (SQ-docs/README.md:152-160, SQ-docs/worker/wrangler.toml:5-7), so production
  uses whatever the laptop's sibling checkout holds.

### 1.5 Plain answer

**No.** There is no mechanism today by which one TypeScript module is truly
shared by Store, Admin, App, Home and Docs at build time. Store and Admin take
nothing from SQ-system. App, Home and Docs each take SQ-system code by a
different, local-path-dependent route (junction, vendored artifact, relative
`file:` path plus sibling checkout). The registry path that would unify them
has never worked from a consumer.

---

## 2. "One list, several copies": how each is kept honest

Legend for "Drift detection": **parse** = a test reads the other copy's
source and compares; **probe** = a DB test exercises the constraint;
**literal** = a test compares against values typed into the test itself;
**none** = comments only.

| Case | Copies (file:line) | Drift detection (file:line) | Gaps |
|---|---|---|---|
| Pricing contract (TS) | SQ-system/packages/pricing/src/{enums,fees,index,plan-price}.ts; SQ-store/src/lib/pricing/{enums,fees,index,plan-price}.ts (header SQ-store/src/lib/pricing/enums.ts:5-7, index.ts:5) | **none across repos.** The copies are in sync today except comments (normalized `diff` of all four files: only header comments differ) | Kept in step by the header note alone ("Edit both together", SQ-system/packages/pricing/src/enums.ts:5-7) |
| Pricing enums vs Postgres enums | SQ-store/src/lib/pricing/enums.ts (`PLAN_IDS`, `FEE_ENTRY_KINDS`, `FEATURE_KEYS`) vs enums in SQ-store/supabase/migrations/20261011_pricing_config.sql | **probe**: SQ-store/tests/integration/36-pricing-config.test.ts:129-134 ("has each Postgres enum match its TypeScript list, in order"); seed vs fixture at :146-178 | In Store only |
| Moderation fix fields | SQ-store/src/lib/moderation/fix-fields.ts:22-48; SQ-admin/src/lib/moderation/content.ts:337-354; SQ-system/packages/moderation/src/decisions.ts:15-33; SQL CHECKs SQ-store/supabase/migrations/20260926_moderation_decisions_and_appeals.sql:107-122 | **literal** only, for Store's copy: SQ-store/tests/unit/content-moderation.test.ts:238-251 types the SQL list into the test. SQ-system's test only checks `other` is present (packages/moderation/test/moderation.test.ts:266-267) | Admin has no tests at all (no test script in SQ-admin/package.json:5-13). Nothing compares Admin or SQ-system with Store or SQL. Note the SQL list is in a different ORDER from the TS lists (sorted comparison in the test) |
| Report reasons, removal grounds, moderation statuses | Store: src/lib/validation/report-constants.ts:20, src/lib/moderation/removal.ts:110; Admin: src/lib/moderation/content.ts:20, 155, 234; SQ-system: packages/moderation/src/reports.ts:43, removal.ts:40, 75; App: worker/lib/moderation-contract.ts:36 (untracked); SQL: SQ-admin/supabase/migrations/0007_content_reports.sql:41-58 (`reports_reason_check`), Store migrations 20261012_auto_moderation.sql:63-81 (status CHECKs) | **none across repos.** SQ-system/docs/moderation.md:297-301: "mirrored by hand in each app ... today the mirrors are the mechanism" | Four TS copies plus SQL, no comparison |
| Notification types | SQ-store/src/lib/notifications/types.ts:10-33 (9 types); CHECK `notifications_type_check` latest at SQ-store/supabase/migrations/20261025_reviews.sql:444-447; Admin writes `policy`/plan notices (SQ-admin/src/lib/moderation/notify-seller.ts:58, SQ-admin/src/lib/plans/notify-seller.ts:14) | **probe, stale**: SQ-store/tests/integration/11-rls-profiles-notifications.test.ts:518-540 inserts a hard-coded 6-type list (`team, payment, stock, order, system, security`), not `NOTIFICATION_TYPES`. The other three are probed one each in separate files (21-content-moderation.test.ts:498 `policy`, 29-seller-plans.test.ts:614 `billing`, 42-reviews.test.ts:421 `review`) | A new type added to TS and CHECK but forgotten in a probe passes; no test imports the TS list |
| Order channels | SQ-store/src/types/order-view.ts:20 (`ORDER_CHANNELS`); SQ-store/src/lib/analytics/signals.ts:40 (`SIGNAL_CHANNELS = ORDER_CHANNELS`); SQL `orders_channel_check`, `storefront_signals_channel_check` | **parse**: SQ-store/tests/unit/order-channel.test.ts:83-101 reads the replayed prod schema (`tests/db/prod-migrations.sql`), takes the LAST definition of each CHECK and compares it to `ORDER_CHANNELS` | The best existing pattern. Store only |
| Role to permission map | SQ-store/src/lib/team/permissions.ts:22, 48 (`TEAM_ACTIONS`, `TEAM_PERMISSIONS`); SQL `public.team_role_can()` re-created in 20260927_order_fulfilment.sql:126, 20260930_seller_plans.sql:488, 20261008_order_lifecycle.sql:362 | **literal** matrix for TS (SQ-store/tests/unit/permissions.test.ts:13-40); **probe** per action for SQL, only three actions (28-order-fulfilment.test.ts:107-109, 29-seller-plans.test.ts:601-603, 33-order-lifecycle.test.ts:147-149) | No full TS vs SQL comparison |
| Shipping codes vs operating countries | SQ-store/src/lib/settings/constants.ts:110-116 (`OPERATING_COUNTRIES` built from `EU_COUNTRIES`) vs :129-136 (`SHIPPING_COUNTRY_CODES`, typed out as literals for `z.enum`) | **literal + equality**: SQ-store/tests/unit/operating-countries.test.ts:16-23 (27 EU members + US + CA; shipping list equals operating list) and behaviour at :25-40 | Good in-repo. The test hard-codes "27 EU + US + CA", so it is also the test that must change for CZ-only |
| Operating countries vs the Terms | SQ-store/src/lib/settings/constants.ts:104-109 says the Terms "say the same"; SQ-home/src/content/legal/terms/tos-2026-11-06.ts:28, 76, 109; tos-2026-10-31.ts:24, 92 (the 27 member states written out); SQ-home/src/app/terms/page.tsx:13; SQ-home/src/content/legal/privacy.ts:11 | **none** | Cross-repo prose; changing the market needs a new Terms version (process in SQ-store/CLAUDE.md "Changing the Terms of Service") |
| Plan limits | SQ-store/src/lib/billing/plans.ts (`PLANS[..].limits`) vs SQL `public.plan_limit()` SQ-store/supabase/migrations/20260930_seller_plans.sql:217-235 | **probe, exhaustive**: SQ-store/tests/integration/29-seller-plans.test.ts:89-100 loops over every plan and key | Good pattern for "SQL function mirrors a TS constant" |
| Reserved usernames | SQ-store/src/lib/validation/auth.ts (`RESERVED_USERNAMES`) vs `public.username_is_reserved` (IMMUTABLE SQL with a literal array) SQ-store/supabase/migrations/20261021_reserved_usernames.sql:26-29 | **parse**: SQ-store/tests/unit/reserved-usernames-sql.test.ts:11-34 | Good pattern; reads one fixed migration file, so a later redefinition in another file would escape it |
| Pricing seed vs fixture | SQ-store/src/lib/billing/pricing-seed.ts:10, 64 vs 20261011_pricing_config.sql:283-312 | **probe**: 36-pricing-config.test.ts:146-178 | Store only |
| Home's consent copy | SQ-home/vendor/squaresharedev-consent vs SQ-system/packages/consent/dist | **none** (identical today by `diff`) | Copy script is manual (SQ-home/scripts/sync-consent.mjs:9-13) |
| Storefront contract | SQ-store src/types/storefront.ts and lib/validation/storefront.ts vs SQ-system/packages/schemas/src/storefront*.ts | **none**; known drifted (SQ-store/docs/agent-surface.md:205-210) | Shows what happens to an unchecked cross-repo copy |
| Home's plan prices | SQ-home/src/content/pricing.ts:6-10, 39-57 (fallback numbers) vs `plan_prices` rows read via SQ-store/src/app/api/billing/plan-prices/route.ts:36-64 | runtime only: Home prefers the live list and falls back (SQ-home/src/lib/plan-prices.ts:58-74) | The fallback is a second copy nobody checks |

Patterns that already exist, strongest first:
1. **parse the other copy's SQL** and compare (order-channel.test.ts:83-101, reserved-usernames-sql.test.ts:18-34);
2. **exhaustive DB probe** against the TS constant (29-seller-plans.test.ts:89-100, 36-pricing-config.test.ts:129-134);
3. **literal list in the test** (content-moderation.test.ts:238-251, permissions.test.ts:16-40, operating-countries.test.ts:16-23);
4. **spot probes** per value (notification types, `team_role_can`);
5. **comments only** (every cross-repo case).

All of 1 to 4 run in Store's deploy pipeline (`pnpm test:unit` and `pnpm test:db`,
SQ-store/.github/workflows/deploy.yml:97-108), so they gate Store's deploy and
no other repo's.

---

## 3. Every existing country, region, currency and locale constant

### 3.1 Countries and regions

| Constant | file:line | Values (summary) | Consumers (file:line) |
|---|---|---|---|
| `EU_COUNTRIES` (code + English name) | SQ-store/src/lib/settings/constants.ts:72-100 | 27 EU members, CZ named "Czechia" (:78) | `EU_COUNTRY_CODES` (:102); `OPERATING_COUNTRIES` (:111); `countryName` SQ-store/src/lib/format/country.ts:34 |
| `EU_COUNTRY_CODES` | SQ-store/src/lib/settings/constants.ts:102 | codes of the above | `isEuSeller`, `mayOweEuRights`, `orderOwesEuRights` SQ-store/src/lib/storefront/product-page.ts:1, 168-196; test operating-countries.test.ts:17-18 |
| `OPERATING_COUNTRIES` | SQ-store/src/lib/settings/constants.ts:110-114 | EU 27 + US + CA | `operatingCountries()` SQ-store/src/lib/format/country.ts:68-79 (seller country picker in SQ-store/src/components/settings/TaxSection.tsx:172, 367); type `OperatingCountryCode` country.ts:4 |
| `OPERATING_COUNTRY_CODES` | SQ-store/src/lib/settings/constants.ts:116 | codes of the above | seller `tax_country` validation SQ-store/src/lib/validation/settings.ts:131-133; shipping policy `shipsFrom` SQ-store/src/lib/validation/shipping-policy.ts:71-75 |
| `SHIPPING_COUNTRY_CODES` | SQ-store/src/lib/settings/constants.ts:129-136 | same 29 codes as literals | checkout ship-to `z.enum` SQ-store/src/lib/validation/checkout.ts:15, 41; shipping destinations `z.enum` SQ-store/src/lib/validation/shipping-policy.ts:44-46, 56; cart country SQ-store/src/lib/cart/route.ts:9, 48; checkout country list for "ships anywhere" SQ-store/src/components/checkout/CheckoutView.tsx:8, 140; seller's destination picker SQ-store/src/components/settings/CountryPicker.tsx:6, 36 |
| `SHIP_ANYWHERE` | SQ-store/src/types/shipping-policy.ts:111 | `"*"` catch-all destination | shipping-policy.ts:44-47 and the rate matcher |
| `SMS_REGIONS` | SQ-store/src/lib/contact-verification/policy.ts:48-55 | EU 27 + IS, LI, NO, CH, GB; **excludes US and CA**, includes 5 non-operating countries | seller phone validation SQ-store/src/lib/validation/phone.ts:26, 66; SMS send path comments SQ-store/src/lib/sms/send.ts:19, contact-verification/service.ts:18 |
| `isEuSeller()` | SQ-store/src/lib/storefront/product-page.ts:168-170 | seller country in EU list | SQ-store/src/components/checkout/CheckoutView.tsx:121; SQ-store/src/components/product-page/ProductPageView.tsx:165, 238; tests product-page-config.test.ts:398-401 |
| `VAT_PREFIX_TO_ISO`, `ISO_TO_VAT_PREFIX` | SQ-store/src/components/settings/TaxSection.tsx:63-74 | 27 EU VAT prefixes, EL to GR | advisory only, same file |
| `DOLLAR_COUNTRIES` | SQ-store/src/lib/predictions.ts:250 | US, CA | `homeCurrency()` :254-257 (default currency of a new store) |
| `REGION_COUNTRIES`, `POSTCODE_OPTIONAL` | SQ-store/src/components/checkout/CheckoutForm.tsx:50, 52 | US, CA, AU / IE | address form layout, not market rules |
| `CITY_THEN_POSTCODE`, `CITY_REGION_POSTCODE` | SQ-store/src/lib/orders/ship-to.ts:78-79 | GB, IE / US, CA, AU | address display, not market rules |
| Dev lab `COUNTRIES` | SQ-store/src/app/dev/predictions/PredictionsLab.tsx:65 | 12 codes incl. CZ | dev harness only (excluded from builds) |
| Seller country into Stripe account | SQ-store/src/lib/payments/connect/account.ts:148, 158; actions.ts:65 | passes the seller's stored country | (for inventory 01) |
| Operator address | SQ-home/src/lib/site.ts:38-43 (`OPERATOR`) | Efficontrol s.r.o., Brno, Czech Republic | footer, privacy, cookie notices |
| SQL: country columns | `profiles.tax_country` `^[A-Z]{2}$` (SQ-store/tests/db/prod-migrations.sql:261-262); sign-in approvals `country ~ '^[A-Z]{2}$'` (SQ-store/supabase/migrations/20260927_sign_in_approvals.sql:76); `orders.ship_to` jsonb with `country` described, shape/size checks only (prod-migrations.sql:5085-5114; 20260927_order_fulfilment.sql:113) | **no list CHECK on any country column** | |

Admin, App, Docs and SQ-system define **no** country or region constant.
Admin displays `tax_country` raw (SQ-admin/src/lib/data/moderation.ts:961, 1034;
SQ-admin/src/components/moderation/SellerCard.tsx:116-117). App's hand-curated
DB types include `tax_country` and `currency` columns only
(SQ-app/worker/lib/database.types.ts:410-608).

Duplication of the EU member list inside Store: constants.ts:72-100 (objects),
constants.ts:132-134 (literals), policy.ts:50-52 (literals), TaxSection.tsx:64-68
(VAT prefixes). Plus prose in SQ-home tos-2026-10-31.ts:92.

### 3.2 Currencies (TypeScript)

| Constant or default | file:line | Value | Consumers / effect |
|---|---|---|---|
| `CURRENCIES` | SQ-store/src/types/product.ts:12-13 | `["EUR","USD"]` ("EUR is primary, USD secondary") | product write `z.enum` SQ-store/src/lib/validation/product.ts:20, 478; discounts `z.enum` SQ-store/src/lib/validation/discounts.ts:11, 41; shipping `ratesCurrency` `z.enum` SQ-store/src/lib/validation/shipping-policy.ts:79; CSV import guard SQ-store/src/lib/products/csv.ts:429-431; import action SQ-store/src/lib/products/import-actions.ts:151; MCP tools `z.enum` SQ-store/src/lib/agent/tools/products.ts:177, 205, 348; price picker SQ-store/src/components/products/PriceField.tsx:118; import UI SQ-store/src/components/products/ProductImport.tsx:361; shipping UI SQ-store/src/components/settings/ShippingSection.tsx:147; discount form SQ-store/src/components/discounts/DiscountForm.tsx:159; discount row reader SQ-store/src/lib/discounts/row.ts:42 |
| `toCurrency()` | SQ-store/src/lib/format/money.ts:10-14 | **anything not "USD" becomes "EUR"** | checkout quote SQ-store/src/lib/checkout/quote.ts:178, 254; availability SQ-store/src/lib/checkout/availability.ts:96; discount check SQ-store/src/lib/checkout/discount-check.ts:79; cart SQ-store/src/lib/cart/view.ts:107-128, suggestions.ts:54; product page SQ-store/src/components/product-page/ProductPageView.tsx:176; MCP previews SQ-store/src/lib/agent/preview/*.ts; formatters money.ts:30, 35; charts SQ-store/src/components/analytics/chart-format.ts:22 |
| Product row read fold | SQ-store/src/lib/products/queries.ts:143 | `row.currency === "USD" ? "USD" : "EUR"` | every dashboard product read |
| Quote default | SQ-store/src/lib/checkout/quote.ts:330 | `sellable[0]?.currency ?? "EUR"` | checkout |
| Stripe Checkout currency | SQ-store/src/lib/checkout/stripe-provider.ts:106, 138, 148 | `quote.currency.toLowerCase()` | Connect direct charge |
| Webhook currency check | SQ-store/src/lib/payments/connect/webhook.ts:75-81 | session currency must equal the order's | |
| `BILLING_CURRENCY` | SQ-store/src/lib/billing/plans.ts:38-39 | `"EUR"` ("EU platform, EU sellers") | plan cards and billing UI (PlanCard.tsx:69, PlanComparison.tsx:146-149, CostExplorer.tsx:63-90, UpgradeCard.tsx:72-85, PlanFeatureList.tsx:43, AiWritingCard.tsx:59, 108, BillingSection.tsx:108); public price list SQ-store/src/app/api/billing/plan-prices/route.ts:47 |
| `FALLBACK_CURRENCY` | SQ-store/src/lib/payments/connect/overview.ts:56-57 | `"EUR"` | payments chart with no sales |
| `homeCurrency()` | SQ-store/src/lib/predictions.ts:252-257 | USD for US/CA, else EUR | new product default (SQ-store/src/app/(dashboard)/products/new/page.tsx:83) |
| Shipping rate default | SQ-store/src/lib/shipping/rates.ts:118, 149, 276; SQ-store/src/lib/shipping/policy-prose.ts:122; SQ-store/src/components/settings/ShippingSection.tsx:203 | absent `ratesCurrency` = EUR | delivery quotes |
| Product form / import / discount defaults | SQ-store/src/components/products/ProductForm.tsx:261; ProductImport.tsx:85; DiscountForm.tsx:115, 132; SaleBadgeControls.tsx:159; cart CartPanel.tsx:92, 148; CartSuggestions.tsx:36 | `"EUR"` | |
| Search, analytics, dashboard | SQ-store/src/app/api/search/route.ts:82, 254; SQ-store/src/lib/analytics/queries.ts:212, 292; SQ-store/src/lib/analytics/types.ts:89 ("EUR for now"); SQ-store/src/lib/dashboard/format.ts:21 (EUR sorted first) | EUR | |
| Chart symbol | SQ-store/src/components/analytics/chart-format.ts:41 | `$` for USD else `€` | |
| `ENGLISH_PRICE_LOCALE` | SQ-store/src/lib/format.ts:10 | `"en-IE"` ("EUR-primary market") | `formatPrice`, `formatPriceShort` :13-27, money.ts:28, 42, 71 |
| Pricing package | SQ-system/packages/pricing/src/plan-price.ts:33 | currency as `^[A-Z]{3}$` shape | (Store copy identical) |
| Admin | SQ-admin/src/lib/format/money.ts:1-7 (`formatEuros`, en-US, EUR); SQ-admin/src/lib/data/moderation.ts:739 (`?? "EUR"`) | EUR only | plans revenue page, PlanPanel, StatCard (SQ-admin/src/app/(app)/plans/revenue/page.tsx:214-218, SQ-admin/src/components/plans/PlanPanel.tsx:70, SQ-admin/src/components/ui/StatCard.tsx:11) |
| Home | SQ-home/src/lib/plan-prices.ts:39-40 (refuses a list whose currency is not EUR); SQ-home/src/components/PricingSection.tsx:18-19, 56 (`€`, "excl. VAT"); SQ-home/src/content/pricing.ts:17-23 ("Money is euros") | EUR only | homepage pricing |
| Docs | SQ-docs/scripts/lint-rules.ts:82-87 | bans any currency amount (EUR, USD, CZK, Kč) in docs content | content lint in build (SQ-docs/package.json:8) |
| App, SQ-system | none | | |

Note the two different currency questions the build must keep apart: the
**buyer-facing product currency** (what `ALLOWED_CURRENCIES = ["CZK"]` is
about: `CURRENCIES`, `toCurrency`, product and discount CHECKs) and the
**seller subscription currency** (`BILLING_CURRENCY = "EUR"`, `plan_prices`
seeded in EUR, Home's pricing section). The brief does not say whether plan
billing moves to CZK.

### 3.3 Currency in SQL

| Where | file:line | Rule |
|---|---|---|
| `products.currency` | replayed prod schema SQ-store/tests/db/prod-migrations.sql:157 (pre-repo migration `20260706081631 create_products`, not in SQ-store/supabase/migrations) | `not null default 'EUR' check (currency in ('EUR','USD'))` |
| `discounts` amount value | SQ-store/supabase/migrations/20261004_discounts.sql:85-92 | `currency in ('EUR','USD')` |
| `product_price_history.currency` | SQ-store/supabase/migrations/20261004_discounts.sql:253 | `check (currency in ('EUR','USD'))` |
| `orders.currency` | SQ-store/tests/db/prod-migrations.sql:301 | `not null default 'EUR'`, **no CHECK** |
| `order_place` insert | latest SQ-store/supabase/migrations/20261120_shopping_cart.sql:220 (also 20261008:169, 20261011:465, 20261022:48, 20261028:231) | `coalesce(incoming.currency, 'EUR')` |
| `plan_prices` | SQ-store/supabase/migrations/20261011_pricing_config.sql:129, 142, 264, 288-290 | default `'EUR'`, shape CHECK, `plan_price_change()` hard-codes `'EUR'`, seed rows EUR |
| `fee_ledger` | 20261011_pricing_config.sql:551 | shape CHECK `^[A-Z]{3}$` |
| `storefront_signals.currency`, seller funnel | 20260830_storefront_signals.sql:83; 20260930_seller_plans.sql:110 | length 3 / shape |
| Analytics and dashboard aggregates | 20260802_analytics_sql_aggregates.sql:24-25, 71, 179; 20260808_recent_orders_id.sql:26; 20261007_analytics_weekday_products.sql:26, 58; 20261028_product_add_ons.sql:595, 606, 807; 20261117_perf_indexes.sql:300, 327, 334, 370, 381; 20261120_shopping_cart.sql:744, 808, 852, 863 | `currency <> 'USD'` treated as EUR ("mirror toCurrency() exactly") |
| Billing 30-day sales | 20260930_seller_plans.sql:476; 20261004_discounts.sql:361; 20261011_pricing_config.sql:690 | `o.currency = 'EUR'` only |

### 3.4 Zero-decimal and minor-unit handling

There is none. Money is integer cents everywhere and divided by 100 only in
the formatter (SQ-store/src/lib/format/money.ts:1-3, 33, 35). No list of
zero-decimal currencies, no exponent table. Stripe receives the integer
amount and the lower-cased code (SQ-store/src/lib/checkout/stripe-provider.ts:106-148).
CZK has two minor units in ISO 4217, so the cents arithmetic itself would
hold; Stripe-specific rules for CZK (minimum charge, payout rounding) were not
checked (section 6).

### 3.5 Locales

| Constant | file:line | Values | Consumers |
|---|---|---|---|
| `LOCALES`, `DEFAULT_LOCALE`, `LOCALE_NAMES` | SQ-store/src/i18n/locales.ts:19-51 | en, cs, de, fr, es, it, nl, pl, pt-PT, sk; default en | all Store i18n; `messages/<code>/` |
| `DELETE_CONFIRM_PHRASES` | SQ-store/src/lib/settings/constants.ts:24-35 | one per Store locale | account deletion |
| `ENGLISH_PRICE_LOCALE` | SQ-store/src/lib/format.ts:10 | en-IE | price formatting in English |
| Docs `LOCALES`, `DEFAULT_LOCALE` | SQ-docs/lib/i18n.ts:3-5 | en, cs; default en | routes, sitemap, llms.txt, SEO, switcher (SQ-docs/app/sitemap.ts:2, SQ-docs/lib/seo.ts:3, SQ-docs/components/LanguageSwitcher.tsx:6, and others) |
| Docs Czech date format | SQ-docs/lib/copy.ts:89 | `cs-CZ` | page dates |
| Home | SQ-home/src/app/layout.tsx:174 | `lang="en"` only | |
| Admin | SQ-admin/src/app/layout.tsx:27-28 | `lang="en"` only | |
| App, SQ-system | none | | |

### 3.6 Phone countries

No list of its own. Seller phone numbers go through libphonenumber
(`libphonenumber-js/max`) and must be in `SMS_REGIONS`
(SQ-store/src/lib/validation/phone.ts:21-27, 49-74). The seller's country is
the default region (:47-57).

### 3.7 Zod schemas in packages/schemas

None carries a country or currency enum (section 1.2). Store's own Zod enums
that carry them: checkout.ts:41, settings.ts:131-133, shipping-policy.ts:56,
71-79, product.ts:478, discounts.ts:41, agent/tools/products.ts:177, 205, 348.

### 3.8 Bare "CZ" / "CZK" literals today

`"CZK"` / `'CZK'`: **no occurrence in any repo's code**. The only `CZK`
tokens are inside a regex in SQ-docs/scripts/lint-rules.ts:86 and the
orchestrator's SQ-store/COMPLIANCE_PROGRESS.md:26.

`"CZ"` / `'CZ'`:

| file:line | Kind |
|---|---|
| SQ-store/src/lib/settings/constants.ts:78, 132 | the EU list and the shipping list |
| SQ-store/src/lib/contact-verification/policy.ts:50 | `SMS_REGIONS` |
| SQ-store/src/components/settings/TaxSection.tsx:64 | VAT prefix map |
| SQ-store/src/app/dev/invoices/fixtures.ts:55; SQ-store/src/app/dev/predictions/PredictionsLab.tsx:65 | dev fixtures |
| SQ-store/scripts/lib/fake-data.ts:875; SQ-store/supabase/migrations/20260927_demo_sales_sim_fulfilment.sql:63 | demo data |
| SQ-store/tests/component/seller-block.test.tsx:21, 35; tests/e2e/81-phone-action-pages.spec.ts:97-99; tests/e2e/90-device-sweep.spec.ts:184-186; tests/unit/eu-rights-follow-the-buyer.test.ts:14; tests/unit/format-locale.test.ts:170; tests/unit/operating-countries.test.ts:33; tests/unit/orders-csv.test.ts:162 | tests |

Admin, App, Home, Docs and SQ-system code: no `"CZ"` literal (the Home
operator address and Docs `cs-CZ` are strings of a different kind).

Volume of currency and country literals the build will meet in Store
(`"EUR"`/`"USD"` and common country codes, rough counts by grep): src/app/dev
87 / 17, src/components 14 / 6, src/lib 27 / 26, tests/unit 269 / 137,
tests/component 75 / 31, tests/e2e 43 / 46, tests/integration 33 / 2,
supabase/migrations 35 / 6.

### 3.9 Prose that states the market (not constants, but must move with them)

SQ-home/src/content/legal/terms/tos-2026-11-06.ts:28, 76, 109 and
tos-2026-10-31.ts:15, 24, 76-103; SQ-home/src/app/terms/page.tsx:13;
SQ-home/src/content/legal/privacy.ts:11 ("We operate in the European Union, the
United States and Canada"); SQ-docs content pages mentioning EU/US/Canada or
currencies (16 files, e.g. SQ-docs/content/docs/en/(getting-started)/eu-seller-information.mdx,
SQ-docs/content/docs/en/pricing/index.mdx, and their cs counterparts). These
are for the messaging inventory; they matter here because no config module can
rewrite MDX or a frozen Terms version.

---

## 4. Deploys per repo, and what they allow

| Repo | How it deploys | Package manager in CI | Can CI use a workspace or relative path? | Can CI use a git dependency? | Registry token in CI |
|---|---|---|---|---|---|
| SQ-store | GitHub Actions `deploy.yml` on push to main: e2e gate, install `--frozen-lockfile`, typecheck, lint, unit, DB tests, schema gate, `opennextjs-cloudflare build`, `wrangler versions upload` + staged promote (SQ-store/.github/workflows/deploy.yml:26-29, 43-45, 79-130, 177-211) | pnpm 10 (deploy.yml:64-67) | Not today: one `actions/checkout` of Store only (deploy.yml:61-62, e2e.yml:33-34). A second checkout like Docs does is possible in GitHub Actions | Not used; pnpm can install git URLs; SQ-system `dist/` is gitignored so the dependency would need a build step | Secret **`GH_PACKAGES_TOKEN`**, optional: auth step skipped when empty (deploy.yml:8-10, 57, 75-77; e2e.yml:31, 47-49). Whether it is set is unknown. Other secrets named: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ERROR_REPORT_TOKEN`, `CRON_SECRET`, `BACKUP_DB_URL`, `BACKUP_PASSPHRASE`. Repo is public (backup.yml:9-14) |
| SQ-admin | GitHub Actions `deploy.yml`: `npm ci`, `opennextjs-cloudflare build` and `deploy` (SQ-admin/.github/workflows/deploy.yml:24-66) | npm | Single checkout; a second is possible | npm supports git URLs but not a subdirectory of a monorepo | **None.** No `.npmrc`. Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (:5-11) |
| SQ-app | Cloudflare Workers Builds (Git integration), no GitHub workflow; build command `pnpm config set ... "$GH_PACKAGES_TOKEN" && pnpm install --no-frozen-lockfile && pnpm build`, deploy `npx wrangler deploy` (SQ-app/README.md:83-94) | pnpm | Workers Builds clones this repo; a sibling repo is not available (not verified) | possible in principle, not used | Build variable **`GH_PACKAGES_TOKEN`**, documented as lacking Packages read (SQ-app/README.md:134-140; SQ-app/CUTOVER.md:14-31) |
| SQ-home | Cloudflare Workers Builds (SQ-home/scripts/sync-consent.mjs:3-5; SQ-home/docs/CONSENT_INTEGRATION.md:17-20), worker `sq-home` (SQ-home/wrangler.jsonc:7); `predeploy` = OpenNext build, `deploy` = `wrangler deploy` (SQ-home/package.json:14-15). GitHub Actions runs Lighthouse only (`npm ci`, `npm run build`, SQ-home/.github/workflows/lighthouse.yml:29-44) | npm | `file:` inside the repo works (that is the vendor folder); outside the repo, no | npm git deps, no subdirectory | **None**: "Workers Builds has no working GITHUB_TOKEN" (sync-consent.mjs:3-5) |
| SQ-docs | Production: by hand from a laptop, `SITE_URL=https://docs.squareshare.eu pnpm build` then `wrangler deploy --config worker/wrangler.toml` (SQ-docs/README.md:152-160). Dev site: GitHub Pages via `pages.yml`, which checks out `squaresharedev/SQ-system` beside the docs and builds tokens and consent first (SQ-docs/.github/workflows/pages.yml:20-66; lighthouse.yml:30-65) | pnpm 11.9.0 | **Yes, already**: relative `file:` path + sibling checkout | not used | None in workflows; the cross-repo checkout passes no token, which only works if SQ-system is readable with the Docs repo's default token (see section 6) |
| SQ-system | GitHub Actions `publish.yml` on `v*` tags to GitHub Packages (SQ-system/.github/workflows/publish.yml:8-48) | pnpm 11.9.0 | n/a | n/a | `GITHUB_TOKEN` with `packages: write` |

Constraints this puts on sharing a module:

- Two repos (App, Home) build on Cloudflare Workers Builds, where only the
  repo itself is cloned and (per their own notes) no working registry token
  exists. Anything they share must be inside their own repo at build time
  (vendored or generated file) or fetched at run time.
- Docs production builds on a laptop; anything it shares is whatever the
  laptop holds.
- Store and Admin build on GitHub Actions, where a second checkout or a
  registry token is possible but neither is configured for Admin, and only a
  dormant token step exists for Store.
- Database migrations for the shared project live in Store
  (SQ-store/docs/pricing-build-status.md:20: "Every migration for this database
  lives here"), but Admin and Home also carry their own migration folders
  (SQ-admin/supabase/migrations/0001 to 0009, SQ-home/supabase/migrations/3 files).
  Production migrations are applied by hand, and Store's deploy asks
  production for the objects a build needs (SQ-store/.github/workflows/deploy.yml:110-127,
  SQ-store/scripts/check-prod-schema.ts:1-25).

---

## 5. Options for the single source of truth

Cross-cutting facts that apply to every option:

- **What SQL can read.** A Postgres CHECK cannot contain a subquery, so a
  CHECK cannot read a config table. It can hold a literal list (as
  `orders_channel_check` does) or call an IMMUTABLE function whose body holds
  the list (as `username_is_reserved` does,
  SQ-store/supabase/migrations/20261021_reserved_usernames.sql:26-29). A
  trigger can read a table (as `enforce_plan_limit` reads `billing_switches`,
  SQ-store/supabase/migrations/20260930_seller_plans.sql:308). A foreign key
  to a lookup table is the other table-driven option.
- **Existing rows.** The guardrail is "report, never delete or disable"
  (SQ-store/COMPLIANCE_PROGRESS.md guardrails). A CHECK added `NOT VALID`
  skips existing rows at creation but is still evaluated on every later
  UPDATE of such a row (any edit of an existing EUR product would then fail).
  A trigger can be scoped to inserts and to changes of the governed column
  only. This favours triggers or column-scoped checks over plain CHECKs.
- **TypeScript types.** `z.enum` needs a literal tuple for its types
  (SQ-store/src/lib/settings/constants.ts:126-127,
  SQ-store/src/lib/validation/shipping-policy.ts:41-47). A list read at run
  time gives runtime validation but no literal types.
- **Read-side enums.** Store parses stored data with the same enums it writes
  with; a narrowed enum blanks stored policies (SQ-store/src/lib/settings/shipping-policy.ts:54-58).
  The market rule ("what may be newly sold") must be a separate predicate
  from "what may be stored and displayed" (`CURRENCIES`, `SHIPPING_COUNTRY_CODES`).
- **Hard-coded two-currency logic** (`toCurrency`, `currency <> 'USD'` in SQL,
  `products` CHECK, Admin and Home EUR formatting) must be changed whatever
  the option. It is not a config problem, it is a code problem the config
  exposes.
- **Scheduled monitoring** already has a home: GitHub Actions `scheduled.yml`
  calls bearer-authenticated `/api/cron/*` routes on Store daily
  (SQ-store/.github/workflows/scheduled.yml:1-50, SQ-store/src/lib/ops/cron.ts:1-27),
  with existing jobs in SQ-store/src/app/api/cron/. A precedent for a runtime
  cross-repo check is the Terms notice job asking Home whether a version page
  exists (SQ-store/src/lib/legal/terms-notices.ts:181-186).

### (a) A real published package consumed by every repo

- **Reuses**: the SQ-system workspace and `publish.yml`; scope mapping already
  present in Store, App, Docs `.npmrc`; Store's dormant `GH_PACKAGES_TOKEN`
  step; App's existing registry dependency.
- **New machinery**: a classic PAT with `read:packages` placed in Store's repo
  secrets, Admin's workflow (plus an `.npmrc`), App's and Home's Workers
  Builds variables, every developer's `~/.npmrc`; Home and Docs switched off
  `file:`; real version discipline (today's versions are 0.1.0, 0.3.0, 0.5.0
  and two packages were never committed).
- **SQL**: a package cannot be read by Postgres. Store would still need a
  migration whose list is compared to the package by a Store test (the
  order-channel parse pattern), or a generated SQL file.
- **"Expand to the EU" in practice**: edit SQ-system, tag, publish; bump the
  dependency in five repos; redeploy five repos (one by hand); a Store
  migration; plus Terms and docs prose. Between publishes the repos can run
  different versions of the rule.
- **Trade-off**: the cleanest code sharing, but it rests on the one route that
  has failed for four months, and still leaves the SQL copy and version skew.

### (b) Module in SQ-system, generated or copied files guarded by drift tests

- **Reuses**: the pricing working-copy convention (SQ-store/src/lib/pricing,
  header at enums.ts:5-7); Home's copy script (SQ-home/scripts/sync-consent.mjs);
  the parse-and-compare test pattern (SQ-store/tests/unit/order-channel.test.ts:83-101,
  reserved-usernames-sql.test.ts:18-34).
- **New machinery**: a generator in SQ-system that writes the TS file into each
  repo and the SQL list into a Store migration; a per-repo test that the
  generated file is unedited (for example a content hash recorded in the
  file); and a cross-repo check, which needs either a second checkout in CI
  (possible for Store and Admin, not for App and Home on Workers Builds) or a
  scheduled job that compares the copies.
- **SQL**: the generator emits the IMMUTABLE function or CHECK list; Store's
  test parses it against the TS copy.
- **"Expand to the EU" in practice**: edit SQ-system, run the sync, commit in
  five repos, Store migration, redeploy, review.
- **Trade-off**: works with today's builds (every repo has the file in its own
  tree), but it is the pricing model, whose cross-repo copy has no detection
  at all today. Without the cross-repo check it degrades into five
  hand-maintained copies.

### (c) Module in Store; other repos read a small public endpoint or the database

- **Reuses**: Store is the only enforcer at checkout and already owns every
  market constant (section 3.1, 3.2) and every migration; the plan-prices
  endpoint is a working template: built response, CORS `*`, edge cache,
  503 without caching on failure (SQ-store/src/app/api/billing/plan-prices/route.ts:5-64);
  Home's reader with an all-or-nothing fallback (SQ-home/src/lib/plan-prices.ts:12-74).
- **New machinery**: one Store module (for example `src/lib/market/`), one
  public endpoint, readers in Home, App and Admin (server-side fetch), a Store
  migration plus a Store drift test, and a scheduled check.
- **SQL**: Store migration (IMMUTABLE function or trigger-read table) compared
  by a Store test, exactly as order channels and reserved usernames are.
- **"Expand to the EU" in practice**: edit the Store module, add a Store
  migration, review, deploy Store; Home, App and Admin follow within their
  cache window. Docs (static export, by-hand deploy) and Terms prose still
  need their own edits.
- **Trade-off**: one compile-time authority where enforcement happens, no
  registry. But consumers need a fallback, and a fallback is a second copy
  (Home's `content/pricing.ts` is exactly that today); Docs cannot follow at
  run time; other repos gain a runtime dependency on Store.

### (d) Database config table as the root, TypeScript reads it

- **Reuses**: `billing_switches`, a single-row config table read by the app
  (SQ-store/src/lib/billing/switches.ts:1-55) and by a trigger
  (20260930_seller_plans.sql:308); `plan_prices` rows-as-config with
  append-only history (20261011_pricing_config.sql); Store, Admin, App and
  Home already hold Supabase clients (Home with the anon key,
  SQ-home/src/lib/supabase.ts:1-10).
- **New machinery**: the table (or one row per code), RLS that lets anon read
  it, triggers on the governed tables, a reader per repo, and a fail-closed
  policy for read failures (note `billing_switches` deliberately fails to
  OFF, switches.ts:14-15, the opposite of what a market rule needs).
- **SQL**: native, triggers read the same row the app reads. CHECKs cannot.
- **"Expand to the EU" in practice**: one UPDATE. That is a config change, but
  not by itself "plus a review": a row write bypasses code review unless the
  change is itself shipped as a migration. Copy, Terms and docs still need
  deploys.
- **Trade-off**: one source for SQL and every repo with a DB client, and no
  deploy to change values. But literal types are lost, each repo needs a
  fail-closed read, Docs has no DB access, and the value can change under a
  deployed UI that still says "Czech Republic only".

### Short recommendation

**(c) anchored in Store, with the SQL side as a migration-owned function and
a DB mirror table only if the monitor needs one.** Put the module in Store
(`ALLOWED_SELLER_COUNTRIES`, `ALLOWED_SHIPPING_COUNTRIES`,
`ALLOWED_CURRENCIES` as literal tuples), separate from the storage enums.
Mirror it into SQL through one migration whose functions or triggers hold the
same lists, guarded by a Store test that parses that SQL (order-channel
pattern) and a DB probe (plan_limit pattern), so the pair gates every Store
deploy. Publish the lists on a small public endpoint (plan-prices pattern) for
Home, App and Admin, and add a daily `/api/cron` market check in
`scheduled.yml` that reports violating rows and compares the endpoint with the
DB. Docs and the Terms stay prose with a review step. Copy the module into
SQ-system as a package only once the registry token works; until then a
SQ-system copy would be another unchecked mirror, as pricing is.

**Main risk**: the other repos still hold a fallback or a copy (Home's EUR
pricing, Admin's `formatEuros`, Docs prose), and drift there is caught only at
run time or by the monitor, never by their own builds. The second risk is not
location but code: `toCurrency`, the `currency <> 'USD'` aggregates and the
`products` CHECK assume EUR or USD and must be reworked before any CZK product
can exist.

---

## 6. Could not determine

- Whether the `v0.1.0`, `v0.2.0` and `v0.3.0` publish runs succeeded on GitHub
  Packages (no network). Notes claim 0.1.0 (SQ-app/README.md:142) and 0.2.0
  (SQ-system commit 14fd0ac message) were published; 0.3.0 only has a tag.
- Whether the SQ-system repository is public. The Docs workflows check it out
  without a token (SQ-docs/.github/workflows/pages.yml:30-34), which normally
  works only for a public repository; whether those runs pass was not checked.
  Store's repo is public by its own note (SQ-store/.github/workflows/backup.yml:9-14).
- Whether Store's `GH_PACKAGES_TOKEN` secret is set, and with which scopes.
- Whether SQ-app is deployed and live, and the exact Workers Builds settings
  of SQ-app and SQ-home (they live in the Cloudflare dashboard).
- Whether Cloudflare Workers Builds can fetch a second repository or git
  submodules for SQ-app and SQ-home.
- Whether production's constraints match the replayed schema in
  SQ-store/tests/db/prod-migrations.sql (production was not queried, by rule).
- Stripe's rules for CZK (minimum charge, payout rounding, Connect country
  support for CZ Express accounts): not in the code, not checked.
- Whether pnpm 10/11 on this codebase would install a git subdirectory
  dependency from SQ-system and build its `dist/` (nothing was run).
- Whether plan billing (`BILLING_CURRENCY = "EUR"`) is meant to move to CZK:
  a product decision, not answerable from code.
