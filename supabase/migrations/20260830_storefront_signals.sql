-- =============================================================================
-- STOREFRONT SIGNALS: one event stream for every non-order thing a seller
-- measures, and the aggregate that reads it.
--
-- WHY A STREAM RATHER THAN A TABLE PER FEATURE. Analytics today is orders and
-- only orders: `analytics_aggregate` scans public.orders and every figure on
-- the page is derived from a sale. The product is about to grow surfaces that
-- are not sales, an email signup block, a calendar booking block, and each
-- one arriving as its own table, its own aggregate, its own query module and
-- its own page section is four new things to keep in sync per feature, forever.
--
-- So the shape is a SIGNAL: one row = one thing that happened on a seller's
-- storefront, tagged with a `kind`. Adding "bookings" then means adding a kind
-- to the vocabulary below and a producer that writes rows. The aggregate,
-- the query layer, the registry and the page section all already handle it,
-- because none of them are written per-kind. See src/lib/analytics/sources.ts,
-- which is the mirror of the vocabulary here.
--
-- ORDERS STAY WHERE THEY ARE. A sale is not a signal: it carries money,
-- refunds, a buyer identity and a status lifecycle, and it is the system of
-- record for getting paid. Duplicating it here would create two answers to
-- "how much did I earn". Revenue keeps coming from `analytics_aggregate`; this
-- covers everything that is NOT a sale.
--
-- SECURITY MODEL. Reads are SECURITY INVOKER + RLS, exactly like the orders
-- aggregate: the owner path and the team path (`store.read`) are the same two
-- clauses used on orders/products/storefronts. Writes have NO policy at all,
-- so no client-facing role can insert, production goes through the service
-- role in the ingest route, which is where the rate limit and the validation
-- live. A public surface that could write its own analytics rows is a public
-- surface that can inflate them.
--
-- PRIVACY. There is no raw IP, no email, no user agent and no cookie here.
-- `visitor_hash` is a salted digest computed in the app, used only for
-- distinct-counting within a day; `metadata` is bounded and must never be
-- given personal data (the ingest route allowlists what may go in it).
--
-- TIME. UTC throughout, matching 20260802_analytics_sql_aggregates.sql.
-- Weekday numbers are ISO (1 = Monday .. 7 = Sunday).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The stream
-- -----------------------------------------------------------------------------
create table if not exists public.storefront_signals (
  id            bigint generated always as identity primary key,

  -- The SELLER whose analytics this belongs to. Named account_id rather than
  -- seller_id because team members read it too, and it is the same id
  -- getActiveAccount() resolves (see docs/agent-surface.md B2).
  account_id    uuid not null references public.profiles(id) on delete cascade,

  -- Which storefront produced it. Nullable and ON DELETE SET NULL: deleting a
  -- storefront must not silently rewrite last quarter's totals.
  storefront_id uuid references public.storefronts(id) on delete set null,

  -- The vocabulary. Additive: new kinds are added to this CHECK and to
  -- SIGNAL_KINDS in src/lib/analytics/signals.ts, in the same change.
  --   storefront_view: the embed payload was served to a visitor
  --   product_click:   a visitor opened a product from a storefront
  --   email_signup:    a visitor joined a seller's list from a storefront
  --   booking:         a visitor booked a slot from a storefront
  kind          text not null
    check (kind in ('storefront_view','product_click','email_signup','booking')),

  -- Where it happened. Mirrors orders.channel plus 'direct' for the hosted
  -- storefront, which has no order equivalent yet.
  channel       text not null default 'embed'
    check (channel in ('embed','marketplace','direct')),

  -- The block that produced it, when there is one (storefront blocks carry a
  -- string id). Free text rather than a foreign key: blocks live inside a jsonb
  -- config, so there is nothing to reference.
  block_id      text check (block_id is null or char_length(block_id) <= 64),

  -- Salted digest of the visitor, for distinct counts. NEVER an identifier we
  -- can reverse: see the privacy note in the header.
  visitor_hash  text check (visitor_hash is null or char_length(visitor_hash) = 64),

  -- Money a signal is worth, when it is worth money (a paid booking). Integer
  -- cents, like everywhere else in this schema. Null = not a money signal.
  value_cents   integer check (value_cents is null or value_cents >= 0),
  currency      text check (currency is null or char_length(currency) = 3),

  -- Idempotency for the ingest route: a retried delivery collides instead of
  -- double-counting. Null = the producer did not offer one.
  dedupe_key    text check (dedupe_key is null or char_length(dedupe_key) <= 128),

  occurred_at   timestamptz not null default now(),

  -- Bounded, and allowlisted by the ingest route. Personal data must not land
  -- here: the whole table is designed so that it never needs to.
  metadata      jsonb not null default '{}'
    check (pg_column_size(metadata) <= 2048)
);

comment on table public.storefront_signals is
  'Non-order analytics events for a seller storefront (views, clicks, email signups, bookings). Service-role writes only via the ingest route; read by owner + team via RLS. Orders remain the system of record for revenue.';
comment on column public.storefront_signals.visitor_hash is
  'Salted SHA-256 digest used only for distinct-visitor counts. Never a reversible identifier, never an IP or an email.';
comment on column public.storefront_signals.value_cents is
  'Integer cents, when a signal carries money (a paid booking). Null for signals that do not.';

-- The aggregate's hot path: one account, one kind, a date window.
create index if not exists storefront_signals_account_kind_occurred_idx
  on public.storefront_signals (account_id, kind, occurred_at);

-- The unfiltered window scan (totals across every kind at once).
create index if not exists storefront_signals_account_occurred_idx
  on public.storefront_signals (account_id, occurred_at desc);

-- Idempotent ingest. Partial, so the common "no dedupe key" case costs nothing.
create unique index if not exists storefront_signals_dedupe_idx
  on public.storefront_signals (account_id, dedupe_key)
  where dedupe_key is not null;

-- -----------------------------------------------------------------------------
-- RLS: read like orders, write like notifications (i.e. not at all from a client)
-- -----------------------------------------------------------------------------
alter table public.storefront_signals enable row level security;

drop policy if exists storefront_signals_select_member on public.storefront_signals;
create policy storefront_signals_select_member
  on public.storefront_signals
  for select
  to authenticated
  using (
    account_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(account_id), 'store.read')
  );

-- No insert/update/delete policy exists, and none should: RLS denies all three
-- to every client-facing role. The revokes below are belt-and-braces on top of
-- that, because Supabase's default privileges would otherwise grant table
-- access to anon and authenticated.
revoke insert, update, delete, truncate on table public.storefront_signals
  from anon, authenticated;
revoke all on table public.storefront_signals from anon;
revoke all on sequence public.storefront_signals_id_seq from anon, authenticated;
grant select on table public.storefront_signals to authenticated;

-- -----------------------------------------------------------------------------
-- storefront_signals_aggregate: every non-order figure the analytics page
-- renders, for every kind, in one call.
--
-- Deliberately NOT parameterised by kind. The page draws a section per source
-- and would otherwise make one round trip per source, growing with the feature
-- list; the whole payload here is a few hundred bytes because it is already
-- grouped. Kinds with no rows simply do not appear, and the app fills the
-- zeros (same division of labour as analytics_aggregate).
--
-- p_from / p_to are inclusive ISO dates; null = unbounded.
-- -----------------------------------------------------------------------------
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
  -- Per-storefront ranking. The join is RLS-filtered like everything else here,
  -- so a storefront the caller cannot read contributes a null name rather than
  -- leaking one; the app renders those as "Deleted storefront".
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

comment on function public.storefront_signals_aggregate(uuid, date, date) is
  'Every non-order analytics figure for one account and date window, grouped by signal kind, as jsonb. SECURITY INVOKER: RLS on storefront_signals is the boundary, so a forged account id returns nothing.';

-- -----------------------------------------------------------------------------
-- Permissions. Signed-in app callers and the service role; never anon.
--
-- Re-stated explicitly because Supabase re-grants execute to anon/authenticated
-- every time a function is created or replaced (see the PostgREST auto-grant
-- trap). A `create or replace` on this function without these two lines
-- silently reopens it.
-- -----------------------------------------------------------------------------
revoke execute on function public.storefront_signals_aggregate(uuid, date, date)
  from public, anon;
grant execute on function public.storefront_signals_aggregate(uuid, date, date)
  to authenticated, service_role;
