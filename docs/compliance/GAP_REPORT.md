# Compliance gap report

For: Adrian. Date: 2026-11-22. Status: consolidation of finished audits. Nothing was built or changed. This is not legal advice: every legal wording mentioned is a draft for lawyer review.

**Sources and labels used below**

- **Audit A**: Stripe configuration and money flow (`docs/compliance/audit/A-stripe-config-money-flow.md`).
- **Audit B**: moderation, incident handling and the DSA (EU Digital Services Act) (`B-moderation-dsa.md`).
- **Audit C**: seller terms and P2B (EU Regulation 2019/1150 on fairness for business users of platforms) (`C-seller-terms-p2b.md`).
- **Audit D**: DAC7 readiness (the EU directive making platforms report sellers' income to the tax authority) (`D-dac7-readiness.md`).
- **Audit F**: refunds and application fees (`F-refunds-application-fees.md`).
- **Inv 06 / 07 / 08**: inventories of the Admin repo, the App repo (marketplace) and public messaging (`docs/compliance/inventory/`).
- **Prod**: read-only production queries run by the orchestrator on 2026-11-22.
- "B R2" means Audit B, row R2; "A §7" means Audit A, section 7. File paths carry a repo prefix (`Store:`, `Admin:`, `Home:`, `Docs:`, `App:`).
- **Application fee**: Square Share's per-sale cut, which Stripe splits off the buyer's payment. **Direct charge**: the buyer pays on the seller's own Stripe account. **Express / Standard**: Stripe's kinds of connected (seller) account; the locked decision allows only Standard or the equivalent "full Dashboard" setup. **AUP**: the Acceptable Use Policy, the prohibited-items list inside the Terms. **tos-2026-10-11**: the Terms version in force for existing sellers. **tos-2026-11-06**: the newest published version, not in force.

**What is real today (Prod).** Stripe Connect is off: 0 connected accounts, 0 fee-ledger rows, 0 paid plans, every billing switch off. None of the 1,239 orders has a payment reference: all are seeded or simulator data, and no real payment has ever been taken. The demo sales simulator is enabled in production and inserts EUR orders with EU addresses every 20 minutes. 15 profiles: country CZ x2, IE x1, unset x12. Four accounts have a product, storefront or order; they look internal or test. 22 products, all EUR, 16 live. Terms agreement on profiles: none x11, tos-2026-10-11 x2, tos-2026-11-06 x2; the `terms_versions` table holds one row (tos-2026-10-11). The shopping cart tables are not in production.

**Where the reports disagreed, and how it was settled**

- *Publishing vs `charges_enabled`*: A says Missing, B says Partial. The publish gate (`Store:src/lib/settings/seller-identity.ts:304-313`) checks trader identity only, so it is reported as Missing; checkout gating on `charges_enabled` is a separate control that exists.
- *Statement of reasons on content restrictions*: C says Exists, B says Partial. `Store:src/lib/moderation/auto/check.ts:221-250` shows an automated pause sends an in-app notification only, and `Admin:src/lib/email/mailer.ts:57` sends staff emails only when the Brevo secrets are set. Reported as Partial.
- *Who carries an Express seller's losses*: A states it from quoted Stripe docs (platform liable); F could not find a sentence naming legacy Express and marked it inferred. A's reading is kept, with F's caveat: confirm on a test account (section 7).
- *Whether a ban stops checkout*: Inv 06 inferred it does not; B traced the buy path; a grep of `Store:src` confirms the only reader of `banned_until` is the MCP authenticator (`Store:src/lib/agent/authenticate.ts:54`). Reported as fact.
- *Admin revenue "live only" filter*: F's side finding is confirmed: `Admin:supabase/migrations/0008_plans_revenue.sql:53` matches `cs_live_`, while Store mints `cs_ss_` ids (`Store:src/lib/checkout/stripe-provider.ts:53`).
- Prod answers several "could not determine" items: the connected-account count (A §0), fee switches and ledger (D, F), the Terms rows (B, C), the cart migration (D, F), and whether tos-2026-11-06 can still be replaced (Inv 08 §7.1: it cannot, two profiles agreed to it).

---

## 0. Czech-only beta

Sources: the nine inventory reports merged into `WRITE_PATH_INVENTORY.md`,
Audit E (`audit/E-czech-only-gap-analysis.md`), and read-only production
queries. The build plan is in `PLAN.md`.

### 0.1 The write-path inventory

`WRITE_PATH_INVENTORY.md` lists 127 write paths with stable ids, 94 of them
relevant to the rules, each with its entry points (dashboard, MCP tool, API
route, webhook, scheduled job, direct database write), who can reach it, the
validation it has today, and where enforcement attaches. It was reconciled
against every MCP write tool (36), every route handler that writes, every
server action (100) and every scheduled job.

| Entity | Paths | Entity | Paths |
|---|---|---|---|
| Seller identity | 6 | Checkout and cart | 9 |
| Connected account | 5 | Order | 11 |
| Product and price | 14 | Refund | 4 |
| Import | 3 | Admin | 9 |
| Discount | 5 | Scheduled jobs | 11 |
| Shipping policy | 3 | Direct database writes | 8 |
| Storefront config | 6 | No rule relevance | 33 |

### 0.2 Which rules are enforced, and where

**None, anywhere.** Across the 94 relevant paths, no cell for R1 to R6 reads
"enforced today" (the per-path matrix is section 3 of the inventory).

| Rule | Status | What exists today |
|---|---|---|
| R1 seller established in CZ | Missing | One optional field, `profiles.tax_country`, never checked by any gate. The business address is free text. Stripe's account country is sent only if the seller set one, and is never stored or re-checked |
| R2 CZK only | Conflicts | CZK cannot be stored: the code list and three database checks allow only EUR and USD. A helper turns any other value into EUR, which is what Stripe would charge |
| R3 delivery to CZ | Partial | One server check against a fixed list of 29 countries, then the seller's own shipping rows. A `"*"` row admits all 29. The database checks nothing |
| R4 billing country for digital | Missing | No billing address or card country is collected or stored |
| R5 collab | Partial | No collab checkout exists; every order has one seller. Nothing in the database stops an order line naming another seller's product |
| R6 server-side at checkout | Partial | There is one order pipeline, which is the good news: every buyer entry point (hosted pages, embed, buy link, cart) ends in it. It contains no rule checks |
| R7 public messaging | Conflicts | Every public text says "EU, USA and Canada" |
| R8 expansion waitlist | Missing | Sign-up asks no country and has no block. The waitlist table has no country column |

Supporting requirements: no config module (the country and currency lists are
typed out in several places, the EU list four times); no country rule in the
database; no monitoring.

### 0.3 Paths that skip every application check

Twelve paths never pass an application validator, so validators alone would
not close them. They are the first targets of the bypass hunt.

- **Direct database writes with the seller's own sign-in token.** A seller can
  set any two-letter country on their profile, set a product's currency and
  price, publish it, or switch it from physical to digital, without touching
  the dashboard. Discounts likewise. Table grants were never narrowed.
- **The demo sales simulator.** It is switched on in production and inserts
  orders directly: EUR, addressed to ten EU countries, every 20 minutes.
- **Admin restore.** Approving or restoring content, including an overturned
  appeal, relists it with no rule check.
- **The second storefront-config writer**, product duplication (copies the
  stored row as it is) and the publish toggle (writes the status only).

The moderation check already solves this problem for content: it is a database
trigger that no path can skip. The Czech-only guards copy that pattern.

### 0.4 Existing data (read-only queries, 2026-11-22)

| Fact | Value |
|---|---|
| Connected Stripe accounts | 0 |
| Real payments ever taken | 0 (none of the 1,239 orders has a payment reference) |
| Accounts that own a product, storefront or order | 4, all apparently internal or test |
| Profiles by country | CZ 2, IE 1, unset 12 |
| Products | 22, all EUR, 16 live |
| Amount discounts | 0 |

What each rule flags:

| Rule | Violations |
|---|---|
| R1 | One account with country IE (3 products, one of them digital). One account with no username, no country and no address (1 live product, 9 storefronts) |
| R2 | All 22 products, necessarily: CZK cannot be stored yet |
| R3 | One CZ account whose delivery destinations are free text ("EU", "USA"). 584 simulator orders addressed outside CZ |
| R4 | Not measurable: nothing is stored |
| R5 | 0 |

Nothing was changed. The four accounts are named in the report I give you
directly, not in this file.

**The rule that bites first is R1.** Nothing can be bought in production today
(Stripe Connect is off), so the checkout rules change nothing a buyer sees
until launch. The seller rule is different: the day it reaches the publishing
and visibility gate, the IE account's three listings disappear from buyer
pages. That is your decision to time (PLAN.md, section 5, item 4).

### 0.5 Things that would break if done naively

- Narrowing the existing country or currency lists blanks every stored
  shipping policy and shortens the withdrawal window on existing orders to 14
  days. The market rule therefore sits beside those lists.
- Allowing CZK in the database before the EUR-fallback helper is removed would
  charge CZK prices in euros. That helper is removed first (branch 01, being
  built now).
- A database rule that is re-checked on every update of an old row would roll
  back the five-minute expired-order sweep the first time it met an old EUR
  row. Guards fire only on insert or when the guarded value changes.
- An order guard shipped before the simulator is dealt with makes every
  simulator run fail.
- Analytics and Admin revenue count anything that is not USD as euros, so CZK
  sales would be added up and labelled with a euro sign.

### 0.6 How to open another EU country

Edit one config object, add one migration that updates its database mirror,
rewrite the listed sentences that name the territory, review, deploy. The
steps are in PLAN.md, section 8. Two limits on "config only": hand-written
copy has to change because Czech and Slovak decline country names, and each
new country needs its identifier validator from the seller onboarding work.

## 0b. Seller onboarding data (section 1B of the addendum)

Source: Audit G (`audit/G-seller-onboarding-data.md`), which measured every
field, declaration and rule in your specification against the code, and a
read-only production query. The design is being written
(`plan/P3a-seller-data-model-design.md`, `plan/P3b-seller-onboarding-app-design.md`).

### 0b.1 Where we stand

Of the 35 rows in the specification (seller fields, declarations,
system-captured items, product-level product-safety fields): **3 exist, 14 are
partial, 18 are missing.**

| Area | Today |
|---|---|
| Identity | One free-text "business name" stands in for the individual's legal name, the company's legal name and the trading name. No seller type, trader status, date or place of birth, or representative |
| Contact and addresses | The address is one free-text box with no country. The contact email is the strongest field: required, quality-checked and proven by an in-session code (demanded only when mail is on, and production mail is off). The phone is checked and SMS-proven but optional. No public contact separate from the primary one, no returns address |
| Tax and registration | The VAT ID is format-checked only. No tax IDs, no registration number, no VIES or ARES check anywhere |
| Payments | The Stripe account id is stored. No payout identifier |
| Declarations | Terms acceptance is one overwritten version and timestamp, with no IP and no history. The seller can write it directly through the database API, and it is not a condition for publishing. No self-certification, privacy acknowledgement, categories, website or product-safety role |
| Captured by the system | No verification log, sanctions screening, signup country or change history |
| Product safety | A real but optional block exists and is shown on the product page. It is not required for physical goods, not shown in the embed, and has no seller-level defaults |
| Security | One encryption helper exists, built for passkeys, with no key version or rotation. No column encryption. Staff reads of seller data are not logged |

### 0b.2 What can be reused

The single publish and sell rule (checked on 5 write paths and 7 read paths,
and it refuses when it cannot read the seller) is the place the completion
gate attaches. Also reusable: contact verification, the email quality checks,
phone normalisation, the Terms notice system, the setup checklist and guided
tour (their steps are defined as data), the needs-attention rows, the 2FA
step-up that already guards these saves, rate limiting, notifications, email,
scheduled jobs and the data export.

### 0b.3 What Stripe gives us, and what it does not

For Standard accounts created by our platform (the target once you approve
the account-type change), from Stripe's public documentation:

- **Readable:** country, business type, `charges_enabled` and the other status
  fields, and the individual's or company's name.
- **Not readable once onboarding has started:** date of birth, address, tax ID
  values, registration number. Stripe's guide says to prefill these before the
  first onboarding link, after which the platform cannot read or write them.
- **Payout identifier:** the documentation says the bank's last 4 digits and
  the holder name are returned to the platform for these accounts. This
  corrects Audit D, which left it open. It still needs a test-mode check.

So the universal form comes before Stripe onboarding and prefills it, and we
collect everything DAC7 needs beyond the list above ourselves.

### 0b.4 Constraints the design has to live with

- **VIES consultation numbers.** VIES issues one only when the requester
  supplies its own VAT number. Efficontrol is not VAT-registered, so today a
  check yields a date and a result, not a consultation number. The design
  stores the number automatically once a VAT identification exists. Whether
  the date and result are enough meanwhile is a question for the tax adviser.
- **ARES** has a free interface, blocks callers above about 500 queries a
  minute, and labels its data "informative only".
- **The EU sanctions list** is a file of about 25 MB that changes several
  times a month, and downloads need a registration token. Likely matches need
  a person to decide.
- **Retention cuts both ways.** Account deletion removes everything after 14
  days plus holds. Your specification needs the DAC7 fields kept for 10 years
  and the fields held only for the DSA deleted 6 months after the relationship
  ends. Both differ from today.
- **`charges_enabled` in the gate.** Required for publishing as written, it
  takes all 16 live listings offline, because Stripe Connect is off. The
  design splits it into a publishing check and a checkout check so you can
  choose, and the development test payment provider counts as ready.

### 0b.5 Existing sellers (read-only query, 2026-11-22)

Four accounts own a product, a storefront or an order. Of the fields that can
be captured today:

| Field | Accounts that have it (of 4) |
|---|---|
| Trader name, address, contact email, country, phone | 3 |
| Contact email proven | 0 |
| Phone proven | 0 |
| VAT ID | 2 |
| Terms accepted (any version) | 1 |
| Shipping policy and returns information | 2 |
| Stripe account | 0 |
| Live physical products with no product-safety block | 2 accounts (3 products) |

One account has none of the fields at all. Nothing in the new specification
(seller type, tax IDs, date of birth and so on) can be reported yet because
nothing stores it. Nobody is deleted or disabled: existing sellers get a
"complete your profile" flow with a deadline you set.

### 0b.6 Decisions for you (Audit G, section 10.2)

1. `ALLOW_PRIVATE_SELLERS`: may private persons sell, in the beta and later?
2. `charges_enabled`: a condition for publishing, or for checkout only? Do
   listings sold through the seller's own link stay publishable without Stripe?
3. Collect the DAC7 identity ourselves, ask Stripe for Platform Tax Reporting
   access, or both? And prefill Stripe from our form?
4. Email proof by in-session code (what exists) or by a link (what the
   specification says)?
5. A required phone means SMS switched on in production (cost, regions).
6. The deadline for existing sellers, and whether their listings stay live
   during it.
7. The category list, and how high-risk categories are handled.
8. Sanctions: ingest the official file ourselves or use a vendor; who reviews
   likely matches; how often to re-screen.
9. Encryption key custody and rotation, and which staff may reveal sealed
   fields.
10. Overdue re-verification: warn or block?
11. If VIES or ARES is down, may a seller publish pending the check?
12. Which markets switch on which threshold counters.

The designs carry a recommended default for each so the build is not blocked.
Lawyer and tax-adviser questions are in Audit G, sections 10.3 and 10.4. One
of them matters for scope: the DSA appears to exempt micro and small
enterprises from Articles 30 to 32, which is where "know your business
customer" sits. Your specification covers it regardless; the lawyer should
confirm what remains mandatory for Efficontrol.

---

## 1. In one page

1. **Seller accounts would be Express, which makes Efficontrol liable for sellers' losses.** The only account-creation call sends `type: "express"` and no fixed country (`Store:src/lib/payments/connect/account.ts:153-164`, A §0), and Stripe fixes both at creation; with 0 accounts in production it is still a pure code change. *Needs Adrian's approval (account type) and a lawyer (whether the replacement setup counts as "Standard" under Stripe's Connect agreement).*
2. **Every refund gives Square Share's fee back, the opposite of the policy, and staff cannot refund a fee for the three exceptions.** The single Stripe refund call hard-codes `refund_application_fee: true` (`Store:src/lib/orders/actions.ts:482`, F §0), Docs promise "A refund returns it", and lost disputes are never recorded. *Needs Adrian's approval (money flow) and a lawyer (the change is worse for sellers, so a new Terms version comes first, C R-1).*
3. **Staff cannot stop a seller taking payments, and the moderation record can be erased.** There is no per-seller freeze, a ban leaves listings and checkout live, a Stripe payment page opened before a takedown stays payable for 31 minutes, and decisions are deletable and cascade-deleted with the seller's account, with nowhere to record that Stripe was informed (B R2, L1, A2; A §7). *Needs Adrian's approval (new tables, a foreign-key change on a table with data, freeze scope).*
4. **Existing sellers are on an unfinished template, the replacement cannot take effect, and agreement is not required to sell.** tos-2026-10-11 still has an operator placeholder, "[fee %]", no moderation section and a change clause allowing 14 days' or same-day changes; tos-2026-11-06 (EU, USA, Canada; not lawyer-reviewed) waits for a notice that cannot start while production mail is off, 11 of 15 profiles have agreed to nothing, and bans send no statement of reasons (C §0, P2B-3b, P2B-4b, X-2; Prod). *Needs a lawyer (Czech-beta Terms) and Adrian (mail switch, publish gate).*
5. **DSA notice-and-action has holes that apply now.** Reporters get no receipt or decision notice although the form promises a confirmation, there is no process for threats to life (Art. 18), automated pauses are never emailed, and the contact point exists only in the Terms that are not in force (B S1 to S6, R3). *Several parts can be fixed now; Adrian picks the mailbox and the mail switch; a lawyer names the Art. 18 authority.*
6. **DAC7: almost none of the required seller data exists, and deleting an account destroys what does.** No tax ID, date of birth or individual/entity flag; deletion cascades profile, orders and Stripe link against a 10-year retention duty; the privacy notice promises trader details are never shared; Stripe's tax-reporting tool is a private preview that does not compute money totals (D summary, §4 to §6). *Needs the accountant first (scope and definitions), then Adrian (schema); nothing is reportable yet.*

---

## 2. Answers to your six questions

### 2.1 Connected account configuration, and does Efficontrol carry seller-loss liability?

**Legacy Express, and yes, as coded.** Accounts v1, `type: "express"`, no controller properties, `Stripe-Version: 2025-08-27.basil`, capabilities `card_payments` and `transfers`, country sent only if the seller set one (A §0, §1, `account.ts:153-164`). In Stripe's terms that is `losses.payments=application`, `fees.payer=application_express`, `requirement_collection=stripe`, `stripe_dashboard.type=express` (A §1). Audit A quotes Stripe's account-types table ("Platform" for fraud and dispute liability on Express); Audit F marks the same point inferred. The code also issues Express Dashboard login links (`account.ts:208-214`), which Stripe refuses for other account types (A §2). Stripe advises against direct charges with the `application_express` fee setting (F §5). The Terms say negative balances are "settled between the Seller and Stripe" (`Home:src/content/legal/terms/tos-2026-11-06.ts:427`), which is only true for Standard or full-Dashboard accounts (A §9). Exposure today: none (0 connected accounts, Connect off, Prod). Proposed change: A §13, decision 1.

### 2.2 Which moderation, DSA and P2B items exist, partially exist or are missing?

Audit B counted 27 rows: 4 exist, 14 partial, 9 missing. Audit C counted 36: 11 exist, 11 partial, 4 missing, 10 contradict. Merged (details in sections 3.3 to 3.5):

- **Exist**: a database check on every listing create and edit, including MCP writes (B D1); a "Report" link on product pages, storefronts, checkout and the embed (B D5); one-action unpublish in Admin (B R1); statement-of-reasons PDF and in-app appeals for staff decisions on products and storefronts (B R3); seller named, Square Share stated as not a party (B X1, C C-3); the Terms-change notice machinery with 30 days after the last email (C P2B-3a); IP and exit clauses (C P2B-6, P2B-8).
- **Partial**: the banned-items list (not cross-checked with Stripe's list, narrower than what the classifier enforces: B P1, C P2B-2); statements of reasons (nothing on a ban, no email on automated pauses: B R3, C P2B-4a); the decision log (not append-only: B L1); the 24-hour target (B O1); DSA contact points and moderation rules (only in tos-2026-11-06: B S1 to S3); Art. 16 reports (no receipt or decision notice: B S4); dispute signals (B D3); Art. 24(3) user numbers (B S7).
- **Missing**: seller freeze (B R2), a way to inform Stripe (B A2), Art. 18 process (B S6), new-seller hold and categories (B D2, P2), refund-rate signals (B D4), monthly summary (B O2), disconnect (B R4), staff fee refund (B R5, F G5), ban statement (C P2B-4b), Terms agreement before publishing (C X-2), Stripe §3.5 seller section (C S-2).
- **Conflict**: the in-force change clause (14 days, same-day changes: C P2B-3b), no notice before fee rises (C P2B-3c), immediate permanent bans (C P2B-5), "no seller gets better treatment" against plan grants and fee waivers (C P2B-11), decisions cascade-deleted with the account (B L1).

### 2.3 Is seller country or establishment captured and enforced?

**Captured optionally; enforced nowhere.** `profiles.tax_country` is optional, picked from 29 countries (EU 27 plus US and CA) with "Not set" allowed (A §1, D §1.2). Sign-up and the welcome flow ask no country, the publish gate ignores it, Stripe onboarding passes it only when set, the Stripe account's country is not stored or re-checked, and checkout delivers to 29 countries plus "Everywhere else" (A §1 to §3, §7; Inv 08 §1b, §3). Every territorial statement says EU, USA and Canada (Inv 08 headline 1). Production: CZ x2, IE x1, unset x12; one account with content has country IE (Prod).

**Czech-only beta detail: see section 0, added by the orchestrator.**

### 2.4 Is DAC7 data capture feasible: Stripe Platform Tax Reporting or our own?

**Feasible, but not with Stripe alone and not with today's data.** We hold one free-text trader name, a free-text address, an optional VAT ID and an optional country; no individual/entity flag, tax ID, date or place of birth, or company registration number (IČO) (D §1.2). Quarterly totals per seller and currency can be derived, with gaps: no paid-at time, refunds made in Stripe's dashboard and lost chargebacks are not recorded, orders carry no live/test flag (D §2). The bank account is held only by Stripe, by design (D §3). Deletion cascades everything but anonymised fee rows (D §4).

Stripe Platform Tax Reporting (D §6): private preview; EU files only in the Netherlands XML schema, Czech acceptance unconfirmed; whether it applies to full-Dashboard accounts is unconfirmed (low confidence); "Stripe won't automatically provide monetary amounts"; no verification of Czech IDs. **Recommendation (D §6.3):** ask Stripe for preview access and three answers (access, applies to our account setup, Czech format); build our own totals and retention now, since both are needed either way; build our own identity capture (D §7) only if Stripe cannot confirm. Nothing is reportable yet (Prod). The accountant's first answer is from when, and for which surfaces, Efficontrol is a reporting platform (D §8.2 Q1).

### 2.5 The refund flow: what `refund_application_fee` does today and the gap to the policy

Every seller refund (whole order, one line, "what is left", and the MCP `refund_order` tool) goes through one Stripe call with `refund_application_fee: true` (F §1, `Store:src/lib/orders/actions.ts:476-489`), so the fee goes back in full or in proportion. Dev-only orders also reverse the fee in our ledger (`:389-394`, `:441`). A refund made in Stripe's own dashboard keeps the fee by Stripe's default (inferred, F §7.5), so the outcome depends on which button the seller pressed; our webhook comment says the opposite. Admin has no refund or fee code (F §1.11). Only dispute *creation* is handled; outcomes are never recorded (F §5). The order panel shows "Refunded" with the whole amount, and the code comment says "our fee included" (F §4.2). Docs say "A refund returns it" (en and cs); the Terms point to a Dashboard fee policy that does not exist (F §8).

**Gap:** the default conflicts; none of the three exceptions has a mechanism; the kept fee is shown nowhere. The fee ledger already records a kept fee correctly, because no negative row is written when Stripe returns nothing (F §3.5). Exposure: 0 accounts, 0 fee rows (Prod). The line-refund path depends on the cart migration, which is not in production, so it would fail before money moves (F §1.3, Prod). Fixes: section 3.2; edge cases: decision 4.

### 2.6 Anything that touches buyer funds outside direct charges?

**No.** Buyer money is touched by two calls only: the Checkout Session created on the seller's account (a direct charge) and the refund on that same account (A §5; `Store:src/lib/checkout/stripe-provider.ts:122`, `Store:src/lib/orders/actions.ts:476`). No transfers, payouts, top-ups or destination charges exist in any repo; the only sales money reaching the platform is the application fee Stripe splits off (A §5). Admin, App, Home and Docs make no Stripe calls (A §5, Inv 06 §3a, Inv 07 §3). Seller plans are billed on the platform account as platform revenue (A §6). Caveats: the Express type makes seller negative balances Efficontrol's (2.1); two code comments still permit destination charges with `on_behalf_of` (A §4); collab checkout is not built (A gap 24).

---

## 3. Gap tables

Status: **Exists**, **Partial**, **Missing**, **Conflicts** (the code or text does the opposite of a locked decision or of the owner's checklist). Size: **S** under a day, **M** a few days, **L** a week or more. "Adrian" in Needs means your approval, with the reason.

### 3.1 Stripe configuration and money flow

| # | Requirement | Status | Evidence | Proposed fix | Size | Needs |
|---|---|---|---|---|---|---|
| 1 | Accounts are Standard or full Dashboard; Stripe carries negative balances; seller pays Stripe's fees | Conflicts | A §0, gap 1; B production table; D §1.4; F G17. `Store:src/lib/payments/connect/account.ts:157` `type: "express"` | Create with controller properties (losses `stripe`, fees `account`, dashboard `full`) or legacy `type: "standard"`; refuse to record an account Stripe did not create as asked; new idempotency key (A §13) | S | Adrian: account type. Lawyer: contract mapping |
| 2 | No Express Dashboard | Conflicts | A §2, gap 2; `account.ts:208-214` login links, used by `PayoutMethodCard.tsx:22`, `OrderActions.tsx:80` | Plain link to the Stripe Dashboard instead of a login-link call | S | Adrian (with 1) |
| 3 | Country fixed when the account is created | Missing | A §1, gap 5; `account.ts:158` optional; 29 countries in `Store:src/lib/validation/settings.ts:131-136` | Named constant country; refuse onboarding otherwise (section 0) | S | Adrian: account configuration |
| 4 | Account facts re-checked on every `account.updated` (country, requirements, controller) | Partial | A §2, §3, gaps 6, 7, 14; `webhook.ts:165-175` writes three booleans; `overview.ts:77` hard-codes `requirementsDue: []` | New columns; `canTakePayments` checks country and controller; show requirements to sellers | M | Adrian: schema (table empty, Prod) |
| 5 | Seller disconnecting the platform handled | Missing | A gap 10; B D3; `webhook.ts:42-48` | Record `disconnected_at`, stop checkout, alert ops, keep the row for old refunds and disputes | S | Adrian: schema |
| 6 | `capability.updated` handled | Missing (low) | A gap 15 | Treat as a refresh trigger | S | Nothing |
| 7 | Seller cannot publish until `charges_enabled` | Missing (checkout is gated, publishing is not) | A §7, gap 8; B P3; `seller-identity.ts:304-313` | Payments clause behind the Connect launch switch (A), or only for products without an own link (B) | S | Adrian: changes who can sell |
| 8 | Direct charges with `application_fee_amount` only | Exists | A §4, gap 19; `stripe-provider.ts:122-168`; fee capped at 30% (`Store:src/lib/pricing/fees.ts:29`) | Keep; CI check failing on `transfer_data`, `on_behalf_of`, `/transfers`, `transfer_group`, `source_transaction` | S | Nothing |
| 9 | Code and runbooks describe the locked model | Conflicts | A §1, §4, gap 3; `Store:wrangler.jsonc:163-167` ("Express accounts"); `account.ts:11-15`; `ProductCta.tsx:33-37` and `Store:src/lib/payments/types.ts:11-14` permit destination charges | "Direct charges on full-Dashboard accounts only; destination charges and transfers forbidden" | S | Nothing (comments); the Express runbook after decision 1 |
| 10 | Terms: negative balances settled between seller and Stripe | Conflicts (with Express) | A §9, gap 4; F §5; `tos-2026-11-06.ts:427` | Becomes true once row 1 lands | S | Adrian (via 1) |
| 11 | Restricted key with complete permissions; live secret key refused | Partial | A §8, gap 16; F §7.7, G15; `wrangler.jsonc:171-176` lacks Application Fees read and PaymentIntents read; `stripe-api.ts:41` accepts `sk_live_` | Complete the runbook (later `application_fee_write`); refuse `sk_live_` in production | S | Nothing (ops); keys are Adrian's to create |
| 12 | Separate keys for plans and Connect | Partial | A gap 17; `Store:src/lib/payments/connect/config.ts:12-16` | Two restricted keys | S | Nothing (ops) |
| 13 | Stripe code cannot reach the browser | Exists (no guard) | A §8, gap 18 | `import "server-only"` in `stripe-api.ts` and connect modules | S | Nothing |
| 14 | Seller visibly the seller at checkout and in the embed | Exists | A §9, gap 21; B X1; C BR-1; `CheckoutView.tsx:186-189`; `EmbedFrameView.tsx:95` | Verify Stripe page branding in test mode | S | Nothing |
| 15 | Seller's name on card statement and receipts | Partial | C BR-2; no `statement_descriptor` written; sender "{store} via Square Share" (`Store:messages/en/orders.json:237`) | Show the descriptor on Payments; trader name in the From line | S | Nothing |
| 16 | Platform revenue separate from buyer funds | Exists | A §6, gap 23 | None | - | Nothing |
| 17 | Collab checkout: cloned PaymentMethod, one direct charge per seller | Missing (not built; nothing conflicting) | A gap 24; D gap 28 | Build as specified when it is built | L | Adrian (when built) |
| 18 | Verified against real Stripe test mode | Missing | A §10, gap 25; the stand-in ignores every account parameter (`Store:tests/e2e/stripe-mock.ts:19-24`, `:258-268`) | One test-mode run with a restricted test key after rows 1, 3, 4 | M | Adrian: test keys, Dashboard setup |
| 19 | No personal data in logs | Partial | A §8; `Store:src/lib/payments/connect/actions.ts:70`, `:95` log Stripe's message, which can echo an email | Log codes only | S | Nothing |

### 3.2 Refunds and the application fee

| # | Requirement | Status | Evidence | Proposed fix | Size | Needs |
|---|---|---|---|---|---|---|
| 1 | Keep the fee by default on every seller refund | Conflicts | F §0, §2, G1; C R-1; A §4; `actions.ts:482`; dev reversals `:389-394`, `:441` | `refund_application_fee: false`; key prefix `refund_keep_`; drop dev reversals; ship with rows 2 and 3 | S | Adrian: money flow. Lawyer: Terms first |
| 2 | Kept fee shown on the refund line | Conflicts | F §4.2, G2; C R-3; `OrderDetail.tsx:195-198`, `:468-471` | Fee from the ledger; "Platform fee, not refunded" when the fee is above 0; 10 locales | M | Adrian (with 1) |
| 3 | Refund form warns before the seller presses | Missing | F §4.1, G3; `OrderRefund.tsx:171-177` | One sentence when the fee is above 0 | S | Adrian (with 1) |
| 4 | Ledger shows a kept fee | Partial (implicit) | F §3.5, G4; `fees.ts:109` | No schema change; optional view `order_fee_standing` | S | Nothing |
| 5 | Staff refund the fee on an illegal or fraudulent sale that was removed | Missing | F §1.11, G5; B R5; Inv 06 §4 | Staff action calling `POST /v1/application_fees/{id}/refunds` on the platform key; reason code; required moderation decision; ledger and audit rows; `fee_refund_decisions` table (F step 3) | M | Adrian: money flow, key location |
| 6 | Staff refund the fee when Square Share is at fault | Missing | F G6 | Same action, reason "platform fault" | S | Adrian: who decides, cap |
| 7 | Staff refund the fee on a dispute lost because of Square Share; outcome recorded | Missing | F §5, G7; A §3; D §2.3; no `charge.dispute.closed` | Handle dispute close (won returns to paid, lost stays out of sales); same staff action | M | Adrian: money flow, what qualifies |
| 8 | Disputes recorded per seller | Missing | F G8; B D3; A gap 12 | `order_disputes` table written by the webhook | S | Adrian: schema |
| 9 | Rule stated in the seller Terms | Partial | F §8, G9; C R-1; `tos-2026-11-06.ts:426` defers to a Dashboard policy that does not exist | New Terms version naming the rule and exceptions | M | Lawyer; Adrian |
| 10 | Rule on Home pricing and /plans | Missing | F G10, G11; C R-2; `Home:src/components/PricingSection.tsx:91-93`; `Store:messages/en/billing.json:138-141` | One sentence on Home; a /plans FAQ item (becomes the "policy shown in your Dashboard") | S | Adrian (after 9) |
| 11 | Docs agree | Conflicts | F G12; C R-2; `Docs:content/docs/en/pricing/index.mdx:80`, `cs/ceny/index.mdx:81`; refunds page stale on line refunds | Rewrite en and cs | S | After row 1 (Docs match today's code) |
| 12 | Seller figures reflect kept fees (CSV, analytics, Payments hint, Admin revenue) | Partial | F §3.6, G13 | Two CSV columns; hint; Admin revenue from the ledger; analytics only if wanted | M | Adrian: kept fee as a cost? |
| 13 | Test stand-in models dashboard refunds as Stripe does | Conflicts (tests) | F §7.5, G14; `stripe-mock.ts:526` | Default `withFee` to false | S | Adrian (with 1; F groups it with money flow) |
| 14 | Platform key can refund fees | Missing (config) | F §7.7, G15 | Document `application_fee_read` and `_write` | S | Nothing (ops) |
| 15 | No double refund on a retry after 24 h; panel and webhook agree | Partial (existing bugs) | F §7.3, §7.4, G16; `actions.ts:366-369`, `:275-278`; webhook ignores the result on a disputed order (`webhook.ts:243-249`) | "Refund requested" row before the Stripe call, or look up an existing refund; read the webhook result | M | Adrian (F marks every refund change money flow) |

### 3.3 Moderation and incident system

| # | Stage | Requirement | Status | Evidence | Proposed fix | Size | Needs |
|---|---|---|---|---|---|---|---|
| 1 | Prevent | Banned-items list mirroring Stripe's restricted list and EU/CZ law | Partial | B P1; C B-1, P2B-2; AUP `tos-2026-11-06.ts:457-500`; classifier enforces items the AUP omits (`Store:src/lib/moderation/auto/policy.ts:98`, `:105`) | One list in a new Terms version; classifier restates it | M | Lawyer; Adrian |
| 2 | Prevent | Terms agreement on file before publishing | Missing | B P1(b); C X-2, §5; gate `seller-identity.ts:304-313`; MCP path has no check; Prod: 11 of 15 have none | "Current Terms agreed" in the publish gate | S | Adrian: changes who can publish |
| 3 | Prevent | Category at onboarding; high-risk blocked or reviewed | Missing | B P2 | Required "What do you sell?", `profiles.seller_category`, high-risk list | M | Adrian: schema, list |
| 4 | Prevent | New-seller hold (person reviews first listings or first week) | Missing | B D2 | Settle new sellers' clean rows to `review` | M | Adrian: N, period, capacity |
| 5 | Detect | Check on listing create and edit | Exists | B D1; trigger in `Store:supabase/migrations/20261012_auto_moderation.sql:332-423` | Hardening: trusted writes reset `moderation_checked_at`; `isContentVisible(undefined)` fails closed (`Store:src/lib/moderation/removal.ts:85-93`) | S | Nothing |
| 6 | Detect | Early fraud warnings and disputes feed a per-seller signal and alert ops | Partial | B D3; A gaps 11, 12; `webhook.ts:42-48`, `:252-277` | Add `radar.early_fraud_warning.created`; `alertOps` and an event row; counts on Admin's seller card | M | Adrian: schema (via row 14) |
| 7 | Detect | Refund-rate and price-anomaly signals | Missing | B D4; price not moderated (`20261012_auto_moderation.sql:162-164`) | Per-seller rate view; optionally let the classifier see price | M | Adrian: thresholds; price edits become content changes |
| 8 | Detect | "Report" on every storefront and embed | Exists | B D5; `PoweredByFooter.tsx:121-127`; `EmbedFrameView.tsx:115-123` | Report link in the legacy embed JSON only if something consumes it | S | Nothing |
| 9 | Respond | One action to unpublish a listing | Exists | B R1; Inv 06 §4; `Admin:src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:204-378` | Bulk removal as part of the freeze | S | Nothing |
| 10 | Respond | One action to freeze a seller (stop new checkouts) | Missing | B R2; A §7, gap 13; C §3; Inv 06 #5; `authenticate.ts:54` only reader of bans | Service-role `seller_restrictions` (or `payments_frozen_at`) read by the purchase gate, the Stripe provider and the storefront builder; Admin action; seller notice | M | Adrian: schema; does a freeze hide listings? |
| 11 | Respond | Takedown or freeze closes payment pages already open | Missing | B effect table; A §7; 31 minutes (`stripe-provider.ts:58`, `:165`); webhook does not re-check moderation (`webhook.ts:177-214`) | Expire the seller's open Checkout Sessions | S | Adrian (with 10) |
| 12 | Respond | Statement of reasons on every restriction | Partial | B R3, S5; C P2B-4a, P2B-4b; Inv 06 #6. Ban: nothing (`Admin:src/app/(app)/users/[id]/actions.ts:56-142`); automated pause: in-app only (`check.ts:221-250`); staff email only with Brevo secrets (`mailer.ts:57`); review hold: none; Admin notices English only | Ban notice; email for automated pauses; Czech Admin notices; confirm secrets | M | Lawyer: ban and Czech wording. Adrian: review holds |
| 13 | Respond | Disconnect a seller in serious cases | Missing | B R4; Inv 06 §4 | After the freeze, a staff route once Stripe confirms the mechanics | M | Adrian; Stripe |
| 14 | Record | Append-only log per decision, including when Stripe was informed | Partial | B L1; Inv 06 #7; decisions "immutable" by comment only (`Store:supabase/migrations/20260926_moderation_decisions_and_appeals.sql:84-85`, `:183`); Admin deletes a decision on failure (`actions.ts:327-330`); audit failures swallowed; no snapshot; bans keep no history | `moderation_events` with a trigger refusing UPDATE and DELETE for every role | M | Adrian: schema, retention period |
| 15 | Record | Decisions survive the seller deleting their account | Conflicts | Part of B L1 (rated Partial overall); `on delete cascade` (`20260926...sql:46`, `:137`, `:142`) | FK `on delete set null`; no-update trigger; status instead of delete | S | Adrian: table with data |
| 16 | Record | Inform Stripe of harmful sellers, and record it | Missing | B A2 | Runbook; `stripe_informed_at` and reference on row 14; Admin button | S | Adrian: which grounds, channel |
| 17 | Record | Notices by email or phone enter the queue | Missing | B L1(6), S4(5); invited by `tos-2026-11-06.ts:527` | Admin "log a notice" form into `reports` | S | Nothing |
| 18 | Own | Report to removal within 24 h | Partial | B O1; no age, overdue marker or measurement | Age and overdue badge (24 h; 12 h for illegal, sexual, violence); re-alert | S | Adrian: targets, weekend cover |
| 19 | Own | Monthly summary for the director | Missing | B O2; Inv 06 §4 | `admin_monthly_summary(month)` and a page with CSV | M | Adrian: emailed or pulled |

### 3.4 DSA

| # | Requirement | Status | Evidence | Proposed fix | Size | Needs |
|---|---|---|---|---|---|---|
| 1 | Art. 11 and 12: public contact point for authorities and users | Partial | B S1, S2; C D-2; Inv 08 §6; only in `tos-2026-11-06.ts:837-847`; office@ (Home) vs support@ (`Store:src/lib/site.ts:17`, `Admin:src/lib/moderation/content.ts:322`) | "Contact points" page on Home (a notice, not a Terms version); one mailbox or a stated split | S | Adrian: mailbox |
| 2 | Art. 14: moderation rules in the Terms in force | Partial | B S3; C D-1; absent from tos-2026-10-11 | Mail on so the notice runs; align list (3.3 row 1) | S | Adrian: mail (decision 9) |
| 3 | Art. 16: notice and action | Partial | B S4; `Store:src/app/api/report/route.ts:131-212`; receipt promised (`productPage.json:164`) but never sent; no decision notice; no good-faith statement or name; reports on hidden content dropped | Receipt email; decision notice from Admin; optional good-faith checkbox and name | M | Nothing for the emails (need mail on). Adrian and lawyer: checkbox |
| 4 | Art. 17: statement of reasons | Partial | See 3.3 row 12 | | | |
| 5 | Art. 18: threats to life or safety | Missing | B S6 | Runbook (what counts, who, which authority, record); Admin "Escalate" action | S | Adrian and lawyer: authority, threshold |
| 6 | Art. 24(3): user numbers on request | Partial | B S7; no monthly-active method; buyers not counted | Choose a method, then an Admin function | S | Adrian: method |
| 7 | Art. 6(3): seller named, Square Share not a party | Exists | B X1; C C-3; `PoweredByFooter.tsx:8-36`, `:137-147` | None | - | Nothing |
| 8 | Transparency reporting, EU database | Missing (deferred on purpose under the micro-enterprise exemption) | B §6 note; `SQ-system/docs/moderation.md:441-442` | None while the exemption applies | - | Lawyer: confirm |

### 3.5 P2B and seller terms

| # | Requirement | Status | Evidence | Proposed fix | Size | Needs |
|---|---|---|---|---|---|---|
| 1 | Plain, seller-specific Terms | Partial | C P2B-1; tos-2026-10-11 is a template (`:8`), operator placeholder (`:38`, `:653`), "[fee %]" (`:290`); 11-06 is one 1,124-line text with long US and Canada parts | Czech-beta version, EN and CS drafts | L | Lawyer; Adrian |
| 2 | Grounds for restriction published | Partial | C P2B-2; `policy.ts:98`, `:105` | One list (3.3 row 1) | M | Lawyer |
| 3 | In-force change clause gives 15 days for any change | Conflicts | C P2B-3b; `tos-2026-10-11.ts:587-588` | Never apply a change under it; superseded by a newer version | S | Adrian (mail) |
| 4 | Notice machinery for Terms changes | Exists (gaps) | C P2B-3a, §2.2; unconfirmed addresses skipped, bounced ones abandoned while the clock starts; email links the text; mail off | Record and report who was not reached | S | Lawyer: durable medium |
| 5 | Notice before a fee or price rise | Conflicts | C P2B-3c; `Store:supabase/migrations/20261011_pricing_config.sql:220` `default now()`; Terms promise notice (`tos-2026-11-06.ts:388`, `:403`) | Refuse rises effective within 30 days; notice email | S | Nothing (email needs mail on) |
| 6 | Statement of reasons on account suspension | Missing | C P2B-4b; B R3; Inv 06 #6 | Email and a signed-out page with ground, facts, duration, redress | S | Lawyer: contents |
| 7 | 30 days before termination; immediate only for Art. 4(4) exceptions | Conflicts | C P2B-5; `Admin:src/lib/moderation/ban-durations.ts:28-33`; staff delete `users/[id]/actions.ts:284-326`; 11-06 widens exceptions (`:727`) | "Terminate with notice"; immediate only with a recorded exception; matching Terms list | M | Lawyer; Adrian |
| 8 | Banned seller can still export data; banned seller's listings stop selling | Missing | C P2B-8, §3 | Export reachable when banned; listings via the freeze | S | Nothing (export); Adrian (listings, decision 6) |
| 9 | IP effect on seller content | Exists | C P2B-6 | Name Marketplace and promotion channels next version | S | Lawyer |
| 10 | Data access description (Art. 9) | Partial | C P2B-7; one sentence in 11-06 (`:832`) | Art. 9 paragraph | S | Lawyer |
| 11 | Differentiated treatment described (Art. 7) | Conflicts | C P2B-11; `tos-2026-11-06.ts:831` vs grants (`Store:src/lib/billing/grants.ts:19-27`), waivers, Docs early-access offer | Describe grants, waivers, offer | S | Lawyer; Adrian |
| 12 | Stripe Connect §3.5: what we do on the seller's account and with their data | Missing | C S-2; privacy flows "will be confirmed" (`Home:src/content/legal/privacy.ts:127`) | Platform Provider section | S | Lawyer |
| 13 | Ranking parameters before any ranker | Exists (not triggered) | C P2B-10; Inv 07 §7 | Terms first, then ranker | - | Lawyer (later) |
| 14 | Small-enterprise exemption wording | Exists (11-06 only) | C P2B-9 | Carried by next version | - | Lawyer: confirm |
| 15 | Agreement forms the contract, with evidence | Partial | C §2.3 to §2.5, §5; agreement at first Overview visit; sign-up links the 10-11 template, welcome records 11-06; date and version only; team members never asked | Lawyer decides; optionally record surface, locale, user agent | S | Lawyer |
| 16 | Seller and buyer legal texts in Czech | Partial | C CZ-2, CZ-3; Inv 08 §4; Terms, Privacy, Cookie Policy English only | Czech drafts; per-language route on Home | L | Lawyer |
| 17 | Buyers told whether the seller is a trader | Missing | C C-1 | Only if counsel says Square Share is an online marketplace | S | Lawyer first |
| 18 | Territory: Terms, sign-up, Docs say EU, USA, Canada | Conflicts (with the beta) | C CZ-1, VAT-1; Inv 08 §1 | See section 0 | | |

### 3.6 Fee disclosure and VAT wording

| # | Requirement | Status | Evidence | Proposed fix | Size | Needs |
|---|---|---|---|---|---|---|
| 1 | Tiers (Free 5%, Starter EUR 12 + 2%, Pro EUR 39 + 0.5%) the same everywhere | Exists | C F-1; `Store:src/lib/billing/pricing-seed.ts:41-57` | None | - | Nothing |
| 2 | Fees in the Terms in force | Conflicts | C S-1, F-1; 10-11 shows "[fee %]" and another base (`:290`) | Carried by a newer version | - | Adrian (mail) |
| 3 | Fee shown before connecting Stripe | Partial | A §9, gap 22; `Store:messages/en/payments.json:64-84` | One line: plan fee plus Stripe's own fee | S | Nothing |
| 4 | Stripe's processing fee stated as separate | Exists | C F-2 | None | - | Nothing |
| 5 | Public pricing on Home | Partial | C S-1; Inv 08 §2; hidden while `NEXT_PUBLIC_SELLER_SIGNUP_OPEN` is off, though Store sign-up is open | Publish with the switch | S | Adrian: switch |
| 6 | Marketplace and ad fees disclosed before use | Missing (not yet needed) | C S-1; F §8; `pricing-seed.ts:39`; `Store:src/lib/pricing/fees.ts:13-16` | Disclose before Marketplace | S | Lawyer (later) |
| 7 | VAT wording fits a non-VAT-registered operator | Conflicts | C F-3; Inv 08 §5; `billing.json:32`; `PricingSection.tsx:56`; reverse charge in Docs (`pricing/index.mdx:104`); `automatic_tax` on plan checkout (`Store:src/lib/billing/stripe-provider.ts:189-190`) | Copy and config after the accountant | S | Accountant |
| 8 | Eligibility keeps Square Share out of deemed-supplier VAT | Conflicts | C VAT-1; `tos-2026-11-06.ts:114` (US and Canada sellers), `:820`; no ship-from rule | EU (beta: CZ) establishment and dispatch rule in the Terms; seller country limited (section 0) | S | Lawyer; accountant |
| 9 | Docs early-access offer matches code | Missing (promised, not built) | Inv 08 §5 (Docs' own TODO); C P2B-11 | Build it or remove it | S | Adrian |

### 3.7 DAC7

| # | Requirement | Status | Evidence | Proposed fix | Size | Needs |
|---|---|---|---|---|---|---|
| 1 | Individual or entity flag | Missing | D §1.2, gap 1 | `seller_tax_profiles.seller_kind` (D §7) or Stripe tool | L (with 2, 3) | Adrian: schema; accountant |
| 2 | Names, date of birth, tax IDs with issuing country, place of birth, IČO | Missing | D gaps 2, 4 to 6, 9, 10; one free-text name | Structured fields; encrypted `seller_tax_ids` rows | L | Adrian: schema, encryption. Accountant: which IDs |
| 3 | Structured address and residence country | Partial | D gaps 3, 19 | In the tax profile | M | Adrian |
| 4 | VAT ID | Partial | D gap 7; format only, no VIES | Keep one source; VIES if needed | S | Accountant |
| 5 | Consideration per seller per quarter, net of fees | Partial | D §2, gap 11; SQL sketch D §2.8 reads `order_line_refunds`, absent in production (Prod) | Record every Stripe refund amount; dispute close; reconcile against Stripe | M | Adrian: schema. Accountant: definitions |
| 6 | Paid-at timestamp | Missing | D §2.2, gap 12 | `orders.paid_at`, old rows null | S | Adrian: table with 1,239 rows |
| 7 | Live or test on orders | Partial | D gap 16 | Optional `orders.livemode` | S | Adrian: schema |
| 8 | Number of sales; fees withheld | Exists (unit undefined; ledger empty, Prod) | D gaps 13, 14 | Accountant defines the unit | - | Accountant |
| 9 | Payout account identifier | Missing (by design) | D §3, gaps 17, 18 | Read from Stripe at report time | M | Accountant: account id or last4 enough? |
| 10 | 10-year retention | Conflicts | D §4, gap 24; deletion cascades profile, orders, lines, Stripe link; a Q1 seller can vanish before the 31 January report | Tax snapshot and profile kept before deletion; decide order rows with buyer data anonymised | M | Adrian: deletion and FK on tables with data. Accountant: scope |
| 11 | Stripe account id kept after deletion | Missing | D gap 25 | Copy into retained tables | S | Adrian |
| 12 | Two reminders, 60 days, then close or withhold | Missing | D gap 21; we hold no money | `seller_tax_requests` trail; Stripe payout disabling behind a switch | M | Adrian; accountant |
| 13 | Sellers told their data is collected and reported | Conflicts | D §5, gap 22; C DAC7-1; "That is all we do with them" (`privacy.ts:107`); "never sell or share them" (`Store:messages/en/settings.json:344`, every locale) | Privacy paragraph (D §5.2); fix both passages | S | Lawyer; accountant |
| 14 | XML report and seller copy | Missing | D gaps 26, 27 | Stripe tool if Czech-acceptable, or own exporter | L | Accountant; Stripe |
| 15 | Small-seller exclusion | Partial | D gap 20; no exchange rates | Annual screen and FX rule | S | Accountant |
| 16 | Registration (15 days), filing by 31 January | Missing (not engineering) | D gap 29 | | - | Accountant |

### 3.8 Other: operator naming, Admin, App

| # | Requirement | Status | Evidence | Proposed fix | Size | Needs |
|---|---|---|---|---|---|---|
| 1 | Operator named consistently (Efficontrol s.r.o.) | Partial | Inv 08 §6; Home correct (`Home:src/lib/site.ts:33-43`); Docs "Root Labs" (`what-is-square-share.mdx:73`, cs `:74`, `Docs/lib/llms.ts:82`); cookie banner "SquareShare" (`Home:src/components/ConsentRoot.tsx:35-37`); Store names nobody; App none, `support@allgrid.app` (Inv 07 §9.5) | Efficontrol in Docs and the banner; App before launch | S | Nothing |
| 2 | Waitlist consent matches the privacy notice | Partial | Inv 08 §3; privacy relies on consent (`privacy.ts:227-229`); form has no consent text; "What do you sell?" sent and discarded | Consent sentence and privacy link | S | Lawyer: wording |
| 3 | Staff restores cannot bypass market rules | Partial | Inv 06 #2, #4; `restoreContent` (`actions.ts:387-412`); no market-rules ground | See section 0 | | Adrian |
| 4 | Admin sees Stripe account status | Missing | Inv 06 §4 | Show `seller_payment_accounts` on the seller card | S | Nothing |
| 5 | Admin revenue counts Connect sales in every currency | Partial (bug) | F §3.6; Inv 06 #8; `0008_plans_revenue.sql:51`, `:53` vs `cs_ss_` ids | Live filter on `pi_` reference or ledger `livemode`; all currencies | S | Nothing |
| 6 | Audit page tells the truth about the log | Partial | Inv 06 §9; `Admin:src/app/(app)/audit/page.tsx:38` | Fix copy; make it true with 3.3 row 14 | S | Nothing |
| 7 | Admin guards and limits | Partial | Inv 06 §9; no limits or guards on unban, confirm email, reset; campaigns uncapped; limiter fails open | Add limits and guards | S | Nothing |
| 8 | App report flow complete before launch | Partial | Inv 07 §6; signed-in only, artifacts only, no email field, hover-only control; App not live (§1) | Report on every surface, email field, visible control | M | Nothing |
| 9 | App writes only what the caller owns | Partial | Inv 07 §4.2, §11; `App:worker/routes/artifacts.ts:179` (product link unchecked); `App:worker/routes/events.ts:108-149` (anonymous service-role writes, no limit) | Ownership check; rate limit | S | Nothing |

---

## 4. Decisions needed from Adrian

**Money flow first.**

1. **Connected-account type.** Options: (a) controller properties (`losses.payments: "stripe"`, `fees.payer: "account"`, `stripe_dashboard.type: "full"`, `requirement_collection: "stripe"`), which Stripe reports as `type: "standard"`; (b) legacy `type: "standard"` plus country; (c) keep Express (forbidden by the locked decision). *Recommendation (A §13):* (a), asserting Stripe's returned values before recording; (b) if the lawyer has any doubt that (a) counts as Standard under the Connect agreement (Stripe also says `losses.payments = stripe` requires "Managed Risk requirements"). Drop the `transfers` capability (whether Czechia needs it is unverified). *Waiting on it:* login links, disconnect handling, Terms clause 427, Stripe Dashboard platform settings ("Stripe handles pricing"), the test-mode run, whether Stripe's tax tool applies (D §6.2).
2. **Country at account creation.** Pin it as a named constant and refuse onboarding otherwise (A §11, gap 5). Must land before the first account. Detail in section 0.
3. **New columns on `seller_payment_accounts`** (country, requirements, controller values, `disconnected_at`, `payments_frozen_at`; A gaps 6, 10, 13). *Recommendation:* approve while the table is empty (0 rows, Prod). *Waiting:* re-checks, disconnect, freeze, requirements shown to sellers.
4. **The refund flag and its edge cases.** Switch seller refunds to `refund_application_fee: false`? *Recommendation (F change set):* yes, in three reviews: keep the fee by default, shipped together with the form warning and kept-fee line; then a staff fee-refund action with reasons. Decide first (F §9):
   a. Keep the whole fee on every seller refund, including a cancellation before shipping, a statutory withdrawal, partial and single-line refunds? (Stripe's default keeps all of it.)
   b. Keep the share of the fee charged on delivery?
   c. Illegal sale: refund the whole fee or only the share the buyer got back; must a moderation decision exist first?
   d. Our fault: who decides, on what evidence, any cap or second approver? A fee refund cannot return Stripe's own processing or dispute fees; that would be a separate transfer (F §9 Q4).
   e. Dispute lost because of us: what qualifies, who records it?
   f. Count a kept fee as a cost in seller analytics? Put order, line and reason in Stripe refund metadata?
   *Timing:* apply only once Terms carrying the rule are in force (C R-1). *Waiting:* all of section 3.2.
5. **Where staff Stripe access lives** (fee refunds, later disconnect). Options: a restricted key in the Admin Worker, or a staff-only endpoint in Store behind the shared staff secret. *Recommendation:* B R5 proposes the Store endpoint; F asks without recommending. Needs `application_fee_write`.
6. **Freeze scope.** Does a freeze only stop new payments, or also hide listings and the embed? Should freezes and takedowns expire Stripe pages already open? *Recommendation (B R2):* a service-role table read on every buy path, an Admin action, a seller notice, and expiry of open sessions. *Waiting:* banned sellers' listings (C §3), the monthly summary.

**Product decisions.**

7. **Publishing vs `charges_enabled`.** Options: keep publishing independent (own purchase link or enquiry email is a feature); require it behind the Connect launch switch (A §7); require it only for products without an own link (B P3). As literally stated, the rule would unpublish every listing today.
8. **Terms agreement as a publish condition.** *Recommendation (B P1, C X-2):* add it to the publish gate. 11 of 15 profiles have no agreement (Prod). Blocking new publishing only, or also hiding existing listings (read side)? The second disables existing sellers.
9. **Production mail and Terms sequencing.** Mail is off (A §8; C §0). Turning it on starts the 30-day notice for tos-2026-11-06 at the next daily run (C §2.1), lets reporter receipts and pause emails go once built, is a condition of the Stripe checkout gate (A §7), and makes email proof a publish condition (B S3). tos-2026-11-06 is the EU, USA and Canada text and is not lawyer-reviewed (C §0). Two profiles agreed to it (Prod), so the project's recipe no longer allows replacing it before its notice (`Store:docs/changing-the-terms.md:50-56`): a Czech-beta version would follow it with its own 30 days. *Recommendation (B S3, C P1 #7):* turn mail on before any notice, after closing the notice coverage gaps. Decide with the lawyer whether 11-06's notice should run as it stands.
10. **The Czech-beta Terms version.** Contents per C §8 P0 #1: the eligibility sentence, dispatch from CZ/EU, US and Canada parts parked, Art. 4(4) exceptions, the three-ground fee rule, a Stripe §3.5 section, one prohibited-items list, differentiated treatment, an Art. 9 paragraph, a DAC7 line; EN and CS drafts for the lawyer. *Waiting:* refund change, Art. 14 rules in force, contact point in force.
11. **Suspension and termination.** C P0 #3: a statement on every ban, a 30-day "terminate with notice" action, immediate termination only with a recorded P2B exception, export for banned sellers, and what happens to their live listings (ties to 6).
12. **Category at onboarding and a new-seller hold.** Which categories are blocked or reviewed (B P2); how many listings or days, and who reviews (B D2).
13. **Contact mailbox.** office@ or support@, or a stated split, on a Home contact page (B S1, C D-2).
14. **Moderation operating rules** (B): (a) which grounds oblige telling Stripe, channel and person (A2); (b) decision-log retention, matched in the privacy policy (L1); (c) removal targets and weekend cover (O1); (d) monthly summary emailed or pulled (O2); (e) risk thresholds, and whether price becomes a moderated field (D4); (f) statement for review holds (R3); (g) good-faith checkbox and name on the report form (S4); (h) Art. 24(3) counting method (S7); (i) Art. 18 authority and threshold, with the lawyer (S6).
15. **DAC7 path.** *Recommendation (D §6.3):* request Stripe's preview and ask the three questions; build totals and retention now; own identity capture (D §7 schema) only if Stripe cannot confirm. Also approve or reject: `orders.paid_at`, a refunds record, deletion keeping a tax snapshot, a `TAX_REPORTING_ENABLED` switch plus a separate enforcement switch (D §7.7). Waits on the accountant's scope answer.
16. **Home launch switch and the early-access offer.** Publish Home pricing with `NEXT_PUBLIC_SELLER_SIGNUP_OPEN` (C S-1), given Store sign-up is already open while Home shows a waitlist (Inv 08 §1a, §3); keep or drop Docs' "Pro free for six months", which the code does not implement (Inv 08 §5).

---

## 5. Questions for the lawyer and for the accountant

**Only a lawyer can settle**

1. Does an account created with controller properties count as a Standard account under Stripe's Connect Platform Agreement, or as an attribute-based account (joint liability unless Managed Risk)? (A §13, §14)
2. What does the Connect agreement require of the seller terms beyond §3.1 and §3.5, and what triggers the duty to inform Stripe? (C Q12; B A2)
3. Is Square Share an online intermediation service under P2B, and an online marketplace under consumer law (trader display)? (C Q1, C-1)
4. Is an email listing the changes with a link a sufficient durable-medium notice, or must the full text be sent? Does starting the clock when some emails are unconfirmed or bounced satisfy P2B? (C Q2, Q3)
5. tos-2026-11-06 has two agreements and has never been noticed: must it run its notice before a Czech-beta version, and may a notice start for a text not yet reviewed? (C §0; Prod; changing-the-terms.md:50-56)
6. Which immediate-termination grounds fit P2B Art. 4(4) under Czech law, and how should the exceptions be worded? (C Q4)
7. What must an account-suspension statement contain, and how does the micro-enterprise exemption interact with Art. 4(3)? What should the ban notice say? (C Q5; B R3)
8. Is agreement in the welcome flow enough to form the contract, and which terms bind between sign-up and that agreement? Should IP, user agent or surface be recorded? (C Q6, §8 #19)
9. Should the Privacy and Cookie Policies be "part of" the Terms? (C Q7)
10. Must the Terms be offered in Czech, and which language prevails? The Czech UI and summary were machine-produced and are unreviewed. (C Q8; Inv 08 §4)
11. Moving the refund rule from "returned" to "kept": a change worse for sellers needing notice? Compatible with Stripe's rules and fairness on a consumer withdrawal? (C Q9; F §9 Q10)
12. Can content be paused on grounds the classifier enforces but the AUP does not list? (C Q10)
13. Do plan grants, fee waivers and the early-access offer need describing under Art. 7, and is "no better treatment" a problem? (C Q11)
14. Is the small-enterprise wording on mediators and complaints correct, and does the micro-enterprise exemption cover transparency reporting? (C Q16; B §6)
15. Art. 18: which Czech authority, through which channel, at what threshold? Wording of a good-faith statement on the report form? (B S6, S4)
16. Waitlist: is consent valid when the form shows no consent text? (Inv 08 §3)
17. DAC7 privacy paragraph, including processing of the Czech birth number; may buyer data on retained orders be anonymised? (D §5.2, §4.2; with the accountant)

**For the accountant**

1. Is Efficontrol a DAC7 reporting platform with direct charges on sellers' accounts, from when and for which surfaces (embed, hosted storefront, collab, marketplace)? This starts the 15-day registration clock. (D Q1; C Q14)
2. Quarter by payment or order time, which time zone; refund netted in the sale's or the refund's quarter? (D Q2)
3. Consideration: include delivery? Stripe's processing fee? Plan fees, ad fees? (D Q3)
4. Unit of "number of activities" (order, line, unit); do fully refunded sales count; is a lost chargeback a refund? (D Q4, Q13)
5. Report each currency as paid or convert; which rate for the EUR 2,000 test? (D Q5)
6. Is the Stripe account id or last4 enough as the payout identifier; is the holder name needed? (D Q6)
7. Czech IDs: birth number or DIČ for individuals; DIČ or IČO for entities; must they be verified? Is a VIES check needed? (D Q7, gap 7)
8. Does the Czech tax administration accept the Netherlands-schema XML? (D Q8)
9. Retention: 10 years from when; order-level rows or reported figures only? (D Q9)
10. Is disabling payouts or charges at Stripe acceptable "withholding", or must the account be closed? (D Q10)
11. Must each seller get a copy of what was reported, and by when? (D Q11)
12. VAT: position of a non-registered Czech micro company selling subscriptions and taking application fees; what replaces "excl. VAT"; should Stripe Tax run on plan checkout; does the fee carry VAT now registration has ended? (C Q13; D Q14)
13. With Czech-only sellers, can the deemed-supplier paragraph go, and how should the dispatch rule read? (C Q15, with the lawyer)
14. Collab checkout: who is the reportable seller per line, and how are shared fees split? (D Q15)

---

## 6. What can be fixed without anyone's approval

None of these changes money flow, account type or a table with data. Deploying any of them to production still needs your OK. Most valuable first:

1. **Remove the comments that permit destination charges** (`ProductCta.tsx:33-37`, `Store:src/lib/payments/types.ts:11-14`) and add a CI check that fails on transfer and destination-charge parameters (A gaps 3, 19).
2. **Correct the refund comments** in `webhook.ts:234-236` and `fees.ts:12-15`, which say the fee goes back wherever a refund is made; Stripe's docs say a refund without the flag keeps it (F §1.7, §7.5).
3. **Complete the restricted-key runbook** (Application Fees read, PaymentIntents read), refuse `sk_live_` in production, add `server-only` (A gaps 16, 18). With a key scoped as documented today, every paid event would retry (A §8).
4. **Fix Admin revenue**: the live filter never matches Connect orders and only EUR counts (F §3.6, Inv 06 #8; rechecked).
5. **Reporter receipt, decision notice and automated-pause emails** (B S4, R3): build now, effective once mail is on.
6. **Admin form to log notices received by email or phone** (B S4(5)).
7. **Fee line in the Connect dialog** (A gap 22).
8. **Moderation hardening**: trusted writes reset `moderation_checked_at`; `isContentVisible(undefined)` fails closed (B D1).
9. **Alert ops on a dispute**; treat `capability.updated` as a refresh (A gaps 12, 15). Subscribing the endpoint to new events is a Stripe Dashboard step (section 7).
10. **Admin copy and guards**: the audit page's "cannot be edited or deleted" line; limits on unban, confirm email, reset and campaigns (Inv 06 §9).
11. **Operator naming**: "Root Labs" in Docs and "SquareShare" in the cookie banner become Efficontrol s.r.o. (Inv 08 §6).
12. **Dead and stale text**: the unused "Seller Agreement" placeholder copy; pointers to the retired `Home:src/content/legal/terms.ts` (`Store:src/lib/legal/terms-summary.ts:7`, `Store:src/lib/settings/constants.ts:107`); the summary's "material changes" line, aligned word for word with the published Terms (C §8 #16 to #18).
13. **No personal data in logs** (`Store:src/lib/payments/connect/actions.ts:70`, `:95`; A §8).
14. **Statement descriptor on Payments, trader name in the email From line** (C BR-2).
15. **App, before it launches**: ownership check on the product link; rate limit on `/api/events` (Inv 07 §4.2, §11).

---

## 7. What nobody could verify, and who can

**Adrian, with Stripe test keys or the Stripe Dashboard**
- Whether any Express account exists in Stripe, test or live (Prod covers only our table) (A §13).
- What a legacy Express account reports as `controller.losses.payments` (F §5).
- Express default when no country is sent; whether Express with direct charges incurs per-account and payout fees; whether Czechia requires `transfers` with `card_payments`; how to reject an old Express account (A §14).
- Exact restricted-key permission names (A §14); the platform's Connect settings and pricing model (A §14).
- Statement descriptor and merchant name on Stripe's hosted page; Stripe receipt settings (A §14; B; C §10).
- `refund_application_fee` on a charge with no fee; whether the Express Dashboard can refund a fee; a fee refund with insufficient platform balance; Stripe's rounding of proportional fee refunds; balance transaction types for fees (F §10).
- Masked bank details for full-Dashboard accounts (D, could not determine).

**Stripe (support or account contact)**
- Platform Tax Reporting: preview access, whether it applies to full-Dashboard accounts, a Czech-acceptable format, retention after an account closes, whether `financial_accounts` is filled, the Poland contradiction (D §6).
- A line-by-line comparison of the AUP with Stripe's current restricted-businesses list, and the current Connect agreement text (B; C §10).

**Adrian, in the Cloudflare, GitHub and Supabase dashboards**
- Store: whether `STRIPE_SECRET_KEY` and both webhook secrets are set and whether the key is `rk_`; whether `ANTHROPIC_API_KEY` is set and the repo holds `CRON_SECRET` (without them the moderation check hides every new save) (A §14; B).
- Whether a dashboard-set `TRANSACTIONAL_EMAIL_ENABLED` or Home `NEXT_PUBLIC_SELLER_SIGNUP_OPEN` exists outside the repo (C §10; Inv 08 §7).
- Admin: Brevo SMTP, VAPID and `NOTIFY_SCAN_SECRET` secrets; whether the hand-made pg_cron scan is armed; which Admin migrations are applied; any production-only trigger protecting the logs (B; Inv 06 §8).
- App: whether it is deployed, its secrets, whether `interaction_events` exists and whether `reports` accepts its reasons (Inv 07 §10).
- Whether deployed Home, Docs and App match the code read; what the n8n waitlist automation and Supabase auth email templates send (Inv 08 §7).

**Anyone, by running it on the local test stack**
- Whether the Stripe end-to-end test (spec 87) still passes against the stand-in (A §14). It proves nothing about real Stripe.

**A professional translator or the lawyer**
- Accuracy of the Czech checkout and legal wording (Inv 08 §4, §7).

**Now settled by Prod (2026-11-22)**: 0 connected accounts, so moving to the locked account type needs no account migration (A §13); 0 fee-ledger rows and no real payment, so no refund history to unwind (F §0) and nothing reportable for DAC7 (D); all billing switches off; `terms_versions` holds only tos-2026-10-11 (B; C); two profiles agreed to tos-2026-11-06 (Inv 08 §7.1); the cart migration is not in production (D; F). Still open from that list: whether any `plan_prices` row was changed (C §10).
