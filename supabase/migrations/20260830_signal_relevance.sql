-- =============================================================================
-- SIGNAL RELEVANCE: only show a seller the sources that are actually theirs.
--
-- WHY. The first cut of the source registry rendered EVERY registered kind,
-- including the ones with no producer yet, as a "coming soon" band. On a
-- seller's page that reads as a roadmap they did not ask for: someone with no
-- booking block has no reason to scroll past a bookings section, and the
-- placeholder pushes the numbers they came for further down the page.
--
-- So the page needs to know two things the range-scoped aggregate cannot tell
-- it, and both are added to storefront_signals_aggregate here rather than
-- costing two more round trips:
--
--   all_time_kinds     - which kinds this account has EVER recorded. Range
--                        scoped counts are the wrong test for visibility: a
--                        seller with signups last quarter should not watch the
--                        section disappear when they switch to "last 30 days".
--
--   active_block_types - which block types exist on their storefronts. This is
--                        the real "do I have that embed" question, and it is
--                        what makes the page correct BEFORE the first event:
--                        add an email signup block and the section is there,
--                        empty and waiting, rather than appearing only once a
--                        stranger has already signed up.
--
-- Additive: same signature, same existing keys, two new ones. Callers that do
-- not read them are unaffected.
-- =============================================================================

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
  'all_time_kinds', coalesce((
    select jsonb_agg(distinct kind)
    from public.storefront_signals
    where account_id = p_account_id
  ), '[]'::jsonb),
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
