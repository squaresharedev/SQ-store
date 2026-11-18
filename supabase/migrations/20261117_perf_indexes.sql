-- =============================================================================
-- PERFORMANCE: low-risk index and function fixes across the busiest read paths.
--
-- What and why (one entry per change):
--
--   1. storefront_signals_aggregate -- all_time_kinds
--      Was: SELECT jsonb_agg(DISTINCT kind) FROM storefront_signals WHERE
--           account_id = p_account_id -- a full heap scan on every analytics
--           page load, called twice per page from src/lib/analytics/queries.ts.
--      Now: recursive loose index scan over the existing
--           storefront_signals_account_kind_occurred_idx (account_id, kind,
--           occurred_at). Each iteration seeks to the next distinct kind with a
--           single index probe; no heap pages are read.
--
--   2. rate_limit_keys -- drop updated_at index, set fillfactor 80
--      Was: rate_limit_keys_updated_at_idx existed so rl_gc_keys() could find
--           stale rows. The table is bounded in size (rl_take_key appends a
--           timestamp ONLY when a take is allowed, and only when fewer than
--           p_max unpruned entries remain), so the GC becomes a cheap seqscan
--           of a small table without the index.
--      Problem: rl_take_key sets updated_at = now() on EVERY call, which is
--           every public page view. Because updated_at was indexed, every write
--           was a non-HOT update (the index had to be updated too).
--      Fix: drop the index; set fillfactor = 80 so pages have free space for
--           HOT updates to the hits array and updated_at column.
--
--   3. dashboard_orders_aggregate -- FILTER rewrite
--      Was: eur/paid/paid_30/paid_prev CTEs each did SELECT *, materialising
--           ALL columns from the seller's order history four times. recent_orders
--           sorted the whole eur set to pick 5 rows.
--      Now: single aggregate scan from public.orders with FILTER clauses for
--           the five scalar values; trend_days and recent_orders are separate
--           subqueries that reach orders_seller_status_created_idx and
--           orders_seller_created_idx respectively.
--
--      analytics_aggregate -- narrow in_range CTE
--      Was: in_range selected * from orders, materialising every column.
--           Downstream only uses: created_at, status, amount_cents,
--           platform_fee_cents, buyer_email, channel.
--      Now: in_range lists exactly those six columns. Output JSON is unchanged.
--
--   4. Missing FK indexes
--      storefront_signals(storefront_id): FK is ON DELETE SET NULL; deleting a
--        storefront scanned the full table to find rows to null-out.
--      storefront_funnel_daily(day): storefront_funnel_roll_day deletes by day
--        but the PK leads with seller_id, so each nightly roll scanned the whole
--        table.
--      seller_funnel_events(account_id): FK ON DELETE CASCADE, no index on
--        account_id; account deletion scanned the full table.
--      (terms_notice_sends(user_id) is left out on purpose: that table only
--        exists once 20261031_terms_notices is applied, which production
--        still lacks, and this file must apply on its own.)
--
--   5. Reviews -- targeted indexes, old index dropped
--      List queries order by reviewed_at then id, but reviews_seller_idx was
--      sorted by created_at. Import duplicate checks filter
--      (seller_id, external_id). The held-count badge reads
--      moderation_status = 'held' per seller.
--      Added: (seller_id, reviewed_at desc, id desc),
--             (seller_id, external_id) where external_id is not null,
--             (seller_id) where moderation_status = 'held'.
--      Dropped: reviews_seller_idx (seller_id, created_at desc). No query
--        orders by created_at per seller; the new reviewed_at index still
--        covers the auth.users ON DELETE CASCADE lookup on seller_id.
--
--   6. Prefix indexes dropped
--      orders_seller_status_idx (seller_id, status) is a prefix of
--        orders_seller_status_created_idx (seller_id, status, created_at).
--      products_owner_id_idx (owner_id) is a prefix of
--        products_owner_created_idx (owner_id, created_at desc).
--      storefronts_owner_id_idx (owner_id) is a prefix of
--        storefronts_owner_updated_idx (owner_id, updated_at desc).
--      Every query that used these can use the wider index; keeping both wastes
--      write amplification and buffer cache.
--
-- Production apply notes:
--   * The three function replacements (items 1 and 3) run inside a transaction.
--   * The DROP INDEX statements and new CREATE INDEX statements should be run
--     one at a time OUTSIDE any explicit transaction block when the table is
--     live and large. Use DROP INDEX CONCURRENTLY and
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS for those.
--   * Item 2 DROP in particular must use DROP INDEX CONCURRENTLY
--     rate_limit_keys_updated_at_idx on production (every page view writes
--     this table, so a plain DROP briefly holds a ShareLock).
--   * ALTER TABLE ... SET (fillfactor = 80) can run inside a transaction and
--     takes effect for pages written after the next VACUUM.
-- =============================================================================

-- ---- 1. storefront_signals_aggregate: loose index scan for all_time_kinds ----

create or replace function public.storefront_signals_aggregate(
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
with bounds as (
  -- Explicit UTC: a bare date::timestamptz would use the server timezone.
  select
    coalesce(p_from::timestamp at time zone 'UTC', '-infinity'::timestamptz) as from_ts,
    coalesce((p_to + 1)::timestamp at time zone 'UTC', 'infinity'::timestamptz) as to_ts
),
in_range as (
  select s.*
  from public.storefront_signals s, bounds b
  where s.account_id = p_account_id
    and s.occurred_at >= b.from_ts
    and s.occurred_at < b.to_ts
)
select jsonb_build_object(
  'first_signal_date',
    (select ((min(occurred_at) at time zone 'UTC')::date)::text from in_range),
  -- Deliberately NOT from in_range: this drives whether a section EXISTS, and
  -- an empty range is a reason to show zeros, never a reason to hide a source
  -- the seller is genuinely running.
  --
  -- Loose index scan over storefront_signals_account_kind_occurred_idx
  -- (account_id, kind, occurred_at): each iteration seeks to the next distinct
  -- kind with a single index probe rather than scanning every row.
  'all_time_kinds', (
    with recursive ls(kind) as (
      select min(kind)
      from public.storefront_signals
      where account_id = p_account_id
      union all
      select (
        select min(kind)
        from public.storefront_signals
        where account_id = p_account_id
          and kind > ls.kind
      )
      from ls
      where ls.kind is not null
    )
    select coalesce(jsonb_agg(kind order by kind), '[]'::jsonb)
    from ls
    where kind is not null
  ),
  -- The blocks the seller has actually placed. Guarded on jsonb_typeof because
  -- a storefront saved before blocks existed has no array there, and
  -- jsonb_array_elements throws on a non-array rather than returning nothing.
  'active_block_types', coalesce((
    select jsonb_agg(distinct b->>'type')
    from public.storefronts s,
         lateral jsonb_array_elements(s.config->'blocks') b
    where s.owner_id = p_account_id
      and jsonb_typeof(s.config->'blocks') = 'array'
      and b->>'type' is not null
  ), '[]'::jsonb),
  'totals', coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', kind,
      'count', n,
      'value_cents', value_cents,
      'unique_visitors', unique_visitors
    ) order by kind)
    from (
      select
        kind,
        count(*) as n,
        coalesce(sum(value_cents), 0) as value_cents,
        count(distinct visitor_hash) as unique_visitors
      from in_range
      group by kind
    ) t
  ), '[]'::jsonb),
  'series_days', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', day, 'kind', kind, 'count', n, 'value_cents', value_cents
    ) order by day, kind)
    from (
      select
        ((occurred_at at time zone 'UTC')::date)::text as day,
        kind,
        count(*) as n,
        coalesce(sum(value_cents), 0) as value_cents
      from in_range
      group by 1, 2
    ) d
  ), '[]'::jsonb),
  'channels', coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'channel', channel, 'count', n))
    from (
      select kind, channel, count(*) as n
      from in_range
      group by 1, 2
    ) c
  ), '[]'::jsonb),
  'weekdays', coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'isodow', isodow, 'count', n))
    from (
      select
        kind,
        extract(isodow from occurred_at at time zone 'UTC')::int as isodow,
        count(*) as n
      from in_range
      group by 1, 2
    ) w
  ), '[]'::jsonb),
  'storefronts', coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', kind, 'storefront_id', storefront_id, 'name', name, 'count', n
    ) order by n desc, name asc nulls last)
    from (
      select
        r.kind,
        r.storefront_id::text as storefront_id,
        sf.name as name,
        count(*) as n
      from in_range r
      left join public.storefronts sf on sf.id = r.storefront_id
      group by 1, 2, 3
      order by 4 desc
      limit 40
    ) s
  ), '[]'::jsonb)
)
$$;

-- Re-stated because Supabase re-grants execute to anon/authenticated on every
-- create or replace (the PostgREST auto-grant trap). Without these two lines a
-- replace silently reopens the function.
revoke execute on function public.storefront_signals_aggregate(uuid, date, date)
  from public, anon;
grant execute on function public.storefront_signals_aggregate(uuid, date, date)
  to authenticated, service_role;

-- ---- 2. rate_limit_keys: drop updated_at index, set fillfactor 80 -----------

-- For production: run as DROP INDEX CONCURRENTLY rate_limit_keys_updated_at_idx
-- outside a transaction block. This plain DROP is here for replay safety.
drop index if exists rate_limit_keys_updated_at_idx;

-- New pages will now reserve 20 % free space per heap page. Combined with
-- dropping the index above, updates to updated_at and hits can be HOT.
-- Follow up with: VACUUM public.rate_limit_keys; to compact existing pages.
alter table public.rate_limit_keys set (fillfactor = 80);

-- ---- 3a. dashboard_orders_aggregate: single aggregate pass with FILTER ------

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
-- Single scan over non-USD orders for the seller with FILTER clauses for the
-- scalar counts, plus two subqueries that can reach dedicated indexes:
--   trend_days: orders_seller_status_created_idx (seller_id, status, created_at)
--   recent_orders: orders_seller_created_idx (seller_id, created_at)
select jsonb_build_object(
  'all_time', jsonb_build_object(
    'revenue_cents', coalesce(sum(amount_cents) filter (where status = 'paid'), 0),
    'sales',         count(*)           filter (where status = 'paid')
  ),
  'last_30d', jsonb_build_object(
    'revenue_cents', coalesce(
      sum(amount_cents) filter (
        where status = 'paid'
          and created_at >= p_now - interval '30 days'
      ), 0),
    'sales', count(*) filter (
      where status = 'paid'
        and created_at >= p_now - interval '30 days'
    )
  ),
  'prev_30d', jsonb_build_object(
    'revenue_cents', coalesce(
      sum(amount_cents) filter (
        where status = 'paid'
          and created_at >= p_now - interval '60 days'
          and created_at <  p_now - interval '30 days'
      ), 0),
    'sales', count(*) filter (
      where status = 'paid'
        and created_at >= p_now - interval '60 days'
        and created_at <  p_now - interval '30 days'
    )
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
      from public.orders
      where seller_id = p_seller_id
        and currency <> 'USD'
        and status = 'paid'
        and created_at >= p_now - interval '30 days'
      group by 1
    ) t
  ), '[]'::jsonb),
  'refunded_count', count(*) filter (where status = 'refunded'),
  'disputed_count', count(*) filter (where status = 'disputed'),
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
        'id',            id,
        'product_title', product_title,
        'channel',       channel,
        'status',        status,
        'amount_cents',  amount_cents,
        'currency',      currency,
        'created_at',    created_at
      ) as entry
      from public.orders
      where seller_id = p_seller_id and currency <> 'USD'
      order by created_at desc
      limit 5
    ) r
  ), '[]'::jsonb)
)
from public.orders
where seller_id = p_seller_id and currency <> 'USD'
$$;

-- create or replace re-grants EXECUTE to public (and therefore anon, which
-- PostgREST speaks with the publishable key). Restate the intended grants.
revoke execute on function public.dashboard_orders_aggregate(uuid, timestamptz) from public, anon;
grant execute on function public.dashboard_orders_aggregate(uuid, timestamptz) to authenticated, service_role;

-- ---- 3b. analytics_aggregate: narrow in_range CTE to used columns -----------

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
-- Narrowed from SELECT *: only the six columns used by the downstream CTEs and
-- projections (created_at, status, amount_cents, platform_fee_cents,
-- buyer_email, channel). The materialized CTE is smaller and cheaper to scan.
in_range as (
  select o.created_at, o.status, o.amount_cents, o.platform_fee_cents,
         o.buyer_email, o.channel
  from public.orders o, bounds b
  where o.seller_id = p_seller_id
    and o.currency <> 'USD'
    and o.created_at >= b.from_ts
    and o.created_at < b.to_ts
),
paid as (select * from in_range where status = 'paid'),
refunded as (select * from in_range where status = 'refunded'),
-- One row per product sold, so an add-on counts for its own product.
paid_lines as (
  select l.product_title, l.revenue_cents
  from public.order_lines l, bounds b
  where l.seller_id = p_seller_id
    and l.currency <> 'USD'
    and l.status = 'paid'
    and l.created_at >= b.from_ts
    and l.created_at < b.to_ts
),
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
      select product_title, sum(revenue_cents) as revenue_cents, count(*) as sales
      from paid_lines
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

revoke execute on function public.analytics_aggregate(uuid, date, date) from public, anon;
grant execute on function public.analytics_aggregate(uuid, date, date) to authenticated, service_role;

-- ---- 4. Missing FK indexes ---------------------------------------------------

-- storefront_signals.storefront_id: FK is ON DELETE SET NULL. Without this,
-- deleting a storefront scanned the whole signals table to null the column.
-- Partial because the FK search only looks for non-NULL storefront_id values.
create index if not exists storefront_signals_storefront_id_idx
  on public.storefront_signals (storefront_id)
  where storefront_id is not null;

-- storefront_funnel_daily: storefront_funnel_roll_day deletes WHERE day = $1
-- but the PK leads with seller_id. Without this index the nightly roll does a
-- full table scan.
create index if not exists storefront_funnel_daily_day_idx
  on public.storefront_funnel_daily (day);

-- seller_funnel_events.account_id: FK ON DELETE CASCADE on profiles(id). No
-- index meant account deletion scanned the full events table.
create index if not exists seller_funnel_events_account_id_idx
  on public.seller_funnel_events (account_id);

-- ---- 5. Reviews: targeted indexes, stale index dropped ----------------------

-- List queries in seller-queries.ts order by reviewed_at then id. The old
-- reviews_seller_idx sorted by created_at and was not used for any list query.
create index if not exists reviews_seller_reviewed_idx
  on public.reviews (seller_id, reviewed_at desc, id desc);

-- Import duplicate check: .eq("seller_id", ...).in("external_id", chunk).
-- The existing reviews_external_unique covers (product_id, external_id) but
-- not the (seller_id, external_id) lookup the import route uses.
create index if not exists reviews_seller_external_idx
  on public.reviews (seller_id, external_id)
  where external_id is not null;

-- Held-count badge: .eq("seller_id", ...).eq("moderation_status", "held").
-- A partial index keeps it small and avoids touching clean/blocked/pending rows.
create index if not exists reviews_seller_held_idx
  on public.reviews (seller_id)
  where moderation_status = 'held';

-- Drop the old seller index sorted by created_at. No query uses
-- (seller_id, created_at) ordering on reviews. The new reviews_seller_reviewed_idx
-- has seller_id as its leading column, so the auth.users ON DELETE CASCADE
-- lookup on seller_id still has an index path.
drop index if exists reviews_seller_idx;

-- ---- 6. Redundant prefix indexes dropped ------------------------------------

-- orders_seller_status_idx (seller_id, status) is a strict prefix of
-- orders_seller_status_created_idx (seller_id, status, created_at). Every
-- query that matched the prefix can use the wider index.
drop index if exists orders_seller_status_idx;

-- products_owner_id_idx (owner_id) is a strict prefix of
-- products_owner_created_idx (owner_id, created_at desc).
drop index if exists products_owner_id_idx;

-- storefronts_owner_id_idx (owner_id) is a strict prefix of
-- storefronts_owner_updated_idx (owner_id, updated_at desc).
drop index if exists storefronts_owner_id_idx;

notify pgrst, 'reload schema';
