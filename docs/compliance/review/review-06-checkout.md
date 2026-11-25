# Review 06: checkout obeys the market (R3, R5, R6)

Commits under review, in the worktree `C:\dev\sq-market-review` (detached at `85dec0f`):

- `7c8a865` "Checkout obeys the market on the server (R3, R5, R6)", against `510c469`.
- `85dec0f` "Review round 5: any delivery rate is money; quote only through the market", against `7c8a865`.

Reviewer: independent, adversarial. Read-only. Nothing was built or run.

## 1. Verdict

| Rule | At `85dec0f` |
|---|---|
| R3 delivery country | **Clean** on every production path for a country outside the market: refused at the quote, again at placement on the country as sent, and again in the writer. One P3 hole in the writer's backstop for a parcel with NO country (N2), reachable only by a seller edit racing a checkout. |
| R5 several sellers | **Clean.** The placement check takes a list, dedupes it, refuses an empty list and any failing seller. A checkout is single-seller by construction today (the gate reads only the storefront owner's products; the writer refuses another seller's line). |
| R6 one check before money | **Clean.** Both order routes go through `placeOrderResponse`, which asks `checkoutMarketRefusal` after the quote and before `checkoutProviderFor`, any provider or any write. Every provider and the dev simulator end in the writer's backstop. |

| Commit | Verdict |
|---|---|
| `7c8a865` | **Mergeable as is.** N2 is a small follow-up (the backstop should ask "does this order ship" before it asks "did an address parse"). |
| `85dec0f` | **Mergeable as is.** M1, M2 and M3 are closed. N1 is not a regression, but the fix is narrower than its own claim. |

No way found to place an order or open a payment page that breaks R1, R2, R3 or R6.

## 2. Findings

| ID | Severity | Commit | Finding |
|---|---|---|---|
| N1 | minor | 85dec0f | "Delivery from" can still be set by a priced row no market buyer is ever quoted from: a catch-all row when every market country is named on another priced row, or a later row naming a market country an earlier row already names |
| N2 | P3 | 7c8a865 | The writer's backstop checks the address only when one parses. A parcel order with no or an unparseable address is written with `ship_to = null`. A download turned into a parcel between quote and write gives a paid parcel with no destination |
| N3 | nit | 7c8a865 | Two of the five "placing an order (R6)" tests stay green with the R6 call deleted: the quote refuses first. Only the seller case pins the call |
| N4 | nit | 85dec0f | The product form's delivery note still says "Delivery has no price in CZK" for terms whose priced rows only name countries outside the market, now that `canQuoteShipping` is false for them |
| N5 | nit | 7c8a865 | Czech and Slovak `delivery_outside_market` say "we deliver" (`doručujeme`); the English names no one, and Square Share does not deliver parcels |

## 4. Earlier findings (review-05)

| ID | Status | Evidence |
|---|---|---|
| M1 | **Closed** | `policyHoldsMoney` counts any row rate, any profile rate and a threshold (`rates.ts:83-89`). `shippingPolicyMarketProblem` asks it (`problems.ts:171`), and so does the Overview row through `dashboard/queries.ts:695`. Pinned at the predicate (`problems.test.ts`, `delivery-in-market.test.ts`), not through `saveShippingPolicy`; the action calls the same predicate on the compacted value, which keeps a countryless rate (review-05 M1), so the action refuses too (inferred, not run) |
| M2 | **Closed** | K2: Make active asserts `.in("currency", MARKET.currencies)` and a zero-row write re-read to the currency refusal (`product-card-actions.test.ts`). K4: a placed product outside the market is never `livePage` and the step links its form (`onboarding-steps.test.ts`). K5: the price-currency row is hidden under a market block, owner and member (`dashboard-attention.test.ts`). The suggested "re-read finds nothing: not found" case was not added; harmless |
| M3 | **Closed** | `docs/agent-surface.md:315-320` now says hidden "from every buyer surface that shows a price, quotes or charges" and names the embed tile list and the add-on page |
| M4 | Not in scope of 85dec0f | Unchanged; the new coverage cells use the same `name(` text match |

## 5. Verified and found correct (read in code, nothing run)

**Every way an order or a payment page is made.**
- Orders: both routes under `app/api/checkout/[storefrontId]` call `placeOrderResponse`; it calls `placeOrder` in `lib/checkout/provider.ts` (test or Stripe), which ends in the writer. The only other writer caller is the dev simulator (`app/dev/simulate-sale/route.dev.ts`, outside production builds). No assistant tool, edge function, script under `src` or webhook calls `recordPaidOrder`, `reservePendingOrder` or `order_place`. `order_place` is service_role only in every migration that defines it.
- Payment pages: `/checkout/sessions` is created only in `placeStripeOrder` (orders) and `lib/billing/stripe-provider.ts` (seller plans, not an order). `placeStripeOrder` is reached only from `provider.placeOrder`.
- The webhook confirms through `order_confirm_paid` and only alerts on a seller who left the market (`webhook.ts:225-231`): a paid order stays paid. Not changed by either commit.

**The placement check (`market-check.ts`, `place-order.ts:160-169`).**
- Runs after the quote and the shown-total check, before `checkoutProviderFor`, any provider and any write.
- Seller facts read fresh by owner id: `readEstablishmentCountry` (returns `ok: false` on a read error) and `readPaymentAccountResult` (same). Either failing, a missing profile, an account with no country, or a foreign or mismatched account refuses with `unavailable` 409. A throw in either read rejects the request with no order.
- Sellers are the storefront owner; the gate reads only that owner's products (`purchasable.ts:285`, `:455`), and the writer refuses any line of another owner (`record.ts:431-434`). A cart line from another storefront is `not_found`.
- Refusals: seller `unavailable` 409; currency `not_found` 409; missing country `invalid` 400 marking `shipTo` (the same answer as the existing parcel-without-address refusal); country outside `delivery_outside_market` 409. Quote refusals `delivery_outside_market` and `below_card_minimum` are 409, carry no line, and pass Buy now's `refusalFor` unchanged.

**The delivery country.**
- The body's `shipTo.country` is `z.enum(SHIPPING_COUNTRY_CODES)`: case or whitespace variants are refused at parse. The quote and the placement check both read `order.shipTo?.country`.
- A missing country on a parcel: the quote matches the catch-all with `""` (unchanged), then the placement check refuses it.
- An address on a download-only order is dropped before the provider (`place-order.ts:189`).
- The catch-all is expanded to the market in `deliverableCountries` (checkout list), `buyerCountry` (cart guess) and the quote's market check. The checkout's starting country is always one of the offered codes (`CheckoutView.tsx:143-148`). The client's own delivery preview can only be asked for an offered country. `canQuoteShipping` true implies the offered list is not empty.

**The card minimum.** Only on the quote at placement, only when `checkoutPaysByCard()` (false exactly when the test provider would be chosen), on items after every discount plus delivery, never on a zero total. CZK 15.00 matches Stripe. The buyer copy reads the same `minimumChargeCents` for the product's currency.

**Retries.** A refusal writes nothing, so a retry runs every check again. A repeat after success re-runs the market check (a seller who left is refused) and otherwise gets the same order and session.

**The `market` parameters.** No production caller passes one (`buyerCountry`, `deliverableCountries`, `deliveryPriceRange`, `canQuoteShipping`, `canPriceDelivery`, `simulatedShipTo`, `orderMarketProblem` checked); none is passed bare to an array method where an index could land in it; nothing parses a Market from a request; `no-override.test.ts` refuses any market list outside `market.ts`. Every function that takes a market forwards it to the market-taking calls inside it.

**85dec0f delivery quoting.** No legitimate store loses checkout: a priced row naming a market country (any case) or a priced catch-all keeps it; only terms whose priced rows all name countries outside the market lose it, which R3 requires. The page's offer (`canPriceDelivery`), the quote (`assessLines`) and the product form's button preview all ask the same `canQuoteShipping`. The one disagreement left is N1.

**Coverage cells flipped to enforced.** Each cited test calls the named entry point, and each cited source makes the named call: C-01/C-02 R3 (`quoteFromLines` calls `deliveryCountryProblem(`), R5 (`checkoutMarketRefusal` with two sellers), R6 (`placeOrderResponse`; the seller case fails without the call, see N3); O-01 R2 and R3 (`reservePendingOrder` and `recordPaidOrder` refused before any admin client; R3 true for a country outside, not for a missing one, N2); O-11 R2 (`simulatableProducts` filters, and `simulateSale` takes products and add-ons only from that list) and R3 (`simulatedShipTo`).

**Copy.** Both keys in all ten locales with `{countries}` and `{amount}`. Czech is grammatical and says what the English says (`nedosahuje {amount}, nejmenší částky` agrees in the genitive), apart from N5. German keeps `du`, French `vous`, as the rest of the file. No em or en dash added anywhere.

**No literals.** No currency or country literal in any added `src` line of either commit.

**Untouched.** No change under `supabase/` or `tests/db/`, nor to `lib/checkout/stripe-provider.ts` (charge type, amount, currency, `application_fee_amount`), `lib/payments/` (`type: "express"` at `account.ts:254`, login links at `:309`, the webhook), `lib/orders/actions.ts` (`refund_application_fee` at `:482`) or `lib/billing/`.

## 6. Could not check

- Any run: type check, unit, component and e2e suites, build, a browser. Nothing was run.
- N2's race in practice: whether a product's file can be cleared from the form while a checkout request is in flight is inferred from the schema and the update action, not driven.
- How Stripe answers a zero-total session (a free order now skips the minimum by design); unchanged by these commits.
- The wording of the new strings in languages other than English, Czech and (lightly) Slovak, German and French; presence and placeholders only.
- The Admin repository and the database's own demo simulator (out of scope, as briefed). The operator scripts under `scripts/` that write orders directly (inventory DB-05) are dev-gated and were not re-read.

Inferred rather than read: N2's race timing, N1's real rendering on a product page (from `ProductPageView.tsx:171-183` and the rate code), and M1 through the settings action (from review-05's reading of `compactShippingPolicy`).

## 3. Details

### N1. "Delivery from" counts rows no market buyer is quoted from (minor, 85dec0f)

- **Where:** `src/lib/shipping/rates.ts:340-342` (`deliveryPriceRange`) takes the minimum over `deliverableRows` (`:100-102`). A row is "deliverable" when it names a market country or is the catch-all (`isDeliverable`, `:93-97`). But `quoteShipping` (`:234-245`) picks the FIRST priced row naming the buyer's country, and the catch-all only when no row names it.
- **Verified in code:** no schema rule stops a country appearing on two rows (`src/lib/validation/shipping-policy.ts`, no cross-row refinement).
- **Scenario A (catch-all shadowed):**
  1. A Czech seller saves rows `Česko: CZ, 129 Kč` and `Everywhere else: *, 99 Kč`. Both pass the delivery-terms rule.
  2. Product page: `deliverableRows` keeps both, so it says "Delivery from 99 Kč" (`uniform: false`).
  3. Checkout for CZ, the only market country: the CZ row wins, 129 Kč. No buyer can get 99 Kč.
- **Scenario B (duplicate row):** rows `CZ, 129 Kč` then `CZ, 99 Kč`: the page says "from 99 Kč", checkout charges 129 Kč.
- **Also:** rows `CZ, 99 Kč` and `*, 300 Kč` say "Delivery from 99 Kč" where every market buyer pays exactly 99 Kč ("Delivery 99 Kč" would be right). Harmless.
- **Not a regression:** before 85dec0f every priced row counted, so the same pages said the same. But 85dec0f's claim ("a cheaper row outside the market never sets the promised price") holds only for rows that NAME an outside country. Money is never wrong: the checkout summary shows the real delivery before Pay.
- **Smallest fix:** derive the range from what checkout would quote: for each code in `deliverableCountries(policy, market)`, run the same row match as `quoteShipping` (direct match, else catch-all) and take the minimum and "uniform" over those rows' rates. The profile and threshold branches stay as they are.
- **Test:** in `tests/unit/market/delivery-in-market.test.ts`: `{ ratesCurrency: CURRENCY, destinations: [priced([IN], 900), priced([SHIP_ANYWHERE], 100)] }` gives `{ fromCents: 900, uniform: true }`; `[priced([IN], 900), priced([IN], 100)]` gives the same.

### N2. The writer's backstop fails open on a parcel with no address (P3, 7c8a865)

- **Where:** `src/lib/orders/record.ts:375-382`. The delivery check runs only when `parseShipTo(input.shipTo)` returns an address. Whether the order ships is decided later, from the product rows (`:439-441`), and a parcel with no parsed address is then written with `shipTo = null` (`:447`). The SQL accepts that: `ship_to` is only checked for type and size (`supabase/migrations/20260927_order_fulfilment.sql:88`, `:93`). `WRITE_PATH_INVENTORY.md` O-01 already flagged "a failed parse writes ship_to = null".
- **Scenario (verified paths, race inferred):**
  1. A buyer opens checkout for a download. The form sends no `shipTo`.
  2. While the request runs, the seller clears the product's file (`updateProduct` with `digitalFileKey: null`, allowed by `digitalFileKey: z.string().max(600).nullish()`, `src/lib/validation/product.ts:483`; applied at `src/lib/products/actions.ts:547`).
  3. The quote already said `ships: false`, so the placement check asks no country and `placeOrderResponse` hands the provider `shipTo: null` (`src/lib/checkout/place-order.ts:189`).
  4. The writer reads the product again: now a parcel. Its backstop saw no address and passed. The order is written `unfulfilled` with no destination, and the buyer pays on Stripe's page.
  5. The seller owes a parcel to an address that must be agreed off the platform, where R3 is not asked.
- **Why P3:** no order is recorded TO a country outside the market; it needs a seller edit inside a request's lifetime. The coverage cell O-01 R3 "enforced" is true for a country outside the market, not for a missing one.
- **Smallest fix:** after `ships` is known (`record.ts:441`) and before `order_place`: `if (ships && deliveryCountryProblem(parsedShipTo?.country ?? null) !== null) return { ok: false, reason: "outside_market" };`. Keep the currency check where it is. The early country check can then go, or stay as a cheap pre-check.
- **Test:** in `checkout-rules.test.ts`, "the order writer's backstop": a fake admin client that answers the product read with `digital_file_key: null`, and a `PaidCheckout` with no `shipTo`: expect `outside_market` and no `order_place` call. Today the test file's admin fake throws on first use, so this needs a small read fake.

### N3. Two R6 tests do not test R6 (nit, 7c8a865)

- **Where:** `tests/unit/market/checkout-rules.test.ts:268-280`. `place(ABROAD)` is refused by the quote (`delivery_outside_market`, `quote.ts:443-445`) and the outside currency by `assessLines` (`not_found`), both before `checkoutMarketRefusal` runs. Delete the call at `place-order.ts:163-169` and both stay green.
- **What does pin it:** the seller case (`:282-290`): the gate is mocked, so only the placement check can refuse, and it would answer 201 without it. The coverage cell R6 is therefore true.
- **Inherent limit, not a bug:** the quote and the placement check read the same `order.shipTo?.country`, so "as sent" cannot differ from "as quoted" through the route. The direct `checkoutMarketRefusal` cases (`:302-319`) cover the check itself.
- **Fix:** retitle the two cases as the quote's, or spy on `checkoutMarketRefusal` and assert it answered.

### N4. The product form's delivery note names the wrong problem (nit, 85dec0f)

- **Where:** `src/components/products/ShippingField.tsx:79` shows `shippingField.unpriced` ("Delivery has no price in {currency}, so buyers can't pay for this product at checkout.") whenever `canQuoteShipping` is false.
- **Change:** since 85dec0f that is also true for terms priced in koruna whose rows only name countries outside the market. The seller is sent to set prices they already have. The Overview row (shipping terms the market would refuse) names the real problem, so the seller is not stuck.
- **Fix:** ask `hasPricedDestination` beside it and, when terms are priced but not deliverable, show the market's countries sentence instead. Seller copy, so it may belong to the seller screens branch.

### N5. Czech and Slovak say "we deliver" (nit, 7c8a865)

- **Where:** `messages/cs/productPage.json` and `messages/sk/productPage.json`, `checkout.errors.delivery_outside_market`: "Objednávky zatím doručujeme jen do těchto zemí: {countries}." The English, German, French and others use a passive with no subject.
- **Why it matters a little:** Square Share does not carry parcels; the seller does. Grammatical and otherwise faithful.
- **Fix:** cs "Objednávky zatím lze doručit jen do těchto zemí: {countries}. Nic nebylo účtováno."; sk "Objednávky zatiaľ možno doručiť len do týchto krajín: {countries}. Nič nebolo účtované."
