# E. Czech-only beta: gap analysis

Audit E of the compliance workstream. It measures the platform against the
Czech-only beta rules R1 to R8 and the supporting requirements in the brief,
using the merged write-path inventory
(`docs/compliance/WRITE_PATH_INVENTORY.md`, path ids such as P-06 and choke
points such as CP-14 refer to it), the nine Phase 0 reports ([01] to [09]),
audit [A] (`docs/compliance/audit/A-stripe-config-money-flow.md`), the
orchestrator's read-only production facts of 2026-11-22, and code opened during
this merge. Investigation only: nothing was built, run or queried.

Status vocabulary: **exists** (the requirement holds today), **partial** (some
of it holds, or the mechanism exists with the wrong values), **missing**
(nothing enforces it), **CONFLICTS** (the current code, data model or published
text actively states or enforces the opposite, so something must be removed or
changed, not only added).

---

## 0. Summary

### 0.1 Status

| # | Requirement | Status |
|---|---|---|
| R1 | Seller established in CZ (Stripe account country and business address country) | **missing** |
| R2 | Products and prices in CZK only | **CONFLICTS** |
| R3 | Delivery only to CZ addresses (physical goods) | **partial** |
| R4 | Buyer billing country CZ for digital goods and services; card country logged as evidence | **missing** |
| R5 | Collab checkout: every participating seller passes R1 to R3 | **partial** |
| R6 | No checkout without all rules, enforced server-side at checkout | **partial** |
| R7 | Clear public messaging (homepage/pricing, sign-up, seller terms, embed/checkout, docs) | **CONFLICTS** |
| R8 | Expansion waitlist with a friendly block (email + country) | **missing** |
| S1 | One config module, no scattered "CZ" literals | **missing** |
| S2 | Server-side validators used by every write path | **partial** |
| S3 | Stripe account country set at creation, re-checked on `account.updated`, publishing and checkout blocked | **missing** (and the create call **CONFLICTS** with the account-type decision, [A] section 0) |
| S4 | DB constraints where sensible | **CONFLICTS** (currency CHECKs forbid CZK) / **missing** (no country rule) |
| S5 | Read-only report of existing violating data | **partial** |
| S6 | Data model stays EU-ready | **partial** |
| S7 | Czech-language legal texts and checkout | **partial** |
| S8 | Scheduled monitoring for R1 to R5 | **missing** |

R1 to R8: **0 exist, 3 partial (R3, R5, R6), 3 missing (R1, R4, R8), 2 CONFLICTS
(R2, R7).** Over the 94 rule-relevant write paths, not one cell is "enforced
today" for any of R1 to R6 (inventory section 1).

### 0.2 The five facts that shape the build

1. **Nothing in production can check out today.** Stripe Connect is off,
   `seller_payment_accounts` is empty and no order has a `payment_ref`; the test
   provider exists only under `next dev` (`Store/src/lib/checkout/availability.ts:41-43`,
   `:73-83`). So the checkout-time rules (R2 to R6 at C-01/C-02) change nothing
   a buyer can see until Connect launches, while the publishing and visibility
   rules (R1 in CP-1, any read-side R2 rule) take listings off the site the day
   they deploy. Sequence the work accordingly (section 7).
2. **CZK cannot be stored, and if it could it would be charged as EUR.** Three
   CHECKs allow only EUR/USD (CP-12), and `toCurrency` maps every non-USD value
   to EUR on the checkout path (CP-13, `Store/src/lib/format/money.ts:12-14`).
3. **The storage enums are also the read enums.** Pointing
   `SHIPPING_COUNTRY_CODES` or `CURRENCIES` at `["CZ"]`/`["CZK"]` blanks every
   stored shipping policy (CP-21) and silently drops amount discounts
   (`Store/src/lib/discounts/row.ts:42-46`). The market rule must be a separate
   config list ([09] section 0 item 8).
4. **A live writer creates orders outside checkout.** The demo sales simulator
   (J-03) inserts EUR orders shipped to ten countries every 20 minutes in
   production, with no gate and no CHECK to stop it.
5. **The only seller-side choke point that reaches every publish, every buyer
   read and the order quote already has the country in hand** (CP-1/CP-2,
   `Store/src/lib/settings/trader-identity.ts:115-152`), and every MCP write
   tool runs the same server actions (CP-29). One predicate covers UI, MCP,
   embed and checkout.

---

## 1. Rule by rule

### R1. Seller established in CZ

**Requirement.** Stripe connected account country = CZ and business address
country = CZ, holding at seller sign-up, Stripe account creation, the
`account.updated` webhook, Admin tools and MCP.

**Status: missing.**

**Evidence.**
- The only seller-country field is the optional `profiles.tax_country`,
  validated against EU 27 + US + CA (`Store/src/lib/validation/settings.ts:131-136`,
  CP-8) and writable around that list over PostgREST (DB-01, shape
  `^[A-Z]{2}$` only, `Store/tests/db/prod-migrations.sql:261-262`) ([01] headline 1-2).
- The business address is one free-text field with no country
  (`Store/supabase/migrations/20260905_seller_identity_on_profile.sql:36-50`) ([01] headline 1).
- Neither sign-up path (S-01 `Store/src/lib/auth/actions.ts:355-462`, S-02
  Google OAuth) nor the welcome flow (S-04, `Store/src/components/onboarding/WelcomeFlow.tsx:436`, `:454`, `:477`)
  asks for a country ([01] B9, [08] section 3).
- The publish and sell predicate reads `tax_country` and ignores it
  (`Store/src/lib/settings/trader-identity.ts:27-29`, `:115-144`) ([01] headline 3).
- The Stripe account gets `country` only when `tax_country` happens to be set
  (`Store/src/lib/payments/connect/account.ts:153-164`), an existing account is
  returned unchecked (`:150-151`), and no code stores or checks the account
  country (`Store/src/lib/billing/stripe-api.ts:110-115`;
  `Store/supabase/migrations/20261008_seller_payment_accounts.sql:33-49`;
  `Store/src/lib/payments/connect/webhook.ts:165-175`;
  `canTakePayments` `account.ts:102-104`) ([01] headline 4, [A] section 11).
- Admin cannot set a country, but its restore (AD-02/AD-03) relists anything
  and its seller card shows `tax_country` as unflagged free text
  (`Admin/src/components/moderation/SellerCard.tsx:116-118`) ([06] headline 2).
- MCP cannot reach `saveTaxInfo` or `startStripeOnboarding` (step-up and money
  classes, `Store/tests/unit/agent/registry.test.ts:212-231`), so R1 inputs
  change only in a seller session; MCP publish paths do go through CP-4 ([04] 1.5).

**Path ids it must cover.** S-01, S-02, S-03, S-04, A-01, A-02, A-03, DB-01;
every publish path through CP-4 (P-01 to P-07, I-01, I-02, SF-04); the
gate-less config writers SF-02, SF-03, DB-06; every buyer read and the quote
through CP-3/CP-5 (C-01, C-02, C-05, C-07, RG-1 to RG-4) and the direct
callers RG-5 to RG-8; AD-02, AD-03; O-03 (window).

**What is missing.** A configured seller-country list; a structured business
address country (or the decision that `tax_country` is it); the country in the
publish/sell predicate; the country question at sign-up and onboarding; the
Stripe country pinned, stored and re-checked; a DB backstop on the column.

**Proposed fix (smallest reviewable changes, in order).**
1. **Config + predicate (one PR).** `SELLER_COUNTRIES` in the market config
   module (S1). Add `country` to `TraderIdentityInput` in CP-2
   (`Store/src/lib/settings/seller-identity.ts:109-120`, the row already holds
   `tax_country`) and make CP-1 return a `country` problem when it is missing or
   not allowed. This alone reaches CP-4 (all publish writes, UI and MCP), CP-3
   (product page, checkout pages, cart, discount check, quote at placement,
   storefront page, embed frame, sitemap) and RG-5 to RG-8, with no new query.
   Delete the stale comment at `trader-identity.ts:27-29`. Gate the READ side
   behind a launch switch until the owner has decided on existing accounts
   (section 5).
2. **Business address country.** Decision needed (section 6). Smallest:
   treat `tax_country` as the country of the business address, render it as
   the last line of the address block in Settings and the welcome flow
   (`Store/src/components/settings/TaxSection.tsx:168-178`, `:361-371`), label
   it so, and make CP-8 refuse a value outside `SELLER_COUNTRIES` (an empty
   value stays allowed at save time so partial saves work; CP-1 requires it).
3. **Sign-up and onboarding.** A country select on the sign-up form (S-01,
   `Store/src/components/auth/LoginForm.tsx`) and as the first question of the
   welcome flow seller step (S-04, also catches S-02 OAuth); a non-allowed
   answer shows the R8 block. Never trust the sign-up answer alone: CP-1 decides.
4. **Stripe (lands with [A]'s account-type change, same create call, before the
   first account exists).** In `startStripeOnboarding`
   (`Store/src/lib/payments/connect/actions.ts:51-73`) refuse unless the
   seller country passes; in CP-7 send `country` from config, never from the
   profile; assert the returned `country`; add `seller_payment_accounts.country`
   (shape CHECK) and write it in CP-7b on create, return refresh (A-02) and
   `account.updated` (A-03); make CP-6 `canTakePayments` require an allowed
   country. Production has 0 connected accounts, so no migration of accounts.
5. **DB backstop for DB-01.** A trigger `BEFORE UPDATE OF tax_country` (and
   `BEFORE INSERT`) on `profiles` that refuses a non-null value outside the
   allowed list, bound for every role. Do NOT use a plain CHECK
   `tax_country = 'CZ'`: buyers share the table and `handle_new_user` inserts
   null (`Store/supabase/migrations/20261021_reserved_usernames.sql:103-112`)
   ([05] 7.4). Scoping to `UPDATE OF tax_country` leaves the IE row untouched
   by unrelated updates.
6. **Admin.** Add a "market rules" removal ground (list
   `Admin/src/lib/moderation/content.ts:234-243` and its CHECK
   `Store/supabase/migrations/20260926_moderation_decisions_and_appeals.sql:52-54`
   together) and a non-allowed-country flag on `SellerCard`. Restore needs no
   change once the read gates carry the rule.

### R2. Products and prices in CZK only

**Requirement.** CZK only at product create/edit, import (CSV and
`import_products`), MCP tools, discounts and checkout creation.

**Status: CONFLICTS.** The platform forbids the required currency and coerces
unknown currencies to EUR.

**Evidence.**
- `CURRENCIES = ["EUR","USD"]` (`Store/src/types/product.ts:12`), used to write
  AND to read (CP-11) ([02] C2).
- Three live CHECKs: `products.currency in ('EUR','USD')` default `'EUR'`
  (`Store/tests/db/prod-migrations.sql:157`), `product_price_history.currency`
  (`Store/supabase/migrations/20261004_discounts.sql:253`, written by a trigger
  on every price change), amount `discounts` (`:84-92`) (production facts
  confirm all three) ([05] headline 1).
- `toCurrency` and the inline twin map anything but USD to EUR
  (`Store/src/lib/format/money.ts:12-14`, `Store/src/lib/products/queries.ts:143`),
  on the quote, the Stripe session currency and every owner-side product read;
  a unit test pins it (`Store/tests/unit/format.test.ts:37-38`) ([02] headline 3).
- Defaults pick EUR for a CZ seller (`Store/src/lib/predictions.ts:248-257`);
  shipping `ratesCurrency` absent means EUR (`Store/src/lib/shipping/rates.ts:118`);
  quote fallback EUR (`Store/src/lib/checkout/quote.ts:330`); `order_place`
  `coalesce(incoming.currency,'EUR')` (production body
  `Store/supabase/migrations/20261028_product_add_ons.sql:231`); `orders.currency`
  has no CHECK (`prod-migrations.sql:301`) ([02] 8, [05] 7.5).
- Paths that skip the write schema: P-06 status toggle, P-08 duplicate, DB-02
  and DB-03 direct writes, DB-05 scripts, J-03 simulator (orders in
  `cfg.currency`, `Store/supabase/migrations/20260927_demo_sales_sim_fulfilment.sql:177`).
- One server-side currency backstop already exists on the buy path: `assessLines`
  enforces one currency per order and a shipping policy in that currency
  (CP-14, `quote.ts:231-308`).

**Path ids it must cover.** P-01 to P-08, I-01, I-02, D-01, D-02, SH-01,
SH-02, C-01 to C-04, C-07, O-01, O-03, O-11, AD-02, AD-03, J-03, DB-02 to DB-05.

**What is missing.** CZK as a storable and readable currency; a separate
"allowed for sale" list; a non-lossy reader; a server-side "currency allowed"
check at checkout; DB backstops that bind direct writes and the service role.

**Proposed fix (in order; steps 1 and 2 before anything else).**
1. **Readable vs saleable (code only).** Rename the storage list to
   `KNOWN_CURRENCIES = ["CZK","EUR","USD"]` (read, format, store) and add
   `SALE_CURRENCIES` to the market config (write gate). Rewrite `toCurrency` to
   return a known code unchanged and fail loudly (or return null) on an unknown
   one; fix `queries.ts:143`; update `format.test.ts:37-38`. Without this,
   step 2 makes CZK rows display and charge as EUR (hazard H2).
2. **Widen the three CHECKs together (one migration, validated, no NOT VALID:
   every existing row passes).** Add `'CZK'` to `products_currency_check`, the
   `product_price_history` CHECK and `discounts_value`; add a prod-schema
   sentinel of kind `check` (`Store/scripts/lib/prod-schema.ts:33-34`, `:231-237`)
   and the replay entry ([05] 7.6).
3. **Write gates use `SALE_CURRENCIES`.** In CP-10 (`productWriteSchema`),
   CP-15 (`discountInputSchema`), CP-20 (`ratesCurrency`), the import check
   (`Store/src/lib/products/import-actions.ts:151-155`) and the three MCP enums
   (`Store/src/lib/agent/tools/products.ts:177`, `:205`, `:348`). One edit per
   schema covers UI and MCP; `get_schema` advertises the new enum by itself.
   P-06 (`setProductStatus`) must refuse to publish a row whose stored currency
   is not saleable. P-08 must validate the copied currency.
4. **Checkout backstop (R6).** In CP-14 refuse any line whose product currency
   is not in `SALE_CURRENCIES` (new refusal code), so a legacy EUR product
   that is still live cannot be bought even if a write path was missed. Add
   the currency to the client's `expectedTotalCents` comparison
   (`Store/src/lib/checkout/place-order.ts:151`).
5. **DB backstops (bind the service role).** A trigger on `products`
   `BEFORE INSERT OR UPDATE OF currency, status` that refuses a non-saleable
   currency on insert, on a currency change, and on a change to
   `status = 'active'`; the same on `discounts` for `currency`; a `BEFORE INSERT`
   trigger on `orders` refusing a non-saleable currency (covers O-01, J-03,
   DB-05). Triggers, not CHECKs, so legacy rows survive unrelated updates
   (hazard H3). Change the `products.currency` default from `'EUR'` to the sale
   currency (or drop it) so a direct insert cannot fall back to EUR.
6. **Defaults and limits.** `homeCurrency` and the form defaults
   (`ProductForm.tsx:261`, `ProductImport.tsx:85`, `DiscountForm.tsx:115`,
   `:132`, `ShippingSection.tsx:203`) read the first sale currency; per-currency
   limits for `MIN_PAYABLE_CENTS`, `PRICE_CENTS_MAX`, `SHIPPING_RATE_MAX_CENTS`,
   `DISCOUNT_AMOUNT_MAX_CENTS` (hazard H8).
7. **CSV.** Refuse a price cell whose symbol or code names a currency other
   than the file's pick (`Store/src/lib/products/price.ts:62-65`), so "12 €"
   imported as CZK fails instead of becoming 12 Kč.

### R3. Delivery only to CZ addresses (physical goods)

**Requirement.** Holds at shipping policies, checkout address collection, and
server-side re-validation before the payment and order are created.

**Status: partial.** Server-side delivery-country validation exists in two
layers at checkout, against the wrong list and with a catch-all.

**Evidence.**
- Server layer 1: `shipTo.country: z.enum(SHIPPING_COUNTRY_CODES)` (CP-19,
  `Store/src/lib/validation/checkout.ts:41`): 27 EU + US + CA as a literal tuple
  (`Store/src/lib/settings/constants.ts:129-136`) ([03] Q1).
- Server layer 2: the seller's priced destination rows via the quote (CP-18,
  CP-22, `Store/src/lib/shipping/rates.ts:139-207`); a `"*"` row admits all 29
  codes, and the checkout picker expands `"*"` to all 29
  (`Store/src/components/checkout/CheckoutView.tsx:138-143`) ([03] Q1-Q2).
- Seller policies accept any of the 29 codes or `"*"` (CP-20,
  `Store/src/lib/validation/shipping-policy.ts:44-65`), and free-text rows with no
  `countries` (display-only, `rates.ts:56-62`) whose words reach buyers in the
  shipping prose ([05] 1.1, [08] 1b).
- Nothing below the app checks: `parseShipTo` only checks `^[A-Z]{2}$`
  (`Store/src/lib/orders/ship-to.ts:14`, `:44-45`), a failed parse writes
  `ship_to = null` (`Store/src/lib/orders/record.ts:430`), `order_place` has no
  country logic, `orders.ship_to` CHECK is object + size only
  (`Store/supabase/migrations/20260927_order_fulfilment.sql:87-93`); Stripe is sent
  no address collection or allowed countries
  (`Store/src/lib/checkout/stripe-provider.ts:122-168`) ([03] headline 2-3).
- The simulator ships to IE, DE, FR, NL, IT, ES, CZ, PL, PT, SK
  (`20260927_demo_sales_sim_fulfilment.sql:55-66`); production holds 584 orders
  shipped to other EU countries and 84 to CZ.

**Path ids.** SH-01, SH-02, C-01 to C-04, O-01, O-03, O-11, J-03, DB-05; S-05
(ships-from).

**What is missing.** A configured delivery list independent of the seller's
`"*"`; a tolerant reader before any narrowing; a parcel order without a valid
allowed `ship_to` refused below the app; messaging for free-text rows.

**Proposed fix.**
1. **Make CP-21 tolerant first** (`Store/src/lib/settings/shipping-policy.ts:50-60`):
   parse with a lenient read schema that drops a destination code outside the
   readable list instead of returning `{}`; keep `SHIPPING_COUNTRY_CODES` as the
   readable list (CZ is already in it). Without this, steps 2 and 3 blank
   policies and shorten withdrawal windows on existing orders (hazard H1).
2. **Checkout (server).** Add a refine to CP-19 against `DELIVERY_COUNTRIES`
   from config, and make CP-22 treat `"*"` as "any `DELIVERY_COUNTRIES`" (also
   `shippingCountries()` `rates.ts:85-105` and the picker
   `CheckoutView.tsx:138-143`). With one allowed country the form already
   renders it as plain text (`Store/src/components/checkout/CheckoutForm.tsx:661-665`).
3. **Policies (write).** CP-20 refuses a destination code outside
   `DELIVERY_COUNTRIES` on save (a refine, not a narrower enum) and `shipsFrom`
   outside `SELLER_COUNTRIES`. Existing policies stay readable and are reported.
4. **DB backstop.** In the `orders` `BEFORE INSERT` trigger (R2 step 5): when
   `ship_to` is not null, `upper(ship_to->>'country')` must be allowed; when the
   order ships (physical, `fulfilment_status <> 'not_required'`), `ship_to` must
   be present. Binds O-01, J-03, DB-05.
5. **Free text.** A fixed platform line "Delivery within the Czech Republic
   only" beside the seller's own shipping words on the product page and
   checkout (`buildTrustLines`, `Store/src/components/product-page/TrustList.tsx:16-42`),
   so a stored "EU" or "USA" row cannot mislead (R7).

### R4. Buyer billing country CZ for digital goods and services; card country as evidence

**Requirement.** At checkout; log the card's issuing country as evidence and
never block on it alone.

**Status: missing.**

**Evidence.** No billing country is collected, sent to Stripe, read from the
webhook or stored, for any order (`Store/src/lib/validation/checkout.ts:50-67`;
`Store/src/lib/checkout/stripe-provider.ts:122-168` sends no
`billing_address_collection`; `Store/src/lib/payments/connect/webhook.ts:177-215`
reads no `customer_details`; `orders` has no such column,
`Store/src/types/supabase.ts:1417-1470`). Digital-only orders collect no
address at all (`Store/src/components/checkout/CheckoutForm.tsx:406-421`;
`place-order.ts:173`). The card country is not read, though the PaymentIntent
is already fetched with `latest_charge` after payment
(`Store/src/lib/payments/connect/fees.ts:67-72`) ([03] headline 3, 3.4).
Digital means `digital_file_key` is set (`Store/src/lib/checkout/quote.ts:253`).
There is no "service" product type ([02] P21, [05] 1.3).

**Path ids.** C-01 to C-04, C-03 (Stripe session), O-01, O-03, O-04.

**What is missing.** A billing-country field, its validation, storage, Stripe
evidence and card-country logging; a definition of "services".

**Proposed fix.**
1. Add `billingCountry` to `orderBuyerFields` (`checkout.ts:50-67`), required
   when the quote has downloads; refuse outside `BILLING_COUNTRIES` beside the
   consent check (`place-order.ts:164-165`); a country select in the checkout
   form for digital orders.
2. Store it: `orders.billing_country` (shape CHECK); pass it through CP-23 and
   `order_place` (rebased on the 20261120 body, hazard H4); the `orders`
   `BEFORE INSERT` trigger requires an allowed value for digital orders.
3. Evidence, never a block: send `billing_address_collection: "required"` on
   the session (C-03); on `checkout.session.completed` store
   `customer_details.address.country`; in `settleOrderFees` store
   `latest_charge.payment_method_details.card.country` from the read already
   made (`fees.ts:67-72`). A mismatch alerts ops; it does not refuse.
4. Decide what a "service" is (section 6). Until then R4 applies to products
   with a digital file.

### R5. Collab checkout: every participating seller passes R1 to R3

**Status: partial.** The "collab" half is structurally impossible today; the
"passes R1 to R3" half is missing because R1 to R3 are.

**Evidence.** No multi-seller checkout exists in any repo ([03] section 9,
[05] headline 8). Single seller is enforced three times: the gate reads
products of the storefront owner only (`Store/src/lib/products/purchasable.ts:276-284`),
the order writer refuses another seller's line (`Store/src/lib/orders/record.ts:399-419`),
and a cart belongs to one storefront (`Store/supabase/migrations/20261120_shopping_cart.sql:93-97`).
`order_place` itself does not check line ownership ([05] headline 6), and the
add-on guard judges only ids new to a row, so links made before 20261028 are
unchecked ([05] 8.5).

**Path ids.** C-01, C-02, C-07, O-01, P-12.

**Proposed fix.** Nothing to build for the beta beyond R1 to R3. Add the R5
proxy queries ([05] 8.5: orders or add-on lines owned by another seller, add-on
links across sellers) to the report and the monitor, and a unit test that the
quote refuses mixed owners. If collab checkout is ever built, run CP-1 per
owner in CP-5 and in the order writer.

### R6. No checkout without all rules, enforced server-side at checkout

**Status: partial.** The server-side mechanism is right; the rules are absent,
and two gaps remain.

**Evidence.** Every production order goes through two same-origin POST routes
and `placeOrderResponse` (CP-17), which re-quotes and re-gates on the server
(CP-18 re-runs CP-5 and CP-6) before any provider; the embed frame cannot POST
there and only links to hosted pages (`place-order.ts:102`;
`Store/src/lib/security/same-origin.ts:26-31`) ([03] 3.2, 8). Gaps: nothing is
re-checked at payment confirmation after up to 31/45 minutes (O-03,
`Store/supabase/migrations/20261008_order_lifecycle.sql:226-260`); no DB layer
backs the rules, and J-03 writes orders with no checkout at all ([03] Q4,
[04] 4.2).

**Path ids.** C-01 to C-04, O-01, O-03, O-11, J-03, DB-05.

**Proposed fix.** R1 to R4 checks inside CP-17/CP-18 (above); the `orders`
`BEFORE INSERT` trigger as the backstop; at O-03, re-run the seller rule and
the currency rule before `confirmPendingOrder`, and on failure keep the order
out of fulfilment and alert ops (an automatic refund is a later decision);
resolve J-03 before the trigger ships (section 3, H6).

### R7. Clear public messaging

**Status: CONFLICTS.** Every territorial statement says "EU, the USA and
Canada" ([08] headline 1).

**Evidence (where each statement is, and where R7 text goes).**

| Surface | Today | Where the change goes |
|---|---|---|
| Seller Terms in force for new sign-ups (`LEGAL_VERSION` = tos-2026-11-06, `Store/src/lib/legal/terms-versions.ts:38`) | "Square Share operates in the European Union, the United States and Canada" (`Home/src/content/legal/terms/tos-2026-11-06.ts:19`, `:28`, section 2 `:74-137`, regional parts `:780-1088`) | A **new** Terms version (never edit a published one): `docs/changing-the-terms.md`, Home `terms:new` / `terms:freeze`, Store `TERMS_VERSIONS` and `TERMS_CHANGES` (`Store/src/lib/legal/terms-changes.ts:11-20`) and the summary (`Store/src/lib/legal/terms-summary.ts`, `settings.json:259`) in all 10 locales. tos-2026-11-06 has been accepted by 2 accounts, so it cannot be withdrawn with `replacedBy`; the 30-day notice runs from the last email |
| Seller sign-up | "Open to sellers aged 18+ in the EU, USA and Canada" and the legal line (`Store/src/components/auth/LoginForm.tsx:183-186`, `:303-320`; `Auth.login.signupRegionNote`, `signupLegal`, `messages/*/auth.json:38`, `:41`) | Reword the two keys; add the country select and R8 block |
| Settings | Country hint "operates in the EU, the USA and Canada" (`settings.json:378`); shipping tips "rest of the EU", "Everywhere else" (`:453`, `:457`, `:466`); Irish address placeholder (`:362`) | Reword keys in 10 locales |
| Checkout and product page | Country list from the policy, up to 29; "EU buyers" rights wording; no delivery statement | "Delivery within the Czech Republic only" in `buildTrustLines` (`TrustList.tsx:16-42`, reaches product page and checkout) and beside the country field (`CheckoutForm.tsx:650-666`) |
| Embed frame | No delivery statement (`Store/src/components/storefront-page/EmbedFrameView.tsx:91-124`) | One footer line, same key |
| Home | Privacy intro "We operate in the EU, the United States and Canada" (`Home/src/content/legal/privacy.ts:11`) plus US and Canada sections (`:613-708`); Accessibility adds the UK (`accessibility.ts:74`); `/terms/` meta (`Home/src/app/terms/page.tsx:12-13`); a `$129.00` price in the homepage animation (`Home/src/components/howItWorks/data.ts:63`); hero "anywhere" (`hero/parts.tsx:31-32`); pricing section hidden behind `SELLER_SIGNUP_OPEN` | Edit Privacy, Accessibility and the meta in place (notices, not contracts); FAQ item and hero lead; CZK mock price. Home has no i18n |
| Docs | Six pages in each of en and cs say "EU, the USA or Canada"; payments page lists EUR/USD (`Docs/content/docs/en/payments-and-payouts/index.mdx:36-44`, cs `:37-45`) | Edit 12 MDX files; the payments table is the natural regions section |

The copy must not ship before the code it describes (R1 to R3), or it is false
the other way ([08] headline 2). Lawyer review of the new Terms is the owner's
item ([08] headline 5).

### R8. Expansion waitlist

**Requirement.** A non-CZ seller who tries to sign up sees a friendly block and
can leave email + country.

**Status: missing.**

**Evidence.** No country question and no block anywhere in sign-up or
onboarding ([08] section 3). The only waitlist is Home's pre-launch list,
`POST /api/waitlist` inserting `{ email, source }` (`Home/src/app/api/waitlist/route.ts:84-86`),
table `waitlist_signups` with no country column (production facts;
`Store/src/types/supabase.ts:2934-2960`), anon insert policy pinned to
`owner_id`/`list_id` null (`Store/supabase/migrations/20260807_db_hygiene.sql:45-54`),
and no consent text on the form although the Privacy Policy relies on consent
(`Home/src/content/legal/privacy.ts:227-229`) ([08] section 3).

**Path ids.** S-01, S-02, S-04, S-06, DB-08, AD-08.

**Proposed fix.** One migration: `waitlist_signups.country` (null or
`^[A-Z]{2}$`) plus a `list` value for "expansion" (or a separate
`seller_waitlist` table with RLS, explicit revokes and the anon insert-rate
trigger, `Store/supabase/migrations/20261105_write_bounds.sql:121-162`). A
Store server action writes it with the service role (rate limited), called
from the R8 block on the sign-up form and the welcome flow; a consent sentence
and privacy link on the block. Admin's campaign and CSV export can then
segment by country (AD-08).

---

## 2. Supporting requirements

### S1. One config module as the single source of truth

**Status: missing.** Market constants are scattered and double as storage enums.

**Evidence.** The EU member list is typed out four times in Store
(`Store/src/lib/settings/constants.ts:72-100`, `:132-134`;
`Store/src/lib/contact-verification/policy.ts:50-52`;
`Store/src/components/settings/TaxSection.tsx:64-68`) ([09] 3.1).
`OPERATING_COUNTRY_CODES`, `SHIPPING_COUNTRY_CODES` (a hand-kept literal copy),
`CURRENCIES`, `DOLLAR_COUNTRIES`, `BILLING_CURRENCY` and the hard-coded pair in
`toCurrency` each decide part of the market. SQL holds its own EUR/USD lists and
`currency <> 'USD'` logic in at least 8 function definitions ([09] 3.3).
Admin, Home and Docs hold EUR assumptions and no list ([09] headline 4). No
`"CZK"` literal exists in any repo's code ([09] 3.8).

**Proposed fix.** [09] section 5 option (c): `Store/src/lib/market/config.ts`
exporting literal tuples (needed for `z.enum` types, [09] 5):
`SELLER_COUNTRIES`, `DELIVERY_COUNTRIES`, `BILLING_COUNTRIES`,
`SALE_CURRENCIES`, `CONNECT_ACCOUNT_COUNTRY`, plus predicates
(`sellerCountryAllowed`, `deliveryCountryAllowed`, `saleCurrencyAllowed`,
`billingCountryAllowed`). Keep the storage/read enums (`KNOWN_CURRENCIES`,
`SHIPPING_COUNTRY_CODES`) separate. SQL mirror: one migration creating a small
table `market_allowed(kind, code)` read by the triggers (precedent: the
`billing_switches` table read by `enforce_plan_limit`,
`Store/supabase/migrations/20260930_seller_plans.sql:195-215`, `:308`), with a
Store unit test that parses the migration and compares it with the TS module
(order-channel pattern, `Store/tests/unit/order-channel.test.ts:82-102`) and a
DB probe (plan-limit pattern, `Store/tests/integration/29-seller-plans.test.ts:89-100`).
Adding an EU country later = one tuple edit + one INSERT migration, both
checked by the drift test. Publish the lists on a small public endpoint
(plan-prices pattern, `Store/src/app/api/billing/plan-prices/route.ts:5-64`)
only when Home or Admin need them. The table must get RLS, explicit revokes
(auto-grant trap) and a `POLICY_FREE_BY_DESIGN` entry or a read policy
(`Store/tests/integration/19-rls-coverage.test.ts:28`, `:96-122`) ([05] 7.3).

### S2. Server-side validators used by every write path

**Status: partial.** Validators exist on the right fields (CP-8, CP-10, CP-15,
CP-19, CP-20) with the wrong lists, MCP inherits them (CP-29), and checkout is
re-validated on the server (CP-17/CP-18). 12 paths bypass every app-level
validator (inventory section 4: DB-01, DB-02, DB-03, DB-05, DB-06, J-03, O-11,
AD-02, AD-03, SF-02, SF-03, P-08).

**Proposed fix.** The predicates of S1, called from CP-1/CP-2 (seller), CP-10,
CP-15, CP-20 and the import check (currency on write), CP-14 (currency at
sale), CP-19/CP-22 (delivery), the new billing field (R4), CP-7/CP-7b/CP-6
(Stripe); P-06 and P-08 brought onto the currency predicate; triggers for the
DB paths (S4). New server actions must be classified in the MCP registry test
(`Store/tests/unit/agent/registry.test.ts:197-203`).

### S3. Stripe account country pinned at creation and re-checked

**Status: missing**, and the create call **CONFLICTS** with the locked
account-type decision ([A] section 0: the code creates legacy Express accounts,
`Store/src/lib/payments/connect/account.ts:157`).

**Evidence.** `country` optional (`account.ts:158`); not typed, not stored, not
re-checked on return or `account.updated`; `canTakePayments` ignores it
([01] E1-E3, [A] section 11). Production: 0 accounts, Connect off.

**Proposed fix.** R1 step 4, in the same change as [A] section 13 (controller
properties, full Dashboard): the create call is one function, and both the
account type and the country are fixed once an account exists ([A] section
13). Must land before the first account is created.

### S4. DB constraints where sensible

**Status: CONFLICTS** for currency (three CHECKs forbid CZK); **missing** for
country (shape checks only, no list anywhere: [05] section 4 closing note,
[09] headline 6).

**Proposed fix.** Widen the three currency CHECKs (validated) in one migration;
then triggers, not CHECKs, for the rules, because a CHECK is re-evaluated on
every later update of a legacy row (hazard H3):
- `products`: `BEFORE INSERT OR UPDATE OF currency, status` (currency
  saleable on insert, on change, and on going active);
- `discounts`: `BEFORE INSERT OR UPDATE OF currency`;
- `profiles`: `BEFORE INSERT OR UPDATE OF tax_country` (null or allowed);
- `orders`: `BEFORE INSERT` only (currency saleable; physical needs an allowed
  `ship_to` country; digital needs an allowed `billing_country`; seller allowed);
- `seller_payment_accounts`: new `country` column with a shape CHECK.
Every trigger must bind the service role (unlike the existing guards, which
return early for it), because the service role is the only writer of orders
and of `shipping_policy` ([05] 7.3). Each migration needs a sentinel in
`Store/scripts/lib/prod-schema.ts`, a replay entry, ASCII only, and is applied
by hand ([05] 7.6).

### S5. Read-only report of existing violating data

**Status: partial.** The SQL is written ([05] section 8: counts, R1 to R5 rows,
carts) and the orchestrator has the headline numbers, but there is no saved,
repeatable report and the Stripe half cannot be done in SQL (no country stored).

**Proposed fix.** Commit the [05] section 8 queries as a script that runs as
`backup_reader` or through the Management API with `read_only: true`
([05] 7.6), outputs ids, handles and offending values only, and marks
simulator rows (J-03) separately. Run it before any account deletion job
touches the accounts (orders cascade on account deletion,
`Store/tests/db/prod-migrations.sql:293`). The same queries become the monitor
(S8).

### S6. Data model stays EU-ready

**Status: partial.** Good: currency is per product, order, discount and policy;
countries are ISO-2 per row; no column assumes one country. Missing: a
structured business-address country, the Stripe account country, the buyer's
billing country, a config table the SQL can read, and a currency reader that
does not collapse to EUR. Hard-coded EUR: `orders.currency default 'EUR'`,
`order_place` coalesce, analytics `<> 'USD'`, billing sales `= 'EUR'`, Admin
`formatEuros` ([05] 7.5, [06] headline 8).

**Proposed fix.** Every new column is a country or currency code, never a
boolean such as `is_cz`; every rule reads a list from S1, so adding SK or DE is
a config row; analytics group by currency instead of folding to EUR.

### S7. Czech-language legal texts and checkout

**Status: partial.** Store's Czech catalogue is complete (5,762 of 5,762 keys),
including the statutory checkout strings (pay button, withdrawal, guarantee,
consent, seller line) ([08] section 4). Missing: Czech Terms, Privacy, Cookie
Policy and Accessibility (Home is English only with no i18n); Store and Docs
legal links all point to the English pages (`Store/src/lib/legal/links.ts:39-64`,
`Docs/lib/legal.tsx:10-17`); the cookie banner is English; tos-2026-11-06
promises a contact point "in English and Czech" (`tos-2026-11-06.ts:843`). The
Czech catalogue was machine-produced and is not reviewed ([08] 4).

**Proposed fix.** The new CZ-only Terms version and the Privacy Policy written
(or translated) in Czech, served at a Czech route on Home with the legal links
in Store and Docs following the reader's locale; professional or legal review
of the Czech checkout strings and the new texts (owner's item).

### S8. Scheduled monitoring for R1 to R5

**Status: missing.** No market-rules scan exists anywhere ([06] 2c, 4).

**Proposed fix.** A daily `POST /api/cron/market-check` in
`Store/.github/workflows/scheduled.yml` (the existing pattern, `CRON_SECRET`,
[09] 5) that runs the S5 queries read-only, excludes or labels simulator rows,
and alerts through the existing ops mail (`OPS_ALERT_EMAIL`) or an Admin scan
source (`Admin/src/lib/notifications/scan.ts:171-196`, event catalogue
`Admin/src/lib/notifications/events.ts:87-221`). Items: R1 sellers with a
publishable product or open embed and a non-allowed or unset country, and
connected accounts with a non-allowed stored country; R2 live products,
discounts, policies and new orders not in a sale currency; R3 policies naming
a non-allowed code or `"*"` and new parcel orders shipped outside; R4 new
digital orders without an allowed billing country, and billing/card country
mismatches; R5 cross-seller lines and links.

---

## 3. Bypass catalogue

Every way a non-CZ seller could be onboarded, a non-CZK price saved, or a
non-CZ delivery or billing address get through checkout **if only the obvious
UI and API validators were added** (sign-up form, Settings, product form,
checkout form and their actions).

| # | Bypass | Real today? | What closes it |
|---|---|---|---|
| X1 | **Direct PostgREST writes.** `profiles.tax_country` (DB-01), `products` currency/price/status/`digital_file_key` (DB-02; flipping physical to digital also moves an item from R3 to R4), `discounts` (DB-03), `storefronts` config incl. embed on (DB-06). Default table grants were never revoked ([05] 2.1) | Yes | Triggers of S4 on `profiles`, `products`, `discounts`; the read gates CP-3/CP-5/RG-5 carrying R1; CP-14 carrying R2 at sale. Column-level revokes cannot narrow a table grant ([05] 2.1) |
| X2 | **MCP tools.** 36 write tools, including product currency and status, import, discounts, shipping policy, storefront config and embed (inventory 2.4) | Yes: an agent can create EUR/USD products and 29-country policies | Nothing extra if the rule sits in the action or its schema (CP-29 inherits it). Do not add a same-origin check to `pageConfigRoute` (hazard H9). MCP cannot write seller country or create a Stripe account (registry test) |
| X3 | **CSV import and `import_products`.** One currency per file, the symbol in each price cell stripped and never compared (`Store/src/lib/products/price.ts:62-65`) | Yes: "12 €" in a file imported as CZK would store 12 Kč once CZK exists | The sale list in the import check (`import-actions.ts:151-155`) and per-row CP-10 (already runs); refuse a cell whose symbol names another currency |
| X4 | **The embed on a foreign site.** The frame and `widget.js` only link to hosted pages; the frame writes carts only with `EMBED_CART_API=1`; checkout POSTs are same-origin only (`place-order.ts:102`) | No for checkout; yes for display (a non-compliant seller's embed keeps showing products) | R1 in CP-1 reaches RG-3 and RG-5; R6 is already server-side. The embed JSON is CDN-cached for 5 minutes (`Store/src/app/api/embed/[key]/route.ts:207`), display only |
| X5 | **The plain buy link** (`?via=button`) | No: it opens the product page, which is gated, and `via` is attribution only (`Store/src/lib/storefront/product-page-url.ts:72-75`) | Nothing extra |
| X6 | **Cart routes.** C-07 carts store no prices; the cart checkout re-quotes the body's lines (`Store/src/app/api/checkout/[storefrontId]/route.ts:27-28`); `adding:false` allows paying after the cart is switched off | Not live (no `carts` table in production) | Nothing extra: C-02 runs CP-17/CP-18 |
| X7 | **Duplicate product** (P-08) copies a stored EUR row unvalidated | Yes (draft) | Validate the copied currency, or the products insert trigger; P-06 refuses to publish it |
| X8 | **Partial updates and status toggles.** P-06 re-publishes a stored EUR row with no currency check; P-10, P-11, P-12 write single columns | Yes (P-06); harmless for the rules (P-10 to P-12) | P-06 on the currency predicate and the `status -> active` trigger; triggers scoped to governed columns so P-10 to P-12 never trip on legacy rows |
| X9 | **Lossy edit paths.** Form edit, designer tile, MCP `update_product`, `publish_products` re-send a currency read through `toCurrency` (P-03, P-04, P-05, P-07) | Latent: harmless while only EUR/USD exist; once CZK is storable an edit rewrites CZK as EUR | Rewrite CP-13 before widening the CHECKs (R2 step 1) |
| X10 | **Admin restore** (AD-02, AD-03) sets `moderation_status='ok'` with the service role, no market check | Yes | Read gates (CP-3/CP-5 with R1, CP-14 with R2); optional warning in Admin |
| X11 | **The demo simulator** (J-03) inserts EUR orders shipped to 10 countries every 20 minutes, outside checkout, through no function and no CHECK | **Yes, live in production** | Owner decision first: disable it (`demo.sales_sim.enabled`) or set its currency to CZK and its address list to CZ and mark its orders as simulated; then the `orders` insert trigger. Shipping the trigger first makes every tick fail |
| X12 | **Service-role jobs.** `orders_release_expired` (bulk restock every 5 min), `moderation_recheck_all` (bulk update of every 'ok' product), moderation settle, review reminders, account deletions (cascade orders) | Not bypasses of the rules, but they write the governed tables | Triggers on INSERT and UPDATE OF governed columns only; run the report before deletions |
| X13 | **Webhooks.** `account.updated` stores no country (A-03); `checkout.session.completed` confirms with no re-check (O-03); charges the seller makes in their own Stripe account are ignored (`webhook.ts:185-193`) | Yes (A-03, O-03); the last is outside the platform | R1 step 4; the O-03 re-check (R6); the Terms for off-platform sales |
| X14 | **Race conditions and time-of-check to time-of-use.** A pending order (31 min Stripe page, 45 min hold) is paid after a rule stops holding: seller country changed, product taken down or restored, rule deploy, policy edit; a currency switch between page and Pay at the same cents value passes `expectedTotalCents` (`place-order.ts:151`) | Yes ([03] Q4) | O-03 re-check of seller and currency; currency in the expected-total comparison; the delivery country is fixed on the order at quote time |
| X15 | **Stale cached storefront and config data.** Embed JSON 5-minute CDN cache; React cache is per request and a no-op in route handlers ([03] Q4); page HTML caching not traced | Display only | Checkout re-reads everything uncached, so nothing stale reaches an order; verify page caching (section 6) |
| X16 | **Stored shipping policies with free-text destinations or the `"*"` row.** Free-text rows ("EU", "USA") have no `countries`, are display-only and show their words to buyers; a `"*"` row admits all 29 codes and expands the picker to 29 | Yes | `"*"` interpreted as the config delivery list (R3 step 2); the fixed platform delivery line (R3 step 5); report free-text and non-CZ rows ([05] 8.4) |
| X17 | **Currency coercion helpers.** `toCurrency` and `queries.ts:143` (non-USD to EUR); `products.currency default 'EUR'` (a direct insert without a currency becomes EUR); `orders.currency default 'EUR'` and the `order_place` coalesce; `ratesCurrency` absent = EUR; quote fallback EUR; analytics `<> 'USD'`; Admin `?? "EUR"` (`Admin/src/lib/data/moderation.ts:739`) | Yes (silent today, wrong the day CZK exists) | R2 steps 1 and 5; analytics and Admin revenue by currency (hazard H7) |
| X18 | **The Stripe account country is never stored**, an existing account is returned unchecked, and an unset or unreadable seller country sends no `country` (`Store/src/lib/settings/seller-identity.ts:178-181`) | Latent (0 accounts) | R1 step 4 / S3, before the first account |
| X19 | **Google OAuth sign-up** skips the sign-up form (S-02) | Yes | Country asked in the welcome flow; CP-1 blocks publishing regardless |
| X20 | **Operator scripts and the dev simulator** (DB-05 inserts orders and EUR products; O-11 IE/DE/FR/NL orders) | Dev-gated / dev builds only | The `orders` and `products` triggers; operator discipline |
| X21 | **Team members** | No: identity is written to the person's own row and every gate reads the owner's row (`Store/src/lib/settings/seller-identity.ts:295-297`) | Nothing |

---

## 4. Hazards for the build

Things that break if done naively, taken from the reports.

| # | Hazard | Evidence | How to avoid it |
|---|---|---|---|
| H1 | **Narrowing the storable country or currency lists blanks stored shipping policies.** The reader runs the strict write schema and returns `{}` on any failure: physical products silently lose checkout, returns windows and texts vanish from product pages and emails, and the withdrawal window on EXISTING orders falls from the seller's promise to the statutory 14 days | CP-21 `Store/src/lib/settings/shipping-policy.ts:50-60`; `Store/src/lib/orders/withdrawal.ts:44`; `Store/src/app/api/orders/withdraw/route.ts:71-72` ([03] 1.3) | Never narrow `SHIPPING_COUNTRY_CODES`, `OPERATING_COUNTRY_CODES` or `CURRENCIES`; add config lists beside them and make the reader tolerant first |
| H2 | **CZK cannot be stored until three CHECKs are widened together**, and once it can, `toCurrency` charges it as EUR | `products.currency` (`Store/tests/db/prod-migrations.sql:157`), `product_price_history` (`Store/supabase/migrations/20261004_discounts.sql:253`, written by a trigger on every product save), `discounts_value` (`:84-92`); `Store/src/lib/format/money.ts:12-14` | One migration for the three CHECKs; rewrite `toCurrency` and `queries.ts:143` before it ships; update `Store/tests/unit/format.test.ts:37-38` |
| H3 | **A constraint checked on every later update of an old row breaks multi-row sweeps.** A NOT VALID CHECK is skipped only at creation; any later UPDATE of a legacy row re-checks it. `orders_release_expired` (one statement for all expired orders, every 5 minutes) and `moderation_recheck_all` (one UPDATE over every 'ok' product) would roll back entirely on one legacy row; stock decrements, restocks, refunds, mark shipped, review reminders and the simulator's ship step all update rows | [05] 7.4 (`Store/supabase/migrations/20261028_product_add_ons.sql:400-441`; `20261012_auto_moderation.sql:722`, redefined `20261013_marketplace_moderation.sql:139`) | Triggers on INSERT and `UPDATE OF <governed columns>` only (precedent `products_record_price_update`, `20261004_discounts.sql:292-296`) |
| H4 | **`order_place` must be based on the cart migration's version.** Production runs the 20261028 body; the repo's 20261120 body (19 lines, `cart_id`, `lines_digest`) is not applied, and Store's schema gate demands its objects, so no Store deploy can happen until it is applied | [05] 6 (`Store/scripts/lib/prod-schema.ts:173-203`); inventory section 6 item 1 | Prefer an `orders` BEFORE INSERT trigger (no rewrite of `order_place`); if `order_place` must change (R4 billing country), start from the 20261120 body and apply after it. Never reference `carts`, `order_add_ons.source` or `orders.cart_id` in a migration applied before 20261120 |
| H5 | **Narrowing `CURRENCIES` has silent read effects**: amount discounts outside it vanish from lists and checkout ("degrades, never throws"); every edit and MCP publish of a legacy EUR product fails validation until its currency changes; a currency change resets the EU 30-day prior-price proof | `Store/src/lib/discounts/row.ts:9-11`, `:42-46`; [02] B10, `Store/src/lib/discounts/prior-price.ts:91` | `KNOWN_CURRENCIES` for reading, `SALE_CURRENCIES` for writes; a clear seller-facing message on legacy edits; never auto-convert prices |
| H6 | **The simulator writes orders outside checkout**, live, with its own currency and a 10-country address list, and writes `pending` orders with no expiry | J-03; `Store/supabase/migrations/20260927_demo_sales_sim_fulfilment.sql:55-66`, `:155-158`, `:177` | Decide its fate before any `orders` trigger or monitor ships; mark simulator rows so reports exclude them |
| H7 | **Analytics and Admin revenue assume EUR.** SQL aggregates count anything not USD as EUR and print `€`; the plan calculator and Admin revenue count only `currency = 'EUR'`; Admin formats every aggregate as euros | `Store/supabase/migrations/20260802_analytics_sql_aggregates.sql:23-27`, `20261117_perf_indexes.sql:300` etc.; `20261011_pricing_config.sql:690`; `Admin/supabase/migrations/0008_plans_revenue.sql:51`; `Admin/src/lib/format/money.ts:1-7` ([02] 8.3, [06] headline 8) | Group by currency in the aggregates (the pending 20261120 versions included) before the first CZK sale; Admin formats with the row's currency |
| H8 | **Limits are sized for euros**: `MIN_PAYABLE_CENTS = 50` (0.50 Kč; Stripe's CZK minimum is higher, inferred), `PRICE_CENTS_MAX` (1,000,000 Kč), `SHIPPING_RATE_MAX_CENTS` (1,000 Kč flat delivery cap), `DISCOUNT_AMOUNT_MAX_CENTS` | `Store/src/lib/discounts/pricing.ts:31-33`; `Store/src/lib/validation/product.ts:218-219`; `Store/src/types/shipping-policy.ts:113-115`; `Store/src/types/discount.ts:21-22` | Per-currency limits in the market config |
| H9 | **A same-origin check in `pageConfigRoute` breaks three MCP tools**, which call the route's `PATCH` in process with a synthetic request | CP-28; `Store/src/lib/agent/tools/storefronts.ts:5-13`, `:88-94`, `:380-406` | Put rules in the shared PATCH body, not in origin checks |
| H10 | **Existing guard triggers exempt the service role**; a compliance trigger copied from them would miss `order_place`, the simulator and the shipping-policy save | [05] 7.3 | Compliance triggers bind every role |
| H11 | **`profiles` is shared by buyers and sellers**, and every new profile starts with `tax_country` null | `Store/supabase/migrations/20261021_reserved_usernames.sql:103-112` | No plain CHECK on the column; a change-scoped trigger allowing null |
| H12 | **Deleting an account deletes its orders** (FK cascade), and both the Store deletion job and Admin delete accounts | `Store/tests/db/prod-migrations.sql:293`; J-05; AD-06 | Run and keep the existing-data report before any deletion |
| H13 | **The Stripe account type and country are fixed at creation**, and [A] requires a different account type than the code creates | [A] sections 0, 13; `Store/src/lib/payments/connect/account.ts:150-157` | Change both in one PR before Connect is switched on |
| H14 | **Published Terms are frozen and tos-2026-11-06 has been accepted** (2 accounts) | `docs/changing-the-terms.md`; production facts | A new version with the 30-day notice; no `replacedBy`; never pick the date by hand |
| H15 | **`z.enum` needs literal tuples** | [09] 5; `Store/src/lib/settings/constants.ts:126-127` | The config module exports `as const` tuples, not lists read at run time |
| H16 | **Tests pin the old market**: 27 EU + US + CA (`Store/tests/unit/operating-countries.test.ts:16-40`), the EUR fallback (`format.test.ts:37-38`), EUR seeds in about 128 test/script/SQL files ([02] 8.5) | [09] 2 | Update deliberately; keep the operating-countries test for the readable list and add one for the config lists |
| H17 | **Migrations are hand-applied** and need a prod-schema sentinel, a replay entry and ASCII text; the Supabase connector auto-declines DDL | [05] 7.6 | Follow the existing process; apply by hand |
| H18 | **`expectedTotalCents` compares cents only** | `Store/src/lib/checkout/place-order.ts:151` | Compare currency too |
| H19 | **An empty delivery country matches a `"*"` row**; only the later "parcel needs `shipTo`" check stops it | `Store/src/lib/shipping/rates.ts:171-175`; `place-order.ts:164` ([03] 1.4) | Keep that check when refactoring; the config-driven `"*"` must never match `""` |
| H20 | **Home refuses any non-EUR plan price list** and Admin formats plan prices as euros, if plan billing ever moves to CZK | `Home/src/lib/plan-prices.ts:39-40`; [06] 6 | Out of R2's scope unless the owner moves plan billing |

---

## 5. Existing-data impact

What each rule would do to the four existing seller accounts the day it is
enforced, using the production facts of 2026-11-22. Existing data is to be
reported, never deleted or disabled without the owner's decision; the table
shows where an enforcement step would disable something by itself, so the
owner can decide first.

Background that applies to all four: **no product can be bought in production
today** (Connect off, no provider, `Store/src/lib/checkout/availability.ts:73-83`;
product pages fall back to the seller's link or an enquiry email, [03] 1.3), so
the checkout-time rules change nothing visible until Connect launches. All 22
products and all 1,239 orders are EUR. There are no amount discounts, so
narrowing the discount reader loses nothing today.

Derived from the facts (not queried): the 571 orders with no `ship_to` are
seller (2)'s 202 seeded orders plus 369 simulator orders written before
`ship_to` existed (orders before 2026-09-27 have none, [05] 8 interpretation
notes); so all 668 orders that have a `ship_to` are simulator orders: 84 to
CZ, 584 to other EU countries.

| Account | R1 (seller in CZ) | R2 (CZK) | R3 (delivery to CZ) | R4 (digital billing) | R7 / R8 |
|---|---|---|---|---|---|
| **(1) Demo-simulator seller.** CZ, ships from CZ, rates in EUR, 9 products, 1,037 simulator orders | Country passes. If a separate structured address country is required, it fails until filled. No connected account: cannot take payments, as today | All 9 products fail R2. Write side: every edit and every publish of them refused until the seller (the owner) re-prices in CZK. Sale side: refused at CP-14 (no live checkout anyway). Rates in EUR: once the products are CZK, parcels cannot be quoted until the rates move to CZK; a naive `CURRENCIES` narrowing blanks the whole policy (H1) | Historic: 584 non-CZ simulator orders, reported only. Going forward the simulator keeps adding non-CZ EUR orders every 20 minutes and would flood any monitor (H6) | Unknown whether any product is digital | Demo data: owner decides whether it stays public as a showcase |
| **(2) CZ seller, free-text destinations ("EU", "USA").** 9 products, 202 old seeded orders without `ship_to` | Country passes (same address-country caveat as (1)) | All 9 products fail R2 exactly as (1). If its policy has no `ratesCurrency`, it reads as EUR (`rates.ts:118`) | Free-text rows have no `countries`, so they are display-only (`rates.ts:56-62`): its physical products have no quotable delivery today and would have none under R3 either. Their words ("EU", "USA") reach buyers in the shipping prose and contradict R7: reported, and covered by the fixed platform delivery line. The 202 seeded orders have no `ship_to`: nothing to check | Unknown | Its "EU"/"USA" text is the seller's own copy: the owner must ask the seller to change it, not rewrite it |
| **(3) IE seller.** 3 products (one digital), no orders | **Fails.** The day CP-1 carries R1, all 3 products disappear from buyers (product pages, storefront, embed JSON and frame, sitemap, OG image) and cannot be re-published: enforcement disables this account's listings by itself. Owner decision needed before the read-side switch is flipped (contact the seller, offer the R8 waitlist with country IE). The DB trigger on `tax_country` does not touch the stored IE value (it fires only on change) | 3 products fail R2 | Unknown policy | The digital product is the R4 population; no orders, so nothing historic | First candidate for the R8 waitlist |
| **(4) Account without username, country unset, no address.** 1 live product, 9 storefronts | Fails, but it already fails the trader-identity gate (no address), so buyers should already see nothing from it (derived: CP-1 requires an address and every read gate fails closed). R1 adds a second reason; no visible change. A product marked live with incomplete identity points to a write that bypassed the publish gate (DB-02) or predates it: reported | 1 product fails R2 | Unknown policy | Unknown | Will meet the country question when it next publishes |

Other existing data:
- **Profiles**: 15; `tax_country` CZ x2, IE x1, unset x12. The 11 unset profiles
  without products or storefronts are not affected until they publish.
- **Terms**: `legal_accepted_version` tos-2026-11-06 x2, tos-2026-10-11 x2,
  none x11. The CZ-only version reaches the four acceptors through the notice
  job once mail is on, 30 days from the last email; the rest accept at their
  next Terms step (J-08, `docs/changing-the-terms.md`).
- **Waitlist**: no country column, so existing rows can never be segmented by
  country; only new rows carry it.
- **Orders**: 1,239, all EUR, all without a payment: every one fails R2 and 584
  fail R3 historically. Report them, never alter or delete them; label
  simulator orders so they are not mistaken for sales.
- **pg_cron**: `demo-sales-sim` will keep producing violations until the owner
  disables or reconfigures it.

---

## 6. Still unknown

**Facts not readable from code or the production facts.**
1. Stripe: what an Express account gets when created without `country`;
   whether the platform's Connect settings limit onboarding countries; Stripe's
   CZK minimum charge and payout rules; capability rules for CZ accounts
   ([01] 7.1, [02] 11, [A] section 14).
2. The shipping destinations of sellers (1), (3) and (4), whether (1) and (2)
   have a complete trader identity (and so are visible today), which of the 16
   live products belong to whom, how many orders are digital (R4 sizing), and
   whether the R5 proxy queries return anything ([05] 8.1, 8.5).
3. Whether hosted storefront and product page HTML is cached, and for how long
   (X15).
4. Production RLS and grants added by SQ-app migrations that exist in no repo
   ([05] 6).
5. Whether the Before User Created hook is enabled ([01] 7.4) and whether
   checkout refuses a banned seller ([06] 8.4).
6. Which env switches are set in production besides Connect (`CART_ENABLED`,
   `EMBED_CART_API`, Home's `NEXT_PUBLIC_SELLER_SIGNUP_OPEN`) ([03] Q6, [08] 7.2).

**Decisions only the owner can make** (they block parts of the build).
1. Is `tax_country` the R1 "business address country", or is a structured
   address with its own country column added? (R1 step 2.)
2. What `"*"` means under a CZ-only delivery list (proposed: the config list).
3. What a "service" is for R4, given products are only physical or digital.
4. The demo simulator: disable, or reconfigure to CZK and CZ addresses, and
   whether its seller stays public.
5. Seller (3) and the EUR catalogue of sellers (1), (2), (4): when to flip the
   read-side R1 switch, how sellers are told, and that prices are re-entered by
   sellers rather than converted.
6. Whether R2 makes non-CZK products "not purchasable" (proposed) or hidden.
7. Whether seller plan billing stays in EUR (`BILLING_CURRENCY`, Home's EUR-only
   price fetch).
8. A "market rules" moderation ground in Admin.
9. Lawyer review of the new CZ-only Terms and the Czech translations; the
   VAT-registration wording that already conflicts ([08] headline 6).

---

## 7. Suggested order of work

1. **Report first** (S5): commit the [05] section 8 queries, run read-only,
   label simulator rows; the owner decides on the four accounts and the
   simulator.
2. **No-behaviour-change groundwork**: the market config module (S1),
   `KNOWN_CURRENCIES` versus `SALE_CURRENCIES`, the non-lossy `toCurrency`, the
   tolerant shipping-policy reader (H1, H2, H5).
3. **Make CZK storable**: one migration widening the three CHECKs (H2).
4. **Write-side rules for new writes**: CP-1/CP-2 country (write side via
   CP-4), CP-8, CP-10, CP-15, CP-20, import, P-06, P-08; sign-up and
   welcome-flow country question with the R8 block and waitlist (one change
   covers UI and MCP).
5. **Stripe**: country and account type in the create call, stored and
   re-checked (S3, with [A]); before Connect is switched on.
6. **Checkout and database**: R2 at CP-14, R3 at CP-19/CP-22, R4 billing
   field and evidence, the O-03 re-check, then the triggers of S4 (after the
   simulator decision; `order_place` only after the cart migration, H4).
7. **Read-side R1 switch and messaging** in the same release: flip the switch
   once the owner has decided on existing accounts; R7 copy in 10 locales,
   Docs, Home, and the new Terms version with its notice.
8. **Monitor** (S8): the daily market check.
