# Code review 01: Czech-only beta, branches 01 to 04

Reviewer: independent (did not write the code). Read-only review of `C:\dev\sq-market-review` at `7c5d1df` (base `e43eedd`). Nothing was run: no install, test, build or server. Every line reference below is at that checkout.

Commits reviewed, oldest first:

| Commit | Title |
|---|---|
| 341ab30 | Read stored currencies strictly: no silent fold to EUR |
| 3ef733f | Make CZK storable and correct (migration `20261122_market_1_czk_currency.sql`) |
| c71a3ca | Add the market config, its validators and the database mirror (migration `20261122_market_2_rules_mirror.sql`) |
| 7c5d1df | Seller gate: sell only when established in the market (R1) (migration `20261122_market_3a_account_country.sql`) |

## 1. Verdict per commit

| Commit | Verdict |
|---|---|
| 341ab30 | Mergeable as is. No defect found; the EUR and USD paths are byte-for-byte the same output. |
| 3ef733f | Mergeable after listed fixes: F1 (CZK sales reported as euros) must be fixed or the deploy held until market/08; F9 and F10 are small. |
| c71a3ca | Mergeable as is. Two nits (N1, N6) can ride along with the next branch. |
| 7c5d1df | Mergeable after listed fixes: F2 (e2e left failing, including spec 87 which the message does not mention), F3, F4, F5; the rest are minor. |

## 2. Findings, most serious first

No blockers found. Nothing routes buyer money through the platform, the charge is still a direct charge with the application fee, and the currency Stripe is asked for is still only the product's stored currency.

### F1. CZK revenue is summed into the dashboard's and analytics' euro figures (3ef733f, major)

- Where: `src/lib/dashboard/queries.ts:119-127` (`window.revenue.EUR = sums.revenue_cents`), `src/lib/analytics/queries.ts:212` and `:292` (`currency: "EUR"`), and the SQL the app reads: `dashboard_orders_aggregate` and `analytics_aggregate` filter `currency <> 'USD'` (replica `tests/db/prod-migrations.sql:14582`, `:14690`, `:14701`, from the pending 20261120 block; the applied 20261117 versions do the same).
- What is wrong: once migration 1 is applied and 3ef733f is deployed, a seller can price in CZK and be paid in CZK. Every CZK order is then counted by those functions as a euro order, and the app labels the sum EUR.
- Concrete case: a CZ seller's first sale of a 1 299 Kc product (129 900 haler) shows on Overview and Analytics as "EUR 1,299.00" revenue, about 25 times the real value; a seller with legacy EUR orders sees the two currencies added together. Before this commit a CZK order could not exist, so this is a new wrong-money display, not a deferred enforcement. (`billing_sales_30d` counts `= 'EUR'` only, so the plan calculator shows a false zero instead; PLAN.md 5.6 already knows that one.)
- 341ab30 deliberately rewrote the comments to say "any code other than USD is counted as EUR" (`src/lib/analytics/queries.ts:251-252`, `src/lib/dashboard/queries.ts:150-151`), so the fold is known; nothing stops it once CZK is storable.
- Fix (pick one): (a) ship market/08's aggregate rewrite in the same deploy as 3ef733f; (b) as an interim, change both aggregate functions' filter to `currency = 'EUR'` in a small migration that lands with migration 1, so CZK sales are absent from euro totals rather than inflating them (with a one-line "CZK sales are not in these totals yet" note); (c) hold the deploy of 3ef733f until 08. The commit message should list this next to the order-level minimum under "Not done here".
- Test that would catch it: a db test that inserts one paid EUR order and one paid CZK order for a seller and asserts `dashboard_orders_aggregate(...).all_time.revenue_cents` equals the EUR order alone.

### F2. The commit leaves four e2e specs failing, and the Stripe stand-in can never produce a payable account (7c5d1df, major)

- Where: `tests/e2e/stripe-mock.ts:258-268` (`POST /accounts` returns no `country`), `:270-274` (`GET /accounts/:id` returns the stored mock, still without `country`); `src/lib/payments/connect/account.ts:144-151` (`canTakePayments` now requires a known, allowed, matching country); `tests/e2e/87-stripe-connect.spec.ts:288-317` ("checkout opens only once the account may take payments", expects status 200 at `:317`).
- What is wrong: the stand-in ignores the `country` parameter and never answers one. `storableStripeCountry(undefined)` stores null at creation and again on the onboarding return, so `canTakePayments` stays false and spec 87 can never see checkout open. It also makes `sellerGateAccount` count the enabled account with an unknown country, so publishing is refused with `market_restricted` for that seller. The commit message names specs 30, 50 and 60 as "expected to need updating" but not 87 (which runs under `playwright.connect.config.ts`, not in CI today, so nobody will notice until the Connect run in branch 11).
- PLAN.md section 6 says Stripe behaviour "is proven against a stand-in until item 8 happens": this commit silently breaks that proof.
- Fix: make the stand-in record and echo `country` (`account.country = form.get("country") ?? "CZ"` on create, and include it in the GET and in any `account.updated` it sends); update specs 30, 50 and 60 to choose the country of establishment (or seed it) before landing, not after. Do not merge a branch that knowingly fails e2e.
- Test that would catch it: running spec 87 under the connect config; a unit test on the stand-in that a created account answers the `country` it was given.

### F3. An enabled account whose country is unknown is told it is a foreign account, publishing is refused, and there is no self-serve way out (7c5d1df, minor in production today, major in every dev and e2e environment)

- Where: `src/lib/market/problems.ts:59-62` (`stripe_country_not_allowed` with `country: null`), `src/lib/payments/connect/account.ts:159-161` (`sellerGateAccount` counts any charges-enabled account), `src/lib/errors.ts:278` (no action for that block), `messages/en/errors.json:184-186` ("your Stripe account is registered in a country where Square Share does not sell yet ... A Stripe account's country can't be changed, so contact support"), `src/lib/dashboard/attention.ts:245` (the same block gets the "Your Stripe account doesn't match your country" row).
- Concrete case: any `seller_payment_accounts` row that is charges-enabled and was written before migration 3a (0 rows in production, but every dev database and the e2e stand-in, see F2). The seller is told their Stripe account is foreign and to contact support, publishing is refused, and checkout is off. The only thing that fills the country is the onboarding return route or an `account.updated` event; a fully onboarded seller does not pass through the return route again (the Payments page offers the Express dashboard link for an enabled account), and Stripe sends `account.updated` only when something changes.
- Fix: treat a null Stripe country as its own state: either refresh from Stripe once when the country is null (in `getSellerGateStatus` or a one-off backfill script that calls `refreshPaymentAccount` for every row with `country is null`), and give it separate copy ("We are checking your Stripe account's country") rather than the foreign-account copy. Keep payments closed while unknown (that part is right).
- Test that would catch it: a seller-gate test for `{ country: null, chargesEnabled: true }` asserting the reason is not the foreign-account copy, plus a test that the backfill fills it.

### F4. A failed account read is treated as "no account" when creating one, so the code can create a second Stripe account (7c5d1df, minor: Connect is off in production and the sentinel holds the deploy)

- Where: `src/lib/payments/connect/account.ts:229` (`const existing = await readPaymentAccount(owner.ownerId)`; `readPaymentAccount` returns null on any read error), then `:236-247` (POST `/accounts` with key `connect_account_v2_<owner>`).
- What is wrong: the commit added `readPaymentAccountResult` precisely to tell a failure from "none", and uses it in the publish gate, but not here. The new `country` column in `SELECT` adds a new way for the read to fail: code deployed before migration 3a. Then every seller who already has an account (created under the old key `connect_account_<owner>`) and presses Connect gets a brand-new Stripe account under the v2 key, after which the upsert fails on the missing column and the action errors. A transient read error does the same at any time (the v2 key only protects within 24 hours of the first v2 call).
- This is the one place found where the change fails OPEN (a write to Stripe on a failed read); publishing and payments do fail closed.
- Fix: in `ensurePaymentAccount`, use `readPaymentAccountResult` and throw on `{ ok: false }` before calling Stripe.
- Test that would catch it: `connect-country.test.ts`: account read errors, assert `stripe.calls` is empty and the call rejects.

### F5. Setup checklist and Payments page say "ready" while checkout is closed by the market (7c5d1df, minor)

- Where: `src/app/(dashboard)/dashboard/page.tsx:185` (`payments: payments.chargesEnabled ? "ready" : ...`), `src/lib/payments/connect/overview.ts:69-79` (`statusOf` reports `chargesEnabled` as is).
- Concrete case: an enabled account with a null, foreign or mismatched country: the checklist ticks "payments ready" and the Payments page shows the account as able to take payments, while `checkoutProviderFor` returns null and the Needs attention row says selling is paused. P1a 4.7 says the Payments page should show the problem.
- Fix: derive the checklist's payments state and the Payments status from `canTakePayments(account, establishmentCountry)` (or add a "blocked by the market" state).
- Test: onboarding-steps test with an enabled account in another country expects the payments step not done.

### F6. The market is hard-coded into the copy, five times over in every locale (7c5d1df, minor; deviates from P1a 1.4)

- Where: `messages/en/dashboard.json:76`, `:81`; `messages/en/errors.json:181`; `messages/en/settings.json:378`, `:578`; the same five sentences in the other nine locales. The code comment at `src/lib/errors.ts:266` says "No country is spliced into the sentences", but the country is written into them as a literal ("Czech Republic", "Ceske republice", "Tschechien", "Czechach").
- What is wrong: c71a3ca claims opening a country is a config change, and `tests/unit/market/expansion.test.ts` proves it for the validators; but with `MARKET.sellerCountries = ["CZ","SK"]` these strings would tell a Slovak seller who may now sell that Square Share is "open only to sellers established in the Czech Republic". Fifty strings must be found and rewritten by hand. P1a 1.4 required a `{countries}` value from `marketCountryList` placed in a nominative position, which handles the declension worry the comment raises. The repo rule "copy is i18n keys, reused where the meaning is the same" is also broken: the same "open in the Czech Republic for now" sentence exists as five keys.
- Also: the English copy says "Czech Republic" while the country picker on the same form shows "Czechia" (`regionName`, and `MARKET_SELLER_COUNTRY_NAME` in `tests/e2e/helpers.ts` uses `Intl.DisplayNames`, which also says "Czechia").
- Fix: one shared sentence key per meaning, taking `{countries}` from the market (or, if the owner accepts hand-edited copy per expansion, say so in PLAN section 8 and add a test that fails when `MARKET` has more than one seller country and these keys still name one).

### F7. Coverage test proves "enforced" by a file existing, and several cells cite a test that does not exercise the path (7c5d1df, minor)

- Where: `tests/unit/market/coverage.test.ts:343` (the only check on an `enforced` cell is `existsSync(file)`).
- Cells whose cited test does not exercise the path: S-04 "WelcomeFlow trader step" (the welcome flow cannot send a country at all, `src/components/onboarding/WelcomeFlow.tsx` has no `tax_country`); C-07 `POST /api/cart` (cites `product-add-ons.test.ts`, which calls `quoteOrder`, not the cart route); A-02 the return route (the test calls `refreshPaymentAccount`, not the route, so the route's `checkAccountMarket` call at `src/app/api/payments/connect/return/route.ts:40` is untested).
- P1a 8.2 asked for a body scan that each enforced entry's function names its validator or a known wrapper. Without it, deleting the `publishBlockedError` call from `saveStorefront` would leave this test green.
- Fix: add the body scan (as `registry.test.ts:219-231` does for step-up), and cite the test that actually drives each path.

### F8. Test gaps and one loosened assertion (7c5d1df, minor)

- `tests/unit/product-add-ons.test.ts:570`: the new R1 quote test asserts only `toMatchObject({ ok: false })`, so any refusal (busy, not_found, options) passes. Assert the specific reason.
- `tests/unit/market/seller-gate-write-paths.test.ts:61`: `seller_payment_accounts` always answers `{ data: null }`, so neither half of the new write-side Stripe logic is tested: a charges-enabled account in another country refusing a publish with `market_restricted`, and a failed account read refusing with `server_error` (`src/lib/settings/seller-identity.ts:384`). Both are claims in the commit.
- `switchesOnForBuyers` (`src/lib/storefront/public-gate.ts:57`) has no direct test; switching the cart or the embed on through `saveStorefront`, and the `before === null` (stored config does not parse) branch, are untested.
- `get_store`'s new `canSell`, `sellBlocked` and `market` output (`src/lib/agent/tools/store.ts:86-100`) has no test.
- Nothing tests that the welcome flow still produces a publishable seller, and it no longer can (see N8).

### F9. "No change for EUR and USD" is not quite true for stored shipping policies, and the advertised schema now says 25 000 for a euro rate (3ef733f, minor)

- Where: `src/types/shipping-policy.ts:124` (`SHIPPING_RATE_MAX_CENTS = Math.max(...)`, now 2 500 000), used as the storage bound by `storedShippingPolicySchema` (`src/lib/validation/shipping-policy.ts:61-66`, `:75`) and by the profile rate (`src/lib/validation/storefront.ts:704`).
- Concrete case: a stored EUR policy with a rate of 150 000 cents used to fail the read and become the empty policy (no delivery, no checkout for parcels); it now parses and checkout quotes EUR 1 500 delivery. Only a writer outside the app could have stored one (SH-03), so the practical risk is low. Separately, `get_schema of=shipping_policy` (`src/lib/agent/tools/storefronts.ts:53`) publishes `maximum: 2500000` for every `rateCents` regardless of currency (a `superRefine` is not in the JSON schema), so an assistant is told a euro rate of 25 000 is valid and is then refused.
- Fix: say so in the commit message; describe the per-currency cap in the field description so `get_schema` carries it.

### F10. Migration 1's ordering note is incomplete (3ef733f, minor)

- Where: `supabase/migrations/20261122_market_1_czk_currency.sql` header ("Apply BEFORE the code that writes CZK").
- What is missing: it must also be applied AFTER 341ab30 is live. With migration 1 applied under the current production code, a CZK product written straight through PostgREST (the seller's own JWT, DB-02) is folded to EUR by `toCurrency` (shown and charged as the same euro number, so no deception, but every dashboard calls it euros). With migration 1 applied under 341ab30 but before 3ef733f, the same row makes `storedCurrency` throw in the seller's own product list (`src/lib/products/queries.ts:143`), so an editor can break the owner's Products page.
- Fix: header line "apply only after 341ab30 is deployed, and deploy 3ef733f straight after".

### F11. Extra profile reads on checkout paths (7c5d1df, minor, zero today because Connect is off)

- Where: `src/lib/checkout/availability.ts:84` (`getEstablishmentCountry` for every charges-enabled account), `src/lib/checkout/stripe-provider.ts:84-87`.
- Count from the diff, with Connect live: product page and both checkout pages +1 profiles read per render (React-cached); cart route handlers (`src/lib/cart/availability.ts:49`, `src/lib/cart/route.ts`) +1 per request (cache is a no-op in route handlers); order placement +2 (`checkoutProviderFor` in `placeOrderResponse`, then the intended fresh read in `placeStripeOrder`). Every one of these callers already holds the gate row, whose `TRADER_GATE_SELECT` includes `tax_country` (`src/lib/settings/seller-identity.ts:86`). Storefront page and embed API: 0 extra. Dashboard, Settings > Business and `get_store`: +1 `seller_payment_accounts` read each (`getSellerGateStatus`), seller side only.
- Fix: pass the establishment country from the gate row into `checkoutProviderFor` on buyer paths; keep the fresh read only in `placeStripeOrder`.

### F12. Ops alert on every event, without de-duplication (7c5d1df, minor)

- Where: `src/lib/payments/connect/account-market.ts:48`, called from `webhook.ts:186` (every `account.updated`), `settings/actions.ts:566` (every Settings save that sends a country) and `connect/actions.ts:92` (every Connect click, with `created: true` even for an existing account, so it alerts while the account is not even enabled).
- Concrete case: one mismatched account produces an email per capability or requirements change from Stripe and per save. Fix: alert once per account and reason (store `alerted_at`, or key the alert), and pass `created: true` only when `ensurePaymentAccount` really created the account.

### Nits (written rules)

- N1 (c71a3ca): `supabase/migrations/20261122_market_2_rules_mirror.sql:38` (and its replay) points at `20261122_market_3_columns`, a file that does not exist; it is `20261122_market_3a_account_country.sql`.
- N2 (7c5d1df): `ESTABLISHMENT_COUNTRY_SELECT` (`src/lib/settings/seller-identity.ts:113`) says it is "Part of SELLER_IDENTITY_SELECT", but `SELLER_IDENTITY_SELECT` (`:60-61`) spells `tax_country` again as a literal. When 1B changes the accessor, the gate select will not follow. Build one from the other (tokenize-everything rule).
- N3 (7c5d1df): two lists named `TYPED_TRADER_FIELDS` with different members (`src/lib/settings/trader-identity.ts:252` without `country`, `src/lib/onboarding/steps.ts:139` with it). Rename one to what it means (the ICU `fields` combinations).
- N4 (7c5d1df): `MARKET_RESTRICTED_NOTE` (`src/lib/agent/tool.ts:77`) and `SELLER_OUTSIDE_MARKET_WORDS` (`src/lib/agent/tools/previews.ts:156`) are the same English sentence twice; reuse one.
- N5 (7c5d1df): the Settings field is still labelled "Country" (`messages/en/settings.json:379`) while every notice calls it "Country of establishment" (`:575`); the onboarding step detail (`Onboarding.steps.seller.detail`) still lists only name, address and email when the country alone is missing.
- N6 (3ef733f): `Validation.int.shippingRate.tooBig` reads "cannot exceed {maximum} cents", now shown for koruna (haler) and with a raw 2500000.
- N7 (3ef733f): `tests/unit/format-locale.test.ts:139` pins `moneyCompact("CZK", "en")` to "Kc1.2k" (symbol glued to the number in English, while the exact amount reads "CZK 1,204.50"). Harmless while analytics are euro-only; worth a look before 08.
- N8 (7c5d1df): the welcome flow never asks the country, so a new seller who completes it is no longer publishable and is sent to Settings by the first refusal. Deliberate per PLAN (branch 09), but it is a regression in the meantime; say so in the commit message, next to the specs.
- N9 (7c5d1df): `buildSellerIdentity` keeps the raw `tax_country` (`src/lib/settings/seller-identity.ts:237`), so the designer's notice (`src/components/storefront/ProductPageSection.tsx:747`) counts a stored "XX" as present while the gate counts it as missing.

Counts: 0 blocker, 2 major (F1, F2), 10 minor (F3 to F12), 9 nits.

### Not a defect, but noted as asked

- The order-level Stripe minimum is still not checked at checkout (deferred to a later branch by design). It is not new for EUR (a 0.01 EUR product reaches Stripe and fails with a generic "failed"), but it becomes much more likely with CZK: any CZK order under 15 Kc (a 10 Kc sticker, a 9 Kc download) reserves a pending order, Stripe refuses the session, and the buyer sees a generic failure. The product price floor is 1 minor unit for every currency (`src/lib/validation/product.ts:479`). The discount floor is correct per currency.
- A seller who started onboarding under the old idempotency key keeps their row and is returned unchanged; nothing calls Stripe again. Only a seller whose earlier create succeeded at Stripe but whose row was never written gets a second account under the v2 key (and see F4). An existing account whose Stripe country turns out not to be CZ cannot be discarded in-app; it needs support (acceptable with 0 accounts).

## 3. Claims checked and found true

- 341ab30: `formatCents` gives identical output for EUR and USD (`formatPrice` was the same `numberFormat(intlTag(...), { style: "currency" })` call); malformed codes print "amount CODE", never another currency. Every `toCurrency` call site is gone (23 `storedCurrency` callers). The three buyer gates drop an unparseable currency before any `storedCurrency`: `visiblePlacedRows` (`src/lib/products/purchasable.ts:356`, which also feeds `loadStoreItems` and so cart suggestions), the storefront board, and `loadAddOns`. `rowToProduct`'s inline fold is replaced.
- 3ef733f: discount floor for EUR and USD unchanged (`minimumChargeCents` is 50 for both); `currencySymbol` returns the same signs the two hand maps did for EUR and USD; the CSV change only widens ("299,-" and "1.299,-" now parse; nothing that parsed before parses differently; "299,-" used to be null). Migration 1: the tolerant drop finds inline-named CHECKs by column, `discounts_value` is dropped by name without IF EXISTS as intended, `orders_currency_supported` is new, the final block refuses any surviving currency CHECK without 'CZK' and the replica holds no other currency CHECK on those four tables that would trip it; re-run safe; ASCII only; the replay blocks are byte-identical to the files; the four sentinels match the constraint names the migration creates.
- c71a3ca: `MARKET` is frozen, typed as a subset of the storable lists, reads no environment. Migration 2: RLS on `market_rules`, `revoke all` from public, anon, authenticated and service_role then `grant select` to service_role; every helper is SECURITY DEFINER with `search_path = ''`, fully qualified, EXECUTE revoked from public, anon, authenticated and granted to service_role only; `market_codes_valid` executable by nobody but the owner; idempotent; ASCII. TS and SQL agree on every seller outcome (null, "", lower case, non-storable and outside-market all refuse).
- 7c5d1df: the account type is still `"express"` and `dashboardLink` still uses `login_links`; nothing depends on the account kind; `refund_application_fee` and the refund paths are untouched and do not call `canTakePayments`. `canTakePayments` has exactly two callers (`checkoutProviderFor`, `placeStripeOrder`), both updated; the fresh re-check at placement reads the account and the country in parallel and refuses on a failed read. The country field is not locked; an outside-market country is saved. `publishBlockedError` fails closed on a profile or account read failure. `sellerMaySell` now carries the market to every buyer read (product page, hosted storefront, embed frame and embed JSON, OG image, sitemap, cart, quote). The webhook still throws (and is redelivered) when the account lookup fails, and `checkAccountMarket` never throws, so an event is not lost. Migration 3a: additive nullable column with a shape CHECK, grants inherited (service_role only), `seller_sell_block` replaced in place with grants restated; replay identical. Refusals name no country and leak nothing about another seller; buyers get a plain 404. No new `"use server"` export. All ten locales have every new key. No em dash and no line-ending flip in any changed file (checked by counting CRLF per file at both commits).

## 4. Could not verify by reading alone

- Type check and the existing suites: whether `tsc --noEmit`, the `unit` and `db` Vitest projects and the i18n client-scope test pass at `7c5d1df`. Run them in a worktree.
- Spec 87's exact failure point (F2): reasoned from the stand-in's code; running `playwright.connect.config.ts 87-stripe-connect.spec.ts` would confirm.
- Real Stripe: that a CZ Express account answers `country: "CZ"` on create and on `account.updated`, and that a 15 Kc minimum and haler amounts behave as `CURRENCY_RULES` assumes. Needs the owner's test-mode run (PLAN item 8).
- Client bundle size: `lib/errors` (imported by client components such as `TaxSection` and the notification chrome) now pulls `lib/market/problems` and `lib/shipping/rates` into every bundle that imports it. A production build's bundle report would show the cost.
- Production data: that every order row's currency is exactly `EUR`, `USD` or `CZK` before migration 1 (the pre-check query in its header answers this; a lower-case row would make the new CHECK fail to add).
- Lock contention: migration 1 holds ACCESS EXCLUSIVE on products, product_price_history, discounts and orders until it commits; fine on today's table sizes, but whether a concurrent `order_place` could deadlock against it depends on lock order inside that function. Apply it at a quiet moment.
