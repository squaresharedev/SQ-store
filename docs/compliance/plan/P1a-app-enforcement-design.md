# P1a: Application-side enforcement of the Czech-only beta (Store)

Design document, 2026-11-22. Scope: the TypeScript side in the Store repo (market config module, validation layer, CZK support, seller gate, checkout enforcement, Stripe country handling). The database side (guards, migrations, the `market_rules` mirror, monitoring SQL) is the sibling P1b design; the interface between the two is in 1.7 and 10.

Nothing here has been built. Every `file:line` below was read on disk at `main` / `e43eedd` unless marked (from report NN), which means the line comes from an inventory report and was not re-opened for this design. Stripe facts were read from docs.stripe.com on 2026-11-22 (list in 11.4).

Rule names R1 to R6 are the brief's. "Storable" means "may be stored and must keep rendering"; "allowed" means "may be newly sold now".

---

## 0. Decisions in one page

1. **One root, `src/lib/market/market.ts`, exporting `MARKET`** (sellerCountries, shippingCountries, billingCountries, currencies), a `Market` type and one predicate `marketAllows`. Pure, typed, no I/O, no environment read. Every validator takes `market: Market = MARKET`, so tests can widen it; production code never passes another value.
2. **Storable lists stay where they are** (`CURRENCIES` in `src/types/product.ts:12`, `OPERATING_COUNTRY_CODES` and `SHIPPING_COUNTRY_CODES` in `src/lib/settings/constants.ts:110-136`). `MARKET` is typed as a subset of them, so a market code that cannot be stored does not compile. CZK is added to the storable currency list; EUR and USD stay storable so existing rows keep parsing and rendering.
3. **`toCurrency` is deleted** and replaced by an exact `parseCurrency` (request data) and a throwing `storedCurrency` (database columns whose CHECK guarantees the value). This lands first, before CZK exists anywhere, so no commit can charge a CZK product in EUR.
4. **The seller gate becomes one pure predicate with named reasons** (`sellerGateReasons`): "details missing" (now including the country of establishment) and "market" stay separate reasons with separate copy and error codes, and 1B adds its reasons to the same list. The country of establishment is read through one accessor, `establishmentCountryOf`, interim source `profiles.tax_country`.
5. **Choke points, not call sites.** The seller gate covers every publish write and every buyer read; `assessLines` covers every line a buyer can buy (quote, cart, quick add); `quoteFromLines` covers delivery and billing country for every order; `placeOrderResponse` runs the multi-seller-ready `checkoutMarketProblem` once per order; `canTakePayments` and `placeStripeOrder` cover the Stripe account country. The order writer and the database guards are the backstop.
6. **R4**: a new `billingCountry` field on the checkout body, required when the order has a download, checked against `MARKET.billingCountries`, stored as `orders.billing_country`. Stripe is asked to collect the billing address for those orders; the webhook records Stripe's billing country and the card's issuing country, flags disagreement to ops, never refuses or refunds.
7. **No runtime off switch.** The deploy is the switch; the rollout is staged by branch order and a pre-deploy dry-run report (7.3).

---

## 1. The market module

### 1.1 File layout

| File | Contents | Client-safe |
|---|---|---|
| `src/lib/market/market.ts` | THE ROOT: `MARKET`, `Market`, `MarketDimension`, `MARKET_DIMENSIONS`, `MARKET_SQL_DIMENSION`, `marketAllows`, `marketDefaultCurrency` | yes |
| `src/lib/market/currencies.ts` | Currency facts keyed by the storable `Currency`: `CURRENCY_RULES` (minimum charge, flat delivery cap, whole-unit display), `parseCurrency`, `storedCurrency`, `UnknownCurrencyError`, `minimumChargeCents`, `homeCurrency` (moved from `predictions.ts`) | yes |
| `src/lib/market/problems.ts` | The pure validators (section 2.1), the problem unions, `offeredInMarket` | yes |
| `src/lib/market/copy.ts` | `marketCountryList(dimension, locale, market)`, `marketCurrencyList(locale, market)`: names and ICU values derived from `MARKET` | yes |
| `src/lib/market/refusal.ts` | SERVER ONLY. `marketRefusal(problem, context)`: resolves the request locale and calls the sync factory in `lib/errors.ts` | no |
| `src/lib/errors.ts` (edit) | New `ActionErrorCode` `"market_restricted"` and the sync factory `marketRestricted(problem, context, values)` (house rule: errors are built by factories in this file, `src/lib/errors.ts:25-26`) | yes |
| `tests/setup/market.ts` (new) | Test-only: `MARKET_FIXTURE`, `OUTSIDE_MARKET`, `OPEN_MARKET`, `marketWith()` (1.5) | n/a |

No barrel `index.ts`: the codebase imports modules by path (for example `@/lib/checkout/quote`, `@/lib/settings/seller-identity`).

### 1.2 Exported names and types

```ts
// src/lib/market/market.ts
import type { Currency } from "@/types/product";
import type { OperatingCountryCode } from "@/lib/format/country";      // src/lib/format/country.ts:4
import type { ShippingCountryCode } from "@/lib/settings/constants";   // src/lib/settings/constants.ts:139

type NonEmpty<T> = readonly [T, ...T[]];

/** Where Square Share may sell right now. A SUBSET of what may be stored:
 *  every code here must also be in the storable list of its kind, and the
 *  type system refuses one that is not. Widening this is the whole of
 *  "opening a country": see docs/compliance/plan/P1a section 9. */
export type Market = {
  /** Country of establishment AND Stripe account country (R1). */
  readonly sellerCountries: NonEmpty<OperatingCountryCode>;
  /** Where a physical order may be delivered (R3). */
  readonly shippingCountries: NonEmpty<ShippingCountryCode>;
  /** Where a buyer of a download may be billed (R4). */
  readonly billingCountries: NonEmpty<OperatingCountryCode>;
  /** What a new price may be set in and what checkout may charge (R2).
   *  The first is the default for a seller with nothing priced yet. */
  readonly currencies: NonEmpty<Currency>;
};

export const MARKET = {
  sellerCountries: ["CZ"],
  shippingCountries: ["CZ"],
  billingCountries: ["CZ"],
  currencies: ["CZK"],
} as const satisfies Market;

export type MarketDimension = keyof Market;
export const MARKET_DIMENSIONS = ["sellerCountries", "shippingCountries", "billingCountries", "currencies"] as const satisfies readonly MarketDimension[];

/** The mirror's names for each dimension (market_rules, P1b). Read by the drift tests only. */
export const MARKET_SQL_DIMENSION = {
  sellerCountries: "seller_country",
  shippingCountries: "shipping_country",
  billingCountries: "billing_country",
  currencies: "currency",
} as const satisfies Record<MarketDimension, string>;

/** THE predicate. Exact, case-sensitive match on the stored spelling (upper-case ISO codes). */
export function marketAllows(dimension: MarketDimension, code: string | null | undefined, market: Market = MARKET): boolean;

/** The currency a seller with nothing priced starts in. */
export function marketDefaultCurrency(market: Market = MARKET): Currency; // market.currencies[0]
```

**Why these names.** The codebase spells configuration as one upper-case constant per concern (`RATE_LIMITS`, `PLANS`, `CURRENCIES`, `ORDER_CHANNELS`); the four lists are one decision reviewed together and substituted together in tests, so they are one object rather than four `ALLOWED_*` constants. Dimension keys are plural nouns as in the brief. Non-empty tuples let `z.enum(MARKET.currencies)` type-check (MCP tool inputs, 6.2) and make `[0]` safe. Validators follow the house naming: pure `xxxProblem` functions returning a problem code or `null` (as `addressQualityProblem`, `emailQualityProblem`), and async `xxxRefusal` helpers returning `ActionError | null` (as `addOnRefusal`, `badgeRefusal`, `sellerTextRefusal`).

`OperatingCountryCode` today is derived in `src/lib/format/country.ts:4` from `OPERATING_COUNTRIES`. It stays there (moving it would touch every importer for no gain).

### 1.3 Storable lists versus allowed lists

| Kind | STORABLE (parse, store, render; never narrowed for the beta) | ALLOWED NOW (`MARKET`) | Who reads which |
|---|---|---|---|
| Currency | `CURRENCIES` `src/types/product.ts:12`: today EUR, USD; becomes EUR, USD, CZK. Mirrored by three SQL CHECKs (from report 02: `prod-migrations.sql:157`, `20261004_discounts.sql:91`, `:253`) | `MARKET.currencies` = CZK | Storable: every reader, `productWriteSchema` enum `src/lib/validation/product.ts:478`, discount enum `src/lib/validation/discounts.ts:41`, shipping `ratesCurrency` enum `src/lib/validation/shipping-policy.ts:79`, `discountValueOf` `src/lib/discounts/row.ts:42`. Allowed: every write validator, `assessLines`, UI pickers, MCP inputs |
| Seller country | `OPERATING_COUNTRY_CODES` `src/lib/settings/constants.ts:116` (EU 27 + US + CA, the area the Terms name) | `MARKET.sellerCountries` = CZ | Storable: `taxSchema.tax_country` `src/lib/validation/settings.ts:131-136` (unchanged, see 4.4), `shipsFrom` `src/lib/validation/shipping-policy.ts:71-76`. Allowed: the seller gate, Stripe account creation, `canTakePayments` |
| Delivery country | `SHIPPING_COUNTRY_CODES` `src/lib/settings/constants.ts:129-136` | `MARKET.shippingCountries` = CZ | Storable: `shipToSchema.country` `src/lib/validation/checkout.ts:41`, destination rows `src/lib/validation/shipping-policy.ts:44-59` (so a stored policy naming DE still parses and the returns window never shrinks, report 03 section 1.3). Allowed: policy save validator, `quoteFromLines`, checkout picker, cart guess |
| Billing country | `OPERATING_COUNTRY_CODES` (refine, as `taxSchema` does) | `MARKET.billingCountries` = CZ | New body field (5.2) |

Comment edits that go with this (no value change): `CURRENCIES` doc ("EUR is primary", `src/types/product.ts:11`) becomes "what may be STORED and read; what may be newly sold is MARKET.currencies"; `OPERATING_COUNTRIES` doc (`src/lib/settings/constants.ts:104-109`, "checkout only delivers inside it") becomes "the area the Terms name; the beta sells in MARKET, a subset".

### 1.4 How copy derives from the module

- Country names: `marketCountryList(dimension, locale, market)` maps each code through `regionName(code, locale)` (`src/lib/format/country.ts:46-64`, which keeps the deliberate English "Czechia" from `EU_COUNTRIES`) and joins them with the existing `listFormat(locale, { type: "conjunction" })` (`src/lib/format/intl.ts:54`). Today it yields "Czechia" / "Česko"; with SK added, "Czechia and Slovakia" with no copy change.
- Currency names: `marketCurrencyList(locale, market)` uses `currencySymbol` (`src/lib/format/money.ts:39-53`) or the ISO code, joined the same way.
- Messages take `{countries}` / `{currencies}` plus `{count}` for ICU plurals. No message spells "CZ", "Czechia", "CZK" or "Kč".
- Server-built errors: `marketRefusal` (server) resolves the request locale with next-intl and passes the formatted list into the sync `marketRestricted` factory as a message value. Buyer-side copy in the checkout is formatted in the browser from the same helper (client-safe).
- Translator rule (Czech, Slovak, Polish decline country names): write every message so the list sits in a nominative position ("Doručujeme jen do těchto zemí: {countries}."), never after a preposition that demands another case. Put this rule in the translator brief used by the bulk translation recipe.

### 1.5 Widening the market in tests (the EU-expansion acceptance criterion)

- Every validator and every function that consults the market takes a trailing `market: Market = MARKET` parameter: the `problems.ts` validators, `sellerGateReasons`, `sellerMaySell`, `assessLines`, `quoteFromLines`, `canTakePayments`, `offeredInMarket`. Production callers never pass it.
- `tests/setup/market.ts` (test code only) exports:
  - `MARKET_FIXTURE = { sellerCountry: MARKET.sellerCountries[0], shippingCountry: MARKET.shippingCountries[0], billingCountry: MARKET.billingCountries[0], currency: MARKET.currencies[0] }`
  - `OUTSIDE_MARKET`: per dimension, the first storable code that is not in `MARKET` (computed, so it stays "outside" after any expansion)
  - `OPEN_MARKET`: every storable code in every dimension (for tests that are not about the market but pass through a market-aware function)
  - `marketWith(partial)`: `MARKET` with lists replaced, for the acceptance test.
- The acceptance test (`tests/unit/market/expansion.test.ts`) builds `marketWith({ sellerCountries: ["CZ","SK"], shippingCountries: ["CZ","SK"], billingCountries: ["CZ","SK"], currencies: ["CZK","EUR"] })` and asserts that an SK seller, an EUR product, an SK delivery and an SK billing country pass every validator and the pure quote, and that the real `MARKET` refuses each. That is the proof that expansion is config only, for every code path that takes `market`.
- **Never an environment override.** A guard test (`tests/unit/market/no-override.test.ts`) fails if any file under `src/lib/market/` mentions `process.env`, if any file under `src/` imports from `tests/`, or if any file under `src/` (outside `src/lib/market/`) passes a `market:` argument or names `OPEN_MARKET`/`marketWith`.

### 1.6 Constants the module replaces or feeds

| Existing | Where | What happens |
|---|---|---|
| `toCurrency` (non-USD becomes EUR) | `src/lib/format/money.ts:10-14`, 29 call sites outside the file (grep, listed in report 02 C5) | Deleted; replaced by `parseCurrency` / `storedCurrency` (3.1) |
| Inline fold `row.currency === "USD" ? "USD" : "EUR"` | `src/lib/products/queries.ts:143` | `storedCurrency(row.currency)` |
| `CURRENCIES` | `src/types/product.ts:12` | Storable list, gains CZK; market writes read `MARKET.currencies` |
| `DOLLAR_COUNTRIES`, `homeCurrency` | `src/lib/predictions.ts:248-257` | Replaced by `homeCurrency(country, market)` in `currencies.ts`: the country's home currency if allowed, else `marketDefaultCurrency` |
| `usualCurrency` suggestion | `src/lib/predictions.ts:244-246`, used `:266`, `:401` | Fed: recent currencies filtered to `MARKET.currencies` first, so a legacy EUR catalogue never suggests EUR |
| `MIN_PAYABLE_CENTS = 50` | `src/lib/discounts/pricing.ts:31-33`, read `:45` | Replaced by `minimumChargeCents(currency)` (EUR 50, USD 50, CZK 1500) |
| `SHIPPING_RATE_MAX_CENTS = 100_000` | `src/types/shipping-policy.ts:113-115`, read `src/lib/validation/shipping-policy.ts:60-64` | Kept as the storage bound; a per-currency cap from `CURRENCY_RULES` (CZK 2 500 000 haléřů = 25 000 Kč, EUR/USD unchanged) is applied by a `superRefine` keyed on `ratesCurrency` |
| `PRICE_CENTS_MAX = 100_000_000` | `src/lib/validation/product.ts:218-219` | Kept, currency-neutral sanity bound (1 000 000 Kč, within Stripe's 9-digit American Express limit). Comment "€/$1,000,000" corrected |
| `ratesCurrency` absent means EUR | `src/lib/shipping/rates.ts:118`, `:149`, `:276`; `src/lib/shipping/policy-prose.ts:122` (from report 02); `src/components/settings/ShippingSection.tsx:203`; `src/types/shipping-policy.ts:56-59` | One named token `LEGACY_RATES_CURRENCY: Currency = "EUR"` beside `SHIP_ANYWHERE` in `src/types/shipping-policy.ts` (the meaning of a stored policy written before the field existed); saves always write `ratesCurrency` (6) |
| `CURRENCY_SYMBOLS` hand map | `src/components/products/PriceField.tsx:14` | Deleted; `currencySymbol(currency, locale)` from `src/lib/format/money.ts:39` |
| Chart symbol `code === "USD" ? "$" : "€"` | `src/components/analytics/chart-format.ts:22`, `:41` | `currencySymbol` |
| EUR-first sort | `src/lib/dashboard/format.ts:20` | Sort `MARKET.currencies` first, then storable order |
| Form, import, discount, cart defaults `"EUR"` | `src/components/products/ProductForm.tsx:261`, `src/components/products/ProductImport.tsx:85`, `src/components/discounts/DiscountForm.tsx:115`, `:132`, `src/components/cart/CartPanel.tsx:92`, `:148`, `src/components/cart/CartSuggestions.tsx:36` (from report 02) | `marketDefaultCurrency()` |
| Quote fallback `?? "EUR"` | `src/lib/checkout/quote.ts:330` | Removed: `priceAssessedLines` is only called with at least one sellable line; an empty list returns the market default for type completeness |
| Analytics totals `currency: "EUR"` | `src/lib/analytics/queries.ts:212`, `:292` | Read from the aggregate's currency (8: depends on P1b rewriting `currency <> 'USD'`) |
| `FALLBACK_CURRENCY = "EUR"` | `src/lib/payments/connect/overview.ts:57` (from report 02) | `marketDefaultCurrency()` |
| Search money label | `src/app/api/search/route.ts:82`, `:254` | Raw stored code (no fold) |
| Sample storefront currency and seller `"PT"` | `src/lib/storefront/sample.ts:74`, `:198-203` (from report 02) | `MARKET_FIXTURE`-like constants from the market (UI branch) |
| `SHIPPING_COUNTRY_CODES` used as "where checkout delivers" | `src/components/checkout/CheckoutView.tsx:140` ("*" expansion), `src/lib/cart/route.ts:46-49` (cf-ipcountry guess) | `MARKET.shippingCountries` |
| `operatingCountries()` picker list | `src/lib/format/country.ts:69-78` | Fed: market countries pinned first (UI) |
| `EU_COUNTRY_CODES` (statutory text) | `src/lib/settings/constants.ts:102`, `src/lib/storefront/product-page.ts:168-196` (from report 01) | Untouched: EU rights follow EU law, not the beta |
| `BILLING_CURRENCY = "EUR"` (plan prices) | `src/lib/billing/plans.ts:39` (from report 02) | Untouched: seller plans are a separate question (11.2 Q5) |

### 1.7 The database mirror (interface with P1b)

- TypeScript is the root. Nothing in `src/` reads `market_rules` at run time.
- `MARKET_SQL_DIMENSION` names the mirror's dimension values. Request to P1b: write every mirror change as ONE full-state statement per migration whose literal is JSON keyed by those names (for example a `market_rules_replace(jsonb)` call), so the unit drift test can take the last such literal in `supabase/migrations/` and compare it with `MARKET` exactly.
- Drift tests (pattern: `tests/unit/order-channel.test.ts:82-102` parses SQL; `tests/integration/29-seller-plans.test.ts:89-100` probes exhaustively, from report 09):
  1. Unit: `tests/unit/market/market-mirror-sql.test.ts`: the last mirror literal in the migrations equals `MARKET`, dimension by dimension.
  2. DB project (authoritative, runs on the embedded replica with every migration applied): `tests/integration/5x-market-rules.test.ts` reads `market_rules` and asserts set equality with `MARKET`.
  3. Unit: `tests/unit/market/storable-currency-sql.test.ts`: the LAST definition of each currency CHECK (products, discounts amount, product_price_history) lists exactly `CURRENCIES`.
- Production: `scripts/lib/prod-schema.ts:27-37` already supports `check` and `relation` requirements. Each DB-coupled branch adds sentinels so a deploy refuses until the owner has applied the migration (7).

---

## 2. The validation layer

### 2.1 The validators

All pure, client-safe, in `src/lib/market/problems.ts` unless noted. "Code" is the machine code an action or route answers with.

| Validator | Signature | Returns | Code / i18n key |
|---|---|---|---|
| `marketAllows` | `(dimension, code, market?) => boolean` | membership | n/a |
| `sellerMarketProblem` | `({ establishmentCountry, stripeCountry? }: SellerMarketFacts, market?) => SellerMarketProblem \| null` | `"seller_country_not_allowed"` (declared country outside the market), `"stripe_country_not_allowed"` (a Stripe account exists in a country outside the market), `"seller_country_mismatch"` (both known and different). A missing declared country is NOT a market problem: it is a missing detail (4.2) | `market_restricted`; `Errors.market.sellerCountry.*`, `Errors.market.stripeCountry.*`, `Errors.market.countryMismatch.*` |
| `currencyProblem` | `(currency: string, market?) => "currency_not_allowed" \| null` | | `market_restricted`; `Errors.market.currency.message` + `.fix.{product\|import\|discount\|shippingRates}` |
| `productCurrencyProblem` | `(next: { currency: string; status: ProductStatus }, stored: { currency: string } \| null, market?)` | `"currency_not_allowed"` unless `next.currency` is allowed, OR (`stored` exists AND `next.currency === stored.currency` AND `next.status === "draft"`): a legacy product may still be edited as a draft, never published, never moved to another disallowed currency | as above, fix `.product` ("Change the price to {currencies}, or keep it as a draft.") |
| `discountCurrencyProblem` | `(next: DiscountValue, stored: DiscountValue \| null, market?)` | percent: `null`; amount: allowed, or unchanged from the stored amount discount (so a started legacy sale can still have its end moved or be ended) | fix `.discount` |
| `shippingPolicyMarketProblem` | `(policy: SellerShippingPolicy, market?) => { problem: "shipping_country_not_allowed"; countries: string[] } \| { problem: "currency_not_allowed" } \| { problem: "rates_currency_missing" } \| null` | every code on every destination row (priced or display-only) is in `market.shippingCountries` or is `SHIP_ANYWHERE`; `ratesCurrency` is present whenever a priced row exists, and allowed | `market_restricted`; `Errors.market.shippingCountry.*` (with `{offending}`), currency fix `.shippingRates` |
| `deliveryCountryProblem` | `(country: string \| null, market?) => "delivery_country_not_allowed" \| null` | `null` country means the route already refused a parcel without an address (`src/lib/checkout/place-order.ts:164`); the quote treats `""` as not allowed (closes the `"*"` matches `""` note in report 03 section 1.4) | checkout `delivery_outside_market`; `ProductPage.checkout.errors.delivery_outside_market` |
| `billingCountryProblem` | `(country: string \| null, market?) => "billing_country_missing" \| "billing_country_not_allowed" \| null` | | checkout `invalid` with `fields: ["billingCountry"]` for missing; `billing_outside_market` for not allowed |
| `chargeAmountProblem` (in `currencies.ts`) | `(totalCents: number, currency: Currency) => "below_minimum" \| null` | total below `minimumChargeCents(currency)` (Stripe: 0.50 EUR, 0.50 USD, 15.00 CZK) | checkout `below_minimum` with `{amount}` |
| `checkoutMarketProblem` (R5-ready) | `(input: CheckoutMarketInput, market?) => { problem: CheckoutMarketProblem; seller?: number } \| null` with `CheckoutMarketInput = { sellers: readonly SellerMarketFacts[]; currency: string; ships: boolean; deliveryCountry: string \| null; hasDownloads: boolean; billingCountry: string \| null }` | the first failing rule in order: each seller (`sellerMarketProblem`, plus a missing declared country), currency, delivery (when `ships`), billing (when `hasDownloads`); `seller` is the index of the failing seller | seller problems: `market_unavailable`; others as above |
| `offeredInMarket` | `(row: { currency: string }, market?) => boolean` | the product's currency is allowed; used beside `isContentVisible` wherever a buyer surface decides what is for sale | n/a (absence, like a takedown) |
| `sellerGateReasons` (in `src/lib/settings/trader-identity.ts`, the existing pure gate module) | `(input: SellerGateInput, options: { requireVerifiedEmail: boolean; market?: Market }) => SellerGateReason[]` | ordered reasons, empty when the seller may publish and sell (4.2) | `trader_identity_required` or `market_restricted` |

Error factories:

- `src/lib/errors.ts`: add `"market_restricted"` to `ActionErrorCode` (`src/lib/errors.ts:33-43`) and `marketRestricted(problem, context, values)`. It carries an `action` only where the fix is in the app: `seller_country_mismatch` links to `TRADER_IDENTITY_HREF#country`; `currency_not_allowed` in the product form needs none (the field is on screen); `seller_country_not_allowed` and `stripe_country_not_allowed` have no in-app fix and carry none (`ActionError.action` is an in-app href, `src/lib/errors.ts:58-65`).
- `src/lib/market/refusal.ts`: `marketRefusal(problem, context): Promise<ActionError>`, the one async wrapper the server actions call.
- `src/types/checkout.ts:69-91` `CheckoutErrorCode` gains `"delivery_outside_market" | "billing_outside_market" | "below_minimum" | "market_unavailable"`. `QuoteRefusal` (`src/lib/checkout/quote.ts:74-80`) gains the first three. No new `LineProblem` (`src/lib/checkout/line-problem.ts:5-23`): a line in a disallowed currency answers `not_found`, the same non-enumerating absence as a draft or a takedown.

### 2.2 Choke points (one call covers many paths)

**CP-1 The seller gate** (`sellerGateReasons`, wrapped by `sellerMaySell` and `publishBlockedError`). Today every publish write and every buyer read funnels through `missingTraderIdentity` / `isTraderIdentityComplete` (`src/lib/settings/trader-identity.ts:115-152`), and the gate rows already select `tax_country` (`TRADER_GATE_SELECT`, `src/lib/settings/seller-identity.ts:81-82`). One change covers:

| Path | Call today | After |
|---|---|---|
| Product create active (form, MCP `create_product`) | `publishGate` `src/lib/products/actions.ts:333-339`, `:367` | unchanged call; `publishBlockedError` now returns market reasons |
| Product update to active (form, designer tile, MCP `update_product`, `publish_products`) | `src/lib/products/actions.ts:456` | same |
| Card toggle active | `src/lib/products/card-actions.ts:65-68` | same |
| CSV import active (UI, MCP `import_products`) | `src/lib/products/import-actions.ts:165-168` | same |
| Embed switched on (UI, MCP `update_embed_settings`) | `src/lib/storefront/actions.ts:510-513` | same |
| Product gate: product page, checkout pages, cart, discount check, quote | `sellerMaySell` `src/lib/products/purchasable.ts:321-322` | same call, new predicate |
| Hosted storefront page and embed frame | `src/lib/storefront/storefront-page.ts:265-266` | same |
| Sitemap | `src/lib/seo/sitemap.ts:158` | same |
| Embed widget JSON | direct `isTraderIdentityComplete` `src/app/api/embed/[key]/route.ts:68-71` | switched to `sellerMaySell(row)` (closes BP6, report 01) |
| OG image | direct `src/app/api/og/p/[productId]/route.ts:95-102` | switched to `sellerMaySell` |
| MCP product page preview | direct `src/lib/agent/preview/product-page-preview.ts:161-167` | `sellerGateReasons`, notes gain `seller_outside_market` |
| MCP storefront preview | direct `src/lib/agent/preview/storefront-preview.ts:120` | same |
| Dashboard status, `get_store` | `getTraderIdentityStatus` `src/lib/settings/seller-identity.ts:216-233` | returns `reasons` beside `missing` |

**CP-2 The Stripe account** (`ensurePaymentAccount`, `saveAccountFacts`, `canTakePayments`, `src/lib/payments/connect/account.ts:102-184`). The only writer of connected accounts and the only reader checkout asks. Covers onboarding (`startStripeOnboarding`), the return refresh (`/api/payments/connect/return`), `account.updated`, every checkout surface through `checkoutProviderFor` (`src/lib/checkout/availability.ts:73-83`), and the fresh re-check in `placeStripeOrder` (`src/lib/checkout/stripe-provider.ts:79-81`). Details in 4.5 to 4.7.

**CP-3 `assessLines`** (`src/lib/checkout/quote.ts:231-308`): every line a buyer can buy. One added check after the currency is read (`:254`): `if (!marketAllows("currencies", currency, market)) return not_found`. Covers the quote (`:384`), the cart route add (`src/app/api/cart/[storefrontId]/route.ts:101`), quick add (`src/lib/cart/quick-add.ts:52`), the cart view (`src/lib/cart/view.ts:38`) and the cart checkout page (`src/lib/checkout/cart-page.ts:63`). Plus `canPriceDelivery` (`src/lib/checkout/availability.ts:92-97`) returns false for a disallowed currency, so pages never offer checkout for it.

**CP-4 Buyer-surface offering** (`offeredInMarket` beside `isContentVisible`): the product gate `visiblePlacedRows` (`src/lib/products/purchasable.ts:353-357`), the board (`src/lib/storefront/storefront-page.ts:275`), the sitemap product filter (`src/lib/seo/sitemap.ts:180`, whose select at `:171` gains `currency`), the OG image product check (`src/app/api/og/p/[productId]/route.ts:80`), the storefront preview (`src/lib/agent/preview/storefront-preview.ts:77`, `:86`, new reason `currency_outside_market`). A legacy-currency product is absent from every buyer surface, exactly like a takedown (report "never delete": the row is untouched).

**CP-5 `quoteFromLines`** (`src/lib/checkout/quote.ts:379-428`): every order's price. After pricing (`:391`, when `ships` and `hasDownloads` are known) and before delivery is quoted (`:393-410`): `deliveryCountryProblem` when `ships`, `billingCountryProblem` when `hasDownloads`, then after the total `chargeAmountProblem`. `QuoteRequest` (`:60-70`) gains `billingCountry: string | null`.

**CP-6 `placeOrderResponse`** (`src/lib/checkout/place-order.ts:89-196`): the one place both order routes share (Buy now `src/app/api/checkout/[storefrontId]/[productId]/route.ts:22`, cart `src/app/api/checkout/[storefrontId]/route.ts:19`). After the quote and the provider (`:157-158`), one call: `checkoutMarketProblem({ sellers: [{ establishmentCountry: quote.store.seller.country ?? null }], currency: quote.currency, ships: quote.ships, deliveryCountry: order.shipTo?.country ?? null, hasDownloads: quote.hasDownloads, billingCountry: order.billingCountry ?? null })`. This repeats CP-3/CP-5 on purpose: it is the R6 statement "no checkout without passing all rules", in one readable line, and the only R5-shaped call.

**CP-7 Product writes** (`productCurrencyProblem`): `createProduct`, `updateProduct`, `setProductStatus`, `duplicateProduct`, `importProducts` (2.3).

**CP-8 The order writer** (`placeOrder`, `src/lib/orders/record.ts:344-545`): backstop for every provider and the dev simulator. Refuses (`reason: "invalid"`) a currency not in `MARKET.currencies` (`paidCheckoutSchema.currency` `:220` gains a refine) and a parsed `ship_to.country` outside `MARKET.shippingCountries` (after `parseShipTo` `:430`). Database guards in `order_place` (P1b) are the last line.

**CP-9 The Connect webhook** (`src/lib/payments/connect/webhook.ts:161-282`): records evidence, never refuses a paid order (5.4).

### 2.3 Paths that need their own call

| Path | Where the call goes | Rule |
|---|---|---|
| `createProduct` `src/lib/products/actions.ts:341` | after `parseWrite` (`:361-363`), before `publishGate` (`:367`): `productCurrencyProblem(data, null)` | R2 |
| `updateProduct` `:431` | the pre-save read (`:478-491`) becomes unconditional and also selects `currency, status`; then `productCurrencyProblem(data, { currency: existing.currency })` before `publishGate` (`:456` moves after the read) | R2 |
| `setProductStatus` `src/lib/products/card-actions.ts:44` | when `status === "active"`: read `currency` (one select by id and owner) before the update at `:75-81`; `productCurrencyProblem({ currency, status }, { currency })` | R2 (closes B4, report 02) |
| `duplicateProduct` `:101` | after the source read (`:121-134`): `productCurrencyProblem({ currency: source.currency, status: "draft" }, null)` (a copy is a new row) | R2 (closes B3) |
| `importProducts` `src/lib/products/import-actions.ts:151-155` | replace the `CURRENCIES` membership test with `currencyProblem(currency)`, context `import` | R2 |
| `createDiscount` / `updateDiscount` `src/lib/discounts/actions.ts:122`, `:159` | inside `checkInput` (`:72-99`), which gains the stored discount (null on create, `existing` on update `:171`): `discountCurrencyProblem(input.value, stored?.value ?? null)` | R2 |
| `saveShippingPolicy` `src/lib/settings/shipping-actions.ts:71` | after the strict parse (`:98-99`): `shippingPolicyMarketProblem(parsed.data)` | R2, R3 |
| `saveTaxInfo` `src/lib/settings/actions.ts:446` | after the parse (`:469-470`): if `tax_country` was sent and the seller has a Stripe account with a stored country that differs, refuse (`seller_country_mismatch`, copy `Settings.tax.countryLocked`); an outside-market country is SAVED (truthful record) and answered with `Settings.tax.success.savedOutsideMarket` (4.4) | R1 |
| `startStripeOnboarding` `src/lib/payments/connect/actions.ts:51` | before `ensurePaymentAccount` (`:60-66`): establishment country must be present (else `traderIdentityRequired(["country"])`) and allowed (else `marketRestricted("seller_country_not_allowed")`) | R1 |
| `ensurePaymentAccount` `src/lib/payments/connect/account.ts:144` | refuses (throws) a country that is not allowed, even if a caller forgets the action-level check | R1 |
| `placeStripeOrder` `src/lib/checkout/stripe-provider.ts:79-81` | after the fresh account read: `sellerMarketProblem({ establishmentCountry: quote.store.seller.country, stripeCountry: account.country })`; refuse `unavailable` | R1 at the line that asks for money |
| Cart `buyerCountry` guess `src/lib/cart/route.ts:46-49` | filter to `MARKET.shippingCountries` (display only) | R3 (UX) |
| Dev simulator `src/lib/dev/simulated-sale.ts:34-55` (from report 03) | fixed IE/DE/FR/NL addresses replaced with market-derived ones, or the writer (CP-8) refuses them | dev only |

### 2.4 Completeness against the entry-point checklist (report 04)

Proof obligation: every MCP write tool, route handler and server action that touches seller country, currency, shipping countries, checkout or orders appears here with its enforcement point. Everything else is exempt by class, and the coverage test (8.2) makes "exempt" an explicit, reviewed entry rather than an omission.

**MCP write tools (36, report 04 section 1.1).** Tools call the actions, so they inherit; "input" means the tool's own Zod input also narrows.

| Tool | Enforcement |
|---|---|
| `create_product` | input `currency: z.enum(MARKET.currencies)` (`src/lib/agent/tools/products.ts:177`); action CP-7; publish CP-1 |
| `update_product` | input enum (`:205`); handler re-sends the stored currency (`:217`), action CP-7 decides (legacy draft edit allowed, publish refused) |
| `publish_products` | per item `updateProduct` (`:276-284`): CP-7 + CP-1; refusal carried per item as today (`:285-289`) |
| `import_products` | input enum (`:348`); action CP-7 + CP-1 |
| `create_discount`, `update_discount` | schema pre-parse (`src/lib/agent/tools/discounts.ts:27-30`, storable enum) then action `checkInput` (2.3) |
| `save_shipping_policy` | schema pre-parse (`src/lib/agent/tools/storefronts.ts:436`) then `saveShippingPolicy` (2.3) |
| `update_embed_settings` | `updateEmbedSettings` publish gate (CP-1) |
| `set_code_enabled`, `end_sale`, `delete_discount` | exempt: write no currency; a legacy EUR code only ever applies to EUR products, which CP-3/CP-4 never sell |
| `update_stock`, `move_product_badge`, `upload_image`, `delete_product` | exempt: no currency, status or country |
| `create_storefront`, `edit_storefront`, `save_storefront`, `upload_element`, `update_product_page`, `update_checkout_page`, `update_cart_page`, `delete_storefront`, `rotate_embed_key` | exempt: storefront config has no currency or country (report 02 S2); visibility is decided by CP-1/CP-4 on read. Known gap kept: `save_storefront` can store `embed.enabled: true` without the publish gate (BP2, report 01); the read side refuses to serve it |
| `mark_order_shipped`, `refund_order` | exempt: post-sale; a refund must never be blocked by a market rule |
| `update_username`, `update_bio`, `save_notification_settings`, `set_avatar`, `remove_avatar`, `set_review_visibility`, `mark_notification_read`, `mark_all_notifications_read`, `request_moderation_review`, `file_moderation_appeal` | exempt: no market data |

R1 inputs have no tool by design (`saveTaxInfo` and `startStripeOnboarding` are person-only: `tests/unit/agent/registry.test.ts:85`, `:163`, from report 04).

**Route handlers (report 04 section 2).**

| Route | Enforcement |
|---|---|
| `POST /api/checkout/[storefrontId]/[productId]`, `POST /api/checkout/[storefrontId]` | CP-1 (gate in quote), CP-3, CP-5, CP-6, CP-2 (provider), CP-8 |
| `POST /api/checkout/.../discount` (x2) | read only; gate (CP-1, CP-4) |
| `GET /api/checkout/cancel` | exempt: releases an order, never creates one |
| `POST /api/cart/[storefrontId]`, `/view` | CP-1, CP-4 via `cartGate`; CP-3 on adds; display guess filtered (2.3) |
| `POST /api/orders/withdraw`, `/lookup`, `/review-reminder` (+unsubscribe), `GET /download` | exempt: post-sale buyer rights; never blocked |
| `GET /api/embed/[key]` | CP-1 (switched to `sellerMaySell`) |
| `GET /api/og/p/[productId]` | CP-1, CP-4 |
| `PATCH /api/storefronts/[id]/{product,checkout,cart}-page` | exempt (config only), as their MCP tools |
| `GET /api/payments/connect/return` | CP-2 (`refreshPaymentAccount` stores `country`) |
| `POST /api/payments/webhook` | CP-2 (`account.updated`), CP-9 |
| `POST /api/billing/webhook` | exempt: seller plans, not buyer sales |
| uploads, reviews, report, search, exports, cron, OAuth, MCP transport | exempt: no market data (cron account-deletions deletes, never sells) |

**Server actions touching the rules (report 04 section 3.1, 3.2).**

| Action | Enforcement |
|---|---|
| `createProduct`, `updateProduct`, `setProductStatus`, `duplicateProduct`, `importProducts` | CP-7 (+ CP-1 on active) |
| `setProductAddOns`, `moveProductBadge`, `updateStockSettings`, `deleteProduct`, `undoProductImport` | exempt (no currency/status); add-ons in another currency are already hidden on read (`src/lib/products/add-on-visibility.ts:16-23`, from report 02) |
| `createDiscount`, `updateDiscount` | 2.3 |
| `setCodeEnabled`, `endSale`, `deleteDiscount` | exempt (as their tools) |
| `saveShippingPolicy` | 2.3 |
| `saveTaxInfo` | 2.3 and 4.4 |
| `startStripeOnboarding` | 2.3, CP-2 |
| `openStripeDashboard` | exempt: opens an existing account |
| `updateEmbedSettings` | CP-1 |
| `saveStorefront`, `createStorefront`, `deleteStorefront`, `rotateEmbedKey` | exempt (config) |
| `markOrderShipped`, `refundOrder`, `refundOrderLine` | exempt (post-sale) |
| `authenticate` (sign-up) | exempt for enforcement (an account that cannot sell is harmless); the country question is asked in the welcome flow (4.3) |
| every other action (auth, MFA, team, notifications, onboarding flags, billing plans, AI writing, moderation, locale) | exempt: no market data |

**Writers outside the app** (direct PostgREST with the seller's JWT on `products`, `discounts`, `profiles.tax_country`; service-role scripts; the `demo-sales-sim` pg_cron insert): P1b guards. The app's part is to keep reading defensively (CP-1 re-validates the stored country, CP-4 filters the stored currency) so a row written around the app is still not sold.

---

## 3. CZK enablement

### 3.1 Read strictly first (branch `market/01-strict-currency`, no CZK yet)

1. `src/lib/market/currencies.ts`: `parseCurrency(value: unknown): Currency | null` (exact membership in `CURRENCIES`, upper case only, as the stored spelling); `storedCurrency(value: string): Currency` (throws `UnknownCurrencyError` for a value outside `CURRENCIES`; only possible if a CHECK and the list drift, which 1.7 test 3 prevents).
2. Replace all 29 `toCurrency(row.currency)` call sites (listed by grep in this design's research: `src/lib/checkout/quote.ts:178`, `:254`; `src/lib/checkout/availability.ts:96`; `src/lib/checkout/discount-check.ts:79`; `src/lib/products/order-quantity.ts:177`; `src/lib/products/public.ts:121`, `:167`; `src/lib/storefront/storefront-page.ts:288`, `:376`; `src/lib/cart/view.ts:107`, `:113`, `:128`; `src/lib/cart/suggestions.ts:54`; `src/lib/products/add-ons.ts:66`, `:145`; `src/lib/products/add-on-choices.ts:144`, `:158`; `src/lib/products/add-on-actions.ts:86`, `:141`; `src/lib/products/preview-actions.ts:91`; `src/lib/products/queries.ts:434`, `:477`; `src/lib/discounts/queries.ts:149`; `src/lib/discounts/storefront-preview.ts:127`; `src/lib/agent/preview/product-page-preview.ts:114`; `src/lib/agent/preview/storefront-preview.ts:107`; `src/components/product-page/ProductPageView.tsx:176`; `src/components/analytics/chart-format.ts:22`; `src/app/api/search/route.ts:82`) with `storedCurrency`, and `src/lib/products/queries.ts:143` likewise. Delete `toCurrency` so any missed caller fails to compile.
3. The product gate drops a row whose currency does not parse (beside `isContentVisible` in `visiblePlacedRows`, `src/lib/products/purchasable.ts:353-357`), so a buyer path can never reach a throwing `storedCurrency`.
4. Formatting: `formatCents` (`src/lib/format/money.ts:21-36`) passes the stored code to `Intl` unchanged; if `Intl` throws (malformed code) it prints `"<amount> <CODE>"`. `formatPrice` / `formatPriceShort` (`src/lib/format.ts:13-28`) unchanged (already typed `Currency`).
5. Tests: `tests/unit/format.test.ts:7-17` (toCurrency) deleted; `:37-39` rewritten: an unknown currency never renders as `€`. New `tests/unit/market/currencies.test.ts`.

Safety: before this branch a CZK row cannot exist (CHECK); after it, a CZK row would throw or be dropped, never folded to EUR. EUR and USD behave exactly as before.

### 3.2 CZK storable and correct (branch `market/02-czk-storable`, DB-coupled)

In this order inside the branch (each commit compiles and is safe because no CZK row can exist until the migration is applied, and the deploy sentinel blocks deploy until then):

1. P1b migration: the three currency CHECKs accept CZK (products, discounts amount, product_price_history). Schema sentinels: `{ kind: "check", constraint: "<products currency check>", allows: "CZK" }` and the same for the other two (constraint names are P1b's).
2. `CURRENCIES = ["EUR", "USD", "CZK"]` (`src/types/product.ts:12`). Compile errors are the work list: `CURRENCY_SYMBOLS` (`src/components/products/PriceField.tsx:14`) is deleted in favour of `currencySymbol`; `MoneyByCurrency` (`src/lib/dashboard/queries.ts:42`) is already `Partial`.
3. `CURRENCY_RULES: Record<Currency, { minimumChargeCents: number; shippingRateMaxCents: number; wholeUnitDisplay: boolean }>`: EUR `{50, 100_000, false}`, USD `{50, 100_000, false}`, CZK `{1_500, 2_500_000, true}`. Stripe: CZK is two-decimal with no special case, minimum charge 15.00 CZK; 0.50 EUR and 0.50 USD (11.4).
4. `MIN_PAYABLE_CENTS` (`src/lib/discounts/pricing.ts:31-33`, read at `:45`) becomes `minimumChargeCents(currency)`; `reductionCents` already receives the currency (`:39`).
5. Order minimum: `chargeAmountProblem` in `quoteFromLines` after the total (`src/lib/checkout/quote.ts:425`), refusal `below_minimum`. This also closes a gap for EUR (a 0.01 EUR order would be refused by Stripe today with a generic `failed`).
6. Delivery cap per currency: `superRefine` on `shippingPolicySchema` (`src/lib/validation/shipping-policy.ts:67-138`) checks each `rateCents` against `CURRENCY_RULES[ratesCurrency ?? LEGACY_RATES_CURRENCY].shippingRateMaxCents`. The read side (`buildShippingPolicy`, `src/lib/settings/shipping-policy.ts:50-60`) keeps parsing with the storage bound only, so no stored policy empties (report 03 section 1.3).
7. `LEGACY_RATES_CURRENCY` token replaces the five `"EUR"` defaults (1.6).
8. Display: `formatCents` drops `,00` for whole CZK amounts when `wholeUnitDisplay` is true ("1 299 Kč", English "CZK 1,299"); haléře still show when present ("179,10 Kč" after a 10 % discount). This is a by-eye pick (11.2 Q9); per the owner's rule a `/dev` lab tile compares the two before wiring.
9. CSV parser (`src/lib/products/price.ts:55-89`): accept the Czech whole-price notation `"299,-"` / `"299.-"` by stripping a trailing `[.,]-` before parsing. "1 299,00 Kč", "1.299 Kč" and "CZK 1299" already parse.
10. Fees: no change. `computeFees` is basis points of the order amount in its own currency (from report 02 section 9) and Stripe takes `application_fee_amount` in the charge currency (`src/lib/checkout/stripe-provider.ts:156-159`).
11. Tests: `tests/unit/market/storable-currency-sql.test.ts` (1.7), pricing, shipping-rate cap, CSV notation, `formatCents` CZK in `cs` and `en`, below-minimum quote.

After this branch a seller can price in CZK and is charged in CZK. EUR is still allowed for writes until branch 05.

### 3.3 Reporting and plan pages (branch `market/08-czk-reporting`, after P1b's aggregate rewrite)

- Analytics, dashboard and top-products SQL treat `currency <> 'USD'` as EUR (report 02 section 8.3). P1b rewrites them to group by currency; the app then reads the currency from the payload instead of `"EUR"` (`src/lib/analytics/queries.ts:212`, `:292`, type note `src/lib/analytics/types.ts:89`), and `moneyCompact` uses `currencySymbol`.
- Plan calculator: `billing_sales_30d` counts EUR orders only (from report 02), so a CZK seller reads 0. App side: `readDirectSales30d` (`src/lib/billing/account-plan.ts:191-200`) returns `null` (the calculator's "start from a default" path) when the account's recent sales are not in `BILLING_CURRENCY`, instead of a wrong 0. Needs a P1b variant of the function that reports the currencies present. Plan prices stay EUR until the owner decides (11.2 Q5).
- `formatMoney` sort, payments overview fallback, search label (1.6).

---

## 4. R1 on the application side

### 4.1 One accessor for the country of establishment

```ts
// src/lib/settings/seller-identity.ts
/** The columns the establishment country is read from. Part of TRADER_GATE_SELECT. */
export const ESTABLISHMENT_COUNTRY_SELECT = "tax_country" as const;

/** THE seller's country of establishment, or null when none is on file or the
 *  stored value is not a storable seller country (a REST-written "XX" counts as
 *  missing, the same discipline buildTraderIdentityInput applies to the address).
 *  Interim source: profiles.tax_country. 1B moves it to the structured primary
 *  address country; only this function and ESTABLISHMENT_COUNTRY_SELECT change. */
export function establishmentCountryOf(row: Pick<TraderGateRow, "tax_country"> | null): OperatingCountryCode | null;

/** Narrow service-role read for callers that hold no gate row (Stripe onboarding, saveTaxInfo). */
export async function readEstablishmentCountry(ownerId: string): Promise<{ ok: true; country: OperatingCountryCode | null } | { ok: false }>;
```

Every R1 decision reads through it: `buildTraderIdentityInput` (`src/lib/settings/seller-identity.ts:109-120`), `sellerMaySell`, `publishBlockedError`, `getTraderIdentityStatus`, `startStripeOnboarding` (today it takes `identity.country` from `getSellerIdentity`, `src/lib/payments/connect/actions.ts:59`, `:65`), the previews, and `get_store`. `buildSellerIdentity` (`:148-161`) keeps showing the stored country to buyers ("Sold by X, Czechia", `src/components/checkout/CheckoutView.tsx:152`); it is display, not a decision. `TRADER_GATE_SELECT` keeps including the accessor's columns, so every gate read (account row, sitemap batch, product gate, board, embed, OG, previews) stays one query.

### 4.2 The seller gate, reshaped

In `src/lib/settings/trader-identity.ts` (the module that already holds "exactly one answer to is this seller allowed to sell", `:14-18`):

```ts
export type TraderIdentityField = "businessName" | "address" | "country" | "email" | "emailVerified";

export type SellerGateReason =
  | { kind: "market"; problem: SellerMarketProblem }         // can't sell here, whatever is filled in
  | { kind: "details_missing"; missing: TraderIdentityField[] };
  // 1B appends: verification, sanctions, payments_not_ready (section 10)

export type SellerGateInput = {
  identity: TraderIdentityInput;                 // buildTraderIdentityInput(row), now with `country`
  establishmentCountry: string | null;           // establishmentCountryOf(row)
  stripe?: { country: string | null } | null;    // where the caller read the account (write side, placement)
};

export function sellerGateReasons(input: SellerGateInput, options: { requireVerifiedEmail: boolean; market?: Market }): SellerGateReason[];
```

- `"country"` joins `TRADER_IDENTITY_FIELDS` (`:69-99`) after `address`, label `Settings.sellerDetails.fields.country.label` ("Country of establishment"), anchor `country`, why `...country.why`. `missingTraderIdentity` (`:115-144`) checks it like the other typed fields (`StorefrontSeller` already has `country`).
- `traderIdentityFix` (`:174-186`): `TYPED_TRADER_FIELDS` (`:162`) is unchanged, so the ICU `fields` select keeps its seven combinations. A missing country alone answers `Errors.traderIdentityRequired.fix.country`; country plus anything else answers the existing `fix.complete`. No combinatorial explosion in ten catalogues.
- Order of reasons: `market` first (filling in details cannot help a seller outside the market), then `details_missing`.
- The stale paragraph "Country. The picker lists EU member states only..." (`:27-29`) is replaced by the R1 reasoning.
- `isTraderIdentityComplete` (`:147-152`) stays for "details only" questions; nothing that decides selling calls it directly any more (CP-1 table).

Server wrappers in `src/lib/settings/seller-identity.ts`:

- `sellerMaySell(row, market = MARKET)` (`:128-132`) = `sellerGateReasons(...)` is empty. Read side: no Stripe facts (the account country is CP-2's).
- `publishBlockedError(accountId)` (`:304-313`): the uncached read (`:248-284`) also reads `seller_payment_accounts.country` for the owner (service role, fail closed on error), then maps the first reason: `market` to `await marketRefusal(problem, "seller")`, `details_missing` to `traderIdentityRequired(missing)` (unchanged).
- `getTraderIdentityStatus` (`:216-233`) returns `{ ok: true; missing; reasons }`; existing callers keep reading `missing`.

### 4.3 Where the seller declares the country

- **Settings › Business & seller details** (`src/components/settings/TaxSection.tsx`, country select at `:168-178`, `:361-371`, from report 01): the field is relabelled "Country of establishment", moved directly under the business address (it is shown as part of the address block on buyer pages already), marked required, with `id="country"` for the gate's deep link, and an inline market notice when the chosen country is outside `MARKET.sellerCountries`. Market countries are pinned first in the list.
- **Welcome flow** (`src/components/onboarding/WelcomeFlow.tsx:431-492`): the seller step gains the same field between address and email, posting `tax_country` with the three fields it already posts (`saveTaxInfo` writes only what is sent, `src/lib/settings/actions.ts:455-470`). Built as one reusable `EstablishmentCountryField` (select + market notice), the minimal piece 1B lifts into step one of the universal onboarding form (section 10).
- **Sign-up** (`authenticate`, `src/lib/auth/actions.ts:355-462`, from report 01) does not ask. Creating an account is not selling; the gate stops selling. This is a deliberate reading of "at seller signup": the first screen after sign-up asks, and an outside-market seller is told there.

### 4.4 Challenge on the free-text address and `tax_country`

The proposal (tax_country becomes the country of establishment, shown with the address block, structured address left to later) is right for the interim, with two refinements:

1. **Do not refuse an outside-market country on save.** `taxSchema` keeps validating against the storable list (`src/lib/validation/settings.ts:131-136`). Refusing would leave an Irish seller two choices, leave it blank or declare Czechia falsely, and both make the record worse. The gate refuses to publish and sell instead, with a market message, and the success message says so (`Settings.tax.success.savedOutsideMarket`). R1's "every write path rejects a disallowed seller country" is met where it matters: every publish write and every sale. Say this to the owner explicitly (11.2 Q1).
2. **The free-text address is not cross-checked against the country.** An address reading "Dublin, Ireland" with country CZ passes. Parsing free text is not reliable; Stripe's KYC on a CZ account is the real evidence, which is why R1 requires both the declared and the Stripe country. The structured address with its own country is 1B's (section 10); until then the monitoring report (P1b) can list sellers whose address text names another country, for a person to look at.

### 4.5 Stripe account creation

`ensurePaymentAccount` (`src/lib/payments/connect/account.ts:144-184`):

- `owner.country` becomes required (`OperatingCountryCode`, not nullable) and must satisfy `marketAllows("sellerCountries")`; otherwise it throws before calling Stripe. The conditional spread at `:158` becomes `country: owner.country`.
- After Stripe answers: if `created.country !== owner.country`, alert ops and do not record the row (an account we did not ask for).
- The upsert (`:166-178`) records `country: created.country`.
- Idempotency key `connect_account_<owner>` (`:163`) becomes `connect_account_v2_<owner>`: Stripe refuses a reused key with different parameters for 24 hours (Stripe idempotency rule, cited in audit A section 13). If the account-type change (below) lands later, bump once more then.
- An existing row is still returned unchanged (`:150-151`); the country of an existing account is checked by `canTakePayments`, not here.
- **Where the account-type change slots in** (out of scope, owner approval pending, audit A section 13): the same call, replacing `type: "express"` (`:157`) with controller properties, plus `dashboardLink` (`:208-214`). The country handling above is type-agnostic: it only sets `country`, asserts the returned `country`, and stores it.

`startStripeOnboarding` (`src/lib/payments/connect/actions.ts:51-73`) reads `readEstablishmentCountry(account.accountId)` instead of `getSellerIdentity(...).country`; refuses missing (`traderIdentityRequired(["country"])`) and outside-market (`marketRefusal("seller_country_not_allowed")`); passes the country to `ensurePaymentAccount`.

### 4.6 Storing Stripe's country and the `account.updated` re-check

- `StripeAccount` (`src/lib/billing/stripe-api.ts:110-115`) gains `country?: string | null` (Stripe's Account object carries the account's two-letter country).
- `PaymentAccount` (`src/lib/payments/connect/account.ts:28-37`) gains `country: string | null`; `SELECT` (`:39`), `Row`, `toAccount` follow.
- `saveAccountFacts` (`:108-118`) writes `country` when Stripe sent one (never clears a stored value with an absent one). Used by `applyAccountFacts` (webhook) and `refreshPaymentAccount` (return route).
- Webhook `account.updated` (`src/lib/payments/connect/webhook.ts:165-175`) passes `country: text(object.country)`. If the stored or received country is outside the market, `alertOps("A connected account is outside the market", { account, country })` (it cannot happen for accounts this code creates; it can for a row created before branch 04).
- Column absent (migration unapplied): the select errors, `readPaymentAccount` returns null (`:61-72`), checkout is off for that seller: fail closed. No runtime column detection; the deploy sentinel `{ kind: "column", table: "seller_payment_accounts", column: "country" }` prevents shipping the code ahead of the column. Connect is off in production anyway (`.env.production:47`, from audit A).

### 4.7 `canTakePayments` and disagreement

- `canTakePayments(account, market = MARKET)` (`:102-104`) = today's test AND `marketAllows("sellerCountries", account.country, market)`. Unknown country (null) is not allowed. Every checkout surface follows through `checkoutProviderFor`.
- Disagreement (declared CZ, Stripe X, or the reverse):

| Situation | Behaviour |
|---|---|
| Seller tries to change `tax_country` away from the stored Stripe country | `saveTaxInfo` refuses (`Settings.tax.countryLocked`, "Your Stripe account is registered in {country}. Your country of establishment has to match it; contact support if that is wrong.") |
| Mismatch exists anyway (REST write around the app, legacy account) | `publishBlockedError` refuses (`seller_country_mismatch`, action link to `#country`); `placeStripeOrder` refuses (`unavailable`); payments page shows the problem; ops alerted by the monitor (P1b) |
| Stripe country outside the market | `canTakePayments` false: no checkout anywhere; publish refused (`stripe_country_not_allowed`); fix is a new Stripe account, a support action (Stripe: country cannot change after creation) |

### 4.8 What an existing seller sees

Production today (orchestrator's facts): 15 profiles, CZ x2, IE x1, unset x12; 4 accounts own products or storefronts.

| Seller | Dashboard | Publishing | Buyer pages | Stripe |
|---|---|---|---|---|
| Country unset | Trader-identity banner now lists "Country of establishment" with a link to `#country` | Refused with `trader_identity_required`, fix `fix.country` | Hidden (gate refuses), same as any incomplete identity today | Onboarding refused until set |
| Country outside the market (IE) | New market banner: "During the beta, only sellers established in {countries} can publish and sell. Your products and storefronts stay saved." | Refused with `market_restricted` | Hidden | Onboarding refused |
| CZ, catalogue in EUR (the demo seller) | Attention row: "N products are priced in a currency the beta does not sell" | Those products refused until moved to CZK (or kept as drafts) | Those products hidden (CP-4), CZK ones shown | n/a |
| CZ, shipping rows naming EU/USA as countries | Shipping settings notice | Saving the policy refused until those rows are removed | Checkout quotes CZ only; display-only rows with free-text areas still print as written (11.1 R6) | n/a |

Nothing is deleted or unpublished in the database: status stays `active`, rows stay as they are, and reads decide. Reverting a market change (or expanding) brings them back without a data migration.

---

## 5. Checkout (R3, R4, R6) and R5

### 5.1 Checks added to the quote, gate and place path

In request order, for both order routes:

1. Body parse (`src/lib/validation/checkout.ts:50-67`): new optional `billingCountry` (refine to `OPERATING_COUNTRY_CODES`, `""` dropped) and optional `expectedCurrency` (`z.enum(CURRENCIES)`). Optional so a tab opened before the deploy still parses.
2. Gate (CP-1, CP-4) inside `quoteOrder` (`src/lib/checkout/quote.ts:162-167`): seller market and details, product currency offered.
3. `assessLines` (CP-3): line currency allowed, else `not_found`.
4. `quoteFromLines` (CP-5): delivery country allowed when `ships`; billing country present and allowed when `hasDownloads`; total at or above the currency's minimum.
5. `placeOrderResponse`: `expectedTotalCents` check (`src/lib/checkout/place-order.ts:151-153`) also compares `expectedCurrency` when sent (closes "price changed compares cents only", report 03 section 10); provider (`:157-158`, CP-2); then `checkoutMarketProblem` (CP-6); then the existing address and consent checks (`:164-165`).
6. Provider: `placeStripeOrder` fresh account re-check plus the seller country agreement (2.3).
7. Writer (CP-8) and `order_place` guards (P1b).

### 5.2 The billing-country field (R4)

- **Schema**: `orderBuyerFields.billingCountry` (5.1 step 1). `OrderBuyerBody` (`src/lib/checkout/place-order.ts:44-55`) and `CheckoutBuyer` (`src/lib/checkout/provider.ts:31-44`) gain `billingCountry: string | null`.
- **UI** (`src/components/checkout/CheckoutForm.tsx`): when `hasDownloads` (`:251`), a required "Billing country" select beside the consent box: market countries first, then the storable list, so a buyer outside the market can answer truthfully and be told "not yet" before paying (inline, from the same `billingCountryProblem`). Preselected from the `cf-ipcountry` guess when that is in the list, else empty: a preselected market country would weaken the declaration as evidence. Sent as `billingCountry` in the body (`:383-419`). This UI ships in the same branch as the server rule (7, branch 07) because the server requires it for downloads: a form/route contract must land atomically.
- **Validation**: `billingCountryProblem` in the quote; the client check is UX only.
- **Storage**: `paidCheckoutFor` (`src/lib/checkout/paid-checkout.ts:11-43`) passes `billingCountry`; `paidCheckoutSchema` (`src/lib/orders/record.ts:200-246`) gains it (two upper-case letters or null); the writer adds `billing_country` to `p_order` (`:472-515`). `order_place` reads `p_order` through `jsonb_populate_record` (`supabase/migrations/20261120_shopping_cart.sql:194`), which ignores keys that are not columns, so sending it before the column exists is harmless; but the insert lists its columns explicitly (`:207-236`), so P1b's migration must add `billing_country` to that list in the same change, and a DB-project test asserts a placed order carries it.
- **Physical-only orders**: not asked, stored null. R4 covers digital goods and services; "services" do not exist as a product kind in Store today (a product is digital exactly when `digital_file_key` is set, `src/lib/checkout/quote.ts:253`), see 11.1 R8.

### 5.3 Stripe Checkout Session parameters

In `placeStripeOrder` (`src/lib/checkout/stripe-provider.ts:122-168`):

- Add `billing_address_collection: quote.hasDownloads ? "required" : "auto"`. Stripe: `required` always collects the billing address; `auto` only when necessary (Checkout Sessions API reference, 11.4).
- Add the declared billing country to the existing `metadata` (`:110-121`) as `billing_country` for a reader of the seller's dashboard. Never read back (the metadata comment at `:107-109` already says so).
- Do not add `shipping_address_collection`: the address comes from our form, is quoted and stored; asking Stripe as well would let the two differ.
- Stripe offers no allowed-countries list for billing addresses (only `shipping_address_collection.allowed_countries`), so R4 cannot be enforced by Stripe; it is enforced by our quote and evidenced by Stripe.

### 5.4 What the webhook records, and disagreement

On `checkout.session.completed` (`src/lib/payments/connect/webhook.ts:177-215`), after `confirmPendingOrder` (`:208`) and never instead of it:

- Stripe's billing country: `object.customer_details.address.country` (present when collected).
- The card's issuing country: `latest_charge.payment_method_details.card.country` ("Two-letter ISO code representing the country of the card", Charge object reference). `settleOrderFees` already fetches the PaymentIntent with `expand[]=latest_charge` (`src/lib/payments/connect/fees.ts:67-72`). Refactor: one `readPaymentWithCharge(stripeAccountId, paymentIntentId)` in `fees.ts`, its result passed to both `settleOrderFees` and a new `recordMarketEvidence(admin, orderId, { stripeBillingCountry, cardCountry })`, so there is still one Stripe call. `StripeCharge` (`src/lib/billing/stripe-api.ts:122-130`) gains `payment_method_details?: { card?: { country?: string | null } | null } | null`.
- Written to `orders.card_country` (P1b) and Stripe's billing country to one more additive column this design asks P1b for: `orders.stripe_billing_country` (11.2 Q7). Keeping declared and Stripe-collected countries in separate columns lets the monitoring SQL compute every mismatch without a flag column.
- Disagreement, record and flag, never refuse, never refund:

| Case | Action |
|---|---|
| Download order, Stripe billing country differs from declared | Order paid as normal; both countries stored; `alertOps("Billing country differs from the one declared", { order, declared, stripe })` |
| Card issued outside the market | Stored only, no alert: Czech residents often hold foreign-issued cards; the monitor reports the rate |
| Stripe billing country absent (`auto`, physical order) | Nothing to compare |
| Evidence write fails | Throw, as fees do: the event is delivered again and the order is already paid, so the retry only writes evidence |

### 5.5 Time-of-check to time-of-use windows

| Data | Checked | Window | What this design does |
|---|---|---|---|
| Seller country, details, product currency, delivery and billing country | Quote at POST, re-read fresh (route handlers, React cache is a no-op) | Milliseconds to the pending-order write | Nothing more needed |
| Stripe account country, charges | `checkoutProviderFor` then fresh in `placeStripeOrder` | Milliseconds | Agreement check added at the fresh read (2.3) |
| Price and currency shown versus quoted | `expectedTotalCents` | Page open time | `expectedCurrency` added |
| Anything seller-side between the pending order and payment | Not re-checked (`order_confirm_paid` only flips the status, from report 03) | Up to 31 min Stripe page (`SESSION_MINUTES`, `src/lib/checkout/stripe-provider.ts:58`, Stripe's 30-minute minimum plus one) and 45 min hold (`src/lib/orders/record.ts:180`) | Accepted as a bounded window. A paid order is never refused at confirmation (that would mean a refund). The webhook evidence step re-runs `sellerMarketProblem` with the current row and alerts ops on a failure, so a seller who changed country mid-payment is seen |
| Market config change by deploy while pages are open | n/a | Same bound | Orders quoted under the old config confirm; the monitor sees them |
| Delivery address | Quoted, stored as quoted; Stripe never collects another | None | Nothing |
| Embed payload cache (5 min CDN) | Links only | n/a | Checkout re-gates |
| Cart lines | Stored without prices, re-quoted at POST | n/a | Nothing |

### 5.6 R5, the multi-seller-ready validator

`checkoutMarketProblem({ sellers: [...] })` (2.1) takes a list of seller facts. Today the only caller is `placeOrderResponse` with a list of one, because every cart and order is one storefront and one owner (`src/lib/products/purchasable.ts:276-284`; report 03 section 9). A future collab checkout appends each participating seller's facts (including each one's Stripe country) and the whole checkout is refused when any seller fails, answering `market_unavailable` (the buyer is not told which seller, as the gate never enumerates). Audit A item 24 describes the collab money flow; this validator is independent of it.

### 5.7 Buyer-facing messages

In `ProductPage.checkout.errors` (`messages/en/productPage.json:280-303`), shown through `messageFor` (`src/components/checkout/CheckoutForm.tsx:352-354`, extended to pass `{countries}` / `{amount}`):

| Code | English draft |
|---|---|
| `delivery_outside_market` | "During our beta, delivery is available within {countries} only. Nothing was charged." |
| `billing_outside_market` | "Downloads can be bought with a billing address in {countries} only during our beta. Nothing was charged." |
| `below_minimum` | "This order is below the smallest card payment ({amount}). Add something, then pay." |
| `market_unavailable` | "This shop can't take orders right now. Nothing was charged." |
| `invalid` + `fields: ["billingCountry"]` | field error "Choose your billing country." (`ProductPage.checkout.billingCountry.required`) |

The checkout picker (UI branch 10) only offers `MARKET.shippingCountries` intersected with the seller's priced countries, with a "*" row expanding to `MARKET.shippingCountries` (`src/components/checkout/CheckoutView.tsx:138-149`), so `delivery_outside_market` normally only answers a crafted request.

---

## 6. Admin and MCP

### 6.1 Admin

- **Restore path** (`C:\Squareshare\Admin\src\app\(app)\moderation\[targetType]\[targetId]\actions.ts`, `restoreContent` at `:441`, write of `moderation_status: "ok"` at `:392-393`): it changes moderation state only. A restored product or storefront becomes eligible again, but CP-1 and CP-4 still decide on every read, so a restore can never re-open an offer from an outside-market seller or in a disallowed currency. No change needed for enforcement. Requirement on P1b: guards on `products` must be scoped to currency and status changes, or this service-role update (and the moderation settle writes) would start failing on legacy rows.
- **Display** (separate Admin PR, not a Store branch): `SellerCard` shows the raw `tax_country` (`C:\Squareshare\Admin\src\lib\data\moderation.ts:961`, `:1034`); add an "outside the beta market" badge, and on content facts a "currency not sold in the beta" note, reading the `market_rules` mirror with Admin's service role (Admin has no market module and should not copy one).
- Admin has no write path for `tax_country` or product currency (grep, report 01 section 7); keep it that way.

### 6.2 MCP

- Inputs: `currency: z.enum(MARKET.currencies)` in `create_product`, `update_product`, `import_products` (`src/lib/agent/tools/products.ts:177`, `:205`, `:348`). The listed JSON Schema then advertises exactly the allowed currencies and follows any expansion. `get_schema` keeps describing the storage contract (`productWriteSchema`, storable enum); add a one-line `describe` that new prices must use the tool's enum.
- Descriptions, built from `MARKET` at module load (no literal codes):
  - `create_product`: "Prices are in {MARKET.currencies} only during the beta; another currency is refused with market_restricted."
  - `update_product`, `publish_products`: "A product priced in another currency can be edited as a draft but not published (market_restricted): change its currency, or leave it as a draft."
  - `import_products`: currency from the enum.
  - `save_shipping_policy` (`src/lib/agent/tools/storefronts.ts:429`): "Destinations may name only {MARKET.shippingCountries} ("*" means those countries); rates in {MARKET.currencies}. Anything else is refused with market_restricted and the countries to remove."
  - `create_discount`, `update_discount`: amount off in {MARKET.currencies}.
  - `update_embed_settings` (`:411`) and `get_store` (`src/lib/agent/tools/store.ts:30-33`): "market_restricted means the seller is not established where Square Share sells during the beta. Only the seller can change their details; never suggest declaring another country."
- `get_store` returns `market: { sellerCountries, shippingCountries, billingCountries, currencies }` and `sellerGate: reasons` (codes), so an assistant that "starts here" knows the rules before writing.
- Errors reach the assistant through `toEnvelope` (`src/lib/agent/dispatch.ts:67-78`): `code: "market_restricted"`, translated `message` and `fix`, `action` when there is one. `publish_products` already carries per-item envelopes (`src/lib/agent/tools/products.ts:285-289`).
- No new server actions and no new tools, so `tests/unit/agent/registry.test.ts` needs no new classification.

---

## 7. The build, as branches

All branches are cut from `main` in a git worktree (the shared tree has other live sessions). Server enforcement first, UI second. "DB" means the branch carries or depends on a P1b migration file; applying it to production is the owner's act and a schema sentinel makes the deploy refuse until it is applied.

### 7.1 Branch list in dependency order

| # | Branch | Purpose | Files touched (main) | Tests added | Depends on | Owner approval |
|---|---|---|---|---|---|---|
| 00 | `market/00-copy` | Every new message key, all 10 locales, so later branches do not touch `messages/*.json` | `messages/*/{errors,settings,productPage,onboarding,dashboard,products}.json` | `i18n-messages.test.ts` passes (every locale has every key, valid ICU, no em dashes) | none | Copy review (10 locales, bulk recipe) |
| 01 | `market/01-strict-currency` | Delete `toCurrency`; exact parse; gate drops unparseable rows; formatter never folds | `src/lib/market/currencies.ts` (new, parse only), the 29 call-site files, `src/lib/products/queries.ts`, `src/lib/format/money.ts`, `src/lib/products/purchasable.ts` | `market/currencies.test.ts`, `format.test.ts` rewritten | none | No |
| 02 | `market/02-czk-storable` | CZK storable; currency rules; minimum charge; per-currency delivery cap; `LEGACY_RATES_CURRENCY`; CSV `,-`; symbol helper | `src/types/product.ts`, `src/lib/market/currencies.ts`, `src/lib/discounts/pricing.ts`, `src/lib/checkout/quote.ts` (minimum), `src/lib/validation/shipping-policy.ts` (cap refine), `src/types/shipping-policy.ts`, `src/lib/shipping/rates.ts`, `src/lib/shipping/policy-prose.ts`, `src/components/products/PriceField.tsx`, `src/lib/products/price.ts`, `scripts/lib/prod-schema.ts` | storable-currency SQL drift; pricing; caps; CSV; formatting | 01 | **Yes**: P1b migration (three CHECKs allow CZK) applied before deploy |
| 03 | `market/03-market-root` | `MARKET`, validators, copy helpers, refusal wrapper, `market_restricted` factory, test fixtures, guard tests, mirror drift tests, coverage test skeleton | `src/lib/market/{market,problems,copy,refusal}.ts`, `src/lib/errors.ts`, `tests/setup/market.ts`, `tests/unit/market/*`, `scripts/lib/prod-schema.ts` | validator unit tests, expansion acceptance, no-override, mirror drift (unit + db), coverage skeleton | 02 (needs CZK in `Currency`) | **Yes**: P1b `market_rules` migration (new table: RLS coverage and harness entries are P1b's) |
| 04 | `market/04-seller-gate` | R1 server: accessor, `sellerGateReasons`, country as a required detail, publish and read gates, the four direct callers, Stripe country (create, store, re-check, `canTakePayments`, agreement), `saveTaxInfo` lock, onboarding refusal, previews, `get_store`; e2e seller fixture to a market seller | `src/lib/settings/{trader-identity,seller-identity,actions}.ts`, `src/lib/payments/connect/{account,actions,webhook}.ts`, `src/lib/billing/stripe-api.ts`, `src/lib/checkout/stripe-provider.ts`, `src/app/api/embed/[key]/route.ts`, `src/app/api/og/p/[productId]/route.ts`, `src/lib/agent/preview/*.ts`, `src/lib/agent/tools/store.ts`, `src/components/settings/TaxSection.tsx` (anchor id only), `tests/e2e/helpers.ts` | gate reasons; publish refusals; Stripe create params and refusal; webhook stores country; `canTakePayments`; mismatch; write-path matrix entries | 03 | **Yes**: changes who can sell (12 unset profiles and the IE seller lose publishing and selling); `seller_payment_accounts.country` migration; Stripe account creation parameters |
| 05 | `market/05-catalogue-currency` | R2 server: product writes, import, duplicate, card toggle, discounts; offering filter on every buyer surface; `assessLines`; `canPriceDelivery`; predictions; MCP product and discount tool enums and descriptions | `src/lib/products/{actions,card-actions,import-actions}.ts`, `src/lib/discounts/actions.ts`, `src/lib/products/purchasable.ts`, `src/lib/storefront/storefront-page.ts`, `src/lib/seo/sitemap.ts`, `src/app/api/og/p/[productId]/route.ts`, `src/lib/checkout/{quote,availability}.ts`, `src/lib/predictions.ts`, `src/lib/agent/tools/{products,discounts}.ts`, `src/lib/agent/preview/storefront-preview.ts` | matrix entries; offering filter; predictions; tool enum | 03 (and 04 only for the shared OG and preview files: merge 04 first) | **Yes**: hides the 16 live EUR products and refuses EUR edits that keep them live |
| 06 | `market/06-shipping-terms` | R2/R3 on the policy save; `ratesCurrency` required with priced rows; MCP `save_shipping_policy` and `update_embed_settings` descriptions | `src/lib/settings/shipping-actions.ts`, `src/lib/agent/tools/storefronts.ts` | policy validator; save refusal; matrix entries | 03 | Low: a seller whose policy names other countries must edit it on the next save |
| 07 | `market/07-checkout` | R3/R4/R5/R6: quote checks, `billingCountry` and `expectedCurrency`, `checkoutMarketProblem`, writer backstop, Stripe session parameter, webhook evidence, fees refactor, the minimal billing field in the form, dev simulator addresses, specs that seed non-market shipping | `src/lib/validation/checkout.ts`, `src/lib/checkout/{quote,place-order,provider,paid-checkout,stripe-provider}.ts`, `src/lib/orders/record.ts`, `src/lib/payments/connect/{webhook,fees}.ts`, `src/lib/billing/stripe-api.ts`, `src/types/checkout.ts`, `src/lib/checkout/line-problem.ts` (doc only), `src/components/checkout/CheckoutForm.tsx`, `src/lib/dev/simulated-sale.ts`, affected `tests/e2e/*.spec.ts` | quote refusals; placement; `checkoutMarketProblem` incl. two sellers; writer refusals; webhook evidence and alert; session parameters | 04, 05 | **Yes**: P1b migration (`orders.billing_country`, `card_country`, `stripe_billing_country`, `order_place` column list, guards); checkout behaviour; Stripe session parameters |
| 08 | `market/08-czk-reporting` | Analytics and dashboard currencies, plan calculator honesty, payments fallback, search label | `src/lib/analytics/{queries,types}.ts`, `src/components/analytics/chart-format.ts`, `src/lib/dashboard/format.ts`, `src/lib/billing/account-plan.ts`, `src/lib/payments/connect/overview.ts`, `src/app/api/search/route.ts` | aggregate labels; calculator null | 02 + P1b aggregate rewrite | Yes, for the aggregate migration only |
| 09 | `market/09-seller-ui` | Settings country field and notice, welcome-flow `EstablishmentCountryField`, dashboard market banner and attention row, product form and import currency pickers (market plus the edited row's legacy value), discount unit switch, shipping currency and country pickers, sample storefront | `src/components/settings/{TaxSection,ShippingSection,CountryPicker}.tsx`, `src/components/onboarding/WelcomeFlow.tsx`, `src/components/products/{ProductForm,ProductImport,PriceField}.tsx`, `src/components/discounts/DiscountForm.tsx`, dashboard banner components, `src/lib/storefront/sample.ts`, `src/lib/format/country.ts` | component tests | 04, 05, 06 | No (copy from 00) |
| 10 | `market/10-buyer-ui` | Checkout country picker to the market, "*" expansion, cart guess, delivery-area note | `src/components/checkout/CheckoutView.tsx`, `src/lib/cart/route.ts` | component tests | 07 | No |
| 11 | `market/11-e2e` | New specs, Stripe stand-in records request bodies, `e2e.yml` steps | `tests/e2e/*`, `tests/e2e/stripe-mock.ts`, `.github/workflows/e2e.yml` | 8.3 | all | **Yes**: owner OK to push a `ci/**` branch |

### 7.2 Parallelism and hot spots

- `messages/*.json` is the hottest file set (10 locales): all keys land once in 00, which can run in parallel with 01 to 03. UI branches 09 and 10 may still need small copy fixes; batch them into one follow-up commit rather than per branch.
- `src/lib/settings/constants.ts` is not edited (doc comments only, done in 03).
- Can run in parallel without touching the same files: 00 with 01; 05 with 06 (after 03 and 04); 08 with 04 to 07; 09 with 10.
- Must be sequential: 01 then 02 then 03; 04 before 05 (OG route and storefront preview are shared); 04 and 05 before 07 (quote, stripe-provider).
- `tests/unit/market/coverage.test.ts` is created in 03 with every entry pre-classified and marked `pending: "<branch>"`; each enforcement branch flips its own entries to `enforced`. One-line edits, trivial conflicts.
- `tests/e2e/helpers.ts` is edited in 04 only (market seller, market currency in `seedProducts`, `seedOrders`, `seedSignals`).

### 7.3 Rollout without a runtime switch

The brief says the deploy is the switch; I agree and argue against adding one. A runtime off switch is a second state that must be tested, it is the exact hole the rules exist to close, and it can be flipped without review. Staging comes from order instead:

1. Deploy 01 (no behaviour change), then 02 after its migration (CZK becomes possible).
2. Owner (or internal accounts) move internal catalogues to CZK and set countries.
3. Before deploying 04 and 05, run P1b's monitoring query in report mode: it lists exactly which sellers and products the gates would hide. The owner signs off on that list.
4. Deploy 04, 05, 06. Deploy 07 when Connect is about to go live (until then Stripe checkout is off in production: `NEXT_PUBLIC_STRIPE_CONNECT_ENABLED` is commented out, `.env.production:47`, from audit A; the R4 and Stripe parts are dormant but tested on the stand-in).

---

## 8. Test plan

Local reality: Vitest `unit` and `db` projects run locally, targeted files only; Playwright runs on GitHub only (a `ci/**` push, owner's OK).

### 8.1 Unit tests per validator (`tests/unit/market/`)

| File | Covers |
|---|---|
| `market-config.test.ts` | `MARKET` lists non-empty, unique, upper case, subsets of the storable lists; `MARKET_SQL_DIMENSION` complete |
| `problems.test.ts` | each validator: allowed, outside, missing, case; product legacy-draft rule (draft edit allowed, publish refused, switch to another disallowed currency refused, create refused); discount unchanged-legacy rule; policy rows incl. `"*"` and display-only rows with countries; delivery `""`; billing missing vs outside; `checkoutMarketProblem` order of rules and with two sellers where the second is outside (R5) |
| `expansion.test.ts` | the acceptance criterion with `marketWith(...)` (1.5) |
| `currencies.test.ts` | `parseCurrency` exact; `storedCurrency` throws; `CURRENCY_RULES` covers every storable code; minimum charge; `formatCents` CZK in `cs`/`en`, whole units; unknown currency never `€` |
| `copy.test.ts` | `marketCountryList` in `en`/`cs`, list joining with two codes |
| `no-override.test.ts` | 1.5 guard |
| `market-mirror-sql.test.ts`, `storable-currency-sql.test.ts` | 1.7 |
| `seller-gate.test.ts` | `sellerGateReasons` ordering; country as detail; `establishmentCountryOf` treats a non-storable stored value as missing; `traderIdentityFix` country sentences |
| `connect-country.test.ts` | `ensurePaymentAccount` sends `country`, refuses outside, refuses a mismatching answer, new idempotency key; `account.updated` stores country; `canTakePayments` country rule |
| `checkout-market.test.ts` | `quoteFromLines` refusals (pure, with `OPEN_MARKET` gates); `placeOrderResponse` with mocks: each single violation answers its code and nothing reaches `placeOrder`; `expectedCurrency` |
| `webhook-evidence.test.ts` | evidence written after confirmation; alert on billing mismatch; no alert on card-only mismatch; never a refund call |

Existing tests that change: `tests/unit/format.test.ts:7-17`, `:37-39`; `tests/unit/operating-countries.test.ts:16-40` (kept: it pins the storable area the Terms name; add "MARKET is inside it"); `checkout-quote`, `predictions`, `discount-*`, `shipping-rates`, `product-card-actions` (currency read now precedes the status write), `checkout-stripe-gate`, `connect-webhook-*` (report 02 section 10 lists the files that pin EUR/USD). Pure money tests keep EUR fixtures: EUR stays storable, so they need no churn. Only tests that pass through a market-aware function switch to `MARKET_FIXTURE` or pass `OPEN_MARKET`.

### 8.2 The "every write path rejects" test, and why this harness

**Harness: Vitest unit with mocked boundaries**, plus a structural coverage test. Reasons: server actions need the Next request context (cookies, headers, next-intl), which the `db` project does not provide; e2e cannot run locally and is too slow to walk dozens of paths; the existing action tests already use exactly this pattern (`tests/unit/product-card-actions.test.ts:8-63` mocks `getActiveAccount`, rate limit, publish gate and a recording Supabase client). The DB guards for paths that skip the app are proven in the `db` project by P1b.

1. `tests/unit/market/write-paths.test.ts` (the matrix). For each enforced path: mock the boundary, call it with (a) a seller outside the market or without a country, (b) a disallowed currency, (c) a disallowed delivery country where applicable, and assert the result is a refusal with code `market_restricted` (or `trader_identity_required` for a missing country, or the checkout code) AND that the recording client saw no `insert`/`update`/`rpc` on the governed table, and that no Stripe request was made. Rows: `createProduct`, `updateProduct` (to EUR; legacy active edit; legacy draft edit allowed), `setProductStatus`, `duplicateProduct`, `importProducts`, `createDiscount`, `updateDiscount`, `saveShippingPolicy` (country row; rates currency), `saveTaxInfo` (mismatch lock; outside-market saved with notice), `startStripeOnboarding` (missing; outside), `updateEmbedSettings` (outside seller), the MCP tools through `findTool(...).input.safeParse` (enum refusal) and through their handlers (inherit), `placeOrderResponse` (delivery, billing, currency, seller), `placeOrder` writer (currency, ship country).
2. `tests/unit/market/coverage.test.ts` (walks the inventory). Reuses the scan of `tests/unit/agent/registry.test.ts:180-188` for every `"use server"` export and adds route handler files under `src/app/**/route.ts`. A `MARKET_COVERAGE` map classifies each as `enforced: <validator identifiers>` or `exempt: <reason>` (the 2.4 tables, verbatim). Assertions: nothing unclassified; nothing classified that is gone; every `enforced` entry's function body (text scan, as the step-up test does at `registry.test.ts:219-231`) names one of its validators or a wrapper known to call one (`publishBlockedError`, `quoteOrder`, `placeOrderResponse`). MCP tools are covered transitively through the registry's action-to-tool map, plus a check that every tool `currency` input enum equals `MARKET.currencies`.

### 8.3 E2E specs (GitHub, `ci/**` push)

| Spec / config | Proves |
|---|---|
| `110-czech-market.spec.ts` under `playwright.checkout.config.ts` (test provider) | CZ seller + CZK product + CZ address: order placed, thank-you page, order row has `currency = CZK`. Each single violation, with its message: delivery outside the market (crafted POST answers 409 `delivery_outside_market`; the picker lists only market countries); download with billing country outside (inline message, then 409 if forced); EUR product seeded by service role (product page 404, no tile, cart refuses); seller publishes an EUR product (form shows the market refusal); IE seller (publish refused with the market message, buyer pages 404); unset country (trader-identity refusal naming the country). Embed on a foreign site: `/dev/embed-host` (`src/app/dev/embed-host/route.dev.ts`, from report 04) frames a CZ seller's storefront; buyer goes frame, product page, checkout with a CZ address, order placed |
| `111-connect-market.spec.ts` under `playwright.connect.config.ts` (Stripe stand-in) | onboarding refused for a seller outside the market; account created with `country=CZ` (the stand-in is extended to record request bodies; today its `POST /accounts` ignores parameters, `tests/e2e/stripe-mock.ts:258-268` per audit A); `account.updated` with an outside country removes checkout; a download order's session carries `billing_address_collection=required`; webhook with a mismatching billing country and a foreign card pays the order, records both, raises the ops alert, makes no refund call |
| Collab with one non-CZ seller | Cannot be an e2e spec: no collab checkout exists. Covered by the two-seller unit test (8.1) and a structural unit test that a quote holds one owner |

`e2e.yml` (`.github/workflows/e2e.yml:65-78`): add step "The Czech market rules" running `110-czech-market.spec.ts` under the checkout config, and step "Stripe Connect stand-in" running `npx playwright test --config playwright.connect.config.ts 87-stripe-connect.spec.ts 111-connect-market.spec.ts` (the connect run is not in CI today). Add 110 to `playwright.checkout.config.ts` `testMatch` (`:39-50`) and 111 to the connect config (`:42`). Keep each step under nine minutes (memory note on laptop sleep and batch sizes applies to CI runtime too).

Real Stripe test mode is an owner-only run (keys): a written checklist in the branch 11 PR (create a CZ account, complete onboarding, one CZK download order with a foreign card, check the webhook evidence and the fee).

### 8.4 Fixtures and seeds without future churn

- One source: `tests/setup/market.ts` (1.5). E2E `PUBLISHABLE_SELLER` (`tests/e2e/helpers.ts:498-506`, today `country: "IE"` and a Dublin address) becomes `country: MARKET_FIXTURE.sellerCountry` with a neutral Czech address; `seedProducts` currency (`:448`), `seedSignals` (`:662`), `seedOrders` (`:706`) use `MARKET_FIXTURE.currency`. Specs that seed shipping policies use `MARKET_FIXTURE.shippingCountry`. Specs about refusals use `OUTSIDE_MARKET`, which stays outside after any expansion. Expanding the market changes none of these files.
- Pure unit fixtures in EUR stay (EUR is storable).
- Scripts (`scripts/lib/fake-data.ts:668-677` `STORE_CURRENCY = "EUR"`, `scripts/seed.ts`, `scripts/stock-smoke.ts`, from report 02) switch to `marketDefaultCurrency()` in branch 05; the demo simulator SQL is P1b's.

---

## 9. How to expand to the EU (for the owner)

Example: open Slovakia (sellers, delivery, billing) and euro prices.

1. **Decide and clear legally**: Terms and privacy wording (the Terms already name the EU; any beta restriction stated there follows `docs/changing-the-terms.md`); Stripe Dashboard Connect onboarding countries (owner's account).
2. **Edit `src/lib/market/market.ts`**: add `"SK"` to `sellerCountries`, `shippingCountries`, `billingCountries`; add `"EUR"` to `currencies` (keep `"CZK"` first if Czech sellers should still default to koruna). Nothing else in TypeScript: names, pickers, MCP enums and messages derive from it.
3. **If the currency or country is not storable yet** (not the case for SK or EUR): add it to `CURRENCIES` and `CURRENCY_RULES` (minimum charge from Stripe's table, delivery cap), and P1b adds it to the currency CHECKs.
4. **Add one migration** that rewrites the `market_rules` mirror to the new full state (P1b's pattern). The drift tests (unit and db) fail until steps 2 and 4 agree, so they ship together.
5. **Copy review**: no key spells a country; re-read the market banners and checkout messages in all ten languages for grammar with a two-country list; review Home, Docs and marketing pages (outside Store).
6. **Run** the market unit tests and the db test locally; push a `ci/**` branch for e2e (owner OK); apply the migration to production; deploy (the schema sentinel refuses until the mirror is applied).
7. **Check** with the monitoring report that no unexpected rows changed state.

Open design question that expansion raises: should currencies be tied to the seller's country (a CZ seller in CZK only, an SK seller in EUR only)? Today `currencies` is one flat list (11.2 Q6); every validator takes the whole `market`, so a per-country rule would change one predicate.

---

## 10. Seams for the seller onboarding workstream (1B)

Not designed here; these are the seams this design leaves.

1. **Establishment country accessor**: `establishmentCountryOf(row)` and `ESTABLISHMENT_COUNTRY_SELECT` in `src/lib/settings/seller-identity.ts` (4.1), plus `readEstablishmentCountry(ownerId)`. Interim source `profiles.tax_country`. 1B changes these two definitions to read the structured primary address country ("from 1B"); no call site changes. `buildSellerIdentity`'s display country should follow the same accessor in that change.
2. **One gate predicate with named reasons**: `sellerGateReasons(input, options)` returns `SellerGateReason[]` (4.2). "market" and "details_missing" are separate kinds with separate codes (`market_restricted`, `trader_identity_required`) and copy. 1B appends kinds (for example `verification_pending`, `sanctions_hit`, `payments_not_ready`), extends `SellerGateInput` with the facts they need, and maps each to its own seller message and buyer behaviour in `publishBlockedError` / `sellerMaySell`. Every caller (CP-1 table) already goes through these two wrappers or `getTraderIdentityStatus`, so new reasons reach every publish write and every buyer read without touching call sites.
3. **`charges_enabled` for publish and checkout (owner decision, 1B's to switch on)**:
   - Where: a `payments_not_ready` reason in `sellerGateReasons`, fed by `SellerGateInput.payments?: { ready: boolean }`, enabled by an option `requirePaymentsReady` whose value comes from one constant owned by 1B (for example `SELLER_GATE_REQUIRES_PAYMENTS = false` in `trader-identity.ts`), flipped in 1B's branch. A code constant, so the deploy is the switch, consistent with 7.3.
   - "Ready" means `checkoutProviderFor(ownerId) !== null` (`src/lib/checkout/availability.ts:73-83`), which already folds the cases: the dev-only test provider counts as ready (so `next dev` with `CHECKOUT_TEST_PAYMENTS=1`, the unit tests and the checkout e2e run keep working); the Stripe stand-in run uses a connected account with `charges_enabled`; with Connect switched off and no test provider, nothing is ready.
   - Cost: the read side would need the payment account on every gate call (one more service-role read per public page; `getPaymentAccount` is React-cached in renders, not in route handlers).
   - Effect while Connect is off in production: every seller is "not ready", so switching it on would hide every listing (all 16 live products) and refuse every publish. It can only be switched on together with Connect going live and sellers onboarded. Not part of P1a's default behaviour.
4. **Sign-up country question**: `EstablishmentCountryField` (select + market notice, posts `tax_country` through `saveTaxInfo`) is the only new onboarding piece (4.3). 1B makes it step one of the universal form and points it at its own field.
5. **No identity or tax fields here**: no seller type, legal names, structured address, tax IDs, VIES, ARES, declarations, verification log or sanctions. The free-text address cross-check (4.4) waits for 1B's structured address.

---

## 11. Risks, open questions, and what I could not determine

### 11.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Branch 04 makes 12 unset-country profiles and the IE seller unable to publish or sell; their pages disappear at deploy | Dry-run list and owner sign-off (7.3); nothing deleted, reversible |
| R2 | Branch 05 hides the 16 live EUR products (internal or test per the owner's facts) | Same; convert internal catalogues to CZK after branch 02 |
| R3 | Code deployed ahead of its migration (CHECKs, `seller_payment_accounts.country`, orders columns, `order_place` column list) | Schema sentinels per branch; fail-closed reads; `jsonb_populate_record` tolerates the extra key but the insert list must be updated (db test) |
| R4 | `storedCurrency` throws in a render if a CHECK and `CURRENCIES` ever drift | Drift test 1.7.3 gates every deploy; the gate drops unparseable rows before any buyer path |
| R5 | Stripe test mode has never been exercised; the stand-in ignores parameters | Stand-in records bodies (branch 11); owner's real test-mode checklist |
| R6 | Display-only shipping rows with free-text areas ("EU", "USA", as the CZ seller in production has) keep printing on product pages; code cannot read them | Shipping settings notice; monitoring lists policies whose row text names other places; owner decides whether to hide display-only rows during the beta (Q8) |
| R7 | Interpolated country names read wrongly in declined languages | Translator rule in 1.4 |
| R8 | "Services" are not a product kind; a service sold as a product without a file is treated as a parcel (needs delivery) and never asks a billing country | Owner question Q4; R4 covers downloads until a service kind exists |
| R9 | Self-declared billing country is weak evidence; Stripe's billing address is collected only for download orders | Record both; alert on disagreement; monitor card-country rates |
| R10 | The account-type change (Express to full Dashboard) is still pending | Country handling is type-agnostic; idempotency key bumped once per parameter change |
| R11 | Coverage test text scan can be fooled by a validator name in a comment | Same trade-off the existing step-up scan accepts; the behavioural matrix catches real misses |

### 11.2 Questions for the owner

1. Accept that an outside-market country is saved truthfully and only selling is refused (4.4), rather than refusing the save?
2. Hide legacy-currency products from buyer pages entirely (this design), or keep the page and remove only checkout (their seller-link fallback would then still be an offer made on Square Share's page)?
3. Approve each DB-coupled branch's migration and the who-can-sell changes (7.1 approvals column).
4. Should a "service" product kind exist for R4, or is R4 limited to downloads in the beta?
5. Seller plan prices stay in EUR for CZK sellers? Until decided, the plan calculator shows no sales-based figure for them instead of a false 0.
6. Should allowed currencies be tied to the seller's country when the market widens (9)?
7. P1b: add `orders.stripe_billing_country` beside `billing_country` and `card_country` (5.4)? And write mirror updates as one full-state JSON literal per migration (1.7)?
8. During the beta, hide display-only delivery rows that carry no machine-readable country?
9. CZK display: drop ",00" on whole amounts (Czech convention) or always show haléře? (lab tile first)
10. Should a seller be notified (not only ops) when a paid order's Stripe billing country differs from the declared one?
11. Where should an outside-market seller be sent (a Home waitlist page constant beside `SQUARESHARE_SITE`, `src/lib/legal/links.ts:39`)? R8's waitlist is Home's.

### 11.3 Could not determine

- Exact PostgREST error codes for a missing column on select versus write in this project's PostgREST version (I chose fail-closed plus sentinels, which does not depend on them).
- P1b's constraint names for the currency CHECKs, the `market_rules` shape and the guard semantics; this design states what it needs (scoped guards, full-state mirror updates, `order_place` column list).
- Whether Stripe returns `customer_details.address` on a connected account's `checkout.session.completed` when `billing_address_collection` is `auto` and nothing was needed (expected absent; handled as absent).
- Whether CZ accounts need the `transfers` capability with direct charges (audit A leaves it open; untouched here).
- The Home waitlist route and whether it will carry a country (R8, outside Store).
- Line numbers marked (from report NN) were not re-opened for this design.

### 11.4 Stripe documentation read (2026-11-22)

- https://docs.stripe.com/currencies : CZK two-decimal with no special case; minimum charge 15.00 CZK, 0.50 EUR, 0.50 USD; card amounts up to 12 digits, American Express 9.
- https://docs.stripe.com/api/checkout/sessions/create : `billing_address_collection` `auto` ("only collect the billing address when necessary") and `required` ("always collect"); allowed-countries exists only under `shipping_address_collection`; `expires_at` 30 minutes to 24 hours.
- https://docs.stripe.com/api/charges/object : `payment_method_details.card.country` is "Two-letter ISO code representing the country of the card".
