# Review 05: commits 4fd6b1e and 510c469

Reviewer: independent (did not write either commit). Read-only review of `C:\dev\sq-market-review`, detached at `510c469`. `4fd6b1e` read as `git diff b73dae3 4fd6b1e`, `510c469` as `git diff 4fd6b1e 510c469`. Nothing was run. Date: 2026-11-23.

## 1. Verdicts

| Commit | Verdict |
|---|---|
| `4fd6b1e` Review rounds 3 and 4 | **Mergeable as is.** Every accepted finding is fixed in code and I found no new bug. M2 (three fixes with no test) and M3 (a doc promise not kept) can ride along with the next commit. |
| `510c469` Delivery terms | **Mergeable after one fix: M1.** The rule is checked on the value that is stored, on the only two writers, and the read side is untouched. But the test for "this policy holds money" misses a rate typed on a row with no countries, so euro delivery prices can still be saved from the ordinary settings form and are printed on product pages. |

- **Ways around R1, R2 or the delivery-terms write rule:** none around R1 or R2 for products. One way around the delivery-terms rule: a rate on a destination row with no countries can be saved in euros, or with no currency at all, and buyers then see it as a euro price (M1). No checkout is offered for it, so no money can move.
- **Cross-seller data exposure:** none found. The new reviews gate reads one product and its owner's gate columns with the service role and answers only yes, no or unknown. The resolver change keeps `security invoker`, so RLS still decides which orders are counted.

## 2. Findings

| ID | Severity | Commit | Finding |
|---|---|---|---|
| M1 | major | 510c469 | `policyHoldsMoney` counts only rows with a rate AND countries. A row with a rate and no countries passes with `ratesCurrency` EUR or none, and the product page prints it in euros |
| M2 | minor | 4fd6b1e | Three fixes have no test, so reverting any of them leaves the suite green: the currency condition on Make active (K2), the checklist's currency hold (K4), and hiding the price-currency row under a market block (K5) |
| M3 | nit | 4fd6b1e | `docs/agent-surface.md` still says a currency-hidden product is hidden "exactly like a takedown", which the K1 decision said would be dropped |
| M4 | nit | both | The source scans are narrower than their names: the call check has no left word boundary, the source-side gate check reads comments, the constant scan misses `satisfies` and renamed imports, and the legacy-reads guard is by path only |

No blocker.

## 3. Details

### M1. A rate on a row with no countries escapes the currency rule (major, 510c469)

- **Where:** `src/lib/shipping/rates.ts:75` `policyHoldsMoney` is `hasPricedDestination(policy) || Boolean(policy.freeOverCents)`. A row is "priced" only with a rate AND countries (`isPriced`, `:57`). `shippingPolicyMarketProblem` returns null for a policy that does not hold money (`src/lib/market/problems.ts:171`), so its currency is never asked.
- **Why it reaches a buyer:**
  - `compactShippingPolicy` keeps `rateCents` on a row with no countries (`src/lib/validation/shipping-policy.ts:273-274`).
  - The schema allows it, and the write schema caps it in the policy's own currency.
  - The product page's delivery prose prints every row's `rateCents`, priced or not, as `formatCents(rateCents, ratesCurrency ?? EUR)` (`src/lib/shipping/policy-prose.ts:122`, `:135`).
- **Concrete case, from the ordinary settings form:** the form shows the rate input on every row, whatever its countries (`src/components/settings/ShippingSection.tsx:483`), and its currency picker still lists every storable code. A seller picks EUR, writes one row "Celé Česko / 2 dny / 4.50" and picks no country. Save: accepted, stored as `{ ratesCurrency: "EUR", destinations: [{ area, time, rateCents: 450 }] }`. Every product page of the store then says "Celé Česko: 2 dny, €4.50". The same works through `save_shipping_policy`, and with `ratesCurrency` left out (read as euros by the legacy read).
- **What does not happen:** no money. With no priced row, `canQuoteShipping` is false, so checkout is not offered for a physical product (`src/lib/checkout/availability.ts:102-109`).
- **Also missed:** the Overview's new row reads the same predicate, so it stays silent for such a stored policy.
- **Smallest fix:** make `policyHoldsMoney` true for ANY rate: `(policy.destinations ?? []).some((row) => typeof row.rateCents === "number") || (policy.profiles ?? []).some((profile) => typeof profile.rateCents === "number") || Boolean(policy.freeOverCents)`. Profile rates are only quoted beside a priced row today, but they are money in the policy's currency, and counting them costs nothing. `ratesCurrencyToStartFrom` and the Overview row follow by themselves.
- **Test:** in `shipping-terms-write-paths.test.ts`, SH-01 and SH-02: `{ ratesCurrency: OUTSIDE_MARKET.currency, destinations: [{ area, time, rateCents: 450 }] }` is refused with the currency sentence; the same with no `ratesCurrency` is refused with `ratesCurrencyMissing`; nothing is written. In `dashboard-attention` or a `shippingFacts` unit test: such a stored policy gives `currency_not_allowed`.

### M2. Three fixes in 4fd6b1e have no test (minor)

The code is right in each case. Nothing pins it.

1. **K2, the conditional write.** `src/lib/products/card-actions.ts:107` adds `.in("currency", MARKET.currencies)` on Make active, and `:114-120` re-reads on zero rows. No test fakes a row that changes currency between the read and the write, and no test asserts the `in` filter. Deleting line 107 keeps `product-card-actions.test.ts` and `catalogue-currency-write-paths.test.ts` green.
   - Test: in `product-card-actions.test.ts`, the read answers a market currency, the update answers no row, the second read answers `OUTSIDE_MARKET.currency`. Expect the currency refusal, and the update's calls to contain `{ method: "in", args: ["currency", [...MARKET.currencies]] }`. A second case where the re-read finds nothing: not found.
2. **K4, the checklist's currency hold.** `src/lib/onboarding/steps.ts:225-233` and the new `publishStep` branch. `onboarding-steps.test.ts` gained only the H8 case; `get-store-market.test.ts` mocks a summary without `outsideMarketProductIds`.
   - Test: `buildSetupSteps` with one placed, active product in `outsideMarketProductIds`: the publish step is not done, `livePage` is null, the action links `productEditPath(id)`. Add a second placed market-currency product: `livePage` is that one.
3. **K5, the row half.** `src/lib/dashboard/attention.ts:278` hides `price-currency` under a market block. The shipping-terms row has that test (`dashboard-attention.test.ts:869-871`), the price-currency row does not.
   - Test: `build({ sellerGate: [OUTSIDE_THE_MARKET], products: { outsideMarketProductIds: ["p1"] } }).has("price-currency")` is false, and the same with `sellerGate: null, marketBlocked: true`.

### M3. The takedown claim is still in the agent doc (nit, 4fd6b1e)

- `docs/agent-surface.md:315-317` still says such a product "is hidden from every buyer surface (product page, boards, embed frame, sitemap, share image, quote) exactly like a takedown".
- The K1 decision in `COMPLIANCE_PROGRESS.md` says "the documents stop claiming absent everywhere", and keeps the embed JSON tile and the add-on host as they are.
- **Fix:** say it is hidden from every surface that shows a price, quotes or charges, and name the two that still answer (the embed JSON's tile, a hidden host's add-on page).

### M4. The scans are narrower than their names (nit, both)

Each of these can pass without the property holding. None is wrong code today.

1. `tests/unit/market/coverage.test.ts:607`: a call counts when the test text includes `name(`, with no word boundary before it. A test that only calls `resaveShippingPolicy(` would pass for `saveShippingPolicy`. Fix: match with a lookbehind such as `(?<![\w$.])` before the name, on `callsOfText`.
2. `coverage.test.ts:656`: the source side checks the raw function body, comments and strings included. A comment that mentions `shippingPolicyMarketProblem(` would keep SH-01 green after the call is deleted. Fix: run the body through `callsOfText` first. For SH-02 the "function" is the whole `storefrontTools` array (`fn: "storefrontTools"`), which is coarse but true today.
3. `tests/unit/market/currencies.test.ts:133-135`: a constant is found only when its value is a bare code, optionally `as X`. `const L = "EUR" satisfies Currency;` and `import { LEGACY_RATES_CURRENCY as L }` then `?? L` both pass. The comment lists other blind spots but not these two.
4. `currencies.test.ts:289-295`: the test title says the legacy list never holds "the form's own default", but the guard is by path. The form's default moved from `ShippingSection.tsx` into `ratesCurrencyToStartFrom` (`src/lib/shipping/rates.ts:93`), which is on the list, with an owner text that says so. Its behaviour is defensible: it returns euros only for a stored policy that holds money and names no currency, and the save is then refused. The test name should say so.

## 4. Earlier findings, as they stand at 510c469

| ID | Status | Evidence |
|---|---|---|
| H1 | **Closed** | The resolver orders by the newest PAID order, `nulls last`, then the newest order, then the code (`supabase/migrations/20261122_market_8_reporting_currency.sql:142-152`). Ties are deterministic. A store with only pending orders gets the market default. Orders' `currency` and `created_at` are not null, so no null case. Test 54 pins a newer paid sale moving it, a newer refund not moving it, refunded only, disputed only. The replay block is byte-identical (compared with `cmp`, 595 lines from `tests/db/prod-migrations.sql:15297`). The schema gate pins the new body (`scripts/lib/prod-schema.ts`, `c.latest_paid desc nulls last`). Alternating PAID sales still move the figures, but R2 now keeps new paid orders in the market currency, so that half is moot |
| H2 | **Closed** | The author kept units in one currency, as allowed. The header says the filter was added and narrows units; the Products page shows `OtherCurrenciesNote` above the cards; test 54 pins units and the units ranking both ways |
| H3 | **Deliberately left; reason holds** | Overview keeps every currency's dispute visible; Analytics analyses one currency. The migration header now says the two counts can differ, which was the other half of the suggested fix |
| H4 | **Closed** | The header now says the filter was added to the two product functions, and lists the Products list failure in the apply note (`:82-88`) |
| H5 | **Partly closed** | A disputed order is seeded and asserted; each of the five old overloads is called once with exact sums. Nothing goes through PostgREST, which the db project cannot do |
| H6 | **Deliberately left; no reason recorded** | Not mentioned in `COMPLIANCE_PROGRESS.md`. Leaving it is harmless: the guard against a mixed comparison is correct; it costs three resolutions per Analytics page |
| H7 | **Closed** | `unknownCountryWayOut(connectLive, actorIsOwner)` gives Payments only to the owner while Connect is live; every caller passes an `ActiveAccount` (typed `SellerGateActor`, so a bare id no longer compiles). The card gives "reload" only when `refreshable` (`ConnectionStatusCard.tsx:44`), set from the viewer in `realPaymentsOverview`. The one direct `"payments"` (`payments/connect/actions.ts:47`) is behind an owner-only, Connect-live check. Tested for owner, member and editor |
| H8 | **Closed** | `marketUnchecked` gives the state `"unchecked"`: not done, no link, the gate's own failure sentence (`steps.ts:513`). Tested |
| H9 | **Closed, with residual limits** | Named constants and default parameters are scanned with a pending list; strings are emptied before the call check. Remaining blind spots: M4 |
| K1 | **Partly closed; the part left is acceptable, the doc is not fixed** | The reviews GET now asks `reviewsArePublic` (currency, takedown, seller gate), fails closed with 503 on either read error, costs one extra indexed read per request behind the per-IP limit, and leaves the POST on `isReviewableProduct`. Left: the embed JSON tile and a hidden host's add-on page. The reason (neither shows a price for the hidden product) holds for R2. Doc: M3 |
| K2 | **Closed in code, untested** | M2.1. A legitimately active market-currency product is never refused: the filter is the market's own list, and the zero-row path re-reads before refusing |
| K3 | **Deliberately left; reason holds** | A draft is not an offer and no draft reaches a buyer read. Whether rule (b)'s own wording was updated to match, I could not find |
| K4 | **Closed in code, untested** | Both callers pass `outsideMarketProductIds`; such a product is never `live`, and the step links its form with the refusal's own words. M2.2 |
| K5 | **Closed in code, half untested** | Every publish path asks the seller gate first, and only for `active`: `createProduct`, `updateProduct` (form, designer tile, `update_product`), `setProductStatus`, `importProducts`, `publish_products` (once per batch, then again in each write). No draft write asks the gate. The Overview passes `marketBlocked` for anyone looking. M2.3 |
| K6 | **Deliberately left; reason holds** | Moved to the seller screens branch. Seller-side marking only; nothing reaches a buyer |
| K7 | **Closed** | `updateProduct` adds the form link when the currency is kept (`src/lib/products/actions.ts:519`). Tested |
| K8 | **Closed** | `get_schema` says which currencies are accepted now (`SCHEMA_CURRENCY_NOTE`) and, since 510c469, the delivery terms rule |
| K9 | **Closed** | `count` is passed; all ten locales use a valid `plural` (Czech, Polish and Slovak with `few` and `many`) |

## 5. Delivery terms (510c469): the hunt

**Every writer of a seller's delivery terms.**
- `profiles.shipping_policy` has one app writer: `saveShippingPolicy` (`src/lib/settings/shipping-actions.ts`), through `writeOwnProfile`. The assistant's `save_shipping_policy` calls that same action.
- Storefront configs: `policies` and `shippingProfiles` are retired top-level members, dropped before the strict parse (`src/lib/validation/storefront.ts`, `RETIRED_TOP_LEVEL_FIELDS`). No config member holds countries or rates.
- Products hold only `shippingProfileId`, a reference.
- Onboarding, the sample storefront and the sample cart write no policy. Imports touch products only. `predictShippingDefaults` suggests only `shipsFrom` and a market currency (`usualCurrency` filters by the market).
- PostgREST on `profiles` (SH-03) stays pending, as briefed.

**On the value stored.** The action compacts, parses, asks `shippingPolicyMarketProblem(parsed.data)` (`:108`), and writes that same `parsed.data`. The tool's earlier check (`src/lib/agent/tools/storefronts.ts:475`) is on the raw input, a slightly different shape, but it only adds the settings link: the action asks again on the compacted value. The check runs before the rate limit and writes nothing when it refuses (tested).

**The catch-all row.** On the write side `*` is always accepted and is the same stored token whatever the seller means by it. It cannot be made to name a country outside the market here. What it MEANS is decided by checkout, which still matches `*` for any buyer country (the checkout branch). Its area label is free text ("Worldwide"), printed as written.

**A legacy policy sent back unchanged.** Refused, by design: one with another country gets the countries sentence, one with euro rates the currency sentence, one with money and no currency the missing-currency sentence. So the seller cannot save an unrelated returns edit until the delivery part follows the market. The new Overview row tells them first. The form opens a legacy priced policy in euros, so the amounts are not relabelled silently.

**Free text is out of reach.** A row's `cost` text ("€4.50") and `area` text are printed as typed. This is inherent to free text and not a finding.

**The read side is not narrowed.** `storedShippingPolicySchema`, `buildShippingPolicy`, `policy-prose.ts`, checkout and cart are unchanged by 510c469. Only the WRITE schema's rate cap changed: no named currency now means the tightest cap of any currency.

**What a buyer sees today for a stored policy naming Germany with euro rates (input for the next branch):**
- **Product page, delivery fold:** every row as stored, for example "Germany: 3-5 days, €4.50", and a free-delivery threshold in euros.
- **No "Delivery from" line:** `deliveryPriceRange` is null because the policy's currency is not the product's.
- **No checkout for a physical product:** `canPriceDelivery` is false, so the page falls back to the seller's link or an enquiry.
- **Cart:** no threshold and no delivery quote.
- **The same terms in koruna:** checkout IS offered, and a buyer can pick Germany and be quoted. That is the checkout branch.

## 6. Verified and found correct

**4fd6b1e.**
- Resolver: see H1. The replay block and test 54 agree with it.
- `setProductStatus` writes only a row still in a market currency. When no row matches, the seller sees the currency refusal (named from a fresh read), or "not found" if the row is gone, or a server error if it exists in a market currency but still did not match. `precheck` only previews, so a refused write leaves nothing behind.
- Seller gate before the currency rule on every publish path; drafts never ask the gate.
- Every way out now depends on who acts.
- The new checklist states render: `Errors` ships in the app shell's client scope, and every key used exists in English.
- No currency or country literal in any added `src` line of either commit.
- No em or en dash added.
- No line-ending flip in any modified file.

**510c469.**
- The refusal: one sentence per problem; the countries in the reader's language from `MARKET` via `Intl.DisplayNames` and `Intl.ListFormat`; the currency refusal reuses `currencyRestricted` with a new `shipping` fix.
- Copy: the new keys exist in all ten locales with the same placeholders: `{countries}` and `{refused}` for the countries refusal, `{currencies}` for the others, `{countries}` and `{currencies}` for the Overview row.
- Czech: grammatical and says what the English says. Names come after a colon ("jen do těchto zemí: Česko", "Odeberte z cílů doručení tyto země: ..."), so no declension is needed. With one market country, "these countries:" before a single name reads a little stiffly in every language but English. Acceptable.
- Overview row:
  - It is built from the profile row the Overview already reads, with no extra read.
  - It is hidden when there is no profile, when the stored policy passes, and while the market refuses the seller (owner or member).
  - Its link goes to the destinations for a country problem and to the rates card for a currency problem.
- New policy defaults: a new policy starts in the catalogue's market currency, else the market's default. A stored priced policy with no currency opens in euros. A stored policy with no money opens on its own currency, else as new.
- `no-override.test.ts` ignoring `import type` is safe:
  - Type-only imports are erased at build, so they cannot carry a switch.
  - `import { type A }` is still checked, because it can leave a side-effect import.
  - The new runtime imports in the market module (`@/lib/format/country`, and through it `@/lib/format/intl`; `@/lib/shipping/rates`, which now imports `@/lib/market/market`) are pure.
- Allow-list of legacy euro reads, entry by entry:
  - prose, `canQuoteShipping`, `quoteShipping`, `freeOverCentsIn`: each reads a stored policy.
  - `ratesCurrencyToStartFrom`: the form's starting state for a stored policy, refused on save (M4.4).
  - The write schema's euro default is gone.
- Coverage cells: SH-01 and SH-02 flipped to enforced are really driven. The test calls `saveShippingPolicy(` and the tool's handler by name, and both sources make the call.
- Tests that cannot fail: none found in the new write-path test. Each case asserts the refusal key, the absence of a write and, where relevant, the absence of a rate-limit charge.

**Untouched.**
- `type: "express"` (`src/lib/payments/connect/account.ts:254`), the login links (`:309`) and `refund_application_fee` (`src/lib/orders/actions.ts:482`): neither file changed in either commit.
- Under `supabase/` and `tests/db/`, the two commits change only `20261122_market_8_reporting_currency.sql` and its replay block.

## 7. Could not check

- Any run: type check, unit, component, db and e2e suites, build, browser. Nothing was run.
- The real rendering of the M1 case on a product page; it is inferred from `policy-prose.ts` and the form's markup.
- PostgREST's handling of `.in("currency", ...)` combined with `.maybeSingle()` on an update returning no row (assumed: no error, `data` null, as for `.eq`).
- What `getLocale()` returns inside an MCP tool call; if it is the default, the assistant's refusal names countries in English.
- Whether rule (b)'s wording was updated for the K3 decision.
- The Admin repository, and whether anything outside this repo writes `profiles.shipping_policy`.
- The wording of the new strings in languages other than English and Czech; I checked presence, placeholders and plural forms only.
