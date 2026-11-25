# P1b: database guards for the Czech-only beta (design)

Design only. Nothing here has been built or applied. Every schema change below is
ADDITIVE and non-destructive, and every one **needs the owner's approval before it
is applied to production**. No existing row is deleted, disabled or rewritten;
existing rows that break the rules are reported, never changed.

Written 2026-11-22 from the SQL on disk (Store, Admin, Home migrations and the
replica `Store/tests/db/prod-migrations.sql`, called "Replica" below) and the
production facts the orchestrator read the same day. Path prefixes `Store/`,
`Admin/`, `Home/` are `C:\Squareshare\<repo>\`. "Latest" means the migration
whose definition wins.

Rules: R1 seller established in CZ, R2 CZK only, R3 delivery to CZ only
(physical), R4 billing country CZ for digital goods (card country is evidence,
never a refusal on its own), R5 every seller of a collab checkout passes R1 to
R3, R6 no checkout without all rules, on the server.

---

## 0. The design in one page

**Two layers of currency rule.** The CHECK constraints keep holding the
currencies the code can *store* (EUR, USD, and now CZK: a technical capability,
mirrored from the TypeScript currency list, drift-tested like `ORDER_CHANNELS`).
Which of those may be *sold* right now is a market rule, held by triggers that
read the mirror table. Adding SK and EUR later is a mirror update only, because
EUR is already storable.

**The mirror.** `public.market_rules`: one row, four ordered text arrays
(`seller_countries`, `shipping_countries`, `billing_countries`, `currencies`),
plus `enforced_from` (null until the guards are switched on). Written only by
migrations, read by definer helpers. `currencies[1]` is the default currency.

**Helpers every guard calls** (no guard reads a list or the seller's country
itself):

| Helper | Returns | Today |
|---|---|---|
| `market_allows(list, code)` | boolean | code is in that mirror list |
| `market_default_currency()` | text | `currencies[1]` (used as the column default of `products.currency` and `orders.currency`) |
| `market_seller_country(seller)` | text | `profiles.tax_country`: the ONLY reader of it. Workstream 1B swaps the body for the structured registered-address country |
| `seller_sell_block(seller)` | text reason or null | `seller_country` or `account_country`; 1B adds its reasons here |
| `seller_may_sell(seller)` | boolean | `seller_sell_block(seller) is null` |

**Guards (bind every role, service role and superuser included):**

| Guard | Fires only when | Refuses |
|---|---|---|
| (a) profiles | `tax_country` is inserted non-null or changes | a value not in `seller_countries`; moving away from a charges-enabled account's country |
| (b) products | insert; `currency` changes; the row becomes sellable (`status` becomes `active`, or an active row changes owner) | a currency not in the mirror; becoming sellable while `seller_sell_block(owner)` is not null |
| (c) discounts | an amount discount is inserted, or its `currency`/`value_type` changes | a currency not in the mirror |
| (d) orders + order_add_ons | INSERT only (plus a column-scoped re-check if `currency` or the ship-to country is ever changed after insert) | currency, seller block, ship-to country, missing delivery address, billing country of a download, a line of another seller, a line in another currency, an amount discount in another currency |
| (e) seller_payment_accounts | the row is (or becomes) charges-enabled, or the country of an enabled row changes | an enabled account whose stored Stripe country is missing, not allowed, or not the seller's country |
| (f) shipping terms (jsonb) | no guard | application validator + the orders guard + the monitor (advisory classes) |

Refusals are SQLSTATE `23514` with the message `market_rule:<code>` (a value rule)
or `seller_blocked:<reason>` (the seller may not sell). Full table in 3.0.

**No routine multi-row update can trip a guard**: every guard is insert-only,
or scoped to `UPDATE OF <columns>` with a `WHEN` clause that compares old and
new values, and no sweep writes those columns (proof per guard in section 3 and
the table in section 8).

**Monitoring.** `market_rule_violations()` (service role only) returns one row
per class from an extensible catalogue, with new and legacy counts and sample
ids. "Legacy" is exact: a baseline table captured in the same transaction that
switches the guards on records `(class, entity id, violating value)`; anything
not in it is new. Scheduled daily by GitHub Actions through a cron-secret route,
which alerts through the error collector that already emails today, the
`[ops alert]` log line and a red workflow run.

**Order of application** (all after the unapplied cart migration
`20261120_shopping_cart.sql`, which is already a deploy-gate prerequisite):
1 widen currencies, 2 mirror and helpers, 3 additive columns (+ `order_place`
carries `billing_country`), 4 demo simulator follows the mirror, 5 monitor
(report-only), then the TypeScript deploy, then 6 guards + baseline + 
`enforced_from`, later 7 "billing country required for downloads".

**The simulator** keeps running and never errors: it sells only products in an
allowed currency, in that product's currency, to addresses in allowed shipping
countries, and records a refused tick instead of rolling it back. Its seller's
products are EUR today, so it emits no orders until the owner re-prices them in
CZK or pauses it (owner's choice).

### Interface notes for the TypeScript architect

1. `MARKET.sellerCountries`, `shippingCountries`, `billingCountries`,
   `currencies` are compared to the mirror **in order**; `MARKET.currencies[0]`
   is the market's default currency.
2. Keep a separate list of currencies the code can store (today `CURRENCIES` in
   `Store/src/types/product.ts:12`, EUR and USD). It must become EUR, USD, CZK
   (legacy EUR rows must stay storable). `MARKET.currencies` must be a subset.
   Four CHECKs mirror it (2.1).
3. The TS side writes: `seller_payment_accounts.country` on every sync (create,
   `account.updated`, onboarding return), and stores `charges_enabled` as
   "Stripe says yes AND the market rule passes" (3e explains why the DB refuses
   the raw value); `orders.billing_country` as the key `billing_country` in the
   `order_place` JSON (file 3 makes `order_place` carry it); `orders.card_country`
   with a service-role update after payment; `waitlist_signups.country` from
   Home's `/api/waitlist`.
4. Map `23514` + `market_rule:<code>` / `seller_blocked:<reason>` to clear
   refusals before guards file 6 is applied.
5. A cron route (working name `/api/cron/market-check`) calls
   `market_rule_violations()` (section 6).
6. Things the DB cannot hold for you: `PRICE_CENTS_MAX` and discount maxima
   scaled for CZK (about 25x EUR figures; the DB only has `amount_off_cents
   <= 100000000`), shipping `ratesCurrency` equal to the order currency (absent
   means EUR, so it must be set explicitly), and any re-check between a pending
   order and its payment confirmation (the DB deliberately does not refuse
   `pending -> paid`, see 3d).

---

## 1. The mirror table

### 1.1 DDL and seed (file 2, `20261122_market_2_rules_mirror.sql`)

Shape chosen: a single row (the `billing_switches` precedent,
`Store/supabase/migrations/20260930_seller_plans.sql:195-215`) whose four array
columns map one-to-one onto the TypeScript `MARKET` object. Diffing is a
`toEqual` per list.

```sql
-- =============================================================================
-- MARKET RULES MIRROR (Czech-only beta).
--
-- MIRROR of src/lib/market (MARKET). The TypeScript module is the root: edit
-- it, then add ONE migration with the canonical upsert below, review, deploy.
-- Read by the guard triggers (definer helpers) and market_rule_violations().
-- Written by migrations only: no role but the table owner may write it.
--
-- CANONICAL FORM. Every migration that changes the mirror contains exactly one
-- statement of the form below, all four lists, in this column order, with no
-- comments inside it. tests/unit/market-mirror-sql.test.ts reads the LAST one.
-- currencies[1] is the default currency (MARKET.currencies[0]).
--
-- enforced_from stays null until 20261122_market_6_guards switches the guards
-- on; the canonical upsert never touches it.
-- =============================================================================

create or replace function public.market_codes_valid(p_codes text[], p_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_codes is not null
     and cardinality(p_codes) between 1 and 64
     and array_position(p_codes, null) is null
     and (select bool_and(c ~ ('^[A-Z]{' || p_length || '}$')) from unnest(p_codes) as c)
     and cardinality(p_codes) = (select count(distinct c) from unnest(p_codes) as c)
$$;

revoke execute on function public.market_codes_valid(text[], integer)
  from public, anon, authenticated, service_role;

create table if not exists public.market_rules (
  id                 boolean primary key default true check (id),
  seller_countries   text[] not null,
  shipping_countries text[] not null,
  billing_countries  text[] not null,
  currencies         text[] not null,
  enforced_from      timestamptz,
  updated_at         timestamptz not null default now(),

  constraint market_rules_seller_countries_valid   check (public.market_codes_valid(seller_countries, 2)),
  constraint market_rules_shipping_countries_valid check (public.market_codes_valid(shipping_countries, 2)),
  constraint market_rules_billing_countries_valid  check (public.market_codes_valid(billing_countries, 2)),
  constraint market_rules_currencies_valid         check (public.market_codes_valid(currencies, 3))
);

comment on table public.market_rules is
  'Mirror of src/lib/market: who may sell (seller_countries), where goods may be delivered, which billing countries a download may be sold to, which currencies may be sold. One row. Written by migrations only; read by the market guards and market_rule_violations(). enforced_from: when the guards were switched on (null = report only).';

alter table public.market_rules enable row level security;
revoke all on table public.market_rules from public, anon, authenticated, service_role;
grant select on table public.market_rules to service_role;

insert into public.market_rules as m (id, seller_countries, shipping_countries, billing_countries, currencies)
values (true, array['CZ']::text[], array['CZ']::text[], array['CZ']::text[], array['CZK']::text[])
on conflict (id) do update
   set seller_countries   = excluded.seller_countries,
       shipping_countries = excluded.shipping_countries,
       billing_countries  = excluded.billing_countries,
       currencies         = excluded.currencies,
       updated_at         = now();
```

`market_codes_valid` is used in CHECKs (the `username_is_reserved` precedent,
`Store/supabase/migrations/20261021_reserved_usernames.sql:60-72`). Only the
table owner writes the table, so only the owner needs EXECUTE on it.

### 1.2 Who may read and write

* **Read.** The lists are public facts (the homepage will say "Czech sellers
  only"), but no browser or client needs them: the TypeScript module is the
  source the app reads. So no grant to `anon`/`authenticated` and no client
  policy (which would also pull in the restrictive two-factor policy test 22).
  `service_role` may SELECT (the monitor runs as invoker under the service role,
  and the app may read it for diagnostics). The guards read it through definer
  helpers.
* **Write.** Nobody but the owner, i.e. migrations. `service_role` holds SELECT
  only; BYPASSRLS does not bypass privileges, so the app cannot change the
  market even with the service key.
* RLS is on with no policy: add `market_rules` to `POLICY_FREE_BY_DESIGN` in
  `Store/tests/integration/19-rls-coverage.test.ts:28` with the reason "the
  market mirror: written by migrations only, read by the market guards (definer)
  and the monitor (service role); a client that could write it could open the
  market to itself", and to the exhaustive table list in
  `Store/tests/integration/00-harness.test.ts:32-157` (sorted: after `follows`,
  `market_rule_baseline` then `market_rules`).

### 1.3 Helper functions (same file 2)

All `stable`, `security definer` (they read `market_rules`, `profiles` and
`seller_payment_accounts` on behalf of writers whose RLS cannot see those rows:
an editor publishing in the owner's store cannot read the owner's profile),
`set search_path = ''`, with explicit revokes (the auto-grant trap: memory
`postgrest-auto-grant-trap.md`).

```sql
create or replace function public.market_allows(p_list text, p_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.market_rules%rowtype;
begin
  if p_list is null
     or p_list not in ('seller_country', 'shipping_country', 'billing_country', 'currency') then
    raise exception 'market_allows: unknown list %', p_list using errcode = '22023';
  end if;
  if p_code is null then
    return false;
  end if;
  select * into m from public.market_rules where id;
  if not found then
    -- No mirror row: nothing is allowed. Fails closed.
    return false;
  end if;
  if p_list = 'seller_country' then
    return p_code = any (m.seller_countries);
  elsif p_list = 'shipping_country' then
    return p_code = any (m.shipping_countries);
  elsif p_list = 'billing_country' then
    return p_code = any (m.billing_countries);
  end if;
  return p_code = any (m.currencies);
end
$$;

create or replace function public.market_default_currency()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.currencies[1] from public.market_rules m where m.id
$$;

-- The seller's country of establishment. TODAY: the country they declared in
-- Settings, which the product page prints as the trader's country. Workstream
-- 1B replaces this body with the structured registered-address country.
-- Nothing else in the database reads profiles.tax_country for a market rule.
create or replace function public.market_seller_country(p_seller uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.tax_country from public.profiles p where p.id = p_seller
$$;

-- Why this seller may not sell right now, or null when they may.
-- The ONE sell gate: the products guard (becoming sellable), the orders guard
-- and the monitor all ask it. Workstream 1B adds its own reasons here
-- (profile incomplete or unverified, sanctions screen, ...).
create or replace function public.seller_sell_block(p_seller uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_country text := public.market_seller_country(p_seller);
begin
  if v_country is null or not public.market_allows('seller_country', v_country) then
    return 'seller_country';
  end if;
  -- A connected account that can take charges must be in the seller's own
  -- (allowed) country. Guard (e) keeps this true; checked again here because
  -- the seller's country can move after the account was enabled.
  if exists (
    select 1 from public.seller_payment_accounts a
     where a.owner_id = p_seller
       and a.charges_enabled
       and a.country is distinct from v_country
  ) then
    return 'account_country';
  end if;
  return null;
end
$$;

create or replace function public.seller_may_sell(p_seller uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.seller_sell_block(p_seller) is null
$$;

revoke execute on function public.market_allows(text, text) from public, anon, authenticated;
revoke execute on function public.market_seller_country(uuid) from public, anon, authenticated;
revoke execute on function public.seller_sell_block(uuid) from public, anon, authenticated;
revoke execute on function public.seller_may_sell(uuid) from public, anon, authenticated;
grant execute on function public.market_allows(text, text) to service_role;
grant execute on function public.market_seller_country(uuid) to service_role;
grant execute on function public.seller_sell_block(uuid) to service_role;
grant execute on function public.seller_may_sell(uuid) to service_role;

-- Used as a column default, which is evaluated with the INSERTING role's
-- privileges, so the writers of products and orders need EXECUTE.
revoke execute on function public.market_default_currency() from public, anon;
grant execute on function public.market_default_currency() to authenticated, service_role;

-- Rows inserted without a currency get the market's, not a hardcoded EUR.
alter table public.products alter column currency set default public.market_default_currency();
alter table public.orders   alter column currency set default public.market_default_currency();
```

Why the defaults change: `products.currency default 'EUR'` (Replica:157) and
`orders.currency default 'EUR'` (Replica:301) are EUR hardcodes (inventory
05 section 7.5). The app always sends a currency
(`Store/src/lib/products/actions.ts:387, 513`; `order_place` coalesces its own
`'EUR'`, see 2.2), so only direct writers that omit it (fixtures, seeds) see the
default. With the old default, every such insert would be refused by guard (b)
or (d). With no mirror row the default is null and the insert fails NOT NULL:
fail closed. File 1 must be applied first, or a CZK default would violate the
old `products_currency_check`.

### 1.4 Drift tests

Two tests, because they catch different mistakes.

1. **Static, unit project** (`Store/tests/unit/market-mirror-sql.test.ts`, the
   `ORDER_CHANNELS` pattern of `Store/tests/unit/order-channel.test.ts:82-102`).
   Reads `tests/db/prod-migrations.sql`, finds every canonical upsert with

   ```ts
   /insert into public\.market_rules as m \(id, seller_countries, shipping_countries, billing_countries, currencies\)\s+values \(true, array\[([^\]]*)\]::text\[\], array\[([^\]]*)\]::text\[\], array\[([^\]]*)\]::text\[\], array\[([^\]]*)\]::text\[\]\)/g
   ```

   takes the LAST match, extracts `'XX'` codes in order, and expects each list
   `toEqual` the matching `MARKET` list (order included). Second assertion: the
   last canonical upsert across `supabase/migrations/*.sql` (sorted by file
   name) equals the replica's, so a mirror migration that was never replayed
   fails. Third: `MARKET.currencies` is a subset of the storable-currency list.
   Fourth (2.1): the last definition of each of the four currency CHECKs in the
   replica, parsed like `replayedChannelCheck`, equals the storable list
   (sorted). Fails without a database, so a TS edit without a migration fails
   in the fast suite.
2. **Database, db project** (`Store/tests/integration/51-market-rules.test.ts`).
   `select seller_countries, shipping_countries, billing_countries, currencies
   from public.market_rules` as the service role and `toEqual` `MARKET`. Catches
   a replay that ran a different statement than the regex saw, or a hand edit.

### 1.5 Worked example: add SK and EUR

The TS edit: `sellerCountries: ["CZ", "SK"]`, `shippingCountries: ["CZ", "SK"]`,
`billingCountries: ["CZ", "SK"]`, `currencies: ["CZK", "EUR"]`. Then one
migration (needs the owner's approval before it is applied to production):

```sql
-- =============================================================================
-- Market: Slovakia joins (sellers, delivery, billing), EUR becomes sellable.
-- MIRROR of src/lib/market. Canonical form: see 20261122_market_2_rules_mirror.
-- EUR is already storable (products_currency_check and its three siblings), so
-- no constraint changes. Legacy EUR rows simply stop being violations.
-- =============================================================================
insert into public.market_rules as m (id, seller_countries, shipping_countries, billing_countries, currencies)
values (true, array['CZ','SK']::text[], array['CZ','SK']::text[], array['CZ','SK']::text[], array['CZK','EUR']::text[])
on conflict (id) do update
   set seller_countries   = excluded.seller_countries,
       shipping_countries = excluded.shipping_countries,
       billing_countries  = excluded.billing_countries,
       currencies         = excluded.currencies,
       updated_at         = now();
```

Consequences, with no other change: guards accept SK sellers, SK delivery, SK
billing and EUR prices; the simulator's Bratislava address becomes eligible
(5.3); the monitor's legacy EUR products and orders and SK-shipped orders drop
out of the violation set. Replay it into the replica; add it to
`UNPROBED_MIGRATIONS` in `Store/scripts/lib/prod-schema.ts:46-57` with the reason
"mirror row data: the schema probe reads pg_catalog only and has no table
privileges; the drift tests and the monitor's mirror check cover it" (optional
improvement: a probe kind reading the table comment, which a mirror migration
would restate). Adding a currency the code cannot store yet (for example PLN)
additionally needs the code change and the four CHECKs widened (2.1).

Review checklist for such a migration: the legal review the rules require
(seller terms, VAT/OSS, consumer law of the new country), the TS edit, the
replica replay, and the monitor run after applying (expected: zero new).

---

## 2. CZK support

### 2.1 Widen the storable currencies together (file 1, `20261122_market_1_czk_currency.sql`)

Live definitions (orchestrator, 2026-11-22): `products_currency_check` and
`product_price_history_currency_check` are `CHECK (currency = ANY
(ARRAY['EUR','USD']))`; `discounts_value` matches
`Store/supabase/migrations/20261004_discounts.sql:84-92`. On disk:
`products_currency_check` is the inline CHECK at Replica:157;
`product_price_history_currency_check` the inline CHECK at
20261004_discounts.sql:253; `orders.currency` has none (Replica:301).

`product_price_history` is written by the AFTER INSERT and AFTER UPDATE OF
`price_cents, currency` triggers on products (`record_product_price`,
20261004_discounts.sql:270-296), so a CZK product save fails inside that trigger
unless the history CHECK widens in the same transaction.

```sql
-- =============================================================================
-- CZK can be stored (Czech-only beta, R2).
--
-- These are the currencies the code can STORE: MIRROR of the TypeScript
-- storable-currency list (today CURRENCIES in src/types/product.ts). Which of
-- them may be SOLD is the market mirror's job (market_rules), held by triggers.
-- tests/unit/market-mirror-sql.test.ts compares the last definition of all
-- four constraints with the TypeScript list.
--
-- Widening only: every existing row passes, so each constraint is validated
-- on creation. product_price_history widens in the same transaction because a
-- trigger on products writes it on every save.
--
-- No IF EXISTS on the drops: if production named a constraint differently,
-- this must fail loudly rather than leave the old list in force beside the new.
--
-- Pre-check (read only):
--   select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('products_currency_check', 'product_price_history_currency_check',
--                      'discounts_value', 'orders_currency_supported');
--   select currency, count(*) from public.orders group by 1;
--   select currency, count(*) from public.product_price_history group by 1;
-- =============================================================================

alter table public.products drop constraint products_currency_check;
alter table public.products
  add constraint products_currency_check check (currency in ('EUR', 'USD', 'CZK'));

alter table public.product_price_history drop constraint product_price_history_currency_check;
alter table public.product_price_history
  add constraint product_price_history_currency_check check (currency in ('EUR', 'USD', 'CZK'));

alter table public.discounts drop constraint discounts_value;
alter table public.discounts
  add constraint discounts_value check (
    (value_type = 'percent'
      and percent_off between 1 and 90
      and amount_off_cents is null and currency is null)
    or (value_type = 'amount'
      and percent_off is null
      and amount_off_cents between 1 and 100000000
      and currency in ('EUR', 'USD', 'CZK'))
  );

-- New: orders had no currency constraint at all. fee_ledger_record copies the
-- order's currency into a ledger that requires ^[A-Z]{3}$
-- (20261011_pricing_config.sql:540, 551, 605-618).
alter table public.orders drop constraint if exists orders_currency_supported;
alter table public.orders
  add constraint orders_currency_supported check (currency in ('EUR', 'USD', 'CZK'));
```

Why keep a literal list in the CHECKs at all (rather than shape only): the list
says what the code can format, price and charge, which is a code capability that
changes with a deploy, not with the market. A CHECK on orders is re-evaluated on
every update of a row, but every existing order is EUR, so no sweep can fail on
it. All four lists are drift-tested against one TS list (the
`notification-type-two-lists` lesson: a TS list ahead of its CHECK fails
silently).

Each statement takes a brief ACCESS EXCLUSIVE lock and scans a small table (22
products, about 1,239 orders).

### 2.2 SQL functions that assume EUR

**Must change before a CZK order can exist:** only the three CHECKs above. With
them widened:

* `record_product_price` (20261004_discounts.sql:270-296) copies whatever
  currency the product has: fine.
* `order_place` coalesces a missing currency to `'EUR'` (applied
  20261028_product_add_ons.sql:231; pending 20261120_shopping_cart.sql:220). Not
  changed: the app always sends one, and a missing one becoming EUR is then
  refused by guard (d), which is the right outcome. (File 3 redefines
  `order_place` for another reason and keeps this line as is.)
* `fee_ledger_record` (20261011_pricing_config.sql:589-634) copies the order's
  currency into a `^[A-Z]{3}$` column: CZK passes.
* `billing_apply_snapshot` and `plan_price_change`
  (20260930_seller_plans.sql:383-455; 20261011_pricing_config.sql:213-280,
  `'EUR'` and `_eur_v` at 254-265) concern the platform's own plan prices
  (sellers as our customers), not seller prices. Out of scope; plans stay
  billed in EUR unless the owner decides otherwise.

**Reporting that would mislabel or drop CZK** (a CZK order is stored correctly,
but a figure is wrong). Applied latest first, pending 20261120 second:

| Function | Latest applied (line of the filter) | Pending 20261120 | What goes wrong with CZK | Minimal correct change |
|---|---|---|---|---|
| `dashboard_orders_aggregate(uuid, timestamptz)` | 20261117_perf_indexes.sql:246-337 (`currency <> 'USD'` at 300, 327, 334) | 20261120:720-818 (744, 808) | CZK and EUR cents summed into one figure the app labels EUR | filter `currency = p_currency` |
| `analytics_aggregate(uuid, date, date)` | 20261117_perf_indexes.sql:344 (370, 381) | 20261120:820 (852, 863) | same | same |
| `analytics_weekday_products(uuid, date, date)` | 20261028_product_add_ons.sql:787 (807) | not redefined | counts sales, no money: CZK counted, harmless | none needed; align with the others for consistency |
| `product_sales_aggregate(uuid)` | 20261028_product_add_ons.sql:696-735 (`min(currency)` at 708) | 20261120:629-668 (641) | a product re-priced EUR to CZK sums both and reports `min()` = `CZK` | group by `(product_id, currency)` or filter `currency = p_currency` |
| `products_ranked_by_metric(...)` | 20261028_product_add_ons.sql:737 | 20261120:670-716 | revenue ranking mixes currencies | filter `currency = p_currency` in `sales` |
| `billing_sales_summary(uuid, timestamptz)` | 20261004_discounts.sql:349-364 (361 `= 'EUR'`) | not redefined | the plan calculator sees zero CZK sales | needs an owner decision: plans are priced in EUR, sales in CZK (convert, or price plans in CZK) |
| `billing_sales_30d(uuid, timestamptz)` | 20261011_pricing_config.sql:676-700 (690) | not redefined | same | same |
| `discount_performance(uuid)`, `fee_ledger_summary(...)` | 20261028:853-; 20261011:639-666 | n/a | none: both group by currency | none |
| Admin `admin_revenue_summary(boolean)` | Admin/supabase/migrations/0008_plans_revenue.sql:31-56 (51 `o.currency = 'EUR'`) | n/a | platform fees on CZK orders vanish from the admin revenue tile | group fees by currency (return-type change, Admin repo and Admin app together) |

Admin 0009 reads `seller_billing.currency` (0009_plan_directory.sql:42): the
platform subscription, not seller sales, fine. No other Admin, Home or App SQL
reads seller currencies (Admin's product reads in
`Admin/src/lib/data/moderation.ts:665, 966` only display `currency`).

**Proposed phase B migration** (`20261122_market_8_reporting_currency.sql` or
later, applied with the TS analytics labels change, after 20261120): for each
per-seller function above, a NEW overload with a required `p_currency text`
argument (no default, so there is no ambiguity with the existing signature),
built from the 20261120 body with `currency <> 'USD'` replaced by
`currency = p_currency`, with explicit `revoke ... from public, anon` and
`grant ... to authenticated, service_role`. The old overloads stay until the app
calls the new ones, then a cleanup migration drops them. Purely additive
meanwhile. Until phase B ships, a seller with both legacy EUR and new CZK orders
(only test and demo accounts today) sees mixed sums.

---

## 3. The guards

All guard trigger functions live in file 6 (`20261122_market_6_guards.sql`),
are `security definer` with `set search_path = ''`, and have EXECUTE revoked from
`public, anon, authenticated, service_role` (a trigger function is never called
directly; triggers fire regardless of EXECUTE, as every existing guard shows, for
example 20261012_auto_moderation.sql:784-809).

**Every guard binds every role.** None asks who is writing (unlike
`guard_seller_text`'s `current_user` test, 20261012_auto_moderation.sql:735-777,
the moderation gate's `current_setting('role')`, 332-480, or `auth.role()` in
`guard_object_keys`). This matters because the service role is the only writer
of orders and shipping terms, and the simulator runs as the owner of its
definer functions (`postgres`), so any "trusted role" exemption would exempt
exactly the paths R3 and R6 care about.

**Emergency off switch:** a trigger can be disabled by the table owner
(`alter table ... disable trigger <name>`, DDL, needs the owner's OK). The
monitor's `r6_guard_missing` class reports a missing or disabled guard the next
day.

### 3.0 The refusal contract

```sql
-- One way to refuse, so the app maps every refusal the same way:
-- SQLSTATE 23514 (check_violation), message '<family>:<code>', detail with the
-- offending code only (a currency or country code, never personal data).
create or replace function public.market_refuse(p_family text, p_code text, p_detail text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%:%', p_family, p_code
    using errcode = '23514', detail = coalesce(p_detail, '');
end
$$;
revoke execute on function public.market_refuse(text, text, text)
  from public, anon, authenticated, service_role;
```

`23514` with a machine message follows `enforce_plan_limit`
(`plan_limit_reached:<key>`, 20260930_seller_plans.sql comment above line 281).
PostgREST answers HTTP 400 with `code` and `message`.

| Message | Raised by | Meaning for the app |
|---|---|---|
| `market_rule:currency` | products, discounts, orders | currency not sold in the market |
| `market_rule:seller_country` | profiles | that country cannot be declared by a seller in the beta |
| `market_rule:country_locked` | profiles | the country must match the connected Stripe account that can take charges |
| `market_rule:account_country` | seller_payment_accounts | the Stripe account's country is missing, not allowed, or not the seller's |
| `market_rule:ship_to_country` | orders, order_add_ons, orders change | delivery country not served |
| `market_rule:ship_to_required` | orders, order_add_ons | something to deliver and no address |
| `market_rule:billing_country` | orders, order_add_ons | a download sold to a billing country not served |
| `market_rule:billing_country_required` | orders, order_add_ons (file 7 only) | a download with no billing country |
| `market_rule:product_required` | orders, order_add_ons | a line without a product cannot be checked |
| `market_rule:line_seller` | orders, order_add_ons | a line is another seller's product (R5) |
| `market_rule:line_currency` | orders, order_add_ons | a line's product is priced in another currency than the order |
| `market_rule:discount_currency` | orders, order_add_ons | an amount discount in another currency than the order |
| `seller_blocked:seller_country` | products (becoming sellable), orders | the seller is not established in an allowed country |
| `seller_blocked:account_country` | products (becoming sellable), orders | the seller's enabled Stripe account is in another country |
| `seller_blocked:<1B reason>` | same | added by workstream 1B without touching the guards |

### 3a. profiles.tax_country

**When it fires.** `BEFORE INSERT` when `new.tax_country is not null` (never for
`handle_new_user`, which inserts it null: 20261021_reserved_usernames.sql:76-115)
and `BEFORE UPDATE OF tax_country` when `old.tax_country is distinct from
new.tax_country`. A save that sends the same value, and every other profile
update, never calls the function.

```sql
create or replace function public.market_guard_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The guard OF this column: it judges the value being written (new), never a
  -- stored one. Clearing the country is allowed (a buyer has none).
  if new.tax_country is not null
     and not public.market_allows('seller_country', new.tax_country) then
    perform public.market_refuse('market_rule', 'seller_country', 'tax_country=' || new.tax_country);
  end if;
  -- A Stripe account that can take charges fixes the country of establishment.
  if exists (
    select 1 from public.seller_payment_accounts a
     where a.owner_id = new.id
       and a.charges_enabled
       and a.country is distinct from new.tax_country
  ) then
    perform public.market_refuse('market_rule', 'country_locked', null);
  end if;
  return new;
end
$$;

drop trigger if exists profiles_market_guard_insert on public.profiles;
create trigger profiles_market_guard_insert
  before insert on public.profiles
  for each row when (new.tax_country is not null)
  execute function public.market_guard_profiles();

drop trigger if exists profiles_market_guard_update on public.profiles;
create trigger profiles_market_guard_update
  before update of tax_country on public.profiles
  for each row when (old.tax_country is distinct from new.tax_country)
  execute function public.market_guard_profiles();
```

**Old rows.** The IE profile keeps IE; every update that leaves `tax_country`
unchanged (notification prefs, avatar, locale, re-saving the tax form with IE)
does not fire. No bulk statement writes `tax_country`.

**Service role.** Bound: `saveTaxInfo` (Store/src/lib/settings/actions.ts:446-548,
service-role write at 548) and a seller's direct PostgREST PATCH meet the same
rule.

**1B note.** This is the only object that reads `tax_country`, and only because
it is that column's guard. When 1B moves the country of establishment into its
structured address table, the same check attaches to that table (and
`market_seller_country` switches over); this trigger can stay as long as the
column exists.

### 3b. products

**When it fires.** `BEFORE INSERT` (every row), and `BEFORE UPDATE OF currency,
status, owner_id` with `WHEN (old.currency is distinct from new.currency or
(new.status = 'active' and (old.status is distinct from 'active' or
old.owner_id is distinct from new.owner_id)))`.

```sql
create or replace function public.market_guard_products()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency_changed boolean;
  v_becomes_sellable boolean;
  v_block            text;
begin
  -- Branches, not one boolean expression: OLD does not exist on INSERT and
  -- plpgsql does not promise short-circuit evaluation.
  if tg_op = 'INSERT' then
    v_currency_changed := true;
    v_becomes_sellable := new.status = 'active';
  else
    v_currency_changed := new.currency is distinct from old.currency;
    v_becomes_sellable := new.status = 'active'
      and (old.status is distinct from 'active' or old.owner_id is distinct from new.owner_id);
  end if;

  if (v_currency_changed or v_becomes_sellable)
     and not public.market_allows('currency', new.currency) then
    perform public.market_refuse('market_rule', 'currency', 'products.currency=' || coalesce(new.currency, 'null'));
  end if;

  -- Becoming sellable: the one sell gate (1B extends seller_sell_block).
  if v_becomes_sellable then
    v_block := public.seller_sell_block(new.owner_id);
    if v_block is not null then
      perform public.market_refuse('seller_blocked', v_block, null);
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists products_market_guard_insert on public.products;
create trigger products_market_guard_insert
  before insert on public.products
  for each row execute function public.market_guard_products();

drop trigger if exists products_market_guard_update on public.products;
create trigger products_market_guard_update
  before update of currency, status, owner_id on public.products
  for each row
  when (old.currency is distinct from new.currency
        or (new.status = 'active'
            and (old.status is distinct from 'active' or old.owner_id is distinct from new.owner_id)))
  execute function public.market_guard_products();
```

**Should it require the owner's country?** Yes, but only when the product
becomes sellable, not on every insert. Reasons: (1) sellers write products with
their own JWT and skip the app's publish gate
(inventory 05 section 2.2; the MCP server takes the same path), so the database
is the only place a "publish" can be held; (2) a draft by a seller who has not
filled in Settings yet is normal onboarding and harmless, while a live listing
by a seller who may not sell misleads buyers even though the orders guard would
refuse the sale; (3) it routes through `seller_sell_block`, the seam 1B needs for
its completion gate. The TS publish gate should apply the same rule so the
database refusal is never the first a seller hears of it.

**Old rows.** No sweep writes `currency`, `status` or `owner_id`: the stock
decrements in `order_place` (20261028:274-280, 309-315; 20261120:269-275,
307-313), the restocks in `order_release_pending` (20261028:367-389),
`orders_release_expired` (one statement over all expired orders,
20261028:400-441), `order_apply_refund` (443-511) and the pending
`order_apply_line_refund` (20261120:445-), `moderation_recheck_all`
(latest 20261013_marketplace_moderation.sql:139-150, writes
`moderation_checked_at`) and `moderation_settle` (moderation columns) all write
other columns, so the trigger is not even called. A seller editing the title or
price of a legacy EUR product passes (the app re-sends the unchanged currency
and status; the `WHEN` sees no change). Price changes still write EUR history
rows, which the widened history CHECK accepts. Unpublishing is never checked.
Republishing a legacy EUR product, duplicating it
(`Store/src/lib/products/card-actions.ts:101-149` copies the currency) or
switching it to EUR are refused: intended.

**Service role.** Bound (seeds and fixtures included). The app writes products
with the user's session client (Store/src/lib/products/actions.ts:378), so
nothing in production changes for it beyond the rule itself.

### 3c. discounts

**When it fires.** `BEFORE INSERT WHEN (new.value_type = 'amount')` and `BEFORE
UPDATE OF currency, value_type WHEN (new.value_type = 'amount' and
(old.currency is distinct from new.currency or old.value_type is distinct from
new.value_type))`. Percent discounts never call it.

```sql
create or replace function public.market_guard_discounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.value_type = 'amount'
     and not public.market_allows('currency', new.currency) then
    perform public.market_refuse('market_rule', 'currency', 'discounts.currency=' || coalesce(new.currency, 'null'));
  end if;
  return new;
end
$$;

drop trigger if exists discounts_market_guard_insert on public.discounts;
create trigger discounts_market_guard_insert
  before insert on public.discounts
  for each row when (new.value_type = 'amount')
  execute function public.market_guard_discounts();

drop trigger if exists discounts_market_guard_update on public.discounts;
create trigger discounts_market_guard_update
  before update of currency, value_type on public.discounts
  for each row
  when (new.value_type = 'amount'
        and (old.currency is distinct from new.currency or old.value_type is distinct from new.value_type))
  execute function public.market_guard_discounts();
```

**Old rows.** There are no amount discounts in production. Archiving, enabling,
ending (`ends_at`) and the clamp in `guard_discount_rules`
(20261004_discounts.sql:178-245) write other columns. A started sale's currency
is frozen by that guard anyway.

**Service role.** Bound. `authenticated` may insert any column and update
`currency` and `value_type` (20261004_discounts.sql:128-135); both paths meet it.
The discount's currency is also compared with the order's at checkout (3d).

### 3d. orders and order_add_ons

**When it fires.** `BEFORE INSERT` on `orders` and `BEFORE INSERT` on
`order_add_ons`, every row, every writer (`order_place`, the simulator, seeds,
fixtures). Plus one narrow change guard, described after.

```sql
create or replace function public.market_guard_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block    text;
  v_owner    uuid;
  v_currency text;
  v_ships    boolean;
  v_discount uuid;
  v_type     text;
  v_dcur     text;
begin
  -- A repeated checkout: order_place inserts with ON CONFLICT
  -- (checkout_session_id) DO NOTHING, and BEFORE INSERT triggers run before the
  -- conflict is seen. Let the duplicate through untouched; the insert then does
  -- nothing and order_place answers with the existing order (even one placed
  -- before these rules existed).
  if new.checkout_session_id is not null then
    if exists (select 1 from public.orders o where o.checkout_session_id = new.checkout_session_id) then
      return new;
    end if;
  end if;

  if not public.market_allows('currency', new.currency) then
    perform public.market_refuse('market_rule', 'currency', 'orders.currency=' || coalesce(new.currency, 'null'));
  end if;

  v_block := public.seller_sell_block(new.seller_id);
  if v_block is not null then
    perform public.market_refuse('seller_blocked', v_block, null);
  end if;

  -- The first line: this seller's own product, in the order's currency.
  if new.product_id is null then
    perform public.market_refuse('market_rule', 'product_required', null);
  end if;
  select p.owner_id, p.currency into v_owner, v_currency
    from public.products p where p.id = new.product_id;
  if not found then
    perform public.market_refuse('market_rule', 'product_required', null);
  end if;
  if v_owner is distinct from new.seller_id then
    perform public.market_refuse('market_rule', 'line_seller', null);
  end if;
  if v_currency is distinct from new.currency then
    perform public.market_refuse('market_rule', 'line_currency', 'products.currency=' || coalesce(v_currency, 'null'));
  end if;

  -- R3. Something to deliver: the first line is a parcel, or the order says it
  -- ships (a download with a parcel among the other lines).
  v_ships := new.digital_file_key is null or new.fulfilment_status is distinct from 'not_required';
  if new.ship_to is not null then
    if not public.market_allows('shipping_country', new.ship_to ->> 'country') then
      perform public.market_refuse('market_rule', 'ship_to_country',
        'ship_to.country=' || coalesce(new.ship_to ->> 'country', 'null'));
    end if;
  elsif v_ships then
    perform public.market_refuse('market_rule', 'ship_to_required', null);
  end if;

  -- R4. A download needs an allowed billing country. Until file 7, only a
  -- present value is judged; file 7 makes it required.
  if new.digital_file_key is not null and new.billing_country is not null then
    if not public.market_allows('billing_country', new.billing_country) then
      perform public.market_refuse('market_rule', 'billing_country', 'billing_country=' || new.billing_country);
    end if;
  end if;

  -- An amount discount priced the order: same currency.
  foreach v_discount in array array[new.discount_id, new.discount_code_id] loop
    continue when v_discount is null;
    select d.value_type, d.currency into v_type, v_dcur
      from public.discounts d where d.id = v_discount;
    if found and v_type = 'amount' and v_dcur is distinct from new.currency then
      perform public.market_refuse('market_rule', 'discount_currency', null);
    end if;
  end loop;

  return new;
end
$$;

-- Every line after the first (add-ons and cart lines): the order's seller, the
-- order's currency, and the delivery or billing rule its own kind needs.
create or replace function public.market_guard_order_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller   uuid;
  v_currency text;
  v_ship_to  jsonb;
  v_billing  text;
  v_owner    uuid;
  v_pcur     text;
  v_type     text;
  v_dcur     text;
begin
  select o.seller_id, o.currency, o.ship_to, o.billing_country
    into v_seller, v_currency, v_ship_to, v_billing
    from public.orders o where o.id = new.order_id;
  if not found then
    return new;  -- the foreign key refuses it
  end if;

  if new.seller_id is distinct from v_seller then
    perform public.market_refuse('market_rule', 'line_seller', null);
  end if;
  if new.product_id is null then
    perform public.market_refuse('market_rule', 'product_required', null);
  end if;
  select p.owner_id, p.currency into v_owner, v_pcur
    from public.products p where p.id = new.product_id;
  if not found then
    perform public.market_refuse('market_rule', 'product_required', null);
  end if;
  if v_owner is distinct from v_seller then
    perform public.market_refuse('market_rule', 'line_seller', null);
  end if;
  if v_pcur is distinct from v_currency then
    perform public.market_refuse('market_rule', 'line_currency', 'products.currency=' || coalesce(v_pcur, 'null'));
  end if;

  if new.digital_file_key is null then
    if v_ship_to is null then
      perform public.market_refuse('market_rule', 'ship_to_required', null);
    elsif not public.market_allows('shipping_country', v_ship_to ->> 'country') then
      perform public.market_refuse('market_rule', 'ship_to_country',
        'ship_to.country=' || coalesce(v_ship_to ->> 'country', 'null'));
    end if;
  elsif v_billing is not null and not public.market_allows('billing_country', v_billing) then
    perform public.market_refuse('market_rule', 'billing_country', 'billing_country=' || v_billing);
  end if;

  if new.discount_id is not null then
    select d.value_type, d.currency into v_type, v_dcur
      from public.discounts d where d.id = new.discount_id;
    if found and v_type = 'amount' and v_dcur is distinct from v_currency then
      perform public.market_refuse('market_rule', 'discount_currency', null);
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists orders_market_guard_insert on public.orders;
create trigger orders_market_guard_insert
  before insert on public.orders
  for each row execute function public.market_guard_orders();

drop trigger if exists order_add_ons_market_guard_insert on public.order_add_ons;
create trigger order_add_ons_market_guard_insert
  before insert on public.order_add_ons
  for each row execute function public.market_guard_order_lines();
```

The order row cannot see its later lines (`order_place` inserts the order, then
each line: 20261120:207-238, 286-326), which is why the line rules live on
`order_add_ons`. Both inserts run in one `order_place` transaction, so a refused
line rolls the order back (as `insufficient_stock` does today).

"Physical" means `digital_file_key is null` on the row or line, the same test the
order writer uses to decide `ships` and `fulfilment_status`
(Store/src/lib/orders/record.ts:420-432) and the app uses for availability
(Store/src/lib/checkout/availability.ts:95).

**The change guard (column-scoped, recommended).** Nothing in the code edits an
order's currency or delivery address after insert (searched `src/` for writes
of `ship_to`: only `record.ts:499`, the insert). A future feature or a manual
service-role edit could, and an insert-only guard would not see it:

```sql
create or replace function public.market_guard_orders_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency then
    if not public.market_allows('currency', new.currency) then
      perform public.market_refuse('market_rule', 'currency', 'orders.currency=' || coalesce(new.currency, 'null'));
    end if;
  end if;
  if new.ship_to is not null then
    if (new.ship_to ->> 'country') is distinct from (old.ship_to ->> 'country') then
      if not public.market_allows('shipping_country', new.ship_to ->> 'country') then
        perform public.market_refuse('market_rule', 'ship_to_country',
          'ship_to.country=' || coalesce(new.ship_to ->> 'country', 'null'));
      end if;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists orders_market_guard_change on public.orders;
create trigger orders_market_guard_change
  before update of currency, ship_to on public.orders
  for each row
  when (old.currency is distinct from new.currency
        or (old.ship_to ->> 'country') is distinct from (new.ship_to ->> 'country'))
  execute function public.market_guard_orders_change();
```

`product_id` is deliberately NOT in its column list: deleting a product sets
`orders.product_id` (Replica:294) and `order_add_ons.product_id`
(20261028:110) to null through a referential UPDATE, which fires BEFORE UPDATE
triggers on those columns; a guard there would make every product deletion with
legacy orders fail.

**Old rows.** Insert-only, plus the change guard that only fires when the
currency or the ship-to country actually changes. Every routine update writes
other columns: `order_confirm_paid` (status, `pending_expires_at`, `payment_ref`:
20261008_order_lifecycle.sql:226-263), `order_mark_shipped` (fulfilment columns:
20261001_order_tracking_carrier.sql:66-136), `order_apply_refund`
(20261028:443-511), `stock_reserved` inside `order_place`, the review reminder
columns (20261102), the fee correction after payment, and the simulator's
multi-row ship step (20260927_demo_sales_sim_fulfilment.sql:210-216). Deletes
(`orders_release_expired`, `order_release_pending`, the simulator's prune,
account deletion cascades) fire no UPDATE trigger.

**Service role.** Bound, which is the point: it is the only writer of orders.
The orders guard runs when `order_place` inserts the pending order, which
happens BEFORE any Stripe session exists (`reservePendingOrder`, then the
session, then `payment_ref`: inventory 03 section 3, `stripe-provider.ts:71-201`),
so a refusal costs the buyer nothing.

**Why no re-check at `pending -> paid`.** By the time `order_confirm_paid` runs,
the buyer has paid on Stripe. Refusing that UPDATE in the database would leave a
paid charge with an order that later expires and is released: money with no
order, the exact case `alertOps` exists for (Store/src/lib/ops/alert.ts:1-16). A
change of seller or market during the up to 45-minute window must be handled in
the webhook by the app (refund or accept), not by a database refusal.

**Why triggers and not a redefined `order_place`.** The rules must also bind the
simulator (which never calls `order_place`), seeds, fixtures and any future
writer; a trigger does, a function does not. It also keeps the rules out of the
function that the pending cart migration rewrites. (`order_place` IS redefined
in file 3, but only so it carries `billing_country`: section 4.)

### 3e. seller_payment_accounts

**Semantics.** A row may exist for any seller (onboarding can start), but it may
be **charges-enabled only if its stored Stripe country is present, in
`seller_countries`, and equal to `market_seller_country(owner)`**. Enforced by
refusing (`market_rule:account_country`), not by rewriting the flag.

**When it fires.** `BEFORE INSERT WHEN (new.charges_enabled)` and `BEFORE UPDATE
OF charges_enabled, country WHEN (new.charges_enabled and
(old.charges_enabled is distinct from new.charges_enabled or old.country is
distinct from new.country))`. A re-sync that writes the same enabled flag and
the same country does not fire.

```sql
create or replace function public.market_guard_payment_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text;
begin
  if not new.charges_enabled then
    return new;
  end if;
  v_country := public.market_seller_country(new.owner_id);
  if new.country is null
     or v_country is null
     or new.country is distinct from v_country
     or not public.market_allows('seller_country', new.country) then
    perform public.market_refuse('market_rule', 'account_country',
      'account=' || coalesce(new.country, 'null') || ' seller=' || coalesce(v_country, 'null'));
  end if;
  return new;
end
$$;

drop trigger if exists seller_payment_accounts_market_guard_insert on public.seller_payment_accounts;
create trigger seller_payment_accounts_market_guard_insert
  before insert on public.seller_payment_accounts
  for each row when (new.charges_enabled)
  execute function public.market_guard_payment_accounts();

drop trigger if exists seller_payment_accounts_market_guard_update on public.seller_payment_accounts;
create trigger seller_payment_accounts_market_guard_update
  before update of charges_enabled, country on public.seller_payment_accounts
  for each row
  when (new.charges_enabled
        and (old.charges_enabled is distinct from new.charges_enabled or old.country is distinct from new.country))
  execute function public.market_guard_payment_accounts();
```

**Why refuse rather than coerce.** Silently storing `false` when Stripe said
`true` would make the row lie with no trace. Refusing makes a forgotten app path
loud (the webhook fails, Stripe retries, the error collector emails). The column
comment of `charges_enabled` already defines it by what checkout does with it
("Checkout is offered for the seller's products only while this is true",
20261008_seller_payment_accounts.sql:53-54), so the app writing "Stripe says yes
and the market allows it" is consistent with its meaning; restate the comment in
file 3. Why "equal to the seller's country" and not only "allowed": R1 names both
the Stripe account country and the business country, and a Stripe account's
country cannot change after creation, so the two must agree for the
establishment to be one fact. Guard (a)'s `country_locked` and
`seller_sell_block`'s `account_country` keep it true from the other side.

**Old rows.** 0 rows in production. **Service role.** Bound; it is the only
writer (20261008_seller_payment_accounts.sql:61-63).

### 3f. Shipping terms (`profiles.shipping_policy`, jsonb)

**Recommendation: no database guard.** The application validator
(Store/src/lib/validation/shipping-policy.ts:67-138) plus the orders guard plus
the monitor's advisory classes are the right places.

* The policy moves no money and creates no order. Every order's actual delivery
  country and currency are checked at insert (3d), whatever the policy says, so
  a policy listing "DE" cannot produce a DE delivery.
* It has exactly one writer, the service role behind `saveShippingPolicy`
  (`guard_seller_text` already refuses every other writer:
  20261012_auto_moderation.sql:735-777), which already validates with Zod. A
  database copy of that validator adds no new path coverage.
* Its semantics are application semantics: an absent `ratesCurrency` means EUR,
  `"*"` means "everywhere else", and a destination row may have no `countries`
  at all (free text such as "EU"). A SQL mirror of those rules would drift from
  the Zod schema, and a "valid" free-text row cannot be judged by SQL anyway.
* A guard would refuse a legacy policy's next save even when the seller is
  fixing it partially.

The monitor reports non-market `ratesCurrency` and destinations (including
`"*"` and free-text rows) as advisory classes (section 6), so they are visible
without paging anyone. The TS side must make the quote refuse a policy whose
`ratesCurrency` differs from the order currency.

---

## 4. The additive columns (file 3, `20261122_market_3_columns.sql`)

```sql
-- =============================================================================
-- Facts the market rules need that were not stored (R1, R4, R8). Additive,
-- nullable, no backfill: nothing reads them until the app writes them.
-- Shape CHECKs only; which values are allowed is the guards' job.
-- =============================================================================

alter table public.seller_payment_accounts add column if not exists country text;
alter table public.seller_payment_accounts drop constraint if exists seller_payment_accounts_country_shape;
alter table public.seller_payment_accounts
  add constraint seller_payment_accounts_country_shape check (country is null or country ~ '^[A-Z]{2}$');
comment on column public.seller_payment_accounts.country is
  'The connected account''s country as Stripe reports it (Account.country), written by the server on every sync. A charges-enabled account must be in an allowed seller country and match the seller''s country (market guards).';
comment on column public.seller_payment_accounts.charges_enabled is
  'Checkout may charge this account: Stripe will take payments on it AND it passes the market rules. Checkout is offered for the seller''s products only while this is true.';

alter table public.orders add column if not exists billing_country text;
alter table public.orders add column if not exists card_country text;
alter table public.orders drop constraint if exists orders_billing_country_shape;
alter table public.orders
  add constraint orders_billing_country_shape check (billing_country is null or billing_country ~ '^[A-Z]{2}$');
alter table public.orders drop constraint if exists orders_card_country_shape;
alter table public.orders
  add constraint orders_card_country_shape check (card_country is null or card_country ~ '^[A-Z]{2}$');
comment on column public.orders.billing_country is
  'The buyer''s billing country as declared at checkout, before payment. An order with a download needs an allowed one (R4). Written by order_place.';
comment on column public.orders.card_country is
  'The country of the card that paid, from the payment provider after payment. Evidence only: never a reason to refuse an order.';

alter table public.waitlist_signups add column if not exists country text;
alter table public.waitlist_signups drop constraint if exists waitlist_signups_country_shape;
alter table public.waitlist_signups
  add constraint waitlist_signups_country_shape check (country is null or country ~ '^[A-Z]{2}$');
comment on column public.waitlist_signups.country is
  'The country of a seller waiting for their market to open (R8). Any ISO 3166-1 alpha-2 code.';

notify pgrst, 'reload schema';
```

Plus the `order_place` change below.

| Column | Writer | RLS and grant consequences | Backfill |
|---|---|---|---|
| `seller_payment_accounts.country` | service role (TS sync from Stripe) | none: the table is service-role only, RLS on, no policy (20261008_seller_payment_accounts.sql:61-63) | none (0 rows) |
| `orders.billing_country` | `order_place` (service role) | sellers and team members with `store.read` can read it through the existing SELECT policy (Replica:981-986), like `ship_to`. No client write path (orders has no write policy) | none: existing digital orders stay null and are baselined (section 6) |
| `orders.card_country` | service-role update after payment (webhook) | readable by the store's team the same way. A column REVOKE cannot narrow the table-level grant `authenticated` holds on orders (inventory 05 section 2.1), so if card evidence should be staff-only, it belongs in a separate service-role table keyed by `order_id` (no FK cascade, see section 10) instead of on orders: owner's call | none |
| `waitlist_signups.country` | Home's `/api/waitlist` with the anon key (Home/src/app/api/waitlist/route.ts:85-86) | `anon` and `authenticated` hold table-level INSERT (default privileges, never revoked), so the new column is insertable at once; the insert policy (Replica:2757-2768) checks `owner_id`, `list_id`, email and source lengths and needs no change; the 60-per-minute rate trigger (20261105_write_bounds.sql) still applies; read by the service role only (Admin) | none (19 rows stay null) |

The table `waitlist_signups` has no migration file in any repo; its definition
lives only in the replica (Replica:1154-1167, policy rewritten at 2757-2768,
unique index Admin 0002 / Replica:1193). The `alter table` above is the first
repo migration to touch it; read its live definition first (memory
`test-db-isolation.md`).

**`order_place` carries `billing_country`.** Its insert lists columns
explicitly (20261120:207-238), so a `billing_country` key in the JSON is filled
into `incoming` by `jsonb_populate_record` and then dropped. For the guard to see
the billing country at insert, before payment, `order_place` must write it. This
is the one redefinition, and the minimal one:

* Start from `Store/supabase/migrations/20261120_shopping_cart.sql:171-340`
  verbatim (NOT the applied 20261028 body: that would drop the cart's 19 lines).
* Column list: after `lines_digest, cart_id,` add `billing_country,`.
* Values: after `incoming.lines_digest, incoming.cart_id,` add
  `incoming.billing_country,`.
* Restate `revoke execute on function public.order_place(jsonb) from public,
  anon, authenticated; grant execute on function public.order_place(jsonb) to
  service_role;`.
* Body sentinel: `incoming.billing_country`.
* Never re-run 20261120 after this file: it would silently remove
  `billing_country` again (the body sentinel would catch it at the next deploy).

Rejected alternative: writing `billing_country` with a second statement after
`order_place` returns. The pending order would exist for a moment without it,
and the insert guard could never require it before payment (R6).

`card_country` is known only after payment, so it is not in `order_place`.

---

## 5. The demo sales simulator

### 5.1 What it is and where

* Base: `Store/supabase/migrations/20260801_demo_sales_sim.sql` (production
  ledger version 20260801140113): schema `demo`, config table `demo.sales_sim`
  (86-119, `currency text not null default 'EUR'` at 110), definer functions,
  `demo.sales_sim_backfill` (420-459, still the latest), schedule
  `cron.schedule('demo-sales-sim', '*/20 * * * *', ...)` (482-485).
* `20260830_demo_sales_sim_signals.sql`: three counter columns (34-37), signal
  emitters, a newer tick.
* `20260927_demo_sales_sim_fulfilment.sql` (latest for the order path):
  `demo.ship_to` (49-81, ten EU addresses, one in CZ), `demo.sales_sim_emit`
  (88-190, inserts `public.orders` directly with `cfg.currency` and
  `demo.ship_to(buyer)`, status mix including refunded, disputed, pending),
  `demo.sales_sim_ship` (197-220, multi-row UPDATE to shipped),
  `demo.sales_sim_tick` (226-304: prune, ship, emit, signals), grants (308-314).
* **Not found in any repo:** `demo_sales_sim_reconcile` (production ledger
  version 20260801140742, named in Replica:19-23 and
  `Store/scripts/check-prod-migrations.ts:98-101`). It ran minutes after the base
  and before the 20260830 and 20260927 replacements, so the live function bodies
  are most likely the 20260927 ones, but production is ahead of the repo (SQ-app
  shares the database). **The build agent must read the live definitions first**
  (read-only: `select pg_get_functiondef('demo.sales_sim_emit(integer,timestamp
  with time zone,timestamp with time zone)'::regprocedure)`, same for
  `sales_sim_tick(timestamp with time zone)` and the columns of
  `demo.sales_sim`) and base the replacement on what is live.
* Production facts: enabled, `currency = 'EUR'`, ticked today; its seller is CZ
  with EUR products and `shipping_policy.ratesCurrency` EUR.

### 5.2 Why it must change

With guard (d) in place, today's simulator would insert EUR orders shipped to
nine non-CZ countries; the first refused row raises inside `sales_sim_emit`,
which rolls back the whole tick (prune and ship included) every 20 minutes.

### 5.3 The change (file 4, `20261122_market_4_demo_sim.sql`)

Recommended: the simulator follows the mirror, so a simulated sale is one a real
buyer could make.

* Sell only products whose currency is allowed, **in that product's own
  currency** (no `cfg.currency` any more; the column stays, unused, documented as
  such). Order currency then always equals product currency, which guard (d)
  requires.
* Deliver only to addresses in allowed shipping countries: a STABLE
  `demo.market_ship_to(email)` picks by the same hash among the addresses the
  mirror allows. Four more Czech addresses (ASCII only) keep the demo plausible.
* Ask the sell gate first: if `public.seller_sell_block(cfg.seller_id)` is not
  null, emit nothing.
* A refused emit costs only that tick's sales: the tick catches the error,
  records it in a new column `demo.sales_sim.last_tick_error`, and the prune,
  ship step and signals still run.

```sql
-- =============================================================================
-- Demo sales simulator follows the market rules (public.market_rules).
-- A simulated sale is one a real buyer could make: only products in a currency
-- the market sells, in that product's own currency, delivered to a country the
-- market serves, for a seller the market allows. demo.sales_sim.currency is no
-- longer read.
--
-- BASED ON THE LIVE DEFINITIONS, read first with pg_get_functiondef (production
-- carries demo_sales_sim_reconcile, which no repo has). EXCLUDED FROM THE TEST
-- REPLICA like every demo migration (pg_cron). Apply BEFORE
-- 20261122_market_6_guards, after 20261122_market_2_rules_mirror.
-- =============================================================================

alter table demo.sales_sim add column if not exists last_tick_error text;
comment on column demo.sales_sim.currency is
  'Unused since 20261122_market_4_demo_sim: each simulated order is in its product''s own currency.';

create or replace function demo.market_ship_to(p_email text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with addresses(line1, city, postal, country) as (
    values
      ('12 Harbour Road',      'Dublin',     'D02 X285', 'IE'),
      ('Lindenstrasse 14',     'Berlin',     '10115',    'DE'),
      ('7 Rue des Lilas',      'Lyon',       '69003',    'FR'),
      ('Keizersgracht 221',    'Amsterdam',  '1016 DV',  'NL'),
      ('Via Roma 45',          'Bologna',    '40121',    'IT'),
      ('Calle Mayor 8, 2B',    'Madrid',     '28013',    'ES'),
      ('Vinohradska 112',      'Praha 2',    '120 00',   'CZ'),
      ('Masarykova 12',        'Brno',       '602 00',   'CZ'),
      ('Nadrazni 45',          'Ostrava',    '702 00',   'CZ'),
      ('Americka 8',           'Plzen',      '301 00',   'CZ'),
      ('Husova 3',             'Olomouc',    '779 00',   'CZ'),
      ('ul. Mokotowska 19',    'Warszawa',   '00-561',   'PL'),
      ('Rua das Flores 27',    'Porto',      '4050-265', 'PT'),
      ('Obchodna 31',          'Bratislava', '811 06',   'SK')
  ),
  allowed as (
    select a.*,
           row_number() over (order by a.country, a.city) - 1 as n,
           count(*) over () as total
      from addresses a
     where public.market_allows('shipping_country', a.country)
  )
  select jsonb_build_object(
    'name', demo.buyer_name(p_email),
    'line1', line1,
    'city', city,
    'postalCode', postal,
    'country', country
  )
  from allowed
  -- Masked rather than abs(): abs() of the smallest int overflows.
  where n = (pg_catalog.hashtext(p_email) & 2147483647) % total;
$$;

revoke execute on function demo.market_ship_to(text) from public, anon, authenticated;
```

`demo.sales_sim_emit`: the live body (20260927:88-190 on disk) with these
changes, nothing else:

1. After `if cfg.seller_id is null then return 0; end if;` add
   `if public.seller_sell_block(cfg.seller_id) is not null then return 0; end if;`.
2. `catalogue`: select `p.currency` too, and add
   `and public.market_allows('currency', p.currency)` to its WHERE.
3. Carry `currency` through `weighted`, the lateral pick in `chosen`
   (`select w.id, w.title, w.price_cents, w.currency ...`) and `rolled`.
4. In `rolled`, add `demo.market_ship_to(c.buyer) as ship_to`.
5. In the INSERT, use `r.currency` instead of `cfg.currency` and `r.ship_to`
   instead of `demo.ship_to(r.buyer)`; the final WHERE becomes
   `where r.product_id is not null and r.ship_to is not null`.

`demo.sales_sim_tick`: the live body (20260927:226-304 on disk) with a
`v_error text;` declaration, the emit call wrapped, and the error recorded:

```sql
  v_count := demo.stochastic_round(v_expected);
  if v_count > 0 then
    begin
      v_inserted := demo.sales_sim_emit(v_count, v_from, p_now);
    exception when others then
      -- A refusal (a market rule, a constraint) costs this tick's sales only:
      -- the prune and ship steps above and the signals below still stand.
      v_inserted := 0;
      v_error := left(sqlstate || ' ' || sqlerrm, 500);
    end;
  end if;
  -- ... signals unchanged ...
  update demo.sales_sim
     set last_tick_at = p_now,
         last_tick_inserted = v_inserted,
         last_tick_pruned = v_pruned,
         last_tick_views_inserted = v_views_inserted,
         last_tick_clicks_inserted = v_clicks_inserted,
         last_tick_signals_pruned = v_signals_pruned,
         last_tick_error = v_error
   where id;
```

Restate the 20260927 grants (revoke from `public, anon, authenticated` on
`demo.market_ship_to`, `demo.sales_sim_emit`, `demo.sales_sim_tick`; grant tick
to `service_role`). `demo.sales_sim_backfill` calls `sales_sim_emit`, so it
follows the rules with no change. `demo.ship_to` is left in place, unused.

Not modelled, unchanged: the simulator does not copy `digital_file_key`, so
every simulated order counts as a parcel with an address, which passes 3d.

### 5.4 What happens on the day, and the owner's choice

All products of the simulator's seller are EUR, so once file 4 is applied the
simulator **emits no orders** (it still prunes, ships and writes signals, and
never errors). The demo dashboard's orders then age out over `retention_days`
(120). The owner chooses one of:

* **Re-price the demo seller's products in CZK** (recommended: the demo then
  looks like a Czech store in the beta; a data change on the demo account, so it
  needs the owner's OK; done through the app or one reviewed UPDATE of
  `currency` and `price_cents`). Mixed EUR and CZK figures on that dashboard
  until the phase B reporting change (2.2).
* **Pause it** (`update demo.sales_sim set enabled = false where id;`, owner's
  OK).

Rejected: exempting the simulator's seller from the guards (an identity bypass
is exactly the forgotten path the guards exist to close, and its rows would then
look like real violations to the monitor forever).

Verification after applying (read-only): `select enabled, last_tick_at,
last_tick_inserted, last_tick_error from demo.sales_sim;` and the latest rows of
`cron.job_run_details` for `demo-sales-sim` (the base migration's own recipe,
20260801_demo_sales_sim.sql:54-66). The simulator cannot be exercised in the
replica (no `demo` schema there).

---

## 6. Monitoring

### 6.1 Legacy versus new: the baseline

Classes must read zero in the steady state while legacy rows exist. Options
weighed:

* **A watermark timestamp alone** (`created_at < enforced_from`) works for
  orders but not for mutable rows: `products.updated_at` moves on every stock
  change, profiles have no "country set at", and a bypass that UPDATEs an old
  row into a new violation would be classified legacy. A backdated insert would
  too (the simulator itself writes `created_at`).
* **Excluding the simulator's seller** zeroes only that seller (the IE seller
  and the no-country seller remain) and permanently blinds the monitor to that
  account, including real future violations there.
* **Chosen: a baseline snapshot with a fingerprint**, captured in the same
  transaction that switches the guards on. It records `(class, entity_id,
  detail)` where `detail` is the violating value itself (a currency, a country,
  a block reason). A violation is legacy only if exactly that row was already
  breaking exactly that rule with exactly that value. Anything else, including a
  bypassed write to an old row or a new rule applying to an old seller, is new.
  It is small (about 2,500 rows, mostly orders), and it drains by itself as the
  simulator prunes old orders.
* The mirror's `enforced_from` is kept as the explicit "since when" (null =
  report-only) and gates alerting, not classification.

```sql
create table if not exists public.market_rule_baseline (
  class       text not null,
  entity_id   text not null,
  detail      text not null,
  captured_at timestamptz not null default now(),
  primary key (class, entity_id, detail)
);

comment on table public.market_rule_baseline is
  'Violations that already existed when the market guards were switched on: (class, row id, violating value). market_rule_violations() counts these as legacy and everything else as new. Ids and codes only. No foreign keys on purpose: rows may outlive what they name. Written only by market_rule_baseline_capture(), run by migrations.';

alter table public.market_rule_baseline enable row level security;
revoke all on table public.market_rule_baseline from public, anon, authenticated, service_role;
grant select on table public.market_rule_baseline to service_role;
```

Add it to `POLICY_FREE_BY_DESIGN` (reason: "a client that could write it could
mark its own violation as legacy and silence the alert") and to the harness
table list.

### 6.2 The functions (file 5, `20261122_market_5_monitor.sql`)

Three functions, so classes can be added without changing any signature: a
catalogue, a row producer, a summary.

```sql
-- The catalogue: every class the monitor knows, which rule it belongs to, and
-- whether it pages someone. ADDING A CLASS = one row here + one branch in
-- market_rule_violation_rows(). Same signatures, CREATE OR REPLACE.
create or replace function public.market_rule_classes()
returns table (rule text, class text, alerts boolean, sort_order integer)
language sql
immutable
set search_path = ''
as $$
  values
    ('R1', 'r1_seller_country',          true,  10),
    ('R1', 'r1_live_seller_blocked',     true,  11),
    ('R1', 'r1_account_country',         true,  12),
    ('R2', 'r2_product_currency',        true,  20),
    ('R2', 'r2_discount_currency',       true,  21),
    ('R2', 'r2_order_currency',          true,  22),
    ('R2', 'r2_policy_rates_currency',   false, 23),
    ('R3', 'r3_order_ship_to_country',   true,  30),
    ('R3', 'r3_order_ship_to_missing',   true,  31),
    ('R3', 'r3_policy_destination',      false, 32),
    ('R4', 'r4_digital_billing_country', true,  40),
    ('R4', 'r4_card_country_differs',    false, 41),
    ('R5', 'r5_order_line_seller',       true,  50),
    ('R5', 'r5_add_on_link_seller',      true,  51),
    ('R5', 'r5_cart_line_seller',        true,  52),
    ('R6', 'r6_guard_missing',           true,  60),
    ('R6', 'r6_mirror_missing',          true,  61)
$$;

-- Every violating row, one per (class, entity, violating value). Ids and codes
-- only: never an email, a name, an address, a cart id or a discount code.
create or replace function public.market_rule_violation_rows()
returns table (class text, entity_id text, detail text)
language sql
stable
security invoker
set search_path = ''
as $$
  with sellers as (
    select owner_id as id from public.products
    union select owner_id from public.storefronts
    union select owner_id from public.seller_payment_accounts
    union select seller_id from public.orders
  ),
  live_sellers as (
    select distinct owner_id as id from public.products where status = 'active'
  ),
  digital_orders as (
    select o.id, o.billing_country
      from public.orders o
     where o.digital_file_key is not null
        or exists (select 1 from public.order_add_ons a
                    where a.order_id = o.id and a.digital_file_key is not null)
  ),
  destinations as (
    select p.id as seller_id, d.dest
      from public.profiles p
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(p.shipping_policy -> 'destinations') = 'array'
             then p.shipping_policy -> 'destinations' else '[]'::jsonb end) as d(dest)
  )
  -- R1: who sells
  select 'r1_seller_country', s.id::text, c.country
    from sellers s
    cross join lateral (select public.market_seller_country(s.id) as country) c
   where c.country is not null
     and not public.market_allows('seller_country', c.country)
  union all
  select 'r1_live_seller_blocked', l.id::text, b.reason
    from live_sellers l
    cross join lateral (select public.seller_sell_block(l.id) as reason) b
   where b.reason is not null
  union all
  select 'r1_account_country', a.owner_id::text, coalesce(a.country, 'none')
    from public.seller_payment_accounts a
   where a.charges_enabled
     and (a.country is null
          or not public.market_allows('seller_country', a.country)
          or a.country is distinct from public.market_seller_country(a.owner_id))
  -- R2: money
  union all
  select 'r2_product_currency', p.id::text, p.currency
    from public.products p
   where not public.market_allows('currency', p.currency)
  union all
  select 'r2_discount_currency', d.id::text, coalesce(d.currency, 'none')
    from public.discounts d
   where d.value_type = 'amount' and d.archived_at is null
     and not public.market_allows('currency', d.currency)
  union all
  select 'r2_order_currency', o.id::text, o.currency
    from public.orders o
   where not public.market_allows('currency', o.currency)
  union all
  select 'r2_policy_rates_currency', p.id::text, coalesce(p.shipping_policy ->> 'ratesCurrency', 'EUR')
    from public.profiles p
   where p.shipping_policy is not null
     and not public.market_allows('currency', coalesce(p.shipping_policy ->> 'ratesCurrency', 'EUR'))
     and (jsonb_path_exists(p.shipping_policy, '$.destinations[*].rateCents')
          or jsonb_path_exists(p.shipping_policy, '$.freeOverCents')
          or jsonb_path_exists(p.shipping_policy, '$.profiles[*].rateCents'))
  -- R3: delivery
  union all
  select 'r3_order_ship_to_country', o.id::text, coalesce(o.ship_to ->> 'country', 'none')
    from public.orders o
   where o.ship_to is not null
     and not public.market_allows('shipping_country', o.ship_to ->> 'country')
  union all
  select 'r3_order_ship_to_missing', o.id::text, 'none'
    from public.orders o
   where o.ship_to is null and o.fulfilment_status = 'unfulfilled' and o.status in ('paid', 'pending')
  union all
  select distinct 'r3_policy_destination', d.seller_id::text, coalesce(c.code, 'free_text')
    from destinations d
    left join lateral jsonb_array_elements_text(
      case when jsonb_typeof(d.dest -> 'countries') = 'array' then d.dest -> 'countries' end
    ) as c(code) on true
   where c.code is null or not public.market_allows('shipping_country', c.code)
  -- R4: downloads
  union all
  select 'r4_digital_billing_country', g.id::text, coalesce(g.billing_country, 'none')
    from digital_orders g
   where g.billing_country is null
      or not public.market_allows('billing_country', g.billing_country)
  union all
  select 'r4_card_country_differs', o.id::text, o.card_country
    from public.orders o
   where o.card_country is not null and o.billing_country is not null
     and o.card_country <> o.billing_country
  -- R5: one seller per order (no collab checkout exists)
  union all
  select 'r5_order_line_seller', o.id::text, 'main'
    from public.orders o
    join public.products p on p.id = o.product_id
   where p.owner_id <> o.seller_id
  union all
  select distinct 'r5_order_line_seller', a.order_id::text, 'line'
    from public.order_add_ons a
    join public.orders o on o.id = a.order_id
    left join public.products p on p.id = a.product_id
   where a.seller_id <> o.seller_id or p.owner_id <> o.seller_id
  union all
  select 'r5_add_on_link_seller', pr.id::text, ao.id::text
    from public.products pr
    join public.products ao on ao.id = any (pr.add_on_ids)
   where ao.owner_id <> pr.owner_id
  union all
  -- Open carts holding another seller's product. The entity is the STOREFRONT:
  -- a cart id is the buyer's capability and is never reported.
  select distinct 'r5_cart_line_seller', c.storefront_id::text, pr.id::text
    from public.carts c
    join public.storefronts sf on sf.id = c.storefront_id
    cross join lateral jsonb_array_elements(c.lines) as line(l)
    join public.products pr
      on pr.id = case when line.l ->> 'productId' ~ '^[0-9a-f-]{36}$'
                      then (line.l ->> 'productId')::uuid end
   where c.ordered_at is null and pr.owner_id <> sf.owner_id
  -- R6: enforcement is in place (only once it has been switched on)
  union all
  select 'r6_guard_missing', g.trigger_name, g.table_name
    from (values
      ('profiles',                'profiles_market_guard_insert'),
      ('profiles',                'profiles_market_guard_update'),
      ('products',                'products_market_guard_insert'),
      ('products',                'products_market_guard_update'),
      ('discounts',               'discounts_market_guard_insert'),
      ('discounts',               'discounts_market_guard_update'),
      ('orders',                  'orders_market_guard_insert'),
      ('orders',                  'orders_market_guard_change'),
      ('order_add_ons',           'order_add_ons_market_guard_insert'),
      ('seller_payment_accounts', 'seller_payment_accounts_market_guard_insert'),
      ('seller_payment_accounts', 'seller_payment_accounts_market_guard_update')
    ) as g(table_name, trigger_name)
   where (select m.enforced_from from public.market_rules m where m.id) is not null
     and not exists (
       select 1 from pg_catalog.pg_trigger t
        where t.tgrelid = to_regclass('public.' || g.table_name)
          and t.tgname = g.trigger_name
          and t.tgenabled in ('O', 'A'))
  union all
  select 'r6_mirror_missing', 'market_rules', 'none'
   where not exists (select 1 from public.market_rules m where m.id)
$$;

-- One row per class, always (a missing row means the catalogue changed).
-- alerts = this class pages someone now: it is an alerting class, enforcement
-- is on, and it has at least one violation that is not in the baseline.
create or replace function public.market_rule_violations(p_samples integer default 5)
returns table (
  rule text, class text, alerts boolean,
  new_count bigint, legacy_count bigint,
  new_samples text[], legacy_samples text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with state as (
    select coalesce((select m.enforced_from is not null from public.market_rules m where m.id), false) as enforcing
  ),
  found as (
    select v.class, v.entity_id, v.detail,
           exists (select 1 from public.market_rule_baseline b
                    where b.class = v.class and b.entity_id = v.entity_id and b.detail = v.detail) as legacy
      from public.market_rule_violation_rows() v
  ),
  classes as (
    select c.rule, c.class, c.alerts, c.sort_order from public.market_rule_classes() c
    union all
    -- A class the rows produce but the catalogue forgot: loud, never silent.
    select 'unknown', f.class, true, 1000
      from (select distinct class from found) f
     where f.class not in (select k.class from public.market_rule_classes() k)
  )
  select c.rule,
         c.class,
         c.alerts and s.enforcing and count(f.entity_id) filter (where not f.legacy) > 0,
         count(f.entity_id) filter (where not f.legacy),
         count(f.entity_id) filter (where f.legacy),
         coalesce((array_agg(f.entity_id order by f.entity_id) filter (where not f.legacy))[1:greatest(p_samples, 0)], '{}'),
         coalesce((array_agg(f.entity_id order by f.entity_id) filter (where f.legacy))[1:greatest(p_samples, 0)], '{}')
    from classes c
    cross join state s
    left join found f on f.class = c.class
   group by c.rule, c.class, c.alerts, c.sort_order, s.enforcing
   order by c.sort_order, c.class
$$;

-- Records the given classes' current violations as legacy. Run by migrations
-- only (file 6 at switch-on; 1B for its own classes at its rollout). Never the
-- R6 classes: a missing guard must never become "legacy".
create or replace function public.market_rule_baseline_capture(p_classes text[])
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with added as (
    insert into public.market_rule_baseline (class, entity_id, detail)
    select distinct v.class, v.entity_id, v.detail
      from public.market_rule_violation_rows() v
     where v.class = any (p_classes)
       and v.class not like 'r6\_%'
    on conflict do nothing
    returning 1
  )
  select count(*)::integer from added
$$;

revoke execute on function public.market_rule_classes() from public, anon, authenticated;
revoke execute on function public.market_rule_violation_rows() from public, anon, authenticated;
revoke execute on function public.market_rule_violations(integer) from public, anon, authenticated;
grant execute on function public.market_rule_classes() to service_role;
grant execute on function public.market_rule_violation_rows() to service_role;
grant execute on function public.market_rule_violations(integer) to service_role;
revoke execute on function public.market_rule_baseline_capture(text[])
  from public, anon, authenticated, service_role;
```

Notes:

* `security invoker` on purpose: run by the service role (BYPASSRLS) it sees
  everything; run by anyone else it would see only what their RLS allows, and
  nobody else holds EXECUTE. `backup_reader` can be granted EXECUTE in
  production for ad-hoc reads (not in the migration: the role does not exist in
  the replica, and a GRANT to a missing role fails the replay).
* It references `public.carts`, so file 5 must be applied after 20261120 (it
  would fail atomically otherwise; nothing is half-applied).
* Detail values are the violating value only (never a status), so a legacy order
  that is later refunded or shipped stays legacy.
* Cost: a handful of scans over tables of a few thousand rows and one helper
  call per row. Run once a day.
* Report-only phase for free: between file 5 and file 6 `enforced_from` is null,
  so `alerts` is false everywhere and the counts show what WOULD be flagged.

### 6.3 Who may execute

`market_rule_violations`, `market_rule_violation_rows`, `market_rule_classes`:
`service_role` only. `market_rule_baseline_capture`: nobody but the owner
(migrations), so the app can never mute its own alarm.

### 6.4 Scheduling and alerting: recommendation

**GitHub Actions, daily, calling a cron-secret route; alerts through channels
that already work.**

* Add a job `market-check` to `Store/.github/workflows/scheduled.yml` (03:23
  UTC, lines 30-35), first in the file; make `account-deletions` depend on it
  with `needs: market-check` and `if: always()`, so the day's report is taken
  before any account (and, by cascade, its orders: Replica:293) is deleted, and a
  red check never blocks deletions. Same shape as the existing jobs: skip loudly
  without `CRON_SECRET`, `curl --fail` a POST to `/api/cron/market-check`, print
  counts only (the scheduled jobs never print ids: scheduled.yml:27).
* The route (TS side) is guarded by `cronAuthorized` (Store/src/lib/ops/cron.ts),
  calls `market_rule_violations()` with the admin client, and when any row has
  `alerts = true`: logs one `[ops alert]` line with class counts and sample ids
  through `alertOps` (Store/src/lib/ops/alert.ts, which also emails
  `OPS_ALERT_EMAIL` once app mail is on), then throws an error whose message
  names classes and counts only. The thrown error goes through the existing
  `reportServerError` path (Store/src/lib/ops/report-error.ts) to the uptime
  Worker's `/report` collector, which **emails today** over its own Brevo SMTP
  even though app mail is off (memory `uptime-monitor-and-alerts.md`), and the
  route's 500 turns the workflow red (GitHub notifies the workflow's owner).
  Otherwise it answers 200 with the counts, legacy included.

Why not the others:

* **pg_cron** can run the function but cannot tell anyone: its result lands in
  `cron.job_run_details`, which nobody reads. Alerting from SQL needs `pg_net`
  and Vault secrets.
* **The admin notification scan** (Admin/supabase/migrations/0006_admin_notifications.sql:128-184,
  per minute, `pg_net` to the Admin app, armed by Vault secrets) belongs to the
  Admin repo, runs 1,440 times a day for a check that is expected to be zero, and
  would couple a Store rule to Admin's deploys. A later Admin page could display
  `market_rule_violations()` read-only; it should not be the alarm.
* **The uptime Worker's per-minute checks** (Store/ops/uptime) would need a new
  authenticated endpoint and would query the database every minute. Its mail
  path is reused anyway, through `/report`.

---

## 7. Migration plan

### 7.1 Files, in order of application

Names keep the repo's `YYYYMMDD_name.sql` convention, numbered so alphabetical
order is application order. Every file: **needs the owner's approval before it is
applied to production.** ASCII only (the WIN1252 replica). All after
`20261120_shopping_cart.sql`.

| # | File | Contains | Replica replay | Sentinel (`Store/scripts/lib/prod-schema.ts`) |
|---|---|---|---|---|
| 0 | `20261120_shopping_cart.sql` (exists, unapplied) | the cart; `order_place` 20261120 body | already `(pending)` at Replica:13838 | already listed (176-203) |
| 1 | `20261122_market_1_czk_currency.sql` | 2.1 | yes | `check` `products_currency_check` allows `CZK`; same for `product_price_history_currency_check`, `discounts_value`, `orders_currency_supported` |
| 2 | `20261122_market_2_rules_mirror.sql` | 1.1 to 1.3 (table, seed, helpers, column defaults) | yes | `relation` `market_rules`; `function` `market_allows(text,text)`, `market_default_currency()`, `market_seller_country(uuid)`, `seller_sell_block(uuid)`, `seller_may_sell(uuid)` |
| 3 | `20261122_market_3_columns.sql` | section 4 (columns, comments, `order_place` carrying `billing_country`) | yes | `column` `seller_payment_accounts.country`, `orders.billing_country`, `orders.card_country`, `waitlist_signups.country`; `body` `order_place(jsonb)` includes `incoming.billing_country` |
| 4 | `20261122_market_4_demo_sim.sql` | section 5.3 | **no** (demo schema excluded: header note like 20260927's, Replica:5019-5020) | `UNPROBED_MIGRATIONS`: "Only replaces functions in the demo schema (the pg_cron sales simulator) and adds a column there. The app never calls them." |
| 5 | `20261122_market_5_monitor.sql` | 6.1 and 6.2 (baseline table, four functions; no capture) | yes | `relation` `market_rule_baseline`; `function` `market_rule_violations(integer)`; `body` `market_rule_violation_rows()` includes `r5_cart_line_seller` |
| | **TypeScript deploy** | rules in the app, error mapping, writers of the new columns, cron route | | |
| 6 | `20261122_market_6_guards.sql` | 3.0 to 3e, then `select public.market_rule_baseline_capture(array(select c.class from public.market_rule_classes() c where c.rule in ('R1','R2','R3','R4','R5')));` and `update public.market_rules set enforced_from = now() where id and enforced_from is null;` | yes | `UNPROBED_MIGRATIONS` while unapplied: "Applied AFTER the deploy that maps its refusals; a sentinel would demand the unsafe order (the 20261012_auto_moderation reasoning)." Replace with `function` `market_guard_orders()` and `body` `market_guard_orders()` includes `'ship_to_required'` in the first build after it is applied |
| 7 | `20261122_market_7_billing_required.sql` | `create or replace` of `market_guard_orders` and `market_guard_order_lines` with the R4 requirement: a download with `billing_country is null` raises `market_rule:billing_country_required` | yes | `UNPROBED` until applied, then `body` `market_guard_orders()` includes `billing_country_required` |
| 8 | `20261122_market_8_reporting_currency.sql` (phase B) | overloads with `p_currency` (2.2) | yes | `function` signatures of the new overloads |

Replay blocks: append each replayed file to `Store/tests/db/prod-migrations.sql`
after the `20261120_shopping_cart (pending)` block (Replica:13838 onward), in
the order above, verbatim, each headed
`-- ===== 20261122_market_N_<name> (pending) =====...` like the existing
blocks; drop "(pending)" when production has it (the schema probe, not the
header, is the source of truth: prod-schema.ts:4-24). For file 4 add only a
note block ("NOT replayed: the demo schema is excluded (pg_cron)"), as for
20260927 (Replica:5019-5020). `scripts/check-prod-migrations.ts` needs nothing:
hand-applied migrations write no ledger row (prod-schema.ts:4-14, 43).

Sentinel rule (memory `speed-cost-pass-2026-11.md`): a `body` sentinel must quote
text inside the function, never a header comment; every one above does.
`Store/tests/integration/50-prod-schema-probe.test.ts` runs the probe against the
replica and must pass.

Apply files 1 to 5 as one bundle wrapped in `begin; ... commit;` (the memory
note `supabase-connector-writes-declined.md` route: the owner pastes one file
into the SQL editor). Apply file 6 alone, in one transaction, so the guards, the
baseline capture and `enforced_from` cannot be separated by a write.
Rehearsal (changes nothing): run the file 6 bundle inside `begin; ...; select *
from public.market_rule_violations(); rollback;` and read the counts first.

### 7.2 Code versus migration, per file

| File | If the migration lands first | If the code ships first |
|---|---|---|
| 1 | harmless: nothing writes CZK yet | every CZK product, discount or order save fails on the old CHECKs. Migration first |
| 2 | harmless: inserts without a currency get CZK (only fixtures and seeds omit it) | nothing in the app reads the mirror; the db drift test fails. Either order, migration preferred |
| 3 | harmless: new nullable columns; old app sends no `billing_country` | `seller_payment_accounts.country` writes fail ("column does not exist"), so onboarding sync breaks; Home's waitlist insert with `country` fails; `billing_country` silently dropped by the old `order_place`. Migration first, and Home deploys after it |
| 4 | the simulator stops selling EUR products (emits nothing for the demo seller until re-priced) | n/a (no app code). Must be applied BEFORE file 6, or every tick fails and rolls back |
| 5 | report-only monitor exists, `alerts` false everywhere | the cron route calls a missing function and answers 500 (red job). Migration first |
| 6 | the current app keeps offering EUR and raw database errors appear: product creation with EUR refused, checkouts on the (all EUR) live products refused, publishing by sellers without a country refused. Code first | the app enforces alone and the forgotten paths (PostgREST, MCP, service-role writers, the simulator) stay open until applied. This is the intended order, kept short |
| 7 | every download checkout refused while the app does not send `billing_country` | harmless. Code first, verified in production, then the migration |
| 8 | harmless (new overloads unused) | the app calls overloads that do not exist. Migration first |

### 7.3 Tests to add (db project, after 50: `51-market-rules.test.ts` onward)

Helpers in `Store/tests/db/client.ts`: `createSeller(email?)` (= `createUser` +
`tax_country` set to `MARKET.sellerCountries[0]` as superuser) and
`asLegacy(fn)` (superuser transaction with `set local session_replication_role
= replica`, which skips ordinary triggers for that transaction only: how a test
creates a row "from before the guards").

* **Mirror:** row equals `MARKET` (1.4); `anon`/`authenticated` cannot select
  `market_rules`; `service_role` can select but not update; `authenticated` can
  execute `market_default_currency()` but not `market_allows`; an empty array or
  a lowercase code is refused by the CHECKs.
* **CZK:** a CZK product writes a CZK history row; a CZK amount discount and a
  CZK order are accepted; a product inserted without a currency is CZK.
* **(a) profiles:** owner sets CZ; owner sets IE: `market_rule:seller_country`;
  service role sets IE: refused; superuser sets IE: refused; a legacy IE profile
  (asLegacy) updates `locale`, re-saves IE unchanged, clears to null: all pass;
  with a charges-enabled CZ account, clearing or changing the country:
  `market_rule:country_locked`.
* **(b) products:** insert EUR as user and as service role: refused; change to
  EUR: refused; draft to active by a seller without a country:
  `seller_blocked:seller_country`; by a CZ seller: passes; an editor publishing
  in a CZ owner's store: passes; legacy EUR active product: title and price edits
  pass (an EUR history row is written), unpublish passes, republish refused.
* **"Old EUR row survives a multi-row sweep":** legacy EUR tracked products,
  legacy expired pending EUR orders shipped to DE holding stock (asLegacy), plus
  one compliant pair; `select public.orders_release_expired()` as service role
  succeeds and restocks all; `select public.moderation_recheck_all()` with legacy
  EUR active products succeeds; one UPDATE marking all legacy orders shipped (the
  simulator's ship step) succeeds; `order_mark_shipped` and `order_apply_refund`
  on a legacy order succeed; deleting a legacy product (FK sets `product_id`
  null on legacy orders and lines) succeeds.
* **(c) discounts:** EUR amount discount refused (user, service role); CZK
  passes; percent unaffected; percent to amount with EUR refused.
* **(d) orders:** `order_place` CZK/CZ passes; EUR: `market_rule:currency`;
  seller without country: `seller_blocked:seller_country`; ship-to DE:
  `market_rule:ship_to_country`; parcel without ship-to: `ship_to_required`;
  another seller's product as the first line and as an add-on: `line_seller`;
  add-on priced in another currency: `line_currency`; download with billing IE:
  `billing_country`; billing CZ passes; billing null passes (until file 7);
  amount discount in EUR on a CZK order: `discount_currency`; a repeated
  `checkout_session_id` of a legacy EUR order returns `duplicate: true`, not a
  refusal; a direct service-role insert and a superuser insert are bound; a
  refused add-on rolls the whole order back (no order row, no stock taken);
  changing `ship_to` country of an order to DE: refused; changing only the name
  in `ship_to`: passes.
* **(e) payment accounts:** insert enabled with null country: refused; CZ
  matching the profile: passes; SK: refused; flipping false to true with a
  mismatch: refused; re-sync of an enabled row with unchanged values: passes.
* **Monitor:** on a clean database every class returns a row with zeros; with
  legacy fixtures and `market_rule_baseline_capture(...)` (run as superuser) the
  counts are legacy and `alerts` false; a violation created with asLegacy after
  the capture counts as new and `alerts` true; a legacy order whose status
  changes stays legacy; with `enforced_from` null `alerts` is false; disabling a
  guard trigger shows in `r6_guard_missing`; `anon`/`authenticated` cannot execute
  any monitor function; `service_role` cannot execute the capture.
* **Unit:** `tests/unit/market-mirror-sql.test.ts` (1.4).
* **Coverage lists:** `00-harness` table list and `19-rls-coverage`
  `POLICY_FREE_BY_DESIGN` gain `market_rules` and `market_rule_baseline`.

**Existing tests that will need changes** (the main build cost): 52 product
inserts across 23 integration files and order inserts in 17 files assume EUR
defaults, sellers without a country, or non-CZ addresses; 12 integration files
use `'EUR'`/`'USD'` literals (`16-aggregate-rpcs` tests EUR versus USD
separation: keep it, creating the rows with `asLegacy`). Use `createSeller` and
CZ addresses by default, `asLegacy` where a test genuinely needs a non-market
row. The e2e stack replays the same replica, so its seed helpers
(`seedOrders` and friends) and `Store/scripts/seed.ts`, `stock-smoke.ts` and
`scripts/lib/fake-data.ts` must follow `MARKET` too. `/dev/simulate-sale`
against the production database will be refused for EUR products.

---

## 8. What each guard does to production rows on the day it is applied

Nothing is rewritten, deleted or disabled by any file. Facts from 2026-11-22.

| Data | Rows | On application | Routine operations on them afterwards |
|---|---|---|---|
| profiles | 15: CZ 2, IE 1, null 12 | unchanged | every update that does not change `tax_country` passes; the IE seller cannot switch to another non-market country; clearing passes |
| products | 22, all EUR, 16 live | CHECK widened and validated (all pass); default changes to CZK; no row touched | stock decrements, restocks, the 5-minute expiry sweep, moderation sweeps, title/price edits, unpublish: all pass (trigger not called or `WHEN` false). Republish, duplicate, switch to EUR: refused (intended). Their checkouts are refused by (d) (intended, R2; no real sales exist) |
| product_price_history | unknown mix, EUR expected | CHECK widened (passes for EUR and USD) | price edits of EUR products keep writing EUR rows (allowed) |
| discounts | no amount discounts | CHECK widened | archive, enable, end: not checked |
| orders | 1,239, all EUR, `payment_ref` null; ship-to CZ 84, other EU 584, none 571 | `orders_currency_supported` validated (all EUR pass); new columns null | confirm, ship, refund, review reminders, fee correction, the simulator's ship step, the expiry sweep, prune and account deletion: all pass (insert-only guard; change guard only if currency or ship-to country changes, which nothing does) |
| pending orders at the cut-over | possibly a few (simulator `pending` rows) | unchanged | they can still become paid or expire; no new EUR pending order can be created |
| seller_payment_accounts | 0 | new column | n/a |
| waitlist_signups | 19 | new column null | inserts unchanged unless Home sends `country` (shape-checked) |
| demo simulator | enabled, EUR | file 4: emits nothing for its EUR products, never errors | prune, ship, signals continue; orders resume once its products are CZK |
| monitor at switch-on | | baseline captures every existing violation (about 2,500 rows); `enforced_from` set | daily alert reads zero; legacy counts fall as the simulator prunes old orders |

Operations that would start failing, and how each is avoided:

* The simulator's tick: avoided by file 4 before file 6 (and its error capture).
* The current app's EUR product creation and EUR checkouts: avoided by shipping
  the TS side (CZK, error mapping) before file 6.
* Seeds, fixtures and the dev simulate-sale route: updated by the build (7.3).
* No sweep can fail: proven per guard in section 3 and tested in 7.3.

---

## 9. Risks, rejected alternatives, open questions, unknowns

### 9.1 Risks

* **Fixture churn** is the largest cost (7.3). Without it the db and e2e suites
  go red the day file 6 is replayed.
* **Mixed currency on dashboards** until phase B (2.2), for test and demo
  accounts only.
* **`order_place` is coupled to the cart migration**: file 3 must be based on
  the 20261120 body and applied after it; re-running 20261120 afterwards would
  drop `billing_country` (caught by the body sentinel).
* **The baseline blesses whatever exists at capture.** Run the rehearsal (7.1)
  and compare its legacy list with the orchestrator's violation report before
  applying file 6. Re-running the capture is an explicit, owner-run decision.
* **Guards bind the superuser too.** Data repairs that need a non-market row
  require disabling a trigger (owner's OK); the monitor reports it.
* **`tax_country` can no longer hold a truthful non-market country.** A
  foreign seller leaves it blank and joins the waitlist (whose `country` column
  holds the truth). Intended for the beta; 1B revisits it.
* **The 45-minute pending window** (seller or market changes while the buyer is
  on Stripe) is left to the webhook by design (3d).
* **Free-text shipping destinations** are advisory only (3f).
* **Production may differ from the repo** (SQ-app and the prod-only
  `demo_sales_sim_reconcile`): every replaced object must be read live first.

### 9.2 Alternatives rejected

* **Plain CHECKs with literal market lists** (or a CHECK calling an IMMUTABLE
  list function, the `username_is_reserved` pattern): a CHECK is re-evaluated on
  every update of a row, so tightening it to CZK makes every routine update of a
  legacy EUR row fail, including the single-statement sweeps (the 5-minute
  expiry sweep would roll back entirely); a CHECK cannot read the seller's
  country or another table; and a market change would be a constraint rewrite
  rather than a mirror update. Kept only for the storable list, which every row
  satisfies.
* **A domain type**: the same re-evaluation problem, cannot reach inside
  `ship_to` jsonb, and no precedent in the codebase.
* **NOT VALID constraints**: skip old rows only until their next update, which
  is exactly when the sweeps touch them.
* **Redefining `order_place` to hold the rules**: misses the simulator and every
  direct writer, and couples the rules to a function the cart migration
  rewrites. Redefined only to carry `billing_country`.
* **Exempting the service role, `postgres` or the simulator's seller**: exempts
  the only writers of orders and shipping terms.
* **Coercing `charges_enabled` to false**: silent; refused instead (3e).
* **A jsonb guard on `shipping_policy`**: see 3f.
* **Watermark-only or seller-exclusion legacy classification**: see 6.1.
* **A database re-check at `pending -> paid`**: would strand paid money (3d).
* **A function-as-config mirror** (the `plan_limit()` pattern): diffable from
  the migration text and probe-able by a body sentinel, but the brief fixes a
  table and 1B's per-market flags fit a table better (section 10).
* **A runtime "report only" switch on the guards**: not needed. Production has
  no real buyers yet (every order has `payment_ref` null), the failure that
  matters (routine sweeps) is designed out and tested, the report-only phase
  exists anyway between files 5 and 6 (`enforced_from` null), and the rehearsal
  in a rolled-back transaction shows the exact effect before the real run.

### 9.3 Open questions for the owner

1. Until 1B lands, is `profiles.tax_country` the "business address country" of
   R1? (The design assumes yes; `market_seller_country` is the one place to
   change.)
2. The demo simulator: re-price the demo seller's products in CZK (recommended)
   or pause it?
3. The live EUR products of the IE seller and the seller without a country stay
   live (report only, no changes by design). Should the TS buyer gate hide
   listings whose seller is blocked? (The orders guard already refuses their
   sales.)
4. R4: may the buyer declare the billing country on our checkout form before
   payment (what file 3 assumes), with the card country recorded afterwards as
   evidence?
5. Should card-country evidence be visible to sellers (on `orders`) or staff-only
   (a side table)?
6. Plan calculator and admin revenue: plans in EUR, sales in CZK: convert, or
   price plans in CZK?
7. Daily monitoring cadence: enough, or every few hours?
8. Approval of each migration file, and of the order in 7.1.

### 9.4 Could not determine

* The content of `demo_sales_sim_reconcile` (prod-only) and therefore the live
  demo function bodies.
* Whether SQ-app migrations altered any object touched here (`profiles`,
  `products`, `orders` constraints or triggers).
* The currency mix in `product_price_history` (widening is safe either way).
* Which simulator orders are `unfulfilled` with no ship-to (sizes
  `r3_order_ship_to_missing`'s legacy count only).
* Whether the TS architect keeps one currency list or two (interface note 2).
* Which GitHub account receives failed scheduled-run notifications.

---

## 10. Seams for the seller onboarding workstream (1B)

Not designed here; these are the hooks left for it.

1. **One seller-country helper, one sell gate.** `market_seller_country(seller)`
   is the only reader of a seller's country of establishment (today
   `profiles.tax_country`); `market_allows('seller_country', code)` says whether
   a country may sell. `seller_sell_block(seller)` (and
   `seller_may_sell(seller)`) is the one gate: the products guard calls it when a
   listing becomes sellable, the orders guard on every order, the monitor for
   `r1_live_seller_blocked`, the simulator before emitting. 1B replaces the body
   of `market_seller_country` with its structured registered-address country and
   adds its own reasons to `seller_sell_block` (profile incomplete or unverified,
   sanctions screen not clear, Stripe not charges-enabled, ...). Guards raise
   `seller_blocked:<reason>`, so new reasons need no guard change, only an app
   message. The payment-accounts guard and the monitor also go through
   `market_seller_country`. The one object tied to `tax_country` by nature is
   guard (a), the guard of that column; when 1B moves the country, the same check
   attaches to 1B's address table.
2. **No identity, tax or address columns were added to `profiles`.** The only
   new columns are `seller_payment_accounts.country`, `orders.billing_country`,
   `orders.card_country`, `waitlist_signups.country`.
3. **Extensible monitoring.** `market_rule_violation_rows()` returns
   `(class, entity_id, detail)` and `market_rule_violations()` returns one row
   per class from the `market_rule_classes()` catalogue; adding a class (for
   example `onboarding_incomplete_listing`, `sanctions_not_clear`) is one
   catalogue row plus one union branch, same signatures. A class the rows
   produce but the catalogue lacks is reported as `unknown` and alerting. At its
   rollout 1B captures its own classes' legacy rows with
   `market_rule_baseline_capture(array['<1B classes>'])` after confirming they
   read as expected; because `r1_live_seller_blocked` keys on the block reason, a
   new 1B reason on an existing seller shows as new until 1B captures it.
4. **Per-market feature flags.** The mirror is one row of four lists. Global
   flags can become columns on that row. Per-country flags (private, non-trader
   sellers allowed; which threshold counters are active) are cleaner in a
   **second table** keyed by country code, one row per country with typed
   columns (for example `market_countries(country_code text primary key,
   private_sellers_allowed boolean not null default false, ...)`), because
   per-country values squeezed into arrays or a jsonb map on the single row are
   hard to constrain and to diff. The four lists stay where the drift test reads
   them; a CHECK or the drift test can require every flagged country to be in
   `seller_countries`.
5. **Retention.** None of the new objects has a foreign key or a cascade:
   `market_rules` references nothing; `market_rule_baseline.entity_id` is plain
   text (deleting an account or an order neither cascades into it nor is blocked
   by it; stale rows are harmless and can be purged by id); the new columns
   reference nothing. The baseline holds ids and codes only. The monitor uses
   left joins and helpers that return null for a missing profile, so it keeps
   working if 1B retains orders while anonymising or deleting profiles. Existing
   cascades (`orders.seller_id -> auth.users on delete cascade`, Replica:293, and
   the rest listed in inventory 05 section 3) are untouched and remain 1B's to
   change.
