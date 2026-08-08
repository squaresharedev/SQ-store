-- =============================================================================
-- dashboard_orders_aggregate: carry the order id in recent_orders.
--
-- WHY. The overview's "Recent orders" card rendered five rows that went
-- nowhere: the payload had no id, so there was nothing to link to. Each row now
-- deep-links to /orders?order=<id>, which opens that exact order's detail
-- panel. The id is the seller's own row (RLS already scopes the read), and the
-- card is behind the dashboard's auth boundary, so nothing new is exposed.
--
-- Everything else in the function is unchanged: same windows, same trend math,
-- same EUR-only semantics.
-- =============================================================================

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
        'id', id,
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

-- create or replace re-grants EXECUTE to public (and therefore anon, which
-- PostgREST speaks with the publishable key). Restate the intended grants.
revoke execute on function public.dashboard_orders_aggregate(uuid, timestamptz) from public, anon;
grant execute on function public.dashboard_orders_aggregate(uuid, timestamptz) to authenticated, service_role;
