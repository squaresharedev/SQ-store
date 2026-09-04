-- =============================================================================
-- Demo sales simulator, extended to keep the SIGNAL sections alive too.
--
-- WHY. 20260801_demo_sales_sim.sql exists because a one-time seed goes stale:
-- the moment its backdated window ends, every "last 7 days" tile reads zero.
-- storefront_signals has exactly the same problem, and now that the analytics
-- page has a Storefront views / Product clicks section for every seller who
-- has a storefront, an un-refreshed signal history goes stale in the same way
-- orders would without this simulator.
--
-- THE FUNNEL. Views and clicks are DERIVED from the expected embed-order
-- count for the tick's window, never chosen independently — see
-- demo.signal_funnel. That is what keeps the three numbers telling one
-- consistent story (more traffic than clicks, more clicks than embed sales)
-- instead of three unrelated curves that happen to share a chart. The two
-- rate bands mirror CLICK_TO_ORDER_RATE / VIEW_TO_CLICK_RATE in
-- scripts/lib/fake-data.ts exactly, for the same reason the ORIGINAL
-- simulator mirrors that file's order model: a backfilled day (TS) and a live
-- day (this simulator) must not be distinguishable in the same chart.
--
-- WHAT IS NOT SIMULATED. email_signup and booking have no storefront block
-- that can produce them yet — seeding either would be exactly the invented
-- number this project goes out of its way to avoid everywhere else (see
-- docs/analytics-datapoints.md). Only storefront_view and product_click, the
-- two kinds with a real ingest path today, are ever written here.
--
-- SAFETY. Same four fences as the base migration: demo schema, PostgREST does
-- not expose it; every function is security definer with search_path pinned;
-- storefront_id is read from config, never passed in; retention pruning keeps
-- the table bounded (reusing `retention_days` rather than adding a second
-- knob nobody would remember to set alongside it).
-- =============================================================================

alter table demo.sales_sim
  add column if not exists last_tick_views_inserted  integer not null default 0,
  add column if not exists last_tick_clicks_inserted integer not null default 0,
  add column if not exists last_tick_signals_pruned  integer not null default 0;

comment on column demo.sales_sim.orders_per_day is
  'Average orders per day. The tick converts this to a per-interval rate, and derives storefront view / product click volume from it too (see demo.signal_funnel) — one knob scales all three.';

-- -----------------------------------------------------------------------------
-- demo.visitor_hash(index) : deterministic 64-hex-char digest for a visitor
-- INDEX — the signal-side analogue of demo.buyer_email. Not a digest of
-- anything identifying; its only job is to be a stable, unique-per-index
-- string so COUNT DISTINCT on visitor_hash behaves like it would against a
-- real salted one.
-- -----------------------------------------------------------------------------
create or replace function demo.visitor_hash(p_index integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(('visitor-' || p_index)::bytea), 'hex');
$$;

-- -----------------------------------------------------------------------------
-- demo.pick_visitor(buyer_pool_size) : ~35% of signals come from a small
-- RECURRING pool of visitors, the rest from a first-timer. Same reasoning as
-- demo.pick_buyer, and needed for the same reason: a fresh hash every time
-- pins uniqueVisitors to the row count forever, and a fixed pool only makes
-- every visitor a repeat.
--
-- The pool is 3x the buyer pool: far more people browse a storefront than buy
-- from it. Deliberately not its own config column — `buyer_pool_size` already
-- exists to make a store's repeat-customer mix feel tighter or looser, and a
-- second knob nobody sets together with it would just drift out of sync.
-- -----------------------------------------------------------------------------
create or replace function demo.pick_visitor(p_buyer_pool_size integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select case
    when random() < 0.35
      then demo.visitor_hash(floor(power(random(), 1.4) * (p_buyer_pool_size * 3))::integer)
      else demo.visitor_hash(p_buyer_pool_size * 3 + floor(random() * 1000000)::integer)
  end;
$$;

-- -----------------------------------------------------------------------------
-- demo.signal_funnel(embed_orders) : an expected click count and an expected
-- view count for an expected EMBED order count. See the file header for why
-- the two rate bands must track scripts/lib/fake-data.ts's constants.
--
-- Each output is floored at the input: a quiet or order-less window still
-- gets SOME traffic, because people look at a storefront before it has sold
-- anything too.
-- -----------------------------------------------------------------------------
create or replace function demo.signal_funnel(p_embed_orders numeric)
returns table (clicks numeric, views numeric)
language sql
volatile
set search_path = ''
as $$
  with c as (
    select greatest(p_embed_orders, p_embed_orders / (0.08 + random() * 0.14)) as clicks
  )
  select c.clicks, greatest(c.clicks, c.clicks / (0.12 + random() * 0.20)) as views
  from c;
$$;

-- -----------------------------------------------------------------------------
-- demo.signal_emit(kind, n, from, to) : insert n storefront_signals rows of
-- ONE kind, spread across a window. Shared by the tick and the backfill, same
-- reasoning as demo.sales_sim_emit — a backfilled batch and a live one must
-- come out of the same code path or they will not look the same.
--
-- p_kind is checked against an allowlist rather than trusted, even though
-- every caller in this file is internal: the same discipline the public
-- ingest route applies to a caller it trusts even less.
-- -----------------------------------------------------------------------------
create or replace function demo.signal_emit(
  p_kind  text,
  p_count integer,
  p_from  timestamptz,
  p_to    timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg        demo.sales_sim%rowtype;
  v_inserted integer := 0;
begin
  if p_count is null or p_count <= 0 then return 0; end if;
  if p_kind not in ('storefront_view', 'product_click') then return 0; end if;

  select * into cfg from demo.sales_sim where id;
  -- No storefront, no embed widget, no signals — mirrors production exactly:
  -- the only place a view or click is ever recorded is the embed route, and
  -- that route needs a real embed_key, which needs a real storefront.
  if cfg.seller_id is null or cfg.storefront_id is null then return 0; end if;

  -- Product popularity: same hashtext-of-id ranking as sales_sim_emit, so a
  -- bestseller in orders is also the most-clicked product rather than the two
  -- rankings drifting apart between calls.
  with product_pick as (
    select
      p.id,
      row_number() over (order by pg_catalog.hashtext(p.id::text)) as rank
    from public.products p
    where p.owner_id = cfg.seller_id
      and p.status = 'active'
  ),
  weighted as (
    select id,
           power(rank::numeric, -0.7) as w,
           sum(power(rank::numeric, -0.7)) over () as w_total,
           sum(power(rank::numeric, -0.7)) over (order by rank) as w_cum
    from product_pick
  ),
  draws as (
    select
      gs.i,
      -- ONE draw per row, reused below. Re-rolling random() inside the
      -- lateral join's WHERE clause would draw a fresh threshold per
      -- candidate product scanned rather than once per output row — the same
      -- bug sales_sim_emit's own r_pick comment warns about.
      random() as r_pick,
      p_from + (random() * (extract(epoch from (p_to - p_from)) || ' seconds')::interval) as at
    from generate_series(1, p_count) gs(i)
  ),
  picked as (
    select d.i, d.at, w.id as product_id
    from draws d
    left join lateral (
      select w.id
      from weighted w
      -- Only product_click ever attaches a product; a storefront_view is not
      -- tied to one, matching what the real embed route records.
      where p_kind = 'product_click' and w.w_cum >= d.r_pick * w.w_total
      order by w.w_cum
      limit 1
    ) w on true
  )
  insert into public.storefront_signals (
    account_id, storefront_id, kind, channel, visitor_hash, occurred_at, metadata
  )
  select
    cfg.seller_id,
    cfg.storefront_id,
    p_kind,
    'embed',
    demo.pick_visitor(cfg.buyer_pool_size),
    p.at,
    case when p.product_id is not null
      then jsonb_build_object('product_id', p.product_id)
      else '{}'::jsonb
    end
  from picked p;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- -----------------------------------------------------------------------------
-- demo.sales_sim_tick(): unchanged order logic, plus signal pruning and
-- emission using the same window and the same expected-order figure.
-- -----------------------------------------------------------------------------
create or replace function demo.sales_sim_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg               demo.sales_sim%rowtype;
  v_from            timestamptz;
  v_minutes         numeric;
  v_expected        numeric;
  v_expected_embed  numeric;
  v_clicks          numeric;
  v_views           numeric;
  v_count           integer;
  v_click_count     integer;
  v_view_count      integer;
  v_inserted        integer := 0;
  v_pruned          integer := 0;
  v_signals_pruned  integer := 0;
  v_views_inserted  integer := 0;
  v_clicks_inserted integer := 0;
begin
  select * into cfg from demo.sales_sim where id for update;
  if not found or not cfg.enabled or cfg.seller_id is null then
    return 0;
  end if;

  -- Window since the previous tick. Capped at 60 minutes so a paused cron (or
  -- a restored backup) does not dump days of backlog into a single instant the
  -- moment it resumes -- that would show up as one absurd spike on the chart.
  v_from := coalesce(cfg.last_tick_at, p_now - interval '20 minutes');
  v_minutes := least(extract(epoch from (p_now - v_from)) / 60.0, 60.0);
  if v_minutes <= 0 then return 0; end if;

  -- Expected = daily rate x elapsed fraction of a day x time-of-day shape.
  v_expected := cfg.orders_per_day
              * (v_minutes / 1440.0)
              * demo.hour_weight(extract(hour from p_now at time zone 'UTC')::integer)
              * demo.dow_weight(extract(isodow from p_now at time zone 'UTC')::integer);

  -- Rolling retention, BEFORE emitting. See the original migration for why
  -- pruning runs first (it is what stops an expired-row cap deadlock).
  delete from public.orders
   where seller_id = cfg.seller_id
     and created_at < p_now - (cfg.retention_days || ' days')::interval;
  get diagnostics v_pruned = row_count;

  -- Same retention window as orders — one knob for "how far back does the
  -- demo keep history", not a second one nobody remembers to set alongside it.
  delete from public.storefront_signals
   where account_id = cfg.seller_id
     and occurred_at < p_now - (cfg.retention_days || ' days')::interval;
  get diagnostics v_signals_pruned = row_count;

  v_count := demo.stochastic_round(v_expected);
  if v_count > 0 then
    v_inserted := demo.sales_sim_emit(v_count, v_from, p_now);
  end if;

  -- Views and clicks scale off v_expected (the SAME figure orders scale off),
  -- never off a number of their own. ~62% of orders are embed, matching the
  -- channel split sales_sim_emit's rolled CTE already assumes; only an embed
  -- order ever traces back to a storefront view or a product click.
  v_expected_embed := v_expected * 0.62;
  select clicks, views into v_clicks, v_views from demo.signal_funnel(v_expected_embed);
  v_click_count := demo.stochastic_round(v_clicks);
  v_view_count := demo.stochastic_round(v_views);
  if cfg.storefront_id is not null then
    if v_view_count > 0 then
      v_views_inserted := demo.signal_emit('storefront_view', v_view_count, v_from, p_now);
    end if;
    if v_click_count > 0 then
      v_clicks_inserted := demo.signal_emit('product_click', v_click_count, v_from, p_now);
    end if;
  end if;

  update demo.sales_sim
     set last_tick_at = p_now,
         last_tick_inserted = v_inserted,
         last_tick_pruned = v_pruned,
         last_tick_views_inserted = v_views_inserted,
         last_tick_clicks_inserted = v_clicks_inserted,
         last_tick_signals_pruned = v_signals_pruned
   where id;

  return v_inserted;
end;
$$;

-- -----------------------------------------------------------------------------
-- demo.sales_sim_backfill(): unchanged order logic and unchanged return shape
-- (order count only — the operator runbook's `select
-- demo.sales_sim_backfill(...)` already interprets that as "orders inserted",
-- and changing the return shape would break it silently). Signals are still
-- backfilled, day by day, as a side effect.
-- -----------------------------------------------------------------------------
create or replace function demo.sales_sim_backfill(
  p_from date,
  p_to   date default (now() at time zone 'UTC')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg              demo.sales_sim%rowtype;
  v_day            date;
  v_count          integer;
  v_total          integer := 0;
  v_day_end        timestamptz;
  v_embed_estimate numeric;
  v_clicks         numeric;
  v_views          numeric;
begin
  select * into cfg from demo.sales_sim where id;
  if cfg.seller_id is null then return 0; end if;
  if p_from > p_to then return 0; end if;

  for v_day in select generate_series(p_from, p_to, interval '1 day')::date loop
    -- Per-day volume follows the weekday shape plus +/-30% noise, so no two
    -- weeks are identical.
    v_count := demo.stochastic_round(
      cfg.orders_per_day
      * demo.dow_weight(extract(isodow from v_day)::integer)
      * (0.7 + random() * 0.6)::numeric
    );
    -- Never emit into the future; today's partial day stops at now().
    v_day_end := least(v_day::timestamptz + interval '1 day' - interval '1 second', now());
    if v_day_end > v_day::timestamptz then
      v_total := v_total + demo.sales_sim_emit(v_count, v_day::timestamptz, v_day_end);

      -- Same funnel as the tick, so a backfilled day and a live day are not
      -- distinguishable in the same chart.
      if cfg.storefront_id is not null then
        v_embed_estimate := v_count * 0.62;
        select clicks, views into v_clicks, v_views
          from demo.signal_funnel(v_embed_estimate);
        perform demo.signal_emit(
          'product_click', demo.stochastic_round(v_clicks), v_day::timestamptz, v_day_end
        );
        perform demo.signal_emit(
          'storefront_view', demo.stochastic_round(v_views), v_day::timestamptz, v_day_end
        );
      end if;
    end if;
  end loop;

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissions: RE-STATED for sales_sim_tick / sales_sim_backfill because
-- Supabase re-grants execute to anon/authenticated on every `create or
-- replace function` (the PostgREST auto-grant trap) — omitting these two
-- lines here would silently reopen both. The new helper functions
-- (visitor_hash, pick_visitor, signal_funnel, signal_emit) are internal-only,
-- exactly like demo.pick_buyer / demo.buyer_email / demo.hour_weight before
-- them, and get no grants of their own for the same reason those do not.
-- -----------------------------------------------------------------------------
revoke execute on function demo.sales_sim_tick(timestamptz)
  from public, anon, authenticated;
revoke execute on function demo.sales_sim_backfill(date, date)
  from public, anon, authenticated;

grant execute on function demo.sales_sim_tick(timestamptz) to service_role;
grant execute on function demo.sales_sim_backfill(date, date) to service_role;
