-- ====================================================================
-- TWO-FACTOR AUTHENTICATION: database-level enforcement + recovery codes.
--
-- WHAT THIS IS FOR. Two-factor sign-in itself is Supabase Auth's native TOTP
-- MFA: once a person verifies an authenticator app, every session they start
-- is `aal1` (password, Google or magic link only) until they enter a code, at
-- which point GoTrue re-issues it as `aal2`. The app refuses to serve an `aal1`
-- session for an enrolled account (lib/auth/session.ts), but that is only half
-- of it. The publishable anon key ships to every browser, so someone who has
-- phished a password can ask GoTrue for an `aal1` token directly and talk to
-- PostgREST without ever loading a page of this app. Without the policies
-- below, that token reads the victim's address, VAT number, orders and buyer
-- emails, and can rewrite their catalogue.
--
-- HOW. `mfa_session_ok()` answers one question about the CALLER's own
-- session: "is this token good enough for this account?" True at `aal2`, and
-- true at `aal1` only when the account has no verified factor (2FA is optional,
-- so everyone who has not opted in keeps working exactly as before). A
-- RESTRICTIVE policy built on it is ANDed with every permissive policy on the
-- table, so it cannot widen access anywhere; it can only take it away from a
-- session that skipped its second factor.
--
-- WHICH TABLES. Everything the Store and the marketplace (SQ-app) read or
-- write with a user's JWT. Sessions for both are minted by this app's sign-in
-- page (SQ-app has no login of its own and shares the .squareshare.eu cookie),
-- so an `aal1` session for an enrolled account only ever exists while its
-- owner is on the 2FA challenge screen. The admin panel's own tables are left
-- alone on purpose: it signs staff in itself, and reads the shared tables
-- below with the service role, which RLS never applies to.
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor.
-- ====================================================================

-- ---- 1. Is this session good enough for this account? ---------------------
-- SECURITY DEFINER because `authenticated` has no read grant on auth.* tables.
-- No argument on purpose: the only account it can answer about is the one in
-- the caller's own JWT, so granting EXECUTE to `authenticated` discloses
-- nothing beyond "you have 2FA on", which the caller already knows.
--
-- A missing `aal` claim reads as aal1, matching GoTrue's own rule.
create or replace function public.mfa_session_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1
        from auth.mfa_factors f
        where f.user_id = auth.uid()
          and f.status = 'verified'
      )
$$;

-- Every function in this schema is auto-granted to anon and authenticated
-- (the PostgREST auto-grant trap), so the grant is set explicitly both ways.
revoke execute on function public.mfa_session_ok() from public, anon;
grant execute on function public.mfa_session_ok() to authenticated, service_role;

comment on function public.mfa_session_ok() is
  'True when the caller''s session satisfies their own 2FA setting: an aal2 token, or an aal1 token for an account with no verified MFA factor. Used by the restrictive "Require two-factor when enrolled" policies.';

-- ---- 2. The restrictive policies ------------------------------------------
-- One identical policy per table, created in a loop so the list is the only
-- thing to review. `(select ...)` makes Postgres evaluate the function ONCE per
-- statement (an initplan) rather than once per row.
--
-- Tables that do not exist are skipped rather than failing the migration: the
-- replica in tests/db and prod are both expected to carry every one of these,
-- and a missing one should be noticed by the RLS coverage test, not by a
-- half-applied migration.
do $$
declare
  t text;
  tables text[] := array[
    -- Store
    'profiles',
    'products',
    'storefronts',
    'orders',
    'team_members',
    'notifications',
    'security_events',
    'storefront_signals',
    -- Marketplace (SQ-app), written with the same user JWT
    'collections',
    'artifacts',
    'follows',
    'artifact_likes',
    'reports'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'two_factor_auth: skipping missing table public.%', t;
      continue;
    end if;
    execute format(
      'drop policy if exists "Require two-factor when enrolled" on public.%I', t);
    execute format(
      'create policy "Require two-factor when enrolled" on public.%I '
      'as restrictive for all to authenticated '
      'using ((select public.mfa_session_ok())) '
      'with check ((select public.mfa_session_ok()))', t);
  end loop;
end
$$;

-- ---- 3. Recovery codes ------------------------------------------------------
-- Supabase Auth has no recovery codes, so they live here. Only a salted
-- SHA-256 of each code is stored: the codes are 80 bits of CSPRNG output, so a
-- slow password hash buys nothing (there is no dictionary to slow down), and
-- the per-user salt (the user id, folded into the digest in
-- lib/auth/recovery-codes.ts) stops one precomputed table serving every
-- account. Single-use: `used_at` is set atomically by the consume function.
create table if not exists public.mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  code_hash  text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

comment on table public.mfa_recovery_codes is
  'Single-use 2FA recovery codes, stored as sha256(user_id:code). Service role only: no client role can read, write or even count them.';

create index if not exists mfa_recovery_codes_unused_idx
  on public.mfa_recovery_codes (user_id)
  where used_at is null;

-- RLS on with ZERO policies = deny-all for every client role. The revoke is
-- what actually matters (new tables are auto-granted to anon and
-- authenticated here), the RLS is the second lock on the same door.
alter table public.mfa_recovery_codes enable row level security;
revoke all on public.mfa_recovery_codes from anon, authenticated;
grant all on public.mfa_recovery_codes to service_role;

-- Replace a user's whole set in one transaction, so a failure part-way can
-- never leave them with half the codes they were just shown.
create or replace function public.mfa_replace_recovery_codes(
  p_user_id uuid,
  p_hashes  text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
     or p_hashes is null
     or cardinality(p_hashes) = 0
     or cardinality(p_hashes) > 20 then
    raise exception 'invalid recovery code batch';
  end if;

  delete from public.mfa_recovery_codes where user_id = p_user_id;

  insert into public.mfa_recovery_codes (user_id, code_hash)
  select p_user_id, h
  from unnest(p_hashes) as h;

  return cardinality(p_hashes);
end
$$;

-- Spend one code. A single UPDATE, so two requests racing on the same code
-- cannot both succeed: the second finds `used_at` already set.
create or replace function public.mfa_consume_recovery_code(
  p_user_id uuid,
  p_hash    text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with spent as (
    update public.mfa_recovery_codes
       set used_at = now()
     where user_id = p_user_id
       and code_hash = p_hash
       and used_at is null
    returning 1
  )
  select exists (select 1 from spent)
$$;

revoke execute on function public.mfa_replace_recovery_codes(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.mfa_consume_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function public.mfa_replace_recovery_codes(uuid, text[]) to service_role;
grant execute on function public.mfa_consume_recovery_code(uuid, text) to service_role;

-- ---- 4. SECURITY DEFINER functions a client can call ---------------------
-- The policies above do not reach inside a SECURITY DEFINER function: it
-- runs as its owner, which bypasses RLS. So every definer function that
-- `authenticated` may EXECUTE was audited, and each one that reads or writes
-- the caller's private data gets the same check at its own door. Found by an
-- adversarial pass over this migration: without it, a password-only token
-- could still read the team roster (member emails) straight off
-- /rest/v1/rpc/team_roster, accept invites, and spend the account's own
-- rate-limit budgets (for instance `password_reauth`, locking the owner out
-- of the password change they would make on seeing the lockout alert).
--
-- Bodies are the current definitions (pg_get_functiondef on the replayed
-- history) with one guard added each, nothing else changed. CREATE OR REPLACE
-- keeps the OID (RLS policies that call team_actor_role stay bound) and the
-- existing grants; the grants are restated anyway so the result does not
-- depend on what they were before (the auto-grant trap).
--
-- Left alone on purpose: is_squareshare_staff() and mfa_session_ok(), which
-- only answer a yes/no about the caller themselves.
--
-- BEFORE APPLYING TO PROD, compare each body with pg_get_functiondef on the
-- live database: these are Store-owned functions, but prod has been ahead of
-- this repo before.

-- The caller's role in `account`. Also the gate inside team_roster and inside
-- the team RLS policies, so guarding it here closes the roster too.
create or replace function public.team_actor_role(account uuid)
returns public.team_role
language sql
stable
security definer
set search_path = ''
as $$
  select tm.role
  from public.team_members tm
  where tm.account_owner_id = account
    and tm.member_user_id = (select auth.uid())
    and tm.status = 'active'
    and (select public.mfa_session_ok())
  limit 1
$$;

create or replace function public.team_my_accounts()
returns table(account_owner_id uuid, role public.team_role, store_name text, is_self boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tm.account_owner_id,
    tm.role,
    coalesce(nullif(btrim(p.username), ''), 'A SquareShare store') as store_name,
    (tm.account_owner_id = (select auth.uid())) as is_self
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.member_user_id = (select auth.uid())
    and tm.status = 'active'
    and (select public.mfa_session_ok())
  order by (tm.account_owner_id = (select auth.uid())) desc, store_name asc
$$;

create or replace function public.team_my_pending_invites()
returns table(id uuid, account_owner_id uuid, role public.team_role, invited_at timestamptz, store_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.id, tm.account_owner_id, tm.role, tm.invited_at,
         coalesce(p.username, 'A SquareShare store')
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.status = 'invited'
    and lower(tm.invited_email) = (select public.team_jwt_email())
    and (select public.mfa_session_ok())
  order by tm.invited_at desc
  limit 50
$$;

create or replace function public.team_accept_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.team_jwt_email();
  v_uid uuid := (select auth.uid());
  v_updated uuid;
begin
  if v_uid is null or v_email is null then
    return false; -- unauthenticated or no verified email
  end if;

  -- Joining a store is an account change: not from a session that still
  -- owes its second factor.
  if not public.mfa_session_ok() then
    return false;
  end if;

  update public.team_members
     set status = 'active',
         member_user_id = v_uid,
         accepted_at = now()
   where id = p_invite_id
     and status = 'invited'
     and lower(invited_email) = v_email  -- identity: this invite is addressed to me
     and role <> 'owner'
   returning id into v_updated;

  return v_updated is not null;
end
$$;

create or replace function public.rl_take(p_action text, p_max integer, p_window_seconds integer)
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

revoke execute on function public.team_actor_role(uuid) from public, anon;
revoke execute on function public.team_my_accounts() from public, anon;
revoke execute on function public.team_my_pending_invites() from public, anon;
revoke execute on function public.team_accept_invite(uuid) from public, anon;
revoke execute on function public.rl_take(text, integer, integer) from public, anon;
grant execute on function public.team_actor_role(uuid) to authenticated, service_role;
grant execute on function public.team_my_accounts() to authenticated, service_role;
grant execute on function public.team_my_pending_invites() to authenticated, service_role;
grant execute on function public.team_accept_invite(uuid) to authenticated, service_role;
grant execute on function public.rl_take(text, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
