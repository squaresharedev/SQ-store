-- =============================================================================
-- analytics_weekday_products: which products sold on which day of the week.
--
-- WHY. The "Sales by weekday" card drew one bar per day: how many sales, and
-- nothing about what they were. A seller reading "Saturday is my best day"
-- wants the next sentence too: best day for WHAT. This returns the same paid
-- sales the card already counts, split by product, so each day's bar can be
-- drawn as a stack.
--
-- A NEW FUNCTION, not a new key on analytics_aggregate. That one is 150 lines
-- feeding every other panel on the page; replacing it to add a seventh panel's
-- breakdown would put all six at risk for it, and would force the code and the
-- migration to ship in lockstep. This is additive: until it exists the app
-- gets an error from the RPC, treats the breakdown as absent, and draws the
-- plain bars it always drew.
--
-- THE TOP FEW ARE NAMED, THE REST ARE ONE ROW. A store with 300 products would
-- otherwise return 2,100 rows to draw seven bars nobody could read. The four
-- best sellers in the range (by number of sales, the unit the card counts)
-- keep their titles; everything else comes back with a null title and is drawn
-- as "Other". Four, because the chart kit gives a stack four distinguishable
-- tones before it has to fold. src/lib/analytics/queries.ts does not need the
-- number: it draws whatever is named.
--
-- Same rules as analytics_aggregate, deliberately, so the stack adds up to the
-- bar it replaces: paid orders only, EUR-only (`currency <> 'USD'`), inclusive
-- ISO date bounds read as UTC, ISO weekday numbers (1 = Monday .. 7). Products
-- are grouped by product_title, the snapshot on the order, exactly as
-- top_products is: a renamed or deleted product keeps the sales it made.
--
-- SECURITY INVOKER, for the reason given in 20260802_analytics_sql_aggregates:
-- the orders RLS policies already decide who may read which seller's rows, so
-- a forged p_seller_id returns nothing.
--
-- Apply via the Management API query endpoint or the SQL editor.
-- =============================================================================

create or replace function public.analytics_weekday_products(
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
  select
    coalesce(p_from::timestamp at time zone 'UTC', '-infinity'::timestamptz) as from_ts,
    coalesce((p_to + 1)::timestamp at time zone 'UTC', 'infinity'::timestamptz) as to_ts
),
paid as (
  select o.product_title, o.created_at
  from public.orders o, bounds b
  where o.seller_id = p_seller_id
    and o.currency <> 'USD'
    and o.status = 'paid'
    and o.created_at >= b.from_ts
    and o.created_at < b.to_ts
),
ranked as (
  select
    product_title,
    count(*) as sales,
    row_number() over (order by count(*) desc, product_title asc) as place
  from paid
  group by product_title
),
split as (
  select
    extract(isodow from p.created_at at time zone 'UTC')::int as isodow,
    -- Null is "everything outside the named few", never a product's own title.
    case when r.place <= 4 then r.product_title end as title,
    case when r.place <= 4 then r.place end as place,
    count(*) as sales
  from paid p
  join ranked r on r.product_title is not distinct from p.product_title
  group by 1, 2, 3
)
select jsonb_build_object(
  'products', coalesce((
    select jsonb_agg(jsonb_build_object('title', product_title, 'sales', sales) order by place)
    from ranked
    where place <= 4
  ), '[]'::jsonb),
  'weekdays', coalesce((
    select jsonb_agg(
      jsonb_build_object('isodow', isodow, 'title', title, 'sales', sales)
      order by isodow, place nulls last
    )
    from split
  ), '[]'::jsonb)
)
$$;

revoke execute on function public.analytics_weekday_products(uuid, date, date) from public, anon;
grant execute on function public.analytics_weekday_products(uuid, date, date) to authenticated, service_role;
