# Compliance progress: Czech-only beta and payments

Running log for the workstream that came out of Adrian's payments and legal
compliance handoff (Nov 2026). It is the shared memory for every agent working
on it: read it before starting, add to it when something is decided or found.

Teamster task: `6GvUkTMgTgijMQgkk0yx` ("Czech-only beta and payments
compliance", SQ dashboard).

Not legal advice. Legal texts produced here are DRAFTS for lawyer review.

## Guardrails (apply to every agent)

- Stripe test mode only. Never a live key.
- No production data changes and no production deploy without Adrian's
  explicit OK. Read-only SELECTs for the existing-data report are allowed.
- No destructive migrations. Existing sellers, products and orders that break
  the rules are reported, never deleted or disabled.
- Stop for Adrian's approval before anything that changes money flow, charge
  type, connected-account type, a schema with existing data, or that deletes or
  disables existing sellers.
- Hard principle: Square Share never holds sellers' money.
- The Store working tree is shared with other live sessions: never `git stash`,
  never `git add` a file you did not write, build in a worktree, one Playwright
  run at a time, no second dev server.
- No scattered `"CZ"` / `"CZK"` literals: values come from the one market
  config module.

## The rules being enforced (Czech-only beta)

| # | Rule |
|---|---|
| R1 | Seller established in CZ: Stripe connected account country and business address country |
| R2 | Products and prices in CZK only |
| R3 | Delivery only to CZ addresses (physical goods), re-validated on the server before the order or payment is created |
| R4 | Buyer billing country CZ for digital goods and services; card country logged, never blocked on alone |
| R5 | Collab checkout: every participating seller passes R1 to R3 |
| R6 | No checkout without passing all rules, enforced on the server at checkout time |
| R7 | Public messaging on homepage, pricing, sign-up, seller terms, embed and checkout, docs |
| R8 | Expansion waitlist for non-CZ sellers (email + country) |

## Second build: universal seller onboarding data (1B, added 2026-11-22)

Added by the owner's addendum, to be built alongside the Czech-only beta.

- One universal form for every seller, in every country. Fields vary only by
  seller type (individual or company) and "only if applicable". Country changes
  only the validation formats. Adding a country means adding a validator.
- Stripe does identity checks. We never collect or store ID scans or
  beneficial owners.
- Drafts are allowed before onboarding is complete. Publishing and checkout
  stay blocked until required fields are complete and verified, the sanctions
  screen is clear, and the Stripe account has `charges_enabled`.
- Covers: identity (seller type, trader status, legal names, date of birth,
  representative), structured addresses, tax residence, tax IDs, VAT ID (VIES),
  business registration (ARES), payout account identifier, declarations as
  versioned records, a verification log, sanctions screening, change history,
  product-level product-safety fields, a public "Seller info" block, field-level
  encryption, retention jobs, self-service export, threshold counters, the
  DAC7 non-cooperation flow, and a "complete your profile" flow for existing
  sellers.
- It supersedes the short "seller data to collect" list in the DAC7 section of
  the handoff, and the `seller_tax_profiles` sketch in audit D.
- The owner decides `ALLOW_PRIVATE_SELLERS`. The private-seller notice text
  comes from the lawyer. Exact Czech identifier formats are to be verified with
  the tax adviser.

Seams agreed with the Czech-only designs: the seller's country of establishment
is read through one accessor (TypeScript) and one SQL helper, so its source can
move from `profiles.tax_country` to the structured address; the seller gate
keeps "market not allowed" as its own reason so the completion gate can add
more; the sign-up country question is step one of the universal form.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 | Map every write path (9 mappers, read-only) | done 2026-11-22 |
| 1 | Audit swarm A to G (read-only) | A, B, C, D, F done; E (merged inventory, Czech-only gap analysis) and G (seller onboarding data) running |
| 2 | Gap report and plan, sent to Adrian | gap report consolidated; three Czech-only design agents running; 1B design starts when audit G lands |
| 3 | Build (worktrees, server side first) | not started |
| 4 | Adversarial review (bypass hunt, code review) | not started |
| 5 | Verify in Stripe test mode, final report | not started |

## Where the detail lives

Reports are under `docs/compliance/` in this repo.

| File | Content |
|---|---|
| `inventory/01-store-sellers-accounts.md` | Store: sellers, trader identity, connected accounts, plans, publish gates |
| `inventory/02-store-catalog.md` | Store: products, prices, currencies, import, discounts, storefronts |
| `inventory/03-store-selling.md` | Store: shipping, checkout, cart, orders, refunds, embed |
| `inventory/04-store-entry-points.md` | Store: every MCP tool, route, server action, cron job |
| `inventory/05-database-layer.md` | All repos: columns, RLS direct writes, RPCs, triggers, draft violation queries |
| `inventory/06-admin.md` | Admin repo |
| `inventory/07-app.md` | App repo (marketplace) |
| `inventory/08-public-messaging.md` | Home, Docs, Store copy: R7 surfaces, waitlist, Czech coverage |
| `inventory/09-shared-packages.md` | SQ-system packages and every existing country or currency constant |
| `audit/A-stripe-config-money-flow.md` | Connected-account configuration, charge type, money flow |
| `audit/B-moderation-dsa.md` | Moderation checklist and DSA |
| `audit/C-seller-terms-p2b.md` | Seller terms, P2B, fee disclosure |
| `audit/D-dac7-readiness.md` | DAC7 data readiness |
| `audit/F-refunds-application-fees.md` | Refund paths and the application fee |
| `audit/E-czech-only-gap-analysis.md` | R1 to R8 against the inventory, bypass catalogue (in progress) |
| `audit/G-seller-onboarding-data.md` | Seller onboarding data: model, verification, display, security, retention (in progress) |
| `WRITE_PATH_INVENTORY.md` | The merged inventory with stable path ids (in progress) |
| `GAP_REPORT.md` | Consolidated gap report for Adrian (audits A, B, C, D, F done; sections 0 and 0b to be added) |
| `plan/P1a-app-enforcement-design.md` | Market config module, validators, CZK, seller gate, checkout (in progress) |
| `plan/P1b-database-guards-design.md` | Config mirror, guards, additive columns, monitoring (in progress) |
| `plan/P2-messaging-waitlist-czech-design.md` | R7 copy, R8 waitlist and sign-up step, Czech legal texts (in progress) |

The existing-data violation report names seller accounts, so its row-level
part is delivered to Adrian directly and is not written into the repo. The
counts are below.

## Decisions

- 2026-11-22: reports and this log live in the Store repo because Store is the
  only repo that enforces at checkout; other repos are referenced by path.
- 2026-11-22: all subagents run on Opus (user's instruction); the orchestrator
  is the only writer of this file during the read-only phases.

## Findings (Phase 0 and 1, confirmed against code)

Conflicts with the locked decisions:

- **Connected accounts are created as Express** (`type: "express"`, no
  `controller`, country only if the seller set one):
  `src/lib/payments/connect/account.ts:153-164`. Express makes the platform
  liable for sellers' negative balances. Charges themselves are correct: direct
  charges with `application_fee_amount`; nothing creates transfers, payouts or
  top-ups. Fix is gated on Adrian's approval (account type).
- **Every refund returns the application fee**: the one Stripe refund call
  hard-codes `refund_application_fee: true` (`src/lib/orders/actions.ts:482`).
  The Docs pricing page says "A refund returns it" in English and Czech. Fix is
  gated on Adrian's approval (money flow).

Czech-only rules, state today:

- R1: seller country is one optional field, `profiles.tax_country`, writable
  directly through PostgREST with any two capital letters. The business address
  is free text with no country. Country is not part of the publish or sell gate.
  Stripe's account country is never stored or re-checked.
- R2: CZK is not accepted anywhere. `CURRENCIES = ["EUR","USD"]`
  (`src/types/product.ts:12`), three database CHECKs say the same, and
  `toCurrency` silently turns any other value into EUR, which is what Stripe
  would be charged in. Products and discounts are also writable directly
  through PostgREST.
- R3: one server check against a hard-coded list (EU 27 + US + CA), then the
  seller's own shipping rows. The database checks nothing.
- R4: nothing exists. No billing address or card country is collected or stored.
- R5: no collab checkout exists. Nothing in SQL stops an order line naming
  another seller's product.
- R6: there is ONE order pipeline (two checkout routes, `placeOrderResponse`,
  `quoteOrder`, the provider, `order_place`), so a single choke point is real.
  The demo sales simulator is the only other order writer.
- R7: every public surface says "EU, USA and Canada".
- R8: no country at sign-up, no block, and `waitlist_signups` has no country.

Hazards for the build:

- Narrowing the storable lists (`SHIPPING_COUNTRY_CODES`, `OPERATING_COUNTRIES`,
  `CURRENCIES`) blanks stored shipping policies and mis-reads stored prices. The
  market rule must sit beside those lists, never replace them.
- A database guard that fires on every update of an old row would roll back
  multi-row sweeps (expired orders, moderation). Guards must be insert-only,
  column-scoped or transition-scoped, and must bind the service role.
- `order_place` may only be redefined from the 20261120 cart version, which is
  not in production. Prefer triggers.
- No TypeScript module is shared by all repos at build time. The config root
  lives in Store, with a SQL mirror and a drift test.

Other gaps (detail in the audits):

- No per-seller freeze: a ban blocks sign-in only, listings and checkout stay live.
- Moderation on create and edit is a database trigger no path can skip (good,
  and the model for the market guards). Reporters get no receipt or decision.
  Nothing exists for DSA Art. 18. Statements of reasons have holes.
- Publishing does not check that the seller agreed to the Terms.
- DAC7: money totals are derivable, seller identity data is almost all missing,
  and account deletion cascades away everything a 10-year record needs.
- Admin revenue and analytics assume EUR.

## Production facts (read-only queries, 2026-11-22)

- Stripe Connect is off. 0 connected accounts, 0 fee ledger rows, 0 paid
  plans, every billing switch off. All 1,239 orders have no payment reference:
  seeded or simulator rows. No real payment has ever been taken.
- 15 profiles: country CZ x2, IE x1, unset x12. Four accounts own a product,
  storefront or order, and all look internal or test.
- 22 products, all EUR, 16 live. No amount discounts.
- The demo sales simulator (`demo-sales-sim`, pg_cron, every 20 minutes) is
  ENABLED and writes EUR orders with EU addresses: 584 of its orders name a
  country other than CZ.
- `public.carts` does not exist (20261120 is not applied).
- Terms accepted on profiles: none x11, tos-2026-10-11 x2, tos-2026-11-06 x2.

Violation counts if the rules applied today: R1 one seller with a non-CZ
country and one with none; R2 all 22 products (CZK cannot be stored yet); R3
one seller with free-text destinations ("EU", "USA") and the simulator's
orders; R4 not measurable (no column); R5 zero.

## Verification limits on this machine

- Vitest `unit` and `db` projects run locally; run targeted files only.
- Playwright e2e cannot run locally (application control blocks the PostgREST
  binary). It runs on GitHub when a `ci/**` branch is pushed, which needs the
  owner's OK and a working GitHub sign-in (expired as of 2026-11-21).
- The dev server on :3000 serves the shared tree against production Supabase,
  so it cannot exercise worktree branches or unapplied migrations.

## Sent to Adrian (Phase 2)

- Summary document (a Claude Docs document, private until the owner shares
  it): https://claude.ai/artifact/K3iBYs3VxfKBts472eECSC
- `docs/compliance/GAP_REPORT.md` and `docs/compliance/PLAN.md`.
- Decision tasks on the SQ dashboard:
  - `TMW7SrvFnh565yqPxam2` Approve the Stripe account type and refund fee changes
  - `lnb19oWqzzVIVpjEa9ow` Decide the Czech-only beta rollout items
  - `27kg2NZgtLRocov4oqep` Decide the seller onboarding data choices
  - `DgglGEV2sabJUoSudd6c` Decide the moderation, mail and Terms items
- Existing tasks updated with what the audit found: Stripe Connect go-live
  (`nhZ0bgIEYlSzSvRcmytW`: do not enable Express), the accountant
  (`MtGvS02L8bQxScBoleha`), the lawyer (`m8WAKG16qImTHjV50aMx`), the GitHub
  sign-in (`dYjTNwW9Z26DXOJxFRLh`).

## How the approval gate is being read

- The two money-flow changes (connected account type, the refund fee flag):
  no code is written until Adrian answers.
- Everything else in 1A and 1B: built on local branches only. Nothing is
  merged, pushed, deployed or applied to any database. Every migration, every
  change to who can sell, and every deploy waits for Adrian.
- Design defaults are chosen so the build is not blocked; each is listed in
  `PLAN.md` section 3 and in the decision tasks, and is cheap to reverse before
  its branch is built.

## Design choices made where the designs disagreed

See `PLAN.md` section 3. In short: a non-CZ country is stored truthfully and
only selling is refused (no guard on the country value itself); the waitlist
row for a blocked sign-up is written by Store; legacy-currency products are
hidden from buyer pages; the `"*"` delivery row means "everywhere the market
allows"; R4 covers downloads only; a third evidence column holds Stripe's own
billing country.

## Branches and worktrees

| Branch | Worktree | State |
|---|---|---|
| `market/01-strict-currency` | `C:\dev\sq-market` | Done, reviewed, committed locally as `341ab30` (29 files, +150/-92). `toCurrency` is gone; `parseCurrency` and `storedCurrency` in `src/lib/market/currencies.ts`; unparseable currencies are dropped at the three buyer gates. Verified: no `toCurrency` reference left, `tsc` clean, ESLint clean, 31 test files (599 tests) green, line endings preserved. Not verified: no browser run (the dev server serves the shared tree), no e2e |
| `market/02-czk-storable` | `C:\dev\sq-market` (stacked on 01) | Done, reviewed, committed locally as `3ef733f` (26 files changed, 3 added). Migration `20261122_market_1_czk_currency.sql` (a file, a pending replay block and four deploy sentinels; applied nowhere), `CURRENCIES` is EUR, USD, CZK (storable), per-currency minimum charge and delivery cap in `src/lib/market/currencies.ts`, `LEGACY_RATES_CURRENCY`, the Czech CSV price notation. Verified: `tsc` clean, ESLint clean, unit tests green (18 files, 332 tests by the agent; 3 files, 80 tests re-run by the orchestrator), db tests green (`51-czk-currency`, `50-prod-schema-probe`: 9 tests, re-run by the orchestrator), line endings preserved, migration ASCII. A read-only production query confirmed the three currency CHECKs have the names the migration expects and that orders has none. Not verified: the price field's third currency button and the shipping settings were never seen in a browser. Not done: the order-level minimum at checkout (needs buyer copy; goes with the checkout branch) |
| `market/03-market-root` | `C:\dev\sq-market` (stacked on 02) | Done, reviewed, committed locally as `c71a3ca` (7 files changed, 12 added). `MARKET` in `src/lib/market/market.ts` (frozen, typed as a subset of the storable lists, no environment read), pure validators in `src/lib/market/problems.ts`, `establishmentCountryOf`, migration `20261122_market_2_rules_mirror.sql` (the one-row `market_rules` mirror and the helpers `market_allows`, `market_seller_country`, `seller_sell_block`, `seller_may_sell`; a file, a pending replay block and sentinels), drift tests, an expansion test (SK seller with EUR passes under a widened market with no code change), and a coverage test listing all 94 rule-relevant write paths as pending. Wires nothing: no behaviour change. Verified: `tsc` clean, ESLint clean, unit tests green (9 files, 90 tests, re-run by the orchestrator), db tests green (4 files, 29 tests, re-run by the orchestrator). Left out on purpose: copy helpers and the error factory (need message keys), the column defaults for `products.currency` and `orders.currency` (they break about 67 fixtures and belong with the guards) |
| `market/04-seller-gate` | `C:\dev\sq-market` (stacked on 03) | Done, reviewed, committed locally as `7c5d1df` (92 files changed, 9 added, +1658/-260). One gate, `sellerGateReasons` in `src/lib/settings/trader-identity.ts`, with named reasons (`market`, `details_missing`; the country of establishment is now a required detail). Runs at every publish write and buyer read; the embed API, the share image and the two assistant previews were moved onto it; storefront and page saves run it when a save switches product pages, the cart or the embed on. Stripe: account created in the seller's country and only in an allowed one, Stripe's country stored on creation, onboarding return and `account.updated`, `canTakePayments` needs it allowed and matching. The account type (`express`) and login links are untouched; the creation idempotency key is v2. Migration `20261122_market_3a_account_country.sql` (the country column and the `account_country` reason in `seller_sell_block`). Copy in ten locales (18 new keys, 2 edited). No country lock: a country outside the market saves, and selling pauses. Verified by the orchestrator: `tsc` clean, 26 unit files (416 tests), 2 component files (49 tests), 5 db files (42 tests), no line-ending flips, no dashes, no market literal in code. Not verified: no browser run, no e2e. Known: e2e specs 30, 50 and 60 fill Settings without a country and are expected to fail until they are updated (with the UI branch or the e2e branch, before any `ci/**` push) |
| fix round 1 | `C:\dev\sq-market` (on `market/04-seller-gate`) | Done, reviewed, committed locally as `ed69649` (95 files changed, 4 added). Answers review round 1, listed below. Verified by the orchestrator: `tsc` clean, ESLint clean on every changed file, 50 unit files (950 tests), 2 component files (13 tests), 6 db files (68 tests), no line-ending flips, no dashes, migrations ASCII, the 3a replay block identical to its file, the account type, login links and the refund flag untouched. Not verified: no browser run; e2e specs 50, 60 and the test Stripe server were edited and never run |
| `market/08-czk-reporting` | `C:\dev\sq-market` (stacked on fix round 1) | Done, reviewed, committed locally as `0b93f0e` (35 files changed, 5 added). Migration `20261122_market_8_reporting_currency.sql`: one shared resolver `reporting_currency(seller, currency)` and a new overload of each of the five per-seller reporting functions with a trailing `p_currency` and no default; null means the store's reporting currency (its most recent sale's, else the market default); every payload names its `currency` and the `other_currencies` it leaves out. The old overloads are untouched. Overview, Analytics, product cards, the ranking and the assistant's tools read the currency from the payload; one line on Overview and Analytics names sales in other currencies (ten locales); chart axes follow the tooltips (`CZK 1.2k`, `1,2 tis. Kč`); the plan calculator shows no sales-based figure for a store that sells outside the billing currency. Verified by the orchestrator: each new SQL body diffed against the one it was built from (only the currency filter, the two payload keys and the removed defaults differ), `tsc` clean, ESLint clean, 35 unit files (633 tests), 6 db files (74 tests, including the old overloads still adding the two currencies together and anon unable to execute), replay block identical, no line-ending flips, no dashes. Not verified: no browser run; e2e spec 29 and its helper were edited and never run; PostgREST choosing the overload by argument names is inferred (the db tests call SQL directly) |
| `market/04-review-round-2` | `C:\dev\sq-market` (stacked on 08) | Done, reviewed, committed locally as `20cd9c1` (79 files changed, 2 added; no SQL). Answers both reports of review round 2. A seller row read without the connected account refuses; a source scan checks every buyer reader selects it. Each cart line carries its own currency and the cart shows no amount when it has none; a source scan keeps literal currency fallbacks out of `src` (four form defaults on a named pending list for branch 05). The Stripe re-sync on Payments is owner-only and rate-limited. Creating a storefront when the seller cannot be read answers "try again"; the switches are stored off only for a market refusal. Turning the embed off is never refused. An unknown Stripe country has a true way out in each place (reload on the Payments card, Payments while Connect is on, support while it is off). Seven new message keys in ten locales. Verified by the orchestrator: `tsc` clean, ESLint clean, 142 unit and component files (2,453 tests), no line-ending flips, no dashes, no migration or money-flow line touched. Not verified: no browser run, no e2e. Known small gaps, left for the seller UI branch: the "reload to try again" line is also shown to team members, whose reload never asks Stripe; after a failed country read the checklist's payments step says Stripe still needs details |
| `market/05-catalogue-currency` | `C:\dev\sq-market` (stacked on round 2) | Done, reviewed, committed locally as `b73dae3` (65 files changed, 4 added; no SQL). Rule R2 on the server for the catalogue. Product writes (create, update, the card toggle, duplicate, CSV import, the assistant tools) ask `productCurrencyProblem`; a product already stored in another currency can still be saved as a draft in it, never published, copied or moved to another such currency. Discounts ask `discountCurrencyProblem`. Buyer surfaces (the shared purchasable gate, storefront page and embed frame, sitemap, share image, quotes, delivery pricing) drop a product priced outside the market, like a takedown. Sellers get a refusal with its own sentence and a Needs attention row counting live products hidden for their currency, from a read the Overview already makes. New products, imports and discounts start in the market's currency; predictions never propose another. Copy takes the currency codes from the config, so these keys need no rewrite on expansion. Verified by the orchestrator: `tsc` clean, ESLint clean, 154 unit and component files (2,910 tests), no line-ending flips, no dashes, no SQL, e2e or money-flow line touched. Not verified: no browser run, no e2e. Known and left for the seller screens branch: the product form's picker still offers every storable currency; the products list has no badge on a hidden product; the onboarding checklist can link to a page that answers 404 when a seller's only placed product is in another currency |
| `market/08-review-round-3` | `C:\dev\sq-market` (stacked on 05) | Done, reviewed, committed locally as `4fd6b1e` (57 files changed, 1 added). The fixes from review rounds 3 and 4 in one commit. Reporting: the store's reporting currency is its most recent PAID order's (migration 8 edited in place, replay block and test 54 with it); the Products page names left-out currencies. Catalogue: the setup checklist no longer calls a hidden product's page live; the seller gate is asked before the currency rule on every publish path; "Make active" writes only a row still priced in a market currency; the public reviews feed asks the product page's gate (one extra read); a link to the product form on the designer's refusal; the assistant's schema tool names the accepted currencies. Seller gate: "reload" and "open Payments" only for the owner; a failed country read no longer makes the checklist claim Stripe needs details. Tests: the fallback scan covers named constants and default parameters; the coverage "drives" check ignores strings. The build agent stalled twice (its stream, not the code); the orchestrator finished the last two items and three test updates by hand. Verified by the orchestrator: `tsc` clean, ESLint clean, 157 unit and component files (2,968 tests), 4 db files (50 tests), replay block identical, no line-ending flips, no dashes, no money-flow line touched. Not verified: no browser run, no e2e |
| `market/06-shipping-terms` | `C:\dev\sq-market` (stacked on round 3) | Done, reviewed, committed locally as `510c469` (41 files changed, 1 added; no SQL). The write side of R2 and R3 for delivery terms. Both writers (the settings form's `saveShippingPolicy` and the assistant's `save_shipping_policy`) ask `shippingPolicyMarketProblem` straight after the parse: destinations only where the market delivers (the catch-all row means everywhere the market allows), and a policy that holds money stores its rates currency, which must be a market currency. The refusal names the countries to remove in the seller's language. A new policy starts from the market's currency; an old stored policy with no currency is still read as euros, and those reads are a permanent, explained allow-list in the fallback scan. An Overview row tells a seller whose saved terms no longer fit, from the profile row already read. Stored policies are not narrowed. The first build agent stalled before writing anything; a second, with a tighter brief, built it. Verified by the orchestrator: `tsc` clean, ESLint clean, 63 unit and component files (1,221 tests), no line-ending flips, no dashes, no SQL, e2e or money-flow line touched. Not verified: no browser run, no e2e |
| `market/07a-checkout-rules` | `C:\dev\sq-market` (stacked on 06) | Done, reviewed, committed locally as `7c8a865` (25 files changed, 2 added; no SQL, no change to the Stripe code). R3, R5 and R6 on the server. The quote refuses a delivery country outside the market before delivery is priced (`delivery_outside_market`). The catch-all row expands to the market's delivery countries only, in the checkout's country list and the cart's country guess. One check where the order is placed (`checkoutMarketRefusal` in `src/lib/checkout/market-check.ts`, called by `placeOrderResponse` before any provider is asked or anything is written): every seller read fresh, the quote's currency, the delivery country as sent; it already takes a list of sellers. The order writer refuses a currency or delivery country outside the market before the database is called. An order under the card minimum is refused at the quote (`below_card_minimum`), not for a free order or the test provider. Buyer copy in ten locales. The agent stalled once before writing anything and finished after being resumed. Verified by the orchestrator: `tsc` clean, ESLint clean, 79 unit and component files (1,226 tests), no line-ending flips, no dashes. Not verified: no browser run, no e2e |
| `market/06-review-round-5` | `C:\dev\sq-market` (stacked on 07a) | Done by the orchestrator, committed locally as `85dec0f` (10 files changed, 1 added; no SQL). Review round 5's fixes: ANY delivery rate is money (a rate on a row with no country, or on a delivery profile), so it can no longer be saved in euros or with no currency; delivery is quoted and a "Delivery from" price promised only through rows the market can be delivered through, so terms naming only other countries offer no checkout instead of one with an empty country list; tests that fail if three earlier fixes are removed; the assistant's documentation corrected. Verified: `tsc` clean, ESLint clean, 74 unit and component files (1,411 tests) |
| `market/07b-billing-country` | `C:\dev\sq-market` (stacked on round 5) | Done, reviewed, committed locally as `7526f83` (36 files changed, 7 added). R4. Migration `20261122_market_3b_order_evidence.sql`: three nullable columns on `orders` (`billing_country` declared by the buyer, `stripe_billing_country`, `card_country`), and `order_place` redefined from the shopping cart version with exactly two insertions (verified by diff: the column and its value; grants restated, service role only). The quote and the placement check ask the declared country for any order with a download; the checkout form asks for it once; the payment page collects the full billing address for a download; the webhook stores the two evidence values after confirmation from the payment read the fees step already makes, alerts ops once on a difference, and never refuses or refunds. The orchestrator moved the evidence read out of the read that finds the order for a payment, so a deploy ahead of the migration can delay evidence but never leave a paid order unconfirmed (test added). Verified: `tsc` clean, ESLint clean, 82 unit and component files (1,278 tests), 7 db files (90 tests, every test that places orders), replay block identical. Not verified: no browser, no e2e, no Stripe |
| `market/07-review-round-6` | `C:\dev\sq-market` (stacked on 07b) | Done by the orchestrator, committed locally as `4abbbf1`. The promised "Delivery from" price uses the quote's own matching rule over the market's countries; the order writer requires a market delivery country once it knows the order ships; the Czech and Slovak delivery sentence no longer says "we deliver". Verified: `tsc` clean, 61 unit and component files (1,121 tests) |
| `payments/minimal-liability` | `C:\dev\sq-market` (stacked on round 6) | Done by the orchestrator on Root Labs' direction (23 Nov), committed locally as `d403e53`. Standard connected accounts (card payments only; any other type Stripe reports is never recorded, ops alerted), the seller's own full Stripe Dashboard instead of Express login links, and every seller refund keeps Square Share's fee (`refund_application_fee: false`). A source test guards all three plus "no destination charges or transfers". Verified: `tsc` clean, ESLint clean, 42 unit and component files (658 tests). Not verified: real Stripe; e2e (the test Stripe server still answers login links and spec 87 expects the fee returned) |

Review round 1 (Phase 4, run early on what exists), from a read-only checkout
of `7c5d1df` at `C:\dev\sq-market-review`, by two agents that wrote none of the
code:

- `docs/compliance/review/R1-bypass-hunt-01.md`: a seller outside the market
  is refused everywhere at the moment a buyer arrives. One time-limited P0 (a
  payment page opened before the seller left the market can still be paid for
  up to 31 minutes; the promised order alert was not built), one latent P1
  (the buyer-facing gate ignored the Stripe account's country while the
  publish gate and `seller_sell_block` counted it), 3 P2, 7 P3. Neither P0 nor
  P1 is reachable in production today (Connect off, 0 accounts).
- `docs/compliance/review/code-review-01.md`: 0 blockers, 2 major, 10 minor,
  9 nits. Major: CZK sales would be labelled as euros by the reporting
  functions once CZK is storable (fix: build the reporting branch next and
  never deploy branch 02 without it); the e2e specs 30, 50, 60 and 87 were
  left failing (the fake Stripe server never returned an account country).
  Also: one fail-open (account creation read a failed database read as "no
  account", which could create a second Stripe account if code shipped before
  its migration), an unknown Stripe country shown as a mismatch with no way
  out, and a coverage test that accepted a cell if the cited file merely
  existed. Confirmed true: direct charges with the application fee, the
  charge currency can only be the product's stored one, account type and login
  links unchanged, grants and `search_path` on the new SQL correct.

Decisions taken from the review:

- The reporting branch (08) moves ahead of 05, and branch 02 is never deployed
  without it.
- An order paid after its seller left the market stays paid and alerts ops.
  Nothing is refunded automatically; that is the owner's call.
- The database guards design needs a guard for storefront rows (switching the
  embed or buyer pages on by a direct write): none was planned.
- After fix round 1 the bypass hunt is run again on the new commit.

Fix round 1 (`ed69649`), what it closed:

- The paid-order window (P0): the webhook checks the seller again after an
  order is confirmed and alerts ops once per order. The order stays paid.
  Open pages are not expired when a seller leaves the market; that needs a
  Stripe call per pending order from the Settings save and was left out.
- The buyer-facing gate now counts the connected account (P1): the account
  rides in the seller's one profile read, so buyer pages, the publish gate
  and `seller_sell_block` agree. A ten-case matrix test holds them together
  (`tests/setup/seller-gate-matrix.ts`).
- "Open Stripe" no longer resumes onboarding for a refused seller; a
  finished account's dashboard stays open so payouts stay reachable.
- Account creation fails closed on a failed read (no second Stripe account).
  The gate status on the dashboard and in the assistant reports a failed
  read instead of "may sell".
- An unknown Stripe country is its own reason (`stripe_country_unknown`) with
  its own copy and a way out: opening Payments asks Stripe again.
- A "paused" payments state on the checklist and the Payments card when
  Stripe would take payments and the market refuses the account.
- Ops alerts about one account: once a day per set of facts.
- The coverage test names the entry point each cited test drives, and checks
  the gate call is still in the function.
- The test Stripe server echoes the account country; specs 50 and 60 follow
  the new gate. Not run.

Decisions taken by the orchestrator in fix round 1:

- New storefronts. The build agent stored every refused seller's new
  storefront with its buyer switches off. That would have changed the
  working onboarding flow: every new seller creates a storefront before
  their details are in, and its pages have always opened by themselves once
  they are. Narrowed: the switches are forced off only for a seller the
  MARKET refuses (or who cannot be read). Missing details alone change
  nothing; the buyer reads keep that page back, as before.
- So the guard planned for storefront rows must do the same: on insert,
  force the switches off only when the owner's country is on file and
  outside the market, or their account is refused; never for a missing
  country. On update, refuse a switch going from off to on for any blocked
  owner (the app already refuses that). Bind every role.
- DEPLOY ORDER, hard: migration 3a (the account country column) must be
  applied BEFORE branch 04's code is live. Every buyer read now selects
  that column, and a failed read closes the page, so code ahead of the
  migration answers 404 for every product page. The migration header says
  so and the deploy's schema gate names the column.

Left open on purpose after fix round 1 (each small, none reaches money):

- The embed's cached JSON can outlive a block by about 6 minutes (no prices
  or titles in it; its links answer 404).
- An assistant preview link of a blocked seller's page lasts 15 minutes
  (no checkout, not indexed).
- The reviews API still serves reviews of a blocked seller's product (no
  price, no way to buy).
- Eight seller screens warn only once the server refuses; the UI branch
  moves them onto the full gate status.
- One extra account read per purchasable check while Connect is on: with
  the checkout branch.
- The delivery-rate error names one cap for every currency: with the
  shipping branch.

Review round 2, on `ed69649`, by two fresh agents, from the read-only checkout:

- `docs/compliance/review/R1-bypass-hunt-02.md`: **R1 is clean.** No way was
  found for a buyer to see an offer from, or pay, a seller with no country, a
  country outside the market, or a charges-enabled Stripe account whose
  country is unknown, outside the market or not the seller's own. Of the
  first hunt's twelve findings: 7 closed, 1 partly (direct database writes,
  open until the guards, but buyers see nothing from them), 4 unchanged P3.
  No regression in the fixes. New: one P2 against strict currency, in the
  switched-off cart (a line that cannot be bought is priced in the first
  line's currency, or in euros when there is none: a 250 Kc line that sold out
  shows as EUR 250.00; nothing is charged that way), and three P3 (no way out
  of an unknown Stripe country while Connect is off; a profile read that
  forgets the account reads as "no account" and no test goes through
  PostgREST; the Payments page calls Stripe with no rate limit).
  Nothing was run by the hunter: every finding is from reading the code.
- `docs/compliance/review/code-review-02.md`: **no blocker, no major.**
  Mergeable after two small fixes: the Payments page asks Stripe for an
  unknown account country on every load, for any team member, with no rate
  limit (G1); and a seller read that leaves the account out passes as "no
  account", with four of the seven buyer readers untested for that (G2, the
  same as the hunter's hardening finding). One finding against an
  orchestrator decision (G3, below). Seven nits (copy that links to the page
  it is on, a pause explained differently on two screens, five stale
  comments, a spec edit that changes nothing, a loose check in the coverage
  test). First-review findings confirmed fixed as claimed; the account type,
  login links and the refund flag confirmed untouched. Nothing was run by the
  reviewer.

Decisions taken from review round 2:

- G3 accepted: when the seller cannot be READ, creating a storefront now
  answers "try again" and writes nothing, like every other write behind the
  gate. Storing the switches off silently after a momentary read failure left
  a lasting state the seller was never told about. The switches are stored
  off only for a market refusal.
- Turning the embed off is never refused again: an off-save over a stored
  config that no longer parses rewrites it with the buyer switches off.
- The one thing neither reviewer could check, how PostgREST answers the new
  account embed, was checked as far as this machine allows: a read-only
  query on production shows exactly one relationship between `profiles` and
  `seller_payment_accounts` (so the embed cannot be ambiguous), and the
  dashboard already embeds `seller_billing` from `profiles` in production
  through a foreign key of the identical shape. Still not run through
  PostgREST: the end-to-end run on GitHub settles it.
- Fix round 2 covers both reports in one pass, after the reporting build
  frees the worktree. Done: `20cd9c1`.
- Review round 3 (running): one fresh agent on the reporting commit
  `0b93f0e` and fix round 2 `20cd9c1`, with a security reading of the new
  SQL functions (what seller A can learn by passing seller B's id).
- Review round 3 result (`docs/compliance/review/review-03.md`): **no way
  around the seller rule and no cross-seller data exposure.** A seller who
  passes another seller's id to the new reporting functions gets the market
  default currency and zeros; a team member still gets the owner's figures.
  `20cd9c1` mergeable as is (every finding of round 2 closed, the Payments
  rate limit partly: the page's other Stripe reads were unlimited before
  this work and still are). `0b93f0e` mergeable after one fix (H1), which
  must be made before migration 8 is applied anywhere. Nothing was run by
  the reviewer.
- Decisions from review round 3, applied in fix round 3 once branch 05 frees
  the worktree:
  - H1 accepted. The store's reporting currency becomes the currency of its
    most recent PAID order; only a store with no paid order falls back to
    its most recent refunded or disputed one, then to the market default. As
    built, one refunded order in another currency could blank the Overview.
    The migration file is edited in place: it is applied nowhere.
  - H2: the product cards and the best-seller ranking keep counting one
    currency for units and revenue alike (a card that pairs every unit with
    one currency's revenue would mislead), the migration header says so
    truthfully, and the Products page gets the same one-line note as
    Overview and Analytics.
  - H3 left as it is: Overview counts refunds and disputes in every currency
    so a dispute stays visible; Analytics analyses one currency.
  - H7, H8 accepted: the "reload" and "open Payments" ways out are offered
    only to the owner, whose visit is the one that asks Stripe; a failed
    country read no longer makes the checklist say Stripe needs details.
  - H9 accepted: the fallback scan also covers named constants and default
    parameters, each with a pending entry for the branch that owns it.
  - For expansion: a market with two currencies needs a currency switcher on
    Overview and Analytics. The SQL already takes the currency.
- Review round 4 result (`docs/compliance/review/review-04-catalogue-currency.md`),
  on the catalogue currency commit `b73dae3`: **R2 is clean for buyers** (a
  product priced outside the market is never shown with a price, quoted or
  charged; every quote and every Stripe session goes through the shared gate)
  **and for seller writes** on every app entry point. The draft exception
  holds and no draft reaches a buyer. No blocker, no major. Mergeable after
  one fix (K4). Nothing was run by the reviewer.
- Decisions from review round 4, sent to the running fix round:
  - K4 accepted: the setup checklist no longer calls a product page live, or
    hands out its link, when the product is hidden for its currency.
  - K5 accepted: on every publish path the seller rule is asked before the
    currency rule, so a seller the market refuses is not told to reprice
    first; the Overview's price-currency row is not shown while the seller
    has a market block.
  - K2 accepted: the card's "Make active" write is conditional on the
    currency, so a race between a seller's own tabs cannot set a non-market
    product active.
  - K7, K8, K9 accepted (a link to the product form on the refusal given in
    the designer; the assistant's schema says which currencies are accepted
    now; the row's description takes a plural).
  - K1 in part: the public reviews API will ask the same gate as the product
    page (this also closes the first hunt's finding about a blocked seller's
    reviews); the documents stop claiming "absent everywhere". Left as they
    are: the embed's JSON still lists such a tile, whose link answers "not
    found", and a hidden product's add-on still has its own page. Neither
    shows a price for the hidden product.
  - K3 decided: a draft stored in a non-market currency may still have its
    price changed in that currency. A draft is not an offer, and the database
    guard will fire when a row becomes sellable, not on a draft.
  - K6 goes to the seller screens branch: marking which products are hidden
    in the products list and on designer tiles.
  - Noted for the guards and checkout branches: a payment page opened before
    a seller changes a product's currency by a direct database write is still
    paid at the price quoted, in the market currency.
- What a seller with a live EUR product meets after branch 05, as built:
  the Overview says how many products are not priced in the market's
  currency; the product is still listed as active in the seller's list;
  saving it active in EUR is refused with the reason, saving it as a draft
  works, and saving it with a CZK price puts it back in front of buyers.
  Buyers meanwhile get "not found" everywhere for it. The price is never
  converted: the seller types the new one.
- The end-to-end follow-up has its list (from the branch 05 build): about
  35 specs seed EUR products and need a buyer to see them, 10 save a seeded
  active product from the form, spec 101 passes EUR to the assistant's
  tools in 8 places, spec 103 asserts the old currency prediction, and
  about 20 specs assert euro amounts.
- The checkout branch is split in two. 07a carries everything that needs no
  SQL (delivery country, the multi-seller check, the one check at
  placement, the writer's backstop, the order minimum). 07b carries the
  billing country of downloads with its migration: new order columns and
  `order_place`, the most sensitive function in the database, redefined
  from the shopping cart version. Smaller pieces review better, and agents
  with large tasks have been stalling.
- What a buyer sees before 07a, found while building 06: a seller's
  catch-all delivery row puts every storable country in the checkout
  picker, and a quote for a country outside the market succeeds. A stored
  policy priced in euros gives koruna products no delivery price, so
  physical products have no pay button until the seller saves it again.
- Review round 5 result (`docs/compliance/review/review-05.md`), on `4fd6b1e`
  and `510c469`: no way around R1 or R2, no cross-seller data exposure.
  `4fd6b1e` mergeable as is: every accepted finding of rounds 3 and 4 is
  fixed in the code and no new bug was found (the resolver's ties, "Make
  active" never refusing a properly priced product, no draft write asking
  the seller gate, the public reviews failing closed). `510c469` mergeable
  after ONE fix, M1: the delivery-terms rule decides "this policy holds
  money" from rows that have both a rate and countries, so a rate typed on a
  row with no countries is saved in euros or with no currency, and every
  product page then prints that rate in euros. No money can move (checkout
  is not offered for it) but buyers see it. Also: three accepted fixes have
  no test that would fail if they were removed (M2), one document still
  says "exactly like a takedown" (M3), and the source scans check a little
  less than their names say (M4). Nothing was run by the reviewer.
- Decisions from review round 5: M1, M2 and M3 are fixed by the orchestrator
  as soon as the checkout build frees the worktree (M1: any rate on any row
  or profile counts as money). M4 is left: the scans are a safety net, not
  the enforcement, and each gap needs a deliberate rename to slip through.
- Review round 6 result (`docs/compliance/review/review-06-checkout.md`), on
  `7c8a865` and `85dec0f`: **no way was found to place an order or open a
  payment page that breaks R1, R2, R3 or R6.** R3 clean (a country outside
  the market is refused at the quote, at placement on the country as sent,
  and in the order writer), R5 clean (the check takes a list, refuses an
  empty one and any failing seller; a checkout can hold only one seller
  today), R6 clean (both order routes pass the one check before any provider
  is asked). Both commits mergeable as is; review round 5's findings closed.
  Confirmed untouched: the Stripe session's charge type, amount, currency
  and application fee, the account type, login links, the refund flag, the
  webhook leaving a paid order paid, every migration. Nothing was run by
  the reviewer.
- Findings of round 6, all small, fixed by the orchestrator once the billing
  country build frees the worktree: the "Delivery from" price can come from
  a cheaper catch-all row that no buyer in the market is charged, because a
  row naming the buyer's country wins at checkout (N1); the order writer
  checks the delivery country only when an address parses, so a product
  turned from a download into a parcel during a checkout could be written
  with no address (N2, P3); the Czech and Slovak sentence says "we deliver"
  where the English names no one (N5). Left for the seller screens branch:
  the product form says delivery has no price in the currency when the real
  problem is that the terms name only other countries (N4). Left: two tests
  of the placement check that pass without it, because the quote refuses
  first; a third does pin it (N3).
- Agent stalls, 23 Nov: seven of the last eleven agent runs stopped with no
  progress for ten minutes (a build agent three times, reviewers once, the
  rest once each). Nothing was lost each time: a resume or a fresh start
  with a tighter brief finished the work, and where an agent had stopped
  near the end the orchestrator finished by hand. Briefs now tell agents to
  keep every tool call small and to write their report file early.
- DECISION, 23 Nov, Root Labs: "efficontrol should have as little liability
  as possible, no refunds except the ones making money for us should hit our
  account, seller-buyer refunds should be handled between the buyer and
  seller." Read as: Standard accounts (not Express, which made the platform
  liable for sellers' negative balances) and the fee kept on every seller
  refund. Built on `payments/minimal-liability`. Before it ships, the Terms
  and the Docs pricing page must stop saying "a refund returns the fee"
  (keeping it is worse for sellers than what they agreed to): tracked on
  Teamster `DgglGEV2sabJUoSudd6c`; the decision task `TMW7SrvFnh565yqPxam2`
  is done.
- Also 23 Nov, Root Labs: no Stripe test-mode run for now; they will test
  with a real account. The orchestrator never uses live keys.
- Also 23 Nov: the summary document for the owner was too long to read. It
  is now one screen (seven open decisions, who carries the money risk, a
  two-line status); detail stays in this folder.
- Changed plan for the end-to-end fixtures: they are converted ONCE, after
  the checkout branch, not after branch 05. Branches 06 and 07 change what
  the specs must seed as well (delivery countries, rates currency, billing
  country), and none of it can be run before a `ci/**` push is approved, so
  one conversion over the finished rules is less error-prone than three.
  Each build agent hands over the list of specs its branch affects.
- Machine note, 23 Nov: free memory fell to 1.6 GB while a type check ran
  (Chrome 9 GB, VS Code 4 GB, other sessions). Heavy commands now run one
  at a time with output in a log file, and tests with one worker when
  memory is short.
- The end-to-end fixtures are converted to the market currency in their own
  follow-up after branch 05, not inside it: about 27 specs mention euros and
  none of them can be run on this machine, so the conversion is kept apart
  from the logic it follows.

Decisions taken while building the reporting branch (08):

- One reporting currency per read, picked in SQL and named in the payload,
  so a page stays one round trip and the app never names a currency for a
  figure itself. Default: the currency of the store's most recent sale;
  for a store with no sales, the market's default currency.
- An order that reporting counts is a sale a buyer paid: status paid,
  refunded or disputed. Pending is not one.
- The refunded and disputed counts and the latest five orders on the
  Overview take every currency (a count carries no money and each order
  names its own), so a dispute in another currency stays visible.
- A currency the build cannot name is refused with the existing error page
  and retry, as a failed read already is: a figure is never shown in
  another currency.
- Plan prices and the two billing functions are untouched (owner's
  decision). The calculator shows its default instead of a false zero.
- APPLY AND DEPLOY ORDER for the stack so far: (1) deploy the
  strict-currency code `341ab30`; (2) apply the shopping cart migration
  20261120, then market_2 (rules mirror), market_8 (reporting) and
  market_3a (account country); (3) apply market_1 (CZK storable); (4)
  deploy the rest of the stack straight after. market_1 is never applied
  on its own.
- Left for later, noted by the build agent: `storefront_signals_aggregate`
  adds signal values across currencies (nothing records a value yet; fix
  with bookings); Admin's revenue tile still counts EUR fees only; English
  shows the koruna as "Kč" in the price field and as
  "CZK" in amounts (a by-eye choice for a lab); the cleanup migration that
  drops the old overloads once this code is live.

Noted by the hunter outside R1, for the branches that own them: a delivery
policy saved without a currency through the assistant is shown to buyers in
euros (shipping branch); new products default to EUR in the database and the
product form (catalogue currency branch).

Follow-ups noted from branch 04, not yet done:

- Done in fix round 1: ops alerts are de-duplicated, and the Settings field
  reads "Country of establishment" like the missing-details list.
- The welcome flow does not ask for the country yet, so a new seller is not
  live until they pick one in Settings: the UI branch adds the step.
- Five hand-written strings name the Czech Republic and must be rewritten when
  a country opens; they belong in the plan's list of expansion copy.

Decisions taken while building:

- The storage bound on a delivery rate is the highest per-currency cap; each
  currency's own cap applies on save only. The design kept the old 1,000 bound
  for storage, which would have emptied any CZK policy above 1,000 Kč on read.
- The migration drops the two inline currency CHECKs by what they are (a
  single-column CHECK on `currency`), not by name, and refuses to finish if any
  currency CHECK on the four tables still lacks CZK.
- The "drop ,00 on whole CZK amounts" display choice is left for a lab pick.

Seller onboarding (1B): both designs are in (`plan/P3a`, `plan/P3b`) and
reconciled. `plan/P3-reconciliation.md` settles the 81 points where they
differed and is the single interface for build agents (tables, sealing
envelope, the status row, one list of 13 gate reasons, who reads and writes
what, and one merged order of work with 1A). `PLAN.md` section 7 is the owner's
version. Owner-only setup steps are on the board as `e53dhnEerc3kXKXuqzQK`.

Settled by the orchestrator: a seller changing their country to one that
differs from their Stripe account's country is saved, never refused; selling
and payments pause and ops are alerted. The design's "saveTaxInfo lock" is not
built (branch 04 was told so while running).

Still open for 1B: how Admin's staff sign-in reaches Store for a logged
reveal; the migration for a public email or phone that differs from the
private one.

The harness's own worktree isolation is refused in this workspace (it trips on
the drive-letter case of the path) and leaves a locked empty worktree behind.
Worktrees are created by hand under `C:\dev`, and build agents are briefed with
absolute paths. Dependencies are installed for real inside the worktree, never
through a link to the shared tree.

One heavy step at a time: free memory was 4.6 GB when the build started.
