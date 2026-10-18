-- Pricing config: plan prices and fees move into the database, every order
-- records the whole fee it was charged, and a ledger keeps what was collected.
--
-- WHY. The plan catalog (prices, the per-sale fee) lived in code
-- (src/lib/billing/plans.ts), so changing a price meant a deploy, and the
-- homepage carried a hand-kept copy. Square Share's pricing was locked on
-- 10 Oct 2026 (Free 5%, Starter EUR 12 + 2%, Pro EUR 39 + 0.5%, a separate
-- fee on sales the marketplace brings, and later an ad fee on promoted
-- sales), and from here on every one of those numbers is a row.
--
-- WHAT THIS ADDS
--   1. plans, plan_prices, plan_entitlements: what each plan costs, what it
--      charges per sale (direct and marketplace), and which features it
--      switches on. plan_prices is append-only: a change closes the open row
--      and adds a new one (plan_price_change), so a past sale's rate can
--      always be explained.
--   2. seller_fee_waivers: sellers who pay no per-sale fee at all (the closed
--      beta, founding sellers). Backfilled with every seller the store has
--      today, so nobody already selling is charged anything new.
--   3. billing_switches.fees_enabled and .entitlements_enforced: the launch
--      switches for the per-sale fee and for feature gating. Both ship OFF.
--   4. orders: the ad fee, the total application fee and whether the 30% cap
--      cut it, beside the platform fee the row already carries. order_place
--      writes them.
--   5. fee_ledger: one row per fee collected or returned. Insert-only. What
--      revenue is counted from.
--   6. billing_sales_30d: a seller's last 30 days of sales, direct and
--      marketplace apart, for the upgrade hint.
--
-- WHAT IT DELIBERATELY DOES NOT ADD
--   * No orders.origin. An order's origin is orders.channel, which already
--     says embed | button | direct | marketplace; the app maps it to the
--     pricing vocabulary in one place (src/lib/billing/origin.ts). A second
--     column saying the same thing would be a second thing to keep true.
--   * No orders.plan_id_at_checkout. That is orders.seller_plan (20260930).
--   * No fee_waiver column on seller_billing. A row there means "this account
--     has a Stripe customer", and the admin panel reads a row that is not
--     live as a test account; a waiver for a seller who never went to
--     checkout would have made every beta seller look like one.
--   * No promotions tables yet. They arrive with promoted listings.
--
-- THE FEE BASE CHANGES with the app that ships after this: the fee is charged
-- on the whole amount the buyer pays, delivery included (it was the items
-- only). orders.platform_fee_bps is from then on basis points of amount_cents.
--
-- MIRRORS, each to be edited in the same change as its twin
-- (tests/integration/36-pricing-config.test.ts compares them):
--   enum plan_id          <-> PLAN_IDS         (src/lib/pricing/enums.ts)
--   enum fee_entry_kind   <-> FEE_ENTRY_KINDS  (src/lib/pricing/enums.ts)
--   enum feature_key      <-> FEATURE_KEYS     (src/lib/pricing/enums.ts)
--   the plan_prices seed  <-> PLAN_PRICE_SEED  (src/lib/billing/pricing-seed.ts)
--   the entitlement seed  <-> ENTITLEMENT_SEED (src/lib/billing/pricing-seed.ts)
--
-- DEPLOY ORDER: this migration FIRST, then the app. Everything here is
-- additive and the released app keeps working: order_place still accepts an
-- order without the new keys. The new app reads plan_prices on every checkout
-- and refuses the sale when it cannot, so it must not ship before this has run.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Vocabulary ------------------------------------------------------------------
-- Real enum types: a value outside the list cannot be stored at all.

do $$
begin
  create type public.plan_id as enum ('free', 'starter', 'pro');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.fee_entry_kind as enum ('platform_fee', 'ad_fee', 'platform_fee_refund', 'ad_fee_refund');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.feature_key as enum (
    'freeform_editor', 'custom_fonts', 'remove_badge', 'discount_codes',
    'multiple_storefronts', 'analytics', 'priority_support');
exception when duplicate_object then null;
end
$$;

-- ---- 2. Plans -----------------------------------------------------------------------

create table if not exists public.plans (
  id         public.plan_id primary key,
  name       text not null,
  -- Cheapest first: the order the plans are shown in.
  sort_order smallint not null unique,

  constraint plans_name_length check (char_length(name) between 1 and 40)
);

comment on table public.plans is
  'The seller plans. Three rows. What each costs is plan_prices; what each switches on is plan_entitlements. Read by any signed-in user, written by the service role only.';

insert into public.plans (id, name, sort_order) values
  ('free', 'Free', 1),
  ('starter', 'Starter', 2),
  ('pro', 'Pro', 3)
on conflict (id) do nothing;

-- ---- 3. Plan prices -----------------------------------------------------------------
-- What a plan costs per billing interval and what it charges per sale, for a
-- stretch of time. ONE OPEN ROW per plan and interval (the partial unique
-- index); the row in force at a moment is the one whose window holds it.
--
-- Yearly billing is in the schema and not on sale: it starts the day a yearly
-- row exists for every paid plan.
--
-- stripe_lookup_key, not a price id: a lookup key is the same in Stripe's test
-- and live modes, where the price id differs, so one row serves both.

create table if not exists public.plan_prices (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             public.plan_id not null references public.plans (id),
  version             integer not null,
  billing_interval    text not null default 'month',
  -- Per interval, in cents, excluding VAT.
  price_cents         integer not null,
  -- The REGULAR price when price_cents is a launch price below it. It must be
  -- a price that will really be charged once the launch ends: a struck-through
  -- price nobody will ever pay is misleading advertising.
  list_price_cents    integer,
  currency            text not null default 'EUR',
  direct_fee_bps      integer not null,
  marketplace_fee_bps integer not null,
  stripe_lookup_key   text,
  effective_from      timestamptz not null default now(),
  effective_to        timestamptz,
  created_at          timestamptz not null default now(),

  constraint plan_prices_version_unique unique (plan_id, billing_interval, version),
  constraint plan_prices_version_range check (version >= 1),
  -- MIRROR of BILLING_INTERVALS (src/lib/pricing/enums.ts), as on seller_billing.
  constraint plan_prices_interval_check check (billing_interval in ('month', 'year')),
  constraint plan_prices_list_price_above check (list_price_cents is null or list_price_cents > price_cents),
  constraint plan_prices_currency_shape check (currency ~ '^[A-Z]{3}$'),
  -- 10 000 bps is the whole sale.
  constraint plan_prices_direct_fee_range check (direct_fee_bps between 0 and 10000),
  constraint plan_prices_marketplace_fee_range check (marketplace_fee_bps between 0 and 10000),
  -- `<plan>_<interval>_<currency>_v<N>`: the shape planForLookupKey reads.
  constraint plan_prices_lookup_key_shape
    check (stripe_lookup_key is null or stripe_lookup_key ~ '^[a-z]+_[a-z]+_[a-z]{3}_v[0-9]+$'),
  -- Free costs nothing and is billed through nothing; a paid plan has a price
  -- and a Stripe Price to bill it through.
  constraint plan_prices_free_or_billable check (
    case when plan_id = 'free'
      then price_cents = 0 and stripe_lookup_key is null and billing_interval = 'month'
      else price_cents > 0 and stripe_lookup_key is not null
    end),
  constraint plan_prices_window check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists plan_prices_one_open_idx
  on public.plan_prices (plan_id, billing_interval)
  where effective_to is null;

comment on table public.plan_prices is
  'What each plan costs and charges per sale, over time. One open row (effective_to null) per plan and interval; a change closes it and adds a row (plan_price_change), and no row is ever edited. Mirrored for fixtures by PLAN_PRICE_SEED in src/lib/billing/pricing-seed.ts.';
comment on column public.plan_prices.direct_fee_bps is
  'Our cut of a sale through the seller''s own doors (embed, buy button, hosted pages), in basis points of the whole amount paid. 500 = 5%.';
comment on column public.plan_prices.marketplace_fee_bps is
  'Our cut of a sale the marketplace brought, in basis points of the whole amount paid. Charged instead of direct_fee_bps, never on top.';
comment on column public.plan_prices.stripe_lookup_key is
  'The lookup key of the Stripe Price this row is billed through. Null for Free. The app refuses a checkout whose Stripe Price does not charge price_cents.';

-- A PRICE THAT WAS CHARGED IS HISTORY. The only edit a row allows is closing
-- it, once; the only row that may be deleted is one that never came into
-- force (a scheduled change that was called off).
create or replace function public.plan_prices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.effective_from <= now() then
      raise exception 'plan_prices: a row that has been in force is never deleted' using errcode = '23514';
    end if;
    return old;
  end if;

  if old.effective_to is not null
     or new.effective_to is null
     or (to_jsonb(new) - 'effective_to') is distinct from (to_jsonb(old) - 'effective_to') then
    raise exception 'plan_prices: rows are never edited, add one with plan_price_change' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.plan_prices_guard() from public, anon, authenticated;

drop trigger if exists plan_prices_guard on public.plan_prices;
create trigger plan_prices_guard
  before update or delete on public.plan_prices
  for each row execute function public.plan_prices_guard();

-- THE ONE WAY TO CHANGE A PRICE OR A FEE. Closes the open row at
-- p_effective_from and opens the next version from that moment, in one
-- transaction, so there is never a gap and never two rows in force.
--
-- A change of fee alone keeps the Stripe lookup key (the subscription price
-- did not move, so the same Stripe Price still bills it). A change of price
-- needs a new Stripe Price, created FIRST with the key this function returns:
-- `<plan>_<interval>_eur_v<version>`. Existing subscribers keep paying the
-- price they signed up at; the per-sale fee follows the row in force.
create or replace function public.plan_price_change(
  p_plan                public.plan_id,
  p_price_cents         integer,
  p_direct_fee_bps      integer,
  p_marketplace_fee_bps integer,
  p_billing_interval    text default 'month',
  p_list_price_cents    integer default null,
  p_effective_from      timestamptz default now()
)
returns public.plan_prices
language plpgsql
set search_path = ''
as $$
declare
  open_row public.plan_prices%rowtype;
  next_version integer;
  lookup_key text;
  created public.plan_prices%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan_price:' || p_plan::text || ':' || p_billing_interval, 0));

  select * into open_row
    from public.plan_prices
   where plan_id = p_plan
     and billing_interval = p_billing_interval
     and effective_to is null
     for update;

  if found then
    if p_effective_from <= open_row.effective_from then
      raise exception 'plan_price_change: the new row must start after the open one (%)', open_row.effective_from
        using errcode = '22023';
    end if;
    update public.plan_prices set effective_to = p_effective_from where id = open_row.id;
  end if;

  select coalesce(max(version), 0) + 1 into next_version
    from public.plan_prices
   where plan_id = p_plan
     and billing_interval = p_billing_interval;

  lookup_key := case
    when p_plan = 'free' then null
    when open_row.id is not null and open_row.price_cents = p_price_cents then open_row.stripe_lookup_key
    else p_plan::text || '_' || p_billing_interval || '_eur_v' || next_version
  end;

  insert into public.plan_prices (
    plan_id, version, billing_interval, price_cents, list_price_cents, currency,
    direct_fee_bps, marketplace_fee_bps, stripe_lookup_key, effective_from
  ) values (
    p_plan, next_version, p_billing_interval, p_price_cents, p_list_price_cents, 'EUR',
    p_direct_fee_bps, p_marketplace_fee_bps, lookup_key, p_effective_from
  )
  returning * into created;

  return created;
end
$$;

revoke execute on function public.plan_price_change(
  public.plan_id, integer, integer, integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.plan_price_change(
  public.plan_id, integer, integer, integer, text, integer, timestamptz) to service_role;

comment on function public.plan_price_change(
  public.plan_id, integer, integer, integer, text, integer, timestamptz) is
  'Change a plan''s price or fees: closes the open plan_prices row and opens the next version, atomically. A new price needs its Stripe Price created first, under the lookup key this returns. Service role only.';

-- THE SEED: option A, locked on 10 Oct 2026. The marketplace fees (8%, 7%,
-- 6%) are defaults not yet confirmed. MIRROR of PLAN_PRICE_SEED.
insert into public.plan_prices (
  plan_id, version, billing_interval, price_cents, currency,
  direct_fee_bps, marketplace_fee_bps, stripe_lookup_key, effective_from
) values
  ('free',    1, 'month',    0, 'EUR', 500, 800, null,                   '2026-10-10T00:00:00+00:00'),
  ('starter', 1, 'month', 1200, 'EUR', 200, 700, 'starter_month_eur_v1', '2026-10-10T00:00:00+00:00'),
  ('pro',     1, 'month', 3900, 'EUR',  50, 600, 'pro_month_eur_v1',     '2026-10-10T00:00:00+00:00')
on conflict (plan_id, billing_interval, version) do nothing;

-- ---- 4. Plan entitlements -------------------------------------------------------------
-- A row means the plan HAS the feature. limit_int is for a feature that is a
-- number rather than a yes (null = no number attached).
--
-- NOTHING IS GATED BY THIS YET: billing_switches.entitlements_enforced ships
-- off, and with it off every plan has every feature, as today.

create table if not exists public.plan_entitlements (
  plan_id   public.plan_id not null references public.plans (id),
  feature   public.feature_key not null,
  limit_int integer,

  primary key (plan_id, feature),
  constraint plan_entitlements_limit_range check (limit_int is null or limit_int >= 0)
);

comment on table public.plan_entitlements is
  'Which features each plan switches on (a row = the plan has it). Read by hasFeature() in src/lib/billing/entitlements.ts, and only enforced while billing_switches.entitlements_enforced is on. Mirrored for fixtures by ENTITLEMENT_SEED.';

-- The suggested split; Adrian can move items. MIRROR of ENTITLEMENT_SEED.
insert into public.plan_entitlements (plan_id, feature) values
  ('starter', 'freeform_editor'),
  ('starter', 'custom_fonts'),
  ('starter', 'remove_badge'),
  ('starter', 'discount_codes'),
  ('pro', 'freeform_editor'),
  ('pro', 'custom_fonts'),
  ('pro', 'remove_badge'),
  ('pro', 'discount_codes'),
  ('pro', 'multiple_storefronts'),
  ('pro', 'analytics'),
  ('pro', 'priority_support')
on conflict (plan_id, feature) do nothing;

-- The three config tables: any signed-in user reads them (the same numbers
-- are on the plans page), nobody but the service role writes them. A new
-- table is auto-granted to the API roles here, so every grant is set both ways.
alter table public.plans enable row level security;
alter table public.plan_prices enable row level security;
alter table public.plan_entitlements enable row level security;

revoke all on table public.plans, public.plan_prices, public.plan_entitlements from public, anon, authenticated;
grant select on table public.plans, public.plan_prices, public.plan_entitlements to authenticated;
grant all on table public.plans, public.plan_prices, public.plan_entitlements to service_role;

drop policy if exists plans_select_signed_in on public.plans;
create policy plans_select_signed_in on public.plans
  for select to authenticated using (true);

drop policy if exists plan_prices_select_signed_in on public.plan_prices;
create policy plan_prices_select_signed_in on public.plan_prices
  for select to authenticated using (true);

drop policy if exists plan_entitlements_select_signed_in on public.plan_entitlements;
create policy plan_entitlements_select_signed_in on public.plan_entitlements
  for select to authenticated using (true);

-- ---- 5. Fee waivers -----------------------------------------------------------------
-- A seller with a row here pays no per-sale fee, whatever their plan and
-- wherever the sale came from. Service role only: a seller who could write
-- this could waive their own fees.

create table if not exists public.seller_fee_waivers (
  owner_id   uuid primary key references public.profiles (id) on delete cascade,
  reason     text not null default 'closed_beta',
  granted_at timestamptz not null default now(),

  constraint seller_fee_waivers_reason_check check (reason in ('closed_beta', 'founding_seller'))
);

comment on table public.seller_fee_waivers is
  'Sellers who pay no per-sale fee (closed beta, founding sellers). A row is the waiver; deleting it ends it. Read by the checkout when it prices a sale (src/lib/billing/sale-fee.ts). Service role only: no client policy exists.';

alter table public.seller_fee_waivers enable row level security;
revoke all on table public.seller_fee_waivers from public, anon, authenticated;
grant all on table public.seller_fee_waivers to service_role;

-- EVERY SELLER THERE IS TODAY keeps paying nothing: the closed beta charged no
-- fee, and switching fees on must not change that for the people already in it.
insert into public.seller_fee_waivers (owner_id, reason)
select sellers.owner_id, 'closed_beta'
  from (
    select owner_id from public.storefronts
    union
    select owner_id from public.products
  ) sellers
on conflict (owner_id) do nothing;

-- ---- 6. Launch switches ---------------------------------------------------------------

alter table public.billing_switches
  add column if not exists fees_enabled boolean not null default false,
  add column if not exists entitlements_enforced boolean not null default false;

comment on table public.billing_switches is
  'Launch switches for the money layer, one row. plan_limits_enforced: plan limits refuse creates. fees_enabled: a sale is charged its per-sale fee (off = every sale pays nothing, as in the closed beta). entitlements_enforced: plan_entitlements gates features (off = every plan has every feature). All ship off. Service role only.';

-- ---- 7. Orders: the whole fee as it was charged ----------------------------------------

alter table public.orders
  add column if not exists ad_rate_bps smallint,
  add column if not exists ad_fee_cents integer not null default 0,
  add column if not exists application_fee_cents integer,
  add column if not exists fee_capped boolean not null default false;

-- Dropped first so the whole file can be run again.
alter table public.orders
  drop constraint if exists orders_ad_rate_bps_range,
  drop constraint if exists orders_ad_fee_cents_range,
  drop constraint if exists orders_application_fee_range,
  drop constraint if exists orders_application_fee_parts;

alter table public.orders
  add constraint orders_ad_rate_bps_range
    check (ad_rate_bps is null or ad_rate_bps between 1 and 10000),
  add constraint orders_ad_fee_cents_range
    check (ad_fee_cents >= 0),
  add constraint orders_application_fee_range
    check (application_fee_cents is null or (application_fee_cents >= 0 and application_fee_cents <= amount_cents)),
  -- The two parts are the whole: nothing is charged that no column explains.
  add constraint orders_application_fee_parts
    check (application_fee_cents is null or application_fee_cents = platform_fee_cents + ad_fee_cents);

comment on column public.orders.platform_fee_bps is
  'The platform fee rate this order was charged, in basis points (500 = 5%): of the whole amount paid from 20261011 on, of the item subtotal before. Snapshotted at checkout from the plan price row in force. Null on orders written before plans existed.';
comment on column public.orders.ad_rate_bps is
  'The promotion''s ad rate this order was charged, in basis points of the amount paid. Null when no promotion drove the sale.';
comment on column public.orders.ad_fee_cents is
  'The ad fee charged on a promoted marketplace sale, in cents. 0 for every other sale.';
comment on column public.orders.application_fee_cents is
  'Everything Square Share took from this sale: platform_fee_cents + ad_fee_cents, after the 30% cap. What Stripe was asked for as application_fee_amount, corrected to what Stripe actually collected once the payment is confirmed. Null on orders written before 20261011.';
comment on column public.orders.fee_capped is
  'The 30% cap cut this order''s fee down. Rare by design, and logged when it happens.';

-- The one order writer (20261008_order_lifecycle), restated with the four new
-- columns. Nothing else in it changed. A key the JSON leaves out is NULL in
-- the record, so the released app's orders (which do not send these) get the
-- defaults.
create or replace function public.order_place(p_order jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  incoming public.orders%rowtype;
  new_id uuid;
  wanted integer;
  left_after integer;
  threshold integer;
begin
  incoming := jsonb_populate_record(null::public.orders, p_order);

  if incoming.checkout_session_id is null then
    raise exception 'order_place: checkout_session_id is required' using errcode = '22023';
  end if;
  if incoming.status is null or incoming.status not in ('paid', 'pending') then
    raise exception 'order_place: status must be paid or pending' using errcode = '22023';
  end if;
  wanted := coalesce(incoming.quantity, 1);

  insert into public.orders (
    seller_id, product_id, storefront_id, channel, status,
    amount_cents, platform_fee_cents, platform_fee_bps, seller_plan, shipping_cents, currency,
    ad_rate_bps, ad_fee_cents, application_fee_cents, fee_capped,
    buyer_email, buyer_locale, product_title, product_price_cents,
    discount_cents, discount_id, discount_code_id, discount_code,
    selected_options, quantity, ship_to, fulfilment_status,
    checkout_session_id, gift_message, supply_consent_at, digital_file_key,
    payment_ref, pending_expires_at
  ) values (
    incoming.seller_id, incoming.product_id, incoming.storefront_id, incoming.channel, incoming.status,
    incoming.amount_cents, coalesce(incoming.platform_fee_cents, 0), incoming.platform_fee_bps,
    incoming.seller_plan, incoming.shipping_cents, coalesce(incoming.currency, 'EUR'),
    incoming.ad_rate_bps, coalesce(incoming.ad_fee_cents, 0), incoming.application_fee_cents,
    coalesce(incoming.fee_capped, false),
    incoming.buyer_email, incoming.buyer_locale, incoming.product_title, incoming.product_price_cents,
    coalesce(incoming.discount_cents, 0), incoming.discount_id, incoming.discount_code_id, incoming.discount_code,
    coalesce(incoming.selected_options, '[]'::jsonb), wanted, incoming.ship_to,
    coalesce(incoming.fulfilment_status, 'unfulfilled'),
    incoming.checkout_session_id, incoming.gift_message, incoming.supply_consent_at, incoming.digital_file_key,
    incoming.payment_ref,
    case when incoming.status = 'pending' then incoming.pending_expires_at end
  )
  on conflict (checkout_session_id) do nothing
  returning id into new_id;

  if new_id is null then
    select o.id into new_id
      from public.orders o
     where o.checkout_session_id = incoming.checkout_session_id;
    return jsonb_build_object('order_id', new_id, 'duplicate', true);
  end if;

  update public.products p
     set stock_quantity = p.stock_quantity - wanted,
         updated_at = now()
   where p.id = incoming.product_id
     and p.track_stock
     and p.stock_quantity >= wanted
  returning p.stock_quantity, p.low_stock_threshold into left_after, threshold;

  if found then
    update public.orders set stock_reserved = wanted where id = new_id;
  elsif exists (
    select 1 from public.products p where p.id = incoming.product_id and p.track_stock
  ) then
    -- Rolls the insert above back with it.
    raise exception 'insufficient_stock' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'order_id', new_id,
    'duplicate', false,
    'stock_left', left_after,
    'low_stock', coalesce(left_after <= threshold, false)
  );
end
$$;

revoke execute on function public.order_place(jsonb) from public, anon, authenticated;
grant execute on function public.order_place(jsonb) to service_role;

-- ---- 8. The fee ledger ----------------------------------------------------------------
-- One row per fee collected (positive) or returned (negative). What revenue
-- is counted from: an order's fee columns say what it was charged, this says
-- what happened to the money, refund by refund.
--
-- INSERT-ONLY. No role the app uses may update or delete a row (see the
-- grants): a correction is another row. The two references go null rather
-- than taking the row with them when an order or an account is deleted,
-- because what Square Share collected is its own accounting record and
-- outlives both; what is left then names nobody.
--
-- entry_key is what makes every write idempotent: a payment event delivered
-- twice writes its rows once.
--   <order id>:platform_fee            the fee an order was charged
--   <order id>:ad_fee
--   <refund id>:platform_fee_refund    one application fee refund
--   <refund id>:ad_fee_refund

create table if not exists public.fee_ledger (
  id                        uuid primary key default gen_random_uuid(),
  order_id                  uuid references public.orders (id) on delete set null,
  seller_id                 uuid references public.profiles (id) on delete set null,
  kind                      public.fee_entry_kind not null,
  -- Signed: a fee is positive, a refund of one is negative.
  amount_cents              integer not null,
  currency                  text not null,
  -- Stripe's application fee object (fee_...). Null for a sale no provider
  -- charged (the development test provider).
  stripe_application_fee_id text,
  entry_key                 text not null unique,
  livemode                  boolean not null default false,
  created_at                timestamptz not null default now(),

  constraint fee_ledger_amount_sign check (
    (kind in ('platform_fee', 'ad_fee') and amount_cents > 0)
    or (kind in ('platform_fee_refund', 'ad_fee_refund') and amount_cents < 0)),
  constraint fee_ledger_currency_shape check (currency ~ '^[A-Z]{3}$'),
  constraint fee_ledger_fee_id_shape
    check (stripe_application_fee_id is null or stripe_application_fee_id ~ '^fee_[A-Za-z0-9_]{1,250}$'),
  constraint fee_ledger_entry_key_shape check (entry_key ~ '^[A-Za-z0-9_:-]{1,255}$')
);

create index if not exists fee_ledger_seller_time_idx on public.fee_ledger (seller_id, created_at);
create index if not exists fee_ledger_order_idx on public.fee_ledger (order_id);

comment on table public.fee_ledger is
  'Every fee Square Share collected (positive) or returned (negative), one row each. Insert-only; revenue is counted from here. A store''s team reads its own rows; only the service role writes, through fee_ledger_record.';
comment on column public.fee_ledger.livemode is
  'True for a row written from a Stripe live-mode payment. False for test mode and for sales no provider charged: neither is revenue.';

alter table public.fee_ledger enable row level security;
revoke all on table public.fee_ledger from public, anon, authenticated, service_role;
grant select on table public.fee_ledger to authenticated;
-- No UPDATE, DELETE or TRUNCATE, for the service role either.
grant select, insert on table public.fee_ledger to service_role;

-- The same people who read the store's orders read what those orders paid.
drop policy if exists fee_ledger_select_member on public.fee_ledger;
create policy fee_ledger_select_member on public.fee_ledger
  for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

drop policy if exists "Require two-factor when enrolled" on public.fee_ledger;
create policy "Require two-factor when enrolled" on public.fee_ledger
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

-- THE ONE WRITE. The seller and the currency come from the ORDER, never from
-- the caller, so a row can only ever be filed under the store that made the
-- sale. True when the row was written, false when its entry_key already was.
create or replace function public.fee_ledger_record(
  p_order_id                  uuid,
  p_kind                      public.fee_entry_kind,
  p_amount_cents              integer,
  p_entry_key                 text,
  p_stripe_application_fee_id text default null,
  p_livemode                  boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  target record;
  written integer;
begin
  select o.id, o.seller_id, o.currency into target
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'fee_ledger_record: no such order' using errcode = '23503';
  end if;

  insert into public.fee_ledger (
    order_id, seller_id, kind, amount_cents, currency,
    stripe_application_fee_id, entry_key, livemode
  ) values (
    target.id, target.seller_id, p_kind, p_amount_cents, target.currency,
    p_stripe_application_fee_id, p_entry_key, coalesce(p_livemode, false)
  )
  on conflict (entry_key) do nothing;

  get diagnostics written = row_count;
  return written > 0;
end
$$;

revoke execute on function public.fee_ledger_record(
  uuid, public.fee_entry_kind, integer, text, text, boolean) from public, anon, authenticated;
grant execute on function public.fee_ledger_record(
  uuid, public.fee_entry_kind, integer, text, text, boolean) to service_role;

comment on function public.fee_ledger_record(
  uuid, public.fee_entry_kind, integer, text, text, boolean) is
  'Write one fee ledger row for an order, idempotent on p_entry_key. The seller and currency are read from the order. Returns whether a row was written. Service role only.';

-- What a store paid in fees over a period, per currency. INVOKER, so the
-- ledger's own policies decide what the caller may add up: a store's team
-- gets its store's figures and nobody else's.
create or replace function public.fee_ledger_summary(
  p_seller_id uuid,
  p_from      timestamptz,
  p_to        timestamptz
)
returns table (currency text, charged_cents bigint, refunded_cents bigint, net_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.currency,
    coalesce(sum(l.amount_cents) filter (where l.amount_cents > 0), 0)::bigint,
    coalesce(-sum(l.amount_cents) filter (where l.amount_cents < 0), 0)::bigint,
    coalesce(sum(l.amount_cents), 0)::bigint
  from public.fee_ledger l
  where l.seller_id = p_seller_id
    and l.created_at >= p_from
    and l.created_at < p_to
  group by l.currency
$$;

revoke execute on function public.fee_ledger_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fee_ledger_summary(uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on function public.fee_ledger_summary(uuid, timestamptz, timestamptz) is
  'Fees a store was charged, had returned, and the net, per currency, for [p_from, p_to). Invoker: limited to rows the caller may read.';

-- ---- 9. Sales for the upgrade hint ---------------------------------------------------
-- The last 30 days of an account's paid EUR sales, as the fee sees them: the
-- whole amount paid, delivery included, with the marketplace's sales apart
-- (they pay a different fee, and a plan cannot make them cheaper to compare).
--
-- Supersedes billing_sales_summary (20260930), which summed the item subtotal
-- and stays only until the app that calls it is gone. Service role only: the
-- caller has already checked that the viewer may read the store it names.
create or replace function public.billing_sales_30d(p_seller_id uuid, p_now timestamptz default now())
returns table (direct_cents bigint, marketplace_cents bigint, sales integer, fees_cents bigint)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(sum(o.amount_cents) filter (where o.channel <> 'marketplace'), 0)::bigint,
    coalesce(sum(o.amount_cents) filter (where o.channel = 'marketplace'), 0)::bigint,
    count(*)::integer,
    coalesce(sum(coalesce(o.application_fee_cents, o.platform_fee_cents)), 0)::bigint
  from public.orders o
  where o.seller_id = p_seller_id
    and o.status = 'paid'
    and o.currency = 'EUR'
    and o.created_at >= p_now - interval '30 days'
    and o.created_at <= p_now
$$;

revoke execute on function public.billing_sales_30d(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_sales_30d(uuid, timestamptz) to service_role;

comment on function public.billing_sales_30d(uuid, timestamptz) is
  'Last 30 days of an account''s paid EUR sales: the amount paid through the seller''s own doors, through the marketplace, the count and the fees. Service role only; the caller authorises the account first.';

notify pgrst, 'reload schema';
