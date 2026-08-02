-- =============================================================================
-- Aggregates in SQL: analytics, dashboard, per-product sales, metric-sorted
-- product ranking.
--
-- WHY. All four surfaces used to read a CAPPED set of order rows into JS and
-- aggregate there (5,000 for analytics and per-product sales, 1,000 for the
-- dashboard, 500 product ids for metric sorts). Past the cap every figure went
-- silently wrong: analytics under-reported, "all time" meant "the oldest
-- 5,000", the bestseller badge could point at the wrong product, and metric
-- sorts ranked only the newest 500 products. The only signal was a
-- console.warn nobody reads. Aggregating in SQL removes the caps entirely: the
-- database scans an index, the app receives a few hundred bytes of jsonb.
--
-- SECURITY MODEL: SECURITY INVOKER, deliberately. The orders/products RLS
-- policies already cover both the owner path and the team-member path
-- (team_role_can(team_actor_role(seller_id), 'store.read')), and the TS caller
-- passes a seller id it has ALREADY validated via getActiveAccount(). The
-- explicit `where seller_id = p_seller_id` narrows to that one account; a
-- forged id yields zero rows because RLS filters them, never another seller's
-- data. SECURITY DEFINER would mean re-implementing the membership check in
-- SQL, one more copy to keep in sync, for no gain.
--
-- CURRENCY: analytics and the dashboard are EUR-only, expressed as
-- `currency <> 'USD'` to mirror toCurrency() exactly (anything that is not the
-- literal 'USD' is treated as EUR). product_sales_aggregate has NO currency
-- filter, matching the JS it replaces (cards label with the product's own
-- currency).
--
-- TIME: all bucketing is UTC, matching the JS it replaces (which sliced ISO
-- strings / used getUTCDay()). Weekday numbers are ISO (1 = Monday .. 7).
-- =============================================================================

-- Covers the hottest path: paid-in-range for one seller. The planner would
-- otherwise bitmap-and (seller_id, status) with (seller_id, created_at); one
-- composite index serves the whole predicate in a single scan.
create index if not exists orders_seller_status_created_idx
  on public.orders (seller_id, status, created_at);

-- -----------------------------------------------------------------------------
-- analytics_aggregate: everything the /analytics page renders, in one call.
--
-- p_from/p_to are inclusive ISO dates (null = unbounded / today). The result
-- carries per-day series rows; the app zero-fills the calendar and re-buckets
-- monthly for long spans (presentation, cheap, already unit-tested there).
-- first_paid_date and first_order_date are both returned because the JS they
-- replace anchored the SERIES at the first paid order but the range-days
-- figure at the first order of any status.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_aggregate(
  p_seller_id uuid,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with bounds as (
  -- Explicit UTC: a bare date::timestamptz would use the server timezone.
  -- Supabase runs UTC anyway, but the bound must not depend on that.
  select
    coalesce(p_from::timestamp at time zone 'UTC', '-infinity'::timestamptz) as from_ts,
    coalesce((p_to + 1)::timestamp at time zone 'UTC', 'infinity'::timestamptz) as to_ts
),
in_range as (
  select *
  from public.orders o, bounds b
  where o.seller_id = p_seller_id
    and o.currency <> 'USD'
    and o.created_at >= b.from_ts
    and o.created_at < b.to_ts
),
paid as (select * from in_range where status = 'paid'),
refunded as (select * from in_range where status = 'refunded'),
buyer_counts as (
  select count(*) as orders_n
  from paid
  where nullif(trim(lower(buyer_email)), '') is not null
  group by trim(lower(buyer_email))
)
select jsonb_build_object(
  'totals', jsonb_build_object(
    'revenue_cents', coalesce((select sum(amount_cents) from paid), 0),
    'sales', (select count(*) from paid),
    'fees_cents', coalesce((select sum(platform_fee_cents) from paid), 0),
    'refunded_count', (select count(*) from refunded),
    'refunded_cents', coalesce((select sum(amount_cents) from refunded), 0),
    'unique_buyers', (select count(*) from buyer_counts),
    'repeat_buyers', (select count(*) from buyer_counts where orders_n >= 2)
  ),
  'first_paid_date',
    (select ((min(created_at) at time zone 'UTC')::date)::text from paid),
  'first_order_date',
    (select ((min(created_at) at time zone 'UTC')::date)::text from in_range),
  'series_days', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', day, 'revenue_cents', revenue_cents, 'sales', sales
    ) order by day)
    from (
      select
        ((created_at at time zone 'UTC')::date)::text as day,
        sum(amount_cents) as revenue_cents,
        count(*) as sales
      from paid
      group by 1
    ) d
  ), '[]'::jsonb),
  'channels', coalesce((
    select jsonb_agg(jsonb_build_object(
      'channel', channel, 'revenue_cents', revenue_cents, 'sales', sales
    ))
    from (
      select channel, sum(amount_cents) as revenue_cents, count(*) as sales
      from paid
      group by channel
    ) c
  ), '[]'::jsonb),
  'top_products', coalesce((
    select jsonb_agg(jsonb_build_object(
      'title', product_title, 'revenue_cents', revenue_cents, 'sales', sales
    ) order by revenue_cents desc, product_title asc)
    from (
      select product_title, sum(amount_cents) as revenue_cents, count(*) as sales
      from paid
      group by product_title
      order by 2 desc, 1 asc
      limit 5
    ) t
  ), '[]'::jsonb),
  'weekdays', coalesce((
    select jsonb_agg(jsonb_build_object(
      'isodow', isodow, 'revenue_cents', revenue_cents, 'sales', sales
    ))
    from (
      select
        extract(isodow from created_at at time zone 'UTC')::int as isodow,
        sum(amount_cents) as revenue_cents,
        count(*) as sales
      from paid
      group by 1
    ) w
  ), '[]'::jsonb),
  'statuses', coalesce((
    select jsonb_agg(jsonb_build_object('status', status, 'count', n))
    from (
      select
        case when status in ('paid','refunded','disputed','pending')
             then status else 'pending' end as status,
        count(*) as n
      from in_range
      group by 1
    ) s
  ), '[]'::jsonb)
)
$$;

-- -----------------------------------------------------------------------------
-- dashboard_orders_aggregate: the overview page's windows and trends.
--
-- Daily trend buckets use the SAME "age in whole days relative to now" math as
-- the JS they replace (floor((now - created_at) / 86400s)), NOT calendar days,
-- so the sparkline shape is bit-identical through the swap. p_now is a
-- parameter only for tests; production callers omit it.
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_orders_aggregate(
  p_seller_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with eur as (
  select * from public.orders
  where seller_id = p_seller_id and currency <> 'USD'
),
paid as (select * from eur where status = 'paid'),
paid_30 as (select * from paid where created_at >= p_now - interval '30 days'),
paid_prev as (
  select * from paid
  where created_at >= p_now - interval '60 days'
    and created_at <  p_now - interval '30 days'
)
select jsonb_build_object(
  'all_time', jsonb_build_object(
    'revenue_cents', coalesce((select sum(amount_cents) from paid), 0),
    'sales', (select count(*) from paid)
  ),
  'last_30d', jsonb_build_object(
    'revenue_cents', coalesce((select sum(amount_cents) from paid_30), 0),
    'sales', (select count(*) from paid_30)
  ),
  'prev_30d', jsonb_build_object(
    'revenue_cents', coalesce((select sum(amount_cents) from paid_prev), 0),
    'sales', (select count(*) from paid_prev)
  ),
  'trend_days', coalesce((
    select jsonb_agg(jsonb_build_object(
      'age_days', age_days, 'revenue_cents', revenue_cents, 'sales', sales
    ) order by age_days)
    from (
      select
        floor(extract(epoch from (p_now - created_at)) / 86400)::int as age_days,
        sum(amount_cents) as revenue_cents,
        count(*) as sales
      from paid_30
      group by 1
    ) t
  ), '[]'::jsonb),
  'refunded_count', (select count(*) from eur where status = 'refunded'),
  'disputed_count', (select count(*) from eur where status = 'disputed'),
  -- created_at is passed through as a raw timestamptz: jsonb serialises it as
  -- ISO 8601 with an offset, which new Date() parses to the exact instant.
  -- Deliberately NOT to_char(): date/time formatting there consults the server
  -- locale, and a non-C locale on a non-UTF8 database (the embedded Windows
  -- test replica) makes it throw encoding errors. ::text on dates and native
  -- jsonb timestamp serialisation are locale-independent.
  'recent_orders', coalesce((
    select jsonb_agg(entry order by ts desc)
    from (
      select created_at as ts, jsonb_build_object(
        'product_title', product_title,
        'channel', channel,
        'status', status,
        'amount_cents', amount_cents,
        'currency', currency,
        'created_at', created_at
      ) as entry
      from eur
      order by created_at desc
      limit 5
    ) r
  ), '[]'::jsonb)
)
$$;

-- -----------------------------------------------------------------------------
-- product_sales_aggregate: per-product paid rollup + the bestseller.
--
-- No currency filter (matches the JS this replaces; a product sells in one
-- currency in practice, and the card labels with the product's own currency).
-- min(currency) stands in for the JS "first order wins": deterministic, and
-- identical for the single-currency catalogues the rule assumes.
-- Bestseller = most REVENUE, ties broken by product_id for determinism.
-- -----------------------------------------------------------------------------
create or replace function public.product_sales_aggregate(p_seller_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with rollup as (
  select
    product_id,
    count(*)::int as units_sold,
    sum(amount_cents)::bigint as revenue_cents,
    min(currency) as currency
  from public.orders
  where seller_id = p_seller_id
    and status = 'paid'
    and product_id is not null
  group by product_id
)
select jsonb_build_object(
  'by_product', coalesce((
    select jsonb_object_agg(
      product_id::text,
      jsonb_build_object(
        'units_sold', units_sold,
        'revenue_cents', revenue_cents,
        'currency', currency
      )
    ) from rollup
  ), '{}'::jsonb),
  'bestseller_id', (
    select product_id::text from rollup
    order by revenue_cents desc, product_id asc
    limit 1
  )
)
$$;

-- -----------------------------------------------------------------------------
-- products_ranked_by_metric: page of product ids ordered by a sales metric.
--
-- Replaces the JS path that read the newest 500 ids and ranked those only.
-- Ordering matches the old code exactly where it was correct: metric
-- descending, then created_at descending, then id ascending as the stable
-- tiebreak. p_search arrives PRE-ESCAPED by the app's escapeIlike (backslash
-- escaping, ILIKE's default escape char).
-- -----------------------------------------------------------------------------
create or replace function public.products_ranked_by_metric(
  p_seller_id uuid,
  p_metric text,            -- 'unitsSold' or 'revenue'
  p_status text default null,
  p_search text default null,
  p_limit  integer default 24,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with sales as (
  select product_id, count(*)::bigint as units_sold, sum(amount_cents)::bigint as revenue
  from public.orders
  where seller_id = p_seller_id and status = 'paid' and product_id is not null
  group by product_id
),
matching as (
  select
    p.id, p.created_at,
    coalesce(case when p_metric = 'unitsSold' then s.units_sold else s.revenue end, 0)
      as metric
  from public.products p
  left join sales s on s.product_id = p.id
  where p.owner_id = p_seller_id
    and (p_status is null or p.status = p_status)
    and (p_search is null or p.title ilike '%' || p_search || '%')
)
select jsonb_build_object(
  'total', (select count(*) from matching),
  'ids', coalesce((
    select jsonb_agg(id order by ord)
    from (
      select id, row_number() over (
        order by metric desc, created_at desc, id asc
      ) as ord
      from matching
      order by metric desc, created_at desc, id asc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) page
  ), '[]'::jsonb)
)
$$;

-- -----------------------------------------------------------------------------
-- Permissions: signed-in app callers and the service role; never anon.
-- -----------------------------------------------------------------------------
revoke execute on function public.analytics_aggregate(uuid, date, date) from public, anon;
grant execute on function public.analytics_aggregate(uuid, date, date) to authenticated, service_role;

revoke execute on function public.dashboard_orders_aggregate(uuid, timestamptz) from public, anon;
grant execute on function public.dashboard_orders_aggregate(uuid, timestamptz) to authenticated, service_role;

revoke execute on function public.product_sales_aggregate(uuid) from public, anon;
grant execute on function public.product_sales_aggregate(uuid) to authenticated, service_role;

revoke execute on function public.products_ranked_by_metric(uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.products_ranked_by_metric(uuid, text, text, text, integer, integer) to authenticated, service_role;
