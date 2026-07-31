-- =============================================================================
-- Rate limiting: replace the FIXED-window counter with an EXACT SLIDING window.
--
-- WHY. The previous rl_take stored (window_start, count) and hard-reset the
-- count once window_start aged past the window. That let a caller spend a full
-- budget at the very end of one window and another full budget seconds later:
--
--   window = 1h, max = 5
--   20:00         take #1       -> window_start = 20:00, count = 1
--   20:58..20:59  takes #2..#5  -> count = 5 (budget spent)
--   21:01         window_start (20:00) is now older than 1h -> count RESETS to 1
--   21:01..21:02  4 more takes  -> count = 5
--   => 9 sends inside ~3 minutes against a "5 per hour" limit.
--
-- (The window was anchored to the FIRST take rather than the clock, so the
-- reset lands an hour after the window opened — but the burst is the same:
-- spend the budget just before the boundary, spend it again just after.)
--
-- A sliding window has no boundary to reset across: every take counts the hits
-- in the PRECEDING p_window_seconds, continuously.
--
-- HOW. Sliding window LOG: keep the timestamp of each allowed hit, prune the
-- ones older than the window, and allow only if fewer than p_max remain. This
-- is exact (no approximation), and storage is provably bounded: a timestamp is
-- appended ONLY when the take is allowed, and a take is allowed only while
-- fewer than p_max unpruned entries exist — so the array never exceeds p_max.
-- =============================================================================

-- --- Authenticated limiter (keyed on auth.uid()) -----------------------------

-- Swap the counter columns for the hit log. The old columns are dropped, not
-- left dangling: nothing outside rl_take ever read them.
alter table public.rate_limits
  add column if not exists hits timestamptz[] not null default '{}';
alter table public.rate_limits drop column if exists window_start;
alter table public.rate_limits drop column if exists count;

comment on table public.rate_limits is
  'Sliding-window rate limit state per (user, action). `hits` holds the timestamp of each ALLOWED take inside the window; entries older than the window are pruned on the next take. Written only by rl_take() (SECURITY DEFINER); RLS is on with no policies so clients can never read or forge it.';

create or replace function public.rl_take(
  p_action text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := (select auth.uid());
  cutoff timestamptz;
  kept   timestamptz[];
  allowed boolean;
begin
  -- Anonymous callers get nothing: this limiter is identity-scoped by design.
  -- Unauthenticated surfaces must use rl_take_key() instead.
  if uid is null then
    return false;
  end if;

  -- Reject nonsense budgets rather than failing open.
  if p_max is null or p_max < 1 then
    return false;
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  cutoff := now() - make_interval(secs => p_window_seconds);

  -- Ensure a row exists so the lock below always has one to take.
  insert into public.rate_limits (user_id, action)
  values (uid, p_action)
  on conflict (user_id, action) do nothing;

  -- Serialize concurrent takes for this (user, action) so two requests can
  -- never both read "4 hits" and both append a 5th.
  perform 1
  from public.rate_limits
  where user_id = uid and action = p_action
  for update;

  -- Prune to the trailing window, then decide.
  select coalesce(
           array(
             select t
             from unnest(r.hits) as t
             where t > cutoff
             order by t
           ),
           '{}'::timestamptz[]
         )
  into kept
  from public.rate_limits r
  where r.user_id = uid and r.action = p_action;

  allowed := coalesce(array_length(kept, 1), 0) < p_max;

  -- Only an ALLOWED take is recorded. Denied attempts must not extend the
  -- window, or a caller hammering the endpoint could lock themselves out
  -- indefinitely (and grow the array without bound).
  if allowed then
    kept := kept || now();
  end if;

  update public.rate_limits
  set hits = kept
  where user_id = uid and action = p_action;

  return allowed;
end
$$;

revoke execute on function public.rl_take(text, integer, integer) from public, anon;
grant execute on function public.rl_take(text, integer, integer) to authenticated, service_role;

-- --- Anonymous / arbitrary-key limiter ---------------------------------------
-- For surfaces with no auth.uid() yet: sending a magic link, a password-reset
-- email, or signing up. Those are the email-bombing vectors — an attacker can
-- point them at someone else's inbox — so they need a limit keyed on something
-- other than the (absent) session.
--
-- The key is supplied by the caller, so this function is SERVICE_ROLE ONLY.
-- If `authenticated`/`anon` could call it, a client would simply pass a random
-- key each time and bypass the limit entirely. Callers pass a SHA-256 hash
-- (see lib/rate-limit.ts) so raw emails and IPs are never stored here.

create table if not exists public.rate_limit_keys (
  key        text not null,
  action     text not null,
  hits       timestamptz[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (key, action)
);

comment on table public.rate_limit_keys is
  'Sliding-window rate limit state for UNAUTHENTICATED surfaces, keyed by an opaque caller-supplied hash (hashed email or IP — never the raw value). Written only by rl_take_key() (SECURITY DEFINER, service_role only).';

alter table public.rate_limit_keys enable row level security;
-- No policies on purpose: definer function + service_role only.

create index if not exists rate_limit_keys_updated_at_idx
  on public.rate_limit_keys (updated_at);

create or replace function public.rl_take_key(
  p_key text,
  p_action text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  kept   timestamptz[];
  allowed boolean;
begin
  if p_key is null or length(p_key) = 0 then
    return false;
  end if;
  if p_max is null or p_max < 1 then
    return false;
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  cutoff := now() - make_interval(secs => p_window_seconds);

  insert into public.rate_limit_keys (key, action)
  values (p_key, p_action)
  on conflict (key, action) do nothing;

  perform 1
  from public.rate_limit_keys
  where key = p_key and action = p_action
  for update;

  select coalesce(
           array(
             select t
             from unnest(r.hits) as t
             where t > cutoff
             order by t
           ),
           '{}'::timestamptz[]
         )
  into kept
  from public.rate_limit_keys r
  where r.key = p_key and r.action = p_action;

  allowed := coalesce(array_length(kept, 1), 0) < p_max;
  if allowed then
    kept := kept || now();
  end if;

  update public.rate_limit_keys
  set hits = kept, updated_at = now()
  where key = p_key and action = p_action;

  return allowed;
end
$$;

-- service_role ONLY — see the note above about forgeable keys.
revoke execute on function public.rl_take_key(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rl_take_key(text, text, integer, integer)
  to service_role;

-- Housekeeping: rows for keys nobody has touched in a day are dead weight
-- (the hit log inside them has long since aged out of any window we use).
create or replace function public.rl_gc_keys()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.rate_limit_keys
    where updated_at < now() - interval '1 day'
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.rl_gc_keys() from public, anon, authenticated;
grant execute on function public.rl_gc_keys() to service_role;
