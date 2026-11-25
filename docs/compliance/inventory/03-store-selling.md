# 03 Store: SELLING write-path inventory (part 3 of 9)

Scope: shipping policies, purchase gate and price authority, checkout and payment providers, cart, orders, refunds and withdrawal, the payments webhook and sweeps, buyer entry points, and collab checkout, in `C:\Squareshare\Store` only.

Method: read-only. Every claim cites `Store/<path>:<line>` from code opened during this pass (2026-11-22, HEAD `e43eedd`, clean tree). Anything not opened is marked (inferred). Memory notes were used only as leads; where they disagree with the code, the code wins and the drift is listed in section 13.

Conventions: "service role" = `createAdminClient()` (bypasses RLS). "Anonymous buyer" = no session; the credential is a rate limit, a same-origin check, Turnstile (when configured) or an HMAC order link.

---

## 0. Headline findings

1. **There is exactly one buyer-facing order pipeline**: two POST routes (`Store/src/app/api/checkout/[storefrontId]/[productId]/route.ts:22`, `Store/src/app/api/checkout/[storefrontId]/route.ts:19`) both call `placeOrderResponse` (`Store/src/lib/checkout/place-order.ts:89`), which calls `quoteOrder` (`Store/src/lib/checkout/quote.ts:158`) before any provider. Embed, buy button, hosted product page and cart all end at those two routes. No other repo writes `orders` (grep of Admin and App for `"orders"` / `order_place` found nothing).
2. **The only platform-level delivery-country check on the server is a Zod enum** on the request body: `shipTo.country: z.enum(SHIPPING_COUNTRY_CODES)` (`Store/src/lib/validation/checkout.ts:41`), i.e. the 27 EU states + US + CA hard-coded in `Store/src/lib/settings/constants.ts:129-136`. Beyond that, the seller's own priced destination rows decide (`Store/src/lib/shipping/rates.ts:139-207`), and a seller's `"*"` catch-all row admits every one of the 29 codes. Nothing in the database constrains `orders.ship_to.country` (`Store/supabase/migrations/20260927_order_fulfilment.sql:87-93` checks only "is an object" and size).
3. **Stripe is told nothing about addresses or countries.** The Checkout Session (`Store/src/lib/checkout/stripe-provider.ts:122-168`) sends no `shipping_address_collection`, no `billing_address_collection`, no allowed countries, no `automatic_tax`. The webhook (`Store/src/lib/payments/connect/webhook.ts:177-215`) reads no `customer_details`, no billing address and no card country. **No billing country is collected or stored anywhere** for any order (grep for `billing_country|buyer_country|card_country|billing_address|billing_details` finds only the seller-subscription Billing flow and a CSV column derived from `ship_to.country`, `Store/src/lib/orders/csv.ts:52,81`). R4 has no foothold today.
4. **No seller-country check exists anywhere in the selling path.** The gate (`Store/src/lib/products/purchasable.ts:215-348`) checks storefront, placement, status, ownership, takedown and the trader-identity publish gate (`sellerMaySell`, `Store/src/lib/settings/seller-identity.ts:128-132`), which never looks at `tax_country`. `seller_payment_accounts` stores no Stripe account country (`Store/supabase/migrations/20261008_seller_payment_accounts.sql:33-45`; `Store/src/lib/billing/stripe-api.ts:110-115`). The Stripe account is created with `country: tax_country` only when one is set (`Store/src/lib/payments/connect/account.ts:158`, `Store/src/lib/payments/connect/actions.ts:65`).
5. **Currency is EUR or USD only, and `toCurrency` silently maps anything else to EUR** (`Store/src/lib/format/money.ts:12-14`). The quote, the cart, the Stripe session currency and the order currency all derive from `toCurrency(row.currency)` (`Store/src/lib/checkout/quote.ts:254`, `Store/src/lib/checkout/stripe-provider.ts:106`). Adding CZK to the DB without changing `toCurrency` would quote, display and charge CZK prices as euros. At least 8 other places pin EUR/USD (section 11, Q5).
6. **The stored shipping policy is all-or-nothing on read.** There is no `parseShippingPolicy`; the reader is `buildShippingPolicy` (`Store/src/lib/settings/shipping-policy.ts:50-60`), which runs the strict write schema and returns `{}` on ANY failure. A stored destination naming a country removed from `SHIPPING_COUNTRY_CODES`, a `shipsFrom` outside `OPERATING_COUNTRY_CODES`, or a `ratesCurrency` outside `CURRENCIES` empties the WHOLE policy, including returns window and texts, which silently drops physical products out of checkout and shortens buyers' withdrawal windows on existing orders (section 1.3).
7. **Nothing is re-validated between the pending order and payment confirmation** (up to 31 min Stripe page, 45 min hold). `order_confirm_paid` only flips `pending -> paid` (`Store/supabase/migrations/20261008_order_lifecycle.sql:226-260`); the webhook only checks amount and currency match the order (`Store/src/lib/payments/connect/webhook.ts:73-83,198`).
8. **No collab / multi-seller checkout exists.** Carts, the gate, the quote and the order writer are all structurally single-storefront, single-owner (section 9).

---

## 1. Shipping policies

### 1.1 Schema

Stored as one jsonb column `profiles.shipping_policy` (`Store/supabase/migrations/20260905_shipping_policy_on_profile.sql:41`), DB CHECK only "null or an object of at most 16 KB" (`...20260905_shipping_policy_on_profile.sql:49-56`). Direct writes of the column by a session are refused by the moderation trigger (`Store/supabase/migrations/20261012_auto_moderation.sql:749-764`), so only the service role writes it.

TypeScript shape: `SellerShippingPolicy` (`Store/src/types/shipping-policy.ts:38-84`). Write boundary: `shippingPolicySchema`, a strict object all the way down (`Store/src/lib/validation/shipping-policy.ts:67-138`).

| Field | Type / bound | Country or currency role | Cite |
|---|---|---|---|
| `shipsFrom` | string, must be in `OPERATING_COUNTRY_CODES` (EU+US+CA) | country (display "Ships from X"; default start country of the checkout picker) | `Store/src/lib/validation/shipping-policy.ts:71-76`; `Store/src/components/checkout/CheckoutView.tsx:144-149` |
| `ratesCurrency` | `z.enum(CURRENCIES)` = EUR, USD; absent means EUR | THE currency every rate and `freeOverCents` is in | `Store/src/lib/validation/shipping-policy.ts:79`; `Store/src/types/product.ts:12`; `Store/src/lib/shipping/rates.ts:118,149` |
| `freeOverCents` | int 0..PRICE_CENTS_MAX, 0 dropped | in `ratesCurrency` | `Store/src/lib/validation/shipping-policy.ts:83-87,195-198` |
| `dispatch`, `shippingNotes`, `shippingText` | text | none | `...shipping-policy.ts:88-107` |
| `destinations[]` (max 6) | `{area, time, cost?, countries?, rateCents?}` | `countries`: unique list of `z.enum([...SHIPPING_COUNTRY_CODES, "*"])`; `rateCents` 0..100000 in `ratesCurrency` | `...shipping-policy.ts:44-65,92-97`; `Store/src/types/shipping-policy.ts:87-106,111,115,131` |
| `returnsWindowDays`, `returnsPaidBy`, `returnsNotes`, `returnsText` | int 0..365, enum, text | none (but `returnsWindowDays` feeds the statutory withdrawal window) | `...shipping-policy.ts:112-130`; `Store/src/lib/orders/withdrawal.ts:44` |
| `profiles[]` | named exception profiles, may carry `rateCents` override | rate in `ratesCurrency`; cannot widen eligible countries | `...shipping-policy.ts:137`; `Store/src/lib/shipping/rates.ts:129-133,184-190` |

A destination row is PRICED (quotable) only when it has both `rateCents` and at least one country (`Store/src/lib/shipping/rates.ts:56-62`). Rows without both are display-only.

### 1.2 Write paths

| # | Entity / op | Entry point(s) | Code | Validation today | DB written | Authz | Country / currency fields |
|---|---|---|---|---|---|---|---|
| S1 | Replace shipping policy | Settings > Shipping & returns form (server action) | `saveShippingPolicy` `Store/src/lib/settings/shipping-actions.ts:71-123` | only field `policy` allowed (:78-83); 64 KB cap (:86); JSON parse (:89-93); `compactShippingPolicy` then strict `shippingPolicySchema` (:98, `Store/src/lib/validation/shipping-policy.ts:159-250`); rate limit `settings_write` (:101); seller-text moderation (:110-111) | `profiles.shipping_policy` via `writeOwnProfile` (session update first for RLS, then service role for the guarded column) `Store/src/lib/moderation/auto/seller-text.ts:96-131` | signed-in user, writes OWN profile row (`user.id`), never the active team account (`Store/src/app/settings/shipping/page.tsx:16-26`) | `shipsFrom`, `destinations[].countries`, `ratesCurrency`, all rates |
| S2 | Replace shipping policy | MCP tool `save_shipping_policy` | `Store/src/lib/agent/tools/storefronts.ts:426-440` | `shippingPolicySchema.safeParse(policy)` (:436), then calls S1 through `formDataFrom` (:438), so S1's checks run again | same as S1 | MCP scope `storefronts:write`, permission `storefront.write`, `ownerOnly: true` (:430-432); S1 then writes the signed-in user's own row | same as S1 |
| S3 | Read for MCP | MCP tool `get_shipping_policy` | `Store/src/lib/agent/tools/storefronts.ts:211-223` | none (read) | none | `store:read` | returns `buildShippingPolicy` output (so a non-parsing policy reads as `{}`) |

No API route writes the policy. No other writer found (grep for `shipping_policy` in `src` and migrations).

### 1.3 Read helpers, and the "whole policy dropped" behaviour (confirmed)

- There is no function called `parseShippingPolicy` in the repo (grep). The reader is `buildShippingPolicy` (`Store/src/lib/settings/shipping-policy.ts:50-60`): `shippingPolicySchema.safeParse(row.shipping_policy)`; on failure it logs and returns `EMPTY_SHIPPING_POLICY` (`{}`, `Store/src/types/shipping-policy.ts:150`). The comment says so explicitly (`...shipping-policy.ts:42-49`).
- Callers: `getShippingPolicy` (service role, `...shipping-policy.ts:69-81`), `getAccountShippingPolicy` (React-cached, `:89-93`), the gate (`Store/src/lib/products/purchasable.ts:341`), the hosted storefront page quick add (`Store/src/lib/storefront/storefront-page.ts:307-308`), the MCP preview (`Store/src/lib/agent/preview/product-page-preview.ts:117`), dashboard queries (`Store/src/lib/dashboard/queries.ts:611,640`), the withdrawal route (`Store/src/app/api/orders/withdraw/route.ts:71`), the order page and confirmation email (`Store/src/lib/orders/order-page.ts:158`, `Store/src/lib/orders/confirmation.ts:59`).
- Why one bad value kills everything: the schema is `z.strictObject` and destination countries are `z.enum(DESTINATION_COUNTRY_VALUES)` built from `SHIPPING_COUNTRY_CODES` (`Store/src/lib/validation/shipping-policy.ts:44-59`); `shipsFrom` is refined against `OPERATING_COUNTRY_CODES` (`:71-76`); `ratesCurrency` is `z.enum(CURRENCIES)` (`:79`). A single out-of-list code in any row fails the whole parse.
- Consequences if the country list is narrowed (for example to `["CZ"]`) without migrating stored data:
  1. `canQuoteShipping` becomes false (no priced rows), so `checkoutAvailableFor` is false for every physical product (`Store/src/lib/checkout/availability.ts:92-111`), product pages fall back to the seller link or enquiry email, and any cart line becomes `no_shipping_rates` (`Store/src/lib/checkout/quote.ts:257-259`). Fails closed for selling, which is safe but silent.
  2. Returns window and texts disappear from product pages and confirmation emails.
  3. The withdrawal function on EXISTING orders recomputes with `returnsWindowDays` absent, so a seller who promised 30 days is cut to the statutory 14 (`Store/src/lib/orders/withdrawal.ts:44`, called with the re-read policy at `Store/src/app/api/orders/withdraw/route.ts:71-72` and the order page). This is a consumer-law regression on past sales.
  4. The Settings page loads `{}` (`Store/src/app/settings/shipping/page.tsx:26`), so the seller sees blank terms; saving overwrites the stored jsonb (the old value is still in the DB until then).
  5. The same happens if a currency is removed from `CURRENCIES` while a policy uses it.

### 1.4 How a delivery quote is produced

All pure, client-safe, in `Store/src/lib/shipping/rates.ts`; the same functions run in the browser preview (`Store/src/components/checkout/CheckoutForm.tsx:278-285`) and on the server.

| Function | Rule | Cite |
|---|---|---|
| `shippingCountries(policy)` | codes on priced rows, plus `anywhere` if any priced row has `"*"` | `rates.ts:85-105` |
| `canQuoteShipping(policy, currency)` | false unless `currency === (ratesCurrency ?? "EUR")` AND at least one priced row | `rates.ts:114-121` |
| `quoteShipping(policy, {profileId, country, subtotalCents, currency})` | `currency_mismatch` if currencies differ (:151-153); `no_rates` if no priced rows (:157-159); first priced row naming the country (case-insensitive) wins, else first priced `"*"` row (:162-175); else `not_shipped_here` (:177-179); a profile `rateCents` replaces the amount only (:184-190); `freeOverCents` forces 0 (:194-199) | `rates.ts:139-207` |
| `quoteOrderShipping` | one parcel: quotes every distinct profile with the whole shipped subtotal, refuses if any refuses, charges the highest | `rates.ts:216-238` |
| `deliveryPriceRange` | "from" price before a country is known | `rates.ts:250-270` |

Note: `quoteShipping` with `country = ""` still matches a `"*"` row (no direct match, falls to catch-all, `rates.ts:171-175`). The server passes `request.country ?? ""` (`Store/src/lib/checkout/quote.ts:398`) and only afterwards refuses a parcel order with no `shipTo` (`Store/src/lib/checkout/place-order.ts:164`), so this is not exploitable today, but a refactor that drops the later check would be.

---

## 2. Purchase gate and price authority

| Function | Status | What it re-reads / re-validates on the server | Cite |
|---|---|---|---|
| `gatePurchasableLines(storefrontId, productIds, limit)` | THE gate for many lines (cart, quote, discount check, cart checkout page) | UUID shape (:222-223); rate-limit token, fail-closed (:227-230); storefront exists (:233-242); `openStorefront` (not taken down, product pages on) (:248-249); each product placed as a tile or offered as a tile's add-on (:257-270, :432-462); products `status='active'` AND `owner_id = storefront.owner_id` (:276-284); product not taken down (:305, :353-357); seller trader identity complete (`sellerMaySell`, fail-closed) (:321-322); store sales readable (:330); returns shipping policy parsed via `buildShippingPolicy` (:341). **Does not check: seller country, Stripe account country, currency allowlist, buyer country.** | `Store/src/lib/products/purchasable.ts:215-348` |
| `gatePurchasable` | single-product wrapper, used by product page and Buy-now checkout page | as above, `stopWhenNonePlaced` | `purchasable.ts:178-190`; callers `Store/src/lib/products/public.ts:220`, `Store/src/lib/checkout/page.ts:34` |
| `loadPurchasable` | exported, **no callers** (grep) | same as `gatePurchasable` with busy folded into null | `purchasable.ts:163-171` |
| `loadStoreItems` | extra products under an already-passed gate ("Goes well with") | placement, active, owner, takedown | `purchasable.ts:380-410` |
| `checkoutProviderFor(ownerId)` | which provider may take this seller's money | `ORDER_LINK_SECRET` present (:74); `test` only when `NODE_ENV=development` and `CHECKOUT_TEST_PAYMENTS=1` (:41-43, :75); `stripe` only when Connect live AND Turnstile (in production) AND mail (:61-64, :76) AND the seller's account has `charges_enabled` in this key's mode (:80; `Store/src/lib/payments/connect/account.ts:102-104`). **No account-country check.** | `Store/src/lib/checkout/availability.ts:73-83` |
| `canPriceDelivery` / `checkoutAvailableFor` | whether a product gets a checkout at all | digital, or `canQuoteShipping` in the product's currency; then a provider | `availability.ts:92-111` |
| `quoteOrder(request, limit)` | THE price authority for every order | 1..CART_LINES_MAX lines (:159-161); the gate (:162-167); a discount code looked up afresh (:169-183); then `quoteFromLines` | `Store/src/lib/checkout/quote.ts:158-185` |
| `assessLines(gate, lines)` | per-line sellability, shared by quote, cart and quick add | product in gate and not sold via the seller's own link (:239-241); tile `soldOut` (:245); integer quantity >= 1 (:247-249); exact option selection (:250-252); physical line needs `canQuoteShipping` in its currency (:257-259); ONE currency per order, the first sellable line's, others refused `currency` (:273-279); stock and per-order cap summed per product via `checkOrderQuantity` (:282-307) | `quote.ts:231-308` |
| `priceAssessedLines` / `priceLines` | prices from `row.price_cents`, best running sale, code | currency from the first sellable line, fallback `"EUR"` (:330) | `quote.ts:326-371`; `Store/src/lib/discounts/pricing.ts:213` |
| `quoteFromLines(gate, {lines, country}, code)` | assess, price, then delivery | refuses first bad line (:384-389); if anything ships, `quoteOrderShipping` with `request.country ?? ""` in the order currency, `not_shipped_here` or `no_shipping_rates` (:393-410); total = items + shipping (:425) | `quote.ts:379-428` |
| `checkOrderQuantity` | the stock / cap rule on a row already read | refuses, never clamps; `currency: toCurrency(row.currency)` | `Store/src/lib/products/order-quantity.ts:156-181` |
| `resolveOrderQuantity` | exported, **no callers** (grep); the quote uses `checkOrderQuantity` | re-reads `id, status, price_cents, currency, track_stock, stock_quantity, max_per_order` | `order-quantity.ts:119-141` |
| `quoteCheckout` | **does not exist** (grep); renamed `quoteOrder` | n/a | n/a |

---

## 3. Checkout: starting a payment

### 3.1 Routes

| # | Entity / op | Entry point | Code | Validation today | DB written | Authz | Country / currency |
|---|---|---|---|---|---|---|---|
| C1 | Place "Buy now" order (+ add-ons) | `POST /api/checkout/[storefrontId]/[productId]` | `Store/src/app/api/checkout/[storefrontId]/[productId]/route.ts:22-42` | 8 KB body (:20); `placeOrderSchema` strict (`Store/src/lib/validation/checkout.ts:71-86`); then the shared pipeline 3.2 | via provider: `orders`, `order_add_ons`, `products.stock_quantity` (order_place) | anonymous buyer; same-origin; rate limit; Turnstile | `shipTo.country` (enum of 29), currency from quote |
| C2 | Place cart order | `POST /api/checkout/[storefrontId]` | `Store/src/app/api/checkout/[storefrontId]/route.ts:19-31` | 16 KB body (:17); `placeCartOrderSchema` (lines + `cartId`) (`Store/src/lib/validation/checkout.ts:99-103`); shared pipeline. The body's `lines` are re-quoted; the stored cart lines are NOT used (only `cartId`, to close the cart on payment) | as C1, plus `orders.cart_id`; `carts.ordered_at` on payment | as C1 | as C1 |
| C3 | Discount "Apply" (read only) | `POST /api/checkout/[storefrontId]/discount`, `.../[productId]/discount` | `Store/src/lib/checkout/discount-check.ts:48-86` | same-origin, strict schema, rate limit, gate, provider | none | anonymous | currency of first product (`toCurrency`) |
| C4 | Cancel from Stripe page | `GET /api/checkout/cancel?c=cs_ss_...` | `Store/src/app/api/checkout/cancel/route.ts:42-85` | id shape `^cs_ss_[0-9a-f]{32}$` (:38,44); rate limit (:46-47); expires the Stripe session FIRST (:65-71) then `releasePendingOrder` (:70) | deletes the pending `orders` row (+ `order_add_ons`), restocks (RPC `order_release_pending`) | anonymous; the checkout id is the capability | none |

### 3.2 The shared pipeline (`placeOrderResponse`, `Store/src/lib/checkout/place-order.ts:89-196`)

1. Same origin only (:102; `Store/src/lib/security/same-origin.ts:26-31`). The embed frame runs on the embed host, so it cannot POST here; it links to the hosted pages.
2. Bounded JSON (:104-107), strict parse (:112-113).
3. Per-IP `checkout_place` budget, fail-closed (:116-119).
4. Turnstile when configured (:120-126).
5. `quoteOrder` with `country: order.shipTo?.country ?? null` and the code (:128-139). Refusals become 404 or 409 (:140-145).
6. `expectedTotalCents` must equal the quote total (:151-153). **Compares cents only, not currency.**
7. `checkoutProviderFor` again (:157-158).
8. Parcel needs `shipTo` (:164); download needs `supplyConsent === true` (:165).
9. `placeOrder(provider, quote, buyer, attemptId)` (:167-181). Only quote figures and the parsed buyer fields reach the provider; `shipTo` and gift message only when the quote ships (:173-174).

### 3.3 Providers (`Store/src/lib/checkout/provider.ts:77-123`)

| Provider | When | What it writes | Cite |
|---|---|---|---|
| `test` | `NODE_ENV=development` AND `CHECKOUT_TEST_PAYMENTS=1`, re-checked inside (`provider.ts:102`) | `recordPaidOrder` immediately (status `paid`), session id `cs_sstest_<attempt>` | `provider.ts:94-123`; `Store/src/lib/checkout/availability.ts:41-43` |
| `stripe` | Connect live, Turnstile + mail, account can take charges; re-checked inside (`stripe-provider.ts:79-81`, fresh `readPaymentAccount`) | `reservePendingOrder` (status `pending`, holds stock), then a Stripe Checkout Session, then `orders.payment_ref = session.id` | `Store/src/lib/checkout/stripe-provider.ts:71-201` |

Fee: `sellerSaleFee({ sellerId, amountCents: quote.totalCents, channel })`; a fee that cannot be read refuses the sale (`provider.ts:66-68,87-88,104-105`). Fee policy is another agent's subject.

### 3.4 Exact Stripe Checkout Session parameters (`Store/src/lib/checkout/stripe-provider.ts:122-168`)

| Parameter | Value | Line |
|---|---|---|
| endpoint | `POST /checkout/sessions` | :122-124 |
| `mode` | `"payment"` | :126 |
| `client_reference_id` | our id `cs_ss_<attemptId hex>` | :127, :62-64 |
| `customer_email` | buyer email from the body | :128 |
| `locale` | buyer locale (`pt-PT` -> `pt`) | :129, :67-69 |
| `payment_method_types` | `["card"]` | :130 |
| `line_items[]` | one per quote line, `quantity: 1`, `price_data.currency = quote.currency.toLowerCase()`, `unit_amount = line.amountCents`, name `"2 × Title"`; plus a "Delivery" line when `shippingCents > 0` | :131-155, :106 |
| `payment_intent_data.application_fee_amount` | `fee.applicationFeeCents`, omitted when 0 | :156-159 |
| `payment_intent_data.metadata`, `metadata` | order_id, storefront_id, product_id, origin, plan_id, platform_fee_bps (never read back as authority) | :110-121, :160-162 |
| `success_url` | buyer's HMAC order link `?placed=1` | :163 |
| `cancel_url` | `/api/checkout/cancel?c=<checkout id>` | :164 |
| `expires_at` | now + 31 min | :165, :58 |
| headers | `Stripe-Account: <seller acct>` (direct charge), `Idempotency-Key: checkout_<checkout id>` | :167; `Store/src/lib/billing/stripe-api.ts:239-240` |
| **NOT sent** | `shipping_address_collection`, `billing_address_collection`, any allowed-countries list, `shipping_options`, `automatic_tax`, `phone_number_collection`, `on_behalf_of`, `transfer_data`, `customer_creation` | grep for these keys in `Store/src` finds only the seller Billing flow `Store/src/lib/billing/stripe-provider.ts:189-191` |

No PaymentIntent is created directly; Stripe creates it from the session. The only later PaymentIntent read is `GET /payment_intents/{id}?expand[]=latest_charge` for fee settlement (`Store/src/lib/payments/connect/fees.ts:67-72`), which is where the card's issuing country (`latest_charge.payment_method_details.card.country`, a Stripe field, not read today) could be logged as R4 evidence without an extra call.

### 3.5 Attempt ids and idempotency

- `attemptId` = `crypto.randomUUID()` per page render (`Store/src/app/(public)/s/[storefrontId]/p/[productId]/checkout/page.tsx:127`; `Store/src/app/(public)/s/[storefrontId]/checkout/page.tsx:85`), validated as a UUID in the body (`Store/src/lib/validation/checkout.ts:52`).
- Checkout id: `cs_ss_` + hex (stripe) or `cs_sstest_` + hex (test) (`stripe-provider.ts:53,62-64`; `provider.ts:57,107`).
- `order_place ... on conflict (checkout_session_id) do nothing` returns the existing order as `duplicate` (`Store/supabase/migrations/20261120_shopping_cart.sql:237-245`).
- A duplicate is answered only for the same buyer email and the same `lines_digest`, and (stripe) only while still `pending` (`Store/src/lib/checkout/paid-checkout.ts:47-57`; `stripe-provider.ts:89-99`; `provider.ts:113-122`).
- Stripe idempotency key `checkout_<checkout id>` (`stripe-provider.ts:167`). On Stripe failure, only a non-duplicate reservation is released (`:198`).

---

## 4. Cart

Launch switches: `CART_ENABLED` (on by default only under `next dev`, `Store/src/lib/cart/availability.ts:14-19`); embed frame writes need `EMBED_CART_API=1` (`:31-36`); seller switch `cartPage.enabled` and a provider (`:44-50`).

Table `public.carts` (`Store/supabase/migrations/20261120_shopping_cart.sql:93-127`): `id` (random, the buyer's only key), `storefront_id NOT NULL` (one storefront per cart), `lines jsonb` (product ids, option ids, quantities, source, addedAt; no prices, nothing about the buyer), `rev`, `ordered_at`. RLS on, all grants revoked from anon/authenticated, service role only (:125-127).

| # | Entity / op | Entry point | Code | Validation today | DB written | Authz | Country / currency |
|---|---|---|---|---|---|---|---|
| K1 | Add / set / remove / clear / merge cart lines | `POST /api/cart/[storefrontId]` (hosted pages; embed frame on the embed host when `EMBED_CART_API=1`) | `Store/src/app/api/cart/[storefrontId]/route.ts:49-168` | same-origin (:50); 2 KB body, `cartWriteSchema` strict (:51-54; `Store/src/lib/validation/cart.ts:23-48`); `cart_write` rate limit (:59-61); `cartGate` = launched + `gatePurchasableLines` + (`cartFor` when adding, else provider) (:86; `Store/src/lib/cart/route.ts:26-41`); an add or raised quantity must pass `assessLines` over the whole cart (one currency, delivery priceable in it, stock, cap) (:93-113); optimistic `rev` (`Store/src/lib/cart/store.ts:164-183`) | `carts` insert/update (`store.ts:79-98,185-196`); merge deletes the source cart (`store.ts:106-134`); signals `cart_add` and funnel point after response (:131-148) | anonymous; cart id is the capability, scoped by storefront (`store.ts:56-61`) | currency (via `assessLines`); `cf-ipcountry` read for display only (`Store/src/lib/cart/route.ts:46-49`), filtered to `SHIPPING_COUNTRY_CODES`, never stored |
| K2 | View cart priced now | `POST /api/cart/[storefrontId]/view` | `Store/src/app/api/cart/[storefrontId]/view/route.ts:26-52` | same-origin, 256 B body, `cart_read` rate limit, `cartGate(adding:false)` | none | anonymous | delivery shown for the `cf-ipcountry` guess (`Store/src/lib/cart/view.ts:88-105`) |
| K3 | Close cart on payment | order writer | `closeCart` / `closeOrderCart` `Store/src/lib/cart/store.ts:142-160`; called from `Store/src/lib/orders/record.ts:273,319` | `ordered_at is null` | `carts.ordered_at` | service role | none |
| K4 | Sweep carts | pg_cron daily 03:23 | `carts_sweep` `Store/supabase/migrations/20261120_shopping_cart.sql:131-164` | idle 14 days, or paid > 1 day | deletes `carts` | service role / pg_cron | none |
| K5 | Quick add eligibility | hosted storefront page, embed frame, designer | `quickAddFor` `Store/src/lib/cart/quick-add.ts:44-64`; used `Store/src/lib/storefront/storefront-page.ts:303-315` | `assessLines` on a one-line gate (only `shippingPolicy` of the store is read) | none (decides whether a card posts K1) | n/a | currency, delivery priceability |
| K6 | Cart page settings | `GET/PATCH /api/storefronts/[id]/cart-page`; MCP `update_cart_page` | `Store/src/app/api/storefronts/[id]/cart-page/route.ts:45-68` (shared `pageConfigRoute`, not opened) | `cartPageSchema` | `storefronts.config.cartPage` (inferred from `member: "cartPage"`) | seller `storefront.write` (inferred) | none |

Note: `cartGate(adding:false)` lets a cart be viewed, changed and paid after the seller switched the cart off (documented intent, `Store/src/lib/cart/route.ts:17-24,35-39`).

---

## 5. Orders

### 5.1 The order writer and `order_place`

- `Store/src/lib/orders/record.ts` is the only caller of `order_place` (grep of `rpc("order_` in `Store/src`). Entry functions: `recordPaidOrder` (status `paid`, test provider and dev simulator, `:270-286`), `reservePendingOrder` (status `pending`, 45 min, stripe, `:292-297`, `PENDING_ORDER_MINUTES` `:180`).
- `placeOrder` (`:344-545`): `paidCheckoutSchema` (`:200-246`; `currency` only `^[A-Za-z]{3}$` at `:220`); fee and amount arithmetic (`:352-364`); re-reads the first product (owner, title, price, digital key, stock flag, profile) (`:370-374`) and refuses `seller_mismatch` if a `sellerId` was given and differs (`:377-380`); drops a storefront id that is not the seller's (`:385-394`); re-reads every other line and refuses another seller's product (`:399-419`); derives `ships`/`hasDownloads` from the rows (`:422-427`); normalises `shipTo` with `parseShipTo` (`:430`); verifies discount ids belong to the seller (`:447-452,704-741`); calls `order_place` (`:472-515`).
- **What `placeOrder` does NOT re-check**: product `status='active'`, moderation status, seller identity, seller country, shipping policy, delivery country, currency allowlist. Price and currency come from the quote (`:441`, `:488`).
- `order_place` (latest: `Store/supabase/migrations/20261120_shopping_cart.sql:171-336`): `jsonb_populate_record` into `orders` (:194); requires checkout id and status in (`paid`,`pending`) (:196-201); at most 19 extra lines (:202-204); inserts the order with `currency = coalesce(incoming.currency, 'EUR')` (:220) and `ship_to` as given (:225); idempotent on `checkout_session_id` (:237-245); code usage limit under row lock (:250-267); atomic stock take for the first line (:269-284) and each extra line into `order_add_ons` (:286-326). **No currency, country or seller check in SQL.** Executable by `service_role` only (:339-340).
- `orders` table has no INSERT/UPDATE policy for clients (base definition in the prod replica `Store/tests/db/prod-migrations.sql:291-319`, "Sellers read own orders" select only); `orders.currency` has a default `'EUR'` and **no CHECK** (`prod-migrations.sql:301`); `products.currency` CHECK `in ('EUR','USD')` (`prod-migrations.sql:157`). (The base `create table` statements are not in `supabase/migrations`; they were read from the test replica of prod, so their exact prod state is inferred.)

### 5.2 Buyer fields collected and stored

| Field | Collected | Validated (server) | Stored |
|---|---|---|---|
| email | checkout body `email` (`Store/src/components/checkout/CheckoutForm.tsx:398`) | `emailAddress("buyer")` (`Store/src/lib/validation/checkout.ts:53`); `z.email().max(254)` (`record.ts:221`) | `orders.buyer_email` (`record.ts:489`); also sent to Stripe as `customer_email` |
| locale | body `locale` | `z.enum(LOCALES)` (`checkout.ts:55`) | `orders.buyer_locale` (`record.ts:490`) |
| shipping name, line1, line2, city, region, postalCode | body `shipTo.*`, only when something ships (`CheckoutForm.tsx:406-417`) | `shipToSchema` strict, single-line text, bounded (`checkout.ts:31-47`); re-normalised by `parseShipTo` (`Store/src/lib/orders/ship-to.ts:37-57`) | `orders.ship_to` jsonb (`record.ts:499`; CHECK object and <= 2 KB, `20260927_order_fulfilment.sql:87-93`) |
| **shipping COUNTRY** | body `shipTo.country`, picker state seeded from `cf-ipcountry` or `shipsFrom` (`Store/src/components/checkout/CheckoutView.tsx:138-149`) | `z.enum(SHIPPING_COUNTRY_CODES)` (`checkout.ts:41`); seller's priced rows via the quote (`quote.ts:393-410`); `parseShipTo` only checks `^[A-Z]{2}$` (`ship-to.ts:14,44-45`) | `orders.ship_to.country` |
| courier phone | body `shipTo.phone` (optional) | `isCourierPhone` (`checkout.ts:44-46`; `ship-to.ts:72-74`) | inside `orders.ship_to` |
| **billing country** | **not collected** (no body field, not requested from Stripe, not read from the webhook) | n/a | **not stored** |
| card country | not read | n/a | not stored |
| buyer IP / geo | `cf-ipcountry` used only as a UI default (`checkout/page.tsx:102`, cart `checkout/page.tsx:62`, `Store/src/lib/cart/route.ts:46-49`) | n/a | not stored |
| gift message | body, parcels only | `multiLineText` max 200 (`checkout.ts:57`; `record.ts:226`) | `orders.gift_message` only when ships (`record.ts:503`) |
| supply consent (downloads) | body `supplyConsent` | must be `true` when the quote has downloads (`place-order.ts:165`) | `orders.supply_consent_at = now()` (`record.ts:504`) |
| channel | body `channel` (`?via=`) | `z.enum(LINK_CHANNELS)` = button, embed (`checkout.ts:61`; `Store/src/lib/storefront/product-page-url.ts:81`); default `direct` (`place-order.ts:177`) | `orders.channel` (CHECK, `ORDER_CHANNELS` `Store/src/types/order-view.ts:20`) |
| discount code | body | `discountCode` shape, looked up by the quote | `orders.discount_code_id`, `discount_code` (verified owned, `record.ts:495-496,704-724`) |

### 5.3 Other order writes

| # | Entity / op | Entry point | Code | Validation | DB written | Authz | Country / currency |
|---|---|---|---|---|---|---|---|
| O1 | Insert order (pending or paid) | C1/C2 via providers; dev simulator | `record.ts:344-545` -> `order_place` | 5.1 | `orders`, `order_add_ons`, `products.stock_quantity`, `discounts` row lock | service role | `currency`, `ship_to.country` written as given |
| O2 | Stripe session id on pending order | stripe provider | `stripe-provider.ts:174-178` | `status='pending'` | `orders.payment_ref` | service role | none |
| O3 | pending -> paid | webhook `checkout.session.completed` | `confirmPendingOrder` `record.ts:306-327` -> `order_confirm_paid` (`20261008_order_lifecycle.sql:226-260`) | amount + currency equal the order (`webhook.ts:73-83,198-207`); SQL only `status='pending'` | `orders.status`, `pending_expires_at`, `payment_ref`; `carts.ordered_at` | service role | currency compared, not revalidated |
| O4 | Announce (seller bell/email, buyer confirmation) | after O1(paid)/O3 | `announceOrder` `record.ts:590-662` | order `status='paid'` | `notifications` (inferred via `createNotification`), `orders.seller_notified_at`, `confirmation_sent_at` (`:664-676`) | service role | reads `currency`, `ship_to` |
| O5 | Fee correction / ledger | webhook after O3 | `settleOrderFees` `Store/src/lib/payments/connect/fees.ts:51-100` | Stripe application fee read back | `orders.platform_fee_cents`, `ad_fee_cents`, `application_fee_cents`; fee ledger (inferred table via `recordOrderFees`) | service role | none |
| O6 | Mark shipped / tracking / carrier | dashboard `OrderShipping` (`Store/src/components/orders/OrderShipping.tsx:179`); MCP `mark_order_shipped` (`Store/src/lib/agent/tools/orders.ts:84-101`) | `markOrderShipped` `Store/src/lib/orders/actions.ts:72-134` -> RPC `order_mark_shipped(uuid,text,text)` (`Store/supabase/migrations/20261001_order_tracking_carrier.sql:68`; logic as `20260927_order_fulfilment.sql:165-216`) | session, `orders.fulfil`, rate limit, UUID, `trackingNumberSchema`, `carrierSchema` (CARRIER_IDS, `Store/src/types/order-view.ts:89`), active-store scope (`actions.ts:77-100`); SQL: MFA bar, owner or `orders.fulfil`, `status='paid'` and parcel (`20260927:178-197`) | `orders.fulfilment_status`, `shipped_at`, `tracking_number`, `tracking_carrier`; buyer email | seller session (SECURITY DEFINER RPC, authenticated) | none |
| O7 | Disputed | webhook `charge.dispute.created` | `webhook.ts:252-277` | order by `payment_ref` AND `seller_id` from the connected account; only from `paid` | `orders.status='disputed'`; seller notification | service role | none |
| O8 | Withdrawal timestamp | 6 (W1) | | | | | |
| O9 | Review reminder consent | `POST /api/orders/review-reminder` | `Store/src/app/api/orders/review-reminder/route.ts:36` (update at :83-84); job `Store/src/lib/reviews/reminder-job.ts:87-233` | same-origin, order link | `orders.review_reminder_*` | anonymous with order link; cron job service role | none |

### 5.4 Digital goods

- A product is digital when `digital_file_key` is set (`quote.ts:253`; `record.ts:422-427`). Digital-only orders collect **no address and no country** (`CheckoutForm.tsx:406-421`; `place-order.ts:173`).
- `supply_consent_at` recorded (`record.ts:504`); `fulfilment_status='not_required'` (`record.ts:432`).
- The file key is snapshotted on the order and on each extra line (`record.ts:507,468`).
- Download: `GET /api/orders/[orderRef]/download` (`Store/src/app/api/orders/[orderRef]/download/route.ts:45-103`): rate limit, HMAC order link, `status='paid'`, not withdrawn, line not refunded, product not taken down, then a short-lived signed R2 URL. No writes.

### 5.5 Order links

Stateless HMAC credential `orderId.HMAC(ORDER_LINK_SECRET, "order-link|"+id)`, no fallback secret in production (`Store/src/lib/orders/order-link.ts:1-55`). Checkout is not offered at all without it (`availability.ts:74`). `POST /api/orders/lookup` emails a link after the response, same 202 whatever happens (`Store/src/app/api/orders/lookup/route.ts:35-77`), no writes.

---

## 6. Refunds, withdrawal, cancellation (write paths only)

| # | Entity / op | Entry point | Code | Validation | DB / external written | Authz | Country / currency |
|---|---|---|---|---|---|---|---|
| R1w | Whole-order refund | dashboard `OrderRefund` (`Store/src/components/orders/OrderRefund.tsx:137`); MCP `refund_order` (`Store/src/lib/agent/tools/orders.ts:103-120`) | `refundOrder` `Store/src/lib/orders/actions.ts:231-289` -> `refundWhatIsLeft` (`:422-443`) -> `refundWithProvider` (`:459-501`) | session, `orders.refund` (owner only), rate limit, UUID, reason enum, pre-read scoped by `seller_id`, `status='paid'` | Stripe `POST /refunds` on the connected account, `refund_application_fee: true`, idempotency `refund_<orderId>` (`:476-489`); then service-role `order_apply_refund` for provider payments, or client `order_refund` for manual ones (`:430-432`); fee ledger reversal for manual (`:441`); buyer email | seller session; service role for provider-paid | `orders.currency` only for the email |
| R2w | Per-line refund | dashboard `OrderRefund` (`OrderRefund.tsx:136`); no MCP tool | `refundOrderLine` `actions.ts:302-406` | as R1w; amount from `order_line_refund_amount` (`20261120_shopping_cart.sql:396-443`) | Stripe partial refund, idempotency `refund_<orderId>_<lineKey>` (`actions.ts:352-357,487`); `order_apply_line_refund` (`20261120:445-558`) writes `order_line_refunds`, restocks, flips the order to refunded when every line is | owner session; service role RPCs | none |
| R3w | Client-callable refund RPC | PostgREST `rpc/order_refund` | `20261021_order_refund_provider_first.sql:21-59` | MFA bar, owner or `orders.refund`; refuses orders with `payment_ref like 'pi\_%'` | `order_apply_refund` (`20261028_product_add_ons.sql:443+`): status, refunded_at, reason, restock | authenticated | none |
| R4w | Webhook full refund | `charge.refunded` | `Store/src/lib/payments/connect/webhook.ts:229-250` | order by `payment_ref` + seller from connected account; only `refunded === true` changes the order | fee ledger rows (`recordChargeFeeRefunds`, `fees.ts:107-121`); `order_apply_refund(..., 'other', false)` | service role | none |
| W1 | Buyer withdrawal (CRD art. 11a) | `POST /api/orders/withdraw` from the order page | `Store/src/app/api/orders/withdraw/route.ts:44-133` | same-origin, 2 KB body, `withdrawSchema` (`Store/src/lib/validation/checkout.ts:121-126`), IP and per-order rate limits, HMAC order link, email match, `buyerWithdrawal` window from the RE-READ shipping policy (:71-72; `Store/src/lib/orders/withdrawal.ts:39-68`) | `orders.withdrawal_requested_at` once (:76-82); seller notification and emails after response. **Records only; no refund is made** | anonymous with order link + email | none |
| X1 | Buyer backs out of Stripe page | `GET /api/checkout/cancel` | C4 above | | Stripe `/expire`, then `order_release_pending` | anonymous capability | none |
| X2 | Stripe page expired | webhook `checkout.session.expired` | `webhook.ts:217-227` | order must be this seller's | `order_release_pending` | service role | none |
| X3 | Abandoned pending orders | pg_cron every 5 min | `orders_release_expired` `20261028_product_add_ons.sql:400-438`, scheduled `20261008_order_lifecycle.sql:349-359` | `status='pending'`, `pending_expires_at < now()` | deletes `orders` + `order_add_ons`, restocks | pg_cron / service role | none |
| X4 | Stripe session creation failed | stripe provider | `stripe-provider.ts:193-199` | own non-duplicate reservation only | `order_release_pending` | service role | none |

No app-level cron route calls `orders_release_expired` or `carts_sweep` (grep); both rely on pg_cron being installed in prod (inferred: the `do $$ ... if exists pg_cron` blocks).

---

## 7. Payments webhook

`POST /api/payments/webhook` (`Store/src/app/api/payments/webhook/route.ts:32-53`): 404 unless Connect is live (:33); 256 KB body (:26,35-36); Stripe signature over the raw body with `STRIPE_CONNECT_WEBHOOK_SECRET` (:38-46); `handleConnectEvent` (`Store/src/lib/payments/connect/webhook.ts:124-158`): only Connect events (`event.account`), only this key's mode, only listed types, event ledger `stripe_events` (upsert then `processed_at` after effect), seller resolved from `seller_payment_accounts` by the connected account, never from metadata.

| Event (`CONNECT_EVENT_TYPES`, `webhook.ts:42-48`) | What it writes | Cite |
|---|---|---|
| `account.updated` | `seller_payment_accounts.charges_enabled/payouts_enabled/details_submitted` (no country, no default currency stored) | `webhook.ts:165-175`; `Store/src/lib/payments/connect/account.ts:108-124` |
| `checkout.session.completed` (`payment_status='paid'`) | O3 (`order_confirm_paid`), O5 (fees); alerts ops when no order, foreign order, or amount/currency mismatch | `webhook.ts:177-215` |
| `checkout.session.expired` | funnel point; `order_release_pending` | `webhook.ts:217-227,107-121` |
| `charge.refunded` | fee refund ledger; full refund -> `order_apply_refund` | `webhook.ts:229-250` |
| `charge.dispute.created` | `orders.status='disputed'`, notification | `webhook.ts:252-277` |

Not handled: `checkout.session.async_payment_succeeded/failed` (cards only, `stripe-provider.ts:130`), `payment_intent.*`, `charge.dispute.closed`, refunds updated/failed (inferred from the list). Nothing reads `customer_details`, `shipping_details`, billing address or card country.

---

## 8. Buyer entry points

| Entry | How it reaches a checkout | Server gate on the way | Cite |
|---|---|---|---|
| Hosted product page `/s/[sf]/p/[p]` | Buy button -> `/s/[sf]/p/[p]/checkout?o=&q=&a=&via=` | `gatePurchasable` + `checkoutAvailableFor` + `cartFor` | `Store/src/lib/products/public.ts:220-247`; `Store/src/lib/storefront/product-page-url.ts:197-217` |
| Buy-now checkout page | renders form, mints `attemptId`; POST C1 | `getCheckoutPage` (gate + availability) | `Store/src/lib/checkout/page.ts:32-100`; `.../p/[productId]/checkout/page.tsx:66-136` |
| Hosted storefront page `/s/[sf]` | tile -> product page; card quick add -> K1 | storefront-page gate (not fully opened), `cartFor`, `quickAddFor` | `Store/src/lib/storefront/storefront-page.ts:303-315` |
| Cart page `/s/[sf]/cart` and cart checkout `/s/[sf]/checkout?cart=` | POST C2 | `getCartCheckoutPage`: launched, rate limit, cart readable and open, gate, provider, every line passes `assessLines` | `Store/src/lib/checkout/cart-page.ts:41-141`; `Store/src/app/(public)/s/[storefrontId]/checkout/page.tsx:41-92` |
| Embed frame `/e/[key]/[...sites]` (+ `public/widget.js`) | frame cards open hosted pages; with `EMBED_CART_API=1` they write K1 on the embed host and hand the cart id to `/s/[sf]/cart?cart=` | `getEmbedFrame` (key, rate limit, embedding on, site allowlist, hosted storefront gate; loader not opened); cannot POST checkout (same-origin) | `Store/src/app/(public)/e/[key]/[...sites]/page.tsx:73-103`; `Store/public/widget.js:133` (only creates an iframe); `Store/src/lib/storefront/product-page-url.ts:225-239` |
| Legacy embed JSON `GET /api/embed/[key]` | payload carries `productUrl` with `?via=embed` | key, rate limit, takedown, origin allowlist, trader identity; CDN `s-maxage=300` | `Store/src/app/api/embed/[key]/route.ts:81-227,365-367` |
| Website buy button | plain `<a href="productPageUrl(...,{via:'button'})">` -> product page | as product page | `Store/src/lib/storefront/embed-snippet.ts:120-122`; `product-page-url.ts:76-91,185-187` |
| Cancel return | `/api/checkout/cancel` redirects back to the checkout page | C4 | `Store/src/app/api/checkout/cancel/route.ts:79-84` |
| MCP (seller agent) | no buyer-checkout tool; `get/update_checkout_page`, `get/update_cart_page` only edit page settings | seller scopes | `Store/src/lib/agent/tools/storefronts.ts:1-13,199-209` |
| Dev only | `/dev/simulate-sale` (`route.dev.ts`, excluded from production builds by `pageExtensions`) calls `recordPaidOrder` directly with fixed IE/DE/FR/NL addresses and the product's currency, **bypassing the quote** | none of the gate; seller session | `Store/src/lib/dev/simulated-sale.ts:34-55,92-156`; `Store/next.config.ts:175` |

`?via=` is attribution only and never reaches price, fee or gate (`product-page-url.ts:72-75`; `checkout.ts:59-61`).

---

## 9. Collab / multi-seller checkout

**None exists.** Searched `Store` (excluding node_modules) case-insensitively for `collab`, `multi-seller`, `multi_seller`, `multiseller`, `co-seller`, `split payment`, `transfer_group`, `destination charge`, `on_behalf_of`, `transfer_data`: the only hits are design comments (`Store/src/components/product-page/ProductCta.tsx:35-36`, `Store/src/lib/payments/types.ts:13`) and a search synonym "collaborator" for team invites (`Store/src/lib/search/registry.ts:458`).

Structural single-seller constraints that a collab feature would have to change:
- `carts.storefront_id NOT NULL`, every cart read scoped to one storefront (`20261120_shopping_cart.sql:97`; `Store/src/lib/cart/store.ts:56-61`).
- The gate reads products with `.eq("owner_id", storefront.owner_id)` (`purchasable.ts:282`).
- The order writer refuses a line owned by another seller (`record.ts:414-417`), and `order_place` writes every line with the order's `seller_id` (`20261120:295`).
- One Stripe session on one connected account (`stripe-provider.ts:167`).

---

## 10. Things noticed that matter for the build

- `expectedTotalCents` compares cents only (`place-order.ts:151`): a product switched from EUR 10.00 to USD 10.00 between page load and Pay is not refused as `price_changed`. Stripe's page would show USD.
- `paidCheckoutSchema.currency` accepts any 3 letters (`record.ts:220`) and `order_place` defaults to EUR (`20261120:220`); the DB has no `orders.currency` CHECK (`prod-migrations.sql:301`).
- `product_price_history.currency` CHECK `in ('EUR','USD')` is written by a trigger on every product price change (`20261004_discounts.sql:249-255`; trigger shown in replica `prod-migrations.sql:6777-6795`), so allowing CZK in `products` alone would make every CZK product save fail at the trigger.
- Analytics SQL treats "not USD" as euros: `currency <> 'USD'` in `dashboard_orders_aggregate` and `analytics_aggregate` (`20261120_shopping_cart.sql:744,808,852,863`). CZK revenue would be summed into the euro figures.
- `cartId` on the cart order body is not checked against the storefront before being stored and closed (`Store/src/app/api/checkout/[storefrontId]/route.ts:27-28`; `record.ts:273,510`); the id is a 128-bit capability, so this is a tidiness point, not a compliance one.
- Address-format helpers hard-code countries: `REGION_COUNTRIES = US, CA, AU`, `POSTCODE_OPTIONAL = IE` (`Store/src/components/checkout/CheckoutForm.tsx:50,52`); `CITY_THEN_POSTCODE = GB, IE`, `CITY_REGION_POSTCODE = US, CA, AU` (`Store/src/lib/orders/ship-to.ts:78-79`).

---

## 11. Answers

### Q1. Where does the buyer's delivery country come from, where is it validated, and is there a server-side allowed-countries check at checkout time?

- **Source**: the checkout form's country picker, sent as `shipTo.country` in the order POST body (`Store/src/components/checkout/CheckoutForm.tsx:186,415`). The picker lists the seller's priced countries, expanded to all 29 platform codes when the seller has a `"*"` row (`Store/src/components/checkout/CheckoutView.tsx:138-143`), and starts on `cf-ipcountry` or `shipsFrom` (`CheckoutView.tsx:144-149`; `.../p/[productId]/checkout/page.tsx:102`). Only parcel orders send it.
- **Server validation, in order**:
  1. `shipToSchema.country = z.enum(SHIPPING_COUNTRY_CODES)` (`Store/src/lib/validation/checkout.ts:41`): the platform list (27 EU + US + CA, `Store/src/lib/settings/constants.ts:129-136`). **This is the only platform-level allowed-countries check on the server**, and it is a static literal tuple, not configuration.
  2. `quoteOrder` -> `quoteFromLines` -> `quoteOrderShipping` -> `quoteShipping` against the seller's priced rows, refusing `not_shipped_here` (`Store/src/lib/checkout/quote.ts:393-407`; `Store/src/lib/shipping/rates.ts:139-207`), answered as HTTP 409 (`Store/src/lib/checkout/place-order.ts:140-145`). A `"*"` row passes every code that survived step 1.
  3. `parseShipTo` re-normalises but only checks `^[A-Z]{2}$` (`Store/src/lib/orders/ship-to.ts:14,44-45`).
- **Not validated**: by Stripe (no address collection or country restriction is sent, `stripe-provider.ts:122-168`), by `order_place` (no country logic, `20261120_shopping_cart.sql:171-336`), or by any DB constraint on `orders.ship_to` (`20260927_order_fulfilment.sql:87-93`). Nothing validates a billing country, because none exists.

### Q2. Could a buyer today complete an order to a country the seller's policy does not list, or in a currency other than the product's?

- **Unlisted delivery country: no, through the normal flow.** The quote refuses any country not on a priced row and not covered by a `"*"` row (`rates.ts:164-179`), and Stripe never collects a different address, so the stored `ship_to.country` is the quoted one. Caveats:
  - A `"*"` row means "all 29 platform countries", so "listed" is broad for any seller using it.
  - A profile override cannot widen eligibility (`rates.ts:129-133`).
  - If the seller removes a country from their policy while a buyer is on the Stripe page, the pending order still confirms (no re-check at `order_confirm_paid`, `20261008_order_lifecycle.sql:226-260`).
  - If `parseShipTo` rejects a malformed address after the quote passed, the order is written with `ship_to = null` (`record.ts:430`; `ship-to.ts:45`), so it has no country at all.
  - The dev-only simulator writes IE/DE/FR/NL addresses regardless of policy (`Store/src/lib/dev/simulated-sale.ts:34-55`); not reachable in production builds.
- **Other currency: no, in practice.** Every line's currency is the product's (`quote.ts:254`), one currency per order (`quote.ts:273-279`), shipping rates must be in that currency (`rates.ts:118-121,151-153`), Stripe gets the quote's currency (`stripe-provider.ts:106,138`), and the webhook refuses a session whose currency differs from the order (`webhook.ts:73-83,198-207`). Caveats: `toCurrency` folds any non-USD value to EUR (`money.ts:12-14`), safe only because `products.currency` is CHECKed to EUR/USD (`prod-migrations.sql:157`); a currency switch between page and Pay is not caught by `expectedTotalCents` (`place-order.ts:151`).

### Q3. The best server-side choke point(s), and which entry points bypass them

Recommended layering, all on the existing single path:

1. **`placeOrderResponse` -> `quoteOrder` / `quoteFromLines`** (`Store/src/lib/checkout/place-order.ts:128-165`, `Store/src/lib/checkout/quote.ts:158-185,379-428`). Every production order passes here (C1 and C2; section 8). This is where "delivery country in the platform's configured allowed list" (independent of the seller's `"*"`), "currency in the allowed list" (in `assessLines`, `quote.ts:231-308`, which also keeps the cart and quick add honest), and "billing country = CZ for digital lines" belong. Billing country needs a NEW body field in `orderBuyerFields` (`Store/src/lib/validation/checkout.ts:50-67`), checked beside the consent check (`place-order.ts:164-165`) and passed to the writer.
2. **The seller half (R1, R5) in `gatePurchasableLines`** (`Store/src/lib/products/purchasable.ts:276-322`): it already reads the seller's profile row with `tax_country` in the same select (`TRADER_GATE_SELECT` includes `SELLER_IDENTITY_SELECT`, `Store/src/lib/settings/seller-identity.ts:55-56,81-82`), and it fronts every buyer surface (product page, checkout pages, cart routes, discount check, quote), so a non-CZ seller's offers vanish everywhere at no extra query. The Stripe account country is not stored today (`20261008_seller_payment_accounts.sql:33-45`), so either persist it from `account.updated` / `refreshPaymentAccount` (`webhook.ts:165-175`; `account.ts:129-135`, `StripeAccount` type `stripe-api.ts:110-115` would need `country`) and check it in `checkoutProviderFor` (`Store/src/lib/checkout/availability.ts:73-83`), or check it in `placeStripeOrder`, which already re-reads the account fresh just before asking Stripe for money (`stripe-provider.ts:79-81`). "Business address country" has no structured field: `seller_address` is free text (bounded at 300 chars, `Store/src/lib/settings/constants.ts:145-148`); `tax_country` is the only structured seller country.
3. **Database backstop in `order_place`** (`20261120_shopping_cart.sql:171-336`) or a CHECK/trigger on `orders`: currency and `ship_to->>'country'` against a config table. This is the only layer that also covers the dev simulator, any future webhook-created order, and direct service-role calls.
4. **Stripe-side defence in depth**: `shipping_address_collection.allowed_countries` and `billing_address_collection: "required"` on the session (`stripe-provider.ts:122-166`) would make Stripe enforce and collect, but the address our order stores comes from our form, so this complements rather than replaces 1.

Entry points that do NOT pass through `quoteOrder`:
- Dev simulator `recordPaidOrder` (`Store/src/lib/dev/simulated-sale.ts:139`), dev builds only (`Store/next.config.ts:175`).
- Payment confirmation `order_confirm_paid` (`record.ts:306-327`): confirms an order quoted earlier, re-checks nothing (by design).
- Direct service-role RPC calls to `order_place` (scripts, tests); none found in `src` besides `record.ts`.
- Not orders but relevant: the seller's own Stripe account can create charges outside Square Share; the webhook ignores sessions that match no order (`webhook.ts:185-193`).

### Q4. Time-of-check to time-of-use windows

| Data | Checked when | Re-read when the order is written? | Re-read at payment confirmation? | Cite |
|---|---|---|---|---|
| Product placement, status, takedown, seller identity, shipping policy, sales, code | quote at POST (fresh, uncached route handler) | `placeOrder` re-reads owner, title, price, file key only; not status, takedown, identity, policy | no | `quote.ts:158-185`; `record.ts:370-419`; `20261008:226-260` |
| Payment account `charges_enabled` / mode | `checkoutProviderFor` at POST, then again fresh in `placeStripeOrder` | yes (`stripe-provider.ts:80`) | no (webhook only resolves the seller) | `place-order.ts:157`; `account.ts:81-83` (React cache is a no-op in route handlers) |
| Stripe account country | never | never | never | section 0 item 4 |
| Seller `tax_country` | never in the selling path | never | never | `seller-identity.ts:128-132` |
| Delivery country vs policy | quote at POST | no | no; up to 31 min page (`stripe-provider.ts:58`) and 45 min hold (`record.ts:180`) | |
| Currency | quote at POST | no (taken from the quote) | webhook compares session vs order only | `webhook.ts:73-83` |
| Price shown vs charged | `expectedTotalCents` at POST (cents only) | n/a | amount compared vs order | `place-order.ts:151` |
| Stock, code usage limit | quote, then atomically in `order_place` | yes, atomic | held by the pending order | `20261120:250-326` |
| Page-render data (country list, policy shown, availability) | page render | POST re-quotes, so a stale picker cannot widen eligibility | | `CheckoutView.tsx:138-149` |
| Cart | lines stored without prices; validated on add and on the cart checkout render | POST uses the body's lines and re-quotes; stored lines not used | | `20261120:98-101`; `cart-page.ts:63-72`; `checkout/[storefrontId]/route.ts:27-28` |
| Embed payload | CDN cached 5 min | irrelevant, links only; checkout re-gates | | `api/embed/[key]/route.ts:207` |
| Seller switches cart off | stops new adds only | existing carts still payable | | `Store/src/lib/cart/route.ts:35-39` |
| Code deploy narrowing country/currency lists | n/a | stored policies stop parsing and read as `{}`; existing orders' withdrawal windows shrink to 14 days | | section 1.3 |

A seller who changes country, currency or delivery terms, or is taken down, while a buyer is on the Stripe page: the pending order still becomes paid. Closing that window means re-checking in the webhook before `confirmPendingOrder` (and refunding if refused), or accepting it as a bounded 45-minute window.

### Q5. Where country lists, currencies and defaults are defined or hard-coded

Countries:
- `EU_COUNTRIES` / `EU_COUNTRY_CODES` `Store/src/lib/settings/constants.ts:72-102`.
- `OPERATING_COUNTRIES` / `OPERATING_COUNTRY_CODES` (EU + US + CA) `constants.ts:104-116`.
- `SHIPPING_COUNTRY_CODES` (literal tuple, must be kept in step by hand) `constants.ts:118-139`.
- Shipping policy enum and `shipsFrom` refine `Store/src/lib/validation/shipping-policy.ts:44-47,71-76`.
- Checkout body enum `Store/src/lib/validation/checkout.ts:41`.
- Cart display guess filter `Store/src/lib/cart/route.ts:46-49`.
- Checkout picker expansion of `"*"` and start country `Store/src/components/checkout/CheckoutView.tsx:140,144-149`.
- `cf-ipcountry` defaults `Store/src/app/(public)/s/[storefrontId]/p/[productId]/checkout/page.tsx:102`, `Store/src/app/(public)/s/[storefrontId]/checkout/page.tsx:62`.
- `SHIP_ANYWHERE = "*"` `Store/src/types/shipping-policy.ts:111`.
- Seller shipping country picker `Store/src/components/settings/CountryPicker.tsx:36` (grep line, not opened in full).
- Business / tax country refine `Store/src/lib/validation/settings.ts:133` (grep line, not opened in full).
- `operatingCountries()` list for pickers `Store/src/lib/format/country.ts:69-78`.
- EU rights decisions `Store/src/lib/storefront/product-page.ts:169,186,195` (grep lines).
- Address-format sets `Store/src/components/checkout/CheckoutForm.tsx:50,52`; `Store/src/lib/orders/ship-to.ts:78-79`.
- Carriers (includes `ceska-posta`) `Store/src/types/order-view.ts:89`.
- Shipping defaults from business country `Store/src/lib/predictions.ts:397-406`.

Currencies:
- `CURRENCIES = ["EUR","USD"]` `Store/src/types/product.ts:12`.
- `toCurrency` (non-USD -> EUR) `Store/src/lib/format/money.ts:12-14`.
- Product write enum `Store/src/lib/validation/product.ts:478`.
- Policy `ratesCurrency` enum `Store/src/lib/validation/shipping-policy.ts:79`.
- EUR defaults: `Store/src/lib/shipping/rates.ts:118,149,276`; `Store/src/lib/shipping/policy-prose.ts:122`; `Store/src/lib/checkout/quote.ts:330`; `Store/src/components/settings/ShippingSection.tsx:203`; `Store/src/components/products/ProductForm.tsx:261`.
- `DOLLAR_COUNTRIES = ["US","CA"]` and `homeCurrency` `Store/src/lib/predictions.ts:250-257`.
- DB: `products.currency` CHECK EUR/USD (replica `Store/tests/db/prod-migrations.sql:157`); `orders.currency` default EUR, no CHECK (replica `:301`); `order_place` coalesce EUR `Store/supabase/migrations/20261120_shopping_cart.sql:220`; `product_price_history` CHECK `Store/supabase/migrations/20261004_discounts.sql:253`; `discounts` amount CHECK `20261004_discounts.sql:84-92`; analytics `currency <> 'USD'` `20261120_shopping_cart.sql:744,808,852,863`.

### Q6. What could not be determined

- The production state of the base `products` / `orders` tables: their `create table` statements are not in `supabase/migrations`; I read them from the test replica `Store/tests/db/prod-migrations.sql` (inferred to match prod).
- Whether pg_cron is actually installed in production, so whether `orders_release_expired` and `carts_sweep` run (no app-level fallback route exists).
- Whether Stripe accepts these Checkout Session parameters for a CZ connected account in CZK (minimum amounts, minor-unit rules, Express availability). Memory notes say Connect has only been run against a stand-in (`stripe-connect-buyer-payments.md`), and I did not call Stripe.
- The exact behaviour of `getEmbedFrame` (`Store/src/lib/storefront/embed-frame-loader.ts`), `openStorefront` (`Store/src/lib/storefront/public-gate.ts`) and `pageConfigRoute`: not opened; their gating is described from call sites and comments.
- Which production env switches are on today (`NEXT_PUBLIC_STRIPE_CONNECT_ENABLED`, `CART_ENABLED`, `EMBED_CART_API`, Turnstile, mail): not readable from code; secrets were not opened.
- Whether any SQL outside this repo (for example the App worker or Supabase dashboard functions) writes `orders`: grep of App and Admin source for `"orders"` and `order_place` found nothing, but other repos (Home, Docs, System) were not searched.

---

## 12. Quick reference: every write path in this part

| ID | Entity | Op | Entry | Authz | Writes |
|---|---|---|---|---|---|
| S1 | shipping policy | replace | Settings action | own profile session + service role | `profiles.shipping_policy` |
| S2 | shipping policy | replace | MCP `save_shipping_policy` | owner, `storefront.write` | via S1 |
| C1 | order | create | `POST /api/checkout/[sf]/[p]` | anonymous | `orders`, `order_add_ons`, stock |
| C2 | order | create | `POST /api/checkout/[sf]` | anonymous | as C1 + `cart_id` |
| C4/X1 | pending order | delete | `GET /api/checkout/cancel` | capability | Stripe expire, `order_release_pending` |
| K1 | cart | create/update/merge/delete | `POST /api/cart/[sf]` | anonymous capability | `carts` |
| K3 | cart | close | order writer | service role | `carts.ordered_at` |
| K4 | cart | sweep | pg_cron | service role | `carts` delete |
| K6 | cart page settings | update | `PATCH /api/storefronts/[id]/cart-page`, MCP | seller | `storefronts.config` (inferred) |
| O2 | order | set payment_ref | stripe provider | service role | `orders.payment_ref` |
| O3 | order | confirm paid | webhook | service role | `orders.status` |
| O4 | order | announce markers | writer | service role | `seller_notified_at`, `confirmation_sent_at` |
| O5 | order | fee correction | webhook | service role | fee columns, ledger |
| O6 | order | ship / tracking | dashboard, MCP | seller session, definer RPC | fulfilment columns |
| O7 | order | dispute | webhook | service role | `status='disputed'` |
| O9 | order | review reminder | order page, cron | order link / service role | `review_reminder_*` |
| R1w | order | refund | dashboard, MCP | owner | Stripe refund, `order_apply_refund` / `order_refund` |
| R2w | order line | refund | dashboard | owner | Stripe partial refund, `order_line_refunds` |
| R3w | order | refund (manual) | PostgREST RPC | authenticated owner | `order_apply_refund` |
| R4w | order | refund | webhook | service role | ledger, `order_apply_refund` |
| W1 | order | withdrawal | `POST /api/orders/withdraw` | order link + email | `withdrawal_requested_at` |
| X2 | pending order | release | webhook expired | service role | `order_release_pending` |
| X3 | pending orders | release | pg_cron 5 min | service role | `orders_release_expired` |
| X4 | pending order | release | Stripe failure | service role | `order_release_pending` |
| D1 | order (dev) | create | `/dev/simulate-sale` | dev only | `recordPaidOrder` |

---

## 13. Drift between memory notes / comments and the code

- `checkout-architecture.md` names `quoteCheckout` and `loadPurchasable` as the authorities; the code uses `quoteOrder` / `quoteFromLines` and `gatePurchasable(Lines)`; `loadPurchasable` has no callers and `quoteCheckout` does not exist.
- `ProductCta.tsx:22-24` says the quote passes quantity through `resolveOrderQuantity`; the quote uses `checkOrderQuantity` (`quote.ts:289`) and `resolveOrderQuantity` has no callers.
- `Store/src/lib/orders/record.ts:7-31` still says the payment webhook "does not exist yet" (TODO(stripe)); it exists (`Store/src/app/api/payments/webhook/route.ts`, `Store/src/lib/payments/connect/webhook.ts`).
- The task brief's `parseShippingPolicy` is `buildShippingPolicy` in code.
- `Store/src/lib/settings/constants.ts:104-108` says the Terms list the same operating area; whether Home's Terms match was not checked here (Home is another agent's scope).
