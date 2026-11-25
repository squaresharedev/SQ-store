# 01 Store: sellers and accounts, write-path inventory

Part 1 of 9 of the Czech-only beta compliance inventory. Scope: every path in
the Store repo (SQ-store) that creates or changes seller identity, trader
identity and establishment (country), Stripe connected accounts, seller plans
and billing, the publish and sell gates, account deletion and any waitlist.

Method: read-only. Code read on disk on 2026-11-22 (branch main, clean tree at
start, HEAD e43eedd). No servers, tests, Stripe, Supabase or production calls.
Every claim cites `Repo/path:line`. "(inferred)" marks anything not opened or
not provable from the code. Memory notes were used only as leads.

Rule names R1 to R8 refer to the decision in the brief (R1 seller established
in CZ: Stripe account country and business address country both CZ; R5 collab
checkout; R6 server-side enforcement at checkout; R8 expansion waitlist).

---

## 0. Headline findings

1. **There is exactly one seller-country field: `profiles.tax_country`.** It is
   optional, labelled "Country" in Settings > Business & seller details, and
   validated only by Zod against `OPERATING_COUNTRY_CODES` (EU 27 + US + CA)
   at `Store/src/lib/validation/settings.ts:131-136`. The database only checks
   the shape `^[A-Z]{2}$` (`Store/tests/db/prod-migrations.sql:261-262`).
   The business address (`profiles.seller_address`) is one free-text field with
   no structured country (`Store/supabase/migrations/20260905_seller_identity_on_profile.sql:36-50`).
   R1's "business address country" therefore has no column today.
2. **`tax_country` is writable around the Zod list.** `profiles` RLS lets the
   owner update their own row (`Store/tests/db/prod-migrations.sql:102-108`);
   the only column guards are for seller text (`tax_business_name`,
   `seller_bio`, `shipping_policy`: `Store/supabase/migrations/20261012_auto_moderation.sql:735-777`),
   contact proofs (`Store/supabase/migrations/20260926_contact_verification.sql:285-334`)
   and `avatar_url` (`Store/supabase/migrations/20261105_write_bounds.sql:197-199`).
   A seller with a session can PATCH `tax_country` to any two capital letters
   over PostgREST.
3. **Country is not part of the publish/sell gate.** The gate requires business
   name, address, contact email and (when mail is on) a proven email only
   (`Store/src/lib/settings/trader-identity.ts:37-41`, `:115-144`). The file
   says country is deliberately not required (`:27-29`, a stale comment: the
   picker is no longer EU-only). The dashboard welcome flow never asks for a
   country (`Store/src/components/onboarding/WelcomeFlow.tsx:436`, `:454`, `:477`).
4. **The Stripe connected account's country is never stored or checked.**
   `ensurePaymentAccount` sends `country` only when `tax_country` is set
   (`Store/src/lib/payments/connect/account.ts:153-164`, fed from
   `Store/src/lib/payments/connect/actions.ts:59-66`). The `StripeAccount` type
   has no `country` (`Store/src/lib/billing/stripe-api.ts:110-115`),
   `seller_payment_accounts` has no country column
   (`Store/supabase/migrations/20261008_seller_payment_accounts.sql:33-49`),
   `account.updated` stores only three booleans
   (`Store/src/lib/payments/connect/webhook.ts:165-175`), and
   `canTakePayments` checks only `charges_enabled` and live mode
   (`Store/src/lib/payments/connect/account.ts:102-104`).
5. **Stripe Connect is switched off and has never run against real Stripe**
   (`Store/src/lib/payments/availability.ts:26-30`; the switch appears only
   commented out at `Store/.env.production:47`). So no live connected accounts
   should exist yet (inferred), which makes forcing `country: "CZ"` at account
   creation a pre-launch change rather than a migration of live accounts.
6. **There is one natural choke point for a seller-country rule:
   `missingTraderIdentity` / `buildTraderIdentityInput`.** Every write-side and
   read-side gate funnels through them, and every gate read already selects
   `tax_country` (via `TRADER_GATE_SELECT`,
   `Store/src/lib/settings/seller-identity.ts:55-56`, `:81-82`). Adding the
   rule only to `sellerMaySell` would miss four read paths that call
   `isTraderIdentityComplete` directly (embed API, OG image, two MCP previews)
   and the whole write side.
7. **No collab (multi-seller) checkout exists in Store.** Every order and cart
   is one storefront, and the gate only admits products owned by that
   storefront's owner (`Store/src/lib/products/purchasable.ts:276-284`). R5 is
   structurally satisfied in Store today (other repos not checked here).
8. **No seller waitlist exists in Store.** The only waitlist table,
   `waitlist_signups` (email, source, list_id, owner_id; no country), is
   written from Home over the anon key
   (`Store/supabase/migrations/20260807_db_hygiene.sql:27-54`); Store never
   writes it.

---

## 1. Where seller facts live (data model)

| Table / column | Meaning | Written by (Store) | DB constraint today |
|---|---|---|---|
| `profiles.tax_country` | Seller "Country" ("Where your business is based") | `saveTaxInfo` (session client), direct PostgREST by owner | `^[A-Z]{2}$` or null (`Store/tests/db/prod-migrations.sql:261-262`) |
| `profiles.tax_business_name` | Legal/trader name | `saveTaxInfo` via service role (guarded) | 1 to 200 chars (`prod-migrations.sql:257-258`); service-role only via `guard_seller_text` (`20261012_auto_moderation.sql:735-777`) |
| `profiles.tax_vat_id` | VAT ID | `saveTaxInfo`, direct PostgREST | `^[A-Za-z0-9 .-]{2,32}$` (`prod-migrations.sql:259-260`); no VIES check |
| `profiles.seller_address` | Published postal address, free text | `saveTaxInfo`, direct PostgREST | 1 to 300 chars (`20260905_seller_identity_on_profile.sql:42-43`) |
| `profiles.seller_email` | Published contact email | `saveTaxInfo`, direct PostgREST | shape regex (`20260905_seller_identity_on_profile.sql:44-48`); proof dropped on change (`20260926_contact_verification.sql:315-318`) |
| `profiles.seller_phone` | Published phone, E.164 | `saveTaxInfo`, direct PostgREST | 1 to 32 chars (`20260905_seller_identity_on_profile.sql:49-50`) |
| `profiles.seller_email_verified_at`, `seller_phone_verified_at` | Contact proofs | RPC `redeem_contact_verification` (service role) | Only service role may set (`20260926_contact_verification.sql:285-334`) |
| `profiles.username`, `avatar_url`, `seller_bio`, `locale`, `legal_accepted_*`, `deletion_requested_at`, `onboarding_completed_at`, `setup_celebrated_at`, `editor_tour_seen_at`, `notify_*`, `ai_suggest_as_you_type`, `shipping_policy` | Account/profile state | See section 2 | Various; none mention country |
| `profiles.is_seller` | Legacy flag | Never written by Store (searched `src` for `is_seller`: comments and types only) | default false |
| `seller_payment_accounts` | Stripe connected account per seller (owner_id PK, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, livemode) | `ensurePaymentAccount`, `saveAccountFacts` (service role) | Service role only (`20261008_seller_payment_accounts.sql:61-63`); **no country column** |
| `seller_billing` | Seller as the platform's Stripe Billing customer | `ensureBillingCustomer`, RPC `billing_apply_snapshot` | Service role only (`20260930_seller_plans.sql:126-127`) |
| `plan_grants` | Staff-given plan | Admin only (`Admin/src/app/(app)/plans/actions.ts:115`, `:212`, `:268` call `plan_grant_set` / `plan_grant_end`); Store reads | (not opened) |
| `seller_fee_waivers` | Per-sale fee waiver | No Store writer; seeded by migration | Service role only (`20261011_pricing_config.sql:355-379`) |
| `billing_switches` | Launch switches (limits, fees, entitlements) | No Store writer | Service role only (`20260930_seller_plans.sql:201`, `:214-215`) |
| `plan_cancellations`, `stripe_events`, `seller_funnel_events` | Billing side tables | Service role from billing actions/webhooks | Service role only (`20260930_seller_plans.sql:151-152`, `:190-191`) |
| `team_members` | Invites and roles | `inviteMember`, `changeMemberRole`, `revokeMemberAccess` (session client + RLS + trigger), RPC `team_accept_invite` | (RLS and guard trigger, not opened) |
| `account_deletion_requests` | Deletion request the job acts on | `recordDeletionRequest` / `withdrawDeletionRequest` (service role) | (not opened) |
| `signup_intents` | Single-use permission to create an email account | `recordSignupIntent` (service role) | Service role only (`20261021_signup_intents.sql:40-56`) |
| `contact_verifications` | Pending codes | RPC `issue_contact_verification` | (not opened) |
| `waitlist_signups` | Marketing waitlist (email, source, list_id, owner_id) | Not written by Store; anon insert policy for Home | `owner_id is null and list_id is null`, email <= 254, source <= 64 (`20260807_db_hygiene.sql:45-54`); **no country column** (`Store/src/types/supabase.ts:2934-2960`) |
| `storefronts.config.embed` | Embed on/off + allowlist | `updateEmbedSettings`, also `saveStorefront` | jsonb, schema-validated in app |

There is no `stores` table: the account (the `profiles` row) is the store, and
team members act on the owner's account (`Store/src/lib/team/account-context.ts:47-86`).
Searched `src` and `supabase/migrations` for `from("stores")` / `public.stores`: none.

---

## 2. Inventory of write paths

Column key: **Entry** = UI component then server entry point. **Validation** =
what runs today. **Authz** = who can call it. **Country** = country fields read
or written.

### 2A. Sign-up, authentication, credentials

| # | Entity / op | Entry | Server code | Validation today | DB written | Authz | Country |
|---|---|---|---|---|---|---|---|
| A1 | Account create: email + password | `Store/src/app/(auth)/login/page.tsx` (intent `signup`) | `authenticate`, signup branch `Store/src/lib/auth/actions.ts:355-462` | passwords match `:357`; `usernameSchema` `:360-365`; `passwordProblem` `:370-371`; disposable/placeholder email `:376-378`; Turnstile `:382-386`; per-address and per-client budgets `:389-395`; handle taken `:400-402`; breached password `:405-407`; intent `:412` | `auth.users` (GoTrue `signUp` `:416-431`, handle in user metadata `:428`); `profiles` insert by trigger `handle_new_user` (`Store/supabase/migrations/20261021_reserved_usernames.sql:76-115`, insert of id, username, avatar_url only `:103-112`); `signup_intents` (`Store/src/lib/auth/signup-intent.ts:35-52`), spent by hook `signup_intent_gate` (`20261021_signup_intents.sql:60-102`) | Anonymous | None collected |
| A2 | Account create: Google OAuth | Login page Google button | `signInWithGoogle` `Store/src/lib/auth/actions.ts:644-671` then `GET /auth/callback` `Store/src/app/(auth)/auth/callback/route.ts:25-81` (`exchangeCodeForSession` `:38`) | None app-side for a new account (no Turnstile, no disposable check); the Before User Created hook passes OAuth through (`20261021_signup_intents.sql:77-80`); hook enablement is a dashboard setting (`:26-33`) | `auth.users`; `profiles` via `handle_new_user` (name from `full_name`/`name`, picture: `20261021_reserved_usernames.sql:86-110`) | Anonymous | None collected |
| A3 | Magic link sign-in | Login page | `authenticate` intent `magic` `Store/src/lib/auth/actions.ts:276-310` | `shouldCreateUser: false` `:295` (never creates an account); budgets `:279` | none (session only) | Anonymous | None |
| A4 | Password reset / set | Login page, `/reset-password` | `authenticate` intent `reset` `:313-347`; `resetPassword` `:529-636` | budgets; strength; breached; 2FA-aware `actionUser` `:561` | `auth.users` | Link holder / session | None |
| A5 | Change sign-in email | Settings > Account | `requestEmailChange` `Store/src/lib/settings/actions.ts:235-322` | `emailChangeSchema` `Store/src/lib/validation/settings.ts:48-51`; rate limit `:261`; step-up `:273`; password re-check `:285-304` | `auth.users` (via Supabase confirm flow `:306-309`) | Signed-in user, own account | None |
| A6 | Settings password reset link | Settings > Account | `sendPasswordReset` `Store/src/lib/settings/actions.ts:340-384` | two budgets `:355-363` | none (mail) | Signed-in user | None |
| A7 | MFA, passkeys, sign-in approvals | Settings > Security, login | `Store/src/lib/auth/mfa-actions.ts`, `Store/src/lib/auth/sign-in-approval-actions.ts` (all listed `Store/tests/unit/agent/registry.test.ts:52-73`; not opened in detail) | (not opened) | auth factors, `sign_in_approvals` (inferred) | Signed-in user | Sign-in approval records the device's `cf-ipcountry` (`Store/src/lib/auth/sign-in-approval-actions.ts:108`, `Store/src/lib/auth/device-label.ts:47-50`): a location, not establishment |

### 2B. Profile, handle, bio, avatar, locale, legal, onboarding

| # | Entity / op | Entry | Server code | Validation today | DB written | Authz | Country |
|---|---|---|---|---|---|---|---|
| B1 | Username (handle) update | `Store/src/components/settings/UsernameForm.tsx:49`; MCP `update_username` (`Store/src/lib/agent/tools/store.ts:159-168`) | `updateUsername` `Store/src/lib/settings/actions.ts:144-184` | field whitelist `:150`; `usernameSchema` `:153-156`; rate limit `:158`; moderation `handleRefusal` `:165-166` | `profiles.username` via session client `:168-175`; unique index decides races; reserved-name CHECK (`20261021_reserved_usernames.sql:68-72`) | Signed-in user, own row (MCP: owner only `store.ts:164`) | None |
| B2 | Bio update | `Store/src/components/settings/BioForm.tsx:30`; MCP `update_bio` (`store.ts:171-180`) | `updateBio` `Store/src/lib/settings/actions.ts:198-225` | `bioSchema` (`Store/src/lib/validation/settings.ts:150-152`); rate limit; `sellerTextRefusal` `:217-218` | `profiles.seller_bio` via `writeOwnProfile` (session write then service role for guarded column: `Store/src/lib/moderation/auto/seller-text.ts:96-131`) | Signed-in user, own row | None |
| B3 | Avatar set/remove | `Store/src/components/settings/AvatarUpload.tsx:18`; MCP `set_avatar`/`remove_avatar` (`store.ts:211-236`) | `uploadAvatar` `Store/src/lib/settings/avatar.ts:59` (profile write `:125-127`), `removeAvatar` `:138` (`:163-165`) | magic-byte sniff, moderation (not re-read here, see memory note); `guard_avatar_url` trigger (`20261105_write_bounds.sql:197-199`) | Storage bucket `avatars`; `profiles.avatar_url` | Signed-in user | None |
| B4 | Locale | `Store/src/components/layout/LocaleSelect.tsx:31`, `ProfileMenu.tsx` | `setLocale` `Store/src/i18n/actions.ts:23` (write `:34-36`); also on sign-in `Store/src/i18n/sign-in.ts:45-47` | (not opened in detail) | `profiles.locale` | Signed-in user | None |
| B5 | Notification prefs | Settings > Notifications; MCP `save_notification_settings` (`store.ts:183-208`) | `saveNotifications` `Store/src/lib/settings/actions.ts:584-613` | `notificationsSchema` (`validation/settings.ts:154-159`) | `profiles.notify_*` | Signed-in user | None |
| B6 | AI typing switch | Product form | `saveSuggestAsYouType` `Store/src/lib/settings/actions.ts:623-630` | boolean check | `profiles.ai_suggest_as_you_type` | Signed-in user | None |
| B7 | Accept Terms | `Store/src/components/settings/LegalSection.tsx:48`; welcome flow (`WelcomeFlow.tsx:122`, hidden version `:417`) | `acceptLegal` `Store/src/lib/settings/actions.ts:399-422` | `legalAcceptSchema` must equal `LEGAL_VERSION` (`validation/settings.ts:162-164`) | `profiles.legal_accepted_at`, `legal_accepted_version` | Signed-in user | None (the Terms themselves promise EU + US + CA: `Store/src/lib/settings/constants.ts:104-108`) |
| B8 | Onboarding flags | `Store/src/components/onboarding/OnboardingPanel.tsx:129`; designer tour | `completeOnboarding` `Store/src/lib/onboarding/actions.ts:24-44`; `markSetupCelebrated` `:62-77`; `markEditorTourSeen` `:87-102` | first write wins (`.is(null)`) | `profiles.onboarding_completed_at`, `setup_celebrated_at`, `editor_tour_seen_at` | Signed-in user | None |
| B9 | Welcome flow trader step | `Store/src/components/onboarding/WelcomeFlow.tsx:123` | `saveTaxInfo` (see C1) with only `tax_business_name`, `seller_address`, `seller_email` (`WelcomeFlow.tsx:436`, `:454`, `:477`) | as C1 (partial write `Store/src/lib/settings/actions.ts:455-470`) | as C1 | Signed-in user | **Does not ask for or touch `tax_country`** |
| B10 | Shipping terms (shipsFrom) | Settings > Shipping; MCP `save_shipping_policy` | `saveShippingPolicy` `Store/src/lib/settings/shipping-actions.ts:71` (write `:113`) | `shippingPolicySchema.shipsFrom` in `OPERATING_COUNTRY_CODES` (`Store/src/lib/validation/shipping-policy.ts:71-76`) | `profiles.shipping_policy` (guarded column) | Signed-in user | `shipsFrom` (a separate "ships from" country, defaulted in the UI from `tax_country`: `Store/src/app/settings/shipping/page.tsx:38-41`). Detailed in the shipping inventory part. |

### 2C. Trader identity and establishment

| # | Entity / op | Entry | Server code | Validation today | DB written | Authz | Country |
|---|---|---|---|---|---|---|---|
| C1 | Trader identity save (name, address, contact email, VAT ID, **country**, phone) | `Store/src/components/settings/TaxSection.tsx:179` on `/settings/business` (`Store/src/app/settings/business/page.tsx:50-64`); welcome flow (B9). `/settings/tax` redirects (`Store/src/app/settings/tax/page.tsx:7-9`). Not reachable by MCP (`Store/tests/unit/agent/registry.test.ts:85`). | `saveTaxInfo` `Store/src/lib/settings/actions.ts:446-580` | whitelist `TAX_FIELDS` `:436-443`, `:452`; only sent keys written `:461-470`; `taxSchema.partial()` (`Store/src/lib/validation/settings.ts:124-138`): address quality `:70-75`, contact email format + quality `:106-115`, VAT ID shape `:128-130`, **country in `OPERATING_COUNTRY_CODES` or "" to null `:131-136`**; step-up when 2FA `:475-476`; rate limit `:478`; MX lookup (fail-open) `:491-495`; trader name moderation `:517-520`; phone to E.164 using `tax_country` as default region and `SMS_REGIONS` fence `:527-534` (`Store/src/lib/validation/phone.ts:49-74`) | `profiles` columns via `writeOwnProfile` `:548` (session client + RLS; `tax_business_name` via service role); proofs dropped by trigger on change (`20260926_contact_verification.sql:315-322`); then codes issued `:558-568` | Signed-in user, **own row only** (`user.id`, never the active account): a team member cannot change the owner's identity (page note `Store/src/app/settings/business/page.tsx:35-49`) | **Writes `tax_country`**; reads `tax_country` for phone parsing `:503-513`, `:530` |
| C2 | Direct PostgREST update of own `profiles` row | Any client holding the user's JWT and the public anon key | none (RLS policy "Users can update their own profile" `Store/tests/db/prod-migrations.sql:102-108`, plus restrictive 2FA policy `Store/supabase/migrations/20260923_two_factor_auth.sql:74-109`) | Only DB CHECKs and triggers: `tax_country ~ '^[A-Z]{2}$'`; seller text guarded; proofs guarded; avatar guarded | any non-guarded `profiles` column, including `tax_country`, `tax_vat_id`, `seller_address`, `seller_email`, `seller_phone`, `username` | The row's owner (aal2 when enrolled) | **`tax_country` can be set to any 2 capital letters, bypassing `OPERATING_COUNTRY_CODES`** |
| C3 | Send contact code | `Store/src/components/settings/ContactVerification.tsx:54`; `WelcomeFlow.tsx:124` | `sendContactCode` `Store/src/lib/contact-verification/actions.ts:27-48` then `issueContactCode` `Store/src/lib/contact-verification/service.ts:155-273` | channel schema; availability `:159-169`; cooldown and budgets `:171-235`; stored value re-checked `:207-208` | RPC `issue_contact_verification` `:241-246` (`contact_verifications`) | Signed-in user, own profile; never via MCP (`registry.test.ts:91-92`) | Phone texts only to `SMS_REGIONS` (EU + IS, LI, NO, CH, GB; no US/CA: `Store/src/lib/contact-verification/policy.ts:48-55`) |
| C4 | Confirm contact code | Same components | `confirmContactCode` `Store/src/lib/contact-verification/actions.ts:51-76` then `redeemContactCode` `service.ts:278-313` | code schema; rate limit `:283` | RPC `redeem_contact_verification` `:291-299` sets `seller_*_verified_at` (service role) | Signed-in user, own profile | None |
| C5 | Business registration number (IČO) / company register | none | none | none | none | n/a | Searched `src` for `registration_number`, `company_number`, `ico`, `IČO`, `dic`, `business_id`: no field exists |

### 2D. Team invites and roles

| # | Entity / op | Entry | Server code | Validation today | DB written | Authz | Country |
|---|---|---|---|---|---|---|---|
| D1 | Invite member | `Store/src/components/settings/team/InviteModal.tsx:50` | `inviteMember` `Store/src/lib/team/actions.ts:120-291` | whitelist `:127-133`; `teamInviteSchema` `:135-140`; DB actor role + `can("team.invite")` + `canGrant` `:145-151`; seat limit `:161-162`; step-up `:168-169`; rate limit `:177` | `team_members` insert (session client, RLS + trigger) `:181-187`; notification; email | Owner or editor of the account (`Store/src/lib/team/permissions.ts:48-70`) | None |
| D2 | Accept invite | Settings > Team; bell inline action (`Store/src/lib/notifications/actions.ts:92`, `:122`) | `acceptInvite` `Store/src/lib/team/actions.ts:300-326` then `acceptTeamInvite` `Store/src/lib/team/accept.ts:38-133` | invite email must equal session email `:85-91`; rate limit `:51` | RPC `team_accept_invite` `:97-100` | The invitee | None |
| D3 | Change role | `Store/src/components/settings/team/MemberRow.tsx:86` | `changeMemberRole` `Store/src/lib/team/actions.ts:335-396` | `can("team.change_role")`, `canGrant`, step-up | `team_members.role` `:373-382` | Owner | None |
| D4 | Revoke member | `MemberRow.tsx:88` | `revokeMemberAccess` `Store/src/lib/team/actions.ts:404-475` | `can("team.revoke")`, not self, step-up | `team_members.status = revoked` `:453-461` | Owner | None |
| D5 | Switch active store | `Store/src/components/layout/ProfileMenu.tsx:88`, `ViewingBanner.tsx:39` | `setActiveAccount` `Store/src/lib/team/actions.ts:490-504` | membership via `getActorRole` | cookie only | Member | None. Note: all publish gates use the ACCOUNT (owner) id, so the owner's `tax_country` is what any country rule must read (`Store/src/lib/settings/seller-identity.ts:295-297`). |

### 2E. Stripe connected accounts (buyer payments)

| # | Entity / op | Entry | Server code | Validation today | DB / external written | Authz | Country |
|---|---|---|---|---|---|---|---|
| E1 | Create connected account + onboarding link | `Store/src/components/payments/ConnectStripeModal.tsx:34`, `:47`, `:77-82` (disabled while Connect is off); `Store/src/components/payments/ConnectionStatusCard.tsx:48` | `startStripeOnboarding` `Store/src/lib/payments/connect/actions.ts:51-73` then `ensurePaymentAccount` `Store/src/lib/payments/connect/account.ts:144-184` then `onboardingLink` `:192-201` | owner of the active store with `billing.manage` `actions.ts:28-36`; `stripeConnectLive()` (`Store/src/lib/payments/connect/config.ts:32-34`); rate limit `actions.ts:54`. **No trader-identity or country precondition.** | Stripe `POST /accounts` with exactly: `type: "express"`, `country` (only if known), `email` (seller_email, else sign-in email), `capabilities.card_payments.requested`, `capabilities.transfers.requested`, `metadata.owner_id`, idempotency key `connect_account_<owner>` (`account.ts:153-164`); then `seller_payment_accounts` upsert (owner_id, stripe_account_id, 3 booleans, livemode) `:166-179`; Stripe `POST /account_links` type `account_onboarding`, return and refresh both `PAYMENTS_CONNECT_RETURN_PATH` `:194-199` | Store owner only; never via MCP (`registry.test.ts:163`) | **Reads `tax_country`** through `getSellerIdentity` (`actions.ts:59`, `:65`; `Store/src/lib/settings/seller-identity.ts:155`, `:171-183`) and passes it as Stripe `country`. Unset, or a failed read (returns `{}` at `seller-identity.ts:178-181`), sends no country. An existing account is returned without any re-check (`account.ts:150-151`). |
| E2 | Return / refresh from Stripe onboarding | Stripe redirect | `GET /api/payments/connect/return` `Store/src/app/api/payments/connect/return/route.ts:27-43` then `refreshPaymentAccount` `Store/src/lib/payments/connect/account.ts:129-135` | owner + live + rate limit `route.ts:34` | Stripe `GET /accounts/{id}`; `seller_payment_accounts` 3 booleans only (`saveAccountFacts` `account.ts:108-118`) | Signed-in owner of the active store | Stripe's `country` is in the response but not typed or stored (`Store/src/lib/billing/stripe-api.ts:110-115`) |
| E3 | `account.updated` webhook | Stripe Connect endpoint | `POST /api/payments/webhook` `Store/src/app/api/payments/webhook/route.ts:32-53` then `handleConnectEvent` `Store/src/lib/payments/connect/webhook.ts:124-158`, case `:165-175` | signature `route.ts:38-46`; mode `webhook.ts:127`; event type allowlist `:42-48`; seller resolved from `seller_payment_accounts` `:144` | `stripe_events`; `seller_payment_accounts` 3 booleans | Stripe (signed) | Ignores `country`, `requirements`, `capabilities`, `disabled_reason`; `requirementsDue` is always `[]` (`Store/src/lib/payments/connect/overview.ts:66`, `:77`) |
| E4 | Other Connect events (payments, refunds, disputes, expiry) | Same endpoint | `webhook.ts:177-277` | as E3 | `orders`, fee ledger | Stripe | None |
| E5 | Express dashboard link | `Store/src/components/payments/PayoutMethodCard.tsx:22`; `Store/src/components/orders/OrderActions.tsx:80` | `openStripeDashboard` `Store/src/lib/payments/connect/actions.ts:81-98` then `dashboardLink` `account.ts:208-214` (or `onboardingLink` if details not submitted) | owner + live + rate limit | Stripe `POST /accounts/{id}/login_links` | Store owner | None |
| E6 | Disconnect / deauthorize | none | none | n/a | n/a | n/a | Searched `src` for `deauthoriz`, `application.deauthorized`, disconnect: none. `account.application.deauthorized` is not in `CONNECT_EVENT_TYPES` (`webhook.ts:42-48`). Account deletion cascades the row only; "The Stripe account itself lives on" (`20261008_seller_payment_accounts.sql:25-26`). |
| E7 | Payout / balance reads | `/payments` page | `realPaymentsOverview` `Store/src/lib/payments/connect/overview.ts:165-204` | live + row exists | none (Stripe GETs) | Store member with access to the page | `FALLBACK_CURRENCY = "EUR"` `:57` |
| E8 | Checkout use of the account | Buyer checkout | `checkoutProviderFor` `Store/src/lib/checkout/availability.ts:73-83`; `placeStripeOrder` re-check `Store/src/lib/checkout/stripe-provider.ts:79-81` | `canTakePayments` = `charges_enabled && livemode matches` (`Store/src/lib/payments/connect/account.ts:102-104`); order links, Turnstile, mail (`availability.ts:61-64`, `:74`) | Stripe Checkout Session on the connected account (`stripe-provider.ts:122-168`) | Buyer (anonymous) | **No seller-country check** |

### 2F. Seller plans and billing (platform as merchant to the seller)

| # | Entity / op | Entry | Server code | Validation today | DB / external written | Authz | Country |
|---|---|---|---|---|---|---|---|
| F1 | Start paid plan checkout | `Store/src/components/billing/PlansPage.tsx:100`, `UpgradeCard.tsx:94` | `startCheckout` `Store/src/lib/billing/actions.ts:118-171` | owner of own store `billingOwner` `:81-95`; `checkoutSchema` `:70-74`; rate limit `:127`; not already subscribed `:136-138` | `ensureBillingCustomer` `Store/src/lib/billing/customer.ts:24-62`: Stripe `POST /customers` with `address.country` from `tax_country` when set (`Store/src/lib/billing/stripe-provider.ts:144-174`, country `:150`, `tax_id_data` eu_vat `:160`); `seller_billing` upsert `customer.ts:48-52`; Stripe Checkout `mode: subscription`, `automatic_tax`, `billing_address_collection: required`, `customer_update.address: auto` (`stripe-provider.ts:176-199`); `seller_funnel_events` | Owner; never via MCP (`registry.test.ts:159`) | **Reads `tax_country`** (`customer.ts:33-37`, `:43`) for the platform's own invoice; prices in `BILLING_CURRENCY = "EUR"` (`Store/src/lib/billing/plans.ts:39`) |
| F2 | Customer Portal (card, invoices, switch plan) | `Store/src/components/billing/PortalButton.tsx` | `openBillingPortal` `Store/src/lib/billing/actions.ts:190-250` | owner; schema; step-up `:205-206`; rate limit | Stripe portal session; funnel | Owner | None (address edited in Stripe) |
| F3 | Cancel plan | `Store/src/components/billing/CancelPlanDialog.tsx:153` | `cancelPlan` `Store/src/lib/billing/actions.ts:281-321` | owner; feedback schema `:257-265`; rate limit | Stripe subscription; `plan_cancellations` insert `:386-403` | Owner | None |
| F4 | Resume plan | `Store/src/components/billing/KeepPlanButton.tsx:41` | `resumePlan` `Store/src/lib/billing/actions.ts:331-374` | owner; refused while deletion pending `:343-350` | Stripe; `plan_cancellations.resumed_at` `:362-366` | Owner | None |
| F5 | Billing webhook | Stripe platform endpoint | `POST /api/billing/webhook` `Store/src/app/api/billing/webhook/route.ts:27-46` then `handleStripeEvent` `Store/src/lib/billing/webhook.ts:89-139` | signature; Connect events ignored `:90`; mode `:91`; type allowlist `:35-45`; owner from `seller_billing.stripe_customer_id` `:109-113` | `stripe_events`; RPC `billing_apply_snapshot` (`Store/src/lib/billing/sync.ts:141-147`; definition `20260930_seller_plans.sql:383`); notifications | Stripe (signed) | None |
| F6 | Checkout return sync | `/settings/billing?session=...` | `confirmCheckoutReturn` `Store/src/lib/billing/checkout-return.ts:34-48` via `Store/src/app/settings/billing/page.tsx:45` | (not opened in detail) | `billing_apply_snapshot` | Owner | None |
| F7 | Plan grants | Admin panel | `Admin/src/app/(app)/plans/actions.ts:115`, `:212`, `:268` (RPCs `plan_grant_set`, `plan_grant_end`); Store reads only (`Store/src/lib/billing/account-plan.ts:140-152`; rule `Store/src/lib/billing/grants.ts:78-84`) | Admin side (not opened) | `plan_grants` | Staff | None |
| F8 | Fee waivers | none in Store; seeded by migration | read by `readFeeWaiver` `Store/src/lib/billing/sale-fee.ts:30-46` | n/a | `seller_fee_waivers` (service role only `20261011_pricing_config.sql:355-379`) | Service role / staff | None |
| F9 | Billing switches | none in Store | read by `readBillingSwitches` `Store/src/lib/billing/switches.ts:28-44` (read failure = all off) | n/a | `billing_switches` (service role only) | Staff (DB) | None |
| F10 | End plan on deletion request | Settings > Danger | `endPlanForDeletion` `Store/src/lib/billing/lifecycle.ts:17` from `Store/src/lib/settings/actions.ts:700` | best effort | Stripe subscription | Signed-in owner | None |

### 2G. Publish and sell gates

The predicate: `missingTraderIdentity` (`Store/src/lib/settings/trader-identity.ts:115-144`)
over the input built by `buildTraderIdentityInput` (`Store/src/lib/settings/seller-identity.ts:109-120`),
which re-validates stored address and email so a REST-written placeholder
counts as missing. Required fields: `businessName`, `address`, `email`, and
`emailVerified` when `emailProofRequired()` (mail is configured:
`Store/src/lib/contact-verification/availability.ts:25-27`). **Country is
read (`TRADER_GATE_SELECT` includes `tax_country`) but not used.**

**Write side** (refuses a write that makes something buyer-visible): `publishBlockedError`
`Store/src/lib/settings/seller-identity.ts:304-313` (uncached service-role
read `:248-284`, fails closed).

| # | Path | Entry | Gate call | Notes |
|---|---|---|---|---|
| G1 | Create product as active | Product form; MCP `create_product` | `createProduct` `Store/src/lib/products/actions.ts:341`, gate `:367` via `publishGate` `:333-339` | Drafts never gated (`:327-331`) |
| G2 | Update product to active | Product form; MCP `update_product`, `publish_products` (`Store/src/lib/agent/tools/products.ts:231-290`, calls `updateProduct` `:284`) | `updateProduct` `Store/src/lib/products/actions.ts:431`, gate `:456` | |
| G3 | Set product status (card) | Product card; MCP `update_product` | `setProductStatus` `Store/src/lib/products/card-actions.ts:44-68`, gate `:65-68` | |
| G4 | CSV import as active | `/products/import`; MCP `import_products` | `importProducts` `Store/src/lib/products/import-actions.ts:165-168` | |
| G5 | Embed switched ON | Embed page; MCP `update_embed_settings` (`Store/src/lib/agent/tools/storefronts.ts:409-424`) | `updateEmbedSettings` `Store/src/lib/storefront/actions.ts:478`, gate `:510-513` | Turning off never gated |

**Read side** (refuses to show or sell; every one fails closed):

| # | Surface | Code | Predicate call |
|---|---|---|---|
| G6 | THE product gate (product page, product checkout page, cart, cart page, discount check, quote) | `gatePurchasableLines` `Store/src/lib/products/purchasable.ts:215-348`; profile read `:285-292`; gate `:321-322` | `sellerMaySell` (`seller-identity.ts:128-132`) |
| G6a | Hosted product page | `getPublicProductPage` `Store/src/lib/products/public.ts:215-226` | via G6 (`gatePurchasable` `purchasable.ts:178-190`) |
| G6b | Product checkout page | `Store/src/lib/checkout/page.ts:34` | via G6 |
| G6c | Quote at order placement (R6 point) | `placeOrderResponse` `Store/src/lib/checkout/place-order.ts:89`, `quoteOrder` `:128-139` (`Store/src/lib/checkout/quote.ts:158-162`) | via G6; then `checkoutProviderFor` `place-order.ts:157-158`; then `placeStripeOrder` `Store/src/lib/checkout/stripe-provider.ts:79-81`. Routes: `Store/src/app/api/checkout/[storefrontId]/route.ts:2`, `Store/src/app/api/checkout/[storefrontId]/[productId]/route.ts:3` |
| G6d | Cart routes and page | `Store/src/lib/cart/route.ts:33`; `Store/src/lib/checkout/cart-page.ts:53`; `Store/src/app/(public)/s/[storefrontId]/cart/page.tsx:38` | via G6 |
| G6e | Discount code check | `Store/src/lib/checkout/discount-check.ts:67` | via G6 |
| G7 | Hosted storefront page and embed frame `/e/...` | `buildStorefrontPage` `Store/src/lib/storefront/storefront-page.ts:193-266` (gate `:265-266`), from `getPublicStorefrontPage` `:156-180` and `Store/src/lib/storefront/embed-frame-loader.ts:78` | `sellerMaySell` |
| G8 | Embed widget JSON | `GET /api/embed/[key]` `canPublish` `Store/src/app/api/embed/[key]/route.ts:56-79`, used `:172-175` | **direct** `isTraderIdentityComplete(buildTraderIdentityInput(...))` (not `sellerMaySell`) |
| G9 | OG share image | `Store/src/app/api/og/p/[productId]/route.ts:84-102` | **direct** `isTraderIdentityComplete` |
| G10 | MCP product page preview | `Store/src/lib/agent/preview/product-page-preview.ts:112`, `:162` | **direct** `isTraderIdentityComplete` |
| G11 | MCP storefront preview | `Store/src/lib/agent/preview/storefront-preview.ts:95`, `:120` | **direct** `isTraderIdentityComplete` |
| G12 | Sitemap | `Store/src/lib/seo/sitemap.ts:146-161` | `sellerMaySell` |

**Display-only consumers** (no enforcement): `getTraderIdentityStatus`
(`Store/src/lib/settings/seller-identity.ts:216-233`) in
`Store/src/components/dashboard/DashboardShell.tsx:54`,
`Store/src/app/(dashboard)/dashboard/page.tsx:121`,
`Store/src/app/(dashboard)/products/page.tsx:120`,
`Store/src/app/(dashboard)/products/new/page.tsx:88`,
`Store/src/app/(dashboard)/products/[id]/edit/page.tsx:71`,
`Store/src/app/(dashboard)/products/import/page.tsx:40`,
`Store/src/app/storefront/(list)/page.tsx:49`,
`Store/src/app/storefront/(list)/[id]/embed/page.tsx:51`,
`Store/src/app/storefront/(designer)/[id]/page.tsx:94`, MCP `get_store`
(`Store/src/lib/agent/tools/store.ts:41-44`, `:80`); and
`missingTraderIdentity` in the designer (`Store/src/components/storefront/ProductPageSection.tsx:747`).

**Payment-side gate** (separate from trader identity): `checkoutProviderFor`
(`Store/src/lib/checkout/availability.ts:73-83`) is also consulted by
`Store/src/lib/cart/route.ts:37`, `Store/src/lib/cart/availability.ts:49`,
`Store/src/lib/checkout/cart-page.ts:61`, `Store/src/lib/checkout/discount-check.ts:72`,
`Store/src/app/(public)/s/[storefrontId]/checkout/page.tsx:86`,
`Store/src/app/(public)/s/[storefrontId]/p/[productId]/checkout/page.tsx:128`,
`checkoutAvailableFor` (`availability.ts:106-111`, from `Store/src/lib/products/public.ts:237`,
`Store/src/lib/checkout/page.ts:46`, `Store/src/lib/agent/preview/product-page-preview.ts:131`),
and dashboard pages for display.

### 2H. Account deletion

| # | Entity / op | Entry | Server code | Validation today | DB written | Authz | Country |
|---|---|---|---|---|---|---|---|
| H1 | Request deletion | `Store/src/components/settings/DeleteAccountForm.tsx:63` on `/settings/danger` | `requestAccountDeletion` `Store/src/lib/settings/actions.ts:643-703` | confirm phrase (`validation/settings.ts:172-180`); step-up `:657`; rate limit | `account_deletion_requests` upsert (service role, `Store/src/lib/account-deletion/requests.ts:49-59`); `profiles.deletion_requested_at` `:667-669`; revokes MCP grants `:672`; ends plan `:700` | Signed-in user, own account; never via MCP (`registry.test.ts:86`) | None |
| H2 | Cancel deletion | `DeleteAccountForm.tsx:67` | `cancelAccountDeletion` `Store/src/lib/settings/actions.ts:705-727` | only before start (`requests.ts:66-84`) | deletes request row; clears flag | Signed-in user | None |
| H3 | Run deletions (cron) | `POST /api/cron/account-deletions` `Store/src/app/api/cron/account-deletions/route.ts:22-26` (`cronAuthorized`) | `runAccountDeletions` `Store/src/lib/account-deletion/run.ts:344`; `auth.admin.deleteUser` `:318` | grace period + buyer holds (`requests.ts:90+`, not fully re-read) | auth user deleted; cascades to `profiles`, `seller_payment_accounts`, `seller_billing` (FKs) | Cron secret | None. Stripe connected account is not closed (E6). |

### 2I. Waitlist

| # | Entity / op | Entry | Server code | Validation today | DB written | Authz | Country |
|---|---|---|---|---|---|---|---|
| I1 | Join marketing waitlist | Home site form (not in Store) | none in Store; anon insert policy `Store/supabase/migrations/20260807_db_hygiene.sql:45-54` | `owner_id`/`list_id` null; email <= 254; source <= 64 | `waitlist_signups` | Anonymous (anon key) | **No country column** (`Store/src/types/supabase.ts:2934-2960`). No seller expansion waitlist exists in Store (searched `waitlist`, `wait_list`, `expansion`, `notify me` outside messages: only docs, the types and the migration). |

---

## 3. Choke points (one validator covers many paths)

| # | Function | Location | What funnels through it | Already has `tax_country` in hand? |
|---|---|---|---|---|
| CP1 | `missingTraderIdentity` (+ `isTraderIdentityComplete`) | `Store/src/lib/settings/trader-identity.ts:115-152` | Every gate: write side via `publishBlockedError` (G1 to G5), read side via `sellerMaySell` (G6, G7, G12) and direct calls (G8 to G11), dashboard status (`getTraderIdentityStatus`), designer warning | Only if the input carries it: today `TraderIdentityInput` = `StorefrontSeller` + `emailVerified` (`:51-53`), and `StorefrontSeller` already has `country` (set by `buildSellerIdentity` `seller-identity.ts:155`) |
| CP2 | `buildTraderIdentityInput` | `Store/src/lib/settings/seller-identity.ts:109-120` | Every gate reader except the designer warning; it builds only businessName, address, email, emailVerified | Yes: all its callers select `TRADER_GATE_SELECT` (`:81-82`), which includes `tax_country`; so is the account row (`Store/src/lib/settings/account-row.ts:37-38`) and the sitemap batch (`Store/src/lib/seo/sitemap.ts:149`) |
| CP3 | `sellerMaySell` | `Store/src/lib/settings/seller-identity.ts:128-132` | G6 (product page, checkout pages, cart, discount, **quote at placement**), G7 (storefront page, embed frame), G12 (sitemap) | Yes (row) |
| CP4 | `publishBlockedError` | `Store/src/lib/settings/seller-identity.ts:304-313` | G1 to G5 | Yes (`TRADER_GATE_SELECT`) |
| CP5 | `gatePurchasableLines` | `Store/src/lib/products/purchasable.ts:215-348` | All buyer-facing product reads, cart, and the order quote; one seller per call (owner filter `:282`) | Yes (`:290`) |
| CP6 | `checkoutProviderFor` / `canTakePayments` | `Store/src/lib/checkout/availability.ts:73-83`; `Store/src/lib/payments/connect/account.ts:102-104` | Every checkout surface and order placement (`Store/src/lib/checkout/place-order.ts:157`), re-checked in `placeStripeOrder` (`stripe-provider.ts:80-81`) | No: the Stripe account country is not stored anywhere |
| CP7 | `ensurePaymentAccount` | `Store/src/lib/payments/connect/account.ts:144-184` | The only writer of a connected account (and of `seller_payment_accounts.stripe_account_id`) | Receives `country` from the caller (`actions.ts:65`) |
| CP8 | `taxSchema` (`tax_country` refine) | `Store/src/lib/validation/settings.ts:131-136` | `saveTaxInfo` only (Settings form and welcome flow) | n/a (it is the write validator) |
| CP9 | `OPERATING_COUNTRIES` / `OPERATING_COUNTRY_CODES` | `Store/src/lib/settings/constants.ts:110-116` | `taxSchema`, `shippingPolicySchema.shipsFrom`, the country picker (`Store/src/lib/format/country.ts:69-78`) | It is the list |

Observation for the build phase: a rule placed in CP1/CP2 (country present and
allowed) is enforced on every write that publishes, on every buyer-facing read,
at the quote inside order placement, in the sitemap, the embed API, the OG
image and the MCP previews, with no extra query. A rule placed only in CP3
misses G1 to G5 and G8 to G11.

---

## 4. Paths that bypass the choke points

| # | Bypass | Evidence | Effect today | Mitigated by |
|---|---|---|---|---|
| BP1 | Direct PostgREST write of `profiles.tax_country` (and `tax_vat_id`, `seller_address`, `seller_email`, `seller_phone`) skips `taxSchema` | RLS `Store/tests/db/prod-migrations.sql:102-108`; guards cover other columns only (`20261012_auto_moderation.sql:755-766`, `20260926_contact_verification.sql:302-322`, `20261105_write_bounds.sql:197-199`); DB CHECK `prod-migrations.sql:261-262` | Any two-capital-letter country can be stored | Nothing for country. Address and email are re-validated on read by `buildTraderIdentityInput` (`seller-identity.ts:88-120`); country would need the same treatment (or a DB trigger/CHECK) |
| BP2 | `saveStorefront` persists `config.embed` (including `enabled: true`) without `publishBlockedError` | `Store/src/lib/storefront/actions.ts:218`, `:280-282`; reachable from MCP `save_storefront` (`Store/src/lib/agent/tools/storefronts.ts:350-366`, free-form `config` record `:353`) | Embed can be switched on with incomplete trader identity | Read side G7/G8 refuse to serve it |
| BP3 | Product page / checkout page / cart page switches saved without a gate | `saveStorefront` `:291-300`; page routes `Store/src/app/api/storefronts/[id]/product-page/route.ts`, `checkout-page`, `cart-page` (not opened in detail) | Pages switched on with incomplete identity | Read side G6/G7 |
| BP4 | Direct PostgREST product insert/update with `status = 'active'` | owner RLS policies first created at `Store/tests/db/prod-migrations.sql:176-181` (later team-aware versions inferred, not opened) | Active product with incomplete identity | Read side G6 |
| BP5 | Stripe account created with no or wrong country | `Store/src/lib/payments/connect/account.ts:158`; no identity or country precondition in `startStripeOnboarding` (`actions.ts:51-73`); existing account returned unchecked (`account.ts:150-151`) | Stripe chooses or the seller chooses the country (inferred from Stripe behaviour, not from code); a later change of `tax_country` does not change the Stripe account (Stripe account country is fixed after creation: inferred) | Nothing: `canTakePayments` does not look at country |
| BP6 | Four read gates bypass `sellerMaySell` | G8 `Store/src/app/api/embed/[key]/route.ts:68-71`; G9 `Store/src/app/api/og/p/[productId]/route.ts:95-102`; G10 `product-page-preview.ts:162`; G11 `storefront-preview.ts:120` | Same result today; diverges as soon as `sellerMaySell` gains a rule the others lack | Put the rule in CP1/CP2 |
| BP7 | Google OAuth sign-up skips the app's sign-up guards | `20261021_signup_intents.sql:20-22`, `:77-80` | Accounts without Turnstile/disposable checks | Not a country issue; noted for completeness |
| BP8 | Billing customer country taken from `tax_country` at first checkout only | `Store/src/lib/billing/customer.ts:29`, `:33-46` (returns early once a customer exists) | Platform invoice country can drift from `tax_country` | Stripe Checkout collects the billing address (`stripe-provider.ts:191-192`) |

---

## 5. Every country list, EU list and country default in Store

| # | Definition | Location | Contents | Consumers |
|---|---|---|---|---|
| L1 | `EU_COUNTRIES` / `EU_COUNTRY_CODES` | `Store/src/lib/settings/constants.ts:72-100`, `:102` | 27 EU states with English names | `OPERATING_COUNTRIES` (`:111`); `isEuSeller` `Store/src/lib/storefront/product-page.ts:168-170`; `mayOweEuRights` `:180-187`; `orderOwesEuRights` `:190-196`; `countryName` (names ONLY these 27, so US/CA show as a bare code or nothing) `Store/src/lib/format/country.ts:33-37`; `regionName` `:45-64` |
| L2 | `OPERATING_COUNTRIES` / `OPERATING_COUNTRY_CODES` | `Store/src/lib/settings/constants.ts:110-114`, `:116` | EU 27 + US + CA | `taxSchema.tax_country` (`Store/src/lib/validation/settings.ts:131-136`); `shippingPolicySchema.shipsFrom` (`Store/src/lib/validation/shipping-policy.ts:71-76`); `operatingCountries` (`Store/src/lib/format/country.ts:69-78`) for `useOperatingCountries` (`Store/src/components/settings/use-operating-countries.ts`) used by the Settings country select (`Store/src/components/settings/TaxSection.tsx:168-178`, `:361-371`) and shipping `CountryPicker`; pinned by `Store/tests/unit/operating-countries.test.ts:16-40`; mirrored in Home Terms (cited at `constants.ts:105-108`, not opened) |
| L3 | `SHIPPING_COUNTRY_CODES` | `Store/src/lib/settings/constants.ts:129-136` | Same 29 codes as literals | buyer `shipToSchema.country` (`Store/src/lib/validation/checkout.ts:41`); shipping destination rows (`Store/src/lib/validation/shipping-policy.ts:44-59`); `CountryPicker` (`Store/src/components/settings/CountryPicker.tsx:36`); checkout country list (`Store/src/components/checkout/CheckoutView.tsx:140`); `buyerCountry` from `cf-ipcountry` (`Store/src/lib/cart/route.ts:46-49`). Buyer side, see the checkout part. |
| L4 | `SMS_REGIONS` | `Store/src/lib/contact-verification/policy.ts:48-55` | EU 27 + IS, LI, NO, CH, GB (no US, CA) | `normalizeSellerPhone` (`Store/src/lib/validation/phone.ts:66`), so `saveTaxInfo` phone (`Store/src/lib/settings/actions.ts:527-534`) |
| L5 | `isEuSeller` | `Store/src/lib/storefront/product-page.ts:168-170` | `tax_country` in EU 27 | VAT price note (`Store/src/components/product-page/ProductPageView.tsx:165`); trust copy (`:238`); checkout (`Store/src/components/checkout/CheckoutView.tsx:121`); `mayOweEuRights` (`product-page.ts:184`) |
| L6 | `DOLLAR_COUNTRIES` + `homeCurrency` | `Store/src/lib/predictions.ts:250`, `:254-257` | US, CA to USD; every other country to EUR (so CZ to EUR) | first-product currency default (`Store/src/app/(dashboard)/products/new/page.tsx:114-118`; `Store/src/app/(dashboard)/products/import/page.tsx:87`); `predictShippingDefaults` shipsFrom (`predictions.ts:399-403`, from `Store/src/app/settings/shipping/page.tsx:38-41`) |
| L7 | `CURRENCIES` | `Store/src/types/product.ts:12` | EUR, USD (no CZK) | product currency validation (product inventory part); relevant to R2 because L6 maps CZ to EUR |
| L8 | `BILLING_CURRENCY` | `Store/src/lib/billing/plans.ts:39` | EUR | seller plan prices (F1), plans UI |
| L9 | `VAT_PREFIX_TO_ISO` / `ISO_TO_VAT_PREFIX` | `Store/src/components/settings/TaxSection.tsx:63-74` | EU VAT prefixes (EL for GR) | client-only advisory, server never blocks (`:80-113`, `:346-359`) |
| L10 | `REGION_COUNTRIES`, address formats | `Store/src/components/checkout/CheckoutForm.tsx:50`; `Store/src/lib/orders/ship-to.ts:78-79` | US, CA, AU / GB, IE | buyer address layout only |
| L11 | Payments overview fallback currency | `Store/src/lib/payments/connect/overview.ts:57` | EUR | chart with no sales |
| L12 | DB: `profiles.tax_country` CHECK | `Store/tests/db/prod-migrations.sql:261-262` | `^[A-Z]{2}$` | all writers; no SQL list of allowed seller countries anywhere (searched `supabase/migrations` for `tax_country`: comments only) |
| L13 | Fixtures and dev data | `Store/src/lib/storefront/sample.ts:198-203` (sample seller `country: "PT"`); `Store/src/lib/payments/scenarios.ts:120` (IE bank, simulated); `Store/src/lib/dev/simulated-sale.ts:38-53` (IE, DE, FR, NL buyers); `Store/src/app/dev/predictions/PredictionsLab.tsx:65` | n/a | dev, simulations, sample designer |
| L14 | Sign-in device country | `Store/src/lib/auth/device-label.ts:47-50`; `Store/src/lib/auth/sign-in-approval-actions.ts:108` | any `cf-ipcountry` | sign-in approval display only |

Searched for other hard-coded lists with
`"(AT|IE|DE|CZ|US|GB)",\s*"[A-Z]{2}"` and for `?? "XX"` style defaults in
`src` (excluding `app/dev`): only the entries above.

---

## 6. What happens today when a seller's country is unset

| Area | Behaviour | Evidence |
|---|---|---|
| Saving | Allowed; "" is stored as null | `Store/src/lib/validation/settings.ts:133`, `:136`; picker offers "Not set" first (`TaxSection.tsx:172-178`) |
| Onboarding | Never asked; the welcome flow posts three fields | `Store/src/components/onboarding/WelcomeFlow.tsx:436`, `:454`, `:477` |
| Publish / sell gate | Not required; everything publishes and sells | `Store/src/lib/settings/trader-identity.ts:27-29`, `:115-144` |
| Stripe connected account | Created with no `country` parameter (Stripe default or seller's own choice in hosted onboarding: inferred); also happens silently when the identity read fails | `Store/src/lib/payments/connect/account.ts:158`; `Store/src/lib/settings/seller-identity.ts:178-181` |
| Platform billing customer | Created without `address.country`; Checkout still collects a billing address | `Store/src/lib/billing/customer.ts:43`; `Store/src/lib/billing/stripe-provider.ts:150`, `:191` |
| Product page | EU withdrawal/guarantee lines shown (treated as possibly EU); VAT price note suppressed even with a VAT ID; trust copy uses the "for EU buyers" variant; no country line in the seller block | `Store/src/lib/storefront/product-page.ts:184`; `Store/src/components/product-page/ProductPageView.tsx:165`, `:205`, `:238`; `Store/src/components/product-page/SellerBlock.tsx:36` |
| Checkout | "Sold by X" without "in <country>" | `Store/src/components/checkout/CheckoutView.tsx:152`, `:186-188` |
| Order emails | No country line under the address | `Store/src/lib/orders/emails.ts:98-102` |
| Phone | A national-format number is refused (needs "+") | `Store/src/lib/validation/phone.ts:58-60` |
| Product defaults | No currency guess from country (falls back to the form default) | `Store/src/lib/predictions.ts:255`, `:266` |
| Shipping defaults | No "ships from" suggestion | `Store/src/lib/predictions.ts:403` |
| Prevalence | Memory note says 3 of 11 production sellers had set one (2026-10-30). Not verified: production data not accessed. | memory `operating-regions-and-terms.md` (lead only) |

---

## 7. Could not determine

1. **Stripe's behaviour for an Express account created without `country`**
   (platform default country vs. a country picker in hosted onboarding), and
   whether the platform's Stripe Connect settings restrict onboarding
   countries. Not expressible in code; needs Stripe dashboard or docs.
2. **Whether any `seller_payment_accounts` rows exist in production**, and
   with which Stripe countries. The feature flag is off in the production env
   file (`Store/.env.production:47` commented), but test-mode or manual rows
   cannot be ruled out without a DB read.
3. **Production distribution of `profiles.tax_country`** (memory says 3 of 11
   set; unverified).
4. **Whether the Before User Created hook is enabled in production**
   (dashboard setting, `20261021_signup_intents.sql:26-33`).
5. **Whether the live `profiles.tax_country` CHECK matches the replay file**
   (`Store/tests/db/prod-migrations.sql:261-262`); the original migration file
   `20260706081724` is not in `supabase/migrations`, only in the replay.
6. **Writers of `profiles` outside Store.** SQ-app writes `avatar_url` per the
   comment at `Store/supabase/migrations/20261105_write_bounds.sql:32`
   (not opened); Admin reads `tax_country` (`Admin/src/lib/data/moderation.ts:961`, `:1034`)
   and no Admin write of it was found by grep. Other repos are other parts.
7. **Exact current RLS policies on `products`, `storefronts`, `team_members`**
   after the team-access migrations (only the originals in the replay file were
   opened).
8. **MFA, passkey and sign-in-approval actions** were classified from the
   registry list but not read line by line; none is expected to touch
   country (inferred).

---

## 8. Implications for the rules (inventory facts only, no design decisions)

- **R1 (seller in CZ):** today nothing stores a structured business-address
  country, nothing stores the Stripe account country, the only country field
  is optional and REST-writable, and no gate reads it. The cheapest
  enforcement points that already hold the data are CP1/CP2 (trader identity)
  and CP7 (account creation). Checking the Stripe country at CP6 requires
  first storing it (new column or typed `country` on `StripeAccount`, read in
  `refreshPaymentAccount` and `account.updated`).
- **R2 (CZK):** not in this part's scope, but note `homeCurrency` maps CZ to
  EUR and `CURRENCIES` has no CZK (L6, L7).
- **R5 (collab):** no multi-seller checkout in Store (section 0 item 7).
- **R6 (server-side at checkout):** the quote inside `placeOrderResponse`
  already re-runs `sellerMaySell` and `checkoutProviderFor` at placement
  (G6c), so seller-side rules placed in CP1 to CP3 and CP6 are enforced at
  checkout time on the server, whatever page or embed the buyer came from.
- **R7 (messaging):** the Settings hint currently says "Square Share operates
  in the EU, the USA and Canada" (`messages/en/settings.json`,
  `Settings.tax.fields.country.hint`); stale code comment at
  `Store/src/lib/settings/trader-identity.ts:27-29`.
- **R8 (waitlist):** nothing to extend in Store; `waitlist_signups` has no
  country and its anon policy pins `list_id`/`owner_id` to null
  (`20260807_db_hygiene.sql:45-54`).
