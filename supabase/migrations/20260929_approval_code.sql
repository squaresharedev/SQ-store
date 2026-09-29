-- =============================================================================
-- Sign-in approval: the approving device hands over ONE short-lived code
-- =============================================================================
-- Until now the WAITING device opened the approval factor's sealed secret and
-- computed the code itself, so every server that can complete an approval had
-- to hold the same MFA_PASSKEY_KEY. A local dev server (its own key) could not
-- finish a sign-in that the live site approved.
--
-- Now the APPROVING side, which already holds the key, computes a single
-- 6-digit code at the moment of approval and leaves it on the request. The
-- waiting device spends it once, within seconds, at GoTrue. It never sees the
-- secret, and a leaked row is worth one code for under a minute, not the factor.
--
-- Cleared as it is spent and left to expire otherwise; the table is service
-- role only (20260927_sign_in_approvals), so no client can read it.
alter table public.mfa_sign_in_approvals
  add column if not exists approval_code text
  check (approval_code is null or approval_code ~ '^[0-9]{6}$');

comment on column public.mfa_sign_in_approvals.approval_code is
  'The one TOTP code the approving device computed for the approval factor. Valid for about a minute; cleared when spent. Service role only.';

notify pgrst, 'reload schema';
