-- =============================================================================
-- Sign-up only through the app (security audit 2026-10-20)
-- =============================================================================
-- THE HOLE. Every sign-up guard (the disposable-address block, the Turnstile
-- bot check, the per-client sign-up budget, the breached-password check) runs
-- in the app's authenticate() action before it calls supabase.auth.signUp. But
-- that same GoTrue endpoint (/auth/v1/signup, and /auth/v1/otp with
-- create_user) answers anyone holding the public anon key, with no captcha and
-- no leaked-password check of its own. A script could skip all four guards and
-- open as many accounts on throwaway addresses as it liked, choosing its own
-- signup metadata.
--
-- THE FIX, the same shape as mfa_access_token_gate (20260930): the app writes a
-- single-use INTENT (service role) only after its guards pass, just before it
-- calls signUp, keyed on a hash of the address. GoTrue's Before User Created
-- hook, public.signup_intent_gate, runs before any new user row exists and
-- refuses an email sign-up that has no fresh intent for that address. A sign-up
-- sent to GoTrue by anything other than the app creates nothing.
--
-- What it does NOT gate:
--   - OAuth sign-ups (Google): the provider vouches for the address, and the
--     app's bot check never applied to them.
--   - Existing accounts signing in: the hook only runs when a user is about to
--     be CREATED.
--
-- ROLLOUT, in this order (the hook demands what only the new build writes):
--   1. Apply this migration. Inert on its own: nothing calls the function yet.
--   2. Deploy the app that writes intents (src/lib/auth/signup-intent.ts).
--   3. Enable the hook: Auth > Hooks > Before User Created, Postgres function
--      public.signup_intent_gate (Management API: hook_before_user_created_
--      enabled=true, hook_before_user_created_uri=
--      pg-functions://postgres/public/signup_intent_gate).
--   Disabling the hook there is the kill switch.
--
-- Anything else that ever creates EMAIL users (an admin tool calling
-- auth.admin.createUser, a seed script against production) must write an
-- intent first, or switch the hook off for the run.
-- =============================================================================

create table if not exists public.signup_intents (
  id          uuid primary key default gen_random_uuid(),
  -- sha256 of the lower-cased address, hex. The address itself is never kept.
  email_hash  text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

comment on table public.signup_intents is
  'Single-use permissions to create an email account, written by the app (service role) after its sign-up guards pass and spent by the before-user-created hook (signup_intent_gate). Keyed on sha256(lower(email)). Service role only.';

create index if not exists signup_intents_lookup_idx
  on public.signup_intents (email_hash, expires_at);

alter table public.signup_intents enable row level security;
revoke all on public.signup_intents from public, anon, authenticated;
grant all on public.signup_intents to service_role;

-- The hook. SECURITY DEFINER so it can spend an intent under RLS without a
-- policy for GoTrue's role; callable by GoTrue only.
create or replace function public.signup_intent_gate(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider text := lower(coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', 'email'));
  email    text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
  spent    uuid;
begin
  -- Anonymous users are switched off for this project; never create one here.
  if coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Sign up on Square Share.'));
  end if;

  -- An OAuth provider vouches for its own users.
  if provider not in ('email', 'phone') then
    return '{}'::jsonb;
  end if;

  if email <> '' then
    delete from public.signup_intents
     where id = (
       select i.id
         from public.signup_intents i
        where i.email_hash = encode(sha256(convert_to(email, 'UTF8')), 'hex')
          and i.expires_at > now()
        order by i.created_at
        limit 1
        for update skip locked
     )
    returning id into spent;
  end if;

  if spent is not null then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'Sign up on Square Share.'));
end;
$$;

comment on function public.signup_intent_gate(jsonb) is
  'Before User Created hook: an email account is created only against a fresh single-use intent the app wrote after its sign-up guards passed (signup_intents). OAuth sign-ups pass through.';

revoke all on function public.signup_intent_gate(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.signup_intent_gate(jsonb) to supabase_auth_admin;
  end if;
end
$$;

notify pgrst, 'reload schema';
