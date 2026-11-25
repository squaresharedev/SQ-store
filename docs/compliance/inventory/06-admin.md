# 06: Write-path inventory, the Admin repo (SQ-admin)

Part 6 of 9 of the compliance inventory for the Czech-only beta (R1 to R6) and the
wider admin-side needs (unpublish, freeze, statement of reasons, fee refund,
append-only decision log, monthly summary).

- Repo: `C:\Squareshare\Admin`, HEAD `48cbbb0` (2026-10-31, "visual redesign"),
  working tree clean at the time of reading.
- Method: every tracked file under `src/`, `scripts/`, `supabase/`, `.github/`
  listed with `git ls-files`; every server action, route handler, scan source,
  migration and data reader opened and read. Store and SQ-system files were
  opened only where Admin writes to or reads from their objects.
- Path convention: `Admin/...`, `Store/...`, `SQ-system/...`. Anything not opened
  is marked (inferred).

---

## 0. Headline findings

1. **Admin has no write path to seller identity, products' commercial fields,
   prices, currencies, storefront content, orders, refunds, payment accounts,
   fee waivers, billing switches or plan prices.** Its only writes to Store-owned
   tables are: the `moderation_*` columns on `products` / `storefronts` /
   `artifacts`, `reports` (closing), `moderation_decisions`,
   `moderation_appeals` (answering), `notifications` (inserts), and
   `plan_grants` through two RPCs. Plus Supabase Auth admin calls (ban, unban,
   confirm email, delete). So staff cannot set a seller's country, a price or a
   currency into a disallowed state, because they cannot set them at all.
2. **The one way staff CAN put a non-compliant listing in front of buyers is
   `restoreContent`** (approve a held item, restore a paused or removed one,
   overturn an appeal): it writes `moderation_status = 'ok'` with the service
   role and checks nothing about market rules
   (`Admin/src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:387-412`, `441-500`, `571-575`).
3. **No Stripe at all.** `stripe` is not a dependency
   (`Admin/package.json:12-23`); no file in Admin mentions a connected account,
   application fee, refund or dispute (grep over the repo, only doc comments
   mention Stripe). Admin never reads `seller_payment_accounts`, and that Store
   table has no country column (`Store/supabase/migrations/20261008_seller_payment_accounts.sql:33-49`).
4. **"Unpublish a listing in one action" exists**: pause or remove on
   `/moderation/<type>/<id>`, which works for unreported items too
   (`Admin/src/components/moderation/SellerCard.tsx:137-145`,
   `Admin/src/app/(app)/moderation/[targetType]/[targetId]/page.tsx:80`). It
   always writes a decision row and tells the seller. But the ground list has no
   market-rules ground (`Admin/src/lib/moderation/content.ts:234-243`), and it is
   mirrored in a DB CHECK (`Store/supabase/migrations/20260926_moderation_decisions_and_appeals.sql:52-54`).
5. **"Freeze a seller" does not exist.** The nearest thing is a ban
   (`Admin/src/app/(app)/users/[id]/actions.ts:56-142`), which blocks sign-in
   and revokes sessions but changes no listing and (inferred) does not stop
   checkouts: in `Store/src/lib` the only reader of `banned_until` is
   `Store/src/lib/agent/authenticate.ts:54`.
6. **A ban sends the user no statement of reasons.** `banUser` writes the reason
   to `admin_user_moderation` and the audit log, and pushes a staff alert, but
   sends no email or notification to the person
   (`Admin/src/app/(app)/users/[id]/actions.ts:85-125`).
7. **Neither log is technically append-only against the service role.**
   `admin_audit_log` is append-only only for `authenticated` via RLS
   (`Admin/supabase/migrations/0001_admin_foundation.sql:60-77`), but every
   Admin write uses the service role, which bypasses RLS
   (`Admin/src/lib/supabase/service.ts:5-21`), there is no trigger forbidding
   UPDATE or DELETE, and an audit insert failure is swallowed
   (`Admin/src/lib/auth/log-admin-action.ts:25-29`). `moderation_decisions` is
   "immutable" by comment only
   (`Store/supabase/migrations/20260926_moderation_decisions_and_appeals.sql:85`,
   `grant all ... to service_role` at `183`), and Admin itself deletes one when
   the content write fails
   (`Admin/src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:329`).
8. **Revenue reporting is euro-only by construction.** `admin_revenue_summary`
   counts only `orders.currency = 'EUR'`
   (`Admin/supabase/migrations/0008_plans_revenue.sql:51`); every money figure
   on the revenue page and the plan panel goes through a hard-coded EUR
   formatter (`Admin/src/lib/format/money.ts:3`). A CZK-only beta would show
   zero sale fees.

---

## 1. The admin auth model

| Layer | What it does | Evidence |
|---|---|---|
| Session | `getUser()` validates the JWT with Supabase Auth (cookie-backed anon client, shared session cookie with SQ-store) | `Admin/src/lib/auth/session.ts:16-30`, `Admin/src/lib/supabase/server.ts:15-46` |
| Allowlist | `admin_users` row for `user_id` required, else `forbidden()` (403). Read with the service role. | `Admin/src/lib/auth/require-staff.ts:23-33`, `59-62` |
| Roles | `owner` or `staff` (`StaffRole`; DB CHECK). Only `deleteUser` checks for `owner`; every other action is open to any staff. | `Admin/src/lib/auth/require-staff.ts:9`, `Admin/supabase/migrations/0001_admin_foundation.sql:11`, `Admin/src/app/(app)/users/[id]/actions.ts:289-291` |
| 2FA | Account must have a verified factor AND the session must be `aal2`, else redirect to `/two-factor`. Factor is taken by SQ-store's challenge (shared cookie). Fails closed to aal1. | `Admin/src/lib/auth/require-staff.ts:64-66`, `Admin/src/lib/auth/assurance.ts:18-32`, `Admin/src/lib/moderation/store-links.ts:30-37` |
| Gate placement | Layout calls `requireStaff()`, and so does every page, server action and staff route handler (checked one by one, see section 2). | `Admin/src/app/(app)/layout.tsx:17` |
| Membership changes | No app path: `admin_users` has no INSERT/UPDATE/DELETE policy and the UI is read-only ("managed manually via SQL"). | `Admin/supabase/migrations/0001_admin_foundation.sql:51-58`, `Admin/src/lib/data/staff.ts:17-21`, `Admin/src/app/(app)/settings/page.tsx:11-14`, `58` |
| Machine endpoints | Shared secret `X-Scan-Secret` = `NOTIFY_SCAN_SECRET`, constant-time compare, fails closed when unset. | `Admin/src/lib/auth/scan-secret.ts:22-54` |
| DB key | Every read and write after the gate uses `createServiceSupabase()` (service role, bypasses RLS). The only anon-key calls are auth ones (sign-in, reset, sign-out, `resetPasswordForEmail` for a user). | `Admin/src/lib/supabase/service.ts:10-21`; grep of `.from(` / `.rpc(` |
| Per-admin rate limits | Counted from `admin_audit_log` rows; fails OPEN on a read error. | `Admin/src/lib/auth/rate-limit.ts:19-48` |
| Staff shield | Ban and delete refuse yourself and anyone on `admin_users`. Not applied to unban, email, reset, confirm. | `Admin/src/app/(app)/users/[id]/actions.ts:332-343` |

Discrepancy: `requireStaff`'s comment says admin tables "additionally enforce
staff membership and aal2 in-DB" (`Admin/src/lib/auth/require-staff.ts:43-44`).
The Admin migrations contain no `aal` check at all (grep of
`Admin/supabase`), and RLS is irrelevant to Admin's own writes because they use
the service role.

---

## 2. Every write path

Legend: SR = service-role client. "Audit" = row in `admin_audit_log`. "Limit"
= per-admin limit counted from the audit log.

### 2a. Server actions (all `"use server"`, all POST, all behind `requireStaff()` unless noted)

| # | Entity / operation | Entry point (UI) | Action file:line | Validation | Written (key) | Side effects | Who |
|---|---|---|---|---|---|---|---|
| A1 | Content takedown: pause or remove a product / storefront / artifact | `ModerationActions` on `/moderation/[type]/[id]` | `Admin/src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:204-378` | type in vocabulary + UUID (`100-110`); profiles refused (`213-220`); mode pause/remove, artifacts cannot pause (`222-228`); ground from closed list (`230-231`); note <= 500, pause needs >= 10 chars (`233-239`); pause needs >= 1 fix field (`242-249`); limit 60/h per mode (`87-88`, `251-257`); already-removed short-circuit (`266-268`) | `moderation_decisions` INSERT (products/storefronts only, `279-303`) SR; `products`/`storefronts`/`artifacts` UPDATE of `moderation_status, moderation_ground, moderation_note, moderated_at, moderated_by` (+ `moderation_review_requested_at, moderation_fields, moderation_decision_id` on pausable) (`305-324`) SR; on failure DELETE the decision (`329`); `reports` UPDATE status=actioned (`333`, fn `115-136`); `moderation_appeals` UPDATE upheld with superseded note (`336-338`, fn `165-188`) | Audit `content.pause` / `content.remove` with ground, title, ownerId, hasNote, fields, decisionId, previousStatus (`340-349`); seller `notifications` insert + email (`352-365`); staff push (`367-373`) | any staff |
| A2 | Restore / approve held / approve fix | same | `...actions.ts:441-500` | target + UUID; profiles refused (`449-452`); limit 60/h (`454-460`); only from paused/removed/review (`468-471`) | content row UPDATE `moderation_status='ok'` and clears every moderation column (`387-412`) SR; `moderation_appeals` UPDATE overturned (`478-480`) | Audit `content.restore` (`482-488`); seller notice kind restored/approved/cleared/appeal_overturned (`490-494`). No decision row written. No market-rules check. | any staff |
| A3 | Answer an appeal (uphold / overturn) | `AppealPanel` | `...actions.ts:516-610` | product/storefront only (`523-525`); appeal UUID (`527`); outcome (`529-530`); note <= 1000, uphold needs >= 10 (`532-538`); limit 60/h (`540-546`); appeal must be open and against the decision in force (`558-569`) | overturn: content restore (`571-575`); `moderation_appeals` UPDATE (`577-582`) SR | Audit `content.appeal.uphold/overturn` (`587-594`); seller notice (`596-601`) | any staff |
| A4 | Dismiss reports | `ModerationActions` | `...actions.ts:621-651` | target + UUID; note <= 500; limit 120/h (`89-90`, `635-641`) | `reports` UPDATE status=dismissed (`643`) SR | Audit `content.dismiss` (`645-647`). Seller deliberately NOT told (`612-620`). | any staff |
| A5 | Ban (suspend) a user | `BanPanel` on `/users/[id]` | `Admin/src/app/(app)/users/[id]/actions.ts:56-142` | UUID (throws, `345-351`); not self, not staff (`63-64`); limit 30/h (`37-38`, `66-72`); duration from allowlist (`74-75`, `Admin/src/lib/moderation/ban-durations.ts:23-45`); reason 3..500 (`77-83`) | Auth `updateUserById(ban_duration)` (`86-88`) SR; `admin_user_moderation` UPSERT (`95-106`) SR; `admin_revoke_user_sessions` RPC (`111`, `Admin/src/lib/moderation/revoke-sessions.ts:17-31`) SR | Audit `user.ban` incl. reason (`113-120`); staff push (`125`). No message to the user. No listing change. | any staff |
| A6 | Unban | `BanPanel` | `...users/[id]/actions.ts:145-164` | UUID only. No limit, no self/staff guard, no reason. | Auth `ban_duration: "none"` (`153-155`) SR; `admin_user_moderation` DELETE (`158`) SR | Audit `user.unban` (`160`); staff push (`161`) | any staff |
| A7 | Email one user (free text) | `EmailUserDialog` | `...users/[id]/actions.ts:173-222` | limit 20/h (`35-36`, `180-186`); subject <= 200, body <= 5000 (`188-198`); no staff-target guard | Brevo SMTP send (`205-207`) | Audit `user.send_email` (subject + to, not body) (`214-217`); staff push (`219`) | any staff |
| A8 | Send password reset | `SupportActions` | `...users/[id]/actions.ts:229-248` | UUID; user has email. No limit. | Supabase Auth `resetPasswordForEmail` via anon client (`239-243`) | Audit `user.send_password_reset` (`246`) | any staff |
| A9 | Mark email confirmed | `SupportActions` | `...users/[id]/actions.ts:251-267` | UUID. No limit, no guard. | Auth `updateUserById(email_confirm)` (`258-261`) SR | Audit `user.confirm_email` (`264`) | any staff |
| A10 | Delete account (soft or hard) | `DeleteUserPanel` | `...users/[id]/actions.ts:284-326` | OWNER only (`289-291`); not self/staff (`294-295`); typed email must match (`300-306`); default soft (`309`) | Auth `deleteUser(id, !hard)` (`311-313`) SR | Audit `user.delete_soft/hard` (`315-318`); staff push (`322`) | owner |
| A11 | Give a plan (bulk) | `GrantPlanDialog` (from `/plans` or `PlanPanel`) | `Admin/src/app/(app)/plans/actions.ts:83-188` | ids: 1..200 UUIDs, de-duplicated (`70-76`, `Admin/src/lib/plans/grants.ts:63`); plan starter/pro (`89-90`); reason from list (`91-92`); duration from list (`93-94`); note <= 500 (`95-96`); custom email subject one line <= 150, body <= 2000 (`54-68`); end date after today, <= 10 years (`104-105`, `grants.ts:174-198`); limit 300/h (`45-46`, `107-108`); only accounts with a store (`111-113`) | RPC `plan_grant_set` (`115-122`) SR (Store: `Store/supabase/migrations/20261019_plan_grants.sql:125-181`, service_role only) | One audit row per account `plan.grant` (`130-150`); seller notices in-app (+ optional email) (`152-163`); staff push (`170-176`) | any staff |
| A12 | Extend a dated grant | `PlanPanel` | `...plans/actions.ts:191-255` | exactly one id (`196`); extension from list (`197-198`); active dated grant (`203-206`); limit shared with A11 (`200-201`) | RPC `plan_grant_set` (`212-219`) SR | Audit `plan.grant` (`222-235`); always told in-app + email (`238-243`); staff push (`244-250`) | any staff |
| A13 | End given plans (bulk) | `EndGrantDialog` | `...plans/actions.ts:258-318` | ids 1..200 (`261-262`); limit 300/h (`265-266`) | RPC `plan_grant_end` (`268-271`) SR (`Store/supabase/migrations/20261019_plan_grants.sql:189-210`) | Audit `plan.end` per account (`276-287`); seller notices (`290-299`); staff push (`301-305`) | any staff |
| A14 | Campaign to the whole waitlist | `SendCampaignDialog` on `/signups` | `Admin/src/app/(app)/signups/actions.ts:21-66` | subject and body non-empty, confirm box (`27-33`). No length caps, no limit. | Brevo SMTP send to <= 10,000 addresses (`41`, `Admin/src/lib/data/signups.ts:134-145`) | Audit `signups.send_campaign` (`44-49`); staff push (`53-55`) | any staff |
| A15 | Register a push device | `NotificationSettings` | `Admin/src/app/(app)/settings/notifications/actions.ts:50-107` | endpoint https, <= 1000 chars, key lengths (`323-360`); <= 20 devices (`36`, `70-79`) | `admin_push_subscriptions` UPSERT (`83-93`) SR | Audit `notify.device_add` (`99-101`) | any staff (own rows) |
| A16 | Remove a push device | same | `...notifications/actions.ts:114-147` | scoped to caller (`120-138`) | `admin_push_subscriptions` DELETE SR | Audit `notify.device_remove` (`143`) | any staff (own rows) |
| A17 | Toggle a notification preference | same | `...notifications/actions.ts:155-181` | key from catalogue (`163`) | `admin_notification_prefs` UPSERT (`167-175`) SR | Not audited by design (`149-154`) | any staff (own rows) |
| A18 | Send a test push | same | `...notifications/actions.ts:191-266` | limit 12/h (`30-31`, `194-200`) | prunes dead `admin_push_subscriptions` (`241-251`) SR | Audit `notify.test` (`220-222`) | any staff |
| A19 | Run the scan now | same | `...notifications/actions.ts:278-305` | limit 30/h (`32-33`, `281-287`) | everything the scan writes (see C1) | Audit `notify.scan` (`289`) | any staff |
| A20 | Staff sign-in (password / magic link / reset request) | `LoginForm`, `PasswordResetModal` | `Admin/src/lib/auth/actions.ts:90-189` | `shouldCreateUser: false` on magic link (`121-123`); origin pinned in prod (`50-67`) | Supabase Auth only | none | public (pre-auth) |
| A21 | Set new password after recovery | `ResetPasswordForm` | `Admin/src/lib/auth/actions.ts:196-249` | 8..72 chars, match (`203-211`) | Auth `updateUser` (self) | none | the signed-in user |
| A22 | Google OAuth start | `GoogleButton` | `Admin/src/lib/auth/actions.ts:256-280` | `next` sanitised | none (redirect) | none | public |
| A23 | Sign out everywhere | `SessionControls` | `Admin/src/lib/auth/actions.ts:287-291` | none | Auth `signOut({scope:"global"})` (self) | not audited (`282-286`) | the signed-in user |

### 2b. Route handlers

| # | Route | File:line | Gate | Writes |
|---|---|---|---|---|
| R1 | `POST /api/notifications/scan` | `Admin/src/app/api/notifications/scan/route.ts:21-37` | `X-Scan-Secret` (fails closed, 503 unset, 401 wrong) | full scan (C1) |
| R2 | `POST /api/moderation/notify` | `Admin/src/app/api/moderation/notify/route.ts:25-41` | same secret (SQ-store holds it as `ADMIN_NOTIFY_SECRET`, `19-20`) | moderation half of the scan only (cursors + push) |
| R3 | `GET /plans/export` (CSV) | `Admin/src/app/(app)/plans/export/route.ts:30-75` | `requireStaff()` | Audit `plans.export_csv` (`38-44`) |
| R4 | `GET /signups/export` (CSV) | `Admin/src/app/(app)/signups/export/route.ts:11-41` | `requireStaff()` | Audit `signups.export_csv` (`19-22`) |
| R5 | `GET /auth/callback` | `Admin/src/app/auth/callback/route.ts:11-26` | none (code exchange) | session cookie only |
| R6 | `GET /auth/confirm` | `Admin/src/app/auth/confirm/route.ts:12-31` | none (OTP verify) | session cookie only |
| R7 | `POST /auth/signout` | `Admin/src/app/auth/signout/route.ts:9-15` | none | ends local session |
| R8 | `GET /sw.js` | `Admin/src/app/sw.js/route.ts` | none | none (grep shows no `.from`/`.rpc`) |

### 2c. Scheduled and machine-driven work

| # | What | Trigger | File:line | Writes |
|---|---|---|---|---|
| C1 | Notification scan: waitlist, new accounts, new sellers (new storefront), staff sign-ins, new reports, review requests, held items, appeals, milestones, plan expiry | pg_cron once a minute calls `admin_notification_scan_tick()` which POSTs R1; also R2 and A19 | `Admin/src/lib/notifications/scan.ts:50-77`, `88-97`; cron SQL `Admin/supabase/migrations/0006_admin_notifications.sql:128-187` (schedule and Vault secrets are created BY HAND, `132-151`) | `admin_notification_cursor` UPSERT (`scan.ts:145-163`, `Admin/src/lib/plans/expiry.ts:81-86`) SR; `admin_push_subscriptions` DELETE/UPDATE (`Admin/src/lib/notifications/deliver.ts:245-286`) SR; for expired grants: `notifications` INSERT type `billing` + email (`expiry.ts:70-74`, `Admin/src/lib/plans/notify-seller.ts:136-213`) |
| C2 | Staff push for in-panel actions | `after()` on the action's request | `Admin/src/lib/notifications/admin-events.ts:38-49` | push delivery bookkeeping (as C1) |

There is no market-rules scan, no scheduled report, and no digest email.

### 2d. Scripts

| Script | Writes? | Evidence |
|---|---|---|
| `scripts/verify-ban.mjs` | No DB writes. Signs a fixed test account in, lists users with the service role, writes a local `.ban-check.json`. | `Admin/scripts/verify-ban.mjs:19-107` |
| `scripts/generate-icons.mjs` | Local files only (`writeFileSync`) | `Admin/scripts/generate-icons.mjs:30` |
| `scripts/generate-vapid-keys.mjs` | Prints a key pair | `Admin/scripts/generate-vapid-keys.mjs:36` |

CI: `.github/workflows/deploy.yml` builds and deploys to Cloudflare on push to
`main`; no migrations, no jobs (`Admin/.github/workflows/deploy.yml:22-71`).

### 2e. Outbound channels every write can trigger

| Channel | Mechanism | Evidence |
|---|---|---|
| Seller in-app notice (moderation) | `notifications` INSERT, `type: 'policy'`, English title/body from `sellerNotice()`, `data.kind = content_<kind>` | `Admin/src/lib/moderation/notify-seller.ts:57-61`, `106-137` |
| Seller in-app notice (plans) | `notifications` INSERT, `type: 'billing'`, i18n keys + English fallback | `Admin/src/lib/plans/notify-seller.ts:26-35`, `136-170` |
| Email | Brevo SMTP over TLS 465; off when `BREVO_SMTP_USER`/`BREVO_SMTP_KEY` unset; default From `info@squareshare.eu` | `Admin/src/lib/email/mailer.ts:29-58`, `261-318` |
| Staff push | Web Push, VAPID; actor excluded; redacted body by default | `Admin/src/lib/notifications/deliver.ts:72-192`, `admin-events.ts:9-49` |

Memory note `content-moderation-architecture.md` says moderation email goes
through Resend; the code now uses Brevo SMTP (`mailer.ts:7-27`). The note is stale.

---

## 3. The entities asked about

| Entity | Admin writes it? | Detail |
|---|---|---|
| Sellers (auth account) | Yes, auth only | ban/unban/confirm/delete (A5, A6, A9, A10). No write to `profiles` (no `.from("profiles")` write anywhere; it is read at `Admin/src/lib/data/moderation.ts:958-964`). |
| Seller identity / country / address | No | Read only: `tax_business_name, seller_email, seller_email_verified_at, seller_address, seller_phone, tax_country, tax_vat_id` (`Admin/src/lib/data/moderation.ts:958-964`, mapped `1029-1035`). |
| Stores / storefronts | Moderation columns only | A1, A2, A3. Never `config`, `name`, publish state. |
| Products | Moderation columns only | A1, A2, A3. Never `price_cents`, `currency`, `status`, shipping, stock. Read at `Admin/src/lib/data/moderation.ts:662-759`. |
| Prices / currencies | No | Read only for display. |
| Orders | No | Read only inside `admin_revenue_summary` (`Admin/supabase/migrations/0008_plans_revenue.sql:46-54`). No `.from("orders")` in `Admin/src`. |
| Refunds | No | No code path. |
| Plan grants | Yes | A11 to A13 via `plan_grant_set` / `plan_grant_end`; plan expiry notices (C1). |
| Fee waivers (`seller_fee_waivers`) | No | Not referenced in Admin (grep). |
| Billing switches (`billing_switches`) | No | Not referenced. |
| Plan prices (`plan_prices`) | No | Not referenced. |
| Fee ledger (`fee_ledger`) | No | Not referenced. |
| Payment accounts (`seller_payment_accounts`) | No | Not referenced. |
| Reports | Close only | A1 (actioned), A4 (dismissed). Admin never creates reports. |
| Decisions (`moderation_decisions`) | Insert, and delete on failure | A1 only (`actions.ts:279-303`, `329`). |
| Appeals | Answer only | A1 (superseded), A2 (overturned), A3. |
| Waitlist | No writes | Read and mailed (A14). |

### 3a. Stripe

None. No dependency (`Admin/package.json:12-23`), no API call, no secret name in
`Admin/.env.example` or `Admin/wrangler.jsonc:21-38`. Stripe appears only as
prose ("Free, without Stripe", "Stripe test mode") and in the read model's
`livemode` / `cs_live_` filters
(`Admin/supabase/migrations/0008_plans_revenue.sql:14-18`, `53`, `66`;
`Admin/src/components/plans/PlanPanel.tsx:73`).

### 3b. Moderation actions and what the seller is told

| Decision | Status written | Decision row? | Seller told? | Wording source |
|---|---|---|---|---|
| Pause (first) | `paused` | Yes (product/storefront) | in-app + email + statement PDF link | `sellerNotice` kind `paused` (`Admin/src/lib/moderation/content.ts:481-492`) |
| Pause again | `paused` | Yes | yes | `paused_again` (`content.ts:493-503`) |
| Remove | `removed` | Yes for product/storefront; artifacts: none, email only (`actions.ts:275-279`) | yes | `removed` (`content.ts:504-512`) |
| Restore (no request) | `ok` | No | yes | `restored` (`content.ts:545-549`) |
| Approve fix | `ok` | No | yes | `approved` (`content.ts:535-539`) |
| Approve held (auto-check) | `ok` | No | yes | `cleared` (`content.ts:540-544`) |
| Appeal upheld | unchanged | No (appeal row updated) | yes | `appeal_upheld` (`content.ts:513-523`) |
| Appeal overturned | `ok` | No | yes | `appeal_overturned` (`content.ts:524-534`) |
| Dismiss reports | unchanged | No | No, by design | n/a (`actions.ts:612-620`) |
| Ban | auth `banned_until` | `admin_user_moderation` (overwritten on re-ban, deleted on unban) | **No** | none |
| Plan given / changed / ended | `plan_grants` | n/a | in-app (optional), email (optional for give/end, forced for extend and expiry) | `planNoticeEnglish` (`Admin/src/lib/plans/notice-text.ts:21`) + Store i18n keys (`Admin/src/lib/plans/notify-seller.ts:26-35`) |

`sellerNotice()` is the single source of the title and body for moderation
notices: the decision preview (`Admin/src/components/moderation/ModerationActions.tsx:353`),
the appeal preview (`Admin/src/components/moderation/AppealPanel.tsx:103`) and
the server send (`Admin/src/lib/moderation/notify-seller.ts:83`) all call it.
The email adds wrapper text composed in `notify-seller.ts` itself: the action
label ("Fix it here", "See the details", "Open it"), the PDF link line and a
closing line (`notify-seller.ts:150-176`). The seller-facing sentence per
ground is `REMOVAL_GROUND_COPY` (`content.ts:247-286`); `other` reads "It broke
the platform rules." (`content.ts:282-285`). The ground list, fix-field list
and target vocabulary are hand-mirrored in SQ-store and SQ-system
(`content.ts:1-14`, `326-336`) and in DB CHECKs
(`Store/supabase/migrations/20260926_moderation_decisions_and_appeals.sql:52-54`, `66-81`).
`products.moderation_ground` itself has no CHECK (only status has one:
`Store/supabase/migrations/20261012_auto_moderation.sql:66`; ground columns
added without constraint at `Store/supabase/migrations/20260918_content_moderation.sql:39`, `46`, `56`).

---

## 4. What exists today for the admin-side needs

| Need | Exists? | Evidence | Gap |
|---|---|---|---|
| Unpublish a listing in one action | **Yes** (pause or remove), product / storefront / artifact | A1; reachable for unreported items (`Admin/src/components/moderation/SellerCard.tsx:137-145`, rows link at `188`) | No market-rules ground; pause demands a fix field and a 10-char note (`actions.ts:237-249`); one item at a time, no bulk |
| Freeze / suspend a whole seller (stop checkouts) | **No** | Ban only blocks sign-in and revokes sessions (`users/[id]/actions.ts:86-111`); profiles cannot be taken down from moderation on purpose (`Admin/src/lib/moderation/content.ts:82-90`, `110`) | No seller-level flag; listings stay live; checkout path does not read the ban (inferred, `Store/src/lib/agent/authenticate.ts:54` is the only `banned_until` reader in `Store/src/lib`) |
| Disconnect a seller (Stripe) | **No** | no Stripe code (3a) | everything |
| Refund the platform's application fee | **No** | no Stripe code; no refund code | everything |
| Statement of reasons on every removal / restriction | **Partly** | product/storefront pause and remove: decision row + PDF link + notice (`actions.ts:279-303`, `notify-seller.ts:156-161`, `Admin/src/lib/moderation/store-links.ts:72-74`) | artifacts: email only, no decision row; ban: no notice at all; restores/approvals write no decision row |
| View seller country / establishment | **Partly** | moderation `SellerCard` "Trader details" shows trader name, contact email, address, phone, and `tax_country` + VAT id as free text (`SellerCard.tsx:99-119`) | not on `/users/[id]` (`Admin/src/app/(app)/users/[id]/page.tsx:48-264` has no identity block); no structured address country; nothing flags a non-CZ value |
| View Stripe account status | **No** | Admin never reads `seller_payment_accounts`; that table has `charges_enabled`, `payouts_enabled`, `details_submitted`, `livemode` but no country (`Store/supabase/migrations/20261008_seller_payment_accounts.sql:33-49`) | everything |
| Append-only decision log | **Partly** | `admin_audit_log` (every mutating action, viewer at `/audit`, per-target history `Admin/src/lib/data/audit.ts:81-100`); `moderation_decisions` for takedowns | not tamper-proof against SR (finding 7); audit failures swallowed; content notes deliberately not in audit meta (`actions.ts:344`), ban reasons are (`users/[id]/actions.ts:118`); ban record overwritten / deleted (`users/[id]/actions.ts:95-106`, `158`) |
| Monthly summary (reports, removals, frozen sellers, fees, refunds, disputes) | **No** | Overview: waiting count, user counts, 14-day signup chart, 6 recent audit rows (`Admin/src/app/(app)/page.tsx:17-83`). Revenue: 30-day EUR fees, MRR, funnel, cancellations (`Admin/src/app/(app)/plans/revenue/page.tsx:54-162`, `Admin/supabase/migrations/0008_plans_revenue.sql:31-76`). Audit page filters by action only (`Admin/src/app/(app)/audit/page.tsx:17-72`). | no period counts of reports / removals / appeals; no refunds, disputes or frozen sellers anywhere; fees are a rolling 30 days in EUR only; SQ-system lists transparency reporting as not built (`SQ-system/docs/moderation.md:441-442`) |
| Alerts / scheduled scans | **Yes, for moderation and growth** | C1 sources (`scan.ts:56-72`), event catalogue (`Admin/src/lib/notifications/events.ts:87-221`) | no source for market-rules violations |
| Staff cannot create/change a seller, product or price into a disallowed state | **Mostly by absence** | no write path to those fields (section 3) | `restoreContent` can make a non-compliant listing live (finding 2); plan grants are unaffected by market rules |

---

## 5. Admin's migrations (`Admin/supabase/migrations`)

| File | Creates / changes | Touches sellers / products / orders? |
|---|---|---|
| `0001_admin_foundation.sql` | tables `admin_users` (`8-13`), `admin_audit_log` (`16-23`) + indexes; fn `is_squareshare_staff()` (`34-49`); RLS: staff read both, staff insert own audit rows, no update/delete policies (`54-77`) | No |
| `0002_waitlist_signups_unique_email.sql` | unique index on `lower(email)` of `waitlist_signups` (`7-8`) | No |
| `0003_admin_moderation.sql` | table `admin_user_moderation` (`16-23`), staff-read policy (`32-36`); fn `admin_revoke_user_sessions(uuid)` SECURITY DEFINER, service_role only (`43-62`) | Users (auth sessions) |
| `0004_admin_directory_avatar.sql` | `create or replace view admin_user_directory` (auth.users + profiles) (`18-38`) | Reads `profiles` |
| `0005_admin_directory_activity.sql` | view adds `last_sign_in_at` (`19-40`); fn `admin_user_activity(uuid)` service_role only (`48-64`) | Reads auth |
| `0006_admin_notifications.sql` | fn `current_admin_user_id()` (`32-45`); tables `admin_push_subscriptions` (`52-80`), `admin_notification_prefs` (`92-106`), `admin_notification_cursor` (`119-126`); fn `admin_notification_scan_tick()` (`152-187`); manual cron recipe (`128-151`) | No |
| `0007_content_reports.sql` | ALTERs the SQ-app-owned `reports`: target/reason/status CHECKs (`36-56`), columns `reporter_hash, reporter_email, resolved_at, resolved_by, resolution_note` (`74-89`), dedupe and queue indexes (`103-113`); view `content_report_scores`, service_role only (`131-169`) | Joins products, storefronts, artifacts, profiles |
| `0008_plans_revenue.sql` | fns `admin_revenue_summary` (`31-76`), `admin_plans_funnel` (`85-126`), `admin_cancellation_reasons` (`130-147`), SECURITY INVOKER, service_role only (`149-154`); index on `seller_funnel_events` (`157-158`) | Reads **orders** (`46-54`, EUR only), `seller_billing`, `plan_cancellations`, `seller_funnel_events` |
| `0009_plan_directory.sql` | view `admin_plan_directory` (security_invoker, service_role only) (`26-90`) | Reads `seller_billing`, `plan_grants`, counts products and storefronts (`69-72`) |

Owned outright: `admin_users`, `admin_audit_log`, `admin_user_moderation`,
`admin_push_subscriptions`, `admin_notification_prefs`,
`admin_notification_cursor`, views `admin_user_directory` (replaced here, its
first creation is not in this repo: `0004:7` cites "0001/lock_down_admin_user_directory_view"),
`content_report_scores`, `admin_plan_directory`, and the six functions above.

Store-owned objects Admin writes: `products`, `storefronts`, `artifacts`
(moderation columns, allowed for service_role by `guard_moderation_columns`,
`Store/supabase/migrations/20260926_moderation_decisions_and_appeals.sql:222-250`),
`moderation_decisions`, `moderation_appeals`, `reports`, `notifications`,
`plan_grants` (via `plan_grant_set` / `plan_grant_end`).

---

## 6. Every country or currency literal or list in Admin

| Literal | File:line | Role |
|---|---|---|
| `currency: "EUR"` in a module-level `Intl.NumberFormat("en-US", ...)`; comment "Euros because every plan and platform fee is charged in them" | `Admin/src/lib/format/money.ts:1-7` | the only money formatter for aggregates |
| `cents: formatEuros` | `Admin/src/components/ui/StatCard.tsx:3`, `9-12` | every `format="cents"` stat card |
| `formatEuros(...)` | `Admin/src/app/(app)/plans/revenue/page.tsx:15`, `214`, `218`; stat cards `179-199` | revenue page |
| `formatEuros(paid.priceCents)` (ignores `paid.currency`, which is read at `Admin/src/lib/data/plan-directory.ts:87` and never displayed) | `Admin/src/components/plans/PlanPanel.tsx:10`, `70` | subscription price |
| `(row.currency as string) ?? "EUR"` | `Admin/src/lib/data/moderation.ts:739` | product facts default |
| `Intl.NumberFormat("en-IE", { style: "currency", currency })` with the row's own currency, plain fallback | `Admin/src/components/moderation/ContentFacts.tsx:37-38`, `329-335`; used at `50` and `Admin/src/components/moderation/SellerCard.tsx:208` | per-product price display (handles CZK) |
| `o.currency = 'EUR'` | `Admin/supabase/migrations/0008_plans_revenue.sql:51` (comment `27-30`) | fee revenue filter |
| `b.currency as paid_currency` | `Admin/supabase/migrations/0009_plan_directory.sql:42` | subscription currency (read, unused in UI) |
| `tax_country` read; displayed as free text with VAT id under "Tax" | `Admin/src/lib/data/moderation.ts:931`, `961`, `1034`; `Admin/src/components/moderation/SellerCard.tsx:116-118` | seller country (no validation, no flag) |
| Formatting locales `en-US` (counts, dates), `en-GB` (some counts), `en-IE` (money) | e.g. `Admin/src/lib/format/date.ts:2`, `9`; `Admin/src/lib/notifications/milestones.ts:56`; `Admin/src/components/moderation/SellerCard.tsx:129`; `Admin/src/lib/plans/grants.ts:118`, `128`, `202`; many `toLocaleString("en-US")` in pages (grep) | display only, not market rules |

No country list, no allowed-country config, no CZK literal, and no `'CZ'`
anywhere in Admin `src` or migrations (grep).

---

## 7. Where a "market rules violations" view and the monthly summary would sit (structure facts only)

- **Navigation** is one list rendered by the rail and the mobile drawer:
  Overview, Users, Moderation, Plans, Email signups, Audit log, Settings
  (`Admin/src/components/shell/nav-items.ts:15-25`). Nav badges are a map keyed
  by href, filled in the layout; only `/moderation` has one today
  (`Admin/src/app/(app)/layout.tsx:18-23`).
- **Page pattern**: a server component at `src/app/(app)/<area>/page.tsx` calls
  `requireStaff()`, then readers in `src/lib/data/<area>.ts` that use the
  service role and throw on error (e.g. `Admin/src/app/(app)/plans/page.tsx:65-76`,
  `Admin/src/lib/data/plan-directory.ts:151-164`).
- **Sub-views** are tabs made with `Segmented`: `/plans` has Accounts and
  Revenue (`Admin/src/components/plans/PlansTabs.tsx:5-6`); `/moderation` has
  Waiting, Paused, Resolved, Everything as `?filter=` (`Admin/src/components/moderation/QueueFilters.tsx:4-18`).
- **The moderation "Waiting" tab is a stack of sections** (appeals, held,
  review requests, reported), each from its own reader
  (`Admin/src/app/(app)/moderation/page.tsx:71-138`), and its count feeds the
  nav badge and the Overview card through one function
  (`Admin/src/lib/data/moderation.ts:369-415`; `Admin/src/app/(app)/page.tsx:24`, `35`, `90-128`).
- **Per-seller facts** are assembled once in `fetchSellerFacts`
  (`Admin/src/lib/data/moderation.ts:947-1060`) and shown in `SellerCard` /
  `SellerCatalogue` on every decision page; `/users/[id]` is a separate
  sectioned page (Plan, Plan history, Account details, Moderation, Support,
  Danger zone) with its own readers (`Admin/src/app/(app)/users/[id]/page.tsx:62-68`, `188-261`).
- **Aggregations** are done in SQL that Admin's own migrations define, either
  as SECURITY INVOKER functions executable by service_role only
  (`Admin/supabase/migrations/0008_plans_revenue.sql:31-154`) or as
  service-role-only views with explicit revokes
  (`0007_content_reports.sql:131-169`, `0009_plan_directory.sql:26-90`).
  Reader functions call them with `.rpc()` (`Admin/src/lib/data/plans.ts:85-125`).
- **Period controls** exist as `PLANS_PERIODS` (30 days, 90 days, 12 months,
  all time) and a Live / Include test data toggle
  (`Admin/src/lib/data/plans.ts:19-36`, `Admin/src/app/(app)/plans/revenue/page.tsx:28-47`, `83-103`).
  There is no calendar-month control.
- **Exports** are GET route handlers next to the page that audit-log the read
  (`Admin/src/app/(app)/plans/export/route.ts:30-75`, which builds the file with
  `csvFile` from `Admin/src/lib/format/csv.ts`, not opened).
- **Alerts** are scan sources with a watermark in `admin_notification_cursor`
  plus an entry in the event catalogue
  (`Admin/src/lib/notifications/scan.ts:171-196`, `Admin/src/lib/notifications/events.ts:87-221`).
- **History of staff decisions per target** comes from the audit log by target
  string `"<type>:<uuid>"` or user id (`Admin/src/lib/data/audit.ts:81-100`,
  `Admin/src/components/audit/action-meta.ts:59-64`).

---

## 8. Could not determine

1. Which Admin migrations are applied in production, and whether the pg_cron
   job and its two Vault secrets are armed (they are created by hand,
   `Admin/supabase/migrations/0006_admin_notifications.sql:132-151`). Memory
   notes say 0007 and 0009 are in prod; not verified (no DB access by rule).
2. Where and how `admin_user_directory` was first created and granted (cited as
   "0001/lock_down_admin_user_directory_view" at `0004:7`, not in this repo).
3. Which Worker secrets are set in production (Brevo, R2, VAPID,
   `NOTIFY_SCAN_SECRET`); the code degrades silently without each.
4. Whether Store's checkout refuses a banned seller. Only a grep of
   `Store/src/lib` for `banned_until` was done (one hit, the agent
   authenticator); checkout itself was not traced (inferred: it does not).
5. Whether any production-only trigger or rule protects `admin_audit_log` or
   `moderation_decisions` from service-role UPDATE / DELETE. None exists in
   Admin migrations or in the Store migration that creates the decisions table.
6. The Store and SQ-system mirrors of `REMOVAL_GROUNDS` / `FIX_FIELDS`
   (`Store/src/lib/moderation/removal.ts`, `@squaresharedev/moderation`) were
   not opened (inferred to exist per `Admin/src/lib/moderation/content.ts:4-9`).
7. Whether Store's `moderation_remember_approval` fires on an Admin restore of a
   held item (claimed at `actions.ts:464-467`; Store's
   `20261012_auto_moderation.sql` not opened for it).
8. The source of the "aal2 in-DB" claim in `require-staff.ts:43-44`; nothing in
   Admin migrations implements it.
9. Whether a Stripe account country is stored anywhere in Store beyond
   `seller_payment_accounts` (only Store migrations were grepped; other parts of
   this inventory cover Store code).

---

## 9. Smaller observations relevant to the build phase

- `unbanUser`, `confirmUserEmail`, `sendPasswordResetEmail` have no rate limit
  and no self / staff-target guard on the server (`Admin/src/app/(app)/users/[id]/actions.ts:145-164`, `229-267`);
  the UI hides some of them, the action does not check.
- `sendCampaign` has no length caps and no rate limit
  (`Admin/src/app/(app)/signups/actions.ts:27-33`).
- Rate limits fail open on a read error (`Admin/src/lib/auth/rate-limit.ts:35-38`).
- The audit page tells staff the log "cannot be edited or deleted"
  (`Admin/src/app/(app)/audit/page.tsx:38`); true for signed-in clients, not
  for the service role (finding 7).
- `admin_plan_directory` counts products and storefronts that are not
  `removed`, so paused, held and draft items count
  (`Admin/supabase/migrations/0009_plan_directory.sql:69-72`).
- Profiles are deliberately not removable from the moderation screen; a person
  is handled on `/users` (`Admin/src/lib/moderation/content.ts:82-90`,
  `actions.ts:213-220`). A seller-level freeze would be a new kind of action
  rather than an extension of the existing takedown target map.
