-- =============================================================================
-- Demo sales simulator: keep the demo seller's dashboard ALIVE without a cron
-- box, a CI job, or a service_role key living outside the database.
--
-- WHY. `pnpm seed` writes one batch of backdated orders and stops. The moment
-- that batch's window ends, every "last 7 days" tile on the dashboard reads
-- zero and the store looks dead. Re-running the seed by hand is not a system.
--
-- Alternatives considered, and why they lost to pg_cron:
--   - GitHub Actions on a schedule: 48+ runs/day, each doing checkout + pnpm
--     install to insert a handful of rows, and it needs SUPABASE_SERVICE_ROLE_KEY
--     as a repo secret. Expensive, slow, and it widens the blast radius of that
--     key to anyone with repo write access.
--   - A Cloudflare Worker cron trigger: cheaper, but still an HTTP round trip
--     per tick and it couples demo data to the app's deploy.
--   - pg_cron: the work is three INSERTs and one DELETE against an index that
--     already exists. No network, no secrets, no build. Microseconds per tick.
--
-- SAFETY. This is fake-data machinery pointed at a real database, so it is
-- fenced on four sides:
--   1. It lives in the `demo` schema, which PostgREST does not expose, so no
--      amount of client-side cleverness can reach it over the API.
--   2. Every function is `security definer` with `set search_path = ''` and
--      fully-qualified names.
--   3. `demo.sales_sim.enabled` defaults to FALSE. Applying this migration
--      changes NOTHING until someone explicitly flips it on. The cron job is
--      scheduled up front, but a disabled tick returns 0 immediately.
--   4. Every write is scoped to the single `seller_id` in the config row. The
--      simulator cannot touch another seller's orders even if enabled, because
--      the seller id is read from config, never passed in by a caller.
--
-- COST. Bounded by construction. `retention_days` prunes the seller's old
-- orders on each tick and `max_orders` refuses to insert past a hard ceiling,
-- so the table reaches a steady state (~orders_per_day x retention_days rows)
-- and stays there forever instead of growing without limit. At the defaults
-- that is ~1,440 rows, reached and held.
--
-- OPERATING IT. There is no CLI: the demo schema is deliberately not exposed
-- over PostgREST, so this is run from the Supabase SQL editor.
--
--   -- point it at a seller and switch it on
--   update demo.sales_sim
--      set seller_id = '<auth user id>',
--          storefront_id = '<storefront id or null>',
--          enabled = true
--    where id;
--
--   -- pause it (leaves everything else intact; ticks become no-ops)
--   update demo.sales_sim set enabled = false where id;
--
--   -- busier or quieter store
--   update demo.sales_sim set orders_per_day = 40 where id;
--
--   -- what did the last beat do?
--   select enabled, last_tick_at, last_tick_inserted, last_tick_pruned
--     from demo.sales_sim;
--
--   -- fill a gap (e.g. after a pause). Safe to run more than once, but it ADDS
--   -- orders each time rather than topping up to a target.
--   select demo.sales_sim_backfill(current_date - 30);
--
--   -- is the schedule healthy?
--   select d.status, d.start_time, d.return_message
--     from cron.job_run_details d join cron.job j on j.jobid = d.jobid
--    where j.jobname = 'demo-sales-sim'
--    order by d.start_time desc limit 10;
--
-- The simulator only ever READS products; it never creates them. `pnpm seed`
-- owns the catalogue, and scripts/lib/fake-data.ts mirrors the same four
-- distribution choices so backfilled and live days are indistinguishable.
-- =============================================================================

create schema if not exists demo;

-- Not exposed via PostgREST (Supabase exposes `public` only), but revoke
-- anyway so a future schema-exposure change cannot silently open this up.
revoke all on schema demo from public, anon, authenticated;

create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- Config: a singleton row. `id` is a boolean pinned to true by a CHECK, which
-- is the cheapest way to make "there is exactly one row" a schema guarantee
-- rather than a convention someone violates later.
-- -----------------------------------------------------------------------------
create table if not exists demo.sales_sim (
  id                  boolean primary key default true check (id),
  -- Master switch. FALSE means every tick is a no-op returning 0.
  enabled             boolean not null default false,
  -- The ONLY seller the simulator may write orders for.
  seller_id           uuid,
  -- Storefront to attribute `embed` sales to; null leaves them unattributed.
  storefront_id       uuid,
  -- Average orders per day. The tick converts this to a per-interval rate.
  orders_per_day      numeric not null default 12
                        check (orders_per_day >= 0 and orders_per_day <= 500),
  -- Rolling window. Orders older than this are pruned, which is what makes
  -- the row count converge instead of climbing forever.
  retention_days      integer not null default 120
                        check (retention_days between 7 and 400),
  -- Hard ceiling on the seller's order count. Deliberately below the app's
  -- ORDERS_READ_LIMIT (5000) so analytics never hits its truncation warning.
  max_orders          integer not null default 4000
                        check (max_orders between 1 and 20000),
  -- Size of the recurring buyer pool. Small pool => visible repeat customers.
  buyer_pool_size     integer not null default 90
                        check (buyer_pool_size between 1 and 100000),
  -- Currency for generated orders. Single-currency, because the analytics
  -- reader filters to EUR and a mixed catalogue silently halves the dataset.
  currency            text not null default 'EUR',
  -- Observability: what the last tick actually did.
  last_tick_at        timestamptz,
  last_tick_inserted  integer not null default 0,
  last_tick_pruned    integer not null default 0
);

revoke all on demo.sales_sim from public, anon, authenticated;

insert into demo.sales_sim (id) values (true) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Shape helpers. Real storefronts do not sell uniformly across the clock or
-- the week; flat data is the single most obvious tell in a demo, because every
-- chart renders as a rectangle.
-- -----------------------------------------------------------------------------

-- Relative sales intensity by UTC hour: a quiet night, a morning ramp, an
-- afternoon plateau, and an evening peak (digital goods sell after work).
--
-- Both curves are NORMALISED to mean 1 by dividing by the array's own average.
-- Without that, the curves' combined mean (~0.85) silently scaled every rate
-- down and `orders_per_day = 12` actually produced ~10. Dividing by the array's
-- own mean keeps the config field honest even if the curve is re-drawn later.
create or replace function demo.hour_weight(p_hour integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  with raw(w) as (
    select array[
      0.25, 0.15, 0.10, 0.10, 0.12, 0.20,  -- 00-05 night
      0.40, 0.70, 1.00, 1.20, 1.30, 1.25,  -- 06-11 morning ramp
      1.10, 1.20, 1.30, 1.35, 1.40, 1.50,  -- 12-17 afternoon
      1.70, 1.80, 1.60, 1.20, 0.80, 0.45   -- 18-23 evening peak
    ]::numeric[]
  )
  select w[(p_hour % 24) + 1]
       / ((select sum(x) from unnest(w) x) / array_length(w, 1))
  from raw;
$$;

-- Relative intensity by ISO day-of-week (1 = Monday .. 7 = Sunday).
create or replace function demo.dow_weight(p_dow integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  with raw(w) as (
    select array[1.05, 1.10, 1.05, 1.00, 0.95, 0.65, 0.60]::numeric[]
  )
  select w[p_dow] / ((select sum(x) from unnest(w) x) / array_length(w, 1))
  from raw;
$$;

-- Turn a fractional expected count into an integer WITHOUT throwing away the
-- fraction: 0.3 expected orders becomes 1 order 30% of the time. Rounding
-- instead would floor every sub-1.0 interval to zero and the simulator would
-- never fire at low rates.
create or replace function demo.stochastic_round(p_value numeric)
returns integer
language sql
volatile
set search_path = ''
as $$
  select floor(p_value)::integer
       + case when random() < (p_value - floor(p_value)) then 1 else 0 end;
$$;

-- Deterministic email for a buyer INDEX. Split out of pick_buyer so the
-- "which buyer" decision and the "what does that buyer's address look like"
-- formatting are separately testable. Always a reserved .test domain, so a
-- generated address is never deliverable to a real inbox.
create or replace function demo.buyer_email(p_index integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select format(
    '%s.%s%s@example.test',
    (array['alex','sam','jordan','riley','casey','noa','mika','lee','robin',
           'kai','tess','ivan','luca','mara','gus','juno','remy','sasha'])[(p_index % 18) + 1],
    (array['wong','silva','meyer','novak','haddad','kim','rossi','dubois',
           'olsen','costa','tran','abadi','weber','koch','flores','park'])[((p_index / 18) % 16) + 1],
    100 + p_index
  );
$$;

-- Roughly 28% of orders come from a small RECURRING pool, the rest from a
-- first-time buyer. That split is the whole point. The analytics page counts
-- uniqueBuyers vs repeatBuyers explicitly, and both degenerate cases read as
-- obviously fake:
--   - fresh random email per order (what the old seed did) => repeatBuyers is
--     permanently 0, across 416 orders and 416 distinct addresses;
--   - a fixed pool only => every buyer is a repeat buyer and the store never
--     appears to acquire anyone.
create or replace function demo.pick_buyer(p_pool_size integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select case
    when random() < 0.28
      -- Returning: mild skew so a few regulars stand out without one address
      -- swallowing a tenth of the store's orders (exponent 2.2 did exactly
      -- that -- one buyer took 15% of all sales).
      then demo.buyer_email(floor(power(random(), 1.3) * p_pool_size)::integer)
      -- First-time: an index far outside the pool, so it never collides.
      else demo.buyer_email(p_pool_size + floor(random() * 1000000)::integer)
  end;
$$;

-- -----------------------------------------------------------------------------
-- demo.sales_sim_emit(n, from, to) : insert n orders spread across a window.
--
-- Shared by the cron tick and the backfill so both produce IDENTICAL-looking
-- data; a backfilled day and a live day must not be distinguishable in a chart.
-- -----------------------------------------------------------------------------
create or replace function demo.sales_sim_emit(
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
  cfg          demo.sales_sim%rowtype;
  v_inserted   integer := 0;
  v_room       integer;
  v_existing   integer;
begin
  if p_count is null or p_count <= 0 then return 0; end if;

  select * into cfg from demo.sales_sim where id;
  if cfg.seller_id is null then return 0; end if;

  -- Hard ceiling. Checked here (not only in the tick) so backfill cannot
  -- blow past it either.
  select count(*) into v_existing
    from public.orders where seller_id = cfg.seller_id;
  v_room := cfg.max_orders - v_existing;
  if v_room <= 0 then return 0; end if;
  p_count := least(p_count, v_room);

  -- Product popularity: rank the seller's ACTIVE products by a stable hash of
  -- their id and weight them ~1/rank^0.7. Uniform picking gives every product
  -- the same sales, which makes the "top products" table meaningless.
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
      -- ONE draw each, reused in `rolled` below. Chaining
      -- `when random() < a ... when random() < b ...` re-rolls on every branch,
      -- which silently turned an intended 85/6/3/6 status mix into 86/13/1/0.03.
      random() as r_status,
      random() as r_channel,
      -- Spread created_at uniformly across the window so a tick does not
      -- stamp every order with the same instant.
      p_from + (random() * (extract(epoch from (p_to - p_from)) || ' seconds')::interval
               ) as at
    from generate_series(1, p_count) gs(i)
  ),
  -- Inverse-CDF sample: walk the cumulative weights and take the first entry
  -- past the draw. LATERAL keeps it to one pass per draw.
  chosen as (
    select d.i, d.at, d.r_status, d.r_channel,
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
      -- ~62% embed / 38% marketplace, matching the seeded historical mix.
      case when c.r_channel < 0.62 then 'embed' else 'marketplace' end as channel,
      -- Cumulative thresholds on the SINGLE r_status draw: mostly paid, with
      -- enough refunds/disputes/pending that the status donut and the "needs
      -- attention" panel have something to show. paid 85 / refunded 6 /
      -- disputed 3 / pending 6.
      case
        when c.r_status < 0.85 then 'paid'
        when c.r_status < 0.91 then 'refunded'
        when c.r_status < 0.94 then 'disputed'
        else 'pending'
      end as status
    from chosen c
  )
  insert into public.orders (
    seller_id, product_id, storefront_id, channel, status,
    amount_cents, platform_fee_cents, currency,
    buyer_email, product_title, product_price_cents, created_at
  )
  select
    cfg.seller_id,
    r.product_id,
    case when r.channel = 'embed' then cfg.storefront_id else null end,
    r.channel,
    r.status,
    r.price_cents,
    round(r.price_cents * 0.05)::integer,   -- 5% platform take, integer cents
    cfg.currency,
    demo.pick_buyer(cfg.buyer_pool_size),
    r.title,
    r.price_cents,
    r.at
  from rolled r
  where r.product_id is not null;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- -----------------------------------------------------------------------------
-- demo.sales_sim_tick() : one cron beat. Emits the orders "owed" for the time
-- since the last tick, then prunes past the retention window.
-- -----------------------------------------------------------------------------
create or replace function demo.sales_sim_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg        demo.sales_sim%rowtype;
  v_from     timestamptz;
  v_minutes  numeric;
  v_expected numeric;
  v_count    integer;
  v_inserted integer := 0;
  v_pruned   integer := 0;
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

  -- Rolling retention, BEFORE emitting. This is the mechanism that bounds table
  -- growth, so it runs every tick rather than on a separate schedule someone can
  -- forget. Pruning first also matters for correctness: sales_sim_emit refuses
  -- to insert past `max_orders`, so pruning afterwards would let expired rows
  -- hold the cap closed and stall the simulator, which presents as exactly the
  -- "sales stopped" symptom this whole thing exists to prevent.
  -- Uses the existing (seller_id, created_at) index.
  delete from public.orders
   where seller_id = cfg.seller_id
     and created_at < p_now - (cfg.retention_days || ' days')::interval;
  get diagnostics v_pruned = row_count;

  v_count := demo.stochastic_round(v_expected);
  if v_count > 0 then
    v_inserted := demo.sales_sim_emit(v_count, v_from, p_now);
  end if;

  update demo.sales_sim
     set last_tick_at = p_now,
         last_tick_inserted = v_inserted,
         last_tick_pruned = v_pruned
   where id;

  return v_inserted;
end;
$$;

-- -----------------------------------------------------------------------------
-- demo.sales_sim_backfill(from, to) : fill a gap day by day using the same
-- shape model, so a period the simulator was switched off for does not read as
-- a cliff in the charts.
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
  cfg        demo.sales_sim%rowtype;
  v_day      date;
  v_count    integer;
  v_total    integer := 0;
  v_day_end  timestamptz;
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
      -- ::numeric because random() is double precision and numeric x double
      -- resolves to double, which does not match stochastic_round(numeric).
      * (0.7 + random() * 0.6)::numeric
    );
    -- Never emit into the future; today's partial day stops at now().
    v_day_end := least(v_day::timestamptz + interval '1 day' - interval '1 second', now());
    if v_day_end > v_day::timestamptz then
      v_total := v_total + demo.sales_sim_emit(v_count, v_day::timestamptz, v_day_end);
    end if;
  end loop;

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissions. service_role only -- nothing here is callable by a logged-in
-- user, let alone anon.
-- -----------------------------------------------------------------------------
revoke execute on function demo.sales_sim_emit(integer, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function demo.sales_sim_tick(timestamptz)
  from public, anon, authenticated;
revoke execute on function demo.sales_sim_backfill(date, date)
  from public, anon, authenticated;

grant usage on schema demo to service_role;
grant select, update on demo.sales_sim to service_role;
grant execute on function demo.sales_sim_tick(timestamptz) to service_role;
grant execute on function demo.sales_sim_backfill(date, date) to service_role;

-- -----------------------------------------------------------------------------
-- Schedule. Every 20 minutes: frequent enough that "recent orders" genuinely
-- moves while someone is looking at the dashboard, rare enough to be free.
-- A disabled config makes each beat an indexed single-row read and a return.
-- -----------------------------------------------------------------------------
select cron.unschedule('demo-sales-sim')
  where exists (select 1 from cron.job where jobname = 'demo-sales-sim');

select cron.schedule('demo-sales-sim', '*/20 * * * *', $cron$select demo.sales_sim_tick()$cron$);
