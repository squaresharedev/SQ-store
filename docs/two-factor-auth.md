# Two-factor authentication

Optional for every account, and actively recommended. Built on Supabase Auth's
native TOTP MFA (authenticator apps), with recovery codes added in-app because
Supabase has none.

Supabase project: **SQ-store**, ref `vnyfndqpdllwhvhinjoi`.

## Before deploying

Do these in this order. The code degrades safely without them, but not fully:
without the migration there are no recovery codes and no database-level
enforcement.

1. **Apply the migration** `supabase/migrations/20260923_two_factor_auth.sql`
   (Supabase MCP `apply_migration`, or the SQL editor). It adds
   `mfa_session_ok()`, the restrictive "Require two-factor when enrolled"
   policies, and the `mfa_recovery_codes` table and its two functions. Then add
   its prod version to `TRIAGE` in `scripts/check-prod-migrations.ts` with
   marker `two_factor_auth`, and regenerate `src/types/supabase.ts` (the
   entries for the new table and functions were added by hand).
2. **Check Dashboard → Authentication → Multi-Factor.** "App Authenticator
   (TOTP)" must have both enrollment and verification **enabled** (the
   default). Leave phone MFA off: it is not used, and SMS is the weakest
   second factor.
3. **Check the advisors** (`get_advisors`, security) after applying. The new
   functions set `search_path = ''` and have explicit grants, so nothing new
   should appear.
4. **Security emails** go through Cloudflare Email Service (`lib/email/send.ts`),
   which is off until the `EMAIL` binding and `TRANSACTIONAL_EMAIL_ENABLED` are
   set. Until then, 2FA alerts reach only the in-app bell and the Security
   activity log. Turning email on is strongly recommended: an alert that an
   intruder can dismiss inside the dashboard is not much of an alert.

## What the person sees

- **Setup**: Settings › Security › "Set up two-factor authentication". Prove
  it's you (password, or a sign-in in the last 15 minutes for Google-only
  accounts), scan the QR code or type the key, enter the first code, save ten
  recovery codes. Every other session is signed out when it turns on.
- **Sign-in**: password (or Google, or a magic link), then
  `/login/two-factor` for the code. "Use a recovery code instead" is there for
  a lost phone.
- **Sensitive actions** (password, email, business details, team invites and
  roles, account deletion, data export) ask for a fresh code once the last one
  is more than 10 minutes old. Removing an authenticator, turning 2FA off and
  generating new recovery codes ask for a code every time.
- **Nudges while it's off**: a "Turn on two-factor authentication" row at the
  top of the dashboard's Needs attention list, a "Recommended" badge on
  Settings › Security, and a prompt under the password card on Settings ›
  Account.

## How it is enforced

Three layers. Any one of them missing would leave a way round.

1. **The app gate** (`src/lib/auth/session.ts`). An account with a verified
   factor on an `aal1` session is treated as signed out by `getUser`,
   `actionUser` and `getAssurance`, and `requireUser` sends it to the
   challenge. Every page, action and route already goes through these, so the
   gate is fail-closed by construction. Sign-in, the OAuth/magic-link callback,
   `/auth/confirm` and the password-reset page all route an owed code to the
   challenge. **A password-reset link does not skip 2FA**: an inbox is not a
   second factor.
2. **The database** (the migration). The anon key is public, so a phished
   password can buy an `aal1` token straight from GoTrue and talk to
   PostgREST without ever loading the app. Restrictive policies on every Store
   and marketplace table the user's JWT can reach make that token see and
   change nothing for an account with 2FA on. Accounts without 2FA are
   unaffected. The service role (all server-only admin paths, and the admin
   panel) is never affected.
3. **Step-up** (`requireStepUp` in `src/lib/auth/mfa.ts`). A session hijacked
   after its owner signed in still cannot do the dangerous things without the
   phone.

Also:

- **Attempt limits**: 6 codes per account per 10 minutes, 30 per day, 30 per
  client IP (Cloudflare's `CF-Connecting-IP`) per 15 minutes. Authenticator
  and recovery codes share one budget. Running out at sign-in emails the owner
  (at most hourly), because it means someone has their password.
- **Replay guard**: a code accepted once is refused for 3 minutes, which is
  longer than GoTrue's acceptance window. GoTrue does not remember used codes.
- **Recovery codes**: 10 codes, 80 bits each, stored as
  `sha256(user_id:code)` in a table no client role can read, write or count.
  Spending one is a single atomic `UPDATE`. Using one removes every
  authenticator, voids the other codes, signs out every other device, emails
  the owner, and opens setup again.
- **Password re-checks never replace the session.** `checkPassword`
  (`src/lib/auth/reauth.ts`) signs in on a throwaway client and revokes that
  session straight away. Re-authenticating on the request client would have
  silently downgraded a two-factor session to password-only.
- **Security log**: every 2FA change is recorded in `security_events` and shown
  in Settings › Security › Recent security activity.

## Operations

- **Someone lost their phone AND their recovery codes.** Verify who they are
  out of band, then remove their factors in Dashboard → Authentication → Users
  → the user → MFA factors, and delete their rows from `mfa_recovery_codes`.
  They can sign in with the password and set 2FA up again.
- **GoTrue's own rate limits** apply on top of ours. Server-side calls reach
  GoTrue from Cloudflare's egress addresses, so a very busy period could meet
  Supabase's per-IP limit on verifications before ours. Such failures show as
  "couldn't check that code just now", never as "wrong code".
- **"Secure password change"** (Dashboard → Auth → Providers → Email): if it is
  on, a 2FA user whose session is over 24 hours old is told to sign out and
  back in before changing their password.

## Follow-ups outside this repo

- **SQ-app (marketplace)** shares the session cookie and has no login of its
  own. While someone is between their password and their code, the database
  already hides their data from it. But `worker/lib/supabase.ts`
  `requireUser` should also answer 401 for an `aal1` session with a verified
  factor, so the SPA sends them to the central login (which forwards to the
  challenge) instead of showing an error.
- **SQ-admin** signs staff in itself and does not ask for a second factor.
  Staff accounts are the highest-value accounts in the system; the admin panel
  should require `aal2`.
- **Passkeys (WebAuthn)** are phishing-resistant where TOTP is not. Supabase
  has WebAuthn MFA; adding it as a second factor type is the natural next step.

## Tests

- Unit: `tests/unit/mfa-assurance.test.ts`, `mfa-recovery-codes.test.ts`,
  `mfa-step-up.test.ts`, `auth-session-mfa-gate.test.ts`,
  `actions/mfa-actions.test.ts`, plus the step-up invariants in
  `server-action-security.test.ts`.
- Database: `tests/integration/22-two-factor-rls.test.ts`.
- End to end: `tests/e2e/67` to `71` (`*-two-factor-*`). The e2e stack's mock
  GoTrue (`tests/e2e/stack/server.mjs`) implements factors, challenges, TOTP
  verification, `aal`/`amr` claims, scoped logout and PKCE password recovery,
  and `tests/e2e/two-factor.ts` plays the part of the phone.
