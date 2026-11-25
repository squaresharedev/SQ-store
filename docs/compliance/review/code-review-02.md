# Code review 02: fix round 1 (`ed69649`)

Reviewer: independent (did not write the code). Read-only review of `C:\dev\sq-market-review` at `ed69649`, diffed against `7c5d1df` (99 files: 95 changed, 4 added). Nothing was run: no install, type check, test, build or server. Every line reference is at `ed69649`.

## 1. Verdict

**Mergeable after listed fixes.** No blocker and no major finding.

- Fix before merge: G1 and G2. Both are small.
- Run e2e specs 50, 60 and 87 once before merge. By reading, they should pass against this code (section 4), but nobody has run them.
- G3 is a design call for the owner. I recommend the change.
- G4 to G10 are nits that can ride along.

Nothing here touches money. `canTakePayments`, the direct charge and the application fee are unchanged. `type: "express"`, `login_links` and `refund_application_fee` are untouched (checked in the diff and in `src/lib/payments/connect/account.ts:254`, `:309`, `src/lib/orders/actions.ts:482`).

## 2. Findings

| ID | Severity | Finding |
|---|---|---|
| G1 | minor | The Payments page asks Stripe on every render while an enabled account's country is unknown. It does this for any team member and with no rate limit, unlike the return route it copies |
| G2 | minor | The buyer read gate reads a missing account embed as "no account" (fails open), and four of its seven readers have no test that would notice the embed being dropped |
| G3 | minor | `createStorefront` stores every buyer switch off after a failed read. The seller is not told, and the switches stay off, even for a seller the gate would let publish |
| G4 | nit | `updateEmbedSettings` now refuses an "embed off" save over an unparseable config. That breaks its own "never blocked" contract, and the refusal is not needed |
| G5 | nit | On the Payments page, the unknown-country notice tells the seller to open Payments, just after the check on that page failed |
| G6 | nit | The Payments card and the checklist read a failed country read as "no country", and they show a different reason than the publish gate. "Needs attention below says why" can point at nothing |
| G7 | nit | Opening Payments does nothing for `stripe_country_unknown` while Connect is off, but the gate still counts the account |
| G8 | nit | Spec 60's edit changes nothing, and its comment is wrong |
| G9 | nit | Five comments are false or out of date |
| G10 | nit | The coverage test's "drives" check is a substring match, so an import path or a comment passes it |

### G1. The Payments page asks Stripe on every render, for anyone, with no rate limit (minor)

- Where: `src/lib/payments/connect/overview.ts:197-202` calls `syncUnknownAccountCountry` (`src/lib/payments/connect/account-market.ts:113-127`). That calls `refreshPaymentAccount`: a Stripe `GET /accounts/{id}` on the platform key, then a database write. It runs on every render of /payments while the stored account is charges-enabled and has no country.
- What is wrong: the onboarding return route does the same refresh, but only for the owner and only within a rate limit: `src/app/api/payments/connect/return/route.ts:35`, `account.isOwner && stripeConnectLive() && rateLimit("connect_return", RATE_LIMITS.billingRead)`. Its own comment says why: "a reloaded or scripted return is bounded". The new path has neither guard. Any team member who can open /payments triggers it, because the page checks no permission (`src/app/(dashboard)/payments/page.tsx`). Every reload repeats it for as long as Stripe gives back no usable country or cannot be reached.
- Concrete case: Stripe no longer lets the platform read an account (deauthorisation is not handled, path A-05), and its row is charges-enabled with no country. Every load of /payments, by any member, calls Stripe, fails, logs the error, and the next load calls again. A script that reloads the page uses up the platform key's Stripe request budget. Unconfirmed: whether that budget is shared with every seller's checkout calls. This cannot happen today: there are 0 such rows in production, and every account made since migration 3a stores its country when it is created.
- Fix: sync only for the owner, and take from the same `connect_return` budget (or a `max: 1` per hour budget keyed on the account). A member's visit, or a visit over the budget, shows the stored state.
- Test: in `tests/unit/market/payments-status.test.ts`, the owner's first visit syncs; a member's visit, and a second visit in the same window, do not.

### G2. A missing account embed counts as "no account", and most readers are untested for it (minor)

- Where: `src/lib/settings/seller-identity.ts:126-130` (`readGateAccount`). `embedded ?? null` treats a row with no `seller_payment_accounts` key the same as a row with no account. Every read caller casts (`as ReadGateRow`), so the type system does not catch a select string that lacks the embed.
- What is wrong: the account half of the read gate depends on every select string being right. Suppose a reader selects `TRADER_GATE_SELECT` instead of `READ_GATE_SELECT`. That constant is still exported and still used by the publish gate (`:415`). The code compiles, and a seller whose Stripe account is foreign or of unknown country is let through. That is failing open.
- Which tests would notice: a dropped embed would be caught for the purchasable gate, through `tests/unit/product-add-ons.test.ts`, whose fake database joins only the tables the select names (`tests/setup/fake-admin.ts:123-127`). It would also be caught for the embed JSON route, through `tests/unit/market/seller-gate-reads.test.ts`, which checks the select string. Nothing would catch it for:
  - `buildStorefrontPage`, which serves the hosted storefront and the embed frame (`src/lib/storefront/storefront-page.ts:248`)
  - the share image (`src/app/api/og/p/[productId]/route.ts:84`)
  - the sitemap (`src/lib/seo/sitemap.ts:149`)
  - the two assistant previews

  `sitemap.test.ts`, `embed-frame-loader.test.ts` and `og-image-route.test.ts` never set up a `seller_payment_accounts` row.
- Fix: make a missing key refuse. For example, return "may not sell" when `!("seller_payment_accounts" in row)`. Then add one test that checks the select string of every caller of `sellerMaySell` and `sellerGateNotes` for `READ_GATE_SELECT`. The coverage test's `functionBody` helper already does this kind of check. Test fakes that do not model the embed will then fail, which is the point.
- Test: a complete profile row without the key gives `sellerMaySell(...) === false`, and the select check fails when one reader is switched back to `TRADER_GATE_SELECT`.

### G3. A failed read stores a new storefront with its buyer switches off (minor; owner's call)

- Where: `src/lib/storefront/actions.ts:195-200`. When the profile or account read fails, `publishBlockedError` answers `server_error`. `startsOff` is true for every refusal except `trader_identity_required`. So after a failed read, the new storefront is stored with product pages, cart and embed all off.
- What is wrong: a momentary read failure becomes a lasting state, and the seller is not told. The create succeeds, the seller lands in the designer, and the pages stay off until the seller notices and switches them on. Every other write behind this gate answers a failed read with a "try again" refusal and writes nothing. This one quietly writes a different storefront. The orchestrator chose this on purpose ("or who cannot be read", COMPLIANCE_PROGRESS), which is why this is the owner's call.
- Concrete case: a seller in the market, with complete details, creates their first storefront while the account read fails for a moment. The storefront has its product pages off, so buyers can open none of its pages, and nothing on screen says why.
- Fix: when the answer is `server_error`, return the failure and write nothing, as `saveStorefront` does. Store the switches off only for a market refusal.
- Test: in `seller-gate-write-paths.test.ts`, the case "one whose details cannot be read" should expect `{ ok: false, error: { code: "server_error" } }` and `state.inserted === null`.

### G4. Turning the embed off can now be refused (nit)

- Where: the comment at `src/lib/storefront/actions.ts:526-530` says that turning the embed OFF "is never blocked", and that "a seller must always be able to pull a storefront back". The new code at `:554-560` asks the gate before an off-save over a stored config that no longer parses, so a refused seller is refused.
- What is wrong: the comment is now false, and the refusal is not needed. The gate is asked only because the rewrite falls back to `DEFAULT_STOREFRONT_CONFIG`, which has product pages and the cart on. That comment also contains an em dash. The dash was there before this commit, but the comment needs rewriting anyway.
- Fix: when `stored` is null, rewrite from `withBuyerSwitchesOff(DEFAULT_STOREFRONT_CONFIG)`. The off-save then switches nothing on, needs no gate, and the comment becomes true again.
- Test: the write-path case "SF-04 updateEmbedSettings (off) over a stored config that no longer parses" would expect success with every switch off.

### G5. The unknown-country notice on the Payments page links to the same page (nit)

- Where: `src/components/payments/ConnectionStatusCard.tsx:58`, `:150`; `src/lib/errors.ts:285-287` sets the action to `PAYMENTS_PATH`; the fix text is "Open Payments and we'll check with Stripe" (`Errors.marketRestricted.stripeCountryUnknown.fix`).
- What is wrong: the card shows `stripe_country_unknown` only after `realPaymentsOverview` has just asked Stripe and got no country, or could not reach it. The notice then tells the seller to open the page they are already on, and links to it. Clicking works as a retry, but the message reads as a loop.
- Fix: on the Payments card, show the message without the link, or with one line such as "We could not reach Stripe just now. Reload this page to try again." Keep the Payments link everywhere else.

### G6. The Payments card and checklist explain a pause differently from the publish gate (nit)

There are three small problems on the same path. They involve `src/lib/payments/connect/overview.ts:88-90`, `:96-98`; `getEstablishmentCountry` (`src/lib/settings/seller-identity.ts:185-188`), which answers a failed read as null; and `src/lib/dashboard/attention.ts:267`.

1. A failed profile read makes `sellBlock` `seller_country_missing`. The Payments card then tells a seller who has a country on file to choose one (`traderIdentityRequired(["country"])`), and the checklist says paused. Failing closed is right; the words are wrong.
2. `statusOf` takes the first block from `sellerSellBlock`, which puts `seller_country_missing` before the account blocks. `sellerGateReasons` (the publish gate, Needs attention) puts the market block first. So for a seller with no country and a foreign account, the card says "choose your country" while Needs attention says the Stripe account does not match. Choosing a country fixes nothing.
3. In that same state, while the checklist is shown, the payments step says "Needs attention below says why". But the Needs attention row for a missing country is hidden while the checklist is shown (`attention.ts:267`). The seller-details step does explain it.

- Fix: in `statusOf`, choose the block the way `sellerGateReasons` does (market blocks first). Use `readEstablishmentCountry` so a failed read gives `takesPayments: false` and `sellBlock: null`.
- Test: in `payments-status.test.ts`, a failed country read gives `sellBlock: null`, and no country plus a foreign account gives `stripe_country_not_allowed`.

### G7. Opening Payments does nothing while Connect is off (nit)

`src/lib/payments/connect/overview.ts:195` returns the empty overview before the sync whenever `stripeConnectLive()` is false. But `sellerGateAccount` (`src/lib/payments/connect/account.ts:167-169`) and the embedded read still count a charges-enabled row. Take a dev or staging database with an enabled row from before migration 3a, with Connect switched off. Publishing is refused with "open Payments", but Payments shows "not connected" and asks Stripe nothing. This cannot happen in production today (Connect off, 0 rows). Fix: either sync whenever the server holds the Stripe key, or provide the one-off backfill script the first review suggested.

### G8. Spec 60's edit changes nothing (nit)

`tests/e2e/60-onboarding.spec.ts:87-90` adds `country: MARKET_SELLER_COUNTRY` to `seedSellerIdentity`. The helper already sets that country when the key is absent: `tests/e2e/helpers.ts:549`, `"country" in seller ? ... : MARKET_SELLER_COUNTRY`, and that line was already there at `7c5d1df`. So the edit does nothing, and the comment "without it the seller step could not complete" is wrong. It is harmless: fix the comment or drop the edit. It does mean spec 60 never needed this change for R1.

### G9. False or out-of-date comments (nit)

- `src/lib/market/problems.ts:48` points at `lib/payments/connect/account.ts syncUnknownAccountCountry`. That function lives in `account-market.ts`.
- `scripts/lib/prod-schema.ts:227-229` says a missing `country` column makes "payments and publishing fail closed". Since this commit, every buyer page also answers 404. The migration header says so; this comment does not.
- `src/lib/payments/connect/account-market.ts:86`, `webhook.ts:229` and the commit message say ops are told "once per order". It is actually once per order per 24 hours (`RATE_LIMITS.opsAlertDedupe`, `src/lib/rate-limit.ts:316`). A delivery that keeps being retried for more than a day, for example while the fee cannot be read, alerts again. Either say "once a day per order", or key the alert so it never repeats.
- `src/lib/errors.ts:269`: "No country is spliced into the sentences" is still misleading while five message keys name the country (F6, deferred).
- The `updateEmbedSettings` comment in G4.

### G10. The coverage test's "drives" check is a substring match (nit)

`tests/unit/market/coverage.test.ts:527` only checks that the test file contains the entry point's name. An import path or a comment passes that check. Cells that also have a `source` check of the function body are well protected. The four without one (S-03 `saveTaxInfo`, AD-02 and AD-03 `getPublicProductPage`, DB-01 `establishmentCountryOf`) rest on the name alone. The commit message's wording ("names the entry point") is accurate, so this is a nit. Optional fix: require the name followed by `(`, or add a `source` check to those four cells.

## 3. First-review findings

| Finding | Status at `ed69649` |
|---|---|
| F1 | Out of scope (branch 08) |
| F2 | Fixed in code, never run. The test Stripe server now stores the `country` it is sent and answers it on GET. Spec 87's onboarding path now ends with `canTakePayments` true: the account country and the seller's country are the same, and both sides are in test mode. Spec 50 matches the new copy. Spec 30 needs no change, because it seeds the market country. Spec 60's edit does nothing (G8) |
| F3 | Fixed: `stripe_country_unknown` has its own reason, copy and Needs attention row, and opening Payments asks Stripe again. Leftovers: G1, G5, G7 |
| F4 | Fixed: `ensurePaymentAccount` throws on a failed read before calling Stripe. Tested, including the Connect action answering `server_error` |
| F5 | Fixed: `takesPayments` comes from `canTakePayments`, plus `sellBlock`, the "paused" checklist state, and `accountIsInOrder`. Tested. Leftover: G6 |
| F6 | Deferred. Listed in PLAN section 8 with the keys; the guard test comes with the copy branch. The reason holds as an owner decision. Still open: the `errors.ts:269` comment, and English copy that says "Czech Republic" next to a picker that says "Czechia" |
| F7 | Fixed: the body check of each source function was added; S-04 is now exempt with a reason; C-07 and A-02 now cite tests that drive those paths. Leftover: G10 |
| F8 | Fixed: the quote test asserts `not_found`; there are write-path tests for a foreign account, an unknown-country account and a failed read; `switchesOnForBuyers` and `withBuyerSwitchesOff` are tested directly; `get_store` is tested. The welcome-flow gap moved to N8 |
| F9 | Fixed: each currency's cap is in the schema description (`SHIPPING_RATE_CAPS_DESCRIPTION`). Tested through `z.toJSONSchema` |
| F10 | Fixed: migration 1's header now says "only after 341ab30, 3ef733f straight after", in the file and in the replay |
| F11 | Deferred. The reason holds: no cost while Connect is off. Note: the progress file calls it "one extra account read", but F11 was about extra profile reads. Since the gate row now carries both `tax_country` and the account, the checkout branch can take both from it |
| F12 | Fixed: one alert a day per account and set of facts; `created` is true only when an account was really created; paid-order alerts are keyed per order. Tested |
| N1 | Fixed |
| N2 | Fixed: `SELLER_IDENTITY_SELECT` is now built from `ESTABLISHMENT_COUNTRY_SELECT` |
| N3 | Fixed: renamed to `FIX_SENTENCE_FIELDS` |
| N4 | Fixed: `OUTSIDE_MARKET_WORDS` and `OUTSIDE_MARKET_ADVICE` are shared |
| N5 | Fixed: the field is labelled "Country of establishment", and the step says so when the country is the only thing missing. When the country and the email confirmation are both missing, the step still shows the generic three-field sentence; its link does land on the country |
| N6 | Deferred to the shipping branch. The reason holds (wording only), as long as that branch ships before Czech sellers set delivery rates |
| N7 | No reason recorded anywhere (it is not in the progress file's list of open items). Branch 08 is what makes compact CZK figures visible, so it should take this |
| N8 | Deferred to the UI branch (09), and recorded in the progress file and in the coverage cell for S-04. The reason holds. The regression remains until then: a seller who completes the welcome flow cannot publish until they choose a country in Settings |
| N9 | Fixed: `buildSellerIdentity` reads the country through `establishmentCountryOf` |

## 4. What I verified and found correct

- **Webhook.** `checkPaidOrderSeller` runs after `confirmPendingOrder` and before `settleOrderFees` (`webhook.ts:225-235`). A failed seller read throws, so the delivery answers 500 and is retried. A retry repeats no side effect: `order_confirm_paid` changes nothing on an order that is already paid, and `announceOrder` emails only while `seller_notified_at` is unset (`src/lib/orders/record.ts:613`). No side effect is lost: the next delivery runs the check and the fee again. `alertOps` never throws. The alert writes nothing to the order. The dedupe key is taken before the alert; that is safe because `alertOps` cannot fail in a way that leaves the alert unsent and unlogged. Tested (`connect-country.test.ts`).
- **Dedupe.** `rl_take_key` (`tests/db/prod-migrations.sql:1733-1794`) is a sliding window that stores only allowed hits, takes a row lock (`for update`), and is garbage-collected after a day without updates. That matches "once a day per set of facts". The key is hashed. The limiter fails open, which is right here because it is never a guard.
- **Read gate.**
  - All seven buyer readers select `READ_GATE_SELECT`: the purchasable gate (product page, checkout, cart, quote), `buildStorefrontPage` (hosted storefront, embed frame), the embed JSON, the share image, the sitemap, and both previews.
  - `seller_payment_accounts.owner_id` is the primary key and references `profiles(id)` (`20261008_seller_payment_accounts.sql:34`). No other table references the payment accounts table, so PostgREST sees one one-to-one relationship and no ambiguity. Both object and array answers are handled.
  - `charges_enabled === true` is the same rule as `sellerGateAccount` and SQL's `a.charges_enabled`. A missing country is refused on all three sides.
  - No raw gate row reaches a page: `buildSellerIdentity` copies fields one by one.
  - A failed read refuses everywhere.
- **Agreement.** The ten-case matrix is checked against the buyer read and the publish gate in the unit project, and against `seller_sell_block` in the db project. The db run is a superuser, which the wide-market case needs, because `market_rules` grants only `select` to `service_role`. The publish gate puts the market reason before missing details, so `createStorefront`'s market-only rule is right for a seller who has both problems.
- **createStorefront.** `withBuyerSwitchesOff` covers all three entries in `BUYER_SWITCHES` and keeps the rest of the design.
- **Stripe actions.**
  - `openStripeDashboard` does not resume onboarding for a seller the market refuses; a finished account still gets its dashboard. Tested.
  - `onboardingRefusal` is shared by onboarding and the dashboard link. An account whose country is unknown can still be onboarded; the return route records the country, and that route's call to `checkAccountMarket` is now driven by a test.
  - `publish_products` asks the gate once per batch for products that are already active, and a refused item carries no `pageUrl`.
- **Status surfaces.** `getSellerGateStatus` returns `{ ok: false }` on a failed account read, and `get_store` then reports `canSell: null`. The `paymentsSetupState` rules are correct, including a simulated account that has no `takesPayments`.
- **Migrations.** Only header comments changed. All three files appear word for word in `tests/db/prod-migrations.sql`, and all are ASCII. The schema sentinels name `seller_payment_accounts.country` and check that the `seller_sell_block` body contains `'account_country'`. The deploy order (migration 3a before this code) is stated in the migration header and in the progress file.
- **Catalogues.** All ten locales have identical key sets in the four changed files. The new strings use the exact names that each locale's navigation and dashboard give the Payments page and the Needs attention section (for example "Platby" and "Vyžaduje pozornost" in Czech). The Czech strings are grammatical and say the same as the English. One could read more naturally: "Proč, uvidíte níže v části Vyžaduje pozornost." could be "Důvod najdete níže v části Vyžaduje pozornost." The new copy makes no legal claim. The removed `Settings.tax.fields.country.label` is not referenced anywhere.
- **Client message scopes.** `Errors` and `Settings.sellerDetails.fields` ship in the dashboard chrome, so the Payments card can show the refusal. `Onboarding.steps` ships with the overview.
- **Repo rules.** No em or en dash in any added line, no line-ending flips in any of the 99 files, and no country or currency literal in added code.
- **e2e, by reading only.**
  - Spec 50's new assertions match the copy: the "complete" sentence while the country is missing, and the three-field sentence once it is seeded.
  - `#tax_country` is the id of the `Select` button.
  - The option label and `MARKET_SELLER_COUNTRY_NAME` both come from English `Intl` region names.
  - `/settings/tax` redirects to `/settings/business`.
  - The phone is now typed in international form, which no longer depends on the seller's country.
  - The test Stripe server stores and returns the country.
- **Coverage test.** `functionBody` finds the right start and end for each function it checks (verified for `pageConfigRoute` and `placeOrderResponse`), and every name it cites exists.

## 5. Could not check

- Type check, unit, component, db and e2e runs. The orchestrator reports them green except e2e; I ran nothing.
- PostgREST's real answer to the embed. No test sends `READ_GATE_SELECT` through PostgREST: the db tests use `pg` directly and the e2e tests were not run. The code handles both an object and an array, but a PostgREST error would close every buyer page. One call against the replica's PostgREST, or spec 50's buyer-page step, would settle it.
- Whether Stripe counts platform calls such as `GET /accounts/{id}` against the same rate limit as checkout calls (this is the impact behind G1).
- Real Stripe behaviour: that `Account.country` is always present when an account is created and when it is read.
