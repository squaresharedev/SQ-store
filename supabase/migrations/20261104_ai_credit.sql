-- =============================================================================
-- AI credit: what each store's AI writing help has used this month.
--
-- WHY. AI writing help (a Pro perk, lib/suggestions) is a paid model call on
-- the platform's key. Each store gets a monthly credit (PLANS.pro.aiCreditCents,
-- EUR 10), and every call is charged to it at the model's cost plus 20%
-- (src/lib/billing/ai-credit.ts). Once the month's credit is used, the actions
-- refuse until the 1st, so AI can never cost more per store than the credit.
--
-- HOLD, THEN SETTLE. A call's real cost is known only after it, and a call
-- may never report back (timed out, the Worker gone). So the server first
-- HOLDS the most the call can cost, in one locked step that refuses when the
-- store's month or the platform's day has no room for it, and SETTLES it to
-- the real cost after. Calls fired together queue on the row lock, so none
-- can spend credit another already holds; a settle that never comes leaves
-- the most charged, never nothing.
--
-- WHAT THIS ADDS.
--   ai_credit_usage    one row per store per month (UTC): micros used (a
--                      millionth of a euro) and how many calls. Service role
--                      only: no client policy at all, like rate_limits. The
--                      settings page reads it through the server.
--   ai_platform_usage  one row per day (UTC): micros held by every store
--                      together, under AI_PLATFORM_DAILY_CENTS. Service role
--                      only, the same way.
--   ai_credit_hold     holds one call's most on both rows, or refuses:
--                      'held', 'credit_used' or 'platform_full'. Service role
--                      only.
--   ai_credit_settle   moves both rows by what the call really cost minus
--                      what was held. Service role only.
--   profiles.ai_suggest_as_you_type
--                      the person's own switch for suggestions while they
--                      type (on unless they turn it off). Written by its owner
--                      through the existing profile update policy.
--   'ai_writing'       joins the pricing funnel's sources: the plans page
--                      reached from an AI upsell. MIRROR of PRICING_SOURCES in
--                      src/lib/billing/paths.ts.
-- =============================================================================

create table if not exists public.ai_credit_usage (
  owner_id     uuid        not null references auth.users (id) on delete cascade,
  -- The month, as its first day.
  period       date        not null check (extract(day from period) = 1),
  used_micros  bigint      not null default 0 check (used_micros >= 0),
  calls        integer     not null default 0 check (calls >= 0),
  updated_at   timestamptz not null default now(),
  primary key (owner_id, period)
);

comment on table public.ai_credit_usage is
  'AI writing help used per store per month (UTC), in micros of the billing currency. Service role only: written by ai_credit_hold and ai_credit_settle, read by the server.';

alter table public.ai_credit_usage enable row level security;
revoke all on table public.ai_credit_usage from anon, authenticated;

create table if not exists public.ai_platform_usage (
  day          date        primary key,
  used_micros  bigint      not null default 0 check (used_micros >= 0),
  calls        integer     not null default 0 check (calls >= 0),
  updated_at   timestamptz not null default now()
);

comment on table public.ai_platform_usage is
  'AI writing help held by every store together per day (UTC), in micros: the platform''s ceiling. Service role only: written by ai_credit_hold and ai_credit_settle.';

alter table public.ai_platform_usage enable row level security;
revoke all on table public.ai_platform_usage from anon, authenticated;

-- The allowance and the ceiling come from the server (PLANS and
-- AI_PLATFORM_DAILY_CENTS in TypeScript), which alone may call this.
create or replace function public.ai_credit_hold(
  p_owner uuid,
  p_period date,
  p_day date,
  p_micros bigint,
  p_allowance bigint,
  p_platform_max bigint
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  store_used bigint;
  platform_used bigint;
begin
  if p_micros is null or p_micros < 0 or p_allowance is null or p_platform_max is null then
    raise exception 'ai_credit_hold: a hold needs an amount, an allowance and a ceiling';
  end if;

  -- The store's month first, then the platform's day: always this order, so
  -- two holds never wait on each other's second lock.
  insert into public.ai_credit_usage (owner_id, period) values (p_owner, p_period)
    on conflict (owner_id, period) do nothing;
  select used_micros into store_used from public.ai_credit_usage
    where owner_id = p_owner and period = p_period
    for update;
  if store_used + p_micros > p_allowance then
    return 'credit_used';
  end if;

  insert into public.ai_platform_usage (day) values (p_day)
    on conflict (day) do nothing;
  select used_micros into platform_used from public.ai_platform_usage
    where day = p_day
    for update;
  if platform_used + p_micros > p_platform_max then
    return 'platform_full';
  end if;

  update public.ai_credit_usage
    set used_micros = used_micros + p_micros, calls = calls + 1, updated_at = now()
    where owner_id = p_owner and period = p_period;
  update public.ai_platform_usage
    set used_micros = used_micros + p_micros, calls = calls + 1, updated_at = now()
    where day = p_day;
  return 'held';
end
$$;

-- Down by what was held and not spent, or up by what a call cost past its
-- hold (a bound gone wrong: charged all the same). Never below zero.
create or replace function public.ai_credit_settle(p_owner uuid, p_period date, p_day date, p_delta bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.ai_credit_usage
    set used_micros = greatest(used_micros + p_delta, 0), updated_at = now()
    where owner_id = p_owner and period = p_period;
  update public.ai_platform_usage
    set used_micros = greatest(used_micros + p_delta, 0), updated_at = now()
    where day = p_day;
$$;

-- This schema auto-grants new functions to anon and authenticated: a client
-- that could call these could hold nothing, give itself credit back, or
-- spend any store's month.
revoke execute on function public.ai_credit_hold(uuid, date, date, bigint, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.ai_credit_settle(uuid, date, date, bigint) from public, anon, authenticated;
grant execute on function public.ai_credit_hold(uuid, date, date, bigint, bigint, bigint) to service_role;
grant execute on function public.ai_credit_settle(uuid, date, date, bigint) to service_role;

alter table public.profiles
  add column if not exists ai_suggest_as_you_type boolean not null default true;

comment on column public.profiles.ai_suggest_as_you_type is
  'Whether AI writing help suggests the next words while this person types a description (Settings > Plan & billing).';

alter table public.seller_funnel_events
  drop constraint if exists seller_funnel_events_source_check;

alter table public.seller_funnel_events
  add constraint seller_funnel_events_source_check
    check (source is null or source in ('sidebar', 'profile_menu', 'settings', 'storefront_limit',
                                        'team_limit', 'product_limit', 'order_nudge',
                                        'analytics_nudge', 'email', 'notification',
                                        'checkout_cancel', 'orders_export', 'ai_writing'));

notify pgrst, 'reload schema';
