# Review 03: commits 0b93f0e and 20cd9c1

Reviewer: independent (did not write either commit). Read-only review of `C:\dev\sq-market-review`, detached at `20cd9c1`. `0b93f0e` was read as `git show 0b93f0e`, and `20cd9c1` as `git diff 0b93f0e 20cd9c1`. Nothing was run: no install, type check, test, build, server or browser. Line references are at `20cd9c1` unless a file in `supabase/migrations/` is named. Date: 2026-11-22.

## 1. Verdicts

| Commit | Verdict |
|---|---|
| `0b93f0e` Report sales in one named currency | **Mergeable after listed fixes.** It closes F1 correctly and safely. Fix H1 before the migration is applied anywhere, because changing the resolver later needs a second migration. H2 is a product decision; make it, then fix the code or the header. H3 to H6 are nits. |
| `20cd9c1` Review round 2 | **Mergeable as is.** Every finding of the two earlier reports is closed or partly closed, and nothing new reaches a buyer or money. H7 to H9 are nits that can ride along. |

**Seller rule and data exposure:** I found no way around the seller rule (R1) in either commit, and no way for one seller (or any signed-in user of the shared project) to read another seller's figures through the new functions.

## 2. Findings

| ID | Severity | Commit | Finding |
|---|---|---|---|
| H1 | minor | 0b93f0e | The reporting currency is the newest sale's, and refunded or disputed orders count as sales. One new order in another currency flips every figure; a refunded one blanks the dashboard |
| H2 | minor | 0b93f0e | Product cards and the best-seller ranking now drop UNITS sold in other currencies, which the header does not say, and the Products page has no note |
| H3 | nit | 0b93f0e | Overview counts refunds and disputes in every currency; Analytics counts them (and the status pie) in one. The same store shows two refund counts |
| H4 | nit | 0b93f0e | The migration header misdescribes two functions and leaves the Products list out of what breaks when code runs ahead of the migration |
| H5 | nit | 0b93f0e | Test 54 claims more than it checks: no disputed order is seeded, only one old overload is checked, nothing goes through PostgREST |
| H6 | nit | 0b93f0e | The "most recent sale" race on Analytics is handled by dropping data, after three separate resolutions per page |
| H7 | nit | 20cd9c1 | The way out for an unknown Stripe country ignores who is looking: team members get "reload" on Payments, and editors get "open Payments" on a refused publish. Neither visit ever asks Stripe |
| H8 | nit | 20cd9c1 | A failed country read now makes the checklist say "Stripe still needs a few details" with "Finish on Stripe", which leads to a page with no finish button |
| H9 | nit | 20cd9c1 | Two source scans are narrower than their names: the currency fallback scan misses named constants and default parameters, and the "drives" check accepts a call written inside a string |

No blocker and no major finding.

## 3. Details

### H1. One new order flips the reporting currency, and a refund can blank the dashboard (minor, 0b93f0e)

- **Where:** `supabase/migrations/20261122_market_8_reporting_currency.sql:121-131`. The resolver takes every currency with an order in status `paid`, `refunded` or `disputed`, ordered by the newest `created_at`, and the first one wins. Every overload and the app use it (`SELLER_REPORTING_CURRENCY = null`, `src/lib/analytics/reporting-currency.ts:18`).
- **What is wrong:**
  1. A refunded or disputed order can be the newest "sale", so a currency the store has kept no money in becomes the reporting currency. Then Overview, Analytics, the product cards and the best-seller badge show zeros, with only the one-line note to say why.
  2. Whenever paid sales alternate between two currencies, every figure jumps with each sale. There is no way to see the other currency's figures: the app always passes null, although the SQL already takes `p_currency`.
- **Concrete case:** a Czech seller who priced in EUR before CZK was storable switches to CZK. Their old EUR products are still live (branch 05, which hides them, is not in). This month they make 40 CZK sales. Then a buyer pays for an old EUR product, and the seller refunds it the next day. The newest sale is now that refunded EUR order. Overview shows no 30-day revenue, 0 sales and no average. Analytics is all zeros. The product cards lose their figures and the best-seller badge disappears. The only hint is "Sales in CZK are not in these totals." This lasts until the next CZK sale. Test 54 asserts exactly this outcome as correct (`tests/integration/54-reporting-currency.test.ts:154-158`, `:245-251`: CZK paid, then EUR refunded, gives EUR with `revenue_cents: 0, sales: 0`).
- **Fix (smallest):** in `reporting_currency`, rank currencies by the newest PAID order first. Fall back to the newest refunded or disputed order only when there is no paid one, then to the market default. One `order by` change: `order by bool_or(o.status = 'paid') desc, max(o.created_at) filter (where o.status = 'paid') desc nulls last, max(o.created_at) desc, o.currency`. Better, and still small: the currency with the most paid revenue in the last 30 days, with the same fallbacks. Later, the note can offer the other currencies through the existing `p_currency`.
- **Test:** in test 54, the switcher case should expect CZK, with `other_currencies` `["EUR"]` and the CZK sale counted. Add a store with a newer paid EUR order than its CZK one, to pin whichever rule is chosen.

### H2. Units sold in other currencies vanish from cards and the ranking (minor, 0b93f0e)

- **Where:** `product_sales_aggregate` (`20261122_market_8_reporting_currency.sql:160-169`) and `products_ranked_by_metric` (`:213-219`). Both now filter `order_lines` to the one currency, for `units_sold` as well as revenue. The Products page shows no note (`otherCurrencies` is read on Overview and Analytics only; grep finds no use in `src/components/products/`).
- **What is wrong:**
  - The header (`:34-41`) says each body's `currency <> 'USD'` (and the per-product `min(currency)`) was "replaced". These two functions had no currency filter at all (`20261120_shopping_cart.sql:636-647`, `:684-689`), so a filter was added. It changes units, not only revenue.
  - Units carry no money. The same commit keeps the dashboard's counts in every currency for exactly that reason (`:328-335`), but drops units here.
  - The ranking by units ("best sellers") therefore ignores every sale outside the reporting currency, and `rankProductsToPlace` in the designer is fed the same partial units (`src/app/storefront/(designer)/[id]/page.tsx:89`, `:125`).
- **Concrete case:** a mug sold 50 times in EUR and twice in CZK, in a store whose newest sale is CZK. Its card says 2 sold. Sorted by units, it ranks below a product sold three times in CZK. Nothing on the Products page says EUR sales are left out.
- **Fix:** either count `units_sold` (and rank `unitsSold`) over every currency, and keep revenue and the revenue ranking in one currency; or keep the filter, say so in the header, and show `OtherCurrenciesNote` on the Products page (the report already carries `otherCurrencies`).
- **Test:** test 54, one product with a paid EUR and a paid CZK line. Whichever rule is chosen, assert `units_sold` and the `unitsSold` ranking for it.

### H3. Two different refund counts for one store (nit, 0b93f0e)

- **Where:** the dashboard counts take every currency (`20261122_market_8_reporting_currency.sql:330-335`). `analytics_aggregate` counts `refunded_count`, `refunded_cents`, `statuses`, `unique_buyers` and `first_order_date` from `in_range`, which is filtered to one currency (`:388-403`, `:429`, `:486-496`).
- **Concrete case:** one CZK refund and one EUR refund, reporting currency CZK. Overview's Needs attention says 2 refunded; the Analytics refund tile and the status pie say 1.
- **Fix:** take the order counts and the status pie in `analytics_aggregate` over every currency, as the dashboard does (money stays in one). Or keep them, and say in the header that only the dashboard does this.
- **Test:** test 54, switcher: `analytics_aggregate(..., 'CZK')` `totals.refunded_count` matches the dashboard's `refunded_count`.

### H4. The migration header misdescribes two functions and one consequence (nit, 0b93f0e)

- `20261122_market_8_reporting_currency.sql:34-41`: see H2 ("replaced" for two functions that had no filter).
- `:70-74` lists what happens if the code is live before this file: Overview and Analytics "unavailable", empty product card figures. It leaves out that the Products list in a best-seller or revenue sort throws `Failed to load products` (`src/lib/products/queries.ts:374-376`), and so does the assistant's `list_products` in those sorts. The default sort is unaffected (`queries.ts:321`). The schema gate makes this unlikely, but the header is the runbook.
- **Fix:** correct both sentences.

### H5. Test 54 claims more than it checks (nit, 0b93f0e)

- `tests/integration/54-reporting-currency.test.ts:245`: the title says a refunded OR DISPUTED order counts as a sale, but no disputed order is seeded. Removing `'disputed'` from `:128` of the migration would not fail any test.
- `:213-232`: "the old overloads ... add the two currencies together" calls only the old `dashboard_orders_aggregate`; the other four old overloads are checked only for existence.
- Nothing sends a request through PostgREST (the db project uses `pg` directly), so overload resolution by argument names, which is what the app relies on, is not tested end to end. The unit test does pin that `p_currency` is an explicit `null`, not omitted (`tests/unit/reporting-currency.test.ts:205`). That matters, because an omitted key would hit the old overload.
- Each remaining test can fail, as far as I can see: the stranger case would fail for a definer function (it checks `other_currencies` and zeros, not only the currency, which happens to equal the market default), the team-member case would fail without the RLS path, and the grants case pins absolute values before comparing with the old overloads.
- **Fix:** seed one disputed order for a third seller and assert it resolves; call each old overload once. If the replica's PostgREST can be reached, one REST call per new signature.

### H6. Three resolutions per Analytics page, and a race handled by dropping data (nit, 0b93f0e)

- `src/lib/analytics/queries.ts:551-571`: `getAnalytics`, `getPreviousPeriod` (another `getAnalytics`) and `getWeekdayProducts` each resolve the currency in their own call. The guard (drop the comparison or the split when its currency differs) is correct: nothing is mixed or mislabelled.
- It costs three extra scans of the seller's orders per page, and in the race it silently drops the comparison.
- **Fix (optional):** resolve once with `reporting_currency` and pass the code explicitly as `p_currency` to the parallel reads. Then the guard is unreachable and can stay as a defence.

### H7. The unknown-country way out ignores who is looking (nit, 20cd9c1)

This is the gap the author noted, and it is a little wider than noted.

- **Where:**
  - The Payments card always uses `"reload"` (`src/components/payments/ConnectionStatusCard.tsx:40-44`). The text is "We could not reach Stripe just now. Reload this page to try again."
  - The page asks Stripe only for the owner, within budget (`src/lib/payments/connect/account-market.ts:63-65`, `src/lib/payments/mock.ts:113-115`).
  - `publishBlockedError` gives `"payments"` whenever Connect is live (`src/lib/settings/seller-identity.ts:507`, `src/lib/errors.ts:279-281`). Its callers include actions an editor runs: `products/card-actions.ts:66`, `products/import-actions.ts:166`, `products/actions.ts:338`, `storefront/actions.ts:358`, `:535`, `storefront/page-config-route.ts:198`, `agent/tools/products.ts:286`.
- **What is wrong:** for a team member, "We could not reach Stripe" is untrue (nobody asked), and reloading never asks. An editor whose publish is refused is told "Open Payments and we'll check with Stripe". On Payments they see the reload sentence, and it loops.
- **Does it matter:** not today. In production Connect is off. Then every surface gives the support copy, and the card never shows this block, because the overview returns empty before `statusOf` (`overview.ts:217`). With Connect on, it needs a charges-enabled row with no country, which only rows from before migration 3a can be. When it happens, only the owner can fix it, so a team member's best way out is "ask the owner to open Payments". Support also works.
- **Smallest fix (existing copy only):**
  1. Add `refreshable: boolean` to the overview's `AccountStatus`, set from `viewer.isOwner` in `realPaymentsOverview`.
  2. The card uses `"reload"` only when `refreshable` is true, else `"support"`.
  3. Give `unknownCountryWayOut` a second argument, `isOwner`, and pass `account.isOwner` from the callers above. Only an owner gets `"payments"`.
  
  A new key ("Ask the store's owner to open Payments") would read better than support, but it costs ten translations.
- **Test:** in `payments-status.test.ts`, a member's overview with an unknown-country account renders the support sentence, not the reload one. In the write-path test, an editor's refused publish with Connect live carries no Payments action.

### H8. A failed country read sends the checklist to Stripe (nit, 20cd9c1)

- **Where:** `src/lib/payments/connect/overview.ts:101-105` now gives `takesPayments: false, sellBlock: null` on a failed read (the G6 fix). `paymentsSetupState` (`src/lib/onboarding/steps.ts:95-101`) maps that to `"unfinished"`. The checklist then says "Stripe still needs a few details before buyers can pay", with "Finish on Stripe". On Payments the finish row shows only when charges are off or requirements are due (`ConnectionStatusCard.tsx:157`), so there is nothing to finish.
- **Case:** a moment's profile read failure while the Overview renders. Transient, which is why this is a nit.
- **Fix:** keep the failed read apart. For example, `statusOf` sets `takesPayments: undefined` and a flag `unknown: true`, and `paymentsSetupState` returns a neutral state (not done, the generic detail, no link) for it.
- **Test:** `onboarding-steps.test.ts`: a connected, charges-enabled account with `takesPayments: false` and no block from a failed read is not `"unfinished"`.

### H9. Two source scans are narrower than their names (nit, 20cd9c1)

- `tests/unit/market/currencies.test.ts:116-118` is titled "no currency is ever a fallback". It only matches a quoted code right after `??` or `||`. These pass it:
  - `policy.ratesCurrency ?? LEGACY_RATES_CURRENCY`, which is "EUR" (`src/lib/shipping/rates.ts:118`, `:149`, `:276`; `src/lib/shipping/policy-prose.ts:122`; `src/lib/validation/shipping-policy.ts:158`; `src/components/settings/ShippingSection.tsx:204`). The second bypass hunt flagged this one as buyer-visible ("outside R1", planned for branch 06).
  - `defaultCurrency = "EUR"` (`src/components/products/ProductImport.tsx:85`).
  
  Both are known and planned elsewhere, so the code is not wrong here. The test name overclaims.
- `tests/unit/market/coverage.test.ts:519-522`: a function counts as driven when `name(` appears outside a comment, and strings are not stripped. A test title such as `it("saveTaxInfo(...) refuses")` satisfies it.
- **Fix:** rename the first test to what it checks, or add `LEGACY_RATES_CURRENCY` and default parameters to its pattern with their own pending entries. For the second, strip string literals before the call check (route and event names are already matched separately).

## 4. Earlier findings, as they stand at 20cd9c1

| ID | Status | Evidence |
|---|---|---|
| R2-01 | **Closed** | Each cart line carries its own currency (`src/lib/cart/view.ts:56`, `src/types/cart.ts` `CartLineView.currency`). `CartLineRow` formats with it and draws no amount without one. `CartSummary` and `CartSuggestions` draw no amount when the cart has no currency (`src/components/cart/CartPanel.tsx:147-150`, `:166`, `:183`). Delivery is `none` without a currency (`view.ts:93`). The `?? "EUR"` in `quote.ts` is gone (`priceAssessedLines` returns no currency for no line, `quote.ts:327-348`). A scan guards against new literals (H9 on its reach) |
| R2-02 | **Closed in code** | While Connect is off, every refusal and the Needs attention row send an unknown-country seller to support (`errors.ts:279-281`, `:308-321`; `dashboard/attention.ts:258-281`). The suggested read-only check for charges-enabled rows with a null country, before Connect goes live anywhere, is an ops step and still to do |
| R2-03 | **Closed** | A row with no `seller_payment_accounts` key counts as an account of unknown country, which refuses (`seller-identity.ts:142-147`). A scan holds every caller of the read side to `READ_GATE_SELECT` and pins the seven known readers (`tests/unit/market/seller-gate-reads.test.ts`) |
| R2-04 | **Partly closed** | The country sync is now owner-only and spends the per-user `connect_return` budget (`account-market.ts:51`, `:63-65`, `:139`). The balance, payout, transaction and history reads (4 to 9 Stripe calls per render) still have no budget, for any member. Mostly pre-existing |
| G1 | **Closed** | Owner only, Connect live, shared budget of 300 an hour per user (`rate-limit.ts:303`), failing closed on a limiter error (`rate-limit.ts:601-611`). Tested for owner, member, over budget and known country |
| G2 | **Closed** | As R2-03 |
| G3 | **Closed** | A failed gate read returns the failure and inserts nothing; only `market_restricted` stores the switches off (`storefront/actions.ts:197-199`). Tested |
| G4 | **Closed** | An off-save over an unparseable config writes the defaults with every buyer switch off and asks no gate (`storefront/actions.ts:552-558`); an on-save still asks first (`:534-537`). The comment is true again and has no dash |
| G5 | **Closed for the owner** | The card shows the reload sentence and no link to itself. Team members: H7 |
| G6 | **Closed** | `leadingSellBlock` gives the gate's order (`market/problems.ts:92-95`). A failed read gives no payments and no reason (`overview.ts:101-105`). A missing country alone is "needsSeller" with its own sentence. New nit: H8 |
| G7 | **Closed** | Support copy while Connect is off (as R2-02) |
| G8 | **Closed** | The no-op edit to spec 60 is dropped |
| G9 | **Closed** | `problems.ts:45-49`, `prod-schema.ts:227-230`, `account-market.ts` and `webhook.ts:229` ("once a day per order"), `errors.ts` (the "spliced" comment rewritten), and the `updateEmbedSettings` comment |
| G10 | **Closed** | A function must be called, outside comments; a route, event or tool name must be in a string and the cell must carry a gate call. The check is tested both ways. Residual: H9 |

## 5. Verified and found correct

**SQL security (0b93f0e).**
- The five overloads and `reporting_currency` are `security invoker`, with `search_path = ''`.
- `reporting_default_currency` is `security definer` with no argument and `search_path = ''`. It returns only the market's default currency, a public fact. `market_default_currency` stays service-role only, and test 54 checks that.
- Every new function revokes from `public, anon` and grants `authenticated, service_role`, the same as the old overloads.
- RLS decides whose rows are read:
  - `orders_select_member`: own rows or `store.read` on the owner's store (`tests/db/prod-migrations.sql:981-986`).
  - `order_add_ons` and `order_line_refunds`: the same rule (`:11547-11552`, `:14219-14224`).
  - `order_lines` is `security_invoker = true` in both definitions (`20261120_shopping_cart.sql:575-576`), so it reads with the caller's rights.
- Seller A passing seller B's id gets the market default, no other currencies, and zeros. A team member with `store.read` gets the owner's currency and figures. The replica has no other select policy on `products`, so the ranking leaks nothing either.
- The plan calculator calls `reporting_currency` with the service role and the session's active account id, which is correct for a server-side read.

**Fidelity.**
- A mechanical diff of each new body against its predecessor: four against `20261120_shopping_cart.sql`, the weekday split against `20261028_product_add_ons.sql`.
- The only changes are the `rc` CTE, the currency filter, the two payload keys, the removed argument defaults, the per-product `min(currency)`, and the dashboard's counts and latest orders in every currency, which the header states.
- One change is not stated: the filter added to units in the two product functions (H2).
- `create or replace` of a new signature cannot touch the old one, and the old overloads keep their grants.

**Overload resolution.**
- The old signatures keep their defaults and the new ones have none, so no call can match both: not in SQL (argument counts), and not in PostgREST (a new function needs `p_currency`, which the old one lacks).
- Every new app call passes every key: `p_currency` as an explicit `null`, `p_status` and `p_search` as `null`, `p_now` as an ISO string, and `p_from` and `p_to` as `null` for all time.
- An old build calls only old signatures and is unaffected by the migration.

**Apply order and sentinels.**
- The stated order is right: after `20261120` (which `order_line_refunds` and the per-line `status` need) and `market_2`. Applied too early, the SQL bodies fail validation inside the one transaction, so nothing is half-applied.
- The schema gate names all seven new signatures. It also requires `market_1`, `market_2`, `3a` and the cart migration, so this build cannot deploy without them.
- "Never make CZK storable before this is in" cannot be enforced by a sentinel, because the risk is a hand-applied `market_1` under old code. Both headers say so.
- The replica block is the migration word for word, and the replica change is additive only.

**App side.**
- Every reader of the five functions moved: grep of `src`, `scripts`, `tests`, and the Home and App repositories, which call none of them.
- No reporting figure is labelled with a literal currency. Overview keys windows by the payload's code, and Analytics, cards, the assistant tools and the CSV export carry it.
- Chart axes in English use the same `en-IE` formatter as `formatCents`; other locales use Intl's compact currency form.
- The plan calculator's null gives the default slider and the break-even line, never a false figure (`CostExplorer.tsx:56-58`, `UpgradeCard.tsx:77-88`).
- A null or unknown currency throws `UnknownCurrencyError`. That sends Overview and Analytics to their error page (as a failed RPC already did), makes the cards fail softly, and makes the assistant's dashboard and analytics tools fail. This is fail-closed and acceptable. Note the reach: if the market mirror row were ever missing, every seller with no sales would get the error page. Only the table owner can delete that row.
- `orders.currency` has a CHECK equal to `CURRENCIES` once `market_1` is in, so an unknown code needs drift.

**Fix commit, new code paths.**
- `readGateAccount`'s new branch fires only for a row with no key. All seven readers pass a raw PostgREST row selected with `READ_GATE_SELECT`, where the one-to-one embed is always present (null or an object). No caller builds a row by hand or passes the key as `undefined`. No legitimate reader is newly refused.
- `mayRefreshAccount`: the viewer is the active account on both paths (the return route, and `getPaymentsOverview`), the overview's default is "not owner", and no assistant tool reaches it.
- `createStorefront` can only see `server_error`, `market_restricted`, `trader_identity_required` or null, and handles each.
- The embed off-save cannot turn a buyer switch on.
- `quoteFromLines`' new `not_found` needs an empty line list, which `quoteOrder` already refuses (`quote.ts:159-161`). The cart checkout page returns to the cart for an empty cart, and the cart view handles a null currency. No real order or cart page is newly refused.
- The search route's strict currency drops only its own group, through `Promise.allSettled`, and logs it.
- `leadingSellBlock` gives the same block `sellerGateReasons` leads with.

**Copy.**
- `Analytics.sales.otherCurrencies` exists in all ten locales with `{currencies}`.
- The seven new keys exist in all ten locales, with `{email}` in both support sentences and no placeholder elsewhere:
  - `Dashboard.attention.sellerCountry.stripeUnknownSupport.label` and `.description`
  - `Errors.traderIdentityRequired.fix.countryAndConfirm`
  - `Errors.marketRestricted.stripeCountryUnknown.fixReload` and `.fixSupport`
  - `Errors.marketRestricted.supportAction`
  - `Onboarding.steps.payments.detailNeedsSeller`
- The Czech is grammatical and says what the English says. It writes "u Stripe" and "se Stripe" with the brand undeclined, as the existing strings do.
- No em or en dash in any added line of either commit. No line-ending flip in any of the 118 files changed since `ed69649`.

**Untouched.**
- `type: "express"` (`src/lib/payments/connect/account.ts:254`), the login links (`:309`) and `refund_application_fee` (`src/lib/orders/actions.ts:482`): no added or removed line mentions them.
- `0b93f0e` adds one migration file and changes no other. `20cd9c1` changes no file under `supabase/` or `tests/db/`.

## 6. Could not check

- Any run: type check, unit, component, db and e2e suites, build, browser. The author reports the first four green; I ran nothing.
- PostgREST's real overload resolution against these signatures. It is inferred from the signatures and from the explicit `null` the unit test pins.
- The Admin repository (for example whether anything there calls these functions), and whether other apps on the shared project add select policies on `orders` or `products` in production beyond the replica's.
- Production data: whether any store has orders in more than one currency, or live EUR products beside CZK ones. That decides how often H1 and H2 bite.
- Whether the test fakes model the embed key everywhere the stricter `readGateAccount` now needs it.
- That a `mailto:` row works through `AppLink` (next/link). I believe next/link leaves non-local URLs to the browser, but nothing here exercised it.
- The wording of the new strings outside English and Czech. I checked only presence and placeholders.
- Real Stripe behaviour.
