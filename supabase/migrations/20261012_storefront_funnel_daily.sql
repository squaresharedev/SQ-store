-- =============================================================================
-- STOREFRONT FUNNEL, DAILY: the lasting record of the buyer funnel.
--
-- WHERE THE NUMBERS COME FROM. The steps a buyer takes on the way to paying
-- (a payment page opened, a payment page left unpaid, ...) are written by the
-- server as data points in Workers Analytics Engine
-- (src/lib/analytics/funnel/record.ts). Analytics Engine keeps 90 days. Once a
-- day a scheduled job (src/lib/analytics/funnel/rollup.ts) counts each
-- finished day there and stores the counts here, so a seller's history does
-- not end at day 91.
--
-- ONE ROW = one seller, store, product, day, event, site and placement, and how
-- many times it happened. COUNTS ONLY. There is no visitor, no IP, no user
-- agent, no address and no amount in this table, and no column one could go
-- in. `referrer_host` is a bare hostname (the CHECK below cannot be satisfied
-- by an address, a path or a port).
--
-- NOT seller_funnel_events. That table is the PLANS funnel (a seller upgrading
-- their own plan, 20260930_seller_plans). This one is about a seller's buyers.
--
-- SECURITY MODEL. Read like storefront_signals: the owner, and their team with
-- `store.read`. No client-facing role can write: the only writer is
-- storefront_funnel_roll_day, service role only. A table a seller could write
-- is a conversion rate a seller could make up.
--
-- TIME. UTC days, like every other aggregate here.
-- =============================================================================

create table if not exists public.storefront_funnel_daily (
  -- The seller whose numbers these are. Their account going takes them along.
  seller_id     uuid not null references public.profiles(id) on delete cascade,

  -- Plain ids, deliberately not foreign keys: a storefront or product deleted
  -- later must not rewrite last quarter's totals, and a day's rollup must not
  -- fail because one product in it is gone.
  store_id      uuid not null,
  product_id    uuid not null,

  day           date not null,

  -- MIRROR of FUNNEL_EVENTS in src/lib/analytics/funnel/events.ts. Edit both
  -- together.
  event         text not null
    check (event in (
      'embed_view','product_open','add_to_cart',
      'checkout_started','order_paid','checkout_expired'
    )),

  -- The host of the seller's site it happened on, '' when not known. Hostname
  -- only: lowercase labels and dots, so nothing longer than a name fits.
  referrer_host text not null default ''
    check (
      char_length(referrer_host) <= 253
      and referrer_host ~ '^$|^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'
    ),

  -- The placement an embed names itself with, '' when it has none.
  placement_id  text not null default ''
    check (char_length(placement_id) <= 64 and placement_id ~ '^[A-Za-z0-9_-]*$'),

  -- How many times, that day.
  events        bigint not null check (events >= 0),

  primary key (seller_id, day, event, store_id, product_id, referrer_host, placement_id)
);

comment on table public.storefront_funnel_daily is
  'Daily counts of buyer funnel events per seller, store, product, site and placement, rolled up from Workers Analytics Engine. Counts only: no visitor, IP or amount. Written by storefront_funnel_roll_day (service role); read by the owner and their team via RLS.';
comment on column public.storefront_funnel_daily.referrer_host is
  'Hostname of the seller site the event happened on, or empty. Never an address, a path or a port.';

-- ---- RLS: read like storefront_signals, written by nobody a browser can be ----
alter table public.storefront_funnel_daily enable row level security;

drop policy if exists storefront_funnel_daily_select_member on public.storefront_funnel_daily;
create policy storefront_funnel_daily_select_member
  on public.storefront_funnel_daily
  for select
  to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

-- No insert/update/delete policy, and none should exist. The revokes are on top
-- of that, because Supabase's default privileges grant table access to anon
-- and authenticated.
revoke all on table public.storefront_funnel_daily from anon;
revoke insert, update, delete, truncate on table public.storefront_funnel_daily
  from authenticated;
grant select on table public.storefront_funnel_daily to authenticated;

-- ---- The writer: one finished day, replaced whole --------------------------------
-- The job hands over EVERYTHING Analytics Engine holds for one day, and that
-- day's rows here become exactly that. Replacing rather than adding is what
-- makes the job safe to run twice, or late: the second run writes the same
-- rows. A seller who no longer exists is skipped, not an error.
--
-- p_rows: [{seller_id, store_id, product_id, event, referrer_host,
--           placement_id, events}], already validated by the job; the table's
-- CHECKs refuse anything that was not.
create or replace function public.storefront_funnel_roll_day(p_day date, p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  written integer;
begin
  delete from public.storefront_funnel_daily d where d.day = p_day;

  insert into public.storefront_funnel_daily
    (seller_id, store_id, product_id, day, event, referrer_host, placement_id, events)
  select
    r.seller_id, r.store_id, r.product_id, p_day, r.event,
    coalesce(r.referrer_host, ''), coalesce(r.placement_id, ''),
    sum(r.events)::bigint
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    seller_id uuid, store_id uuid, product_id uuid, event text,
    referrer_host text, placement_id text, events bigint
  )
  where exists (select 1 from public.profiles p where p.id = r.seller_id)
  group by 1, 2, 3, 5, 6, 7;

  get diagnostics written = row_count;
  return written;
end
$$;

comment on function public.storefront_funnel_roll_day(date, jsonb) is
  'Replaces one UTC day of storefront_funnel_daily with the counts given. Idempotent. Service role only.';

revoke execute on function public.storefront_funnel_roll_day(date, jsonb)
  from public, anon, authenticated;
grant execute on function public.storefront_funnel_roll_day(date, jsonb) to service_role;

-- ---- The reader: one account, one window, counted per event ----------------------
-- SECURITY INVOKER: RLS on the table is the boundary, so a forged account id
-- returns nothing. p_from / p_to are inclusive; null = unbounded.
create or replace function public.storefront_funnel_aggregate(
  p_account_id uuid,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
select jsonb_build_object(
  'totals', coalesce((
    select jsonb_agg(jsonb_build_object('event', event, 'count', n) order by event)
    from (
      select d.event, sum(d.events)::bigint as n
      from public.storefront_funnel_daily d
      where d.seller_id = p_account_id
        and (p_from is null or d.day >= p_from)
        and (p_to is null or d.day <= p_to)
      group by d.event
    ) t
  ), '[]'::jsonb)
)
$$;

comment on function public.storefront_funnel_aggregate(uuid, date, date) is
  'Buyer funnel event counts for one account and date window, as jsonb. SECURITY INVOKER: RLS on storefront_funnel_daily is the boundary.';

-- Re-stated because Supabase re-grants execute to anon/authenticated whenever a
-- function is created or replaced.
revoke execute on function public.storefront_funnel_aggregate(uuid, date, date)
  from public, anon;
grant execute on function public.storefront_funnel_aggregate(uuid, date, date)
  to authenticated, service_role;

notify pgrst, 'reload schema';
