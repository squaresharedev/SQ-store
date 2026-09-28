-- =============================================================================
-- Demo sales simulator, taught about fulfilment (20260927_order_fulfilment).
--
-- WHY. The simulator inserts a sale every few minutes. Once orders carry a
-- fulfilment state, each of those would land 'unfulfilled' with no address and
-- stay that way forever: the demo seller's To ship queue would grow by roughly
-- orders_per_day every day, every one of them a parcel with nowhere to go.
--
-- WHAT CHANGES.
--   1. Simulated orders carry a quantity and a delivery address (a small fixed
--      set of plausible EU addresses, named after the simulated buyer), so the
--      queue shows what a real one looks like.
--   2. Each tick marks the seller's paid orders older than two days shipped, a
--      day or so after they were placed. The queue therefore holds the last
--      couple of days of sales and stays that size, the way a seller who ships
--      promptly would see it, rather than accumulating.
--
-- SAFETY. Unchanged from the base migration: demo schema only, every function
-- security definer with search_path pinned, the seller id read from config and
-- never passed in, and nothing happens while demo.sales_sim.enabled is false.
--
-- EXCLUDED FROM THE TEST REPLICA like its base migration (tests/db cannot run
-- pg_cron). When applied, triage its version as excluded in
-- scripts/check-prod-migrations.ts with the same reason as 20260801140113.
--
-- Apply AFTER 20260927_order_fulfilment.sql: it writes the columns that adds.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- demo.buyer_name(email): "alex.wong123@example.test" -> "Alex Wong", so the
-- name on the parcel matches the buyer the order was attributed to.
-- -----------------------------------------------------------------------------
create or replace function demo.buyer_name(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select initcap(split_part(split_part(p_email, '@', 1), '.', 1))
      || ' '
      || initcap(regexp_replace(split_part(split_part(p_email, '@', 1), '.', 2), '[0-9]+$', ''));
$$;

-- -----------------------------------------------------------------------------
-- demo.ship_to(email): a delivery address for a simulated buyer. Chosen by a
-- hash of the email, so a returning buyer ships to the same place every time.
-- Shape matches public.orders.ship_to (src/lib/orders/ship-to.ts).
-- -----------------------------------------------------------------------------
create or replace function demo.ship_to(p_email text)
returns jsonb
language sql
immutable
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
      ('ul. Mokotowska 19',    'Warszawa',   '00-561',   'PL'),
      ('Rua das Flores 27',    'Porto',      '4050-265', 'PT'),
      ('Obchodna 31',          'Bratislava', '811 06',   'SK')
  ),
  numbered as (
    select a.*, row_number() over () - 1 as n from addresses a
  )
  select jsonb_build_object(
    'name', demo.buyer_name(p_email),
    'line1', line1,
    'city', city,
    'postalCode', postal,
    'country', country
  )
  from numbered
  -- Masked rather than abs(): abs() of the smallest int overflows.
  where n = (pg_catalog.hashtext(p_email) & 2147483647) % 10;
$$;

-- -----------------------------------------------------------------------------
-- demo.sales_sim_emit: as before (20260801_demo_sales_sim), plus a quantity and
-- a delivery address on every simulated order. Mostly one unit, sometimes two
-- or three, charged accordingly.
-- -----------------------------------------------------------------------------
create or replace function demo.sales_sim_emit(p_count integer, p_from timestamptz, p_to timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg          demo.sales_sim%rowtype;
  v_inserted   integer := 0;
  v_room       integer;
  v_existing   integer;
begin
  if p_count is null or p_count <= 0 then return 0; end if;

  select * into cfg from demo.sales_sim where id;
  if cfg.seller_id is null then return 0; end if;

  select count(*) into v_existing
    from public.orders where seller_id = cfg.seller_id;
  v_room := cfg.max_orders - v_existing;
  if v_room <= 0 then return 0; end if;
  p_count := least(p_count, v_room);

  with catalogue as (
    select
      p.id, p.title, p.price_cents,
      row_number() over (order by pg_catalog.hashtext(p.id::text)) as rank
    from public.products p
    where p.owner_id = cfg.seller_id
      and p.status = 'active'
  ),
  weighted as (
    select id, title, price_cents,
           power(rank::numeric, -0.7) as w,
           sum(power(rank::numeric, -0.7)) over () as w_total,
           sum(power(rank::numeric, -0.7)) over (order by rank) as w_cum
    from catalogue
  ),
  draws as (
    select
      gs.i,
      random() as r_pick,
      random() as r_status,
      random() as r_channel,
      random() as r_quantity,
      demo.pick_buyer(cfg.buyer_pool_size) as buyer,
      p_from + (random() * (extract(epoch from (p_to - p_from)) || ' seconds')::interval
               ) as at
    from generate_series(1, p_count) gs(i)
  ),
  chosen as (
    select d.i, d.at, d.r_status, d.r_channel, d.r_quantity, d.buyer,
           w.id as product_id, w.title, w.price_cents
    from draws d
    cross join lateral (
      select w.id, w.title, w.price_cents
      from weighted w
      where w.w_cum >= d.r_pick * w.w_total
      order by w.w_cum
      limit 1
    ) w
  ),
  rolled as (
    select
      c.*,
      case when c.r_channel < 0.62 then 'embed' else 'marketplace' end as channel,
      case
        when c.r_status < 0.85 then 'paid'
        when c.r_status < 0.91 then 'refunded'
        when c.r_status < 0.94 then 'disputed'
        else 'pending'
      end as status,
      case when c.r_quantity < 0.82 then 1 when c.r_quantity < 0.96 then 2 else 3 end as quantity
    from chosen c
  )
  insert into public.orders (
    seller_id, product_id, storefront_id, channel, status,
    amount_cents, platform_fee_cents, currency,
    buyer_email, product_title, product_price_cents, created_at,
    quantity, ship_to
  )
  select
    cfg.seller_id,
    r.product_id,
    case when r.channel = 'embed' then cfg.storefront_id else null end,
    r.channel,
    r.status,
    r.price_cents * r.quantity,
    round(r.price_cents * r.quantity * 0.05)::integer,
    cfg.currency,
    r.buyer,
    r.title,
    r.price_cents,
    r.at,
    r.quantity,
    demo.ship_to(r.buyer)
  from rolled r
  where r.product_id is not null;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- -----------------------------------------------------------------------------
-- demo.sales_sim_ship(now): the simulated seller ships everything paid that is
-- more than two days old, stamped a day to a day and a half after the sale.
-- Returns how many orders it marked.
-- -----------------------------------------------------------------------------
create or replace function demo.sales_sim_ship(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       demo.sales_sim%rowtype;
  v_shipped integer := 0;
begin
  select * into cfg from demo.sales_sim where id;
  if cfg.seller_id is null then return 0; end if;

  update public.orders
     set fulfilment_status = 'shipped',
         shipped_at = created_at + interval '1 day' + random() * interval '12 hours'
   where seller_id = cfg.seller_id
     and status = 'paid'
     and fulfilment_status = 'unfulfilled'
     and created_at < p_now - interval '2 days';
  get diagnostics v_shipped = row_count;
  return v_shipped;
end;
$$;

-- -----------------------------------------------------------------------------
-- demo.sales_sim_tick: as before (20260830_demo_sales_sim_signals), plus the
-- shipping step, run after the prune so it never touches a row about to go.
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

  v_from := coalesce(cfg.last_tick_at, p_now - interval '20 minutes');
  v_minutes := least(extract(epoch from (p_now - v_from)) / 60.0, 60.0);
  if v_minutes <= 0 then return 0; end if;

  v_expected := cfg.orders_per_day
              * (v_minutes / 1440.0)
              * demo.hour_weight(extract(hour from p_now at time zone 'UTC')::integer)
              * demo.dow_weight(extract(isodow from p_now at time zone 'UTC')::integer);

  delete from public.orders
   where seller_id = cfg.seller_id
     and created_at < p_now - (cfg.retention_days || ' days')::interval;
  get diagnostics v_pruned = row_count;

  delete from public.storefront_signals
   where account_id = cfg.seller_id
     and occurred_at < p_now - (cfg.retention_days || ' days')::interval;
  get diagnostics v_signals_pruned = row_count;

  perform demo.sales_sim_ship(p_now);

  v_count := demo.stochastic_round(v_expected);
  if v_count > 0 then
    v_inserted := demo.sales_sim_emit(v_count, v_from, p_now);
  end if;

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

-- Same lock-down as the base migration: only the cron job (as the owner) and
-- service_role ever run these.
revoke execute on function demo.buyer_name(text) from public, anon, authenticated;
revoke execute on function demo.ship_to(text) from public, anon, authenticated;
revoke execute on function demo.sales_sim_emit(integer, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function demo.sales_sim_ship(timestamptz) from public, anon, authenticated;
revoke execute on function demo.sales_sim_tick(timestamptz) from public, anon, authenticated;
grant execute on function demo.sales_sim_tick(timestamptz) to service_role;
