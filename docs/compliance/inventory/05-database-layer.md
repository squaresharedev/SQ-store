# Compliance inventory, part 5 of 9: the database layer

Scope: every migration in Store (`supabase/migrations`, 88 files), Admin (`supabase/migrations`, 9 files), Home (`supabase/migrations`, 3 files), the production replay `Store/tests/db/prod-migrations.sql` (holds the base tables that predate the repo's migration files), App `worker/` (no SQL: only a stale generated `worker/lib/database.types.ts`) and SQ-system `packages/db` (client wrappers only: `src/generic.ts`, `browser.ts`, `next.ts`, no SQL). Investigation only, read from disk on 2026-11-22. Nothing in production was queried.

Path prefixes: `Store/`, `Admin/`, `Home/`, `App/` are `C:\Squareshare\<repo>\`. "Replica" means `Store/tests/db/prod-migrations.sql`.

The rules being implemented: R1 seller in CZ (Stripe account country and business address country), R2 CZK only, R3 delivery to CZ only (re-validated server-side), R4 buyer billing country CZ for digital goods, R5 collab checkout: every seller passes R1 to R3, R6 no checkout without all rules, server-enforced.

---

## 0. Headline findings

1. **CZK cannot be stored today, by anyone.** `products.currency` is `CHECK (currency in ('EUR','USD'))` (Replica:157), `product_price_history.currency` has the same list (Store/supabase/migrations/20261004_discounts.sql:253) and is written by an AFTER trigger on every product insert and price/currency change (20261004_discounts.sql:270-296), and amount discounts require `currency in ('EUR','USD')` (20261004_discounts.sql:84-92). All three must be widened in one migration or every CZK product write fails inside the trigger.
2. **Direct-write bypass, products (the big one).** Owners and editors hold table-level INSERT/UPDATE/DELETE on `products` (Supabase default privileges, never revoked: Store/tests/db/shim.sql:187-194, stated in 20260918_content_moderation.sql:16-24) and RLS lets them write any column of their store's rows (Replica:921-942). With their own JWT they can set `currency` to `'USD'`, any `price_cents >= 0`, `status = 'active'`, `digital_file_key`, `shipping_profile_id`, `track_stock`/`stock_quantity`, and so on. Only moderation columns, object keys, add-on ids and row counts are guarded by triggers. Nothing in the database constrains currency beyond the EUR/USD list, and nothing ties a product to a seller country. The codebase itself documents this path (20261021_object_key_ownership.sql:10-12, 20261028_product_add_ons.sql:55-59, 20261012_auto_moderation.sql:9-11). The MCP server mints a per-request user JWT (memory `mcp-server-architecture.md:3`), so agent writes land on the same path.
3. **Direct-write bypass, discounts.** `authenticated` may INSERT every column and UPDATE `currency`, `amount_off_cents` and others (20261004_discounts.sql:128-135). Only the EUR/USD CHECK applies; nothing links a discount's currency to its products'.
4. **Direct-write bypass, seller identity.** A seller may PATCH their own `profiles.tax_country` (shape `^[A-Z]{2}$` only, any two letters: Replica:261-262), `tax_vat_id`, `seller_address` (free text, no country), `seller_email`, `seller_phone` (Replica:103-108; not covered by `guard_seller_text`, 20261012_auto_moderation.sql:735-777). `shipping_policy`, `tax_business_name` and `seller_bio` ARE protected: only the service role may write them (same trigger).
5. **No column holds three of the facts the rules need.** The connected Stripe account's country is not stored (`seller_payment_accounts` has id, three booleans, livemode: 20261008_seller_payment_accounts.sql:33-49). The buyer's billing country is not stored anywhere on `orders` (Store/src/types/supabase.ts:1417-1470). The business address has no country field (`seller_address` is 1..300 chars of text: 20260905_seller_identity_on_profile.sql:36-50); the closest structured field is `tax_country`, which the product page prints as the trader's country (Store/src/lib/settings/seller-identity.ts:155).
6. **Orders are written only by the service role, and the writer trusts its caller.** `order_place(jsonb)` (latest applied: 20261028_product_add_ons.sql:183-342) checks session id, status, line count, code usage and stock. It never checks currency (it defaults a missing one to `'EUR'`, line 231), seller country, `ship_to` country, that the product belongs to `seller_id`, or that add-on lines belong to the same seller or currency. `orders.currency` has no CHECK at all (Replica:301) and `orders.ship_to` only "is an object, at most 2 KB" (20260927_order_fulfilment.sql:87-93).
7. **A second order writer bypasses `order_place`:** the demo sales simulator (pg_cron, every 20 minutes when enabled) inserts orders directly in `demo.sales_sim.currency` (default `'EUR'`) shipped to ten EU countries, nine of them not CZ (20260927_demo_sales_sim_fulfilment.sql:49-81, 163-185). Only a table-level constraint or trigger would see it; whether it is enabled in production is unknown.
8. **"Collab (multi-seller) checkout" has no database representation.** Every order has one `seller_id`; add-on lines copy it (20261028_product_add_ons.sql:300); a cart belongs to one storefront (20261120_shopping_cart.sql:93-97). No migration or source file mentions collab checkout. Nothing enforces that a line's product belongs to the order's seller.
9. **NOT VALID will not protect legacy rows the way it might seem.** A NOT VALID CHECK is skipped for existing rows only until a row is UPDATEd; any later update (stock decrement, restock on refund or expiry, moderation sweep, mark shipped) re-checks the whole new row and fails. Two of those updates run in bulk statements (`orders_release_expired` every 5 minutes, `moderation_recheck_all`), where one legacy row would roll back the whole statement. Details in section 7.

---

## 1. Geography and money columns

"Latest" names the migration whose definition wins. "Client-writable" refers to section 2.

### 1.1 Sellers and seller identity: `public.profiles` (one row per auth user, buyers and sellers alike)

| Column | Type / default / null | CHECK today | Latest definition | Client-writable |
|---|---|---|---|---|
| `tax_country` | text, null | `tax_country is null or tax_country ~ '^[A-Z]{2}$'` (any two capitals, not an ISO list) | Replica:261-262 (settings_profile_fields 20260706081724) | Yes, by the account holder |
| `tax_vat_id` | text, null | `^[A-Za-z0-9 .-]{2,32}$` | Replica:259-260 | Yes |
| `tax_business_name` | text, null | length 1..200 | Replica:257-258 | No: service role only (guard_seller_text, 20261012_auto_moderation.sql:735-777) |
| `seller_address` | text, null | length 1..300 (no country part) | 20260905_seller_identity_on_profile.sql:36-43 | Yes |
| `seller_email` | text, null | <= 254, email shape | 20260905_seller_identity_on_profile.sql:44-48 | Yes (proof dropped on change: 20260926_contact_verification.sql:315-322) |
| `seller_phone` | text, null | length 1..32 | 20260905_seller_identity_on_profile.sql:49-50 | Yes |
| `seller_email_verified_at`, `seller_phone_verified_at` | timestamptz, null | none | 20260909 / 20260926_contact_verification.sql:49-50 | Set only by trusted writers (20260926_contact_verification.sql:285-334) |
| `shipping_policy` | jsonb, null | `null or (jsonb_typeof = 'object' and pg_column_size <= 16384)` | 20260905_shipping_policy_on_profile.sql:40-56 | No: service role only (guard_seller_text) |
| `is_seller` | boolean not null default false | none | Replica:35 | Yes, but nothing in Store `src/` ever sets or reads it (only comments and types), so it cannot identify sellers |
| `legal_accepted_version`, `legal_accepted_at` | text (<= 32) / timestamptz | length | Replica:263-265 | Yes |
| `locale` | text | shape | 20260925_profile_locale.sql | Yes |

**Shipping policy lives in `profiles.shipping_policy` (jsonb), not in tables.** It moved off `storefronts.config` on 2026-09-05 (20260905_shipping_policy_on_profile.sql:17-21, 121-123). Its write boundary is the Zod schema `Store/src/lib/validation/shipping-policy.ts:67-138`. Money and geography keys inside it:

| jsonb path | Meaning | Allowed by app (DB checks nothing inside) |
|---|---|---|
| `shipsFrom` | country the seller ships from | an `OPERATING_COUNTRY_CODES` member (shipping-policy.ts:71-76; list = EU + US + CA, Store/src/lib/settings/constants.ts:110-116) |
| `ratesCurrency` | currency of every rate in the policy; ABSENT means EUR | `z.enum(CURRENCIES)` = EUR, USD (shipping-policy.ts:77-79; Store/src/types/product.ts:12) |
| `freeOverCents` | free-shipping threshold | int (shipping-policy.ts:83-87) |
| `destinations[].countries[]` | ISO-2 codes or `"*"` (everywhere else) | `SHIPPING_COUNTRY_CODES` + `"*"` (shipping-policy.ts:44-59; constants.ts:129-136; Store/src/types/shipping-policy.ts:111) |
| `destinations[].rateCents` | flat rate per destination row | int (shipping-policy.ts:60-64) |
| `destinations[].area`, `.cost`, `.time` | seller's own words (a row may have NO `countries`: free text only) | text |
| `profiles[].rateCents` | per-profile rate override (ids referenced by `products.shipping_profile_id`) | int (Store/src/lib/validation/storefront.ts:689-706) |

### 1.2 Seller payment accounts and billing

| Table.column | Type / default / null | CHECK | Latest | Notes |
|---|---|---|---|---|
| `seller_payment_accounts.stripe_account_id` | text not null unique | `^acct_[A-Za-z0-9]{6,250}$` | 20261008_seller_payment_accounts.sql:33-49 | **No country, no business type, no currency column.** Also `charges_enabled`, `payouts_enabled`, `details_submitted`, `livemode` booleans |
| `seller_billing.price_cents` | integer null | `>= 0` | 20260930_seller_plans.sql:75-114 | The seller as OUR customer (plan subscription) |
| `seller_billing.currency` | text null | `null or ~ '^[A-Z]{3}$'` | 20260930_seller_plans.sql:83, 109-110 | |
| `seller_fee_waivers` | no money columns | `reason in ('closed_beta','founding_seller')` | 20261011_pricing_config.sql:355-361 | |

### 1.3 Products, options, add-ons, price history

| Table.column | Type / default / null | CHECK | Latest |
|---|---|---|---|
| `products.price_cents` | integer not null | `>= 0` (no upper bound in the DB; the app's `PRICE_CENTS_MAX` is not mirrored) | Replica:156 |
| `products.currency` | text not null default `'EUR'` | `currency in ('EUR','USD')` (inline, so auto-named `products_currency_check`) | Replica:157 |
| `products.digital_file_key` | text null | object-key shape via trigger | Replica:160; guard 20261105_object_keys_anywhere.sql:52-128 |
| `products.shipping_profile_id` | text null | `null or (length 1..64 and ~ '^[A-Za-z0-9_-]+$')`; not an FK | 20260904_product_shipping_profile.sql:32-43 |
| `products.option_groups` | jsonb not null default `'[]'` | array, <= 16384 bytes. No per-option price | 20260903_product_options.sql:29-72; 20260905_option_specifications.sql:19, 40 |
| `products.add_on_ids` | uuid[] not null default `'{}'` | `cardinality <= 4` + same-store trigger | 20261028_product_add_ons.sql:42-101 |
| `products.details` | jsonb not null default `'{}'` | object, <= 16384 bytes. Holds `origin` (country of manufacture text), not a sales geography | 20260902_product_page.sql:18-36, 47-48 |
| `products.max_per_order` | integer not null default 10 | 1..100 | 20260908_product_max_per_order.sql:27-32 |
| `products.stock_quantity`, `low_stock_threshold`, `track_stock` | int / int / bool | `>= 0`, tracked needs quantity | Replica:358-369 |
| `products.status` | text not null default `'draft'` | `status in ('draft','active')` | Replica:158 |
| `product_price_history.price_cents` | integer not null | `>= 0` | 20261004_discounts.sql:249-255 |
| `product_price_history.currency` | text not null | `currency in ('EUR','USD')` | 20261004_discounts.sql:253 |

Physical vs digital: the app treats `digital_file_key is not null` as digital (Store/src/lib/checkout/availability.ts:95, Store/src/lib/checkout/quote.ts:253).

### 1.4 Discounts

| Column | Type / default | CHECK | Latest |
|---|---|---|---|
| `discounts.value_type` | text not null | `in ('percent','amount')` | 20261004_discounts.sql:63 |
| `discounts.percent_off` | smallint | 1..90 when percent | 20261004_discounts.sql:84-92 |
| `discounts.amount_off_cents` | integer | 1..100000000 when amount | same |
| `discounts.currency` | text null | percent: must be null; amount: `currency in ('EUR','USD')` (constraint `discounts_value`) | same |
| `discounts.product_ids` | uuid[] | `applies_to` consistency, <= 500 | 20261004_discounts.sql:93-96 |

### 1.5 Storefronts and carts

| Table.column | Notes | Latest |
|---|---|---|
| `storefronts.config` (jsonb not null default `'{}'`) | No money or geography members any more: `seller` retired (20260905_seller_identity_on_profile.sql:59-65), `policies` and `shippingProfiles` retired (20260905_shipping_policy_on_profile.sql:116-123). Size <= 1 MB | 20261105_write_bounds.sql:49-51 |
| `storefronts.name` | 1..80 | Replica:337-344 |
| `carts.lines` (PENDING migration) | jsonb `[{productId, optionIds, quantity, source, addedAt}]`, no prices, no buyer data, <= 20 lines, <= 8 KB; `storefront_id` not null (one storefront, so one seller) | 20261120_shopping_cart.sql:93-117 |

### 1.6 Orders, order lines, refunds

| Table.column | Type / default / null | CHECK | Latest |
|---|---|---|---|
| `orders.currency` | text not null default `'EUR'` | **none** | Replica:301 |
| `orders.amount_cents` | integer not null | `>= 0` | Replica:299 |
| `orders.platform_fee_cents` | integer not null default 0 | `>= 0` | Replica:300 |
| `orders.product_price_cents` | integer not null | none | Replica:305 |
| `orders.shipping_cents` | integer null | `0..amount_cents` | 20260930_seller_plans.sql:55, 63-64 |
| `orders.platform_fee_bps` / `seller_plan` | smallint / text | 0..10000 / free, starter, pro | 20260930_seller_plans.sql:52-62 |
| `orders.discount_cents` / `discount_code` | int not null default 0 / text | `0..product_price_cents*quantity` / code shape | 20261004_discounts.sql:310-328 |
| `orders.ad_rate_bps`, `ad_fee_cents`, `application_fee_cents`, `fee_capped` | | ranges, fee parts add up | 20261011_pricing_config.sql:392-414 |
| `orders.ship_to` | jsonb null: `{name, line1, line2?, city, region?, postalCode?, country, phone?}` | `null or object`, `<= 2048` bytes. **No country rule** | 20260927_order_fulfilment.sql:64, 87-93, 112-113 |
| `orders.buyer_locale` | text | `^[a-z]{2}(-[A-Z]{2})?$` | 20260927_order_fulfilment.sql:96-97 |
| `orders.fulfilment_status` | text not null default `'unfulfilled'` | `unfulfilled, shipped, not_required` | 20260927_order_fulfilment.sql:66, 79-80 |
| `orders.channel` | text not null | `embed, marketplace, direct, button` | 20261005_buy_button_channel.sql:28-32 |
| `orders.status` | text not null default `'paid'` | `paid, refunded, disputed, pending` | Replica:297-298 |
| `orders.digital_file_key` | text | `^files/`, <= 512 | 20260928_checkout.sql:58-66 |
| `orders.refund_reason`, `refunded_at`, `payment_ref`, `stock_reserved` | | reason list, ref shape, 0..100 | 20261008_order_lifecycle.sql:67-90 |
| `orders.lines_digest`, `cart_id`, `more_product_ids`, `more_titles` (PENDING) | | shape, size | 20261120_shopping_cart.sql:57-75 |
| billing country, seller country snapshot | **do not exist** | | Store/src/types/supabase.ts:1417-1470 |
| `order_add_ons.product_price_cents`, `amount_cents`, `discount_cents`, `quantity` | ints | `>= 0`, `>= 0`, range, 1..100. **No currency column**: a line inherits `orders.currency` (view `order_lines`, 20261028_product_add_ons.sql:525-560) | 20261028_product_add_ons.sql:105-140 |
| `order_add_ons.source` (PENDING) | text not null default `'add_on'` | `add_on, cart` | 20261120_shopping_cart.sql:40-45 |
| `order_line_refunds.amount_cents` (PENDING) | integer not null | `>= 0`, no currency | 20261120_shopping_cart.sql:351-365 |

### 1.7 Fees, plan prices, other money

| Table.column | Type / default | CHECK | Latest |
|---|---|---|---|
| `plan_prices.price_cents`, `list_price_cents` | int | free = 0, paid > 0, list > price | 20261011_pricing_config.sql:118-157 |
| `plan_prices.currency` | text not null default `'EUR'` | `~ '^[A-Z]{3}$'` | 20261011_pricing_config.sql:129, 142 |
| `plan_prices.direct_fee_bps`, `marketplace_fee_bps` | int | 0..10000 | 20261011_pricing_config.sql:130-131, 144-145 |
| `plan_prices.stripe_lookup_key` | text | `^[a-z]+_[a-z]+_[a-z]{3}_v[0-9]+$` | 20261011_pricing_config.sql:147-148 |
| `fee_ledger.amount_cents` | int not null | sign by kind | 20261011_pricing_config.sql:539, 548-550 |
| `fee_ledger.currency` | text not null | `~ '^[A-Z]{3}$'`; copied from the order by `fee_ledger_record` | 20261011_pricing_config.sql:540, 551, 605-618 |
| `storefront_signals.value_cents`, `currency` | int / text | `>= 0` / length 3 | 20260830_storefront_signals.sql:82-83 |
| `ai_credit_usage` | micros of the billing currency, no currency column | | 20261104_ai_credit.sql:51 |
| `demo.sales_sim.currency` | text not null default `'EUR'` | none | 20260801_demo_sales_sim.sql:108-110 |

### 1.8 Waitlists and marketing tables

`waitlist_signups` (email, source, owner_id, list_id: Replica:1155-1162), Home `consent_logs` and `purchase_intent_clicks` (Home/supabase/migrations/20260925_purchase_intent_clicks.sql:9-13) hold no country or currency. Admin's tables (0001 to 0009) hold none either; Admin only READS `orders.currency = 'EUR'` (Admin/supabase/migrations/0008_plans_revenue.sql:51) and `seller_billing.currency` (0009_plan_directory.sql:42). SQ-app `artifacts`/`collections` hold no money (20260711_curation_foundation.sql, no price/currency columns).

---

## 2. Direct writes through PostgREST

### 2.1 Baseline grants

* Supabase's default privileges grant ALL on every new table, sequence and function in `public` to `anon`, `authenticated` and `service_role`. The replica shim copies them (Store/tests/db/shim.sql:187-194); the migrations rely on it (20260918_content_moderation.sql:16-24: "Supabase grants table-level UPDATE to authenticated by default").
* **No migration in any repo revokes table privileges on `profiles`, `products`, `storefronts` or `orders`** (grep for grant/revoke on those tables across Store, Admin, Home migrations and the replica returns nothing). So on those four tables RLS is the only row gate, and column restrictions exist only where a trigger enforces them.
* A column-level REVOKE cannot narrow a table-level grant in PostgreSQL, so the project uses guard triggers instead of column grants (20260918_content_moderation.sql:16-24; 20260926_contact_verification.sql:37-41).
* Every seller table carries a RESTRICTIVE policy "Require two-factor when enrolled" `FOR ALL TO authenticated USING/WITH CHECK (mfa_session_ok())`: profiles, products, storefronts, orders, team_members, notifications, security_events, storefront_signals and the SQ-app tables (20260923_two_factor_auth.sql:74-109), discounts (20261004_discounts.sql:165-170), fee_ledger (20261011_pricing_config.sql:580-584), order_add_ons (20261028_product_add_ons.sql:168-173), order_line_refunds (20261120_shopping_cart.sql:388-392, pending). It only demands aal2 when the account has a verified factor; it does not restrict columns or values.
* Writers by role (permission mirror, latest `team_role_can`: 20261008_order_lifecycle.sql:365-377): owner and editor hold `products.write` and `storefront.write`; viewer holds neither.

### 2.2 Per table

| Table | Grants to anon / authenticated | Policies (latest) | What a seller with their own JWT can set | DB constraint on country / currency |
|---|---|---|---|---|
| **profiles** | default ALL (never revoked) | SELECT own: `auth.uid() = id` (Replica:96-100). UPDATE own: USING and WITH CHECK `auth.uid() = id` (Replica:103-108). No INSERT or DELETE policy (rows come from `handle_new_user`, latest 20261021_reserved_usernames.sql:76-115). Team members cannot update the owner's profile. | Every column of their own row EXCEPT: `tax_business_name`, `seller_bio`, `shipping_policy` (raise 42501 unless `current_user in (service_role, postgres, supabase_admin)`: 20261012_auto_moderation.sql:735-777); `seller_*_verified_at` can only be cleared (20260926_contact_verification.sql:285-334); `avatar_url` must be moderation-approved (20261105_write_bounds.sql:167-200); `username` must not be reserved (20261021_reserved_usernames.sql:68-72) and is unique. **Freely settable: `tax_country`, `tax_vat_id`, `seller_address`, `seller_email`, `seller_phone`, `is_seller`, `locale`, `legal_accepted_*`, `deletion_requested_at`, onboarding flags.** | `tax_country` shape only (`^[A-Z]{2}$`, Replica:261-262). `shipping_policy` object + size only. No country list, no currency rule. |
| **products** | default ALL (never revoked) | SELECT `owner_id = auth.uid() or team_role_can(team_actor_role(owner_id),'store.read')`; INSERT WITH CHECK, UPDATE USING and WITH CHECK, DELETE USING: owner or `products.write` (Replica:915-942). | Every column EXCEPT the moderation set (`moderation_status`, `_ground`, `_note`, `moderated_at`, `moderated_by`, `moderation_review_requested_at`, `moderation_fields`, `moderation_decision_id`, `moderation_rev`, `moderation_checked_at`): refused on UPDATE, reset on INSERT (20261012_auto_moderation.sql:355-380). Object keys must be the writer's own uploads (20261105_object_keys_anywhere.sql:52-128). `add_on_ids` must be same-store products (20261028_product_add_ons.sql:60-101). Row counts capped (plan limit, ceiling 2000). **Freely settable: `price_cents` (>= 0, no ceiling), `currency` (EUR or USD), `status` ('active' with no publish-gate check in the DB), `track_stock`, `stock_quantity`, `max_per_order`, `shipping_profile_id`, `option_groups`, `details`, `purchase_url`, `title`, `description`.** | `products_currency_check in ('EUR','USD')` (Replica:157). Nothing about seller country, delivery, or that currency matches anything else. |
| **storefronts** | default ALL (never revoked) | SELECT member; INSERT/UPDATE/DELETE owner or `storefront.write` (Replica:950-977). | Every column except the moderation set (same gate); keys guarded; `config` <= 1 MB, `brief` <= 16 KB (20261105_write_bounds.sql:49-55); counts capped (plan limit, ceiling 200). | None. The table holds no money or geography today. |
| **discounts** | `revoke all` then `grant select, insert` (all columns) and `grant update (code, share_channel, value_type, percent_off, amount_off_cents, currency, applies_to, product_ids, starts_at, ends_at, usage_limit, enabled, archived_at)` to authenticated (20261004_discounts.sql:128-135) | SELECT member; INSERT owner or `products.write`; UPDATE owner or `products.write`; no DELETE (20261004_discounts.sql:137-163) | All columns on INSERT; the listed columns on UPDATE. `guard_discount_rules` (BEFORE INSERT OR UPDATE, invoker, service role exempt): no backdated automatic sale, owner and kind immutable, a started sale's terms (including `currency`) frozen (20261004_discounts.sql:178-245). | `discounts_value`: amount discounts `currency in ('EUR','USD')` (20261004_discounts.sql:84-92). No link to product currency. |
| **orders** | default ALL (never revoked) | SELECT member only (Replica:981-986). **No INSERT, UPDATE or DELETE policy**, so RLS denies all direct writes. | Nothing directly. Two SECURITY DEFINER RPCs (section 3): `order_mark_shipped` writes only `fulfilment_status`, `shipped_at`, `tracking_number`, `tracking_carrier`; `order_refund` writes `status`, `refunded_at`, `refund_reason` and restocks, and refuses provider-charged (`pi_`) orders. | `orders.currency`: none. `ship_to`: object + size only. |
| **order_add_ons** | `revoke all`; `grant select` to authenticated (20261028_product_add_ons.sql:156-158) | SELECT member (20261028_product_add_ons.sql:160-166) | Nothing. | No currency column. |
| **order_lines** (view) | `revoke all`; `grant select` (20261028_product_add_ons.sql:566-567); `security_invoker = true`; UNION, so not auto-updatable | n/a | Nothing. | n/a |
| **carts** (pending) | `revoke all` from public, anon, authenticated; service role only (20261120_shopping_cart.sql:125-127) | none | Nothing. | No price or currency stored. |
| **order_line_refunds** (pending) | select only (20261120_shopping_cart.sql:376-378) | SELECT member | Nothing. | none |
| **seller_payment_accounts** | `revoke all`; service role only (20261008_seller_payment_accounts.sql:61-63) | none (RLS on) | Nothing. | No country column exists. |
| **seller_billing**, **stripe_events**, **billing_switches** | `revoke all`; service role (20260930_seller_plans.sql:125-127, 150-152, 213-215) | none | Nothing. | shape only |
| **plans**, **plan_prices**, **plan_entitlements** | `revoke all`; `grant select` to authenticated (20261011_pricing_config.sql:334-336) | SELECT `using (true)` (20261011_pricing_config.sql:338-348) | Nothing. `plan_prices_guard` blocks edits and deletes of rows in force, even for the service role (20261011_pricing_config.sql:175-202). | shape only |
| **fee_ledger** | `revoke all` (including service role); select to authenticated; select, insert to service role (20261011_pricing_config.sql:565-569) | SELECT member | Nothing. | shape only |
| **product_price_history** | `revoke all`; service role (20261004_discounts.sql:263-266) | none | Nothing (written by trigger). | EUR/USD |
| **seller_fee_waivers** | `revoke all`; service role (20261011_pricing_config.sql:366-368) | none | Nothing. | n/a |
| **waitlist_signups** | default ALL | INSERT to anon, authenticated WITH CHECK `owner_id is null and list_id is null and length(email) <= 254 and length(source) <= 64` (20260807_db_hygiene.sql:43-54); insert-rate trigger 60/min (20261105_write_bounds.sql:159-162) | email, source | no geography columns |
| **storefront_signals** | insert/update/delete revoked; select only (20260830_storefront_signals.sql:136-140) | SELECT member | Nothing. | currency length 3 |

### 2.3 What the database does NOT stop a seller from doing directly

* Switch a product between EUR and USD, set any non-negative price, publish it (`status = 'active'`), or turn it from physical to digital by setting/clearing `digital_file_key` (an own upload) with their own JWT, skipping every server-action validator. Whether buyers then see it depends on read-side gates in the app (inferred; covered by other parts of this inventory).
* Set their own `tax_country` to any two capital letters, or rewrite `seller_address`, without the step-up and validation the Settings action applies (Store/src/lib/settings/actions.ts:446-548 is the app path; the database accepts the same columns directly).
* Create or edit an amount discount in EUR or USD for any of their products.
* Nothing at all on orders, order lines, carts, refunds, payment accounts, billing or fees: those are service-role only.

---

## 3. SQL functions that write the relevant tables

All in `public` unless noted. "Grants" are the latest explicit EXECUTE statements. Note on grants: PostgreSQL keeps a function's ACL on `CREATE OR REPLACE`; only a NEW function (new name or signature) picks up the default grant to anon/authenticated. The project restates grants after every replace by convention anyway (for example 20261028_product_add_ons.sql:340-342); 20261022_order_place_code_limit.sql replaced `order_place` without restating them, which leaves the earlier service-role-only ACL in place.

| Function | Security | EXECUTE | Writes | Validates | Re-checks currency / seller country / delivery country? | Latest definition |
|---|---|---|---|---|---|---|
| `order_place(jsonb)` | INVOKER | service_role only (20261028_product_add_ons.sql:341-342) | orders insert; products stock; order_add_ons lines + stock | `checkout_session_id` present; status paid or pending; `add_ons` array <= 4; code `usage_limit` under row lock (`discount_exhausted`); stock for main and every line (`insufficient_stock`), all in one transaction | **No.** Currency is taken from the JSON and defaulted to `'EUR'` when missing (line 231). No seller country, no `ship_to` country, no check that `product_id` or line products belong to `seller_id`, no currency match between lines, no amount vs price check. Trusts the caller entirely. | Applied: 20261028_product_add_ons.sql:183-342. Repo-latest (believed NOT applied): 20261120_shopping_cart.sql:171-340 (19 lines, `source`, `lines_digest`, `cart_id`, `more_*`; same trust model) |
| `order_confirm_paid(text,text)` | INVOKER | service_role (20261008_order_lifecycle.sql:262-263) | orders: pending to paid, payment_ref | idempotent on session | No | 20261008_order_lifecycle.sql:226-263 |
| `order_release_pending(text)` | INVOKER | service_role (20261028_product_add_ons.sql:394-395) | deletes a pending order; restocks products (main + lines) | status pending | No | 20261028_product_add_ons.sql:349-395 |
| `orders_release_expired(timestamptz)` | INVOKER, one SQL statement | service_role (20261028_product_add_ons.sql:440-441) | deletes expired pending orders and their lines; restocks products | expiry | No | 20261028_product_add_ons.sql:400-441 |
| `order_apply_refund(uuid,text,boolean)` | INVOKER | service_role (20261028_product_add_ons.sql:510-511) | orders status/refunded_at/reason; products and order_add_ons stock | reason list; status paid | No | 20261028_product_add_ons.sql:443-511 |
| `order_refund(uuid,text,boolean)` | **DEFINER** | authenticated, service_role (20261021_order_refund_provider_first.sql:62-63) | via `order_apply_refund` | `mfa_session_ok()`; owner or `orders.refund`; refuses `payment_ref like 'pi\_%'` | No | 20261021_order_refund_provider_first.sql:21-63 |
| `order_mark_shipped(uuid,text,text)` | **DEFINER** | authenticated, service_role (20261001_order_tracking_carrier.sql:132-133) | orders fulfilment columns only | 2FA; owner or `orders.fulfil`; status paid and not `not_required` | No | 20261001_order_tracking_carrier.sql:66-136 |
| `order_line_refund_amount(uuid,uuid)`, `order_apply_line_refund(uuid,uuid,text,boolean,integer)` (pending) | INVOKER | service_role (20261120_shopping_cart.sql:560-563) | order_line_refunds, products stock, order_add_ons, reviews, orders status | reason, amount >= 0, status paid, once per line | No | 20261120_shopping_cart.sql:396-563 |
| `decrement_stock(uuid,integer)` | INVOKER | service_role (20260908_product_max_per_order.sql:69-72) | products.stock_quantity | quantity > 0, <= max_per_order, enough stock | No | 20260908_product_max_per_order.sql:50-72 (probably superseded by `order_place`'s inline decrement; inferred) |
| `fee_ledger_record(...)` | INVOKER | service_role (20261011_pricing_config.sql:627-630) | fee_ledger insert | seller and currency read FROM the order, never the caller | Copies order currency (fails the ledger's `^[A-Z]{3}$` CHECK if the order's is malformed) | 20261011_pricing_config.sql:589-634 |
| `plan_price_change(...)` | INVOKER | service_role (20261011_pricing_config.sql:273-276) | plan_prices close + insert | advisory lock, start after open row | **Hardcodes `'EUR'`** and the `_eur_v<N>` lookup key (20261011_pricing_config.sql:254-265) | 20261011_pricing_config.sql:213-280 |
| `billing_apply_snapshot(...)` | INVOKER | service_role (20260930_seller_plans.sql:445-450) | seller_billing upsert | newer snapshot only | accepts any `^[A-Z]{3}$` | 20260930_seller_plans.sql:383-455 |
| `record_product_price()` (trigger fn) | DEFINER | revoked from all client roles (20261004_discounts.sql:283) | product_price_history | none | copies product currency into a table that only allows EUR/USD | 20261004_discounts.sql:270-296 |
| `moderation_settle`, `moderation_preview`, `moderation_claim`, `moderation_due`, `moderation_recheck_all` | various | service_role only (20261012_auto_moderation.sql:784-809) | products/storefronts moderation columns; `moderation_recheck_all` updates every 'ok' product and storefront | revision match | No (content only; `moderation_columns` lists no price or currency: 20261012_auto_moderation.sql:155-168) | 20261012_auto_moderation.sql:492-726; `moderation_recheck_all` redefined 20261013_marketplace_moderation.sql:139 |
| `issue_contact_verification`, `redeem_contact_verification` | INVOKER | service_role (20260926_contact_verification.sql:266-269) | contact_verifications; profiles `*_verified_at` | code HMAC, attempts, value unchanged | No | 20260926_contact_verification.sql |
| `handle_new_user()` (trigger on auth.users) | DEFINER | revoked (20261021_reserved_usernames.sql:119) | profiles insert: `id, username, avatar_url` only (so every new profile has `tax_country` null) | reserved slug | No | 20261021_reserved_usernames.sql:76-115 |
| `carts_sweep(timestamptz)` (pending) | INVOKER | service_role (20261120_shopping_cart.sql:146-147) | deletes carts | age | No | 20261120_shopping_cart.sql:131-150 |
| `record_signal(...)` | INVOKER | service_role (20261117_record_signal.sql:80-83) | storefront_signals | none | No | 20261117_record_signal.sql:34-67 |
| `discount_performance`, `analytics_aggregate`, `dashboard_orders_aggregate`, `product_sales_aggregate`, `products_ranked_by_metric`, `analytics_weekday_products`, `fee_ledger_summary` | INVOKER, read only | authenticated, service_role | none | | Treat `currency <> 'USD'` as EUR (CZK would be summed as euros): 20261028_product_add_ons.sql:595, 606, 807; 20261117_perf_indexes.sql:300, 327, 334, 370, 381; pending 20261120_shopping_cart.sql:744, 808, 852, 863 | |
| `billing_sales_summary`, `billing_sales_30d` | INVOKER, read only | service_role | none | | Filter `currency = 'EUR'` (20261004_discounts.sql:361; 20261011_pricing_config.sql:690) | |
| `demo.sales_sim_emit`, `demo.sales_sim_ship`, `demo.sales_sim_tick` | DEFINER | revoked from clients; tick granted to service_role (20260927_demo_sales_sim_fulfilment.sql:308-314) | **orders insert directly (not through `order_place`)** with `cfg.currency` and `demo.ship_to()` (IE, DE, FR, NL, IT, ES, CZ, PL, PT, SK); orders update to shipped; orders and signals delete past retention | `enabled` and `seller_id` set | No | 20260927_demo_sales_sim_fulfilment.sql:49-81, 88-190, 197-220, 226-304 |
| Admin `admin_revenue_summary` etc. | service_role | | none (read) | | `o.currency = 'EUR'` | Admin/supabase/migrations/0008_plans_revenue.sql:51, 152-154 |

**Discount functions:** none write discounts; the app writes them under RLS. **Account deletion:** no SQL function. The job runs in the app with the service role (Store/.github/workflows/scheduled.yml:4-8, 44-75) and relies on FK cascades: products and storefronts `owner_id -> auth.users on delete cascade` (Replica:153, 220), **orders `seller_id -> auth.users on delete cascade`** (Replica:293), order_add_ons seller cascade (20261028_product_add_ons.sql:109), discounts owner cascade (20261004_discounts.sql:55), seller_payment_accounts cascade (20261008_seller_payment_accounts.sql:34), fee_ledger set null (20261011_pricing_config.sql:535-536). A violation report must be captured before any deletion runs, since deleting an account deletes its orders.

---

## 4. Triggers and guards on the relevant tables

| Table | Trigger (timing) | Function (security) | Enforces | Who is exempt | Latest |
|---|---|---|---|---|---|
| products, storefronts, artifacts | `<t>_moderation_gate` BEFORE INSERT OR UPDATE | `moderation_gate` (DEFINER) | seller cannot write moderation state; content change sets 'ok' only if every part is pre-approved, else 'pending' | `current_setting('role')` in none, service_role, postgres, supabase_admin | 20261012_auto_moderation.sql:332-480 |
| products, storefronts, artifacts | `<t>_moderation_approval` AFTER UPDATE OF moderation_status | `moderation_remember_approval` (DEFINER) | records staff approvals | | 20261012_auto_moderation.sql:430-478 |
| products, storefronts | `guard_object_keys` BEFORE INSERT OR UPDATE (all columns) | `guard_object_keys` (INVOKER) | an object key NEW to the row must be the writer's own upload | `auth.role() <> 'authenticated'` | 20261105_object_keys_anywhere.sql:52-128 |
| products | `guard_add_on_ids` BEFORE INSERT OR UPDATE OF add_on_ids | `guard_add_on_ids` (INVOKER) | not itself, no duplicates, an id NEW to the row must be a product of the same owner | none (applies to all) | 20261028_product_add_ons.sql:60-101 |
| products | `products_plan_limit` BEFORE INSERT OR UPDATE OF owner_id | `enforce_plan_limit('products')` (DEFINER) | plan cap, only while `billing_switches.plan_limits_enforced` (ships off) | not authenticated | trigger 20261002_product_limits.sql:151-154; function 20261019_removed_content_frees_plan_room.sql:28-115 |
| storefronts | `storefronts_plan_limit` | same, `'storefronts'` | | | 20260930_seller_plans.sql:363-366 |
| products / storefronts | `products_account_ceiling` / `storefronts_account_ceiling` BEFORE INSERT OR UPDATE OF owner_id | `guard_account_ceiling('2000' / '200')` (DEFINER) | hard row ceiling | not authenticated | 20261105_write_bounds.sql:69-114 |
| products | `products_record_price_insert` AFTER INSERT; `products_record_price_update` AFTER UPDATE OF price_cents, currency WHEN changed | `record_product_price` (DEFINER) | price history (EU 30-day prior price) | none | 20261004_discounts.sql:270-296 |
| products, storefronts | `*_set_updated_at` BEFORE UPDATE | `set_updated_at` | timestamp | | Replica:191-205, 246-248 |
| discounts | `discounts_guard_rules` BEFORE INSERT OR UPDATE | `guard_discount_rules` (INVOKER) | no backdated sale; owner/kind immutable; started sale frozen | `current_user` in service_role, postgres, supabase_admin | 20261004_discounts.sql:178-245 |
| profiles | `profiles_guard_seller_text` BEFORE INSERT OR UPDATE | `guard_seller_text` (INVOKER) | `tax_business_name`, `seller_bio`, `shipping_policy` service-role only | `current_user` trusted | 20261012_auto_moderation.sql:735-777 |
| profiles | `profiles_guard_contact_proof` BEFORE INSERT OR UPDATE | `guard_contact_proof` (INVOKER) | proofs only by trusted writers; dropped on value change | `current_user` trusted | 20260926_contact_verification.sql:285-334 |
| profiles | `profiles_guard_avatar_url` BEFORE INSERT OR UPDATE OF avatar_url | `guard_avatar_url` (DEFINER) | avatar must be moderation-approved | not authenticated | 20261105_write_bounds.sql:167-200 |
| profiles | `profiles_sync_directory` AFTER INSERT OR UPDATE OF is_public, username, avatar_url | `sync_profile_directory` | public directory | | 20260924_public_profiles_invoker.sql:129-130; fn 20261013_marketplace_moderation.sql:80 |
| profiles | `team_seed_owner` AFTER INSERT | DEFINER | owner membership row | | Replica:723-743 |
| orders | `reviews_unverify_refunded` AFTER UPDATE OF status WHEN refunded | DEFINER | review loses verified badge | | 20261025_reviews.sql:330-352 |
| plan_prices | `plan_prices_guard` BEFORE UPDATE OR DELETE | INVOKER | append-only history, applies to the service role too | none | 20261011_pricing_config.sql:175-202 |
| seller_payment_accounts | `seller_payment_accounts_set_updated_at` | `set_updated_at` | timestamp | | 20261008_seller_payment_accounts.sql:56-59 |
| waitlist_signups | `waitlist_signups_insert_rate` BEFORE INSERT | `guard_anonymous_insert_rate('60')` (DEFINER) | 60 anonymous inserts per minute | not anon/authenticated | 20261105_write_bounds.sql:121-162 |

No trigger or CHECK anywhere concerns a country, and the only currency rules are the EUR/USD lists on products, product_price_history and discounts. Three "who is trusted" tests coexist: `current_user` (INVOKER guards), `current_setting('role')` (the DEFINER moderation gate), `auth.role()` (key, ceiling and limit guards).

---

## 5. pg_cron jobs and other schedulers

| Job | Schedule | Calls | Writes | Defined |
|---|---|---|---|---|
| `demo-sales-sim` | `*/20 * * * *` | `demo.sales_sim_tick()` | inserts `public.orders` (EUR by default, ten EU ship-to countries), marks them shipped, deletes old orders and `storefront_signals`, writes `demo.sales_sim`. No-op unless `demo.sales_sim.enabled` and `seller_id` are set | 20260801_demo_sales_sim.sql:482-485; tick latest 20260927_demo_sales_sim_fulfilment.sql:226-304 |
| `rate-limit-gc` | `17 * * * *` | `rl_gc_keys()` | deletes expired `rate_limit_keys` | 20260807_db_hygiene.sql:65-68 |
| `orders-release-expired` | `*/5 * * * *` | `orders_release_expired()` | deletes expired pending orders and their `order_add_ons`; restocks `products` | 20261008_order_lifecycle.sql:349-359; body 20261028_product_add_ons.sql:400-441 |
| `carts-sweep` (pending migration) | `23 3 * * *` | `carts_sweep()` | deletes idle and paid carts | 20261120_shopping_cart.sql:154-164 |
| `admin-notification-scan` (manual, optional) | `* * * * *` | `admin_notification_scan_tick()` | none of the tables in scope: `pg_net` POST to the admin app; no-op until Vault secrets exist | Admin/supabase/migrations/0006_admin_notifications.sql:128-184 (the schedule is a commented instruction, not executed by the migration) |

The cron-creating blocks in Store are guarded with `if exists (select 1 from pg_extension where extname = 'pg_cron')` so the embedded-Postgres replica (no pg_cron) can replay them (20261008_order_lifecycle.sql:349-359).

Non-pg_cron schedulers (relevant for a monitoring check): GitHub Actions `Store/.github/workflows/scheduled.yml` (daily 03:23 UTC: account deletions, terms notices, review reminders, agent cleanup, funnel rollup, each a POST to `/api/cron/<job>` with `CRON_SECRET`, lines 1-2, 31-35, 44-186) and `moderation-sweep.yml` (`*/5`, line 27-30). `ops/uptime` is a Cloudflare Worker with a per-minute cron (Store/ops/uptime/wrangler.jsonc:19).

---

## 6. Migrations present but believed NOT applied, and stale markers

How production state is tracked: hand-applied migrations write no ledger row, so `check-prod-migrations.ts` sees nothing after 2026-09-18 (its TRIAGE ends at `20260918154058`, Store/scripts/check-prod-migrations.ts:209-214) and the deploy gate instead probes for sentinel objects (Store/scripts/lib/prod-schema.ts:4-24, `HAND_APPLIED_FROM = "20260923"` line 43). The replica's "(pending)" headers are known to go stale (prod-schema.ts:9-11).

| Migration | Belief | Evidence |
|---|---|---|
| `20261120_shopping_cart.sql` | **NOT applied** (committed in a48b90e) | memory `shopping-cart-architecture.md:11` (2026-11-20: "NOT in prod yet"); replica header "(pending)" Replica:13838; the schema gate demands its objects (prod-schema.ts:173-203), so no Store deploy can happen until it is applied |
| `20261027_reviews_buyers_only.sql` | **NOT applied** | prod-schema.ts:53-54; memory `buyer-reviews.md:3` |
| `20260720_interaction_events.sql` | never applied (memory, unverified) | memory `content-moderation-architecture.md:34` |
| Admin 0006 cron schedule | unknown (manual step) | Admin/supabase/migrations/0006_admin_notifications.sql:132-149 |
| `20261011_pricing_config.sql` | applied 2026-10-20 (replica header "(pending)" at Replica:7773 is stale) | memory `pricing-config-architecture.md:56`; sentinels prod-schema.ts:97-102 |
| `20261012_auto_moderation.sql`, `20261013_marketplace_moderation.sql` | applied (headers at Replica:8479, 9475 stale) | memory `auto-moderation-wall.md:3, 17-18, 186`; unprobed by design (prod-schema.ts:49-52) |
| `20261012_storefront_funnel_daily.sql` | applied 2026-10-20 (Replica:9293 header stale) | memory `storefront-funnel-analytics.md:24`; sentinels prod-schema.ts:103-105 |
| `20261105_object_keys_anywhere.sql`, `20261105_write_bounds.sql` | applied 2026-11-08 | memory `security-audit-2026-11.md:3`; sentinels prod-schema.ts:154-158 |
| `20261031_terms_notices`, `20261117_perf_indexes`, `20261117_record_signal` | applied (deployed 2026-11-20) | memory `speed-cost-pass-2026-11.md:14-15`; `terms-notice-system` in MEMORY.md |
| `20261028_product_add_ons.sql` | applied 2026-10-30 | memory `product-add-ons.md:3` |
| `20260927_demo_sales_sim_fulfilment.sql` | applied 2026-09-28 | memory `order-fulfilment-architecture.md:11` |

Consequences for the build:
* A new constraint or trigger must not reference `carts`, `order_add_ons.source`, `orders.lines_digest`, `orders.cart_id`, `orders.more_product_ids`, `orders.more_titles`, `order_line_refunds` or `reviews_require_purchase()` unless it is applied after `20261120_shopping_cart.sql`.
* If the build redefines `order_place`, it must start from the 20261120 body and be applied after it; a `CREATE OR REPLACE` based on the 20261028 body applied later would silently drop the cart's 19-line support, and one based on 20261120 applied first would make the cart migration overwrite it.
* Production may hold SQ-app migrations that exist in no repo (`sq_app_*`, memory `test-db-isolation.md:24-27`); they could alter grants or policies invisibly to this inventory.

---

## 7. Design facts for the build phase

### 7.1 The TypeScript lists a database allow-list would mirror

| List | Values today | Where |
|---|---|---|
| `CURRENCIES` | EUR, USD (no CZK) | Store/src/types/product.ts:12 |
| `OPERATING_COUNTRIES` / `_CODES` (seller country, ships-from) | 27 EU + US + CA | Store/src/lib/settings/constants.ts:110-116 |
| `SHIPPING_COUNTRY_CODES` (checkout ship-to, destination rows) | same 29 | constants.ts:129-136; checkout `country: z.enum(SHIPPING_COUNTRY_CODES)` Store/src/lib/validation/checkout.ts:38-41 |
| `SHIP_ANYWHERE` | `"*"` | Store/src/types/shipping-policy.ts:111 |
| tax country refine | `OPERATING_COUNTRY_CODES` | Store/src/lib/validation/settings.ts:131-134 |

### 7.2 Existing conventions for mirroring a TypeScript list in SQL, and their drift tests

| Pair | SQL side | Drift test |
|---|---|---|
| Role to permission map | `team_role_can()` (latest 20261008_order_lifecycle.sql:365-377; "MIRROR of src/lib/team/permissions.ts. Edit BOTH together", Replica:461) | Spot checks per new action against the replica DB: tests/integration/28-order-fulfilment.test.ts:107-109, 29-seller-plans.test.ts:601-603, 33-order-lifecycle.test.ts:147-149 |
| Notification types | `notifications_type_check` (20260918_content_moderation.sql:167-182; later widened, sentinel prod-schema.ts:127) | Behavioural: insert the new type, refuse an unknown one (tests/integration/21-content-moderation.test.ts:11-14, 506-517) |
| `ORDER_CHANNELS` | `orders_channel_check` + `storefront_signals_channel_check` (20261005_buy_button_channel.sql:10-11, 28-43) | Static: parses the LAST definition of each CHECK in the replica text and compares to the TS array (tests/unit/order-channel.test.ts:82-102) |
| `RESERVED_USERNAMES` | IMMUTABLE function `username_is_reserved()` used inside a CHECK (20261021_reserved_usernames.sql:60-72); the writing roles need EXECUTE on it (lines 63-66) | Static: parses the array out of the migration file (tests/unit/reserved-usernames-sql.test.ts:11-34) |
| Plan limits | `plan_limit()` (latest 20261002_product_limits.sql:44-60) | Calls the SQL function in the replica for every plan and key (tests/integration/29-seller-plans.test.ts:89-96) |
| Pricing enums and seeds | enum types + seed rows (20261011_pricing_config.sql:46-52) | tests/integration/36-pricing-config.test.ts (not opened; inferred from the migration header) |
| Carrier ids (counter-example) | CHECK holds only the SHAPE `^[a-z0-9-]{2,24}$`; the list lives in the app alone, "so adding a carrier is one edit and cannot leave a database list behind it" (20261001_order_tracking_carrier.sql:19-23, 45-49) | none needed |
| Launch switches (config table read by a trigger) | single-row `billing_switches`, read by BOTH the app and `enforce_plan_limit` "so the two can never disagree" (20260930_seller_plans.sql:195-215, 308) | tests/integration/29-seller-plans.test.ts:58-87 |
| Prices as rows (config without a deploy) | `plan_prices` (20261011_pricing_config.sql:4-9, 118-164) | test 36 (inferred) |

### 7.3 Where a configuration-driven allow-list could sit (facts, not a design)

| Option | Precedent | Change to add a country later | Facts and limits |
|---|---|---|---|
| CHECK with a literal list | `products_currency_check`, `orders_channel_check`, `discounts_value` | a migration | Simplest; static drift test pattern exists. A CHECK is re-evaluated on EVERY update of a row, so tightening it bites legacy rows on unrelated updates (7.4). |
| CHECK calling an IMMUTABLE SQL function holding the list | `username_is_reserved()` in `profiles_username_not_reserved` | a migration (one function body) | Needs EXECUTE for every writing role. A CHECK must not read a table: PostgreSQL never re-validates it when the table changes and dump/restore ordering breaks, so this option cannot be "a config row". |
| Small config table read by a trigger | `billing_switches` + `enforce_plan_limit` | an INSERT/UPDATE, no migration | Matches "config change". The trigger must be SECURITY DEFINER if clients cannot read the table (as `enforce_plan_limit`, `moderation_gate`). A trigger can fire only on INSERT and on `UPDATE OF <specific columns>` (precedents: `products_record_price_update ... after update of price_cents, currency ... when (...)`, 20261004_discounts.sql:292-296; "only values NEW to the row are judged", 20261021_object_key_ownership.sql:89-90, 20261028_product_add_ons.sql:80-81), which leaves legacy rows' unrelated updates alone. The new table must have RLS (auto-enabled by the `ensure_rls` event trigger, shim.sql:196-235), explicit revokes (auto-grant trap: memory `postgrest-auto-grant-trap.md`), and either a client SELECT policy plus the RESTRICTIVE 2FA policy (test 22) or an entry in `POLICY_FREE_BY_DESIGN` with a reason (tests/integration/19-rls-coverage.test.ts:28, 96-122, 181-182). |
| Domain type | none in any repo (no `create domain` anywhere) | `ALTER DOMAIN ... ADD CONSTRAINT ... NOT VALID` (migration) | Cannot reach inside jsonb (`shipping_policy`, `ship_to`). |

Who must NOT be exempt: unlike every existing guard, a compliance rule must also bind the service role, because the service role is the ONLY writer of orders (`order_place`, the demo simulator) and of `profiles.shipping_policy` (guard_seller_text). A role-gated trigger in the style of `guard_object_keys` (`auth.role() <> 'authenticated'` returns early) would miss exactly the paths R3 and R6 care about. Products are written by the app with the user's session client (Store/src/lib/products/actions.ts:6, 378), so an authenticated-only guard would cover app and PostgREST product writes alike, but not service-role seeding or fixtures.

### 7.4 NOT VALID: what it can and cannot do here

* PostgreSQL allows `ADD CONSTRAINT ... CHECK (...) NOT VALID` and FK NOT VALID; NOT NULL and UNIQUE cannot be NOT VALID. No migration in any repo has used NOT VALID so far; the established practice is to pre-check production data read-only and then add a validated CHECK (memory `supabase-connector-writes-declined.md:25`).
* A NOT VALID CHECK skips existing rows only at creation. Every later UPDATE of a legacy row re-checks the new row version. Updates that would then fail on a legacy EUR product or a legacy non-CZ/EUR order:
  * products: `order_place` stock decrement (20261028_product_add_ons.sql:274-280, 309-315), restock in `order_release_pending` (367-389), `orders_release_expired` (one statement for ALL expired orders: one bad row rolls back the whole sweep, 400-441), `order_apply_refund` restock (477-499), `order_apply_line_refund` restock (pending, 20261120_shopping_cart.sql:526-531), `moderation_recheck_all` (one UPDATE over every 'ok' product, 20261012_auto_moderation.sql:722 and its 20261013 redefinition), `moderation_settle`, any seller edit.
  * orders: `order_confirm_paid` (20261008_order_lifecycle.sql:238-244), `order_mark_shipped` (20261001_order_tracking_carrier.sql:113-125), `order_apply_refund` (20261028_product_add_ons.sql:471-475), the review-reminder columns (20261102), the fee correction the app makes after Stripe confirms (memory `pricing-config-architecture.md:42`), the demo simulator's ship step (20260927_demo_sales_sim_fulfilment.sql:210-216).
* Safe as plain validated constraints right away (widening only, every existing row already passes): adding `'CZK'` to `products_currency_check`, `product_price_history`'s currency CHECK and `discounts_value`. These three must change together (headline 1).
* For orders, an insert-time rule (BEFORE INSERT trigger) never touches legacy rows. A CHECK with a cut-over predicate on `created_at` is another shape: `order_place` never sets `created_at` (its insert list, 20261028_product_add_ons.sql:219-227, omits it), but the demo simulator writes past timestamps explicitly (20260927_demo_sales_sim_fulfilment.sql:166, 181).
* A rule requiring `tax_country = 'CZ'` cannot sit on `profiles` as a plain CHECK: buyers and sellers share the table and `handle_new_user` inserts every new profile with `tax_country` null (20261021_reserved_usernames.sql:103-112). "Seller" is not a column (`is_seller` is unused). Seller-specific anchors that do exist: `seller_payment_accounts` (one row per connecting seller, service-role written, the natural home for a Stripe `country` column), and INSERT/UPDATE of `products`/`storefronts` (a trigger could look up the owner's profile).
* `profiles.shipping_policy` can only be written by the service role today, so a jsonb rule there (for example a CHECK using `jsonb_path_exists`, which is IMMUTABLE) would bind the Settings save path; legacy non-CZ policies would fail only on their next save, which is the point at which they must comply anyway.

### 7.5 Hardcoded EUR in SQL that a CZK beta touches

`products.currency default 'EUR'` (Replica:157); `orders.currency default 'EUR'` (Replica:301); `order_place` `coalesce(incoming.currency, 'EUR')` (20261028_product_add_ons.sql:231; pending 20261120_shopping_cart.sql:220); analytics `currency <> 'USD'` counts CZK as EUR (section 3 row); `billing_sales_summary` / `billing_sales_30d` `= 'EUR'` (20261004_discounts.sql:361, 20261011_pricing_config.sql:690); `plan_price_change` `'EUR'` and `_eur_v` (20261011_pricing_config.sql:254-265); `demo.sales_sim.currency default 'EUR'` (20260801_demo_sales_sim.sql:110); Admin revenue `= 'EUR'` (Admin/supabase/migrations/0008_plans_revenue.sql:51).

### 7.6 Process facts

* Every new migration needs a sentinel in `Store/scripts/lib/prod-schema.ts` (tests/unit/prod-schema.test.ts fails otherwise, prod-schema.ts:18-20). A widened CHECK has its own probe kind: `{ kind: "check", constraint, allows }` (prod-schema.ts:33-34, 231-237), directly usable for `products_currency_check` allowing `CZK`.
* Replay each applied migration into `Store/tests/db/prod-migrations.sql` (Store/scripts/check-prod-schema.ts:103-104).
* Migration files must be ASCII: the Windows embedded-Postgres replica is WIN1252 and non-ASCII box-drawing characters stopped the suite (memory `auto-moderation-wall.md:156-158`).
* Migrations are applied by hand (SQL editor or Management API); the Supabase connector's `apply_migration` auto-declines (memory `supabase-connector-writes-declined.md:3, 25`).
* Read-only production access exists without the service key: role `backup_reader` (LOGIN, BYPASSRLS, `pg_read_all_data`, behind repo secret `BACKUP_DB_URL`) and the Management API query endpoint with `read_only: true` (memory `prod-ops-roles-and-secrets.md:14-15`; Store/scripts/check-prod-schema.ts:50-61). Either suits the violation report and a scheduled monitor; `schema_probe` has no table privileges and cannot.

---

## 8. Read-only SQL for the existing-data violation report

Run as `backup_reader` or through the Management API with `read_only: true`. SELECT only. Output columns are ids, the seller handle (`profiles.username`) and the offending value; no emails, names, addresses, phone numbers, cart ids (a cart id is the buyer's capability, 20261120_shopping_cart.sql:94-96) or discount codes (secrets, memory `discounts-architecture.md:3`). Nothing here deletes or disables anything. Run it BEFORE any account deletion job touches the accounts, because deleting an account cascades to its orders.

### 8.0 Context (optional)

```sql
-- Which seller the demo simulator writes for, and whether it is on.
-- Needs read access to schema demo (backup_reader has pg_read_all_data).
select seller_id, enabled, currency, storefront_id, last_tick_at from demo.sales_sim;

-- Which cron jobs exist.
select jobname, schedule, command, active from cron.job order by jobname;

-- Is the cart migration applied? (null = no; skip 8.6 then)
select to_regclass('public.carts') as carts_table;
```

### 8.1 Counts

```sql
with sellers as (
  -- "A seller" = anyone with a product, a storefront, a connected account or an order.
  -- (The fee-waiver backfill used products + storefronts: 20261011_pricing_config.sql:372-379.)
  select owner_id as seller_id from public.products
  union select owner_id from public.storefronts
  union select owner_id from public.seller_payment_accounts
  union select seller_id from public.orders
),
sp as (
  select s.seller_id, p.username, p.tax_country, p.seller_address, p.shipping_policy
  from sellers s
  left join public.profiles p on p.id = s.seller_id
),
dest_rows as (
  select sp.seller_id, d.ord, d.dest
  from sp
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(sp.shipping_policy -> 'destinations') = 'array'
         then sp.shipping_policy -> 'destinations' else '[]'::jsonb end
  ) with ordinality as d(dest, ord)
),
dest_codes as (
  select r.seller_id, r.ord, c.code
  from dest_rows r
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(r.dest -> 'countries') = 'array'
         then r.dest -> 'countries' else '[]'::jsonb end
  ) as c(code)
)
select
  (select count(*) from sellers)                                                        as sellers_total,

  -- R1: seller established in CZ
  (select count(*) from sp where tax_country is null)                                   as r1_country_unset,
  (select count(*) from sp where tax_country is not null and tax_country <> 'CZ')       as r1_country_not_cz,
  (select count(*) from sp where seller_address is null)                                as r1_address_unset,
  (select count(*) from sp where shipping_policy ->> 'shipsFrom' is not null
                             and shipping_policy ->> 'shipsFrom' <> 'CZ')               as r1_ships_from_not_cz,
  (select count(*) from public.seller_payment_accounts)                                 as r1_connected_accounts_to_check_in_stripe,
  (select count(*) from sellers s where not exists (
     select 1 from public.seller_payment_accounts a where a.owner_id = s.seller_id))   as r1_sellers_without_connected_account,

  -- R2: CZK only
  (select count(*) from public.products where currency <> 'CZK')                        as r2_products_not_czk,
  (select count(*) from public.products where currency <> 'CZK'
     and status = 'active' and moderation_status = 'ok')                                as r2_live_products_not_czk,
  (select count(*) from public.discounts where value_type = 'amount'
     and currency is distinct from 'CZK')                                               as r2_amount_discounts_not_czk,
  (select count(*) from public.discounts where value_type = 'amount'
     and currency is distinct from 'CZK' and archived_at is null
     and (ends_at is null or ends_at > now()))                                          as r2_live_amount_discounts_not_czk,
  (select count(*) from sp where shipping_policy is not null
     and coalesce(shipping_policy ->> 'ratesCurrency', 'EUR') <> 'CZK'
     and (   jsonb_path_exists(shipping_policy, '$.destinations[*].rateCents')
          or jsonb_path_exists(shipping_policy, '$.freeOverCents')
          or jsonb_path_exists(shipping_policy, '$.profiles[*].rateCents')))            as r2_shipping_rates_not_czk,
  (select count(*) from public.orders where currency <> 'CZK')                          as r2_orders_not_czk,
  (select count(*) from public.orders where currency <> 'CZK'
     and status in ('paid', 'pending'))                                                 as r2_paid_or_pending_orders_not_czk,

  -- R3: delivery to CZ only
  (select count(distinct seller_id) from dest_codes where code <> 'CZ')                 as r3_policies_listing_non_cz,
  (select count(distinct r.seller_id) from dest_rows r
     where jsonb_typeof(r.dest -> 'countries') is distinct from 'array')                as r3_policies_with_free_text_destinations,
  (select count(*) from public.products pr
     left join public.profiles p on p.id = pr.owner_id
     where pr.digital_file_key is null and pr.status = 'active'
       and pr.moderation_status = 'ok' and p.shipping_policy is null)                   as r3_live_physical_products_owner_has_no_policy,
  (select count(*) from public.orders where ship_to is not null
     and upper(coalesce(ship_to ->> 'country', '')) <> 'CZ')                            as r3_orders_shipped_outside_cz,
  (select count(*) from public.orders where ship_to is not null
     and upper(coalesce(ship_to ->> 'country', '')) <> 'CZ'
     and status = 'paid' and fulfilment_status = 'unfulfilled')                         as r3_unsent_paid_orders_outside_cz,

  -- R4: no billing-country column exists; this is only the population it would apply to
  (select count(*) from public.orders
     where fulfilment_status = 'not_required' or digital_file_key is not null)          as r4_digital_orders_no_billing_country_stored,

  -- R5 proxies: lines or add-on links that cross sellers
  (select count(*) from public.orders o join public.products pr on pr.id = o.product_id
     where pr.owner_id <> o.seller_id)                                                  as r5_orders_main_line_other_seller,
  (select count(distinct a.order_id) from public.order_add_ons a
     join public.products pr on pr.id = a.product_id
     where pr.owner_id <> a.seller_id)                                                  as r5_orders_add_on_line_other_seller,
  (select count(*) from public.products pr
     join public.products ao on ao.id = any (pr.add_on_ids)
     where ao.owner_id <> pr.owner_id)                                                  as r5_add_on_links_other_seller;
```

```sql
-- Currency mix per table (informational; plan_prices and seller_billing are the
-- platform's own subscription, not seller prices).
select 'products' as source, currency, count(*) from public.products group by currency
union all select 'product_price_history', currency, count(*) from public.product_price_history group by currency
union all select 'discounts (amount)', currency, count(*) from public.discounts where value_type = 'amount' group by currency
union all select 'orders', currency, count(*) from public.orders group by currency
union all select 'fee_ledger', currency, count(*) from public.fee_ledger group by currency
union all select 'plan_prices', currency, count(*) from public.plan_prices group by currency
union all select 'seller_billing', currency, count(*) from public.seller_billing group by currency
order by 1, 2;
```

### 8.2 R1 rows: sellers

```sql
with sellers as (
  select owner_id as seller_id from public.products
  union select owner_id from public.storefronts
  union select owner_id from public.seller_payment_accounts
  union select seller_id from public.orders
)
select s.seller_id,
       p.username,
       p.tax_country,
       (p.seller_address is null)                      as address_unset,
       p.shipping_policy ->> 'shipsFrom'               as ships_from,
       exists (select 1 from public.seller_payment_accounts a
               where a.owner_id = s.seller_id)          as has_connected_account
from sellers s
left join public.profiles p on p.id = s.seller_id
where p.tax_country is distinct from 'CZ'
   or (p.shipping_policy ->> 'shipsFrom' is not null and p.shipping_policy ->> 'shipsFrom' <> 'CZ')
order by p.username nulls last, s.seller_id;
```

```sql
-- Connected accounts. The account's country is NOT in the database: look each
-- stripe_account_id up in Stripe (Account.country) outside SQL.
select a.owner_id as seller_id, p.username, a.stripe_account_id, a.livemode,
       a.charges_enabled, a.payouts_enabled, a.details_submitted, a.created_at
from public.seller_payment_accounts a
left join public.profiles p on p.id = a.owner_id
order by a.created_at;
```

```sql
-- Optional heuristic only: does the free-text business address mention Czechia?
-- Returns a boolean, never the address. A false here is "unknown", not "not CZ".
with sellers as (
  select owner_id as seller_id from public.products
  union select owner_id from public.storefronts
  union select owner_id from public.seller_payment_accounts
)
select s.seller_id, p.username,
       p.seller_address is not null as has_address,
       coalesce(p.seller_address ~* '(czech|cesk|\mCZ\M|\mCR\M)', false) as address_mentions_cz
from sellers s
left join public.profiles p on p.id = s.seller_id
order by address_mentions_cz, p.username nulls last;
```

### 8.3 R2 rows: prices, discounts, shipping rates, orders

```sql
select pr.id as product_id, pr.owner_id as seller_id, p.username, pr.currency, pr.price_cents,
       pr.status, pr.moderation_status, (pr.digital_file_key is not null) as is_digital, pr.created_at
from public.products pr
left join public.profiles p on p.id = pr.owner_id
where pr.currency <> 'CZK'
order by pr.owner_id, pr.created_at;
```

```sql
-- Discount codes are deliberately not selected (they are secrets).
select d.id as discount_id, d.owner_id as seller_id, p.username, d.kind, d.value_type,
       d.amount_off_cents, d.currency, (d.archived_at is null) as not_archived, d.starts_at, d.ends_at
from public.discounts d
left join public.profiles p on p.id = d.owner_id
where d.value_type = 'amount' and d.currency is distinct from 'CZK'
order by d.owner_id, d.created_at;
```

```sql
select p.id as seller_id, p.username,
       coalesce(p.shipping_policy ->> 'ratesCurrency', 'EUR (implied, key absent)') as rates_currency
from public.profiles p
where p.shipping_policy is not null
  and coalesce(p.shipping_policy ->> 'ratesCurrency', 'EUR') <> 'CZK'
  and (   jsonb_path_exists(p.shipping_policy, '$.destinations[*].rateCents')
       or jsonb_path_exists(p.shipping_policy, '$.freeOverCents')
       or jsonb_path_exists(p.shipping_policy, '$.profiles[*].rateCents'))
order by p.username nulls last;
```

```sql
-- Orders not in CZK: summary per seller, then rows.
select o.seller_id, p.username, o.currency, o.status, count(*) as orders,
       min(o.created_at) as first_at, max(o.created_at) as last_at
from public.orders o
left join public.profiles p on p.id = o.seller_id
where o.currency <> 'CZK'
group by o.seller_id, p.username, o.currency, o.status
order by o.seller_id, o.currency, o.status;

select o.id as order_id, o.seller_id, p.username, o.created_at, o.status, o.fulfilment_status,
       o.currency, o.channel
from public.orders o
left join public.profiles p on p.id = o.seller_id
where o.currency <> 'CZK'
order by o.created_at desc;
```

### 8.4 R3 rows: delivery

```sql
-- Destination rows naming a country other than CZ (including "*").
select p.id as seller_id, p.username, d.ord as destination_index, c.code as country
from public.profiles p
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(p.shipping_policy -> 'destinations') = 'array'
       then p.shipping_policy -> 'destinations' else '[]'::jsonb end
) with ordinality as d(dest, ord)
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(d.dest -> 'countries') = 'array'
       then d.dest -> 'countries' else '[]'::jsonb end
) as c(code)
where c.code <> 'CZ'
order by p.id, d.ord, c.code;
```

```sql
-- Destination rows with no machine-readable countries (free text only).
-- area_text is the seller's own wording (for example "EU"), not personal data.
select p.id as seller_id, p.username, d.ord as destination_index, d.dest ->> 'area' as area_text
from public.profiles p
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(p.shipping_policy -> 'destinations') = 'array'
       then p.shipping_policy -> 'destinations' else '[]'::jsonb end
) with ordinality as d(dest, ord)
where jsonb_typeof(d.dest -> 'countries') is distinct from 'array'
order by p.id, d.ord;
```

```sql
-- Live physical products and how far their owner's terms reach.
select pr.id as product_id, pr.owner_id as seller_id, p.username,
       case
         when p.shipping_policy is null then 'no shipping policy'
         when jsonb_path_exists(p.shipping_policy, '$.destinations[*].countries[*] ? (@ != "CZ")')
           then 'policy names a non-CZ country'
         when exists (
           select 1
           from jsonb_array_elements(
             case when jsonb_typeof(p.shipping_policy -> 'destinations') = 'array'
                  then p.shipping_policy -> 'destinations' else '[]'::jsonb end) as d(dest)
           where jsonb_typeof(d.dest -> 'countries') is distinct from 'array')
           then 'free-text destination'
         when not jsonb_path_exists(p.shipping_policy, '$.destinations[*]')
           then 'no destinations listed'
         else 'CZ only'
       end as delivery_scope
from public.products pr
left join public.profiles p on p.id = pr.owner_id
where pr.digital_file_key is null
  and pr.status = 'active'
  and pr.moderation_status = 'ok'
order by delivery_scope, pr.owner_id;
```

```sql
-- Orders delivered (or to be delivered) outside CZ. Only the country code, never the address.
select o.id as order_id, o.seller_id, p.username, o.created_at, o.status, o.fulfilment_status,
       upper(o.ship_to ->> 'country') as ship_to_country
from public.orders o
left join public.profiles p on p.id = o.seller_id
where o.ship_to is not null
  and upper(coalesce(o.ship_to ->> 'country', '')) <> 'CZ'
order by o.created_at desc;
```

### 8.5 R4 and R5 rows

```sql
-- R4: there is no billing-country column; this lists the digital orders that
-- would need one, so the gap can be sized. No buyer data.
select o.id as order_id, o.seller_id, p.username, o.created_at, o.status, o.currency
from public.orders o
left join public.profiles p on p.id = o.seller_id
where o.fulfilment_status = 'not_required' or o.digital_file_key is not null
order by o.created_at desc;
```

```sql
-- R5 proxies: an order whose lines belong to more than one seller.
select o.id as order_id, null::uuid as line_id, o.seller_id as order_seller_id, pr.owner_id as product_owner_id
from public.orders o
join public.products pr on pr.id = o.product_id
where pr.owner_id <> o.seller_id
union all
select a.order_id, a.id, a.seller_id, pr.owner_id
from public.order_add_ons a
join public.products pr on pr.id = a.product_id
where pr.owner_id <> a.seller_id
order by 1;

-- Add-on links that point at another seller's product (the guard only judges
-- ids NEW to a row, so links made before 20261028 are not covered).
select pr.id as product_id, pr.owner_id as seller_id, ao.id as add_on_product_id, ao.owner_id as add_on_owner_id
from public.products pr
join public.products ao on ao.id = any (pr.add_on_ids)
where ao.owner_id <> pr.owner_id;
```

### 8.6 Carts (only when `to_regclass('public.carts')` is not null)

```sql
-- Open carts per storefront owner (counts only: cart ids are buyer capabilities).
select sf.owner_id as seller_id, p.username, count(*) as open_carts
from public.carts c
join public.storefronts sf on sf.id = c.storefront_id
left join public.profiles p on p.id = sf.owner_id
where c.ordered_at is null
group by sf.owner_id, p.username
order by open_carts desc;

-- Products sitting in open carts that are not CZK or belong to another seller.
select sf.owner_id as storefront_owner_id, pr.id as product_id, pr.owner_id as product_owner_id,
       pr.currency, count(*) as cart_lines
from public.carts c
join public.storefronts sf on sf.id = c.storefront_id
cross join lateral jsonb_array_elements(c.lines) as line(l)
left join public.products pr
  on pr.id = case when line.l ->> 'productId' ~ '^[0-9a-f-]{36}$'
                  then (line.l ->> 'productId')::uuid end
where c.ordered_at is null
  and (pr.currency is distinct from 'CZK' or pr.owner_id is distinct from sf.owner_id)
group by sf.owner_id, pr.id, pr.owner_id, pr.currency
order by cart_lines desc;
```

Interpretation notes: every product row will appear in 8.3 until CZK is allowed, because the CHECK forbids CZK today. Orders written before 2026-09-27 have `ship_to` null and were backfilled `shipped` (20260927_order_fulfilment.sql:52-57, 71-74). Rows of the demo seller (8.0) are simulator data, not sales.

---

## 9. What could not be determined

* **Anything about production's live state.** No database access by design: which of the migrations above are applied (beyond the memory notes and sentinels), the actual grants and policies (SQ-app migrations exist in the production ledger but in no repo, memory `test-db-isolation.md:24-27`), whether `demo.sales_sim.enabled` is on and for which seller, and which `cron.job` rows exist.
* **Stripe connected account country (R1):** not stored; requires the Stripe API per `stripe_account_id`.
* **Business address country (R1):** `seller_address` is free text; only a heuristic is possible. Whether the build should treat `tax_country` as the business country is a product decision.
* **Buyer billing country (R4):** not stored on orders or anywhere else; existing digital orders cannot be checked after the fact from the database.
* **Collab (multi-seller) checkout (R5):** no table, column, function or source reference found; it may be planned, live in another repo not in scope, or a misnomer for add-ons/cart. The database today models single-seller orders only.
* Whether `decrement_stock` still has a caller (inferred superseded by `order_place`).
* `tests/integration/36-pricing-config.test.ts` and `tests/unit/permissions.test.ts` were not opened; their drift-test behaviour is inferred from comments.
* `src/lib/ops/cron.ts` (the `/api/cron/*` dispatcher) was not opened; the scheduling pattern is taken from `scheduled.yml`.
* Whether buyer-facing reads re-check `products.currency` or the publish gate when a seller flips `status`/`currency` directly (app layer; other parts of this inventory).
