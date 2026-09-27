-- =============================================================================
-- Sign-in approval: finish signing in from a device that is already signed in
-- =============================================================================
-- WHAT A SELLER GETS. At the two-factor step, "Approve from your phone" shows a
-- QR code. Scanned with the phone's camera it opens Square Share on the phone,
-- where the seller is already signed in, and one tap on Approve finishes the
-- sign-in on the computer. Made for the case that prompted it: the computer
-- offers the browser's own "use a phone" passkey QR code, and the phone says it
-- has no passkey for Square Share because the passkey lives somewhere else.
--
-- HOW IT KEEPS aal2 MEANINGFUL. Exactly like passkeys
-- (20260925_passkey_factors): the approval is backed by an ordinary GoTrue
-- TOTP factor whose secret only the server knows, sealed under the Worker-only
-- MFA_PASSKEY_KEY. When a fully signed-in session (aal2) approves a request,
-- the server computes that factor's code and completes it FOR THE WAITING
-- SESSION ONLY, so GoTrue still issues aal2 and everything built on it (the app
-- gate, the restrictive RLS, step-up) applies unchanged.
--
-- WHY THE FACTOR IS COMPLETED BY THE WAITING SESSION, never by the approver.
-- GoTrue deletes every aal1 session of the account whenever ANY factor is
-- verified (InvalidateSessionsWithAALLessThan in verifyTOTPFactor). If the
-- phone verified anything while the computer waited, the computer would be
-- signed out. So the phone only ENROLS the factor the first time (an aal2
-- session may) and the computer verifies it (GoTrue checks assurance at enrol,
-- not at verify).
--
-- Three tables, all service role only, like mfa_recovery_codes and
-- mfa_passkeys: no client role may read, write or count any of them.
-- =============================================================================

-- ---- the factor ---------------------------------------------------------------
-- One per account. Cascades from its GoTrue factor, so a factor removed by ANY
-- route (Settings, a recovery code, the dashboard, account deletion) takes its
-- sealed secret with it.
create table if not exists public.mfa_approval_factors (
  factor_id     uuid primary key references auth.mfa_factors (id) on delete cascade,
  user_id       uuid not null unique references auth.users (id) on delete cascade,
  sealed_secret text not null
                check (sealed_secret ~ '^[A-Za-z0-9_-]+$' and char_length(sealed_secret) between 40 and 400),
  created_at    timestamptz not null default now()
);

comment on table public.mfa_approval_factors is
  'The GoTrue TOTP factor behind sign-in approval, one per account, its secret sealed under a Worker-only key. Service role only.';

-- ---- the off switch -------------------------------------------------------------
-- Approval is on for every account with 2FA unless it has a row here. A row
-- rather than a column on profiles: profiles is written by its owner through
-- PostgREST, and a way into the account must never be switched back on by a
-- request that did not pass step-up.
create table if not exists public.mfa_approval_opt_outs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.mfa_approval_opt_outs is
  'Accounts that turned sign-in approval off in Settings > Security. Service role only.';

-- ---- the requests ---------------------------------------------------------------
-- One per QR code shown. The token in the QR code is stored only as its
-- SHA-256; the request is bound to the waiting session, which is the only one
-- that may collect an approval.
create table if not exists public.mfa_sign_in_approvals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- GoTrue's session id (the token's session_id claim) of the session waiting
  -- at the two-factor step.
  session_id  uuid not null,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'denied', 'used', 'cancelled')),
  -- What the approving phone is shown about the waiting device. Coarse on
  -- purpose: a browser and system name and a country, never an address.
  browser     text check (char_length(browser) between 1 and 40),
  os          text check (char_length(os) between 1 and 40),
  country     text check (country ~ '^[A-Z]{2}$'),
  -- The approval factor the approver prepared for this request.
  factor_id   uuid references auth.mfa_factors (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  decided_at  timestamptz,
  used_at     timestamptz
);

comment on table public.mfa_sign_in_approvals is
  'Sign-in approval requests: a session at the two-factor step asks, a signed-in session of the same account approves or denies. Token stored hashed. Service role only.';

create index if not exists mfa_sign_in_approvals_user_idx
  on public.mfa_sign_in_approvals (user_id, created_at desc);
create index if not exists mfa_sign_in_approvals_session_idx
  on public.mfa_sign_in_approvals (session_id) where status = 'pending';

-- RLS on with ZERO policies = deny-all for every client role. The revokes are
-- what actually matter (new tables are auto-granted to anon and authenticated
-- here); RLS is the second lock on the same door.
alter table public.mfa_approval_factors enable row level security;
alter table public.mfa_approval_opt_outs enable row level security;
alter table public.mfa_sign_in_approvals enable row level security;
revoke all on public.mfa_approval_factors from anon, authenticated;
revoke all on public.mfa_approval_opt_outs from anon, authenticated;
revoke all on public.mfa_sign_in_approvals from anon, authenticated;
grant all on public.mfa_approval_factors to service_role;
grant all on public.mfa_approval_opt_outs to service_role;
grant all on public.mfa_sign_in_approvals to service_role;

notify pgrst, 'reload schema';
