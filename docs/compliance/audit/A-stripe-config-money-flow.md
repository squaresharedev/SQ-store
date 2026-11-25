# Audit A: Stripe account configuration and money flow

Date: 2026-11-22. Scope: Stripe Connect (buyer payments) and Stripe Billing (seller plans) across Store, Admin, App, Home, Docs and SQ-system. Investigation only: nothing was changed, nothing was run, no Stripe or Supabase call was made, no key was used.

**Evidence conventions.** Paths are repo-prefixed (`Store:`, `Home:`, `Admin:` ...) with line numbers from the working tree at commit `e43eedd` (clean tree for every payments path; `git status` showed no local changes under `src/lib/payments`, `src/lib/checkout`, `src/lib/billing`, `src/app/api/payments`, `src/app/api/checkout`). Quotes are short and exact. Anything not opened is marked (inferred). Stripe behaviour is quoted from public docs fetched on 2026-11-22 (list in section 14); anything not confirmed there is marked (unverified against docs).

---

## 0. The P0 answer

**Connected accounts are created as legacy EXPRESS accounts, Accounts v1, API version `2025-08-27.basil`.**

`Store:src/lib/payments/connect/account.ts:153-164`

```ts
const created = await stripeRequest<StripeAccount>(
  "POST",
  "/accounts",
  {
    type: "express",
    ...(owner.country ? { country: owner.country } : {}),
    ...(owner.email ? { email: owner.email } : {}),
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    metadata: { owner_id: owner.ownerId },
  },
  { idempotencyKey: `connect_account_${owner.ownerId}` },
);
```

Per Stripe's controller-properties guide, an account created with `type=express` comes back with `losses.payments: "application"`, `fees.payer: "application_express"`, `requirement_collection: "stripe"`, `stripe_dashboard.type: "express"`. Stripe defines `losses.payments = application` as "The Connect application is liable when this account can't pay back negative balances resulting from payments", and Stripe's account-types table lists "Fraud and dispute liability" for Express as "Platform".

**Verdict: as coded, the integration CONFLICTS with the locked decision.** Every account the code would create makes Efficontrol s.r.o. (the platform) liable for that seller's negative balances (refunds, disputes, fraud), and gives the seller the Express Dashboard (the code also issues Express login links, `account.ts:208-214`). The charge type is correct (direct charges, see section 4); the account type is not.

**Exposure today: none in practice, as far as the repo shows.** The feature switch has never been on in any committed production build: `Store:.env.production:47` has it commented out (`# NEXT_PUBLIC_STRIPE_CONNECT_ENABLED="true"`), `git log -p` on that file shows only that commented line ever added, the deploy workflow does not set it (`Store:.github/workflows/deploy.yml:131-136` sets only the two Supabase vars), and `Store:.env.local` holds no Stripe variable at all (only `PAYMENTS_MOCK_DATA`, line 74). Account creation is refused while the switch is off (`Store:src/lib/payments/connect/actions.ts:34`). So the expected row count in `seller_payment_accounts` is zero (inferred: not queried). The table does exist in production per the replica file (`Store:tests/db/prod-migrations.sql:7617` "(applied) seller_payment_accounts").

---

## 1. How connected accounts are created

| Item | What the code sends | Evidence |
|---|---|---|
| Endpoint | `POST https://api.stripe.com/v1/accounts` (platform key, no `Stripe-Account` header) | `account.ts:153-156`, `Store:src/lib/billing/stripe-api.ts:24` |
| API | Accounts **v1** (no `/v2/core/accounts` anywhere) | grep over all repos |
| API version header | `Stripe-Version: 2025-08-27.basil` on every request | `stripe-api.ts:22` `export const STRIPE_API_VERSION = "2025-08-27.basil";`, `stripe-api.ts:236` |
| `type` | `"express"` | `account.ts:157` |
| `controller.*` | not sent | `account.ts:156-162` |
| `country` | sent only when the seller has set one, else omitted | `account.ts:158` |
| `email` | seller's buyer-facing contact email, else login email | `account.ts:159`; source `actions.ts:64` `email: identity.email ?? user?.email ?? null` |
| `capabilities` | `card_payments` and `transfers`, both requested | `account.ts:160` |
| `business_type`, `business_profile`, `settings`, `tos_acceptance` | none sent (Stripe's hosted onboarding collects them) | `account.ts:156-162` |
| `metadata` | `owner_id` | `account.ts:161` |
| Idempotency key | `connect_account_<ownerId>` | `account.ts:163` |

**Where `country` comes from.** `actions.ts:65` `country: identity.country ?? null`, where `identity` is `getSellerIdentity(account.accountId)` (`actions.ts:59`), which reads `profiles.tax_country` (`Store:src/lib/settings/seller-identity.ts:56`, `:155`). That field is optional and validated only against `OPERATING_COUNTRY_CODES` (`Store:src/lib/validation/settings.ts:131-136`), which is the 27 EU states plus US and CA (`Store:src/lib/settings/constants.ts:110-116`). So today a connected account could be created in any of 29 countries, or with no country at all. Stripe's Standard-accounts guide says that without a country "The country of the account defaults to the same country as your platform, and the account confirms the selection during onboarding" (so the seller could pick another); what an omitted country does for Express (unverified against docs). Stripe: "You can't change the country later" (Express) and "After you create a Standard connected account, you can't change its country".

**Who calls it.** `startStripeOnboarding` (`actions.ts:51-73`): owner only with `billing.manage` (`actions.ts:31`), Connect live (`actions.ts:34`), rate limited (`actions.ts:54`). If a row already exists it is returned unchanged (`account.ts:150-151` `if (existing) return existing;`), so a change to the create call never touches an existing seller.

**Resulting account kind in Stripe's terms.** Legacy Express (`type: "express"`), controller properties `losses.payments=application`, `fees.payer=application_express`, `requirement_collection=stripe`, `stripe_dashboard.type=express` (Stripe migration guide mapping table).

**Liability under the locked mapping.** Express is exactly the forbidden case: platform liable for negative balances (§4.4(d) per the owner's research; the Stripe docs say "Platform" for fraud and dispute liability on Express). Efficontrol would carry seller-loss liability for every account this code creates. Stripe also notes "There's an additional cost for using Express or Custom connected accounts" (account-types page); whether per-account and per-payout Connect fees apply to Express accounts used only with direct charges is (unverified against docs). The locked "Stripe handles pricing" model (no account or payout fees for the platform) is only certain with full-Dashboard accounts that pay their own fees.

**Code comments and runbooks that encode Express.** `account.ts:11-15` ("EXPRESS ACCOUNTS. Stripe hosts the onboarding ... and the seller's payout dashboard"), `Store:wrangler.jsonc:163-167` ("a direct charge on the seller's own connected (Express) account" and step a: "Connect is enabled on the Stripe platform account, with Express accounts"). Both would steer whoever enables Connect in the Stripe Dashboard into the wrong setting.

---

## 2. Onboarding and dashboard access

- **Account Links (onboarding).** `account.ts:192-201`: `POST /v1/account_links` with `type: "account_onboarding"`, `return_url` and `refresh_url` both set to `appUrl(PAYMENTS_CONNECT_RETURN_PATH)` (`account.ts:193-199`).
- **Return and refresh handling.** `Store:src/app/api/payments/connect/return/route.ts:27-43`: for the signed-in owner only, rate limited (`:34`), calls `refreshPaymentAccount` (`:36`), then redirects to Payments (`:42`). An expired link therefore lands on Payments, where the seller presses connect again (a new link is minted by `openStripeDashboard` or `startStripeOnboarding`); the refresh URL does not mint a new link itself.
- **Login links (Express Dashboard): present, the tell.** `account.ts:208-214`: `POST /v1/accounts/{id}/login_links`, comment "a one-use link into the seller's own Stripe Express dashboard". Used by `openStripeDashboard` once `detailsSubmitted` (`actions.ts:92`) from `Store:src/components/payments/PayoutMethodCard.tsx:11,22` and the dispute panel `Store:src/components/orders/OrderActions.tsx:10,80`. Stripe: "You can only create login links for accounts that use the Express Dashboard". This call fails for Standard accounts, so it must change with the account type.
- **Account Sessions / embedded components:** none (grep for `account_sessions` finds nothing).
- **What is stored** (`Store:supabase/migrations/20261008_seller_payment_accounts.sql:33-49`): `owner_id` (PK, FK to profiles, `on delete cascade`), `stripe_account_id` (unique, `^acct_` check), `charges_enabled`, `payouts_enabled`, `details_submitted`, `livemode`, `created_at`, `updated_at`. RLS on, no policies, all revoked from `anon`/`authenticated`, granted to `service_role` only (`:61-63`).
- **Not stored:** country, `requirements` (currently_due, past_due, disabled_reason), controller / type, capability states, any deauthorized or frozen flag.
- **How the facts are refreshed.** On `account.updated` (`Store:src/lib/payments/connect/webhook.ts:165-175`) and on return from onboarding (`account.ts:129-135`, `GET /v1/accounts/{id}`). Both write only the three booleans (`account.ts:108-118`: "Record what Stripe says about an account. Only the three facts"). The typed Stripe account has only those fields (`stripe-api.ts:110-115`).
- **Requirements never reach the seller.** `Store:src/lib/payments/connect/overview.ts:77` hard-codes `requirementsDue: []`, although the UI has a branch for it (`Store:src/components/payments/ConnectionStatusCard.tsx:140`, `Store:src/lib/payments/account-health.ts:14`).

---

## 3. Webhooks

**Endpoints.** Two: Connect at `/api/payments/webhook` (secret `STRIPE_CONNECT_WEBHOOK_SECRET`) and Billing at `/api/billing/webhook` (secret `STRIPE_WEBHOOK_SECRET`).

**Connect route** (`Store:src/app/api/payments/webhook/route.ts`): answers 404 while Connect is not live (`:33`); raw body bounded to 256 KB (`:26`, `:35`); signature verified before any parsing (`:38-46`); then `handleConnectEvent` (`:51`).

**Signature verification** (`Store:src/lib/billing/webhook-signature.ts:48-72`): HMAC-SHA256 over `<t>.<raw body>`, any `v1` may match, 300 s tolerance (`:13`), constant-time compare (`:33-39`), comma-separated secrets for rotation (`Store:src/lib/payments/connect/config.ts:37-42`). Sound.

**Event filter and idempotency** (`webhook.ts:124-158`): ignores events without `account` (`:126`), other mode (`:127`), and types outside the list (`:128`); records the event id in `stripe_events` and marks it processed only after the effect (`:133-152`).

**Seller resolution.** From `event.account` through `seller_payment_accounts` only (`webhook.ts:144` `readPaymentAccountByStripeId(stripeAccountId)`); unknown accounts are acknowledged and ignored (`:146` "not one of our accounts"). Orders are matched only within that seller (`webhook.ts:56-65`, `:86-95`). Good.

**Handled types** (`webhook.ts:42-48`):

| Event | What it writes | Evidence |
|---|---|---|
| `checkout.session.completed` | requires `payment_status === "paid"` (`:180`); finds the order by `client_reference_id` within the seller (`:181-184`); alerts ops on no match or foreign order (`:185-193`); refuses if amount or currency differ from the order (`:198-207`); `confirmPendingOrder` (`:208`); reads back Stripe's application fee and writes the fee ledger (`:213`, `Store:src/lib/payments/connect/fees.ts:51-100`) | |
| `checkout.session.expired` | funnel count, releases the pending order and its stock (`:217-227`) | |
| `account.updated` | the three booleans only, after checking `object.id` equals the sending account (`:165-175`) | |
| `charge.refunded` | records application-fee refunds (`:237-238`); on a full refund calls `order_apply_refund` (`:242-248`) | |
| `charge.dispute.created` | sets the order to `disputed` if it was `paid` and notifies the seller once (`:252-277`) | |

**Not handled:** `radar.early_fraud_warning.created`, `account.application.deauthorized`, `capability.updated`, `charge.dispute.closed` / `charge.dispute.funds_withdrawn`, `checkout.session.async_payment_succeeded/failed` (cards only today, `stripe-provider.ts:130`, so acceptable), `payout.failed`. No per-seller risk signal is written by the dispute handler (only the order status and a bell notification).

**What `account.updated` re-checks:** charges_enabled, payouts_enabled, details_submitted. It does **not** look at `country`, `requirements.disabled_reason`, `controller`, or `type`.

**Billing webhook** ignores every Connect event (`Store:src/lib/billing/webhook.ts:90` `if (event.account) return { status: 200, note: "connect event, not a plan" };`), so there is no cross-talk.

---

## 4. Charges (buyer checkout)

`placeStripeOrder`, `Store:src/lib/checkout/stripe-provider.ts:71-201`. The request (`:122-168`):

| Parameter | Value | Evidence |
|---|---|---|
| Endpoint | `POST /v1/checkout/sessions` **with `Stripe-Account: <seller acct>`** | `:122-125`, `:167` `{ account: account.stripeAccountId, idempotencyKey: ... }`; header set at `stripe-api.ts:240` |
| `mode` | `"payment"` | `:126` |
| `client_reference_id` | our own id `cs_ss_<attempt>` | `:127`, `:62-64` |
| `customer` / `customer_email` | no Customer object; `customer_email: buyer.email` | `:128` |
| `locale` | buyer's locale | `:129` |
| `payment_method_types` | `["card"]` | `:130` |
| `line_items` | one per order line, `quantity: 1`, `unit_amount` = the line's charged amount after discounts, name `"2 × Title"`; plus one delivery line | `:131-155` |
| Currency | `quote.currency.toLowerCase()`; one currency per order, the first sellable line's | `:106`; `Store:src/lib/checkout/quote.ts:273-274` |
| `payment_intent_data.application_fee_amount` | `fee.applicationFeeCents`, omitted when 0 | `:156-161` |
| Fee base | `quote.totalCents`, the whole amount the buyer pays, after discounts, delivery included | `Store:src/lib/checkout/provider.ts:66-68`; `Store:src/lib/billing/sale-fee.ts:57-83`; `Store:src/lib/pricing/fees.ts:9-19` |
| Fee cap | 30 % of the amount (`APPLICATION_FEE_CAP_BPS = 3_000`) | `fees.ts:29`, `:100-102` |
| Fee switch | `billing_switches.fees_enabled` off means every sale pays 0 (read failure reads as off) | `Store:src/lib/billing/switches.ts:26-44`, `sale-fee.ts:66-67` |
| `metadata` (session and PaymentIntent) | `order_id, storefront_id, product_id, origin, plan_id, platform_fee_bps` | `:110-121`, `:160`, `:162` |
| `shipping_address_collection` | not set (our checkout collects the address) | `:125-166` |
| `billing_address_collection` | not set (Stripe default) | `:125-166` |
| Statement descriptor | not set: the connected account's own descriptor applies | `:125-166`; grep `statement_descriptor` finds only payout display code |
| `expires_at` | now + 31 minutes | `:58`, `:165` |
| Idempotency key | `checkout_<cs_ss_...>` | `:167` |
| `success_url` | buyer's order link + `?placed=1` | `:163` |
| `cancel_url` | `/api/checkout/cancel?c=<cs_ss_...>` | `:164` |

**It is a direct charge.** Stripe's direct-charges guide: "`Stripe-Account`: This header indicates a direct charge for your connected account." The fee is less than the charge (30 % cap; Stripe requires "positive and less than the amount of the charge").

**Destination charges or separate charges and transfers: none in code.** Grep over all repos for `transfer_data`, `on_behalf_of`, `/transfers`, `transfer_group`, `source_transaction`, `/topups`, `application_balance`, `POST .../payouts` finds no code use. The only hits are two **comments that permit the forbidden pattern**:
- `Store:src/components/product-page/ProductCta.tsx:33-37` "Use Direct Charges created on the connected account, or Destination Charges with `on_behalf_of` set to it"
- `Store:src/lib/payments/types.ts:11-14` "Direct Charges, or Destination Charges with `on_behalf_of`"

**Refunds** (`Store:src/lib/orders/actions.ts:459-501`): `POST /v1/refunds` on the connected account, `payment_intent`, `refund_application_fee: true`, optional `amount`, idempotency `refund_<orderId>[_<line>]` (`:476-489`). Money returns out of the seller's balance (direct charge). With Express, a refund that drives the seller negative is the platform's loss (section 0).

**Cancel** (`Store:src/app/api/checkout/cancel/route.ts:65-71`): `POST /v1/checkout/sessions/{id}/expire` on the connected account, then release.

---

## 5. Every Stripe endpoint in every repo

Only Store calls Stripe. Admin, App, Home, Docs and SQ-system contain no Stripe API call (grep for `api.stripe`, `js.stripe`, `STRIPE_SECRET`, `from "stripe"`, `Stripe-Account`, `stripeRequest` returns nothing in each; Admin and Home only mention Stripe in copy and legal text). Store has one HTTP client, `stripeRequest` (`stripe-api.ts:222-264`); no `stripe` npm package, no Stripe.js.

| # | Method and path | On | File:line | Class |
|---|---|---|---|---|
| 1 | `POST /v1/accounts` | platform | `payments/connect/account.ts:153` | Connect account management (creates Express: CONFLICT) |
| 2 | `GET /v1/accounts/{id}` | platform | `account.ts:132` | read |
| 3 | `POST /v1/account_links` | platform | `account.ts:194` | onboarding |
| 4 | `POST /v1/accounts/{id}/login_links` | platform | `account.ts:209` | Express Dashboard (CONFLICT) |
| 5 | `POST /v1/checkout/sessions` (mode payment) | **connected** | `checkout/stripe-provider.ts:122` | **buyer funds: direct charge** |
| 6 | `POST /v1/checkout/sessions/{id}/expire` | connected | `app/api/checkout/cancel/route.ts:69` | closes an unpaid buyer page |
| 7 | `POST /v1/refunds` | **connected** | `orders/actions.ts:476` | **buyer funds returned from seller balance** |
| 8 | `GET /v1/payment_intents/{id}?expand[]=latest_charge` | connected | `payments/connect/fees.ts:67` | read |
| 9 | `GET /v1/application_fees/{id}` | platform | `fees.ts:40` | read of the platform's own fee revenue |
| 10 | `GET /v1/application_fees/{id}/refunds` | platform | `fees.ts:112` | read |
| 11 | `GET /v1/balance` | connected | `payments/connect/overview.ts:185` | read |
| 12 | `GET /v1/payouts` | connected | `overview.ts:186` | read (no payout is ever created) |
| 13 | `GET /v1/balance_transactions` | connected | `overview.ts:143`, `:187` | read |
| 14 | `POST /v1/customers` | platform | `billing/stripe-provider.ts:157`, `:172` | seller as platform customer (plans) |
| 15 | `GET /v1/prices` | platform | `billing/stripe-provider.ts:70` | read |
| 16 | `POST /v1/checkout/sessions` (mode subscription) | platform | `billing/stripe-provider.ts:179` | **platform revenue** (seller plan) |
| 17 | `GET /v1/checkout/sessions` | platform | `billing/stripe-provider.ts:104` | read |
| 18 | `POST /v1/checkout/sessions/{id}/expire` | platform | `billing/stripe-provider.ts:113` | closes a plan checkout |
| 19 | `GET /v1/checkout/sessions/{id}` | platform | `billing/stripe-provider.ts:274` | read |
| 20 | `GET /v1/subscriptions`, `GET /v1/subscriptions/{id}` | platform | `billing/stripe-provider.ts:120`, `:54` | read |
| 21 | `POST /v1/subscriptions/{id}` | platform | `billing/stripe-provider.ts:238`, `:264` | cancel at period end / resume |
| 22 | `POST /v1/billing_portal/sessions` | platform | `billing/stripe-provider.ts:225` | seller's plan portal |

**Item 6 of the final report (buyer funds outside direct charges): nothing.** Buyer money is touched only by #5 (direct charge on the seller's account) and #7 (refund on the seller's account). Nothing creates transfers, payouts, top-ups, or moves buyer money into a Square Share balance; the only money reaching the platform balance from sales is the application fee, which Stripe splits off the direct charge. The structural caveat is not a call but the account type: with Express, a seller's negative balance is the platform's to cover.

---

## 6. Seller subscriptions (Starter / Pro)

Built on **Stripe Billing on the platform account**, separate from Connect (`Store:src/lib/billing/stripe-provider.ts:1-3` "Stripe Billing, on the PLATFORM account: Square Share bills the seller for their plan"). Hosted Checkout in `mode: "subscription"` with `automatic_tax`, `tax_id_collection`, `billing_address_collection: "required"` (`:179-196`); prices looked up by lookup key and refused if they differ from `plan_prices` (`:66-90`); Customer Portal for switches (`:201-227`); in-app cancel and resume (`:231-271`). Live only when `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set (`Store:src/lib/billing/availability.ts:27-29`). Seller as customer is `seller_billing`, not `seller_payment_accounts` (`20261008_seller_payment_accounts.sql:14-16`).

Separation from buyer funds: yes. Subscription money is the platform's own revenue on its own account; buyer money never enters the platform account. Two shared resources only: the **same secret key** serves Billing and Connect (`Store:src/lib/payments/connect/config.ts:12-16`, `Store:wrangler.jsonc:171`), and the same `stripe_events` table (`webhook.ts:133-135`, `Store:src/lib/billing/webhook.ts:98-100`). Whether the Stripe account, Prices, Tax and Portal exist yet is not in the repo; a memory note from 2026-10-03 says "no Stripe account, Prices, Tax or Portal config yet" (unverified).

---

## 7. Gates

**Checkout gate (exists).** `Store:src/lib/checkout/availability.ts:73-83` `checkoutProviderFor`: order links available, then (dev) test provider, then Stripe only if `stripeConnectLive() && realPaymentsGuarded()` and `canTakePayments(account)`. `canTakePayments` (`account.ts:102-104`) is `account !== null && account.chargesEnabled && account.livemode === stripeKeyIsLive()`. `realPaymentsGuarded` (`availability.ts:61-64`) also demands Turnstile in production and working mail. Re-checked at order time (`Store:src/lib/checkout/place-order.ts:157-158`) and again inside the provider (`stripe-provider.ts:79-81`). Every buyer surface goes through it (product page `Store:src/lib/products/public.ts:237`, checkout pages, cart `Store:src/lib/cart/availability.ts:49`, `Store:src/lib/cart/route.ts:37`, discount check `Store:src/lib/checkout/discount-check.ts:72`).

**Publish gate (does not involve payments).** `publishBlockedError` (`Store:src/lib/settings/seller-identity.ts:304-313`) and the read side `sellerMaySell` (`:128-132`, used at `Store:src/lib/products/purchasable.ts:322`) check trader identity (name, address, verified email) only. A seller with no Stripe account, or a restricted one, can publish products and storefronts; the buy button falls back to the seller's own link or an enquiry email (`Store:src/lib/checkout/availability.ts:4-7`). The locked rule "Seller cannot publish until charges_enabled" is not implemented, and implementing it as stated would unpublish every current seller while Connect is off.

**What a restricted or disabled seller can still do.** Publish and keep selling through their own link or email; open their Express Dashboard (`actions.ts:81-98`); see balances and payouts (`overview.ts:165-204`); refund past orders (the refund path does not check `charges_enabled`, `orders/actions.ts:467-474`, Stripe decides). A Stripe page created just before the restriction may still be paid and is still confirmed by the webhook, which does not re-check `charges_enabled` (`webhook.ts:177-215`) (inferred whether Stripe still accepts payment on it).

**Freeze switch for one seller: none.** No column or flag stops checkout for one seller (grep for freeze, suspend, payment hold finds nothing in `src/lib`). The global switches are `NEXT_PUBLIC_STRIPE_CONNECT_ENABLED` and the secrets. Deleting the seller's row would stop checkout but would also make every later event for that account "not one of our accounts" (`webhook.ts:146`), losing refunds and disputes for paid orders, so it is not a safe freeze. Content moderation can remove a storefront or product (`purchasable.ts:244-249`), which is a takedown, not a payments freeze.

---

## 8. Keys and hygiene

| Item | Finding | Evidence |
|---|---|---|
| Secret key var | `STRIPE_SECRET_KEY`, read only in `stripeRequest` | `stripe-api.ts:228-229`; grep shows no other read |
| Restricted key assumed | Yes in docs: "a RESTRICTED key (rk_live_...)" | `Store:wrangler.jsonc:153`, `Store:.env.example:41`, `Store:src/lib/billing/availability.ts:7` |
| Restricted key enforced | No: `sk_live_` is accepted | `stripe-api.ts:41` `/^(sk|rk)_live_/` |
| Documented Connect permissions | "write access to Connect Accounts, Account Links, Checkout Sessions and Refunds, and read access to Balance, Payouts and Balance Transactions" | `wrangler.jsonc:171-176` |
| Missing from that list | read Application Fees (`fees.ts:40`, `:112`) and read PaymentIntents on connected accounts (`fees.ts:67`), possibly Login Links (inferred permission names, unverified against docs). With a key scoped exactly as documented, `settleOrderFees` would fail and every paid event would be retried as "failed, deliver again" (`webhook.ts:213`, `:154-156`) | |
| Same key for Billing and Connect | Yes | `config.ts:12-16` |
| Webhook secrets | `STRIPE_CONNECT_WEBHOOK_SECRET` (Connect), `STRIPE_WEBHOOK_SECRET` (Billing), separate endpoints, rotation supported | `config.ts:37-42`, `webhook-signature.ts:75-80` |
| Logged | No request bodies or keys: "Nothing here is logged" | `stripe-api.ts:17-19`. Two handlers log Stripe's error `message` (`actions.ts:70`, `:95`), which can echo submitted values such as an email (PII in logs, not secrets) |
| Sent to the client | No. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is documented (`.env.example:56`) but used nowhere in `src`. Client components import only the `"use server"` actions file (`PayoutMethodCard.tsx:11`, `ConnectStripeModal.tsx:11`, `OrderActions.tsx:10`) | |
| `server-only` guard | Not used anywhere in `src/lib` (no `server-only` package in `package.json`); `stripe-api.ts` relies on a comment. A future client import would still not leak the key (Next inlines only `NEXT_PUBLIC_*`) (inferred) | |
| API base override | `STRIPE_API_BASE` ignored in production builds | `stripe-api.ts:33-36` |

**Feature switches and production values (repo view).**

| Switch | Where | Production value per repo |
|---|---|---|
| `NEXT_PUBLIC_STRIPE_CONNECT_ENABLED` | build-time, `Store:src/lib/payments/availability.ts:30` | commented out in `.env.production:47`, never set in deploy workflow: **OFF** |
| `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET` | Worker secrets | not visible in repo (unverified) |
| `CHECKOUT_TEST_PAYMENTS` | `Store:src/lib/checkout/availability.ts:41-43` requires `NODE_ENV === "development"` | inert in any deployed build |
| `BILLING_TEST_PROVIDER` | `Store:src/lib/billing/availability.ts:22-24`, same rule | inert |
| `PAYMENTS_MOCK_DATA` | `Store:src/lib/payments/mock.ts:54` returns null in production | inert |
| `TRANSACTIONAL_EMAIL_ENABLED` (needed by checkout gate) | `Store:src/lib/email/send.ts:91` | not in `wrangler.jsonc` vars (`:39-73`): OFF, so Stripe checkout would stay off even with Connect on |
| `billing_switches.fees_enabled` | DB row | memory says all switches off (unverified) |

---

## 9. Fee disclosure and seller naming

**Buyer sees the seller.** Checkout page: "Sold by {seller} in {country}" (`Store:src/components/checkout/CheckoutView.tsx:151-152`, `:186-189`), seller details one tap away. Stripe's page: "For direct charges, Checkout uses the brand settings of the connected account" (Stripe docs). Statement descriptor: none set by code (section 4), so the connected account's own descriptor applies (inferred from Stripe's direct-charge model; verify in test mode). Line items carry product names only, never "Square Share".

**Seller sees the platform fee before a sale.** Plans page: `"{rate} fee per sale"` (`Store:messages/en/billing.json:59`) and `"Stripe's own card processing fee on each sale comes on top of these figures."` (`:83`). Settings legal summary: `"We take a platform fee on each sale, as shown in your dashboard."` (`Store:messages/en/settings.json:282`). Terms: fee "charged on everything the Buyer pays, delivery included ... collected automatically as a Stripe Connect application fee" (`Home:src/content/legal/terms/tos-2026-11-06.ts:387`), which matches the code. Gap: the Connect dialog a seller passes through before onboarding says nothing about fees (`Store:messages/en/payments.json:64-84`).

**After a sale.** Order panel ledger shows "Platform fee ({rate})" and the amount (`Store:src/components/orders/OrderDetail.tsx:457-466`, `Store:messages/en/orders.json:142`), "You receive" = amount minus platform fee (`OrderDetail.tsx:198`) with the hint "Before Stripe's card fee" (`orders.json:90`). The fee recorded is the one Stripe actually collected (`fees.ts:79-97`).

**Terms vs code.** `tos-2026-11-06.ts:427` says negative balances "are the Seller's responsibility and are settled between the Seller and Stripe under the Stripe Connect agreement". With Express that is not Stripe's allocation (Stripe holds the platform liable and the platform must recover from the seller); it is only true with Standard / full-Dashboard accounts.

---

## 10. Test coverage

- **Stand-in only.** `Store:tests/e2e/stripe-mock.ts:19-24`: "It proves OUR half ... It proves nothing about Stripe's half: that these are the parameters Stripe accepts, or that its events really look like this. That needs a run against Stripe's test mode with real keys." Run by `pnpm test:e2e:connect` (`Store:playwright.connect.config.ts:24-42`, only spec 87). Not in CI (no reference in `.github`).
- **What spec 87 proves** (`Store:tests/e2e/87-stripe-connect.spec.ts`): connect then checkout appears only once charges are enabled (`:288`); pending order, session on the seller's account, fee 143 at 5 % (`:324-376`); cancel releases stock and a closed page cannot be paid (`:386`); refund through the provider with `refund_application_fee: true` before recording (`:410-444`); only a correctly signed event from the order's own account pays it, once, plus dispute sets `disputed` and notifies (`:462-546`); fee by plan, waiver and switch (`:561-639`); proportional fee refunds and following Stripe's collected fee (`:654-690`).
- **What it cannot prove:** the stand-in's `POST /v1/accounts` ignores every parameter (`stripe-mock.ts:258-268`), so the account type, country and capabilities have never been checked by anything; login links always succeed (`:283-287`), so the Standard failure would never show; `charge.dispute.created`, `account.updated` shapes are hand-made.
- **Unit and component tests:** `tests/unit/checkout-stripe-gate.test.ts` (provider gate), `connect-webhook-amount.test.ts`, `connect-fees.test.ts`, `payments-mock.test.ts`, `tests/component/order-dispute-stripe.test.tsx`, `payments-stripe-links.test.tsx`, `connection-status.test.tsx`; `tests/integration/34-seller-payment-accounts.test.ts` (table access) (titles only, contents not opened).
- **Never run against real Stripe test mode:** account creation, onboarding, login links, Checkout Session creation with these parameters, real events and signatures, application fee read-back, refunds, the restricted-key permission set. (Per `Store:src/lib/payments/availability.ts:26-28`: "has never talked to the real one".)

---

## 11. Czech-only beta

1. **Pin country at creation.** `account.ts:158`: replace the optional spread with a constant `country: "CZ"` (a named constant, for example `CONNECT_ACCOUNT_COUNTRIES = ["CZ"]` beside `stripeConnectLive` in `Store:src/lib/payments/connect/config.ts`), and refuse onboarding in `startStripeOnboarding` (`actions.ts:59-66`) when `identity.country` is not `"CZ"`, with a seller-facing reason. Country is fixed after creation (Stripe docs, section 1), so this must land before the first account.
2. **Re-check on `account.updated`.** `webhook.ts:165-175` and `saveAccountFacts` (`account.ts:108-118`): read `object.country`, `object.requirements.disabled_reason`, `object.controller` (and `type`), store them (new columns), and have `canTakePayments` (`account.ts:102-104`) also require `country === "CZ"` and the expected controller values. `StripeAccount` (`stripe-api.ts:110-115`) gains those fields. `refreshPaymentAccount` (`account.ts:129-135`) writes the same.
3. **Block checkout.** Falls out of step 2: every buyer path goes through `canTakePayments` (section 7).
4. **Block publishing.** Add a payments clause to `publishBlockedError` (`seller-identity.ts:304`) and to `sellerMaySell` (`:128`), behind the Connect launch switch so nobody is unpublished while Connect is off. This changes who can sell (today no publishing depends on Stripe), so it is a product decision.
5. **Existing accounts.** Expected zero in production (section 0). Any row created before steps 1-2 keeps its Stripe country forever; the step 2 check would block it at checkout, and replacing it means a new account (section 13).

---

## 12. Gap table

Priority order. "Needs Adrian's approval?" is yes for anything that changes money flow, charge type, connected-account type, or schema with existing data (and for decisions that change who can sell).

| # | Requirement | Status | Evidence | Proposed fix (smallest reviewable change) | Needs Adrian's approval? |
|---|---|---|---|---|---|
| 1 | Connected accounts are Standard / full Dashboard, Stripe liable for losses, account pays fees | **CONFLICTS** | `account.ts:157` `type: "express"` | Change the create call per section 13, assert the returned controller, new idempotency key prefix | **Yes** (account type) |
| 2 | No Express Dashboard | **CONFLICTS** | `account.ts:208-214` login links; `actions.ts:92` | Replace `dashboardLink` with a plain link to the full Stripe Dashboard (no API call); keep onboarding link for unfinished accounts | **Yes** (part of 1) |
| 3 | Runbooks and comments match the locked model | **CONFLICTS** | `wrangler.jsonc:163-167` (Express), `account.ts:11-15`, `ProductCta.tsx:33-37` and `types.ts:11-14` (allow destination charges with `on_behalf_of`) | Rewrite to "direct charges on full-Dashboard accounts only; destination charges and transfers forbidden" | No (comments), after 1 is decided |
| 4 | Terms: negative balance is Seller and Stripe's | **CONFLICTS** with Express | `Home:.../tos-2026-11-06.ts:427` | Resolved by 1; no Terms change needed if 1 lands | Yes (via 1) |
| 5 | Country pinned to CZ at creation | **Missing** | `account.ts:158` optional; `validation/settings.ts:131-136` allows 29 countries | `country: "CZ"` constant; refuse onboarding if `tax_country !== "CZ"` | Yes (account configuration) |
| 6 | Re-check country and status on `account.updated` | **Partial** | `webhook.ts:165-175` writes 3 booleans only | Store `country`, `disabled_reason`, `requirements_due`, controller values; check them in `canTakePayments` | Yes (schema on `seller_payment_accounts`; expected empty in prod) |
| 7 | Block checkout for disallowed country | **Missing** | `account.ts:102-104` | Part of 6 | Yes (with 6) |
| 8 | Seller cannot publish until `charges_enabled` | **Missing** (by design today) | `seller-identity.ts:304-313`, `:128-132` | Payments clause behind the Connect launch switch | **Yes** (changes who can sell) |
| 9 | Block publishing for disallowed country | **Missing** | same | Same clause, country part | Yes |
| 10 | `account.application.deauthorized` handled | **Missing** (mandatory once accounts are Standard, which can disconnect) | `webhook.ts:42-48` | Add the type; set `disconnected_at`; `canTakePayments` false; alert ops; keep the row so old refunds and disputes still resolve | Yes (schema) |
| 11 | `radar.early_fraud_warning.created` feeds a per-seller risk signal | **Missing** | `webhook.ts:42-48` | Add the type; insert into a new `seller_risk_signals` table (seller, kind, charge, at); `alertOps` | No for recording; Yes if it auto-freezes |
| 12 | `charge.dispute.created` feeds a per-seller risk signal | **Partial** | `webhook.ts:252-277` (order status and bell only) | Also insert a risk signal row and `alertOps` | No |
| 13 | Per-seller freeze that stops new checkouts | **Missing** | section 7 | `payments_frozen_at` on `seller_payment_accounts`, checked in `canTakePayments`, set from Admin; webhook keeps processing | Yes (schema) |
| 14 | Requirements shown to the seller | **Missing** | `overview.ts:77` `requirementsDue: []` | Read from stored `requirements` (from 6) | No (after 6) |
| 15 | `capability.updated` handled | **Missing** (low) | `webhook.ts:42-48` | Treat as a refresh trigger (`refreshPaymentAccount`) | No |
| 16 | Restricted key with complete permission list | **Partial** | `wrangler.jsonc:171-176` lacks Application Fees read, PaymentIntents read | Add them to the runbook; refuse `sk_live_` in production (`stripe-api.ts:41`) | No (ops) |
| 17 | Least privilege across concerns | **Partial** | `config.ts:12-16` one key for Billing and Connect | Two restricted keys (`STRIPE_SECRET_KEY` for Billing, `STRIPE_CONNECT_SECRET_KEY` for Connect), each with only its permissions | No (ops) |
| 18 | Secrets never reach the client | **Exists** (no guard) | section 8 | Add `import "server-only"` to `stripe-api.ts` and the connect modules | No |
| 19 | Direct charges with `application_fee_amount` | **Exists** | `stripe-provider.ts:122-168` | Keep; add a CI grep that fails on `transfer_data`, `on_behalf_of`, `/transfers`, `transfer_group`, `source_transaction` in `src` | No |
| 20 | Never route buyer money through Square Share | **Exists** (calls) | section 5 | None for calls; liability caveat closed by 1 | No |
| 21 | Seller visibly the seller | **Exists** | `CheckoutView.tsx:186-189`; Stripe uses connected-account branding | Verify descriptor and receipt name in test mode; optionally prefill `business_profile.name` | No |
| 22 | Platform fees clearly disclosed | **Partial** | `billing.json:59,83`, `OrderDetail.tsx:457-466`; nothing in `payments.json:64-84` | One line in the Connect dialog: platform fee per plan plus Stripe's own processing fee | No |
| 23 | Platform revenue separate from buyer funds | **Exists** | `billing/stripe-provider.ts:1-3`, `:179-196` | None | No |
| 24 | Collab checkout = cloned PaymentMethod + one direct charge per seller | **Not built**, nothing conflicting | grep finds no multi-seller code; quotes are single-store (`quote.ts`) | When built: platform Customer + PaymentMethod, clone onto each seller, one direct charge each; never SCT or destination | Yes (when built) |
| 25 | Verified against real Stripe | **Missing** | `stripe-mock.ts:19-24`, `payments/availability.ts:26-28` | One run in Stripe test mode with a restricted test key after 1, 5, 6 | Keys and Stripe Dashboard setup: only Adrian |

---

## 13. Moving to the locked account configuration

### The code change (proposal, not applied)

`Store:src/lib/payments/connect/account.ts:153-164`, Accounts v1 with controller properties (Stripe's recommended, non-deprecated form; the API reference now says "The `type` parameter is deprecated. Use `controller` instead"):

```ts
const created = await stripeRequest<StripeAccount>(
  "POST",
  "/accounts",
  {
    controller: {
      losses: { payments: "stripe" },          // Stripe liable for negative balances
      fees: { payer: "account" },              // the seller pays Stripe's fees
      stripe_dashboard: { type: "full" },      // full Stripe Dashboard, no Express
      requirement_collection: "stripe",
    },
    country: CONNECT_ACCOUNT_COUNTRY,          // "CZ" during the beta
    ...(owner.email ? { email: owner.email } : {}),
    capabilities: { card_payments: { requested: true } },
    metadata: { owner_id: owner.ownerId },
  },
  // A NEW key: a reused key with different parameters is refused for 24 h.
  { idempotencyKey: `connect_account_full_${owner.ownerId}` },
);
// Refuse anything Stripe did not create exactly as asked, before recording it.
if (
  created.type !== "standard" ||
  created.controller?.losses?.payments !== "stripe" ||
  created.controller?.fees?.payer !== "account" ||
  created.controller?.stripe_dashboard?.type !== "full" ||
  created.country !== CONNECT_ACCOUNT_COUNTRY
) { /* alertOps, do not upsert, throw */ }
```

Per Stripe's migration guide, these four values "map to a Standard account's behavior" and an account so created reports `type: "standard"` ("The account was created as a Standard connected account or with controller properties matching Standard accounts"). The equivalent legacy call is `type: "standard"` plus `country`, still accepted on the pinned `2025-08-27.basil` version. Accounts v2 equivalent: `dashboard: "full"`, `defaults.responsibilities.losses_collector: "stripe"`, `fees_collector: "stripe"`. Stripe's support matrix allows this combination (`stripe_dashboard.type = full` is incompatible only with `losses.payments = application`, `fees.payer = application`, `requirement_collection = application`).

**One question for Adrian (legal, not code):** the owner's research distinguishes Standard accounts (§4.3/§9, excluded) from "attribute-based" accounts (§4.2(c), joint liability unless Stripe Managed Risk). An account created with controller properties is reported by the API as `type: "standard"`, but whether the Connect Platform Agreement treats it as a Standard account or as attribute-based is a contract question. The API reference also says of `losses.payments = stripe`: "To use Stripe negative balance liability, your integration must meet Managed Risk requirements". If there is any doubt, `type: "standard"` is the conservative choice because the terms name Standard accounts.

Capabilities: `transfers` is dropped because direct charges do not need it (inferred; whether CZ requires `transfers` alongside `card_payments` is unverified against docs). A `transfers` capability alone moves no money; the real guard is item 19's CI grep.

**Accompanying changes:**
- `StripeAccount` (`stripe-api.ts:110-115`): add `type`, `country`, `controller`, `requirements`.
- `dashboardLink` (`account.ts:208-214`): remove the `login_links` call (Stripe refuses it for non-Express accounts); full-Dashboard sellers sign in to Stripe themselves, so the button links to the Stripe Dashboard.
- Webhook: add `account.application.deauthorized` (a Standard account can disconnect the platform) and the item 6 re-checks.
- `wrangler.jsonc:166-167`: "Connect enabled with Standard (full Dashboard) accounts", Stripe pricing model "Stripe handles pricing".
- Stripe Standard onboarding note: "After you create an account link on a Standard account, you won't be able to read or write Know Your Customer (KYC) information. Prefill any KYC information before creating the first account link." The current code prefills only email, which is fine.
- Overview reads (`overview.ts`) keep working on Standard accounts via the `Stripe-Account` header (inferred).

### What it means for accounts that already exist

- Stripe: "After you create a connected account, you can't change its type." and "You can't change the `controller.stripe_dashboard.type` of an existing connected account. To change a connected account's dashboard, you must create a new `Account` object." Country is equally fixed.
- Code: `ensurePaymentAccount` returns an existing row unchanged (`account.ts:150-151`), the row's PK is `owner_id`, and the id "never change[s] once the row exists" (`account.ts:106-107`). So the code change alone does nothing for a seller who already has an Express account.
- If any Express account exists (test or live), each needs: a new full-Dashboard account and a fresh onboarding by the seller; a row model that keeps the old `acct_` resolvable for webhooks (refunds and disputes on old charges arrive from the old account, `webhook.ts:144`) while new checkouts use the new one (schema change: for example a `superseded_at` column or a history table); and the old Express account kept until its refund and dispute window has passed, during which Efficontrol remains liable for its negative balance; then rejected or closed in Stripe (mechanism unverified against docs).
- Expected count in production: **zero** (section 0). Two read-only checks only Adrian can make settle it: `select count(*), count(*) filter (where livemode) from public.seller_payment_accounts;` and the Stripe Dashboard's Connect accounts list (test and live). If both are zero, the change is a pure code change with no migration of accounts.

---

## 14. What could not be verified

- Production database contents (row count of `seller_payment_accounts`, `billing_switches` values): not queried by rule.
- Production Worker secrets (whether `STRIPE_SECRET_KEY` or the webhook secrets are set, and whether the key is `rk_`): not visible.
- Whether Stripe Connect is enabled on the platform account and with which settings, and whether any Express account exists in Stripe: not visible.
- Whether spec 87 currently passes: not run by rule (memory says it passed against the stand-in on 2026-10-08).
- Stripe points marked (unverified against docs): Express default when `country` is omitted; whether Express accounts with direct charges incur per-account and per-payout Connect fees; exact restricted-key permission names; whether CZ requires `transfers` with `card_payments`; how to reject an old Express account; statement descriptor shown for these direct charges.
- Contract mapping of controller-property accounts to the Connect Platform Agreement sections: legal question for Adrian.

**Stripe documentation consulted (2026-11-22):**
- https://docs.stripe.com/api/accounts/create (parameters, `type` deprecated, `controller.*` definitions)
- https://docs.stripe.com/connect/migrate-to-controller-properties (type to controller mapping, dashboard type immutable, unsupported combinations)
- https://docs.stripe.com/connect/accounts (type immutable, liability table, Express country fixed, additional cost)
- https://docs.stripe.com/connect/standard-accounts (Standard creation, country default, account links, KYC prefill)
- https://docs.stripe.com/api/accounts/login_link/create (Express Dashboard only)
- https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=stripe-hosted (Stripe-Account header, branding, fee limits, refunds)
- https://docs.stripe.com/connect/accounts-v2/connected-account-configuration (v2 equivalents)
- https://stripe.com/connect/pricing (the two pricing models)
