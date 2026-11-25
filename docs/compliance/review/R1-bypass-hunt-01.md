# R1 bypass hunt 01: commit 7c5d1df

Adversarial review of RULE R1 (a seller may publish or sell only when established
in the market) as built in `e43eedd..7c5d1df`, read from the read-only checkout
`C:\dev\sq-market-review` (detached at 7c5d1df). Nothing was run: no node_modules,
no tests, no servers, no calls to Stripe, Supabase or production. Every file:line
below is in that checkout unless a repo is named. Date: 2026-11-22.

Production facts used: Stripe Connect is OFF (`.env.production:47` is commented
out, so `stripeConnectLive()` is false and no checkout provider exists), and
`seller_payment_accounts` has 0 rows (migration comment,
`supabase/migrations/20261122_market_3a_account_country.sql:13-17`).

---

## 1. Verdict

1. **Yes, narrowly, and not with production's current configuration.** A seller who is outside the market when a buyer arrives cannot get a listing shown or an order placed: every buyer read and the order quote ask the country of establishment, and checkout also asks the Stripe account.
2. Two gaps open once Stripe Connect is on. **R1-01 (P0, bounded):** a Stripe payment page opened while the seller was eligible can still be paid for up to 31 minutes after the seller saves a country outside the market, and the webhook confirms it without re-checking the seller. **R1-02 (P1, latent):** the buyer-facing read side ignores the Stripe account, so a seller the publish gate refuses for their account keeps public listings with a working "Buy now" (their own link or an email).
3. **The worst is R1-02.** It is a lasting public offer, not a 31-minute window. Nothing can reach it today (0 accounts, Connect off). It becomes reachable with any older or unsynced charges-enabled account, and for every seller the day a second country is added to `MARKET`, which the module promises is a config-only change.

---

## 2. Findings

### 2.1 Summary, most serious first

| Id | Title | Severity | Status |
|---|---|---|---|
| R1-01 | Payment confirmed after the seller left the market (TOCTOU), no re-check or alert | P0 (bounded residual) | REAL at this commit, only with Connect on. Accepted by P1a 5.5, but the alert P1a promises is not built. No planned DB guard covers it (P1b line 1055 says so on purpose) |
| R1-02 | Read side ignores the charges-enabled Stripe account: publish-refused seller stays public with a buy button | P1 (latent) | REAL in code. Unreachable with production data today. Reachable with any legacy or unsynced account, and for every seller once `MARKET` has two seller countries |
| R1-03 | `createStorefront` switches buyer pages (and a carried-over cart) on without the seller gate | P2 | REAL. Nothing reaches buyers at this commit (read gate). Makes R1-02 worse |
| R1-04 | `openStripeDashboard` resumes onboarding of an account the market refuses | P2 | REAL. Nothing reaches buyers (`canTakePayments` refuses) |
| R1-05 | Seller's own PostgREST writes: `products.status`, storefront switches, `tax_country` | P2 | Open until P1b file 6 (profiles, products). Storefronts: no guard planned at all. The read side holds at this commit (details in 2.2) |
| R1-06 | `publish_products` reports `already_live` with a `pageUrl` for a seller the gate refuses | P3 | REAL (assistant is told a 404 page is live) |
| R1-07 | Embed JSON stays CDN-cached up to 5 min after the seller leaves; preflight `OPTIONS` has no seller gate | P3 | REAL, display only, no prices in the payload |
| R1-08 | Assistant preview links show a blocked seller's page with prices and a working purchase link or mailto for 15 min | P3 | REAL, bounded, noindex |
| R1-09 | Unknown (null) Stripe country gets the "registered in a country where we do not sell" copy. `get_store`, Overview and checklist fail OPEN on a failed account read | P3 | REAL, copy and display only |
| R1-10 | Product, designer, embed and chrome surfaces use the details-only reader, so a seller outside the market sees no warning until the server refuses | P3 | REAL, UX only |
| R1-11 | `GET /api/products/[id]/reviews` serves reviews of a blocked seller's active product | P3 | REAL, not an offer (no price, no buy path) |
| R1-12 | `updateEmbedSettings` on an unparseable config writes `DEFAULT_STOREFRONT_CONFIG` (product pages resolve ON) through an ungated "off" save | P3 | REAL, edge case. The read gate holds |

### 2.2 Details

#### R1-01. Payment confirmed after the seller left the market (P0, bounded residual)

**Evidence.**
- The checks run only when the order is placed. `placeOrderResponse` calls `quoteOrder` (the gate) at `src/lib/checkout/place-order.ts:128-145`, then `checkoutProviderFor` at `:157-158`. `placeStripeOrder` does a fresh account and country re-read at `src/lib/checkout/stripe-provider.ts:84-90`.
- The Stripe page lives 31 minutes: `SESSION_MINUTES` at `stripe-provider.ts:59`, `expires_at` at `:174`. The pending hold is 45 minutes (`src/lib/orders/record.ts:180`).
- The webhook's `checkout.session.completed` (`src/lib/payments/connect/webhook.ts:194-231`) checks only that the order is this seller's (`:62-71`) and that the amount and currency match (`:215`). It then calls `confirmPendingOrder` (`:225`). It never re-reads the seller's country or account.
- P1a 5.5 accepts the window "because the webhook evidence step re-runs sellerMarketProblem ... and alerts ops". That step does not exist at this commit.
- P1b deliberately has no re-check at `pending -> paid` (P1b-database-guards-design.md:1055). The 3d guard is insert-only.

**Scenario.** Connect is on. Seller S has `tax_country = 'CZ'` and a CZ account that can take charges. At 10:00 a buyer presses Pay: the quote passes, a pending order is written, and a Checkout Session is created on S's account. At 10:05 S saves Settings with country `DE`. `saveTaxInfo` saves it (`src/lib/settings/actions.ts:551`), and `checkAccountMarket` emails ops that the account does not match (`:563-571`, `src/lib/payments/connect/account-market.ts:46-55`). From then on every page 404s and every new POST is refused. At 10:25 the buyer pays on the still-open Stripe page. Stripe sends `checkout.session.completed`, the webhook confirms the order, and the order email goes out (`record.ts:317-320`). Result: a paid order for a seller established in DE. Ops was told about the account, not about the order.

A variant: S's own Stripe account creates a session naming the pending order's id with the same amount. `paidAsQuoted` passes, so the result is the same. It is bounded by the 45-minute hold.

**Smallest fix.** In `webhook.ts`, after `confirmPendingOrder` and `settleOrderFees`, read `readEstablishmentCountry(sellerId)` plus the account already in hand. Run `sellerSellBlock` on them, and call `alertOps("A paid order's seller is outside the market", { order, reason })` when it blocks. Never refuse or refund there (this is P1a 5.5 as designed). Optional: close the window itself. When a `saveTaxInfo` makes the seller blocked, expire their open sessions (`POST /v1/checkout/sessions/{id}/expire` on the connected account, for each pending order whose `payment_ref` is a `cs_` id).

**Test.** In a webhook unit test (next to `tests/unit/checkout-stripe-gate.test.ts`): a seller with stored country `DE`, a pending order, and a matching completed event. Assert that the order is confirmed and that `alertOps` was called once with the new subject.

#### R1-02. The buyer read side ignores the Stripe account (P1, latent)

**Evidence.**
- The read gate passes no account. `sellerMaySell` / `sellerReadGateReasons` call `sellerGateReasons({ identity })` with no `stripeAccount` (`src/lib/settings/seller-identity.ts:201-215`). This is documented as deliberate at `src/lib/settings/trader-identity.ts:207-214` ("absent on the buyer-facing read side, where checkout asks the account itself").
- The write gate does read it: `publishBlockedError` uses `readPaymentAccountResult` and `sellerGateAccount` (`seller-identity.ts:367-394`, `src/lib/payments/connect/account.ts:159-161`). So does the SQL twin `seller_sell_block`, whose second reason is `'account_country'` (`20261122_market_3a_account_country.sql`, function body). The write side and the read side therefore disagree.
- Every buyer loader decides by `sellerMaySell` alone: `src/lib/products/purchasable.ts:322-323` (product page, product checkout page, cart, discount check, quote), `src/lib/storefront/storefront-page.ts:265-266` (hosted storefront, embed frame), `src/app/api/embed/[key]/route.ts:56-76`, `src/app/api/og/p/[productId]/route.ts:95`, and `src/lib/seo/sitemap.ts:158`.
- When the account is refused, checkout is off (`src/lib/checkout/availability.ts:84`), but the page still renders. Its button falls back to the seller's own link, then to an email (`src/components/product-page/cta-target.ts:93-117`, called through `src/lib/products/public.ts:236-237`). The page also emits a Product + Offer JSON-LD (`src/lib/seo/structured-data.ts:99-105`).

**Scenario.** Seller S has `tax_country = 'CZ'`, complete details, and active products on a storefront with product pages on. S's `seller_payment_accounts` row has `charges_enabled = true` and either:
- `country = NULL`: a row written before 3a, never re-synced. The onboarding return swallows refresh errors (`src/app/api/payments/connect/return/route.ts:36-44`), and an `account.updated` without a country keeps the stored null (`account.ts:166-178`).
- `country = 'DE'`: an account created before v2 sent no country (Audit E X18).

`publishBlockedError` refuses S (`stripe_country_not_allowed` or `seller_country_mismatch`), and `canTakePayments` refuses checkout. Yet a buyer opening `/s/{F}/p/{P}` passes `gatePurchasable`. The buyer sees the price, a "Buy now" button pointing to S's https link or a `mailto:` enquiry, and an Offer in the JSON-LD. The storefront page and embed frame show the board, and the sitemap lists the pages.

S can even add new listings. S makes a product active straight through PostgREST (R1-05), which the read side does not stop. Or S creates a new storefront: `createStorefront` turns product pages on without the gate (R1-03), and `saveStorefront` never asks either, because no switch changes (`src/lib/storefront/actions.ts:342-345`).

At expansion (for example `MARKET.sellerCountries = ['CZ','SK']`), any seller with a CZ account who saves SK gets exactly this. `sellerMaySell` passes (SK is allowed), while `publishBlockedError` and `canTakePayments` refuse the mismatch.

**Smallest fix.** Count the account on the read side without an extra round trip. `seller_payment_accounts.owner_id` references `profiles(id)` (`supabase/migrations/20261008_seller_payment_accounts.sql:34`), so the service-role profile read can embed it:
- Add `seller_payment_accounts(charges_enabled, country)` to the gate select used by the read side (a new `READ_GATE_SELECT`, or `TRADER_GATE_SELECT` itself, since `buildSellerIdentity` copies field by field).
- Change `sellerMaySell(row)` to pass `stripeAccount: sellerGateAccount(row.seller_payment_accounts)` into `sellerGateReasons`.
- `purchasable.ts:291`, `storefront-page.ts:248`, `embed/[key]/route.ts:61`, `og/.../route.ts:84-88`, `sitemap.ts:152` and the two previews then follow with no new query.
- Update the comment at `trader-identity.ts:207-214`.

**Test.** Extend `tests/unit/market/seller-gate-reads.test.ts`: CZ, complete details, a charges-enabled account with `country: null`, and then with `'DE'`. Expect the embed JSON to answer 404 and the product, storefront and frame loaders to return null. Add a `listIndexablePages` test that the seller's pages are left out. Add a case to `tests/unit/market/expansion.test.ts` with a widened market (CZ, SK): establishment SK plus a CZ account gives `sellerMaySell === false`. Add a DB-project assertion that the embedded select returns the account for the service role.

#### R1-03. `createStorefront` switches buyer pages on without the gate (P2)

**Evidence.**
- New storefronts get `productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, allowIndexing: true }` (`src/lib/storefront/actions.ts:166`, `:180-189`), and `DEFAULT_PRODUCT_PAGE_CONFIG.enabled` is `true` (`src/types/storefront.ts:1257-1258`).
- `carryOverDesign` copies the previous storefront's product page and cart, a cart switched on included (`src/lib/predictions.ts:347-353`).
- No `publishBlockedError` call exists in `createStorefront` (`actions.ts:111-217`). Later saves ask only when a switch turns on (`src/lib/storefront/public-gate.ts:57-59`).
- `tests/unit/market/coverage.test.ts:162` exempts SF-01 as "shown only through the read gates".

**Scenario.** A seller with `tax_country = 'IE'` creates a storefront (UI or MCP `create_storefront`, `src/lib/agent/tools/storefronts.ts:254`). The row is stored with product pages on (and the cart on, if the last storefront had it on), and the seller places tiles freely. At this commit buyers get a 404 (`storefront-page.ts:266`), so nothing is exposed. Combined with R1-02 it becomes a new public storefront.

**Smallest fix.** In `createStorefront`, ask `publishBlockedError(account.accountId)`. When it refuses, insert with `productPage.enabled = false` and the carried cart forced off (creating is never refused).

**Test.** In `tests/unit/market/seller-gate-write-paths.test.ts`: an outside-market seller's `createStorefront` stores a config where `switchesOnForBuyers(null, config)` is false.

#### R1-04. `openStripeDashboard` resumes onboarding of a refused account (P2)

**Evidence.**
- `startStripeOnboarding` refuses a missing country, a country outside the market, and a mismatched account (`src/lib/payments/connect/actions.ts:69-94`).
- `openStripeDashboard` (`:109-126`) hands out `onboardingLink` whenever `!detailsSubmitted` (`:120`), with no market check.
- `coverage.test.ts:113` exempts A-04 as "writes nothing in the database".

**Scenario.** A seller onboarded a CZ account part way, then saved `tax_country = 'DE'`. "Open Stripe" takes them back into onboarding. They finish it, `account.updated` stores `charges_enabled = true`, and ops gets an alert. `canTakePayments` refuses (`src/lib/payments/connect/account.ts:144-151`), so no buyer can pay. Under R1-02 the listings stay hidden only because the establishment check refuses.

**Smallest fix.** In `openStripeDashboard`, for the `!detailsSubmitted` branch, run the same `readEstablishmentCountry` and `sellerSellBlock` checks as `startStripeOnboarding`, and refuse with `marketRestricted`. The dashboard link for a submitted account stays open: payouts from past sales must stay reachable.

**Test.** In `tests/unit/market/connect-country.test.ts`: DE establishment with an unfinished account gives `market_restricted` and no `account_links` call.

#### R1-05. Seller's own PostgREST writes (P2, open until P1b file 6; storefronts never)

**Evidence.**
- `products_update_writer` lets the owner or an editor set `status = 'active'` directly (`tests/db/prod-migrations.sql:927-937`). The planned guard is P1b 3b (`seller_sell_block` when a row becomes sellable).
- `storefronts.config` can be written directly, including `embed.enabled` and the page switches. P1b plans **no** storefronts guard (grep of P1b: only the monitor touches `storefronts`).
- `profiles.tax_country` accepts any `^[A-Z]{2}$` (`tests/db/prod-migrations.sql:261-262`). The planned guard is P1b 3a.

**What the read side does at this commit.**
- **An active product of a seller with country `DE`, `XX` or null:** absent from the product page, checkout, cart, quote, storefront, frame and sitemap. The OG image answers 404. Code: `purchasable.ts:322-323`, `storefront-page.ts:265-266`, `og/.../route.ts:95`, `sitemap.ts:158`. A value that is not a storable country reads as missing (`seller-identity.ts:104-109`); a storable one outside the market is refused (`src/lib/market/problems.ts:52-58`).
- **Embed switched on in the row:** the JSON answers 404 (`embed/[key]/route.ts:169-172`), and the frame draws nothing (`storefront-page.ts:266` via `src/lib/storefront/embed-frame-loader.ts:78`). Only the `OPTIONS` preflight still answers 204 to an allowed origin (R1-07).
- **What is exposed:** nothing priced, nothing buyable. Left over: the seller's own dashboard shows the product as active; `publish_products` calls it `already_live` (R1-06); the reviews API serves its reviews (R1-11).
- **The one way through is a false `tax_country = 'CZ'`.** That is the same declaration the Settings form accepts, so it is not a bypass of the gate. See section 5 on evidence.
- Under R1-02, a direct `status = 'active'` by a seller refused only for their Stripe account **does** reach buyers.

**Smallest fix.** P1b file 6 as designed for profiles and products, with the 3a conflict in section 5 resolved first. For storefronts, the read gates are the wall by design: keep R1-02's fix so they carry every reason.

**Test.** DB project: a seller JWT setting `status = 'active'` for a seller with country DE is refused once 3b ships. Until then, keep `seller-gate-reads` cases for each read loader.

#### R1-06. `publish_products` says `already_live` for a refused seller (P3)

**Evidence.** For a product already `active`, the tool skips the write (`src/lib/agent/tools/products.ts:276-293`). It then returns `outcome: "already_live"` and a `pageUrl` whenever a storefront has product pages on (`:251-258`, `:295-301`), without asking the seller gate.

**Scenario.** An IE seller's assistant runs `publish_products` on products made active before R1. The card says "already live" and links to a page that answers 404 to buyers.

**Fix.** When any requested product is already active, call `publishBlockedError` once. On a refusal, report each such product as `refused` with that envelope and no `pageUrl`.

**Test.** In `tests/unit/agent/`: an outside-market seller with an active product gets `refused` and `market_restricted`.

#### R1-07. Embed JSON cache and the ungated preflight (P3)

**Evidence.**
- `Cache-Control: public, max-age=60, s-maxage=300` (`src/app/api/embed/[key]/route.ts:201-205`).
- `OPTIONS` reads only the config and the allowlist (`:230-252`).

**Scenario.** A seller saves DE. For up to 300 s the CDN, plus 60 s in browsers, keeps serving the board: theme, text blocks, signed image URLs, and product tiles whose `productUrl` now answers 404. The payload carries no prices or titles (`:346-365`). Separately, a preflight from an allowed origin for a blocked seller's key answers 204, which says the key is live.

**Fix.** Acceptable as documented (Audit E X15). If wanted, lower `s-maxage`, or answer the `OPTIONS` with the same `canPublish` (one profile read per preflight, rate limited first).

#### R1-08. Assistant preview links (P3)

**Evidence.**
- Preview pages read as the grant, with no seller gate by design (`src/lib/agent/preview/product-page-preview.ts:72-153`).
- Their button is the buyer page's own: purchase link, then checkout, then email (`:141-147`).
- Tokens live 15 minutes (`src/lib/agent/preview/token.ts:17`). The route is CORS `*` and `no-store` (`next.config.ts:285-291`).

**Scenario.** An IE seller asks their assistant for `preview_product_page` and pastes the live link to a buyer. For 15 minutes the buyer sees the price and a working link to the seller's shop or a mailto. Checkout is not offered (`checkoutAvailableFor` refuses DE).

**Fix.** Optional. When `notes.notPublic` holds a seller-gate note, render the purchase-link and mail CTAs inert (`kind: "none"`) in preview mode.

#### R1-09. Unknown Stripe country copy, and fail-open display (P3)

**Evidence.**
- `sellerSellBlocks` turns a charges-enabled account with `country: null` into `stripe_country_not_allowed` (`src/lib/market/problems.ts:59-63`). Its copy reads "your Stripe account is registered in a country where Square Share does not sell yet ... contact support", with no action (`src/lib/errors.ts:253-279`, `messages/en/errors.json`).
- `getSellerGateStatus` reads the account through `getPaymentAccount`, which turns a failed read into "no account" (`account.ts:104-109`, `seller-identity.ts:331-349`). `get_store` then says `canSell: true` (`src/lib/agent/tools/store.ts:87`), and the Overview and checklist agree, while `publishBlockedError` refuses.

**Fix.**
- Add a separate `stripe_country_unknown` block, with copy pointing to Payments ("finish syncing your Stripe account"), and the matching SQL reason.
- In `getSellerGateStatus`, use `readPaymentAccountResult` and answer `{ ok: false }` on failure.

#### R1-10. Details-only warnings (P3)

**Evidence.** `getTraderIdentityStatus` (details only, `seller-identity.ts:300-317`) feeds:
- `src/components/dashboard/DashboardShell.tsx:54`
- `src/app/(dashboard)/products/page.tsx:120`
- `products/new/page.tsx:88`
- `products/[id]/edit/page.tsx:71`
- `products/import/page.tsx:40`
- `src/app/storefront/(designer)/[id]/page.tsx:94`
- `storefront/(list)/page.tsx:49`
- `storefront/(list)/[id]/embed/page.tsx:51`

Only the Overview and Settings read `getSellerGateStatus`.

**Scenario.** An IE seller with complete details sees no banner on the product form or the embed toggle. They choose Active and get `market_restricted` on save. The refusal is correct; there was just no warning first.

**Fix.** Switch those callers to `getSellerGateStatus` and render the market reason with `sellerGateError`.

#### R1-11. Reviews API for a blocked seller (P3)

**Evidence.** The GET checks only that the product is `active` and visible (`src/app/api/products/[id]/reviews/route.ts:57-77`, `src/lib/reviews/queries.ts:73-84`).

**Scenario.** Anyone with a product id gets the rating summary and approved reviews of an IE seller's active product. The response has no price and no buy path.

**Fix.** Optional. Add the owner's `sellerMaySell` to `isReviewableProduct` for the GET, keeping POST eligibility as it is.

#### R1-12. Embed-settings save rewrites a broken config with defaults (P3)

**Evidence.** `updateEmbedSettings` gates only `enabled: true` (`src/lib/storefront/actions.ts:514-522`). It writes `parseStoredStorefrontConfig(row.config) ?? DEFAULT_STOREFRONT_CONFIG` (`:537-540`), and `resolveProductPage` treats a missing `productPage` as enabled (`src/lib/storefront/product-page.ts:124-128`).

**Scenario.** A storefront whose stored config no longer parses (and so reads as all switches off) gets an "embed off" save. It is rewritten with defaults, which switches product pages on with no gate. The read gate still refuses an outside-market seller.

**Fix.** Refuse the save when the stored config does not parse (the designer save already treats it as off and gates it), or gate with `switchesOnForBuyers(null, config)`.

### 2.3 Attacked and not real

| Attack | Why it does not work (evidence) |
|---|---|
| Lower case, whitespace, `''`, `'XX'` in `tax_country` | The DB CHECK allows only `^[A-Z]{2}$` or null (`tests/db/prod-migrations.sql:261-262`). `establishmentCountryOf` is an exact match against the storable list, so anything else reads as null, which means "details missing" and refuses (`seller-identity.ts:104-109`, `trader-identity.ts:114-120`, `:169`). `marketAllows` is exact and case-sensitive (`src/lib/market/market.ts:80-87`) |
| TS accessor against SQL `market_seller_country` | They agree on every class. CZ: both allow. DE: both block. XX: TS null (details missing), SQL `'XX'` (not allowed): both block. Null, `''` or a missing row: both block. Lower case cannot be stored. They differ only in the reason code, which drives copy (`20261122_market_2_rules_mirror.sql:164-191`) |
| Widening `MARKET` at run time | Frozen object and frozen arrays (`market.ts:66-76`). No environment read in `lib/market` or the gate modules. Every src call of `sellerMaySell`, `sellerReadGateReasons`, `sellerGateReasons` and `canTakePayments` passes no market argument (grep). None is used as an array callback where an index could land in `market` |
| A team member laundering a country | `saveTaxInfo` writes `user.id` only (`src/lib/settings/actions.ts:551`). Every gate is called with the active store's owner id (`src/lib/products/actions.ts:367`, `:456`; `card-actions.ts:66`; `import-actions.ts:166`; `storefront/actions.ts:343`, `:520`; `page-config-route.ts:198`). Stripe onboarding is owner-only (`connect/actions.ts:32-40`). An owner outside the market with a member inside is refused; the reverse is allowed, which is the intended model |
| CSV rows carrying their own `status` | Ignored: every row takes the request's status (`src/lib/products/csv.ts:392-397`), which is gated at `import-actions.ts:165-168` |
| Duplicate | Always `draft` (`card-actions.ts:142`) |
| Single-column writers (stock, badges, add-ons) | Never write `status`. The card toggle to active is gated (`card-actions.ts:65-68`) |
| MCP setting the country or creating a Stripe account | `saveTaxInfo`, `startStripeOnboarding` and `openStripeDashboard` are person-only (`tests/unit/agent/registry.test.ts:85`, `:163-164`). Every publishing tool calls a gated action (`agent/tools/products.ts:189`, `:227`, `:287`, `:355`; `storefronts.ts:314`, `:387`, `:442`, and the page routes' PATCH) |
| Admin restore relisting | Writes moderation columns only (Admin `src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:387-410`). The read gates decide |
| Dev test provider | Needs `NODE_ENV=development` and `CHECKOUT_TEST_PAYMENTS=1` (`availability.ts:42-44`), re-checked at `src/lib/checkout/provider.ts:102`. The quote's gate still refuses an outside-market establishment |
| `account.updated` before the row exists | Answered "not one of our accounts" (`webhook.ts:150-152`). The row is then created with Stripe's creation-time facts, and charges become enabled only through later events. It fails closed either way |
| `account.updated` without a country | Keeps the stored value (`account.ts:166-178`). A stored null blocks payments and publishing (it shows up only through R1-02) |
| Code deployed before migration 3a | The `country` select errors. `publishBlockedError` then refuses every publish (`seller-identity.ts:384`, `:436`), checkout turns off (`account.ts:106-109`), and Connect webhooks answer 500 and retry (`account.ts:130`). The prod-schema sentinel blocks such a deploy (`scripts/lib/prod-schema.ts`, the 3a column and body entries) |
| Missing profile row | The read gate returns false (`seller-identity.ts:202`). `readEstablishmentCountry` gives null, so onboarding is refused and `canTakePayments` is false. `publishBlockedError` reads every detail as missing |
| Another seller's product placed in a storefront through PostgREST | Product reads are owner-scoped (`purchasable.ts:283`, `storefront-page.ts:139`). The embed JSON lists only an id, and its link 404s |
| Module caches keyed by seller | Only the report scopes (`src/lib/products/public.ts:316-324`). No gate result is cached across requests. Public pages are dynamic (`headers()`), and no `revalidate` or `use cache` exists under `(public)`, `lib/storefront`, `lib/products` or `lib/checkout` |

---

## 3. Checklist

### 3.1 Audit E bypass catalogue (X1 to X21), as it stands for R1 at 7c5d1df

| # | Bypass | R1 at 7c5d1df | Line that closes it, or what closes it and when |
|---|---|---|---|
| X1 | Direct PostgREST writes | **Still open (writes)**, closed for buyers | The read gates refuse an establishment outside the market: `purchasable.ts:322-323`, `storefront-page.ts:265-266`, `embed/[key]/route.ts:169`, `og/.../route.ts:95`, `sitemap.ts:158`. Writes close with P1b file 6 (3a profiles, 3b products). Storefronts: no guard planned. Exception: R1-02 (account-only refusals) |
| X2 | MCP tools | Closed | Tools call the gated actions (see 2.3). No country or Stripe writes over MCP (`registry.test.ts:85`, `:163-164`). Residuals: R1-03 (`create_storefront`), R1-06 |
| X3 | CSV import and `import_products` | Closed for R1 | `import-actions.ts:165-168`, `csv.ts:392-397` (currency is R2) |
| X4 | Embed on a foreign site | Closed, plus 5-min display staleness | JSON `route.ts:169`; frame `embed-frame-loader.ts:78`, then `storefront-page.ts:266`; R1-07 |
| X5 | Plain buy link | Closed | Product page gate `purchasable.ts:323` |
| X6 | Cart routes | Closed for R1 | `src/lib/cart/route.ts:33` (gate); checkout re-quotes (`place-order.ts:128`) |
| X7 | Duplicate | Not applicable (draft only) | `card-actions.ts:142` |
| X8 | Partial updates and status toggles | Closed for R1 | `card-actions.ts:65-68`; single-column writers never touch `status` |
| X9 | Lossy edit paths | Not applicable to R1 | R2 (commit 341ab30 replaced `toCurrency`) |
| X10 | Admin restore | Closed by the read gates | As X1. Admin writes only moderation columns |
| X11 | Demo simulator | Not applicable to R1 (no buyer; the demo seller is CZ per P1a 4.8) | Still writes orders without `seller_sell_block` (`20260801_demo_sales_sim.sql:268-270`, `:325`). R2 and R3 close with P1b file 4 |
| X12 | Service-role jobs | Not applicable | None publishes or sells |
| X13 | Webhooks | `account.updated` **closed**. `checkout.session.completed` **still open** | Country stored at `webhook.ts:173-191` and `account.ts:166-178`. Confirmation: R1-01, which nothing planned closes (P1b 1055); P1a 5.5's alert would detect it |
| X14 | TOCTOU | **Still open (bounded)** | R1-01. 31-minute page (`stripe-provider.ts:59`), 45-minute hold (`record.ts:180`) |
| X15 | Stale caches | Closed for sales; display staleness remains | Checkout re-reads fresh (`stripe-provider.ts:84-90`). Pages are dynamic. Embed JSON: R1-07 |
| X16 | Shipping policy free text, `"*"` | Not applicable to R1 | R3 |
| X17 | Currency coercion | Not applicable to R1 | R2 |
| X18 | Stripe country never stored | **Closed** | Created only in the market country (`account.ts:223-246`); Stripe's answer stored (`:248-261`, `:166-178`); `canTakePayments` requires agreement (`:144-151`); onboarding refuses mismatch (`connect/actions.ts:85-94`). Residuals: R1-02 (read side), R1-04 (dashboard link) |
| X19 | Google OAuth sign-up | Closed by the gate | A missing country is a missing detail (`trader-identity.ts:114-120`, `:169`), and no publish or buyer read passes without it |
| X20 | Operator scripts, dev simulator | Not applicable to production | Dev-gated (`route.dev.ts`, `SEED_ENV=dev`). P1b orders guard later |
| X21 | Team members | Closed | 2.3 row "team member" |

### 3.2 Inventory section 4 (paths that bypass every choke point), for R1

| BP | Path | R1 at 7c5d1df | Evidence, or what closes it |
|---|---|---|---|
| BP-1 | DB-01 `tax_country` PATCH | Write open until P1b 3a. Buyers closed | Non-storable reads as missing (`seller-identity.ts:104-109`), outside the market is refused (`problems.ts:56-58`). A false `CZ` is the form's own declaration |
| BP-2 | DB-02 `products` direct write | Write open until P1b 3b. Buyers closed (except R1-02) | `purchasable.ts:322-323` and the others |
| BP-3 | DB-03 discounts | Not applicable to R1 | |
| BP-4 | DB-06 storefront config, embed on | Write open, **no guard planned**. Buyers closed | `embed/[key]/route.ts:169`, `storefront-page.ts:266` |
| BP-5 | J-03 demo simulator | Not applicable to R1 | X11 |
| BP-6 | DB-05 seed | Not applicable (dev) | |
| BP-7 | O-11 dev simulate-sale | Not applicable (dev builds only) | `src/app/dev/simulate-sale/route.dev.ts` |
| BP-8 | AD-02/03 Admin restore | Closed by the read gates | As X10 |
| BP-9 | SF-02/SF-03 switch on | Closed | `storefront/actions.ts:342-345`, `:519-522`; `page-config-route.ts:197-200`. Residual R1-03 (create), R1-12 |
| BP-10 | P-06 card toggle | Closed for R1 | `card-actions.ts:65-68` |
| BP-11 | P-08 duplicate | Not applicable | Draft |
| BP-12 | P-10 to P-12 partial updates | Not applicable | No `status` write |
| BP-13 | Lossy edits | Not applicable to R1 | R2 |
| BP-14 | O-03 confirmation after the window | **Still open** | R1-01 |
| BP-15 | RG-5 to RG-8 calling CP-1 directly | Closed (cannot diverge) | Embed and OG now call `sellerMaySell` (`route.ts:68`, `og:95`); previews call `sellerReadGateReasons` (`src/lib/agent/preview/seller-gate-notes.ts:19`). All share R1-02 |
| BP-16 | A-01/A-02/A-03 account country | Closed | X18. Residual R1-04 |
| BP-17 | Service-role exemption trap in triggers | Not applicable yet | No guards built. P1b says every guard binds every role |
| BP-18 | S-02 OAuth | Closed by the gate | X19 |
| BP-19 | C-07 cart with `adding:false` | Closed for R1 | `cart/route.ts:33` gate, plus the re-quote at POST |

---

## 4. Traced end to end and sound, and what was not traced

### 4.1 Sound (no need to re-check)

1. **The rule.**
   - `sellerSellBlocks` puts establishment first. It counts an account only when one is given, and blocks a null account country (`problems.ts:52-69`).
   - `sellerGateReasons` turns `seller_country_missing` into a details reason and everything else into the market reason, market first (`trader-identity.ts:222-236`).
   - `publishBlockedError` answers the first reason with its own code (`seller-identity.ts:430-439`, `errors.ts:282-285`).
2. **The write gate.**
   - Uncached, service role. It refuses on a profile read error, an account read error, or a thrown admin client (`seller-identity.ts:367-406`).
   - It is called with the store owner's id on every publish write: product create and update (`products/actions.ts:333-338`, `:367`, `:456`), the card toggle, the import, the three storefront switch writes, and the page routes.
   - MCP inherits it.
3. **The read gate.**
   - Every buyer surface found decides by `sellerMaySell` on a `TRADER_GATE_SELECT` row, and fails closed on a read error: product page, product checkout page, cart page, cart API, discount checks, quote, hosted storefront, embed frame, embed JSON, OG, sitemap.
   - Inventory of `src/app/(public)` pages and `src/app/api` routes: every buyer page imports only these loaders. The orders, order, download and withdraw routes are post-sale and show nothing for sale.
4. **The money path.**
   - `placeOrderResponse` runs the quote (gate) and then `checkoutProviderFor`, which calls `canTakePayments` with the owner's establishment country through a cached read that fails closed (`availability.ts:74-87`, `seller-identity.ts:150-153`).
   - `placeStripeOrder` re-reads the account and country fresh before Stripe is asked for money (`stripe-provider.ts:84-90`).
   - Every `canTakePayments` caller passes the store owner's country.
5. **Stripe creation and sync.**
   - `ensurePaymentAccount` throws outside the market before Stripe is called, always sends `country`, uses the v2 idempotency key, and stores Stripe's answer even when it mismatches (`account.ts:203-266`).
   - The onboarding return and `account.updated` store the country, never clearing it (`return/route.ts:35-44`, `webhook.ts:173-191`).
   - A Settings save outside the market with a charges-enabled account alerts ops (`actions.ts:563-571`).
6. **Multi-tenant, migration ordering, missing profile rows, MCP surface, Admin restore:** see 2.3.

### 4.2 Not traced (and why)

- **Runtime behaviour.** Nothing could be run, so none of this was observed:
  - React `cache()` in route handlers;
  - that `headers()` keeps every `(public)` page uncached on OpenNext/Cloudflare;
  - that Cloudflare honours `s-maxage=300` on the embed JSON.
- **Stripe behaviour, assumed rather than checked.** That `Account.country` is always present in create responses and `account.updated` payloads; Express onboarding country defaults for pre-v2 accounts; idempotency-key reuse inside 24 hours.
- **Non-production data.** Whether any staging, dev or e2e database holds charges-enabled rows with a null or foreign country (the R1-02 trigger condition). Production has 0 rows per the migration comment; this was not queried.
- **RLS on `profiles` updates by the owner.** Taken from the inventory (DB-01). Policy text not re-read.
- **Client components.** `TaxSection`, `WelcomeFlow`, `ProductForm`, `EmbedSettings`, the cart and quick-add clients were not read beyond call sites. They are not a gate.
- **Admin repo, beyond the restore write.**
- **Order emails** (`src/lib/orders/emails.ts`, the review reminder job). Not read for "buy again" links. Any such link lands on a gated page.

---

## 5. Outside R1, tripped over (one line each)

- **P1b 3a conflicts with this commit.** As designed it refuses saving a `tax_country` outside the market (`market_rule:seller_country`) and locks it to the account (`country_locked`). This commit and the brief say "saved truthfully" (`actions.ts:557-562`). Reconcile before file 6.
- **P1b 3e makes `account.updated` fail on a mismatch.** Once it ships, every `account.updated` for a mismatched account fails `saveAccountFacts`, which writes `charges_enabled` and `country` together. The event retries for days, and payouts and requirement updates stop landing.
- **The Stripe half of R1 is moot while Connect is off.** With Connect off in production, R1 rests entirely on the self-declared `tax_country`: the Stripe half never applies, and a seller established elsewhere who picks CZ is public, with their purchase link. That is accepted in P1a 4.4, but it is worth stating to the owner.
- **A second reader of `tax_country`.** `src/lib/billing/customer.ts:43` reads it with its own normalisation (trim, upper case), contrary to the "ONE accessor" claim. It is billing only.
- **Members can move products between stores.** `products_update_writer` lets a person who is an editor on another store move a product between stores by PATCHing `owner_id` (`tests/db/prod-migrations.sql:927-937`). It is counted by `guard_account_ceiling`, but ownership can be laundered both ways.
- **Admin's live link ignores the seller gate.** The moderation view computes `liveUrl` without the seller gate (Admin `src/lib/data/moderation.ts:785-793`), so staff may see a hidden page as live.
- **The embed JSON skips status and owner checks on tiles.** `publicBlocks` emits product tiles regardless of product status or owner (`src/app/api/embed/[key]/route.ts:313-366`), so draft and foreign product ids leak as ids. This predates the commit.
- **The market config promise does not hold.** The header of `src/lib/market/market.ts` promises that adding a country is an edit to `MARKET` only. R1-02 shows the read side would open on that day: add an expansion test for the establishment and account mismatch.
- **Deauthorization is not handled.** No code handles a seller disconnecting their Stripe account (`coverage.test.ts:114`), so such an account's row keeps `charges_enabled = true`.
