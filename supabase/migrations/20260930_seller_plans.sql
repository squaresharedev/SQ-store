-- Seller plans: Free, Starter and Pro, billed through Stripe.
--
-- WHY. Square Share moves from one flat per-sale fee to a subscription with a
-- smaller fee. Every account is on Free until it pays for a plan, and falls
-- back to Free when a paid plan ends. Paid plans lower the per-sale fee and
-- lift the limits on how many storefronts and teammates an account can add.
-- The catalog (prices, fees, limits) is src/lib/billing/plans.ts; this file
-- stores who is on what, and enforces the limits a second time.
--
-- WHAT THIS ADDS
--   1. orders: the fee's rate and plan, and the delivery share, snapshotted on
--      every order, so a later price change can never rewrite what a past sale
--      was charged, and "Platform fee (3%)" can be shown exactly.
--   2. seller_billing: one row per account that has ever started paying. The
--      row's `paid_until` is THE answer to "which plan is this account on"
--      (see src/lib/billing/entitlement.ts): the paid plan until then, Free
--      after. Written only by the service role, from Stripe's webhook.
--   3. stripe_events: the webhook's idempotency ledger.
--   4. seller_funnel_events: what happens around the pricing modal (viewed,
--      limit hit, checkout started, upgraded ...), so we can tell which entry
--      points convert. Server-produced; nothing a browser can write.
--   5. plan_limit() and the triggers that enforce it on storefronts and
--      team_members. The app checks first and explains; these make the limit
--      true for a direct REST insert too. Both obey one switch,
--      billing_switches.plan_limits_enforced, which ships OFF: a limit must
--      not bite before a bigger plan can be bought.
--   6. billing_sales_summary(): the last 30 days of item sales, for the
--      pricing modal's "which plan is cheapest for me" calculator.
--   7. The 'billing.manage' permission (owners only) and the 'billing'
--      notification type.
--
-- WRITES. seller_billing, stripe_events and seller_funnel_events have RLS on
-- and NO policies: no client role can read or write them at all. Everything
-- goes through the service role in src/lib/billing (the webhook, the billing
-- actions), which is what makes "an owner edits their own plan over REST"
-- impossible rather than merely refused. Team members read their store's plan
-- through the server (getAccountPlan), never through these tables.
--
-- MIRRORS, each to be edited in the same change as its twin:
--   plan_limit()            <-> PLANS[..].limits in src/lib/billing/plans.ts
--                               (tests/integration/29-seller-plans.test.ts
--                               compares the two)
--   seller_funnel_events    <-> FUNNEL_EVENT_KINDS in src/lib/billing/funnel.ts
--     kind / source CHECKs      and PRICING_SOURCES in src/lib/billing/paths.ts
--   team_role_can()         <-> src/lib/team/permissions.ts
--   notifications_type_check <-> NOTIFICATION_TYPES in lib/notifications/types.ts
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Orders: the fee as it was charged ---------------------------------------

alter table public.orders
  add column if not exists platform_fee_bps smallint,
  add column if not exists seller_plan text,
  add column if not exists shipping_cents integer;

alter table public.orders
  -- 10 000 bps is the whole sale; a fee can never be more than that.
  add constraint orders_platform_fee_bps_range
    check (platform_fee_bps is null or platform_fee_bps between 0 and 10000),
  add constraint orders_seller_plan_check
    check (seller_plan is null or seller_plan in ('free', 'starter', 'pro')),
  add constraint orders_shipping_cents_range
    check (shipping_cents is null or (shipping_cents >= 0 and shipping_cents <= amount_cents));

comment on column public.orders.platform_fee_bps is
  'The platform fee rate this order was charged, in basis points of the item subtotal (500 = 5%). Snapshotted at sale time from the seller''s plan. Null on orders written before plans existed.';
comment on column public.orders.seller_plan is
  'The seller''s plan (free | starter | pro) at the moment of sale, which set platform_fee_bps. Null on orders written before plans existed.';
comment on column public.orders.shipping_cents is
  'Delivery''s share of amount_cents, in cents. The platform fee is charged on amount_cents minus this. Null when unknown (older orders, and sales that did not report it).';

-- ---- 2. seller_billing -------------------------------------------------------------

create table if not exists public.seller_billing (
  owner_id               uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id     text not null unique,
  stripe_subscription_id text unique,
  plan                   text,
  billing_interval       text,
  status                 text not null default 'none',
  price_cents            integer,
  currency               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  paid_until             timestamptz,
  livemode               boolean not null default false,
  stripe_synced_at       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint seller_billing_customer_shape
    check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]{1,250}$'),
  constraint seller_billing_subscription_shape
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9_]{1,250}$'),
  -- Free is the ABSENCE of a paid plan, never a stored value.
  constraint seller_billing_plan_check
    check (plan is null or plan in ('starter', 'pro')),
  constraint seller_billing_interval_check
    check (billing_interval is null or billing_interval in ('month', 'year')),
  -- Stripe's subscription statuses, plus 'none' for a customer with no
  -- subscription yet (the row exists from the first checkout attempt).
  constraint seller_billing_status_check
    check (status in ('none', 'incomplete', 'incomplete_expired', 'trialing', 'active',
                      'past_due', 'canceled', 'unpaid', 'paused')),
  constraint seller_billing_price_range
    check (price_cents is null or price_cents >= 0),
  constraint seller_billing_currency_shape
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- A paid-until date only means something with a plan to be paid for.
  constraint seller_billing_paid_until_needs_plan
    check (paid_until is null or plan is not null)
);

comment on table public.seller_billing is
  'Which paid plan an account is on, mirrored from Stripe Billing by the webhook (src/app/api/billing/webhook). No row, or paid_until in the past, means Free. Service role only: no client policy exists.';
comment on column public.seller_billing.paid_until is
  'When the paid plan stops applying (period end plus renewal slack, or past-due grace). THE entitlement: every reader compares this with the clock and never asks Stripe.';
comment on column public.seller_billing.price_cents is
  'What this account actually pays per interval, excluding VAT. Shown instead of the catalog price, so a grandfathered seller sees their own price.';
comment on column public.seller_billing.stripe_synced_at is
  'When the snapshot this row holds was fetched from Stripe. billing_apply_snapshot only ever moves it forward, so an older fetch that lands late cannot overwrite a newer one.';

alter table public.seller_billing enable row level security;
revoke all on table public.seller_billing from anon, authenticated;
grant all on table public.seller_billing to service_role;

-- ---- 3. stripe_events ------------------------------------------------------------

create table if not exists public.stripe_events (
  id              text primary key,
  type            text not null,
  livemode        boolean not null,
  received_at     timestamptz not null default now(),
  -- Set once the event's effect on seller_billing is applied. An event with
  -- none is retried by Stripe (the webhook answers 500 until it succeeds).
  processed_at    timestamptz,
  -- Claimed before a notification or email goes out, so a redelivered event
  -- never tells the seller the same thing twice.
  side_effects_at timestamptz,

  constraint stripe_events_id_shape check (id ~ '^evt_[A-Za-z0-9_]{1,250}$'),
  constraint stripe_events_type_length check (char_length(type) between 1 and 100)
);

comment on table public.stripe_events is
  'Stripe webhook events seen by src/app/api/billing/webhook, for idempotency. Service role only.';

alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;
grant all on table public.stripe_events to service_role;

-- ---- 4. seller_funnel_events ------------------------------------------------------

create table if not exists public.seller_funnel_events (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.profiles (id) on delete cascade,
  -- Who did it: the owner, or a teammate looking at the owner's store. Null
  -- for events Stripe produced (an upgrade confirmed by the webhook).
  actor_id    uuid references public.profiles (id) on delete set null,
  kind        text not null,
  source      text,
  plan        text,
  billing_interval text,
  created_at  timestamptz not null default now(),

  -- MIRROR of FUNNEL_EVENT_KINDS in src/lib/billing/funnel.ts.
  constraint seller_funnel_events_kind_check
    check (kind in ('pricing_viewed', 'limit_hit', 'checkout_started', 'portal_opened',
                    'upgraded', 'plan_changed', 'downgraded', 'payment_failed')),
  -- MIRROR of PRICING_SOURCES in src/lib/billing/paths.ts.
  constraint seller_funnel_events_source_check
    check (source is null or source in ('sidebar', 'profile_menu', 'settings', 'storefront_limit',
                                        'team_limit', 'order_nudge', 'analytics_nudge', 'email',
                                        'notification', 'checkout_cancel')),
  constraint seller_funnel_events_plan_check
    check (plan is null or plan in ('free', 'starter', 'pro')),
  constraint seller_funnel_events_interval_check
    check (billing_interval is null or billing_interval in ('month', 'year'))
);

create index if not exists seller_funnel_events_kind_time_idx
  on public.seller_funnel_events (kind, created_at);

comment on table public.seller_funnel_events is
  'What happens around the pricing modal, per account, for conversion analysis. Written by the server only (src/lib/billing/funnel.ts). Kept 13 months.';

alter table public.seller_funnel_events enable row level security;
revoke all on table public.seller_funnel_events from anon, authenticated;
grant all on table public.seller_funnel_events to service_role;

-- ---- 5. Plan limits ----------------------------------------------------------------

-- THE SWITCH. Limits are only enforced once a bigger plan can actually be
-- bought: a limit whose only way out is an "upgrade" button marked Soon is a
-- dead end, not an upsell. One row, one flag, read by BOTH the app's check
-- (src/lib/billing/limits.ts) and the trigger below, so the two can never
-- disagree. It ships OFF. Turn it on the day Stripe Billing is live:
--   update public.billing_switches set plan_limits_enforced = true;
create table if not exists public.billing_switches (
  -- A single-row table: the primary key can only ever be true.
  id                   boolean primary key default true check (id),
  plan_limits_enforced boolean not null default false,
  updated_at           timestamptz not null default now()
);

insert into public.billing_switches (id) values (true) on conflict (id) do nothing;

comment on table public.billing_switches is
  'Launch switches for seller plans. plan_limits_enforced: whether plan limits refuse creates (off until paid plans can be bought). Service role only.';

alter table public.billing_switches enable row level security;
revoke all on table public.billing_switches from anon, authenticated;
grant all on table public.billing_switches to service_role;

-- MIRROR of PLANS[..].limits in src/lib/billing/plans.ts. Null = unlimited.
-- Pure data, so any role may read it: the same numbers are on the pricing page.
create or replace function public.plan_limit(p_plan text, p_key text)
returns integer
language sql immutable
set search_path = ''
as $$
  select case p_plan
    when 'free'    then case p_key when 'storefronts' then 3  when 'teamSeats' then 2 end
    when 'starter' then case p_key when 'storefronts' then 10 when 'teamSeats' then 5 end
    when 'pro'     then null
  end
$$;

revoke execute on function public.plan_limit(text, text) from public, anon;
grant execute on function public.plan_limit(text, text) to authenticated, service_role;

comment on function public.plan_limit(text, text) is
  'The cap a plan puts on storefronts or teamSeats; null = unlimited. Mirror of src/lib/billing/plans.ts.';

-- The plan in force for an account right now: its paid plan until paid_until,
-- Free otherwise. The SQL twin of effectivePlan() in
-- src/lib/billing/entitlement.ts. SECURITY DEFINER because seller_billing has
-- no client policy; callable by the service role only (the limit triggers
-- below run as their owner, so they reach it without a grant).
create or replace function public.account_plan(p_owner uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select b.plan
       from public.seller_billing b
      where b.owner_id = p_owner
        and b.plan is not null
        and b.paid_until > now()),
    'free')
$$;

revoke execute on function public.account_plan(uuid) from public, anon, authenticated;
grant execute on function public.account_plan(uuid) to service_role;

comment on function public.account_plan(uuid) is
  'free | starter | pro: the plan an account is on now (paid plan until paid_until, else free). Service role only.';

-- THE LIMIT, enforced on insert (and when a row moves into an account, or a
-- revoked seat is revived). The server actions check first and answer
-- with an upgrade prompt (src/lib/billing/limits.ts); this is the same rule
-- held by the database, so a client that skips the action and inserts over
-- REST meets it anyway.
--
-- Only a signed-in CLIENT is limited (auth.role() = 'authenticated'). The
-- service role (the seed script, the e2e fixtures, support) and direct SQL
-- are trusted, the same line the team_members guard draws. current_user is
-- useless for this inside a SECURITY DEFINER function (it is the owner), and
-- auth.role() reads the request's JWT claim, which a definer does not change.
--
-- SECURITY DEFINER so the count sees every row of the account whatever the
-- inserting member's RLS allows, and so account_plan() needs no client grant.
-- The advisory lock serialises inserts for one account and key, so two
-- simultaneous inserts cannot both see "one below the limit".
--
-- Raises SQLSTATE 23514 (check_violation) with message
-- 'plan_limit_reached:<key>', which the actions recognise.
create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limit_key text := tg_argv[0];
  owner uuid;
  cap integer;
  used integer;
begin
  -- The owner's own seat is always there (it is seeded at signup); only a seat
  -- for someone else, and only one that is live (invited or active), takes
  -- one of the plan's. Decided first: it needs no claims at all. (Nested, not
  -- ANDed: plpgsql does not short-circuit, and a storefront row has no role.)
  if tg_table_name = 'team_members' then
    if new.role = 'owner' or new.status not in ('invited', 'active') then
      return new;
    end if;
  end if;

  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;

  -- Off until paid plans can be bought (see billing_switches above).
  if not coalesce((select s.plan_limits_enforced from public.billing_switches s where s.id), false) then
    return new;
  end if;

  if tg_table_name = 'storefronts' then
    -- An UPDATE only reaches here when owner_id changed (see the trigger):
    -- a storefront moved INTO an account counts against that account.
    if tg_op = 'UPDATE' then
      if new.owner_id is not distinct from old.owner_id then
        return new;
      end if;
    end if;
    owner := new.owner_id;
  elsif tg_table_name = 'team_members' then
    -- Re-activating a revoked row adds a seat, and so does moving a live row
    -- to another account; editing a live row in place does not.
    -- (Nested, not ANDed: OLD only exists for an UPDATE.)
    if tg_op = 'UPDATE' then
      if old.status in ('invited', 'active')
         and new.account_owner_id is not distinct from old.account_owner_id then
        return new;
      end if;
    end if;
    owner := new.account_owner_id;
  else
    raise exception 'enforce_plan_limit: unsupported table %', tg_table_name;
  end if;

  cap := public.plan_limit(public.account_plan(owner), limit_key);
  if cap is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('plan_limit:' || limit_key || ':' || owner::text, 0));

  if tg_table_name = 'storefronts' then
    select count(*) into used from public.storefronts s where s.owner_id = owner;
  else
    select count(*) into used
      from public.team_members tm
     where tm.account_owner_id = owner
       and tm.status in ('invited', 'active');
  end if;

  if used >= cap then
    raise exception 'plan_limit_reached:%', limit_key using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.enforce_plan_limit() from public, anon, authenticated;

-- Insert, and any change of the owning account: a row moved from one account
-- into another is a new one for the account it lands in.
drop trigger if exists storefronts_plan_limit on public.storefronts;
create trigger storefronts_plan_limit
  before insert or update of owner_id on public.storefronts
  for each row execute function public.enforce_plan_limit('storefronts');

drop trigger if exists team_members_plan_limit on public.team_members;
create trigger team_members_plan_limit
  before insert or update of status, account_owner_id on public.team_members
  for each row execute function public.enforce_plan_limit('teamSeats');

-- ---- 6. Applying a Stripe snapshot ----------------------------------------------

-- The webhook's one write. Upserts the account's row from a subscription it
-- has just FETCHED from Stripe (never from the event payload, which can arrive
-- out of order), and only if that fetch is at least as new as the one the row
-- already holds. Returns the plan and paid_until the row had before, so the
-- caller can tell an upgrade from a renewal, and whether it applied at all.
--
-- Plain SECURITY INVOKER: only the service role may execute it, and the
-- service role already bypasses RLS.
create or replace function public.billing_apply_snapshot(
  p_owner uuid,
  p_customer text,
  p_subscription text,
  p_plan text,
  p_interval text,
  p_status text,
  p_price_cents integer,
  p_currency text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_paid_until timestamptz,
  p_livemode boolean,
  p_synced_at timestamptz
)
returns table (applied boolean, previous_plan text, previous_paid_until timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  before_row public.seller_billing%rowtype;
begin
  select * into before_row
    from public.seller_billing
   where owner_id = p_owner
     for update;

  if found and before_row.stripe_synced_at is not null and before_row.stripe_synced_at > p_synced_at then
    return query select false, before_row.plan, before_row.paid_until;
    return;
  end if;

  insert into public.seller_billing as b (
    owner_id, stripe_customer_id, stripe_subscription_id, plan, billing_interval, status,
    price_cents, currency, current_period_end, cancel_at_period_end, canceled_at,
    paid_until, livemode, stripe_synced_at, updated_at
  ) values (
    p_owner, p_customer, p_subscription, p_plan, p_interval, p_status,
    p_price_cents, p_currency, p_current_period_end, coalesce(p_cancel_at_period_end, false), p_canceled_at,
    p_paid_until, coalesce(p_livemode, false), p_synced_at, now()
  )
  on conflict (owner_id) do update set
    stripe_customer_id     = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    plan                   = excluded.plan,
    billing_interval       = excluded.billing_interval,
    status                 = excluded.status,
    price_cents            = excluded.price_cents,
    currency               = excluded.currency,
    current_period_end     = excluded.current_period_end,
    cancel_at_period_end   = excluded.cancel_at_period_end,
    canceled_at            = excluded.canceled_at,
    paid_until             = excluded.paid_until,
    livemode               = excluded.livemode,
    stripe_synced_at       = excluded.stripe_synced_at,
    updated_at             = now();

  return query select true, before_row.plan, before_row.paid_until;
end
$$;

revoke execute on function public.billing_apply_snapshot(
  uuid, text, text, text, text, text, integer, text, timestamptz, boolean, timestamptz,
  timestamptz, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_apply_snapshot(
  uuid, text, text, text, text, text, integer, text, timestamptz, boolean, timestamptz,
  timestamptz, boolean, timestamptz) to service_role;

comment on function public.billing_apply_snapshot(
  uuid, text, text, text, text, text, integer, text, timestamptz, boolean, timestamptz,
  timestamptz, boolean, timestamptz) is
  'Webhook write: upsert an account''s billing row from a subscription just fetched from Stripe, only if newer than the stored snapshot. Service role only.';

-- ---- 7. Sales for the calculator ----------------------------------------------------

-- The last 30 days of an account's paid EUR sales: the item subtotal (what the
-- fee is charged on), how many sales, and the fees charged. Service role only:
-- its one caller (the pricing modal's loader) has already checked that the
-- signed-in user may read the store it names, and a client has no reason to
-- probe other stores' figures through an arbitrary seller id.
create or replace function public.billing_sales_summary(p_seller_id uuid, p_now timestamptz default now())
returns table (subtotal_cents bigint, sales integer, fees_cents bigint)
language sql stable
set search_path = ''
as $$
  select
    coalesce(sum(o.product_price_cents::bigint * o.quantity), 0)::bigint,
    count(*)::integer,
    coalesce(sum(o.platform_fee_cents), 0)::bigint
  from public.orders o
  where o.seller_id = p_seller_id
    and o.status = 'paid'
    and o.currency = 'EUR'
    and o.created_at >= p_now - interval '30 days'
    and o.created_at <= p_now
$$;

revoke execute on function public.billing_sales_summary(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_sales_summary(uuid, timestamptz) to service_role;

comment on function public.billing_sales_summary(uuid, timestamptz) is
  'Last 30 days of an account''s paid EUR sales: item subtotal, count, fees. Service role only; the caller authorises the account first.';

-- ---- 8. Permission mirror ------------------------------------------------------------
-- MIRROR of src/lib/team/permissions.ts. Edit BOTH together. 'billing.manage'
-- is the owner's alone: a plan is a contract the owner pays for. CREATE OR
-- REPLACE keeps the function's existing grants, so none are restated here.
create or replace function public.team_role_can(r public.team_role, action text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when r is null then false
    when r = 'owner'  then action in ('team.read','team.invite','team.change_role','team.revoke','store.read','products.write','storefront.write','orders.fulfil','billing.manage')
    when r = 'editor' then action in ('team.read','team.invite','store.read','products.write','storefront.write','orders.fulfil')
    when r = 'viewer' then action in ('team.read','store.read')
    else false
  end
$$;

-- ---- 9. Notification type --------------------------------------------------------------
-- MIRROR of NOTIFICATION_TYPES in lib/notifications/types.ts. A type present in
-- one list and not the other makes createNotification fail SILENTLY.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array['team','payment','stock','order','system','security','policy','billing']));

comment on constraint notifications_type_check on public.notifications is
  'Mirror of NOTIFICATION_TYPES in lib/notifications/types.ts. Update both together: a type present in one and not the other fails the insert silently.';

notify pgrst, 'reload schema';
