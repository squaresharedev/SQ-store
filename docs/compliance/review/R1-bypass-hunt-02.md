# R1 bypass hunt 02: commit ed69649

Second adversarial review of RULE R1 (only a seller established in the market
may sell) and of strict currency, read from the read-only checkout
`C:\dev\sq-market-review` (detached at `ed69649`). Nothing was run: no
node_modules, no tests, no servers, no calls to Stripe, Supabase or production.
Every file:line below is in that checkout unless another repo is named.
Date: 2026-11-22.

Scope: the twelve findings of `R1-bypass-hunt-01.md` (commit 7c5d1df), the code
the fix round added or changed (`git diff 7c5d1df ed69649`, 99 files), and a
fresh hunt across buyer reads, money paths, jobs, MCP tools and caches.

Production facts used (taken from the first report, PLAN.md and the migration
comments, not queried): Stripe Connect is off, `seller_payment_accounts` has 0
rows, the cart ships dark (`CART_ENABLED` unset), and migration 3a and the cart
migration are not applied.

---

## 1. Verdict

1. **R1 is CLEAN at this commit.** I found no way for a buyer to be shown an offer from, or to pay, a seller with no country on file, a country outside the market, or a charges-enabled Stripe account whose country is unknown, outside the market or not the seller's own. Every buyer read now counts the account in the same profile read. The publish gate, the buyer read and SQL's `seller_sell_block` give the same answer for the same facts. The one accepted residual is unchanged: a Stripe page opened before the seller left can still be paid for up to 31 minutes. The webhook now tells ops when that happens.
2. **Strict currency is not clean, by one latent finding.** R2-01 (P2): the cart can show a line's price in the wrong currency, falling back to EUR in the browser. A 250 Kč line that has sold out shows as "€250.00". Nothing is ever charged that way. The cart is off in production, so this reaches no buyer today. It will the day `CART_ENABLED=1` is set.
3. **Against the test you set:** with production's configuration today, nothing above P3 reaches a buyer or money. If features that ship dark count, the hunt is not CLEAN, because of R2-01.
4. **The first report's twelve findings:** seven are closed (R1-01, 02, 03, 04, 06, 09, 12). R1-05 is partly closed, by design, until the guards ship. Four P3s are still open and unchanged (R1-07, 08, 10, 11). I found no regression in the fixes.
5. **The other three new findings are P3:**
   - R2-02: a promised way out that does not exist while Connect is off.
   - R2-03: a read gate that treats a missing embed as "no account", with no test that runs the real select.
   - R2-04: Payments page renders that call Stripe, and write the account row, with no rate limit.

---

## 2. Findings

### 2.1 New findings, most serious first

| Id | Title | Severity | Status |
|---|---|---|---|
| R2-01 | The cart shows an unbuyable line's price in the wrong currency. With no buyable line the browser falls back to "EUR". A line in a second currency is shown in the first line's currency | P2 (latent: the cart is off in production) | Open. Strict currency, on a buyer's screen, never charged |
| R2-02 | `stripe_country_unknown` has no way out while Connect is off. Buyer pages refuse the seller, and the copy sends them to Payments, which never asks Stripe | P3 | Open. Unreachable in production today (0 rows) |
| R2-03 | The read gate reads a missing `seller_payment_accounts` key as "no account", and no test sends `READ_GATE_SELECT` through PostgREST | P3 (hardening) | Open. No current caller gets it wrong |
| R2-04 | Every Payments page render calls Stripe, and writes the account row for an unknown-country account, with no rate limit, for any team member | P3 | Open. Mostly pre-existing; the fix round added one call and one write |

### 2.2 The first report's findings, as they stand at ed69649

| Id | Was | Now | Evidence at ed69649 |
|---|---|---|---|
| R1-01 | P0, bounded | **Closed as designed.** The paid order is checked again and ops are told. The 31-minute window stays, as accepted in P1a 5.5 | `webhook.ts:225-231` calls `checkPaidOrderSeller` after `confirmPendingOrder`. `account-market.ts:92-99` reads the seller's country fresh, runs `sellerSellBlock` on it and on the paying account, and alerts once per order per day. It throws on an unreadable seller, so Stripe delivers again. Replays are safe: `order_confirm_paid` returns no order id the second time (`orders/record.ts:306-327`) |
| R1-02 | P1, latent | **Closed** | `READ_GATE_SELECT` embeds `seller_payment_accounts(charges_enabled, country)` (`settings/seller-identity.ts:105-113`). `sellerReadGateReasons` passes `readGateAccount(row)` (`:126-130`, `:246-252`). Every buyer loader selects it: `products/purchasable.ts:291` and `:322-323`; `storefront/storefront-page.ts:248` and `:265-266`; `api/embed/[key]/route.ts:56-75`; `api/og/p/[productId]/route.ts:84-95`; `seo/sitemap.ts:149-158`; both assistant previews. Residual hardening: R2-03 |
| R1-03 | P2 | **Closed** for the market. Missing details alone leave the switches on, on purpose; the buyer reads refuse that seller until the details are in | `storefront/actions.ts:180-200`, `storefront/public-gate.ts:73-79`. A failed gate read answers `server_error`, which also starts the storefront with its switches off |
| R1-04 | P2 | **Closed** | `payments/connect/actions.ts:139-145`. A submitted account gets its dashboard. An unfinished one is resumed only when `onboardingRefusal` (`:38-45`) allows it |
| R1-05 | P2 | **Partly closed.** Writes stay open until P1b file 6, by design. The read side now refuses all three reasons, so the R1-02 combination (a direct `status = 'active'` by a seller refused only for their account) no longer reaches buyers | As R1-02. Section 2.4, last row, says what a buyer can still see |
| R1-06 | P3 | **Closed** | `agent/tools/products.ts:281-290` asks `publishBlockedError` once for products already active. A refusal gets no `pageUrl` (`:307`) |
| R1-07 | P3 | **Open, unchanged** | `api/embed/[key]/route.ts:204` is still `s-maxage=300`. `OPTIONS` (`:225-252`) still asks no seller gate |
| R1-08 | P3 | **Open, unchanged** | The preview's button still falls back to the purchase link or email. Only the select changed in `agent/preview/product-page-preview.ts` |
| R1-09 | P3 | **Closed** | A new `stripe_country_unknown` block (`market/problems.ts:53`, `:68`) with its own copy and a Payments action (`errors.ts:257`, `:285-287`). `getSellerGateStatus` fails closed on a failed account read (`seller-identity.ts:379-383`), and `get_store` then answers `canSell: null` (`agent/tools/store.ts:88`). Residual: R2-02 |
| R1-10 | P3 | **Open, unchanged** | The same eight pages still read `getTraderIdentityStatus`, which asks the details only |
| R1-11 | P3 | **Open, unchanged** | The reviews route was not touched |
| R1-12 | P3 | **Closed** | `storefront/actions.ts:549-560` asks the gate when an "embed off" save would rewrite an unparseable config with the defaults |

### 2.3 Details of the new findings

#### R2-01. Cart price in the wrong currency (P2, latent)

**Evidence (verified in code).**
- The view's currency is the first BUYABLE line's, or null: `src/lib/cart/view.ts:81`.
- A line that cannot be bought (any problem except `not_found`) still carries its own product's price: `view.ts:51-52` and `:62` (`unitCents: at ? ... : (unit?.now ?? null)`). The line carries no currency of its own (`unitPrices`, `view.ts:126`).
- A line in a second currency is such a line: `checkout/quote.ts:273-279` marks it `currency`.
- The browser falls back to EUR when the view has no currency: `src/components/cart/CartPanel.tsx:92` (`currency={view?.currency ?? "EUR"}`) and `:148` (the summary).
- The line row prints the amount of an unbuyable line, only greyed: `src/components/cart/CartLineRow.tsx:56`, `:167-176`.
- The fallback came with the cart (`git blame`: a48b90e). The strict-currency commit 341ab30 changed `view.ts` but not the client.
- The cart is dark in production: `src/lib/cart/availability.ts:14-19`.

**Scenario A (one currency).**
1. A Czech seller sells a mug at 250 Kč. A buyer adds it to their cart.
2. Before checkout the mug sells out. (Or the seller ticks "sold out" on the tile, changes its versions, or saves delivery rates that no longer cover CZK.)
3. The cart view now has one line: problem `sold_out`, view `currency: null`, `unitCents: 25000`.
4. The panel shows "€250.00" (English) or "250,00 €" (Czech) beside the line, and a subtotal in euros.
5. Checkout is refused (`canCheckout` is false, `view.ts:120`), so nothing is charged.

**Scenario B (two currencies).** A seller still has a legacy EUR product and a CZK one. Adding a second currency is refused when the line is added (`api/cart/[storefrontId]/route.ts:101-112`). But a product's currency can change after it is in a cart. That line is then marked `currency` and shown in the view's EUR. Branch 05 hides EUR products and removes this case. Scenario A stays.

**Smallest fix.**
- Give each line its own currency (`currency: storedCurrency(item.row.currency)` on `CartLineView`), and format each line with it in `CartLineRow`.
- In `CartPanel` and `CartSummary`, show no amount when `view.currency` is null, instead of falling back.
- Make `quote.ts:330` (`sellable[0]?.currency ?? "EUR"`) impossible as well. Today only the cart view reaches it, with an empty list, and it does not display that value. It is the same literal waiting to be reached.

**Test.**
- Unit, beside the cart view tests: one CZK line that has sold out gives a line whose currency is CZK, or whose amounts are null. Never a view a renderer could print as EUR.
- Component: `CartPanel` with `view.currency: null` and a priced line renders no "€".
- A source scan in the strict-currency suite that refuses `?? "EUR"` outside fixtures and `src/app/dev`.

#### R2-02. No way out of `stripe_country_unknown` while Connect is off (P3)

**Evidence (verified in code).**
- The read gate counts a charges-enabled account whether or not Connect is live (`seller-identity.ts:126-130`). So does SQL (migration 3a). A null country refuses (`market/problems.ts:68`).
- The refusal's way out is "open Payments": `errors.ts:285-287`, and the Overview row (`dashboard/attention.ts:244-256`).
- Payments asks Stripe only when Connect is live. `realPaymentsOverview` returns the empty overview, before `syncUnknownAccountCountry` is reached, when `!stripeConnectLive()` (`payments/connect/overview.ts:195-202`). The account card then says "not connected" (`:102`).

**Scenario.**
1. Connect is on in some environment. A seller connects. Their row is written without a country (written before 3a, or the onboarding return's refresh failed).
2. Stripe enables charges on the account.
3. Connect is switched off there (a rollback, or a staging config).
4. The seller's pages now answer 404 to buyers. The Overview tells the seller to open Payments.
5. Payments shows "not connected" and never asks Stripe. Only support can help.

With Connect on, the way out works. In production today (Connect off, 0 rows) nobody is affected. This is not a bypass: it refuses too much, never too little.

**Smallest fix.** When `!stripeConnectLive()`, give `stripe_country_unknown` support copy with no Payments action, in `marketRestricted` and in the attention row. Before Connect is switched on anywhere, run a read-only check for rows with `charges_enabled and country is null`.

**Test.** In `tests/unit/market/payments-status.test.ts`: Connect off, a charges-enabled account with a null country. The attention row carries no Payments link.

#### R2-03. A missing embed reads as "no account" (P3, hardening)

**Evidence (verified in code).**
- `readGateAccount` turns an absent key into null (`seller-identity.ts:127-129`). Null means "no account", which refuses nothing.
- The type does not protect this. Every caller casts the PostgREST result (`as ReadGateRow`): `purchasable.ts:322`, `storefront-page.ts:265`, embed `route.ts:68`, OG `route.ts:95`, `sitemap.ts:157`.
- `TRADER_GATE_SELECT`, which has no embed, is still exported (`seller-identity.ts:90`). It is exactly the string those call sites used before this commit.
- Only the embed route's test checks the select string (`tests/unit/market/seller-gate-reads.test.ts:127-133`). The other loaders' tests feed fake rows that already carry `seller_payment_accounts`.
- No test sends `READ_GATE_SELECT` through PostgREST. The db project's queries go straight to Postgres (`tests/db/client.ts`), and its new case checks only the constraints (`tests/integration/53-account-country.test.ts`). The e2e specs were changed but not run, and none seeds a foreign charges-enabled account and then opens a buyer page.

**Scenario.**
1. A later change (a new buyer surface, or a refactor of one of the five loaders) selects `TRADER_GATE_SELECT` and calls `sellerMaySell`.
2. A seller established in CZ, with a charges-enabled account in DE or of unknown country, is shown to buyers again, with a purchase-link or email button. That is the R1-02 shape.
3. The unit tests with fake rows still pass.

**Smallest fix.**
- In `sellerMaySell` (or `readGateAccount`), refuse when the row has no `seller_payment_accounts` key at all. Keep `null` as "no account".
- Add a source scan to `coverage.test.ts`: every file that calls `sellerMaySell(` or `sellerReadGateReasons(` also names `READ_GATE_SELECT`.

**Test.**
- Unit: `sellerMaySell` of a complete in-market row without the key answers false.
- If the db harness can reach a PostgREST: one service-role REST read with `READ_GATE_SELECT` that returns the account as an object.

#### R2-04. Payments renders call Stripe with no rate limit (P3)

**Evidence (verified in code).**
- The page renders the real overview for any member of the store (`app/(dashboard)/payments/page.tsx:40-43`, `lib/payments/mock.ts:111-114`). Every role holds `store.read` (`team/permissions.ts:69`).
- Each render does this:
  - `syncUnknownAccountCountry`: one Stripe `GET /accounts/{id}` and a row update, only while the account's country is null and charges are enabled (`payments/connect/account-market.ts:113-124`);
  - then `GET /balance`, `/payouts` and `/balance_transactions`, and up to five history pages (`overview.ts:205-226`).
- No `rateLimit` call exists anywhere on this path.

**Scenario.** A member of a store, or a script holding their session, reloads `/payments` in a loop. Each load is 4 to 9 requests to Stripe on the platform's key, plus a row write while the account's country is unknown. Ops mail from the sync is capped at one a day per set of facts, so mail is bounded. Stripe requests are not, short of Stripe's own limits.

Mostly pre-existing: the balance and ledger reads were already there. The fix round added one call and one write, only for unknown-country accounts.

**Smallest fix.** One per-user budget on the real overview (`rateLimit("payments_overview", ...)`, showing the account card alone when it is spent). And `firstInWindowKey` per account, for a few minutes, around `syncUnknownAccountCountry`.

**Test.** Unit: with the budget spent, `realPaymentsOverview` makes no Stripe call. Two renders inside the window make one sync call.

### 2.4 Attacked and not real

| Attack | Why it fails (evidence) |
|---|---|
| The embedded account comes back absent, null or in another shape while an account exists | `owner_id` is the primary key and references `profiles(id)` (`supabase/migrations/20261008_seller_payment_accounts.sql:34`), so PostgREST embeds it one-to-one. The code also reads an array (`seller-identity.ts:128`). Every read uses the service role (`lib/supabase/admin.ts`), which bypasses RLS and holds `grant all` on the table (`20261008...sql:61-63`). A session client has no grant on it, so an embed through one would error and fail closed, not read null. The same one-to-one embed from `profiles` already serves billing and plan grants (`settings/account-row.ts:94-97`) |
| A failed read lets a seller through | Every loader turns a read error into a null row, and `sellerMaySell(null)` is false (`seller-identity.ts:238-240`; `purchasable.ts:322`; `storefront-page.ts:265`; embed `route.ts:56-75`; OG `route.ts:84-95`; `sitemap.ts:149-156`) |
| A buyer read still decides without the account | Grep of `TRADER_GATE_SELECT`, `sellerMaySell`, `isTraderIdentityComplete` and `missingTraderIdentity`. The only `TRADER_GATE_SELECT` read is the publish gate's, which reads the account itself (`seller-identity.ts:414-416`). `isTraderIdentityComplete` has no caller. `missingTraderIdentity` feeds only the designer's warning and the status readers. Every buyer page goes through `gatePurchasable`, `gatePurchasableLines` or `buildStorefrontPage` (grep) |
| The paid-order check is skipped, or spams ops | It runs on every paid `checkout.session.completed`, replays included. An unreadable seller fails the event, and Stripe delivers it again. The de-duplication fails open (`rate-limit.ts:659-680`). `alertOps` always writes the log line, even when mail fails (`lib/ops/alert.ts`) |
| Flooding ops mail through Settings saves | `checkAccountMarket` runs only for a charges-enabled account and alerts once a day per account, reason, account country, seller country and charges flag (`account-market.ts:55-74`). That is at most the 29 storable countries plus "none" per day, and `settings_write` allows 60 saves an hour (`rate-limit.ts:293`) |
| Unbounded Stripe calls without a session | Every Stripe call in the connect code sits behind a session and an owner check (`ownerForStripe` and `billing_write` in `payments/connect/actions.ts:49`, `:81-84`, `:129-132`) or a signed webhook. Team members: R2-04 |
| `createStorefront` fails open | A failed gate read returns `server_error`, not `trader_identity_required`, so the storefront starts with its switches off (`storefront/actions.ts:195-200`, `seller-identity.ts:478`, `errors.ts:365-371`) |
| A seller with no country but a foreign charges-enabled account gets switches on | The missing country is a detail, but the foreign account is a market block, and the market comes first (`trader-identity.ts:229-236`). The answer is `market_restricted`, so the storefront starts off |
| "Open Stripe" on a submitted account enables a refused account | If charges get enabled on a foreign account, the read gate counts it and refuses more, not less. No buyer path. (I infer that an Express dashboard cannot itself take a charge) |
| A second Stripe account through a failed read | `ensurePaymentAccount` throws before Stripe is asked when the existing row cannot be read (`payments/connect/account.ts:243-244`) |
| A stale `charges_enabled = false` row while Stripe has enabled the account | Checkout reads the same row (`canTakePayments`), so it cannot charge either, and the gate and SQL agree. The row is the trust anchor by design |
| A test-mode charges-enabled account in a live deployment | The read gate and SQL count it, which is stricter. `canTakePayments` refuses it (`account.ts:157`) |
| A team member acting on the owner's store | Every new gate call uses the store owner's id (`storefront/actions.ts:195`, `agent/tools/products.ts:285`). The Stripe actions are owner only |
| Caches outliving a seller leaving | Only the embed JSON (R1-07). Pages are dynamic, the sitemap is `force-dynamic`, the frame and the preview are `no-store`, and `cache()` lasts one request |
| Other routes | Search, the search snapshot and the product photo route are seller-only and scoped to the active store. The order, lookup, withdraw and download routes are post-sale and show nothing for sale. No email to buyers offers anything (grep). No anon policy, anon view or anon RPC exposes products (`tests/db/prod-migrations.sql`) |
| Collaborations | No collab code exists yet (grep) |
| A seller writing their own rows through PostgREST (no guards yet) | `products.status` and the storefront switches: a buyer sees nothing for any of the three reasons (the read gates above). `seller_payment_accounts`: no grant to any session. `tax_country`: a false "CZ" is the same self-declaration the Settings form accepts. With Connect on, money then still needs a Stripe account in CZ, which Stripe verifies (inferred) |

---

## 3. The coverage test's exemptions

Each R1 "exempt" reason in `tests/unit/market/coverage.test.ts`, checked against
the code.

- **True, verified:**
  - S-01, S-02: sign-up writes no country, and the gate refuses until one is on file.
  - S-04: `saveTaxInfo` writes only the keys sent (`settings/actions.ts:458-466`), and the welcome flow sends three fields (`components/onboarding/WelcomeFlow.tsx:436-477`).
  - S-05: `establishmentCountryOf` reads `tax_country` only (`seller-identity.ts:143-148`).
  - P-09 to P-13 and I-03: none writes `status`, a country, a storefront switch or an account row.
  - P-12: a line in another currency is refused (`quote.ts:273-279`).
  - D-03: an amount code in another currency takes nothing off (`discounts/pricing.ts:39`).
  - SF-05: `rotateEmbedKey` writes `embed_key` only, and delete deletes.
  - C-08: `readCart` only reads (`cart/store.ts:50-69`), and the route still asks `cartGate`.
  - O-03's R2, R3 and R6 cells: by design (P1a 5.5).
- **True, with a note:** A-05. "No code path exists" is true (no deauthorization event is handled, `webhook.ts:48-54`). The effect is that a disconnected account keeps `charges_enabled = true` in our row. For R1 that errs on the strict side, because the gate keeps counting it. Checkout would then try Stripe and fail, which is not R1.
- **Not checkable here:** AD-01 and AD-04 to AD-09 (Admin repo), S-06 and DB-08 (Home), and the SQL bodies of the pg_cron jobs J-01, J-02, J-04 and J-11 (taken from their names and the inventory).
- **No exemption whose reason is false was found.**

---

## 4. What was verified, what is inferred, what was not checked

**Verified by reading the code at ed69649:**
- Everything cited with a file:line above.
- The full diff of the changed source files under `src/` and the three migrations.
- Every caller of the seller gate's read and write sides.
- Every route under `src/app/(public)` and `src/app/api`.
- The cart's currency path end to end, the payments webhook, and the Payments page path.

**Inferred, not proven:**
- That PostgREST returns the one-to-one embed as an object or null. The code also reads an array, and the same pattern serves billing in production today.
- That Stripe always returns `Account.country`, never changes it once the account exists, and that an Express dashboard cannot take a charge.
- That a false "CZ" cannot take Stripe money unless Stripe verifies a CZ account.
- The production facts (Connect off, 0 account rows, cart off): taken from documents, not queried.

**Not checked:**
- Runtime. No test, build, server or browser was run, so nothing here was observed.
- The e2e specs changed in this commit (50, 60, the Stripe stand-in). Playwright cannot run on this machine.
- The Admin, Home and App repositories. In particular, whether any other client of the same Supabase project lists products to the public.
- Whether any non-production database holds charges-enabled rows with a null country (what triggers R2-02).
- The wording of the new messages outside English. I checked only that each new key exists in all ten locales.

---

## 5. Outside R1, tripped over (one line each)

- **Reporting still counts every currency except USD as euros:** `currency <> 'USD'` in the dashboard and analytics functions (`20261117_perf_indexes.sql:300`, `:327`, `:334`, `:370`, `:381`; `20261120_shopping_cart.sql:744`, `:808`, `:852`, `:863`), and the `currency: "EUR"` label on analytics totals (`lib/analytics/queries.ts:212`, `:292`). Planned as branch 08; migration 1's header already says it must not go in before it.
- **A delivery policy saved without `ratesCurrency` is read as EUR, and buyers see it** (`shipping/rates.ts:118`, `:149`; `shipping/policy-prose.ts:122`). The save schema leaves the field optional (`validation/shipping-policy.ts:90`) and the MCP `save_shipping_policy` passes it through as sent, so the comment "A save always writes the field" (`types/shipping-policy.ts:114-117`) is not true today. Branch 06 should require it whenever a rate or a threshold is saved.
- **New products default to EUR:** the column default (`tests/db/prod-migrations.sql:157`) and the product form (`components/products/ProductForm.tsx:261`). R2, branches 05 and 09.
- **A paid checkout from an account whose row is gone is not alerted:** `webhook.ts:152` answers "not one of our accounts" before point 5 of its own contract can apply. Account deletion's buyer holds should prevent the case; not verified.
