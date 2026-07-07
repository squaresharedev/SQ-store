-- A user's display_name is their one name field AND their public handle —
-- no separate username column. Enforce case-insensitive uniqueness directly
-- on display_name so no two users can share one (case-insensitive).

-- Partial (WHERE display_name IS NOT NULL) so accounts that haven't set a
-- name yet don't collide with each other.
create unique index profiles_display_name_lower_idx
  on public.profiles (lower(display_name))
  where display_name is not null;

-- Availability check used by the settings UI. SECURITY DEFINER so it can see
-- across all profiles regardless of the caller's own RLS scope, while only
-- ever returning a boolean — never row data. auth.uid() is read from the
-- caller's own JWT (set per-request by PostgREST), so a signed-in user always
-- excludes their own row and can never spoof a different exclusion target.
create or replace function public.is_display_name_available(p_display_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles
    where lower(display_name) = lower(p_display_name)
      and id <> auth.uid()
  );
$$;

revoke all on function public.is_display_name_available(text) from public;
grant execute on function public.is_display_name_available(text) to authenticated;

-- This project's public schema auto-grants EXECUTE to `anon` on new
-- functions (a default-privileges rule), so the plain `revoke ... from
-- public` above doesn't reach it — anon needs an explicit revoke or the RPC
-- is reachable straight through PostgREST, unauthenticated, bypassing the
-- route handler's auth gate entirely. Confirmed via the security advisor.
revoke execute on function public.is_display_name_available(text) from anon;
