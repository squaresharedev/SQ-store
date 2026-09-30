-- =============================================================================
-- Two-factor hardening (security sweep of 2026-09-30)
-- =============================================================================
-- 1. A second factor can only be completed THROUGH THE APP.
--    GoTrue's own verify endpoint is limited per IP address only (15 a minute)
--    and never locks an account, so anyone holding a password could guess
--    six-digit codes against it directly, from as many addresses as they
--    liked, past every budget and alert the app keeps (proven on production
--    with a throwaway account: twelve wrong codes, then the right one, aal2).
--    The same endpoint lets a stolen signed-in session switch on a factor of
--    its own without the step-up the app asks for.
--
--    The fix: GoTrue's Custom Access Token hook (available on every plan) runs
--    INSIDE the verify transaction. For a second-factor token it now demands a
--    single-use "intent" that only the app writes (service role), just before
--    it verifies, for that exact account and session. No intent, no token, and
--    GoTrue rolls the whole verify back: the challenge stays open and a new
--    factor stays unverified. A correct guess made outside the app is worth
--    nothing, and nobody can switch on a factor behind the app's back.
--
--    The hook is ENABLED separately in Auth > Hooks (Management API
--    hook_custom_access_token_*), after the app that writes intents is live.
--    Disabling it there is the kill switch.
--
-- 2. Sign-in approval gets number matching (match_code) and an explicit
--    opt-in (mfa_approval_opt_ins): passkey-only accounts no longer get it by
--    default, because an approval can be talked out of someone and a passkey
--    cannot.
--
-- 3. Staff tables require a fully verified (aal2) session. The admin panel
--    now requires 2FA; these rules stop a staff password alone from reading or
--    writing them through the public API.
-- =============================================================================

-- ---- 1. verify intents -------------------------------------------------------
create table if not exists public.mfa_verify_intents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- The session the app is completing a factor for (the token's session_id).
  session_id  uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

comment on table public.mfa_verify_intents is
  'Single-use permissions, written by the app (service role) just before it verifies a second factor, and spent by the custom access token hook. Without one, GoTrue refuses to issue a second-factor token. Service role only.';

create index if not exists mfa_verify_intents_lookup_idx
  on public.mfa_verify_intents (user_id, session_id, expires_at);

alter table public.mfa_verify_intents enable row level security;
revoke all on public.mfa_verify_intents from anon, authenticated;
grant all on public.mfa_verify_intents to service_role;

-- The hook. SECURITY DEFINER so it can spend an intent under RLS without a
-- policy for GoTrue's role; callable by GoTrue only.
create or replace function public.mfa_access_token_gate(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  method  text := event ->> 'authentication_method';
  uid     uuid;
  sid     uuid;
  spent   uuid;
begin
  -- Only tokens that CLAIM a second factor are gated. Password, link, OAuth
  -- and refresh tokens pass straight through, unchanged.
  if method is null or method not in (
    'totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn', 'mfa/recovery_code'
  ) then
    return jsonb_build_object('claims', event -> 'claims');
  end if;

  begin
    uid := (event ->> 'user_id')::uuid;
    sid := nullif(event -> 'claims' ->> 'session_id', '')::uuid;
  exception when others then
    uid := null;
  end;

  if uid is not null and sid is not null then
    delete from public.mfa_verify_intents
     where id = (
       select i.id
         from public.mfa_verify_intents i
        where i.user_id = uid
          and i.session_id = sid
          and i.expires_at > now()
        order by i.created_at
        limit 1
        for update skip locked
     )
    returning id into spent;
  end if;

  if spent is not null then
    return jsonb_build_object('claims', event -> 'claims');
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Two-factor verification must be completed in Square Share.'
    )
  );
end;
$$;

comment on function public.mfa_access_token_gate(jsonb) is
  'Custom Access Token hook: a second-factor token is issued only against a fresh single-use intent the app wrote for that account and session (mfa_verify_intents). Everything else passes through unchanged.';

revoke all on function public.mfa_access_token_gate(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.mfa_access_token_gate(jsonb) to supabase_auth_admin;
  end if;
end
$$;

-- ---- 2. sign-in approval: number matching and opt-in -------------------------
alter table public.mfa_sign_in_approvals
  add column if not exists match_code smallint
  check (match_code is null or match_code between 10 and 99);

comment on column public.mfa_sign_in_approvals.match_code is
  'The two-digit number the waiting device shows; the approving device must pick it. A wrong pick denies the request.';

create table if not exists public.mfa_approval_opt_ins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.mfa_approval_opt_ins is
  'Accounts that switched sign-in approval ON in Settings > Security (needed where it is off by default: passkey-only accounts). Service role only.';

alter table public.mfa_approval_opt_ins enable row level security;
revoke all on public.mfa_approval_opt_ins from anon, authenticated;
grant all on public.mfa_approval_opt_ins to service_role;

-- ---- 3. staff tables need aal2 -------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_users', 'admin_audit_log', 'admin_user_moderation',
    'admin_notification_prefs', 'admin_push_subscriptions'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "Staff need two-factor" on public.%I', t);
      execute format(
        'create policy "Staff need two-factor" on public.%I as restrictive for all to authenticated
           using ((select coalesce(auth.jwt() ->> %L, %L)) = %L)
           with check ((select coalesce(auth.jwt() ->> %L, %L)) = %L)',
        t, 'aal', 'aal1', 'aal2', 'aal', 'aal1', 'aal2'
      );
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';
