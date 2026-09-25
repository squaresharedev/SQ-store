# Two-factor authentication

Optional for every account, and actively recommended. Built on Supabase Auth's
native TOTP MFA (authenticator apps), with recovery codes added in-app because
Supabase has none.

Supabase project: **SQ-store**, ref `vnyfndqpdllwhvhinjoi`.

## Before deploying

Do these in this order. Without the migration the code refuses to turn 2FA on
("Two-factor setup isn't available right now"), because 2FA without recovery
codes would turn a lost phone into a locked account; and there is no
database-level enforcement.

1. **Apply the migration** `supabase/migrations/20260923_two_factor_auth.sql`
   (Supabase MCP `apply_migration`, or the SQL editor). **Done on 2026-09-24**
   through the SQL editor (verified over REST: `mfa_session_ok` answers, the
   recovery-code table exists and refuses anon). The SQL editor records no
   migration version, so there is nothing to add to `TRIAGE`. It adds
   `mfa_session_ok()`, the restrictive "Require two-factor when enrolled"
   policies, the `mfa_recovery_codes` table and its two functions, and the
   2FA guard inside the five SECURITY DEFINER functions clients can call
   (section 4). **Before applying section 4**, compare each function body with
   `pg_get_functiondef` on production: the bodies come from the replayed
   history, and prod has been ahead of this repo before. Then add its prod
   version to `TRIAGE` in `scripts/check-prod-migrations.ts` with marker
   `two_factor_auth`, and regenerate `src/types/supabase.ts` (the entries for
   the new table and functions were added by hand).
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

- **Setup**: Settings › Security › "Set up two-factor authentication". Choose
  a **passkey** (the default, marked Recommended: Face ID, a fingerprint or
  the screen lock, nothing to install; on a computer the browser shows a QR
  code to scan with the phone's own camera) or an **authenticator app**.
  Prove it's you: a sign-in in the last 10 minutes counts on its own;
  otherwise the account's password, or "Confirm with Google" for an account
  that signs in with Google (it signs in again and comes straight back). Then
  create the passkey (one tap), or scan the QR code and enter the first code.
  Save ten recovery codes. Every other session is signed out when it turns on.
- **Sign-in**: password (or Google, or a magic link), then
  `/login/two-factor`: "Use your passkey" first when the account has one, the
  code box for an app, and "Use a recovery code instead" for a lost phone.
- **Sensitive actions** (password, email, business details, team invites and
  roles, account deletion, data export) ask to confirm it's you once the last
  confirmation is more than 10 minutes old: "Confirm with passkey" (which also
  submits the form) or a code. Removing an authenticator, turning 2FA off and
  generating new recovery codes ask every time.
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
   change nothing for an account with 2FA on. RLS does not reach inside
   SECURITY DEFINER functions, so every definer function a client may call
   was audited: `team_actor_role` (and through it `team_roster`),
   `team_my_accounts`, `team_my_pending_invites`, `team_accept_invite` and
   `rl_take` carry the same check; `is_squareshare_staff` and
   `mfa_session_ok` only answer about the caller. A DB test fails if a new
   callable definer function appears. Accounts without 2FA are unaffected. The
   service role (all server-only admin paths, and the admin panel) is never
   affected.
3. **Step-up** (`requireStepUp` in `src/lib/auth/mfa.ts`). A session hijacked
   after its owner signed in still cannot do the dangerous things without the
   phone. An account with no password (Google-only) needs a code in the same
   request to change its email, since the code is its only proof.

## Passkeys

**Why this shape.** Supabase's own WebAuthn second factor cannot be enabled
on hosted projects (the Management API answers "Enabling of MFA with WebAuthn
not currently supported", checked 2026-09-25). Its passkey *sign-in* can be,
but it is a first factor: anyone holding the password could register their
own passkey through GoTrue and walk past a second step built on it.

**How it works.** Each passkey is backed by an ordinary GoTrue TOTP factor
(named `passkey:<name>`) whose secret only the server knows, sealed with
AES-GCM in `public.mfa_passkeys` (service role only, migration
`20260925_passkey_factors.sql`). The browser proves possession of the passkey
with a WebAuthn assertion (`@simplewebauthn`, user verification required);
the server verifies it against the stored public key and only then computes
the factor's current code and completes it at GoTrue. So GoTrue still issues
`aal2`, still refuses factor, password and email changes to `aal1` sessions,
and the app gate, the restrictive RLS, step-up and recovery codes all apply
unchanged. `lib/auth/passkeys.ts` holds the design notes.

- **Challenges** are minted by the server, bound to the account and purpose,
  and spent once (`webauthn_challenge` in `rate_limit_keys`). Registration
  carries its challenge and the pending factor's secret in a sealed HttpOnly
  cookie; sign-in and step-up carry a sealed slip with the form, so a page
  with several "Confirm with passkey" boxes cannot have them overwrite each
  other.
- **A typed code is never checked against a passkey's factor**
  (`pickFactor`); nobody can know that secret.
- **Removing a factor by any route removes its passkey**: the table's foreign
  key to `auth.mfa_factors` cascades.

**Configuration.**

| Setting | Where | Value |
| --- | --- | --- |
| `MFA_PASSKEY_KEY` | Worker secret (`wrangler secret put`), `.env.local` for dev | 32 random bytes, base64. Set 2026-09-25. |
| `WEBAUTHN_RP_ID` | `wrangler.jsonc` vars | `squareshare.eu`. Defaults to the app's host (`localhost` in dev). |
| `WEBAUTHN_ORIGINS` | test stack only | Extra allowed origins (the e2e stack's `:3100`). |

**Never change `WEBAUTHN_RP_ID` or `MFA_PASSKEY_KEY` once passkeys exist.**
A new RP ID makes every registered passkey unusable; a new key makes every
sealed secret unreadable. Either way every passkey user is down to their
recovery codes.

## Verified against production GoTrue

Checked on 2026-09-24 with a throwaway account created through the admin API
and deleted in the same run (no emails sent):

| Behaviour | Result |
| --- | --- |
| Password sign-in token | `aal1`, `amr: [{method: "password", timestamp}]` |
| After verifying a code | `aal2`, `amr` gains `{method: "totp", timestamp}` (what the step-up window reads) |
| Other sessions when 2FA is turned on | Signed out |
| Same code verified twice (new challenge) | **Accepted**: GoTrue has no replay protection, so the app's replay guard is required |
| `aal1` session enrols another factor | Refused, `insufficient_aal` |
| `aal1` session removes a factor | Refused, `insufficient_aal` |
| `aal1` session changes password or email via the API | Refused, `insufficient_aal` |

## Security review

An adversarial review of the whole system (2026-09-24) reported:

- **Critical, confirmed**: the migration was not applied to production, so
  the database layer was absent there. Resolution: applied on 2026-09-24.
  Until then setup refused to start, so nobody could end up with 2FA but no
  recovery codes.
- **Critical, Supabase advisor (pre-existing, not from 2FA)**:
  `public_profiles` was a SECURITY DEFINER view over `profiles`. Resolution:
  `20260924_public_profiles_invoker.sql` makes it read a trigger-maintained
  `profile_directory` table (id, username, avatar_url of opted-in profiles
  only) as the caller.
- **High, suspected**: an `aal1` session enrolling its own phone directly
  through GoTrue. Resolution: not possible; GoTrue refuses it (table above).
- **High, suspected**: a Google-only account's email changed by a stolen
  session inside the 10-minute window, with no code. Resolution: fixed; such
  accounts need a code in the same request.

Everything else it examined (the app gate, attempt limits and replay guard,
2FA controls needing a code every time, password-reset and magic-link paths,
recovery-code storage and spending, redirect sanitising) held.

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
- **"Secure password change"** (Dashboard → Auth → Providers → Email): no
  longer matters to the app. Settings never changes a password in place (there
  is no form taking the current one); a new password is only set through the
  emailed link, whose recovery session is always fresh.
- **"Secure email change"** (same page) should stay ON: it makes an email
  change need a click in BOTH inboxes, so a stolen session alone can never
  move the address.
- **"Current password is incorrect" with a password the person is sure of**:
  only GoTrue's `invalid_credentials` is reported that way; every other
  refusal is logged as `[auth] password check refused: <code>` and shown as
  "couldn't check your password". A Google account that also has an old
  password on file is told to use "Confirm with Google".

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
- **Supabase's native WebAuthn MFA.** Once the hosted platform allows it
  (`mfa_web_authn_enroll_enabled`), passkeys could move onto it and drop the
  sealed-TOTP bridge. Not urgent: the bridge keeps every GoTrue guarantee.

## Tests

- Unit: `tests/unit/mfa-assurance.test.ts`, `mfa-recovery-codes.test.ts`,
  `mfa-step-up.test.ts`, `auth-session-mfa-gate.test.ts`,
  `auth-reauth.test.ts`, `actions/mfa-actions.test.ts`,
  `passkey-primitives.test.ts` (RFC 6238 vectors, sealing, relying party),
  plus the step-up invariants in `server-action-security.test.ts`.
- Database: `tests/integration/22-two-factor-rls.test.ts`,
  `24-passkey-factors.test.ts`.
- End to end: `tests/e2e/67` to `70` (`*-two-factor-*`) and
  `73-two-factor-passkeys.spec.ts`, which drives Chromium's virtual WebAuthn
  authenticator through real create()/get() ceremonies. The e2e stack's mock
  GoTrue (`tests/e2e/stack/server.mjs`) implements factors, challenges, TOTP
  verification, `aal`/`amr` claims, scoped logout and PKCE password recovery,
  and `tests/e2e/two-factor.ts` plays the part of the phone.
