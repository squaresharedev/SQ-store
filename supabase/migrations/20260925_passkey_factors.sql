-- =============================================================================
-- Passkeys as the second factor
-- =============================================================================
-- WHAT A SELLER GETS. Two-factor authentication without installing an app:
-- Face ID, a fingerprint, or (on a computer) the browser's QR code scanned
-- with the phone's own camera. Authenticator apps stay available beside it.
--
-- WHY THIS SHAPE, and not Supabase's own passkeys:
--   * Supabase Auth's WebAuthn MFA factor is not available on hosted projects
--     (the Management API answers "Enabling of MFA with WebAuthn not currently
--     supported", checked 2026-09-25).
--   * Its passkey SIGN-IN is a first factor. Anyone holding the password could
--     register their own passkey through GoTrue and walk past a second step
--     built on it.
--
-- So each passkey is backed by an ordinary GoTrue TOTP factor whose secret
-- only the server knows. A verified passkey assertion is what makes the server
-- compute the current code and hand it to GoTrue. GoTrue therefore still
-- issues aal2, still refuses factor, password and email changes to aal1
-- sessions, and everything built on aal2 (the app gate, the restrictive RLS,
-- step-up, recovery codes) applies unchanged.
--
-- This table holds, per passkey, the WebAuthn public key and counter, and the
-- TOTP secret SEALED with AES-GCM under a key that exists only in the Worker
-- (MFA_PASSKEY_KEY), bound to the user and factor. A dump of the table cannot
-- mint a code. Service role only, like mfa_recovery_codes.
--
-- Lengths are checked with char_length, not a regex {m,n}: Postgres caps a
-- regex repeat count at 255, and a larger bound only fails when a row is
-- written, not when the table is created.
create table if not exists public.mfa_passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- The GoTrue factor this passkey unlocks. Cascades, so a factor removed by
  -- ANY route (Settings, a recovery code, the dashboard, account deletion)
  -- takes its passkey with it and can never leave a key that unlocks nothing.
  factor_id     uuid not null unique references auth.mfa_factors (id) on delete cascade,
  credential_id text not null unique
                check (credential_id ~ '^[A-Za-z0-9_-]+$' and char_length(credential_id) between 16 and 1400),
  public_key    text not null
                check (public_key ~ '^[A-Za-z0-9_-]+$' and char_length(public_key) between 16 and 2000),
  sign_count    bigint not null default 0 check (sign_count >= 0),
  transports    text[] not null default '{}'
                check (transports <@ array['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']::text[]),
  backed_up     boolean not null default false,
  sealed_secret text not null
                check (sealed_secret ~ '^[A-Za-z0-9_-]+$' and char_length(sealed_secret) between 40 and 400),
  name          text not null check (char_length(name) between 1 and 40),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

comment on table public.mfa_passkeys is
  'Passkeys used as the second factor. Each unlocks one GoTrue TOTP factor whose secret is sealed here under a Worker-only key. Service role only: no client role can read, write or count them.';

create index if not exists mfa_passkeys_user_idx on public.mfa_passkeys (user_id);

-- RLS on with ZERO policies = deny-all for every client role. The revoke is
-- what actually matters (new tables are auto-granted to anon and
-- authenticated here), the RLS is the second lock on the same door.
alter table public.mfa_passkeys enable row level security;
revoke all on public.mfa_passkeys from anon, authenticated;
grant all on public.mfa_passkeys to service_role;

notify pgrst, 'reload schema';
