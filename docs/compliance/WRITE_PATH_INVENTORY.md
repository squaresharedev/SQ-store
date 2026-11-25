# Write-path inventory (Czech-only beta)

Merged from the nine Phase 0 inventory reports in `docs/compliance/inventory/`
([01] to [09]) on 2026-11-22, cross-checked against the code on disk (Store HEAD
e43eedd plus the uncommitted tree) and against audit [A]
(`docs/compliance/audit/A-stripe-config-money-flow.md`). Investigation only:
nothing was built, run or queried for this file.

## 1. How to read it

- **One row per write path** in section 3, grouped by entity, with a stable id
  (S- seller identity, A- connected account, P- product, I- import, D- discount,
  SH- shipping policy, SF- storefront config, C- checkout and cart, O- order,
  RF- refund, AD- Admin, J- scheduled, DB- direct database, X- no rule
  relevance). Ids are stable: the build, the tests and the adversarial review
  should cite them. Gaps in numbering are not missing paths.
- **Src** cites the inventory report(s) the row came from ([01] to [09]) and the
  row or section there; every file:line is the report's own, or was opened in
  this merge (marked "code" or settled in section 6).
- **Choke point** names the CP in section 2 the path passes through, or
  "BYPASSES" the one it skips. **Where enforcement must attach** is the smallest
  place that closes the path; the fixes themselves are in
  `docs/compliance/audit/E-czech-only-gap-analysis.md`.
- **Who** says who can reach the path; the rule columns use E / P / N / n/a as
  defined above the table in section 3.
- Paths that write nothing were checked and left out; they are listed at the
  end of section 5. Read-side gates (where buyers are refused) are in 2.5.

### Count summary

| Entity | Paths | Entity | Paths |
|---|---|---|---|
| S- Seller identity and country | 6 | C- Checkout and cart | 9 |
| A- Stripe connected account | 5 | O- Order | 11 |
| P- Product, price, currency | 14 | RF- Refund | 4 |
| I- Import | 3 | AD- Moderation and Admin | 9 |
| D- Discount | 5 | J- Scheduled and background | 11 |
| SH- Shipping policy | 3 | DB- Direct database | 8 |
| SF- Storefront and page config | 6 | X- No rule relevance | 33 |
| **Rule-relevant total (all but X-)** | **94** | **Grand total** | **127** |

Entry points covered (reconciled with [04] and [05]): all 36 MCP write tools
(each maps to a row: X-01 to X-05, P-02, P-05, P-07, P-09 to P-11, P-13, I-02,
SF-01 to SF-06, SH-02, O-06, RF-01, D-01 to D-05, X-16, X-19, X-20); every
writing route handler of the 58 production route files; all 100 exported
server actions in 29 `"use server"` files; 6 GitHub Actions schedule jobs; the
pg_cron jobs (4 live in production, 1 more defined in the unapplied cart
migration); every SQL function that writes the relevant tables (`order_place`,
`order_confirm_paid`, `order_release_pending`, `orders_release_expired`,
`order_apply_refund`, `order_refund`, `order_mark_shipped`, the pending line
refund pair, `decrement_stock`, `fee_ledger_record`, `plan_price_change`,
`billing_apply_snapshot`, `record_product_price`, the moderation set, contact
verification, `handle_new_user`, `carts_sweep`, `record_signal`, `demo.*`);
the Admin, App and Home writers.

Rule status over the 94 rule-relevant paths (section 3 cells):

| Rule | E (enforced) | P (partly) | N (not enforced) | n/a |
|---|---|---|---|---|
| R1 seller in CZ | 0 | 2 | 33 | 59 |
| R2 CZK only | 0 | 20 | 9 | 65 |
| R3 delivery to CZ | 0 | 6 | 6 | 82 |
| R4 billing country CZ (digital) | 0 | 0 | 7 | 87 |
| R5 collab sellers pass R1 to R3 | 0 | 0 | 0 | 94 (no collab checkout exists: single seller by construction, `Store/src/lib/products/purchasable.ts:282`, `Store/src/lib/orders/record.ts:414-417`) |
| R6 server-side at checkout | 0 | 4 | 5 | 85 |

Nothing in the platform enforces any of R1 to R6 today. Every "P" is a
server-side check on the right field with the wrong list (EU 27 + US + CA, or
EUR/USD).

---

## 2. Choke points

Shared functions, schemas and SQL objects that many paths funnel through. A
validator attached here covers every path listed in its row and nothing else.
"Bypassed by" names the paths in section 3 that reach the same data without
passing through it.

### 2.1 Seller identity and connected account

| CP | Choke point | File:line | Paths through it | Bypassed by | Notes |
|---|---|---|---|---|---|
| CP-1 | `missingTraderIdentity` / `isTraderIdentityComplete` (the trader-identity predicate) | `Store/src/lib/settings/trader-identity.ts:115-152` | Every publish gate through CP-4 (P-01 to P-07, I-01, I-02, SF-04); every buyer read and the order quote through CP-3 (C-01, C-02, C-05, C-07, C-08, RG-1 to RG-4); and directly RG-5 to RG-8 | DB-01 (writes the input), AD-02/AD-03 (restore is not a publish) | Already receives `tax_country` (via `TRADER_GATE_SELECT`, `Store/src/lib/settings/seller-identity.ts:55-56`, `:81-82`) but ignores it; comment saying country is deliberately not required is stale (`trader-identity.ts:27-29`). **Best single place for the R1 seller rule** ([01] section 3) |
| CP-2 | `buildTraderIdentityInput` | `Store/src/lib/settings/seller-identity.ts:109-120` | Same callers as CP-1 except the designer warning | none | Re-validates stored address and email on read so a REST-written value counts as missing (`:88-120`); the country check must be added here too, or DB-01 writes an unchecked country that the gate trusts |
| CP-3 | `sellerMaySell` | `Store/src/lib/settings/seller-identity.ts:128-132` | CP-5 (all buyer product reads, cart, discount check, quote at placement), storefront page and embed frame (`Store/src/lib/storefront/storefront-page.ts:265-266`), sitemap (`Store/src/lib/seo/sitemap.ts:158`) | RG-5 to RG-8 call CP-1 directly | A rule placed only here misses the write side (CP-4) and RG-5 to RG-8 ([01] section 3) |
| CP-4 | `publishBlockedError` (write-side publish gate, uncached service read, fails closed) | `Store/src/lib/settings/seller-identity.ts:304-313` (read `:248-284`) | P-01, P-02 (`Store/src/lib/products/actions.ts:367`), P-03, P-04, P-05, P-07 (`:456`), P-06 (`Store/src/lib/products/card-actions.ts:65-68`), I-01, I-02 (`Store/src/lib/products/import-actions.ts:165-168`), SF-04 (`Store/src/lib/storefront/actions.ts:510-513`) | SF-02, SF-03, DB-02, DB-06, AD-02, AD-03 | Drafts are never gated; P-08 always produces a draft |
| CP-5 | `gatePurchasableLines` (THE buyer-side product gate; `gatePurchasable` wraps it for one product) | `Store/src/lib/products/purchasable.ts:215-348` (owner filter `:276-284`, profile read `:285-292`, gate `:321-322`, policy `:341`) | C-01, C-02 (quote), C-05, C-07, C-08, RG-1, RG-2 | O-11, J-03 | Already selects the seller row with `tax_country`; one seller per call (single-seller by construction, so R5 reduces to R1 to R3 here) |
| CP-7 | `ensurePaymentAccount` (the only Stripe `POST /accounts`) | `Store/src/lib/payments/connect/account.ts:144-184` | A-01 | none (never on MCP: `Store/tests/unit/agent/registry.test.ts:163`) | Sends `country` only when `tax_country` is set (`:153-164`); returns an existing account unchecked (`:150-151`) |
| CP-7b | `saveAccountFacts` (stores Stripe account facts) | `Store/src/lib/payments/connect/account.ts:108-118` | A-02, A-03 | none | Stores 3 booleans; `StripeAccount` has no `country` (`Store/src/lib/billing/stripe-api.ts:110-115`); `seller_payment_accounts` has no country column |
| CP-6 | `checkoutProviderFor` / `canTakePayments` | `Store/src/lib/checkout/availability.ts:73-83`; `Store/src/lib/payments/connect/account.ts:102-104` | C-01, C-02 (`Store/src/lib/checkout/place-order.ts:157-158`), C-03 (fresh re-read `Store/src/lib/checkout/stripe-provider.ts:79-81`), C-05, C-07, checkout pages | O-11, J-03 (no provider at all) | Natural home for "stored Stripe account country allowed" once CP-7b stores it |
| CP-8 | `taxSchema` (`tax_country` refine) | `Store/src/lib/validation/settings.ts:124-138` (country `:131-136`) | S-03, S-04 | DB-01 | Allows EU 27 + US + CA or empty |
| CP-9 | Country lists | `OPERATING_COUNTRY_CODES` `Store/src/lib/settings/constants.ts:110-116`; `SHIPPING_COUNTRY_CODES` `:129-136` (same 29 codes as literals); `EU_COUNTRY_CODES` `:72-102`; `SMS_REGIONS` `Store/src/lib/contact-verification/policy.ts:48-55` | CP-8, CP-19, CP-20, S-05, the pickers | DB writes (no SQL list exists anywhere) | These are also the READ enums (CP-21 hazard): the market rule must be a separate config list ([09] section 0 item 8) |

### 2.2 Product, price, currency, discount

| CP | Choke point | File:line | Paths through it | Bypassed by | Notes |
|---|---|---|---|---|---|
| CP-10 | `productWriteSchema` | `Store/src/lib/validation/product.ts:473-559` (currency `:478`) | P-01, P-02 (also pre-checked in the tool, `Store/src/lib/agent/tools/products.ts:85-88`), P-03, P-04, P-05, P-07, P-13, P-14, I-01, I-02 (per row) | P-06, P-08, P-10, P-11, P-12, DB-02, DB-05 | |
| CP-11 | `CURRENCIES` (`["EUR","USD"]`) | `Store/src/types/product.ts:12-13` | CP-10, CP-15, CP-20, I-01 membership check (`import-actions.ts:151-155`), MCP enums (`products.ts:177`, `:205`, `:348`), discount read parser (`Store/src/lib/discounts/row.ts:42-46`), MCP `get_schema` | toCurrency (CP-13) hard-codes its own pair | Used for writing AND reading: narrowing it drops legacy discounts silently and blanks policies (hazards H1, H5) |
| CP-12 | DB currency CHECKs | `products.currency in ('EUR','USD')` (`Store/tests/db/prod-migrations.sql:157`, live in prod); `product_price_history.currency` (`Store/supabase/migrations/20261004_discounts.sql:253`); `discounts_value` (`:84-92`) | Every writer of products and discounts in every repo: P-01 to P-08, I-01, I-02, D-01, D-02, DB-02, DB-03, DB-04, DB-05 | `orders.currency` has **no** CHECK (`prod-migrations.sql:301`); `shipping_policy.ratesCurrency` is inside jsonb | The only guard covering DB-02/DB-03. CZK cannot be stored until all three are widened together ([05] headline 1) |
| CP-13 | `toCurrency` (read normaliser, not a validator) and its inline twin | `Store/src/lib/format/money.ts:12-14`; `Store/src/lib/products/queries.ts:143` | 31 call sites: the quote (`Store/src/lib/checkout/quote.ts:178`, `:254`), quantity authority (`Store/src/lib/products/order-quantity.ts:177`), Stripe session currency (`stripe-provider.ts:106`, `:138`), product page, cart, previews; every owner-side product read feeding P-03, P-04, P-05, P-07 | n/a | Maps every non-USD value to EUR: a CZK row would be shown and **charged as EUR**; pinned by `Store/tests/unit/format.test.ts:37-38` |
| CP-14 | `assessLines` (per-line sellability) | `Store/src/lib/checkout/quote.ts:231-308` | C-01, C-02 (via CP-18), C-07, quick add (`Store/src/lib/cart/quick-add.ts:44-64`) | O-11, J-03 | One currency per order (`:273-279`), physical line needs `canQuoteShipping` (`:257-259`), purchase-link refusal (`:237-241`). **Natural server-side R2 backstop** |
| CP-15 | `discountInputSchema` | `Store/src/lib/validation/discounts.ts:56-84` | D-01, D-02 (MCP tools pre-check it too, `Store/src/lib/agent/tools/discounts.ts:27-30`) | DB-03 | |
| CP-16 | Price parsers | `Store/src/lib/products/price.ts:55-153` | P-01/P-03 (form, strict), I-01/I-02 (CSV, tolerant: strips any symbol `:62-65`) | P-04 (client `centsOf`, server still runs CP-10) | Cosmetic for the rules, listed because CSV prices carry symbols |

### 2.3 Shipping, checkout, orders

| CP | Choke point | File:line | Paths through it | Bypassed by | Notes |
|---|---|---|---|---|---|
| CP-17 | `placeOrderResponse` (both checkout routes) | `Store/src/lib/checkout/place-order.ts:89-196` | C-01, C-02 (and C-03, C-04 inside) | O-11, J-03, DB-05 | Every production order passes here ([03] headline 1). **The one place for R3/R4/R6 at order time** ([04] checklist) |
| CP-18 | `quoteOrder` / `quoteFromLines` (price authority) | `Store/src/lib/checkout/quote.ts:158-185`, `:379-428` | C-01, C-02 | O-11, J-03 | Re-runs CP-5 at placement, so seller rules in CP-1 to CP-3 are enforced at checkout time on the server whatever page or embed the buyer came from |
| CP-19 | `shipToSchema.country` | `Store/src/lib/validation/checkout.ts:41` (`z.enum(SHIPPING_COUNTRY_CODES)`) | C-01, C-02 | O-11, J-03 | The only platform-level delivery-country check on the server; a static literal tuple, not config |
| CP-20 | `shippingPolicySchema` (write) | `Store/src/lib/validation/shipping-policy.ts:67-138` | SH-01, SH-02 | none (column is service-role only, SH-03) | Destinations `[...SHIPPING_COUNTRY_CODES, "*"]`, `shipsFrom`, `ratesCurrency` |
| CP-21 | `buildShippingPolicy` (READ, all or nothing) | `Store/src/lib/settings/shipping-policy.ts:50-60` | Read by CP-5 (`Store/src/lib/products/purchasable.ts:341`), O-09 (`Store/src/app/api/orders/withdraw/route.ts:71`), order page, confirmation email, storefront quick add, MCP `get_shipping_policy`, dashboard | n/a | Runs the strict WRITE schema on read and returns `{}` on any failure: narrowing CP-9/CP-11 blanks every stored policy (hazard H1) |
| CP-22 | `quoteShipping` / `canQuoteShipping` / `quoteOrderShipping` | `Store/src/lib/shipping/rates.ts:114-121`, `:139-207`, `:216-238` | C-01, C-02 (via CP-18), C-07 and `checkoutAvailableFor` (`Store/src/lib/checkout/availability.ts:92-111`) | O-11, J-03 | First priced row naming the country, else the first priced `"*"` row; `country = ""` also matches `"*"` (`:171-175`), harmless only because `place-order.ts:164` refuses a parcel with no `shipTo` |
| CP-23 | `placeOrder` (order writer) | `Store/src/lib/orders/record.ts:344-545` | O-01 (from C-03, C-04, O-11) | J-03, DB-05 | Refuses another seller's line (`:399-419`); never re-checks status, identity, country, policy or currency list |
| CP-24 | `order_place(jsonb)` SQL | Production: `Store/supabase/migrations/20261028_product_add_ons.sql:183-342` (currency `:231`); repo-latest, not applied: `20261120_shopping_cart.sql:171-340` | O-01 | J-03 (inserts `orders` directly), DB-05 (`Store/scripts/seed.ts:331`) | Service role only; trusts its caller; the only layer that could also see the dev simulator. A row-level `orders` BEFORE INSERT trigger would see J-03 too |
| CP-25 | `placeStripeOrder` | `Store/src/lib/checkout/stripe-provider.ts:71-201` | C-03 | none | Already re-reads the account fresh before asking Stripe for money; Stripe-side address collection would go here |
| CP-26 | `handleConnectEvent` + `order_confirm_paid` | `Store/src/lib/payments/connect/webhook.ts:124-158`; `Store/supabase/migrations/20261008_order_lifecycle.sql:226-260` | A-03, O-03, O-04, O-07, O-08, RF-04 | n/a | Re-checks only amount and currency against the order (`webhook.ts:73-83`) |

### 2.4 Storefront config and the MCP layer

| CP | Choke point | File:line | Paths through it | Notes |
|---|---|---|---|---|
| CP-27 | `saveStorefront` | `Store/src/lib/storefront/actions.ts:218-410` | SF-02 (UI, MCP `edit_storefront`, `save_storefront`) | No publish gate (bypass of CP-4) |
| CP-28 | `pageConfigRoute` PATCH | `Store/src/lib/storefront/page-config-route.ts:144-220` | SF-03 (three routes; three MCP tools call the exported `PATCH` in process with a synthetic `Request` to `https://agent.invalid`, `Store/src/lib/agent/tools/storefronts.ts:5-13`, `:88-94`, `:380-406`) | A same-origin check added here breaks the three MCP tools ([04] 1.0 item 3) |
| CP-29 | MCP dispatch | `Store/src/lib/agent/dispatch.ts:53-108`; transport `Store/src/lib/agent/mcp-transport.ts:141-153` | Every MCP write tool (36, [04] 1.1) | Tools call the same server actions under the agent context, so a check inside an action or its schema is inherited by the tool. Step-up actions (`saveTaxInfo`, `startStripeOnboarding`) can never be tools (`Store/tests/unit/agent/registry.test.ts:212-231`), and every new `"use server"` export must be classified or the registry test fails (`:197-203`) |

### 2.5 Read-side gates (not writes, but where "publishing blocked" is enforced for buyers)

| RG | Surface | File:line | Predicate |
|---|---|---|---|
| RG-1 | Hosted product page | `Store/src/lib/products/public.ts:215-226` (via `gatePurchasable` `Store/src/lib/products/purchasable.ts:178-190`) | CP-5 then CP-3 |
| RG-2 | Product checkout page; cart page and cart checkout page | `Store/src/lib/checkout/page.ts:34`; `Store/src/lib/checkout/cart-page.ts:41-141` | CP-5, CP-6 |
| RG-3 | Hosted storefront page and embed frame `/e/[key]/[...sites]` | `Store/src/lib/storefront/storefront-page.ts:193-266`; `Store/src/lib/storefront/embed-frame-loader.ts:78` | CP-3 |
| RG-4 | Sitemap | `Store/src/lib/seo/sitemap.ts:146-161` | CP-3 |
| RG-5 | Embed widget JSON `GET /api/embed/[key]` (CDN `s-maxage=300`, `:207`) | `Store/src/app/api/embed/[key]/route.ts:56-79` | CP-1 directly (not CP-3) |
| RG-6 | OG share image | `Store/src/app/api/og/p/[productId]/route.ts:84-102` | CP-1 directly |
| RG-7 | MCP product page preview | `Store/src/lib/agent/preview/product-page-preview.ts:112`, `:162` | CP-1 directly |
| RG-8 | MCP storefront preview | `Store/src/lib/agent/preview/storefront-preview.ts:95`, `:120` | CP-1 directly |

Observation that drives the build ([01] section 3, [03] Q3): a seller-country
rule placed in CP-1/CP-2 reaches every publish write, every buyer read, the
quote inside order placement, the sitemap, the embed JSON, the OG image and
the MCP previews with no extra query; a currency rule needs CP-11 (split into
allowed and readable lists) + CP-12 + CP-14, with CP-13 rewritten; a delivery
and billing rule needs CP-17/CP-18/CP-19 plus a DB backstop at CP-24 or an
`orders` trigger.

---

## 3. Master table

Legend for the rule columns. **n/a**: the rule does not apply to this path.
**E**: enforced today. **P**: partly: a server-side check of the right field
exists but allows more than the rule (the wrong list: EU 27 + US + CA, or
EUR/USD), or covers only some cases. **N**: not enforced: no check of the field
at all on this path. Rules: R1 seller established in CZ (account country and
business address country), R2 CZK only, R3 delivery to CZ only, R4 buyer
billing country CZ for digital goods and services, R5 every seller in a collab
checkout passes R1 to R3, R6 all rules enforced server-side at checkout time.
"Who" uses: seller UI (signed-in seller or team member in the dashboard), MCP
(agent token), buyer (anonymous), webhook (signed Stripe event), cron (cron
secret or pg_cron), staff (Admin), PostgREST (the seller's own JWT straight at
the database), service role.

### 3.1 Seller identity and country (S-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S-01 | Create account (email + password) | Login page, intent `signup`; server action `authenticate` | `Store/src/lib/auth/actions.ts:355-462`; `profiles` row inserted by trigger `handle_new_user` (`Store/supabase/migrations/20261021_reserved_usernames.sql:76-115`, inserts id, username, avatar_url only `:103-112`) | buyer-side anonymous (becomes a seller) | Turnstile, disposable email, budgets, handle, breached password. **No country asked** | none | N | n/a | n/a | n/a | n/a | n/a | Sign-up form + `authenticate`: ask country from the config list; a non-allowed country goes to the waitlist (R8). Never the only check: CP-1 still decides | [01] A1 |
| S-02 | Create account (Google OAuth) | `signInWithGoogle`, then `GET /auth/callback` | `Store/src/lib/auth/actions.ts:644-671`; `Store/src/app/(auth)/auth/callback/route.ts:25-81`; `handle_new_user` | anonymous | None app-side; the Before User Created hook passes OAuth through (`Store/supabase/migrations/20261021_signup_intents.sql:77-80`) | none | N | n/a | n/a | n/a | n/a | n/a | OAuth cannot ask before the account exists: the first signed-in step must ask country (same component as S-04), and CP-1 blocks publishing | [01] A2 |
| S-03 | Save trader identity: name, free-text address, contact email, VAT ID, **country (`tax_country`)**, phone | Settings > Business (`Store/src/components/settings/TaxSection.tsx:179`, `Store/src/app/settings/business/page.tsx:50-64`); not reachable over MCP (`Store/tests/unit/agent/registry.test.ts:85`) | `saveTaxInfo` `Store/src/lib/settings/actions.ts:446-580` (writes through `writeOwnProfile` `:548`) | seller UI, owner's own row only (`user.id`, never the active account) | `taxSchema.partial()` `Store/src/lib/validation/settings.ts:124-138`: country in `OPERATING_COUNTRY_CODES` (EU 27 + US + CA) or "" to null `:131-136`; optional; address is free text with no country (`Store/supabase/migrations/20260905_seller_identity_on_profile.sql:36-50`) | CP-8 | P | n/a | n/a | n/a | n/a | n/a | CP-8 (`taxSchema`): country required and in the config seller list; add a structured business-address country column validated the same way; DB backstop DB-01 | [01] C1 |
| S-04 | Welcome flow trader step | `Store/src/components/onboarding/WelcomeFlow.tsx:123`, posts only name, address, email (`:436`, `:454`, `:477`) | `saveTaxInfo` (as S-03), partial write `Store/src/lib/settings/actions.ts:455-470` | seller UI | As S-03, but **never sends or asks `tax_country`** | CP-8 | N | n/a | n/a | n/a | n/a | n/a | WelcomeFlow must ask country (and address country); non-allowed country shows the R8 block | [01] B9 |
| S-05 | Seller "ships from" country (`shipping_policy.shipsFrom`) | see SH-01 | see SH-01 | seller UI, MCP | `shipsFrom` in `OPERATING_COUNTRY_CODES` (`Store/src/lib/validation/shipping-policy.ts:71-76`); defaulted in the UI from `tax_country` (`Store/src/app/settings/shipping/page.tsx:38-41`) | CP-9 list | P | n/a | P | n/a | n/a | n/a | Not establishment evidence; keep separate from R1 but validate against the same config list (SH-01) | [01] B10 |
| S-06 | Join the marketing waitlist | Home "Get started" modal (`Home/src/components/WaitlistModal.tsx:66-143`, form `Home/src/components/WaitlistForm.tsx:28-298`; Docs "Get started" links to it, `Docs/lib/site.ts:26-32`) | `POST /api/waitlist` `Home/src/app/api/waitlist/route.ts:62-101`: inserts `{ email, source }` only (`:84-86`), discards the "What do you sell?" answer, forwards to an n8n webhook (`:33-60`); anon insert policy `Store/supabase/migrations/20260807_db_hygiene.sql:45-54`; columns email, source, list_id, owner_id, **no country** (`Store/src/types/supabase.ts:2934-2960`); no Store writer | anonymous (anon key) | Rate limit; email shape; honeypot; `owner_id`/`list_id` null, email <= 254, source <= 64; **no consent text on the form** ([08] section 3) | none | n/a | n/a | n/a | n/a | n/a | n/a | R8: needs a seller expansion waitlist with country (new column or table), written server-side from the sign-up block; see also [08] | [01] I1, [08] |


### 3.2 Stripe connected account (A-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A-01 | Create Stripe connected account + onboarding link | `ConnectStripeModal.tsx:34`, `:47`, `:77-82` (disabled while Connect is off), `ConnectionStatusCard.tsx:48`; server action `startStripeOnboarding` | `Store/src/lib/payments/connect/actions.ts:51-73` then `ensurePaymentAccount` `Store/src/lib/payments/connect/account.ts:144-184`, `onboardingLink` `:192-201` | seller UI: owner with `billing.manage` (`actions.ts:28-36`); never MCP (`registry.test.ts:163`) | `stripeConnectLive()`, rate limit. **No trader-identity or country precondition**; `country` sent only when `tax_country` is set (`account.ts:153-164`), fed from `getSellerIdentity` (`actions.ts:59-66`), and a failed read sends none (`Store/src/lib/settings/seller-identity.ts:178-181`); an existing account is returned with no re-check (`account.ts:150-151`); `seller_payment_accounts` has no country column (`Store/supabase/migrations/20261008_seller_payment_accounts.sql:33-49`) | CP-7 | N | n/a | n/a | n/a | n/a | n/a | CP-7: refuse unless the seller country passes R1; send `country` from config (never from an unset field); store the returned `country` (new column) | [01] E1, [A] |
| A-02 | Return/refresh from Stripe onboarding | `GET /api/payments/connect/return` | `Store/src/app/api/payments/connect/return/route.ts:27-43` then `refreshPaymentAccount` `Store/src/lib/payments/connect/account.ts:129-135`, `saveAccountFacts` `:108-118` | seller UI (signed-in owner, rate limited) | Stores 3 booleans only; Stripe `country` is in the response but not typed (`Store/src/lib/billing/stripe-api.ts:110-115`) | CP-7b (`saveAccountFacts`) | N | n/a | n/a | n/a | n/a | n/a | `saveAccountFacts`: type and store `country`; a mismatch blocks checkout via CP-6 | [01] E2 |
| A-03 | `account.updated` webhook | `POST /api/payments/webhook` (Connect endpoint) | `Store/src/app/api/payments/webhook/route.ts:32-53`; `handleConnectEvent` `Store/src/lib/payments/connect/webhook.ts:124-158`, case `:165-175` | webhook (signed) | Signature, mode, type allowlist (`webhook.ts:42-48`); stores 3 booleans; ignores `country`, `requirements`, `disabled_reason` | CP-7b | N | n/a | n/a | n/a | n/a | n/a | Same `saveAccountFacts` change; a non-allowed country sets a blocked state read by CP-6 and CP-1 | [01] E3 |
| A-04 | Express dashboard / login link | `PayoutMethodCard.tsx:22`, `OrderActions.tsx:80`; `openStripeDashboard` | `Store/src/lib/payments/connect/actions.ts:81-98`, `dashboardLink` `account.ts:208-214` | seller UI owner | Owner + live + rate limit; writes nothing in the database (Stripe login link only) | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [01] E5 |
| A-05 | Disconnect / deauthorize | none | No code: `account.application.deauthorized` not handled (`webhook.ts:42-48`); deletion cascades the row only (`20261008_seller_payment_accounts.sql:25-26`) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Not a write path today; listed so nobody looks for it | [01] E6 |


### 3.3 Product, price and currency (P-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | Create product (form) | `Store/src/app/(dashboard)/products/new/page.tsx:103-121`, `ProductForm.tsx:1236-1265`; server action `createProduct` | `Store/src/lib/products/actions.ts:341-429` (insert `:413-417`, `currency: data.currency` `:387`) | seller UI (owner, editor: `products.write`) | `productWriteSchema` (`Store/src/lib/validation/product.ts:473-559`, currency in `CURRENCIES` = EUR, USD `:478`; price 1 to 100,000,000 `:477`); publish gate when `status=active` (`actions.ts:333-339`, `:367`); default currency predicted, CZ maps to EUR (`Store/src/lib/predictions.ts:248-257`) | CP-10, CP-11, CP-4, CP-12 | N | P | n/a | n/a | n/a | n/a | CP-11 split into "allowed for new writes" (config: CZK) and "readable" lists; CP-10 uses the allowed list; CP-4/CP-1 adds the seller-country rule; DB CHECK (CP-12) widened then narrowed for new rows | [02] P1 |
| P-02 | Create product (MCP) | MCP `create_product` (`Store/src/lib/agent/tools/products.ts:166-191`, `currency: z.enum(CURRENCIES)` `:177`) | `assertValidWrite` `:85-88`, then `createProduct` `:188` | MCP (`products:write`) | `productWriteSchema` twice, then all of P-01 | CP-10, CP-11, CP-4 | N | P | n/a | n/a | n/a | n/a | Same as P-01 (in-process call into the action, so one fix covers both); MCP `get_schema` advertises the enum from the same Zod schema (`Store/src/lib/agent/tools/storefronts.ts:41-44`, `:172`) | [02] P2, [04] |
| P-03 | Edit product (form) | Edit page loads `getProduct` (`Store/src/app/(dashboard)/products/[id]/edit/page.tsx:43`); `ProductForm.tsx:1263-1264` | `updateProduct` `Store/src/lib/products/actions.ts:431-595`; **always writes** title, description, price_cents, currency, status (`:509-515`) | seller UI (`products.write`) | As P-01 minus plan limit. Starting currency comes from the lossy read `rowToProduct` (`Store/src/lib/products/queries.ts:143`: non-USD becomes EUR) | CP-10, CP-11, CP-4, CP-13 (lossy read) | N | P | n/a | n/a | n/a | n/a | CP-10/CP-11 as P-01; CP-13 (`queries.ts:143`, `toCurrency`) must stop collapsing unknown currencies or a CZK row is rewritten as EUR | [02] P3 |
| P-04 | Edit title/price from the storefront designer tile | `Store/src/components/storefront/ProductBlockEditor.tsx:182-237` | `updateProduct` (P-03); own client parser `centsOf` (`:43-49`); sends `currency: product.currency` from the lossy read (`:219`) | seller UI | Server re-runs P-03 | CP-10, CP-13 | N | P | n/a | n/a | n/a | n/a | As P-03 | [02] P4 |
| P-05 | Edit product (MCP) | MCP `update_product` (`Store/src/lib/agent/tools/products.ts:193-228`) | Rebuilds title, description, `priceCents = Math.round(price*100)`, currency, status from `getProduct` (`:210-218`), overlays agent fields, `assertValidWrite` `:224`, `updateProduct` `:225`; re-sends lossy currency `:217` | MCP | As P-03 | CP-10, CP-13 | N | P | n/a | n/a | n/a | n/a | As P-03; a legacy EUR product fails every MCP edit once the write list is CZK-only (hazard) | [02] P5 |
| P-06 | Publish / unpublish from the product card | `Store/src/components/products/ProductList.tsx:212` | `setProductStatus` `Store/src/lib/products/card-actions.ts:44-92` (writes `status` only `:75-81`) | seller UI | `z.enum(PRODUCT_STATUSES)`; publish gate for `active` only (`:65-68`); **never re-checks currency or price** | CP-4 only (bypasses CP-10) | N | N | n/a | n/a | n/a | n/a | CP-4 (publish gate) must also refuse a product whose stored currency is not allowed; DB trigger on `status -> active` as backstop | [02] P6, B4 |
| P-07 | Publish (MCP, batch up to 20) | MCP `publish_products` (`Store/src/lib/agent/tools/products.ts:230-335`) | per id `{title, description, priceCents, currency, status: "active"}` (`:276-282`), `assertValidWrite` `:283`, `updateProduct` `:284` | MCP | As P-03, lossy currency `:280` | CP-10, CP-4, CP-13 | N | P | n/a | n/a | n/a | n/a | As P-03 | [02] P7, [01] G2 |
| P-08 | Duplicate product | `ProductList.tsx:227` | `duplicateProduct` `Store/src/lib/products/card-actions.ts:101-164` (raw read `:121-128`, insert `...source, status: "draft"` `:138-151`) | seller UI | uuid, plan limit, moderation precheck. **No `productWriteSchema`**: copies stored `currency` and `price_cents` unvalidated | BYPASSES CP-10 | n/a | N | n/a | n/a | n/a | n/a | Validate the copied currency against the allowed list (or let the DB CHECK refuse); result is a draft, so P-06 must also check | [02] P9, B3 |
| P-09 | Delete product | `ProductList.tsx:124`; MCP `delete_product` (`Store/src/lib/agent/tools/products.ts:438-454`, scope `destructive`) | `deleteProduct` `Store/src/lib/products/actions.ts:597-662` | seller UI, MCP | uuid, orders-to-ship acknowledgement | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [02] P10 |
| P-10 | Stock settings | `ProductList.tsx:197`; MCP `update_stock` (`products.ts:357-374`) | `updateStockSettings` `Store/src/lib/stock/actions.ts:53-107` (own schema `:33-42`) | seller UI, MCP | Partial write of stock columns | BYPASSES CP-10 (harmless: no currency) | n/a | n/a | n/a | n/a | n/a | n/a | none (but see DB hazard: a row-level CHECK fires on any later update of a legacy row) | [02] P14, B5 |
| P-11 | Badge move / badge label check | Designer `ProductPageArtboard.tsx:190`; MCP `move_product_badge`, `check_badge_label` (`products.ts:376-403`) | `moveProductBadge` `Store/src/lib/products/badge-actions.ts:73-141` (partial `details` write `:122-132`) | seller UI, MCP | `badgesSchema` | BYPASSES CP-10 (harmless) | n/a | n/a | n/a | n/a | n/a | n/a | none | [02] P18, B6 |
| P-12 | Add-ons (designer picker; also `addOnIds` inside P-01/P-03) | `Store/src/components/storefront/ProductAddOnsEditor.tsx:86` | `setProductAddOns` `Store/src/lib/products/add-on-actions.ts:100-156` (partial write `:125-131`) | seller UI | Same store only; **no currency compatibility at write**; an add-on in another currency is hidden at read (`Store/src/lib/products/add-on-visibility.ts:16-23`) and refused at checkout (`Store/src/lib/checkout/quote.ts:273-279`) | BYPASSES CP-10 (harmless) | n/a | n/a | n/a | n/a | n/a | n/a | none: the add-on product's own currency is governed by P-01/P-03 and refused at CP-14 | [02] P19, P20, B7 |
| P-13 | Photos, gallery, documents, digital file | Upload routes `Store/src/app/api/uploads/{image,file,document}/route.ts`; MCP `upload_image` (`products.ts:405-436`) | keys saved through P-01/P-03 | seller UI, MCP | key shape + ownership + HEAD | CP-10 | n/a | n/a | n/a | n/a | n/a | n/a | none; note `digital_file_key !== null` is what makes a product digital (`Store/src/lib/checkout/availability.ts:95`, `Store/src/lib/checkout/quote.ts:253`), the R3 versus R4 split | [02] P21 |
| P-14 | Product page facts (details, options, specs, origin, purchase link, shipping profile) | inside P-01/P-03 | `productDetailsSchema` `Store/src/lib/validation/product.ts:384-421`; `purchaseUrlSchema` `:432-451` | seller UI, MCP | `details.origin` free text; a product with `purchase_url` is refused by our checkout (`quote.ts:237-241`) and sends buyers to the seller's own site | CP-10 | n/a | n/a | n/a | n/a | n/a | n/a | `purchase_url` products leave our checkout entirely: out of scope for R3/R4/R6, but R7 messaging should say so | [02] P22 |


### 3.4 Import (I-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| I-01 | CSV import (UI) | `Store/src/app/(dashboard)/products/import/page.tsx:83-93` (default currency `:87`); `Store/src/components/products/ProductImport.tsx:120`, `:197-200`, currency select `:355-364` | `importProducts` `Store/src/lib/products/import-actions.ts:111-284` (rows built by the action `:228-238`, one insert `:256-259`) | seller UI (`products.write`) | Currency must be in `CURRENCIES` (`:151-155`), ONE currency for every row; publish gate if active (`:165-168`); file re-parsed server-side (`buildImportPlan` `Store/src/lib/products/csv.ts:345-422`); `productWriteSchema` per row (`:209-226`). The price cell's symbol is stripped and never compared with the pick (`Store/src/lib/products/price.ts:62-65`): "12 Kč" and "CZK 12" parse, "12 EUR" fails | CP-11, CP-10, CP-4 | N | P | n/a | n/a | n/a | n/a | CP-11 allowed list; optionally refuse a price cell whose symbol names a different currency | [02] P11 |
| I-02 | CSV import (MCP) | MCP `import_products` (`Store/src/lib/agent/tools/products.ts:337-355`, `currency: z.enum(CURRENCIES)` `:348`) | `importProducts` (I-01) in process | MCP | As I-01 | CP-11, CP-10, CP-4 | N | P | n/a | n/a | n/a | n/a | As I-01 | [02] P12, [04] |
| I-03 | Undo import | `ProductImport.tsx:229` | `undoProductImport` `Store/src/lib/products/import-actions.ts:304-341` | seller UI | Deletes untouched rows only | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [02] P13 |


### 3.5 Discount (D-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D-01 | Create sale or code | `Store/src/components/discounts/DiscountForm.tsx:310`; MCP `create_discount` (`Store/src/lib/agent/tools/discounts.ts:71-81`) | `createDiscount` `Store/src/lib/discounts/actions.ts:122-152` (insert `:143-147`, `toColumns` currency `:61`) | seller UI, MCP (`products.write`) | `discountInputSchema` (`Store/src/lib/validation/discounts.ts:56-84`): amount needs `currency: z.enum(CURRENCIES)` (`:38-42`); percent has no currency; DB CHECK `discounts_value` amount currency in (EUR, USD) (`Store/supabase/migrations/20261004_discounts.sql:84-92`) | CP-15, CP-11, CP-12 | n/a | P | n/a | n/a | n/a | n/a | CP-11 allowed list inside CP-15; widen `discounts_value` with the other two CHECKs; an amount discount only applies to products in its own currency (`Store/src/lib/discounts/pricing.ts:39-47`) | [02] D1 |
| D-02 | Edit discount | `DiscountForm.tsx:310`; MCP `update_discount` (`discounts.ts:85-95`) | `updateDiscount` `Store/src/lib/discounts/actions.ts:159-203` | seller UI, MCP | As D-01; a started sale may change only `ends_at`; DB `guard_discount_rules` freezes `currency` once started (`20261004_discounts.sql:208-218`) | CP-15, CP-11 | n/a | P | n/a | n/a | n/a | n/a | As D-01 | [02] D2 |
| D-03 | Switch a code on/off | `DiscountsPage.tsx:101`; MCP `set_code_enabled` (`discounts.ts:99-106`) | `setCodeEnabled` `Store/src/lib/discounts/actions.ts:223-241` | seller UI, MCP | uuid, boolean | none | n/a | n/a | n/a | n/a | n/a | n/a | none: a re-enabled EUR amount code reduces nothing on a CZK product (`pricing.ts:39-47`) | [02] D3 |
| D-04 | End a sale | `DiscountForm.tsx:325`, `DiscountsPage.tsx:118`; MCP `end_sale` (`discounts.ts:110-117`) | `endSale` `actions.ts:244-262` | seller UI, MCP | uuid | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [02] D4 |
| D-05 | Delete (archive) discount | `DiscountsPage.tsx:132`; MCP `delete_discount` (`discounts.ts:121-128`, scope `destructive`) | `deleteDiscount` `actions.ts:269-286` | seller UI, MCP | uuid | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [02] D5 |


### 3.6 Shipping policy (SH-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SH-01 | Replace shipping policy (ships from, destinations with countries and rates, `ratesCurrency`, free-over threshold, returns) | Settings > Shipping & returns form; server action `saveShippingPolicy` | `Store/src/lib/settings/shipping-actions.ts:71-123`; written via `writeOwnProfile` (`Store/src/lib/moderation/auto/seller-text.ts:96-131`) | seller UI, signed-in user's OWN row (`user.id`), never the team account (`Store/src/app/settings/shipping/page.tsx:16-26`) | Strict `shippingPolicySchema` (`Store/src/lib/validation/shipping-policy.ts:67-138`): destination `countries` in `[...SHIPPING_COUNTRY_CODES, "*"]` (29 codes + catch-all, `:44-65`); `shipsFrom` in `OPERATING_COUNTRY_CODES` (`:71-76`); `ratesCurrency` in `CURRENCIES` (`:79`); rate cap `SHIPPING_RATE_MAX_CENTS` 100,000 sized for euros (`Store/src/types/shipping-policy.ts:113-115`) | CP-20 | n/a | P | P | n/a | n/a | n/a | CP-20: destination list and `ratesCurrency` from config; decide what `"*"` means (config list, never "all 29"); the reader CP-21 must be made tolerant first or narrowing the list empties every stored policy (hazard H1) | [03] S1 |
| SH-02 | Replace shipping policy (MCP) | MCP `save_shipping_policy` (`Store/src/lib/agent/tools/storefronts.ts:426-440`, `ownerOnly`) | `shippingPolicySchema.safeParse` (`:436`), then SH-01 in process through `formDataFrom` (`:438`) | MCP (owner) | As SH-01, twice | CP-20 | n/a | P | P | n/a | n/a | n/a | As SH-01 (one fix covers both) | [03] S2, [04] |
| SH-03 | Direct write of `profiles.shipping_policy` | PostgREST | Refused for sessions by the moderation guard (`Store/supabase/migrations/20261012_auto_moderation.sql:749-764`); DB CHECK only "null or object <= 16 KB" (`20260905_shipping_policy_on_profile.sql:49-56`) | service role only | Guarded column | n/a (closed) | n/a | n/a | n/a | n/a | n/a | n/a | none: already closed to sessions; service-role writers are SH-01 only | [03] 1.1 |

### 3.7 Storefront and page config (SF-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SF-01 | Create storefront | `Store/src/components/storefront/useCreateStorefront.ts:28`; MCP `create_storefront` (`Store/src/lib/agent/tools/storefronts.ts:226-238`) | `createStorefront` `Store/src/lib/storefront/actions.ts:110-210` | seller UI, MCP (`storefront.write`) | Plan limit; no currency or country in `storefronts` (`Store/src/types/supabase.ts:2655-2675`) | none | n/a | n/a | n/a | n/a | n/a | n/a | none: a storefront is buyer-visible only through the read gates CP-3 | [02] S1 |
| SF-02 | Save design (name, theme, blocks, header, **embed**, productPage, checkoutPage, cartPage) | `StorefrontDesigner.tsx:3864`; MCP `edit_storefront` (`storefronts.ts:240-300`), `save_storefront` (`:342-370`, free-form `config` record `:353`) | `saveStorefront` `Store/src/lib/storefront/actions.ts:218-410` (embed `:280-282`, page switches `:291-300`, update `:383-392`) | seller UI, MCP | `storefrontConfigSchema`; product blocks must be the caller's own. **No publish gate**: `config.embed.enabled: true` and page switches can be saved with incomplete identity | BYPASSES CP-4 | N | n/a | n/a | n/a | n/a | n/a | Apply CP-4 when `embed.enabled` or a page switch flips on (same as SF-04), or accept that the read gates CP-3/G8 refuse to serve it | [02] S2, [01] BP2, BP3 |
| SF-03 | Product page / checkout page / cart page settings | `PATCH /api/storefronts/[id]/product-page`, `/checkout-page`, `/cart-page`; MCP `update_product_page`, `update_checkout_page`, `update_cart_page` (`storefronts.ts:372-406`) | `pageConfigRoute` `Store/src/lib/storefront/page-config-route.ts:144-220` (update `:200-207`) | seller UI, MCP | Member schema on the merged object; page photo ownership. No gate | BYPASSES CP-4 | N | n/a | n/a | n/a | n/a | n/a | As SF-02; R7: the checkout page is where buyer-facing CZ-only copy must live | [02] S3, [01] BP3 |
| SF-04 | Embed on/off + domain allowlist | `EmbedSettings.tsx:221`, `:249`; MCP `update_embed_settings` (`storefronts.ts:408-424`) | `updateEmbedSettings` `Store/src/lib/storefront/actions.ts:478-551` (update `:535-541`) | seller UI, MCP | `embedSettingsSchema`; **publish gate when enabling** (`:510-513`); turning off never gated | CP-4 | N | n/a | n/a | n/a | n/a | n/a | CP-1 country rule reaches here through CP-4 with no extra code | [02] S4, [01] G5 |
| SF-05 | Delete storefront / rotate embed key | `StorefrontsList.tsx:143`, `EmbedSettings.tsx:266`; MCP `delete_storefront`, `rotate_embed_key` (`storefronts.ts:442-470`) | `deleteStorefront` `actions.ts:554-596`; `rotateEmbedKey` `:614-650` | seller UI, MCP | uuid | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [02] S5 |
| SF-06 | Storefront assets (elements, fonts) | `POST /api/uploads/element`, `/api/uploads/font`; MCP `upload_element` (`Store/src/lib/agent/tools/storefronts.ts:306`) | `Store/src/app/api/uploads/element/route.ts:48`, `Store/src/app/api/uploads/font/route.ts:32`; `rememberUpload` `Store/src/lib/agent/object-refs.ts:118` | seller UI, MCP | R2 object + `agent_uploads` only | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [04] 1.1, 2.2 |


### 3.8 Checkout and cart (C-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-01 | Place "Buy now" order (+ add-ons) | `POST /api/checkout/[storefrontId]/[productId]` from the hosted checkout page (reached from product page, embed frame link, website buy button) | `Store/src/app/api/checkout/[storefrontId]/[productId]/route.ts:22-42` then `placeOrderResponse` `Store/src/lib/checkout/place-order.ts:89-196` then `quoteOrder` `Store/src/lib/checkout/quote.ts:158-185` | buyer (anonymous: same-origin, rate limit, Turnstile) | `placeOrderSchema` strict (`Store/src/lib/validation/checkout.ts:71-86`); `shipTo.country` in `SHIPPING_COUNTRY_CODES` (29, literal, `checkout.ts:41`); seller's priced rows, `"*"` admits all 29 (`Store/src/lib/shipping/rates.ts:139-207`); gate with `sellerMaySell` (no country); one currency per order (`quote.ts:273-279`) via lossy `toCurrency` (`:254`); `expectedTotalCents` compares cents only (`place-order.ts:151`); provider re-checked (`:157-158`); parcel needs `shipTo`, download needs consent (`:164-165`). **No billing country field exists** | CP-17, CP-18, CP-14, CP-5, CP-3, CP-6, CP-19 | N | P | P | N | n/a | P | CP-18/CP-14: currency in allowed list, delivery country in config list independent of the seller's `"*"`; new `billingCountry` body field required for digital lines, checked beside the consent check (`place-order.ts:164-165`); CP-5/CP-1 seller rule; DB backstop in CP-24 | [03] C1, 3.2 |
| C-02 | Place cart order | `POST /api/checkout/[storefrontId]` from `/s/[sf]/checkout?cart=` | `Store/src/app/api/checkout/[storefrontId]/route.ts:19-31` then the same pipeline as C-01 | buyer | `placeCartOrderSchema` (`checkout.ts:99-103`); the body's lines are re-quoted, stored cart lines are not used; `cartId` stored unchecked (`route.ts:27-28`) | as C-01 | N | P | P | N | n/a | P | As C-01 (same pipeline, one fix) | [03] C2 |
| C-03 | Reserve pending order + create Stripe Checkout Session | inside C-01/C-02 when provider is `stripe` | `placeStripeOrder` `Store/src/lib/checkout/stripe-provider.ts:71-201` (fresh account re-read `:79-81`; session params `:122-168`; `payment_ref` `:174-178`; release on failure `:193-199`) | service role inside the buyer request | Account `charges_enabled` + mode only. Session sends **no** `shipping_address_collection`, `billing_address_collection`, allowed countries or `automatic_tax`; currency is `quote.currency` (`:106`, `:138`) | CP-25, CP-6 | N | P | N | N | n/a | P | CP-25: refuse when the stored Stripe account country is not allowed (needs A-02/A-03 first); add `billing_address_collection: "required"` and (parcels) `shipping_address_collection.allowed_countries` from config as defence in depth | [03] 3.3, 3.4 |
| C-04 | Test provider: record paid order immediately | inside C-01/C-02 when `NODE_ENV=development` and `CHECKOUT_TEST_PAYMENTS=1` | `Store/src/lib/checkout/provider.ts:94-123`; `Store/src/lib/checkout/availability.ts:41-43` | dev only | Re-checked inside (`provider.ts:102`) | CP-17 (after the quote) | N | P | P | N | n/a | P | Same pipeline as C-01; not reachable in production | [03] 3.3 |
| C-05 | Discount "Apply" check | `POST /api/checkout/[storefrontId]/discount`, `.../[productId]/discount` | `Store/src/lib/checkout/discount-check.ts:48-86` | buyer | Same-origin, schema, rate limit, gate, provider. **Writes nothing** | CP-5, CP-6 | n/a | n/a | n/a | n/a | n/a | n/a | none (read only; listed because it is a checkout route) | [03] C3 |
| C-06 | Cancel from the Stripe page (delete pending order) | `GET /api/checkout/cancel?c=cs_ss_...` | `Store/src/app/api/checkout/cancel/route.ts:42-85` (expires the session first `:65-71`, then RPC `order_release_pending`) | buyer (the checkout id is the capability) | id shape, rate limit | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] C4, X1 |
| C-07 | Cart add / set / remove / clear / merge | `POST /api/cart/[storefrontId]` (hosted pages; embed frame on the embed host when `EMBED_CART_API=1`) | `Store/src/app/api/cart/[storefrontId]/route.ts:49-168`; `cartGate` `Store/src/lib/cart/route.ts:26-41`; `Store/src/lib/cart/store.ts:79-98`, `:106-134`, `:185-196` | buyer (cart id is the capability) | `cartWriteSchema`; `gatePurchasableLines`; `assessLines` over the whole cart (one currency, delivery priceable in it); `cf-ipcountry` read for display only. **Not live in production**: `CART_ENABLED` is on by default only under `next dev` (`Store/src/lib/cart/availability.ts:14-19`), and `public.carts` does not exist in prod (migration 20261120 not applied), so the route cannot work there whatever the switch says | CP-5, CP-14 | N | P | n/a | n/a | n/a | n/a | Nothing extra: the cart checkout (C-02) re-quotes the body's lines; CP-5/CP-14 changes reach the cart for free | [03] K1 |
| C-08 | Cart view priced now | `POST /api/cart/[storefrontId]/view` | `Store/src/app/api/cart/[storefrontId]/view/route.ts:26-52` | buyer | Writes nothing | CP-5 | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] K2 |
| C-09 | Close cart on payment | order writer | `closeCart` / `closeOrderCart` `Store/src/lib/cart/store.ts:142-160`, called from `Store/src/lib/orders/record.ts:273`, `:319` | service role | `ordered_at is null` | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] K3 |

### 3.9 Order (O-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| O-01 | Insert order (pending or paid) | Called by C-03 (`reservePendingOrder`), C-04 and the dev simulator (`recordPaidOrder`) | `placeOrder` `Store/src/lib/orders/record.ts:344-545` then RPC `order_place` (in the repo, latest `Store/supabase/migrations/20261120_shopping_cart.sql:171-336`; **in production the latest applied version is older**, because 20261120 is not applied: see section 6) | service role (`order_place` executable by service_role only, `20261120_shopping_cart.sql:339-340`) | `paidCheckoutSchema` currency only `^[A-Za-z]{3}$` (`record.ts:220`); re-reads product owner/price/file key, refuses another seller's line (`:370-419`); `parseShipTo` checks `^[A-Z]{2}$` only, and a failed parse writes `ship_to = null` (`record.ts:430`, `Store/src/lib/orders/ship-to.ts:14`, `:44-45`); SQL `currency = coalesce(incoming.currency, 'EUR')` (`20261120:220`); `orders.currency` has **no CHECK** (`Store/tests/db/prod-migrations.sql:301`); `ship_to` CHECK is object + size only (`Store/supabase/migrations/20260927_order_fulfilment.sql:87-93`). **No currency, country, seller or status check** | CP-23, CP-24 | N | N | N | N | n/a | N | CP-24: DB backstop in `order_place` (rebased on the 20261120 version, hazard H4) or a CHECK/trigger on `orders`: currency and `ship_to->>'country'` (parcels) and billing country (digital) against the config tables, seller allowed | [03] 5.1, O1 |
| O-02 | Stripe session id on the pending order | inside C-03 | `Store/src/lib/checkout/stripe-provider.ts:174-178` | service role | `status='pending'` | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] O2 |
| O-03 | Pending to paid | webhook `checkout.session.completed` | `handleConnectEvent` `Store/src/lib/payments/connect/webhook.ts:177-215`; `confirmPendingOrder` `Store/src/lib/orders/record.ts:306-327`; RPC `order_confirm_paid` (`Store/supabase/migrations/20261008_order_lifecycle.sql:226-260`) | webhook | Amount and currency must equal the order (`webhook.ts:73-83`, `:198-207`); SQL flips `pending -> paid` only. **Nothing re-validated** after a window of up to 31 min (Stripe page) / 45 min (hold) | CP-26 | N | N | N | N | n/a | N | CP-26: before `confirmPendingOrder`, re-run the seller rule (R1) and refuse/refund, or accept and document the bounded 45-minute window; read and store `customer_details.address.country` (R4) | [03] O3, Q4 |
| O-04 | Fee correction and ledger after payment | webhook after O-03 | `settleOrderFees` `Store/src/lib/payments/connect/fees.ts:51-100` (reads `GET /payment_intents/{id}?expand[]=latest_charge` `:67-72`) | webhook | Stripe application fee read back | none | n/a | n/a | n/a | N | n/a | n/a | R4 evidence: log `latest_charge.payment_method_details.card.country` from the read already made here (never block on it) | [03] O5, 3.4 |
| O-05 | Announce order (bell, emails, markers) | after O-01 (paid) / O-03 | `announceOrder` `Store/src/lib/orders/record.ts:590-676` | service role | `status='paid'` | none | n/a | n/a | n/a | n/a | n/a | n/a | none (Czech-language buyer email is a language item) | [03] O4 |
| O-06 | Mark shipped / tracking / carrier | `OrderShipping.tsx:179`; MCP `mark_order_shipped` (`Store/src/lib/agent/tools/orders.ts:84-101`) | `markOrderShipped` `Store/src/lib/orders/actions.ts:72-134`; RPC `order_mark_shipped` (`Store/supabase/migrations/20261001_order_tracking_carrier.sql:68`, logic `20260927_order_fulfilment.sql:165-216`) | seller UI, MCP (SECURITY DEFINER RPC) | `orders.fulfil`, carrier in `CARRIER_IDS` (includes `ceska-posta`, `Store/src/types/order-view.ts:89`) | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] O6 |
| O-07 | Order disputed | webhook `charge.dispute.created` | `Store/src/lib/payments/connect/webhook.ts:252-277` | webhook | only from `paid` | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] O7 |
| O-08 | Release pending order on Stripe expiry | webhook `checkout.session.expired` | `Store/src/lib/payments/connect/webhook.ts:217-227` (RPC `order_release_pending`) | webhook | order must be this seller's | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] X2 |
| O-09 | Buyer withdrawal request | `POST /api/orders/withdraw` from the order page | `Store/src/app/api/orders/withdraw/route.ts:44-133` (write `:76-82`) | buyer with HMAC order link + email | Window from the **re-read** shipping policy (`:71-72`; `Store/src/lib/orders/withdrawal.ts:39-68`) | none | n/a | n/a | n/a | n/a | n/a | n/a | none, but hazard H1: if the stored policy stops parsing, existing orders' windows fall to 14 days | [03] W1 |
| O-10 | Review reminder consent | `POST /api/orders/review-reminder` | `Store/src/app/api/orders/review-reminder/route.ts:36` (update `:83-84`) | buyer with order link | same-origin | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] O9 |
| O-11 | Dev "simulate a sale" | `/dev/simulate-sale` (`route.dev.ts`, excluded from production builds by `pageExtensions`, `Store/next.config.ts:175`) | `Store/src/lib/dev/simulated-sale.ts:34-55`, `:92-156` (`recordPaidOrder` `:139`) | dev only, seller session | **Bypasses the quote**: fixed IE/DE/FR/NL addresses, product currency | BYPASSES CP-17, CP-18 | N | N | N | n/a | n/a | N | Not reachable in production; only the CP-24 DB backstop would cover it | [03] 8, Q3 |

### 3.10 Refund (RF-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RF-01 | Whole-order refund | `OrderRefund.tsx:137`; MCP `refund_order` (`Store/src/lib/agent/tools/orders.ts:103-120`) | `refundOrder` `Store/src/lib/orders/actions.ts:231-289` then `refundWhatIsLeft` `:422-443`, `refundWithProvider` `:459-501` (Stripe `POST /refunds`, `refund_application_fee: true`) then `order_apply_refund` (service role) or `order_refund` (client) | seller UI owner (`orders.refund`), MCP | pre-read scoped by `seller_id`, `status='paid'` | none | n/a | n/a | n/a | n/a | n/a | n/a | none (money leaves; no rule applies) | [03] R1w |
| RF-02 | Per-line refund | `OrderRefund.tsx:136`; no MCP tool | `refundOrderLine` `Store/src/lib/orders/actions.ts:302-406`; RPCs `order_line_refund_amount`, `order_apply_line_refund` (`Store/supabase/migrations/20261120_shopping_cart.sql:396-558`) | seller UI owner | as RF-01. Note: both RPCs exist only in the unapplied 20261120 migration, so this path cannot work in production today (inferred from the facts) | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] R2w |
| RF-03 | Client-callable manual refund RPC | PostgREST `rpc/order_refund` | `Store/supabase/migrations/20261021_order_refund_provider_first.sql:21-59` (then `order_apply_refund`, `20261028_product_add_ons.sql:443+`) | PostgREST (owner or `orders.refund`, MFA bar) | refuses `payment_ref like 'pi\_%'` | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] R3w |
| RF-04 | Webhook full refund | `charge.refunded` | `Store/src/lib/payments/connect/webhook.ts:229-250`; `recordChargeFeeRefunds` `Store/src/lib/payments/connect/fees.ts:107-121` | webhook | only `refunded === true` changes the order | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] R4w |

### 3.11 Moderation and Admin actions (AD-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AD-01 | Take down content: pause or remove a product / storefront / artifact | `ModerationActions` on Admin `/moderation/[type]/[id]` (works for unreported items too: `Admin/src/components/moderation/SellerCard.tsx:137-145`) | `Admin/src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:204-378` (decision insert `:279-303`, content update `:305-324`, decision deleted on failure `:329`) | staff (`requireStaff`, aal2), service role | Closed ground list with **no market-rules ground** (`Admin/src/lib/moderation/content.ts:234-243`), mirrored in a DB CHECK (`Store/supabase/migrations/20260926_moderation_decisions_and_appeals.sql:52-54`); pause needs a fix field and a 10-char note | none (moderation columns only) | n/a | n/a | n/a | n/a | n/a | n/a | This is the tool staff would use to unpublish a non-compliant listing: add a "market rules" ground to the list and its CHECK together if staff are to cite it | [06] A1 |
| AD-02 | Restore / approve held / approve fix | same page | `Admin/src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:441-500` (writes `moderation_status='ok'` and clears the moderation columns `:387-412`) | staff, service role | Only from paused/removed/review; **checks nothing about market rules**; writes no decision row | BYPASSES every write-side choke point (service-role write of `moderation_status`) | N | N | n/a | n/a | n/a | n/a | Enforce on the READ side (CP-3/CP-5 seller rule, CP-14 currency) so a restored listing still cannot be sold; optionally refuse restore (or warn) when the owner or the product breaks R1/R2 | [06] A2 |
| AD-03 | Answer an appeal (overturn restores content) | `AppealPanel` | `Admin/src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:516-610` (restore `:571-575`) | staff, service role | As AD-02 | BYPASSES (as AD-02) | N | N | n/a | n/a | n/a | n/a | As AD-02 | [06] A3 |
| AD-04 | Dismiss reports | `ModerationActions` | `Admin/src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:621-651` | staff | `reports` status only | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [06] A4 |
| AD-05 | Ban / unban a user | `BanPanel` on `/users/[id]` | `Admin/src/app/(app)/users/[id]/actions.ts:56-142`, `:145-164` | staff, service role | Auth `ban_duration`, `admin_user_moderation`, session revoke. Changes no listing; the only `banned_until` reader in `Store/src/lib` is the agent authenticator (`Store/src/lib/agent/authenticate.ts:54`), so checkout does not read it (inferred in [06]) | none | n/a | n/a | n/a | n/a | n/a | n/a | No "freeze seller" exists. If a seller-level block is wanted for a non-CZ seller, it must be a flag read by CP-1/CP-3, not a ban | [06] A5, A6 |
| AD-06 | Delete account (soft/hard), email user, password reset, confirm email | `/users/[id]` | `Admin/src/app/(app)/users/[id]/actions.ts:173-326` (delete owner-only `:284-326`) | staff (delete: owner) | Auth admin calls; delete cascades to `orders` by FK (`Store/tests/db/prod-migrations.sql:293`, per [05] section 3) | none | n/a | n/a | n/a | n/a | n/a | n/a | Existing-data report must be captured before any deletion (orders cascade) | [06] A7-A10, [05] |
| AD-07 | Give / extend / end a plan | `GrantPlanDialog`, `PlanPanel`, `EndGrantDialog` | `Admin/src/app/(app)/plans/actions.ts:83-318`; RPCs `plan_grant_set`, `plan_grant_end` (`Store/supabase/migrations/20261019_plan_grants.sql:125-210`) | staff, service role | Lists, limits | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [06] A11-A13 |
| AD-08 | Campaign email to the whole waitlist | `SendCampaignDialog` on `/signups` | `Admin/src/app/(app)/signups/actions.ts:21-66` | staff | Reads `waitlist_signups`, no country | none | n/a | n/a | n/a | n/a | n/a | n/a | R8: once the waitlist has a country, the campaign and the CSV export (`Admin/src/app/(app)/signups/export/route.ts:11-41`) can segment by it | [06] A14, R4 |
| AD-09 | Staff push devices, preferences, test push, scan now; scan and notify endpoints; exports; staff sign-in | Admin settings, `POST /api/notifications/scan`, `POST /api/moderation/notify`, `GET /plans/export`, `GET /signups/export`, auth routes | `Admin/src/app/(app)/settings/notifications/actions.ts:50-305`; `Admin/src/app/api/notifications/scan/route.ts:21-37`; `Admin/src/app/api/moderation/notify/route.ts:25-41`; `Admin/src/lib/notifications/scan.ts:50-97`; `Admin/src/lib/auth/actions.ts:90-291` | staff, scan secret | Admin-owned tables, `notifications` inserts (plan expiry) | none | n/a | n/a | n/a | n/a | n/a | n/a | The scan (`scan.ts:56-72`) is the natural host for a market-rules alert source | [06] A15-A23, R1-R8, C1 |

### 3.12 Scheduled and background writers (J-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| J-01 | Release abandoned pending orders | pg_cron every 5 min (job `orders-release-expired`, active in prod) | `orders_release_expired` `Store/supabase/migrations/20261028_product_add_ons.sql:400-438`, scheduled `20261008_order_lifecycle.sql:349-359` | cron (pg_cron) | `status='pending'` and expired | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] X3 |
| J-02 | Sweep carts | pg_cron daily 03:23 (`carts_sweep`) | `Store/supabase/migrations/20261120_shopping_cart.sql:131-164` | cron | **Not in production**: migration not applied, so no job | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [03] K4 |
| J-03 | Demo sales simulator | pg_cron `demo-sales-sim` every 20 min (`Store/supabase/migrations/20260801_demo_sales_sim.sql:485`); **enabled in prod, EUR, ticked today** (orchestrator facts) | `demo.sales_sim_tick()`: inserts `public.orders` **directly** with "plausible EU addresses" (`Store/supabase/migrations/20260927_demo_sales_sim_fulfilment.sql:10-12`, insert `:163`), marks shipped `:210`, prunes `:263`, `:268`; runs only while `demo.sales_sim.enabled` (`:20`); config currency default `'EUR'` (`20260801_demo_sales_sim.sql:108-110`) | cron (database, no app code) | none: no quote, no gate, no `order_place` | BYPASSES every choke point (CP-17, CP-18, CP-23, CP-24) | N | N | N | n/a | n/a | N | Decide before enforcement: disable the job, or point it at CZ addresses and CZK and flag its orders as simulated so reports and monitors can exclude them; an `orders` CHECK/trigger (CP-24 alternative) would make its inserts fail | [04] 4.2, [02] B11 |
| J-04 | Rate-limit key garbage collection | pg_cron `rate-limit-gc` hourly (`Store/supabase/migrations/20260807_db_hygiene.sql:68`) | `rl_gc_keys()` | cron | n/a | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [04] 4.2 |
| J-05 | Run due account deletions | GitHub Actions `scheduled.yml:44-75` daily, calling `POST /api/cron/account-deletions` | `Store/src/app/api/cron/account-deletions/route.ts:22-26`; `runAccountDeletions` `Store/src/lib/account-deletion/run.ts:344` (`auth.admin.deleteUser` `:318`) | cron secret | Grace period + buyer holds; cascades to `profiles`, `seller_payment_accounts`; the Stripe account itself is kept (`run.ts:38-39`) | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [01] H3, [04] 2.5 |
| J-06 | Moderation sweep and settle | GitHub Actions `moderation-sweep.yml:40-69` every 5 min, calling `POST /api/cron/moderation`; also `POST /api/moderation/check` (cron secret, used by the App Worker); dashboard renders settle the seller's products (`Store/src/app/(dashboard)/products/page.tsx:115`, `.../[id]/edit/page.tsx:55`, `Store/src/lib/products/settle-waiting.ts:21-44`) | `Store/src/app/api/cron/moderation/route.ts:29`; `Store/src/app/api/moderation/check/route.ts:65`; RPCs `moderation_due`/`moderation_settle` (`Store/src/lib/moderation/auto/check.ts:296`, `:439`) | cron secret, service role | Moderation columns only | none | n/a | n/a | n/a | n/a | n/a | n/a | none (settling can make a product visible again, but visibility still passes the read gates CP-3/CP-5) | [04] 2.5, 4.4; [02] P23 |
| J-07 | Review reminder emails | GitHub Actions daily, `POST /api/cron/review-reminders` | `Store/src/app/api/cron/review-reminders/route.ts:18`; `Store/src/lib/reviews/reminder-job.ts:87-233` | cron secret | `orders.review_reminder_*` | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [04] 2.5, [03] O9 |
| J-08 | Terms notice emails | GitHub Actions daily, `POST /api/cron/terms-notices` | `Store/src/app/api/cron/terms-notices/route.ts:17` | cron secret | Notice ledger (inferred) | none | n/a | n/a | n/a | n/a | n/a | n/a | R7 relevance: a CZ-only Terms version reaches existing sellers through this job (`docs/changing-the-terms.md`) | [04] 2.5 |
| J-09 | Agent token cleanup | GitHub Actions daily, `POST /api/cron/agent-cleanup` | `Store/src/app/api/cron/agent-cleanup/route.ts:13`; `Store/src/lib/agent/cleanup.ts:20` | cron secret | | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [04] 2.5 |
| J-10 | Storefront funnel rollup | GitHub Actions daily, `POST /api/cron/funnel-rollup` | `Store/src/app/api/cron/funnel-rollup/route.ts:20` | cron secret | `storefront_funnel_daily` (inferred) | none | n/a | n/a | n/a | n/a | n/a | n/a | none | [04] 2.5 |
| J-11 | Admin notification scan | pg_cron `admin-notification-scan` every minute: the migration only documents the schedule as a commented step (`Admin/supabase/migrations/0006_admin_notifications.sql:128-184`), but the job **is active in production** (orchestrator facts) | `admin_notification_scan_tick()`: `pg_net` POST to the Admin app | cron (database) | Writes none of the tables in scope | none | n/a | n/a | n/a | n/a | n/a | n/a | Candidate host for the monitoring check (a sibling job), see the gap analysis | [05] 5 |

### 3.13 Direct database writes (DB-)

| ID | Operation | Entry point(s) | Code (file:line) | Who | Validation today | Choke point | R1 | R2 | R3 | R4 | R5 | R6 | Where enforcement must attach | Src |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DB-01 | Update own `profiles` row directly, including `tax_country`, `tax_vat_id`, `seller_address`, `seller_email`, `seller_phone`, `username` | Any client with the user's JWT + public anon key (PostgREST PATCH) | RLS "Users can update their own profile" `Store/tests/db/prod-migrations.sql:102-108` (+ restrictive 2FA policy `Store/supabase/migrations/20260923_two_factor_auth.sql:74-109`) | PostgREST (owner, aal2 when enrolled) | DB only: `tax_country ~ '^[A-Z]{2}$'` or null (`prod-migrations.sql:261-262`; live in prod per the orchestrator's facts). Guards exist for seller text, contact proofs and avatar, **not** for country | BYPASSES CP-8 | N | n/a | n/a | n/a | n/a | n/a | DB trigger or CHECK on `profiles.tax_country` (and the new address-country column) against the allowed list, or make the column service-role-only like `tax_business_name` (`Store/supabase/migrations/20261012_auto_moderation.sql:735-777`); CP-2 must also re-validate country on read, as it already does for address and email (`Store/src/lib/settings/seller-identity.ts:88-120`) | [01] C2, BP1 |
| DB-02 | Insert/update/delete `products` directly (any column, including `currency`, `price_cents`, `status`) | PostgREST with the seller's JWT | RLS `products_*_writer` (owner or `products.write`) `Store/tests/db/prod-migrations.sql:909-942`; acknowledged in `Store/supabase/migrations/20261028_product_add_ons.sql:55-56`, `20261105_write_bounds.sql:1-14` | PostgREST (owner, editor) | Only CHECKs and triggers: `currency in ('EUR','USD')` default `'EUR'` (`prod-migrations.sql:157`, live in prod), `price_cents >= 0`; triggers for plan limit, object keys, add-ons, moderation, price history; **none checks currency, price or seller country** | BYPASSES CP-4, CP-10 | N | P | n/a | n/a | n/a | n/a | CP-12 (DB CHECK or trigger on currency, config-driven via an allowed-currency table); a trigger on `status -> active` re-running the seller rule; read gates CP-3/CP-14 stay the last line | [02] P24, B1; [01] BP4 |
| DB-03 | Insert/update `discounts` directly | PostgREST | Grants `select, insert` + column `update` incl. `currency` to authenticated (`Store/supabase/migrations/20261004_discounts.sql:127-170`); RLS writer = owner or `products.write` | PostgREST | CHECK `discounts_value` (amount currency EUR/USD) + `guard_discount_rules` | BYPASSES CP-15 | n/a | P | n/a | n/a | n/a | n/a | CP-12 (the `discounts_value` CHECK, made config-driven) | [02] D7, B2 |
| DB-04 | Price history row on product insert or change of `price_cents`/`currency` | trigger `record_product_price` | `Store/supabase/migrations/20261004_discounts.sql:249-296` (CHECK `currency in ('EUR','USD')` `:253`) | definer trigger (fires for every products writer) | CHECK | CP-12 | n/a | P | n/a | n/a | n/a | n/a | Must be widened in the same migration as `products.currency`, or every CZK product write fails inside the trigger | [02] D6 |
| DB-05 | Operator scripts (seed, reset, image updates, stock smoke) | Run by hand with `SEED_ENV=dev` + `SUPABASE_SERVICE_ROLE_KEY` + `TEST_SELLER_ID` (`Store/scripts/lib/env.ts:5-8`, `:58`, `:83`) | `Store/scripts/seed.ts` (storefront config `:252`, products `:285-290`, **orders `:331`**, signals `:350`); `Store/scripts/stock-smoke.ts:34-186` (`currency: "EUR"` `:60-61`, `:82-83`); `Store/scripts/reset-seed.ts:45`; `Store/scripts/reset-seeded-products.ts:39`, `:70-76`, `:134`; `Store/scripts/update-product-images.ts:59`; `STORE_CURRENCY = "EUR"` (`Store/scripts/lib/fake-data.ts:668-677`) | service role (dev-gated) | Nothing beyond DB constraints | BYPASSES all app choke points | N | N | N | n/a | n/a | N | DB constraints (CP-12, CP-24) only; a seed run against the production project is refused by `env.ts` unless `SEED_ENV=dev` is set, so this is an operator-discipline item | [04] 4.6, [02] P25 |
| DB-06 | Insert/update `storefronts` directly, including `config.embed.enabled`, `config.productPage`, `config.checkoutPage`, `config.cartPage` | PostgREST | Default table grants never revoked; RLS writer owner or `storefront.write` (`Store/tests/db/prod-migrations.sql:950-977`); only moderation, object-key and size guards (`Store/supabase/migrations/20261105_write_bounds.sql:49-55`) | PostgREST (owner, editor) | No money or geography in the table | BYPASSES CP-4 | N | n/a | n/a | n/a | n/a | n/a | Nothing at the DB needed if the read gates hold: CP-3 (storefront page, embed frame) and G8 (embed JSON) must carry the seller rule, because this path can switch an embed on with no write-side gate | [05] 2.2, [01] BP2 |
| DB-07 | Update other free `profiles` columns: `legal_accepted_version`/`_at`, `is_seller`, `locale`, onboarding flags, `deletion_requested_at` | PostgREST | RLS own-row update (`prod-migrations.sql:103-108`); `legal_accepted_version` length only (`:263-265`) | PostgREST (owner) | Shape only | BYPASSES `acceptLegal` (X-07) | n/a | n/a | n/a | n/a | n/a | n/a | R7 note only: a seller can record acceptance of a Terms version without the UI; if CZ-only Terms acceptance becomes a gate input, read it as evidence only or make the column service-role-written | [05] 2.2 |
| DB-08 | Anonymous waitlist insert | PostgREST with the anon key (Home form) | Policy `20260807_db_hygiene.sql:43-54`; insert-rate trigger 60/min (`20261105_write_bounds.sql:159-162`) | anonymous | email <= 254, source <= 64, `owner_id`/`list_id` null; **no country column** | none | n/a | n/a | n/a | n/a | n/a | n/a | R8: the country must be added here (column + policy) or on a new table; see S-06 | [05] 2.2, [01] I1 |


### 3.14 Other write paths with no rule relevance (X-)

Listed so the inventory is complete against the [04] checklist. None of these
touches seller country, currency, a delivery or billing address, or checkout;
every rule column is n/a, so the columns are collapsed.

| ID | Operation | Entry point(s) | Code (file:line) | Who | Note | Src |
|---|---|---|---|---|---|---|
| X-01 | Username (handle) | `UsernameForm.tsx:49`; MCP `update_username` (`Store/src/lib/agent/tools/store.ts:159-168`) | `updateUsername` `Store/src/lib/settings/actions.ts:144-184` | seller UI, MCP (owner) | Unique index + reserved-name CHECK | [01] B1 |
| X-02 | Bio | `BioForm.tsx:30`; MCP `update_bio` (`store.ts:171-180`) | `updateBio` `Store/src/lib/settings/actions.ts:198-225` | seller UI, MCP | Moderated; guarded column | [01] B2 |
| X-03 | Avatar set/remove | `AvatarUpload.tsx:18`; MCP `set_avatar`/`remove_avatar` (`store.ts:211-236`) | `uploadAvatar` `Store/src/lib/settings/avatar.ts:59`, `removeAvatar` `:138` | seller UI, MCP | Magic-byte sniff; `guard_avatar_url` trigger | [01] B3 |
| X-04 | Locale | `LocaleSelect.tsx:31`; on sign-in | `setLocale` `Store/src/i18n/actions.ts:23`; `Store/src/i18n/sign-in.ts:45-47` | seller UI | Relevant only to "Czech language" (locale is a UI choice, not a rule) | [01] B4 |
| X-05 | Notification preferences | Settings; MCP `save_notification_settings` (`store.ts:183-208`) | `saveNotifications` `Store/src/lib/settings/actions.ts:584-613` | seller UI, MCP | | [01] B5 |
| X-06 | AI typing switch | Product form | `saveSuggestAsYouType` `Store/src/lib/settings/actions.ts:623-630` | seller UI | | [01] B6 |
| X-07 | Accept Terms | `LegalSection.tsx:48`; welcome flow (`WelcomeFlow.tsx:122`) | `acceptLegal` `Store/src/lib/settings/actions.ts:399-422` | seller UI | R7 relevance only: the accepted Terms promise EU + US + CA (`Store/src/lib/settings/constants.ts:104-108`) | [01] B7 |
| X-08 | Onboarding flags | `OnboardingPanel.tsx:129`; designer tour | `Store/src/lib/onboarding/actions.ts:24-44`, `:62-77`, `:87-102` | seller UI | | [01] B8 |
| X-09 | Contact code send / confirm | `ContactVerification.tsx:54`; welcome flow | `Store/src/lib/contact-verification/actions.ts:27-76`; RPCs `issue_contact_verification`, `redeem_contact_verification` | seller UI (never MCP) | SMS only to `SMS_REGIONS` (EU + IS, LI, NO, CH, GB: `Store/src/lib/contact-verification/policy.ts:48-55`); CZ is inside | [01] C3, C4 |
| X-10 | Team: invite, accept, change role, revoke, switch active store | Settings > Team; bell; profile menu | `Store/src/lib/team/actions.ts:120-291`, `:300-326`, `:335-396`, `:404-475`, `:490-504`; RPC `team_accept_invite` (`Store/src/lib/team/accept.ts:97-100`) | seller UI | Note for R1: every gate uses the ACCOUNT (owner) id, so the owner's country is what a rule must read (`Store/src/lib/settings/seller-identity.ts:295-297`) | [01] D1-D5 |
| X-11 | Sign-in email change, password reset, magic link, MFA, passkeys, sign-in approvals | Login, Settings > Account/Security | `Store/src/lib/auth/actions.ts:276-347`, `:529-636`; `Store/src/lib/settings/actions.ts:235-384`; `Store/src/lib/auth/mfa-actions.ts`; `Store/src/lib/auth/sign-in-approval-actions.ts` | seller UI | Sign-in approval stores `cf-ipcountry` as a device location, not establishment (`sign-in-approval-actions.ts:108`) | [01] A3-A7 |
| X-12 | Seller plan checkout (platform bills the seller) | `PlansPage.tsx:100`, `UpgradeCard.tsx:94` | `startCheckout` `Store/src/lib/billing/actions.ts:118-171`; `ensureBillingCustomer` `Store/src/lib/billing/customer.ts:24-62` | seller UI owner (never MCP) | Reads `tax_country` for the platform's own invoice (`customer.ts:33-37`); priced in `BILLING_CURRENCY = "EUR"` (`Store/src/lib/billing/plans.ts:39`). Not a buyer price, so R2 does not apply; a CZ seller's plan stays EUR unless a separate decision changes it | [01] F1 |
| X-13 | Billing portal, cancel plan, resume plan | `PortalButton.tsx`, `CancelPlanDialog.tsx:153`, `KeepPlanButton.tsx:41` | `Store/src/lib/billing/actions.ts:190-250`, `:281-321`, `:331-374` | seller UI owner | | [01] F2-F4 |
| X-14 | Billing webhook and checkout-return sync | `POST /api/billing/webhook`; `/settings/billing?session=` | `Store/src/app/api/billing/webhook/route.ts:27-46`; `handleStripeEvent` `Store/src/lib/billing/webhook.ts:89-139`; RPC `billing_apply_snapshot`; `Store/src/lib/billing/checkout-return.ts:34-48` | webhook, seller UI | Platform subscription only | [01] F5, F6 |
| X-15 | End plan on deletion; request / cancel account deletion | Settings > Danger | `requestAccountDeletion` / `cancelAccountDeletion` `Store/src/lib/settings/actions.ts:643-727`; `endPlanForDeletion` `Store/src/lib/billing/lifecycle.ts:17` | seller UI (never MCP) | | [01] H1, H2, F10 |
| X-16 | Review visibility | MCP `set_review_visibility` (`Store/src/lib/agent/tools/reviews.ts:64`) | `setReviewVisibility` `Store/src/lib/reviews/actions.ts:38` (RPC `review_set_visibility` `:71`) | seller UI, MCP | | [04] 1.1 |
| X-17 | Buyer review post | `POST /api/products/[id]/reviews` | `Store/src/app/api/products/[id]/reviews/route.ts:79` (insert `:109-122`) | buyer with order link | | [04] 2.1 |
| X-18 | Review import / export / check | `POST /api/sellers/import-reviews`, `/check`, `GET /api/sellers/export-reviews` | `Store/src/app/api/sellers/import-reviews/route.ts:75`; `.../check/route.ts:33`; `Store/src/app/api/sellers/export-reviews/route.ts:41` | seller UI | `reviews`, `review_imports` (inferred) | [04] 2.2 |
| X-19 | Notifications read / all read / inline action | Bell; MCP `mark_notification_read`, `mark_all_notifications_read` (`Store/src/lib/agent/tools/notifications.ts:45`, `:56`) | `Store/src/lib/notifications/actions.ts:92`, `:152`, `:175` | seller UI, MCP | | [04] 1.1, 3.2 |
| X-20 | Moderation appeal / request review (seller side) | MCP `file_moderation_appeal`, `request_moderation_review` (`Store/src/lib/agent/tools/moderation.ts:8`, `:22`) | `fileModerationAppeal` `Store/src/lib/moderation/appeals.ts:68` (insert `:136`); `requestModerationReview` `Store/src/lib/moderation/review-request.ts:74` (flag `:98`, `:131`) | seller UI, MCP | Flag column on products/storefronts; no rule field | [04] 1.1 |
| X-21 | Public content report | `POST /api/report` | `Store/src/app/api/report/route.ts:131` (insert `:181`) | buyer (anonymous) | | [04] 2.1 |
| X-22 | Storefront signals and funnel points | Public page renders (`Store/src/app/(public)/s/[storefrontId]/page.tsx:69-71`, `.../p/[productId]/page.tsx:145-173`, checkout pages, embed frame `Store/src/app/(public)/e/[key]/[...sites]/page.tsx:90-92`), `GET /api/embed/[key]` (`Store/src/app/api/embed/[key]/route.ts:195`), cart route `after()` | `storefront_signals` | buyer | Analytics only | [04] 2.1, 4.4 |
| X-23 | Agent OAuth: register, token, revoke, consent, revoke app | `/oauth/register`, `/oauth/token`, `/oauth/revoke`, `/oauth/authorize` page | `Store/src/app/oauth/register/route.ts:22`, `Store/src/app/oauth/token/route.ts:37`, `Store/src/app/oauth/revoke/route.ts:24`; `Store/src/lib/agent/consent-actions.ts:48`, `:125`; every non-read tool call writes `agent_audit_log` (`Store/src/lib/agent/dispatch.ts:90-92`) | anonymous (RFC flows), seller UI | | [04] 2.3 |
| X-24 | Session activation | `/auth/callback`, `/auth/confirm` | `Store/src/app/(auth)/auth/callback/route.ts:25`, `Store/src/app/(auth)/auth/confirm/route.ts:17` | anonymous with Supabase code | Session cookie; account creation itself is S-01/S-02 | [04] 2.3 |
| X-25 | AI writing help credit hold/settle | Product form | `Store/src/lib/products/describe-actions.ts:110`, `:143` (credit `:92`, `:129`, `:163`) | seller UI | Saves no product field | [04] 3.1, [02] |
| X-26 | Uploads for product assets | `POST /api/uploads/image`, `/file`, `/document` | `Store/src/app/api/uploads/image/route.ts:51`, `.../file/route.ts:53`, `.../document/route.ts:56` | seller UI | R2 only; the product row changes through P-01/P-03 (see P-13) | [04] 2.2 |
| X-27 | Ops mail test, error reports, rate-limit tokens | `POST /api/ops/mail-test`; `instrumentation.ts`; every `rateLimit` call | `Store/src/app/api/ops/mail-test/route.ts:26`; `Store/src/instrumentation.ts:13-19`; `rl_take` | ops token, any | | [04] 2.5, 7 |
| X-28 | Uptime Worker | Cloudflare cron `* * * * *` (`Store/ops/uptime/wrangler.jsonc:19`) | `Store/ops/uptime/src/index.ts:80`, `:111`, `:130` | cron (separate Worker) | KV only, no database row, no Stripe | [04] 4.3 |
| X-29 | Other operator scripts | Run by hand | `Store/scripts/seed-reviews.ts` (via `Store/scripts/lib/fake-reviews.ts:397-401`), `Store/scripts/sweep-unused-uploads.ts:58`, `:98`, `Store/scripts/mirror-catalog-images.ts`, `Store/scripts/auth-emails.ts:269-302` | service role / Management API (dev-gated) | Reviews, R2 objects, Supabase Auth config; no rule field | [04] 4.6 |
| X-30 | App: update the shared `profiles` row (`username`, `is_public`, `avatar_url`) | `PATCH /api/profiles/me` | `App/worker/routes/profiles.ts:264-338` | App user session | Never touches `tax_*`, `seller_*`, `shipping_policy` | [07] 2.2 #7 |
| X-31 | App: collections, artifacts (incl. dormant `artifacts.product_id`), likes, follows, reports, interaction events | App worker `/api/*` | `App/worker/routes/collections.ts:45-155`; `App/worker/routes/artifacts.ts:68-348` (`product_id` from the body `:179`, SPA always sends null `App/src/lib/api.ts:336`, never read back `App/worker/lib/dto.ts:10-47`); `App/worker/routes/reports.ts:61-136`; `App/worker/routes/events.ts:108-149` | App user session; events unauthenticated with service role | No price, currency, address or checkout. If "shoppable artifacts" are ever built, `product_id` becomes a buyer path and must pass CP-3 | [07] 2.2, 4.2 |
| X-32 | Home: consent log and purchase-intent click counter | Cookie banner (also posted from Docs, `Docs/components/analytics/DocsAnalytics.tsx:44-55`); waitlist modal open | `Home/src/app/api/consent-log/route.ts:95`; `Home/src/components/WaitlistModal.tsx:55` (`purchase_intent_clicks`, `Home/supabase/migrations/20260925_purchase_intent_clicks.sql:9-23`) | anonymous | No country or currency | code (this merge), [08] 3 |
| X-33 | Platform plan price change | `plan_price_change(...)` RPC | `Store/supabase/migrations/20261011_pricing_config.sql:213-280` (hard-codes `'EUR'` and `_eur_v` keys `:254-265`) | service role | Seller subscription price, not a buyer price: R2 does not apply unless plan billing is also moved to CZK (an open decision, [09] 3.2) | [05] 3 |


---

## 4. Paths that bypass every choke point

The list the adversarial review should attack first. "Every choke point"
means the app-level validators (CP-4, CP-8, CP-10, CP-15, CP-17, CP-18, CP-20,
CP-23); some of these paths still meet a DB CHECK (CP-12) or a read gate
(RG-1 to RG-8), which is noted.

**12 paths bypass every app-level validator that would carry a rule:** DB-01,
DB-02, DB-03, DB-05, DB-06, J-03, O-11, AD-02, AD-03, SF-02, SF-03, P-08. Three
of them write orders and meet **no guard at all**, not even a DB CHECK:
J-03 (live in production), DB-05 and O-11. A further set passes some choke
points but skips the one that matters (P-06, P-10 to P-12, the lossy edits
P-03/P-04/P-05/P-07, O-03, RG-5 to RG-8, A-01, S-02, C-07). All are below.

| # | Path(s) | What it skips | Still stopped by | Real today? |
|---|---|---|---|---|
| BP-1 | DB-01: seller PATCHes own `profiles.tax_country` (and address, email, VAT, phone) over PostgREST | CP-8, step-up, rate limit | DB shape check `^[A-Z]{2}$` only | Yes: any two capital letters (`Store/tests/db/prod-migrations.sql:102-108`, `:261-262`) |
| BP-2 | DB-02: seller or editor writes `products` directly: `currency` (EUR/USD), any `price_cents >= 0`, `status='active'`, or flips `digital_file_key` (physical to digital, so R3 becomes R4) | CP-4, CP-10, moderation precheck, rate limits | CP-12 (EUR/USD), moderation/object-key/add-on triggers; read gates RG-1 to RG-3 | Yes ([05] 2.3) |
| BP-3 | DB-03: direct `discounts` insert/update | CP-15 | CP-12 `discounts_value` | Yes (EUR/USD only) |
| BP-4 | DB-06: direct `storefronts` update, including `config.embed.enabled` and page switches | CP-4, CP-27, CP-28 | Read gates RG-3, RG-5 | Yes |
| BP-5 | J-03: demo sales simulator inserts `orders` directly every 20 minutes | Everything: no quote, no gate, no `order_place`; currency from its own config (`cfg.currency`, `Store/supabase/migrations/20260927_demo_sales_sim_fulfilment.sql:177`), not from the product; ship-to drawn from 10 countries, 9 not CZ (`:55-66`); also writes `pending` orders with no expiry (`:155-158`) | Nothing (no CHECK on `orders.currency` or `ship_to`) | **Yes, live in production** (enabled, EUR, ticked 2026-11-22) |
| BP-6 | DB-05: operator scripts (`seed.ts` inserts orders `:331`, products `:285-290`) | Everything app-side | CP-12 for products only | Dev-gated (`SEED_ENV=dev`); real only if run against production |
| BP-7 | O-11: dev `/dev/simulate-sale` calls `recordPaidOrder` with IE/DE/FR/NL addresses | CP-17, CP-18 | CP-23 only (seller match) | Dev builds only (`Store/next.config.ts:175`) |
| BP-8 | AD-02, AD-03: Admin restore / approve / appeal overturn sets `moderation_status='ok'` with the service role | Every write gate; no market-rules check | Read gates (CP-3, CP-5, CP-14) once they carry the rules | Yes, by staff |
| BP-9 | SF-02 (`saveStorefront`, UI + MCP `save_storefront` free-form `config` + `edit_storefront`) and SF-03 (`pageConfigRoute`, UI + 3 MCP tools in process) switch the embed and pages on | CP-4 | Read gates RG-3, RG-5 | Yes ([01] BP2, BP3) |
| BP-10 | P-06: `setProductStatus` re-publishes a stored row | CP-10 (currency never re-checked) | CP-4 (identity only) | Yes: a EUR product re-publishes after the rule ships |
| BP-11 | P-08: `duplicateProduct` copies raw `currency`/`price_cents` | CP-10 | CP-12 | Yes (draft result) |
| BP-12 | P-10, P-11, P-12: partial updates (stock, badges, add-ons) | CP-10 | CP-12 | Harmless for the rules today; they matter because a NOT VALID CHECK fires on them (hazard H3) |
| BP-13 | P-03, P-04, P-05, P-07: edits that re-send a currency read through the lossy mapper CP-13 | n/a (they pass CP-10) | CP-10 | Yes: once CZK is storable, an edit can rewrite CZK as EUR unless CP-13 changes first |
| BP-14 | O-03: payment confirmation after a pending window (31 min Stripe page, 45 min hold) | All rules are checked only at C-01/C-02 | Amount and currency equality only | Yes (TOCTOU, [03] Q4) |
| BP-15 | RG-5 to RG-8 call CP-1 directly instead of CP-3 | CP-3 | CP-1 | Yes: diverges the day CP-3 alone gains a rule |
| BP-16 | A-01: an existing Stripe account is returned unchecked; A-02/A-03 never store the account country | CP-7 country logic | nothing | Latent: Connect is off, 0 accounts in production |
| BP-17 | Service-role writers that existing guard triggers exempt: SH-01 (`shipping_policy` via service role), O-01 (`order_place`), J-03, AD-02 | Any trigger shaped like `guard_object_keys` (`auth.role() <> 'authenticated'` returns early) | n/a | Design trap for the build ([05] 7.3): a compliance trigger must bind the service role |
| BP-18 | S-02: Google OAuth sign-up | The sign-up form (where a country question would live) | CP-1 at first publish | Yes |
| BP-19 | C-07 cart with `adding:false`: a cart can be viewed, changed and paid after the seller switched the cart off (`Store/src/lib/cart/route.ts:17-24`, `:35-39`) | n/a | C-02 re-quotes | Not live (no `carts` table in production) |

Also met on the way, not bypasses: team members cannot write the owner's
identity (S-03 writes `user.id` only), and every gate reads the account
owner's row (`Store/src/lib/settings/seller-identity.ts:295-297`), so a team
member cannot launder a country. Checkout routes are same-origin only
(`Store/src/lib/checkout/place-order.ts:102`), so the embed on a foreign site
can never POST an order directly; it links to the hosted pages, which re-gate.

---

## 5. Repos with no relevant write path

Stated with evidence so nobody has to re-check.

| Repo | Verdict | Evidence |
|---|---|---|
| **App** (SQ-app, HEAD `b580143` + 28 uncommitted entries) | No relevant write path. No Stripe dependency, no price, currency, product, storefront, cart, checkout, order or refund code, no link or embed to Store buyer pages, no sign-up (redirects to Store's login), no country or currency logic, English only. Its writes (X-30, X-31) touch the shared `profiles` row (`username`, `is_public`, `avatar_url` only), its own curation tables, `reports` and `interaction_events`. The dormant `artifacts.product_id` is written from the body but never read or shown. The Worker is not bound to a hostname | `App/package.json:15-33`; `App/src/lib/config.ts:44-48`; `App/worker/routes/profiles.ts:264-338`; `App/worker/routes/artifacts.ts:174-192`; `App/src/lib/api.ts:336`; `App/worker/lib/dto.ts:10-47`; `App/wrangler.jsonc` (no `routes`), `App/CUTOVER.md:130-143`; [07] sections 0, 2.3, 3, 9 |
| **Docs** (SQ-docs) | No write path at all. A static export served by a Hono worker; its route handlers only serve content (`llms.txt`, search index, Markdown, OG images, robots); the only POST is the cookie-consent record sent to Home's `/api/consent-log`. "Get started" links to Home's waitlist. Copy is R7 work only | `Docs/worker/index.ts:1-40`; route files under `Docs/app/` (`[lang]/llms-full.txt`, `[lang]/llms.txt`, `api/search.json`, `llms.txt`, `md/[lang]/[[...slug]]`, `og/[lang]/[...slug]`, `robots.txt`); `Docs/components/analytics/DocsAnalytics.tsx:44-55`; `Docs/lib/site.ts:26-32` (checked in this merge with `git ls-files` and `git grep`) |
| **Home** (SQ-home) | One relevant writer: the waitlist (S-06, DB-08), relevant to R8 only. Otherwise only `consent_logs` and `purchase_intent_clicks` (X-32). No server actions, no seller, product, price or order writes. Copy (Terms, Privacy, pricing, homepage) is R7 work; Terms changes follow `docs/changing-the-terms.md` | `Home/src/app/api/waitlist/route.ts:62-101`; `Home/src/app/api/consent-log/route.ts:95`; `Home/src/components/WaitlistModal.tsx:55`; the third route `Home/src/app/dev/files/[...path]/route.ts` is development-only and reads files; no `"use server"` file in the repo (checked in this merge) |
| **Admin** (SQ-admin, HEAD `48cbbb0`) | No write path to seller identity, country, prices, currencies, storefront content, orders, refunds, payment accounts or plan prices; no Stripe. Relevant only through restore (AD-02, AD-03), which can relist a non-compliant item, and as the host for a market-rules view. Revenue is EUR-only (`admin_revenue_summary`, `formatEuros`) | `Admin/package.json:12-23`; [06] sections 0, 3; `Admin/supabase/migrations/0008_plans_revenue.sql:51`; `Admin/src/lib/format/money.ts:1-7` |
| **SQ-system** (shared packages) | No database writes and no SQL; no package holds a country, EU, currency or locale list. Store and Admin consume no package; the registry route has been blocked since July 2026 | [09] sections 0, 1.2, 1.3 |
| **Store `ops/uptime` Worker** | Writes KV only (X-28) | `Store/ops/uptime/src/index.ts:80`, `:111` |

Entry points in Store checked by [04] and found to write nothing (no row
needed): `/api/orders/lookup` (email only), `/api/orders/[orderRef]/download`,
`/api/og/p/[productId]`, `/api/billing/plan-prices`, `/api/csp-report` (log
line), `/offline`, `/api/orders/export`, `/api/products/[id]/photo`,
`/api/moderation/decisions/[id]/statement`, `/api/notifications/bootstrap`,
`/api/search`, `/api/search/snapshot`, `/api/settings/username-available`,
`/settings/export`, the three `/.well-known/*` routes, `/dev/outbox`,
`/dev/embed-host`, `/dev/ai-writing/*`, the 30 MCP read tools, and
`Store/src/middleware.ts` (decides nothing, nothing geographic: `:9-13`).

---

## 6. Disagreements settled, and what is still unknown

### 6.1 Disagreements between reports

| # | Topic | What the reports say | Settled by | Verdict |
|---|---|---|---|---|
| 1 | Which `order_place` is live | [02], [03], [09] cite `20261120_shopping_cart.sql:171-336` (currency `:220`) as "latest"; [05] says the applied one is `20261028_product_add_ons.sql:183-342` (currency `:231`) | Production facts: `public.carts` does not exist, so 20261120 is not applied. Both bodies contain the same `coalesce(incoming.currency, 'EUR')` (grep of `Store/supabase/migrations`: `20261008:169`, `20261011:465`, `20261022:48`, `20261028:231`, `20261120:220`) | [05] is right for production, [03] for the repo. Any rebuild of `order_place` must start from the 20261120 body and be applied after it (hazard H4) |
| 2 | pg_cron jobs in production | [04] lists 4 (demo-sales-sim, rate-limit-gc, orders-release-expired, carts-sweep); [05] and [06] say `admin-notification-scan` is a commented, by-hand step and unknown | Production facts: active jobs are admin-notification-scan, demo-sales-sim, orders-release-expired, rate-limit-gc; no carts-sweep | Production has 4 jobs, but not [04]'s 4: J-11 is live, J-02 does not exist |
| 3 | Whether the demo simulator runs | [04] and [05]: unknown whether `demo.sales_sim.enabled` is on | Production facts: enabled, EUR, ticked today; 1,037 simulator orders | J-03 is a live writer that every rule, report and monitor must account for |
| 4 | What the demo simulator writes | [02] P25/B11 lists it as a writer of "products / orders" | Code: it inserts `public.orders` (`Store/supabase/migrations/20260801_demo_sales_sim.sql:325`, `20260927_demo_sales_sim_fulfilment.sql:163`), updates orders to shipped (`:210`) and inserts `storefront_signals` (`20260830_demo_sales_sim_signals.sql:181`); it only READS active products (`20260927_demo_sales_sim_fulfilment.sql:111-118`) and takes the order currency from its own config, not the product (`:177`) | [04]/[05] are right; [02]'s "products" is wrong. Consequence: CZK products would still get EUR simulator orders unless `demo.sales_sim.currency` is changed too |
| 5 | Which order writers bypass the quote | [03] Q3 lists only the dev simulator, payment confirmation and service-role RPC calls; [03] headline 1 says there is one order pipeline | [04] 4.2 and [05] headline 7 name the pg_cron simulator, which [03] does not mention | [03]'s list is incomplete; J-03 is the second order writer, and the only live one outside checkout |
| 6 | Whether MCP `update_product` reaches `setProductStatus` | [01] G3 lists MCP `update_product` beside `setProductStatus` | Code: `update_product` calls `updateProduct` (`Store/src/lib/agent/tools/products.ts:209-225`); the link in [04] 3.1 is the registry's classification column, not a call | [02] is right: MCP status changes go through `updateProduct`, which runs CP-10 and CP-4. P-06 is UI-only |
| 7 | Production seller-country data | [01] 6/7: memory says 3 of 11 sellers set a country (unverified) | Production facts: 15 profiles; CZ x2, IE x1, unset x12 | 3 of 15 set; one seller with products is IE |
| 8 | Connected accounts | [01] 7.2 and [05] 9: unknown, inferred none | Production facts: `seller_payment_accounts` 0 rows; every order `payment_ref` NULL | No live connected account and no real payment: pinning the Stripe country is a pre-launch change, no migration of accounts |
| 9 | Has anyone accepted `tos-2026-11-06` | [08] 7.1: "agreements are likely" | Production facts: `legal_accepted_version` tos-2026-11-06 x2, tos-2026-10-11 x2, none x11 | Accepted, so it cannot be withdrawn with `replacedBy`; the CZ-only Terms must be a new version that runs the 30-day notice |
| 10 | Base table CHECKs | [01], [02], [05] read `products.currency` and `profiles.tax_country` CHECKs from the replay file and could not confirm production | Production facts: `products.currency` and `product_price_history.currency` in (EUR, USD); amount discounts EUR/USD; `tax_country` null or two capitals | Replay matches production for these |
| 11 | pg_cron installed at all | [03] Q6: unknown whether `orders_release_expired` runs | Production facts: `orders-release-expired` active | It runs |

No other factual conflicts were found between the nine reports: the file:line
citations for the shared objects (CP rows) agree across [01] to [05] and [09]
within a line or two (function versus schedule ranges, for example carts-sweep
`20261120_shopping_cart.sql:131-164` in [03] and `:154-164` in [05]).

### 6.2 Still unknown

1. **Stripe behaviour** (outside the code): what Stripe does with an Express
   account created without `country`; whether the platform's Connect settings
   restrict onboarding countries; Stripe's CZK minimum charge and payout rules
   ([01] 7.1, [02] 11, [03] Q6).
2. **Production RLS and grants beyond the replay file.** SQ-app migrations sit
   in the production ledger with no repo copy and could change policies on
   `products`, `storefronts`, `team_members` ([05] 6, 9).
3. **Whether the Before User Created hook is enabled** in production (S-01/S-02;
   [01] 7.4).
4. **Production env switches**: `NEXT_PUBLIC_STRIPE_CONNECT_ENABLED` (off per
   the facts), `CART_ENABLED`, `EMBED_CART_API`, Turnstile, mail; and Home's
   `NEXT_PUBLIC_SELLER_SIGNUP_OPEN` ([03] Q6, [08] 7.2).
5. **Caching of hosted storefront and product pages**: only the embed JSON's
   5-minute CDN cache is documented (RG-5); whether page HTML is cached, and
   for how long after a seller stops passing a rule, was not traced.
6. **Whether checkout refuses a banned seller** (AD-05): inferred not ([06] 8.4).
7. **The internals** of `getEmbedFrame`, `openStorefront` and the upload
   routes were described from call sites only ([03] Q6, [02] 11).
8. **Which account the demo simulator writes for** is in `demo.sales_sim`
   (query in [05] 8.0); the orchestrator's facts identify it as seller (1).
9. **Product decisions, not code facts**: whether `tax_country` is the R1
   "business address country" or a new structured column is added; whether
   seller plan billing (`BILLING_CURRENCY = "EUR"`) moves to CZK; what the
   `"*"` destination should mean under a CZ-only list.
