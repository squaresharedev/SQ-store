-- rl_take: a caller can no longer erase their own rate-limit history.
--
-- THE HOLE (security audit 2026-10-20). rl_take is callable by `authenticated`
-- straight through PostgREST (POST /rest/v1/rpc/rl_take), and it took the
-- WINDOW from its caller. It pruned the stored hits to that window and wrote
-- the pruned array back. So one direct call with p_window_seconds = 1 deleted
-- every hit older than a second, and the server's own next check (which passes
-- the real budget from lib/rate-limit.ts RATE_LIMITS) found an empty log.
-- Every per-user limit built on rateLimit() could be reset at will: team
-- invites (mail to arbitrary addresses), badge checks (paid classifier calls),
-- password re-checks, email changes, contact-code sends, imports, uploads,
-- exports. Keyed limits (rl_take_key, service role only) were never affected.
--
-- THE FIX. Counting still uses the caller's window, exactly as before, so every
-- existing call behaves the same. What changes is what is STORED:
--   - hits are kept for at least RETENTION (24 h, the longest per-user window
--     in RATE_LIMITS: contactCodeSendDaily, mfaVerifyPerUserDaily), or for the
--     caller's window when that is longer, so no window a caller names can
--     forget a hit a real budget still needs;
--   - the stored log is capped at the MAX_KEPT most recent hits, so a caller
--     who passes an enormous p_max to a direct call can only grow their own
--     log so far (and every hit they add counts against them, never for them).
-- A direct call can therefore only ever ADD to the caller's own count.
--
-- If a budget with a window longer than 24 h is ever added to RATE_LIMITS,
-- raise RETENTION here to match (tests/integration/11 pins the reset case).
-- Same signature and grants as before, so this applies safely ahead of any
-- deploy and needs no code change.

create or replace function public.rl_take(p_action text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- How long a hit is remembered no matter what window a caller names.
  retention_seconds constant integer := 86400;
  -- The most hits a log may hold. Far above any per-user budget's max.
  max_kept constant integer := 5000;
  uid    uuid := (select auth.uid());
  cutoff timestamptz;
  keep_after timestamptz;
  kept   timestamptz[];
  counted integer;
  allowed boolean;
begin
  -- Anonymous callers get nothing: this limiter is identity-scoped by design.
  -- Unauthenticated surfaces must use rl_take_key() instead.
  if uid is null then
    return false;
  end if;

  -- Nor does a session that still owes its second factor. Otherwise someone
  -- holding only the password could drain the account's budgets (and deny
  -- the owner the very actions they reach for when they see the alert).
  if not public.mfa_session_ok() then
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
  keep_after := now() - make_interval(secs => greatest(p_window_seconds, retention_seconds));

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

  -- Prune to the RETENTION horizon (never to the caller's window), then count
  -- only the hits inside the caller's window.
  select coalesce(
           array(
             select t
             from unnest(r.hits) as t
             where t > keep_after
             order by t
           ),
           '{}'::timestamptz[]
         )
  into kept
  from public.rate_limits r
  where r.user_id = uid and r.action = p_action;

  select count(*) into counted from unnest(kept) as t where t > cutoff;
  allowed := counted < p_max;

  -- Only an ALLOWED take is recorded. Denied attempts must not extend the
  -- window, or a caller hammering the endpoint could lock themselves out
  -- indefinitely (and grow the array without bound).
  if allowed then
    kept := kept || now();
  end if;

  -- Keep the newest MAX_KEPT. Dropping the oldest can only ever lower a count
  -- that is already far past every budget.
  if coalesce(array_length(kept, 1), 0) > max_kept then
    kept := kept[array_length(kept, 1) - max_kept + 1 : array_length(kept, 1)];
  end if;

  update public.rate_limits
  set hits = kept
  where user_id = uid and action = p_action;

  return allowed;
end
$$;

-- CREATE OR REPLACE keeps existing grants, but restate them: this schema
-- auto-grants new functions to anon, and the limiter must never be anon's.
revoke execute on function public.rl_take(text, integer, integer) from public, anon;
grant execute on function public.rl_take(text, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
