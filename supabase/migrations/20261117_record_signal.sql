-- =============================================================================
-- RECORD SIGNAL RPC: on-conflict-do-nothing write path for storefront_signals.
--
-- WHY THIS EXISTS. The plain .insert() path in src/lib/analytics/record.ts
-- writes a heap row and three index entries, then aborts with 23505 on every
-- repeat visit within the dedupe window. Each abort burns a transaction id,
-- produces dead tuples for autovacuum, emits an ERROR in the Postgres log,
-- and costs a 409 round trip back to the app.
--
-- ON CONFLICT DO NOTHING checks the arbiter index (the existing partial unique
-- on (account_id, dedupe_key) where dedupe_key is not null) before touching
-- the heap. A repeat visit costs one index probe and returns without writing
-- anything.
--
-- RETURNS. true: a row was written. false: the arbiter index matched and the
-- insert was skipped (duplicate). A null dedupe_key bypasses the unique index,
-- so those calls always return true.
--
-- SECURITY. SECURITY INVOKER: the function runs with the caller's grants.
-- Only service_role can execute it (see the grant below), and service_role
-- bypasses RLS, so the insert reaches the table. Never call this from a
-- client-facing role: there is no insert policy for anon or authenticated on
-- storefront_signals.
--
-- Production apply notes:
--   * This migration runs entirely inside a transaction (one new function and
--     two permission statements). No index builds, no table rewrites.
--   * Apply with: supabase db push --linked, or paste into the SQL editor.
--   * The app falls back to the plain insert path if the function is not found
--     (PostgREST PGRST202), so the code can be deployed before this migration
--     without data loss.
-- =============================================================================

create or replace function public.record_signal(
  p_account_id    uuid,
  p_kind          text,
  p_channel       text       default 'embed',
  p_storefront_id uuid       default null,
  p_block_id      text       default null,
  p_visitor_hash  text       default null,
  p_value_cents   integer    default null,
  p_currency      text       default null,
  p_dedupe_key    text       default null,
  p_metadata      jsonb      default '{}'
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  -- true when the row was written, false when the unique arbiter skipped it.
  -- The CTE is always executed because the outer SELECT references it.
  with ins as (
    insert into public.storefront_signals (
      account_id, kind, channel, storefront_id, block_id,
      visitor_hash, value_cents, currency, dedupe_key, metadata
    )
    values (
      p_account_id, p_kind, p_channel, p_storefront_id, p_block_id,
      p_visitor_hash, p_value_cents, p_currency, p_dedupe_key, p_metadata
    )
    on conflict (account_id, dedupe_key) where dedupe_key is not null
    do nothing
    returning 1
  )
  select exists (select 1 from ins);
$$;

comment on function public.record_signal(uuid,text,text,uuid,text,text,integer,text,text,jsonb) is
  'Insert one storefront signal via ON CONFLICT DO NOTHING. Returns true when written, false when dedupe_key matched the partial unique index. SECURITY INVOKER: only service_role may call it.';

-- -----------------------------------------------------------------------------
-- Permissions. Service-role only: no client-facing role may write analytics
-- rows directly (see 20260830_storefront_signals.sql for the security model).
--
-- Re-stated explicitly because Supabase re-grants execute to anon/authenticated
-- on every create or replace (the PostgREST auto-grant trap). Without these
-- lines a replace would silently reopen the function.
-- -----------------------------------------------------------------------------
revoke execute on function public.record_signal(uuid,text,text,uuid,text,text,integer,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_signal(uuid,text,text,uuid,text,text,integer,text,text,jsonb)
  to service_role;

notify pgrst, 'reload schema';
