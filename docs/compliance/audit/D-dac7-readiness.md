# Audit D: DAC7 data readiness

Date: 2026-11-22. Scope: read-only audit of the code and SQL in Store, Home and
Admin (App, Docs and SQ-system were searched and hold nothing relevant). No
database, Stripe API, production URL or MCP tool was used. Public Stripe
documentation was read with a web fetch (section 6).

Not legal or tax advice. Where the owner's brief does not settle a point, it is
listed as a question for the accountant (section 8.2). Section 7 is a
PROPOSAL: it is a schema change and needs the owner's approval before any of it
is built.

Path convention: `Store/...`, `Home/...`, `Admin/...` are relative to
`C:\Squareshare\<repo>\`. Line numbers are as of commit `e43eedd` plus the
working tree on 2026-11-22.

A note on sources for the database: the earliest migrations (profiles, orders,
the tax columns) are not in `Store/supabase/migrations/`; they exist only in the
hand-curated production replay `Store/tests/db/prod-migrations.sql` (its header
says "Last reconciled 2026-08-07", `prod-migrations.sql:4-5`, although it
contains later migrations too). Column lists are confirmed against the generated
types in `Store/src/types/supabase.ts`.

---

## Summary

| Area | Verdict |
|---|---|
| Seller identity for DAC7 | Mostly MISSING. We hold a single free-text "trader name", a free-text address, an optional VAT ID and an optional country. No individual/entity flag, no first/last name split, no TIN, no TIN issuing country, no date or place of birth, no business registration number (IČO). |
| Per-seller quarterly totals | PARTIAL. Gross paid, delivery, our fee, line and full refunds, and counts are derivable per seller and currency from `orders`, `order_add_ons`, `order_line_refunds` and `fee_ledger`. Gaps: no paid-at timestamp, partial refunds made in Stripe's dashboard leave no amount in our DB, dispute outcomes are not recorded, no live/test flag on orders. |
| Payout account identifier | MISSING by design. We store only the Stripe account id and three booleans. The bank account lives at Stripe. |
| Retention (10 years) | CONFLICT. Account deletion cascades the seller's profile, orders, order lines, line refunds and Stripe account link. Only anonymised `fee_ledger` rows survive. |
| Privacy notice | Says nothing about DAC7, and two passages (privacy notice and in-product copy) promise the trader details are never shared, which reporting would contradict. |
| Stripe Platform Tax Reporting | Promising for identity collection and XML, but private preview, EU XML is generated in the Netherlands schema (Czech acceptance unconfirmed), applicability to Stripe-owned-onboarding / full-dashboard accounts unconfirmed, and Stripe does NOT compute the money totals: we must import them. Verdict: worth requesting preview access; do not plan on it alone. Confidence: medium-low on usability, high that our own totals are needed either way. |

Production state relevant to all of this: Stripe Connect is switched off
(`NEXT_PUBLIC_STRIPE_CONNECT_ENABLED` is commented out at
`Store/.env.production:47`; the switch is read at
`Store/src/lib/payments/availability.ts:30`), and the per-sale fee is off
(`billing_switches.fees_enabled`, `Store/supabase/migrations/20261011_pricing_config.sql:383-388`).
So no real consideration has been paid through the platform yet, and the gaps
below can be closed before the first reportable quarter.

---

## 1. Seller data captured today

### 1.1 Where seller identity lives

All seller identity is six columns on `public.profiles`
(`Store/src/types/supabase.ts:2040-2072`), written by one server action,
`saveTaxInfo` (`Store/src/lib/settings/actions.ts:446-579`), from the form
`TaxSection` (`Store/src/components/settings/TaxSection.tsx:252-392`) on
Settings, Business & seller details (`Store/src/app/settings/business/page.tsx:50-64`).
The welcome flow posts only the three gate fields to the same action
(`actions.ts:455-461`).

- `tax_business_name`, `tax_vat_id`, `tax_country` were added "collected only,
  not yet used downstream" (`Store/tests/db/prod-migrations.sql:250-279`).
- `seller_address`, `seller_email`, `seller_phone` were added for distance-selling
  law (`Store/supabase/migrations/20260905_seller_identity_on_profile.sql:36-50`).
- The write whitelist is `TAX_FIELDS` (`actions.ts:436-443`); the Zod schema is
  `taxSchema` (`Store/src/lib/validation/settings.ts:124-138`).
- With 2FA on, a save needs a recent code (`actions.ts:472-476`). The trader
  name goes through the automatic moderation check (`actions.ts:515-520`;
  DB guard `Store/supabase/migrations/20261012_auto_moderation.sql:747-756`).
- Publish gate: trader name, address and contact email are required before
  anything is published or sold, plus a proven email when mail is available
  (`Store/src/lib/settings/trader-identity.ts:69-99`, `:115-144`). Nothing else
  is required.

### 1.2 Field-by-field against the DAC7 list

**Individuals**

| DAC7 field | Collected? | Where | Required / optional | Verified or free text |
|---|---|---|---|---|
| First and last name | PARTIAL | `profiles.tax_business_name`, one string 1..200 chars (`prod-migrations.sql:257-258`; Zod `settings.ts:125`; form `TaxSection.tsx:257-278`) | Required to publish (`trader-identity.ts:75-80`) | Free text, moderated, never checked as a legal name. The privacy notice tells individuals to enter "their own full name" (`Home/src/content/legal/privacy.ts:99`), but it is not split into first and last name and a trading name is equally accepted. |
| Primary address | PARTIAL | `profiles.seller_address`, one free-text field up to 300 chars (`20260905_seller_identity_on_profile.sql:37,42-43`; `Store/src/lib/settings/constants.ts:145-148`) | Required to publish (`trader-identity.ts:81-86`) | Free text with a placeholder/plausibility filter (`settings.ts:70-75`). No structured street, city, postcode or country. |
| Country of residence | PARTIAL | `profiles.tax_country`, ISO alpha-2 (`prod-migrations.sql:261-262`) | Optional (`settings.ts:131-136`; no required mark at `TaxSection.tsx:361-372`) | Picked from `OPERATING_COUNTRIES` = EU + US + CA (`constants.ts:110-116`). It is "the country you trade from", not a declared tax residence. |
| Every TIN with issuing country | MISSING | No column anywhere (`supabase.ts:2040-2072`) | n/a | n/a |
| Place of birth (if no TIN) | MISSING | none | n/a | n/a |
| VAT ID | PARTIAL | `profiles.tax_vat_id` (`prod-migrations.sql:259-260`) | Optional (`TaxSection.tsx:330-345`, no required mark) | Format only: `^[A-Za-z0-9 .-]{2,32}$` in SQL, upper-cased reference code in Zod (`settings.ts:128-130`). "Not validated against VIES" (`prod-migrations.sql:276-277`); there is no VIES code in Store (searched). A client-side advisory compares the prefix with the chosen country and never blocks (`TaxSection.tsx:346-359`). No separate issuing-country field (derivable from the VAT prefix). |
| Date of birth | MISSING | none | n/a | n/a |

**Entities**

| DAC7 field | Collected? | Notes |
|---|---|---|
| Legal name | PARTIAL | Same `tax_business_name`; with no individual/entity flag we cannot tell a legal name from a trading name. |
| Address | PARTIAL | Same free-text `seller_address`. |
| Tax ID | MISSING | none |
| VAT ID | PARTIAL | Same `tax_vat_id`. |
| Business registration number (IČO) | MISSING | none |

**Individual versus entity:** not recorded anywhere. No column, no Zod field,
no form control. A search for `business_type`, `individual`, `company` in
`Store/src/lib` finds only unrelated uses (for example
`Store/src/lib/settings/account-row.ts:12`). Connect account creation does not
send a business type either (`Store/src/lib/payments/connect/account.ts:153-164`).

### 1.3 Who can read these columns

- `profiles` RLS: select and update your own row only, for `authenticated`
  (`prod-migrations.sql:93-108`). No anon policy; the public directory was moved
  off `profiles` precisely because it "holds tax data"
  (`Store/supabase/migrations/20260924_public_profiles_invoker.sql:8-13`, `:164-165`).
- The owner can therefore also write these columns directly over PostgREST,
  bypassing Zod (only the SQL CHECKs and the moderation trigger apply). Fine for
  published trader details, but a reason not to put DAC7 data on this table
  (section 7).
- Team members cannot read the owner's row; service-role helpers read it for
  them (`Store/src/lib/settings/seller-identity.ts:21-31`).
- PUBLIC: trader name, address, contact email, VAT ID, country and the proven
  phone are published on every product page and embed
  (`seller-identity.ts:148-161`). That is by design (consumer law).
- Staff: the Admin moderation view reads all six
  (`Admin/src/lib/data/moderation.ts:961`, `:1029-1035`).
- Stripe Billing customer (seller as our customer): name, country, VAT ID
  (`Store/src/lib/billing/customer.ts:35-44`).
- The seller's own data export includes them
  (`Store/src/app/settings/export/route.ts:41-42`).

### 1.4 What Stripe collects that we do not store

- Accounts are created as `type: "express"` with only `country` (from
  `tax_country` when set), `email` and `metadata.owner_id`
  (`account.ts:153-164`; the caller passes the published country and contact
  email, `Store/src/lib/payments/connect/actions.ts:59-66`). The locked decision
  reportedly forbids Express (`Store/COMPLIANCE_PROGRESS.md:89-90`); Audit A
  owns that question.
- Stripe-hosted onboarding collects identity and bank details; the code says so
  and stores none of it (`account.ts:11-15`; `actions.ts:44-46` "comes back to us
  as three booleans").
- Our Stripe account type holds four fields: `id`, `charges_enabled`,
  `payouts_enabled`, `details_submitted` (`Store/src/lib/billing/stripe-api.ts:110-115`).
  Only the three booleans are saved (`account.ts:108-118`).
- Not stored, held by Stripe: business type, legal name, date of birth, address,
  ID numbers, registration number, VAT ID, bank account, and the Stripe account's
  country (no `country` column on `seller_payment_accounts`,
  `Store/supabase/migrations/20261008_seller_payment_accounts.sql:33-49`).
- Reading these back from Stripe is limited: for accounts where
  `controller.requirement_collection` is `stripe` (Standard and Express), Stripe
  returns "only a subset" of `individual` and `company` after an Account Link is
  created, and `external_accounts` only when `controller.is_controller` is true
  (Stripe API reference, Account object; see section 6). ID numbers are only ever
  reported as "provided" flags. So we cannot simply mirror Stripe's KYC data into
  our DB.

---

## 2. Quarterly totals per seller

### 2.1 The tables

| Need | Table.column | Evidence |
|---|---|---|
| Seller | `orders.seller_id` (the store OWNER; team members act on the owner's store) | `prod-migrations.sql:293`; writer resolves seller from the product owner (`Store/src/lib/orders/record.ts`, order writer `order_place`) |
| Gross paid by buyer | `orders.amount_cents`: items after discounts plus delivery, checked equal to Stripe's `amount_total` and currency | `Store/src/lib/payments/connect/webhook.ts:67-83`, `:198-207` |
| Delivery share | `orders.shipping_cents` (null on older orders) | `Store/supabase/migrations/20261004_discounts.sql:344-345` |
| Discounts | `orders.discount_cents` (already deducted from `amount_cents`) | `20261004_discounts.sql:338-339` |
| Lines after the first | `order_add_ons` (`amount_cents`, `quantity`, `seller_id`) | `supabase.ts:1304-1322`; `Store/supabase/migrations/20261120_shopping_cart.sql:1-8` |
| Per-line view | `order_lines` (one row per line, own status, `revenue_cents` sums to `orders.amount_cents`) | `20261120_shopping_cart.sql:575-623` |
| Our fee as charged | `orders.platform_fee_cents`, `ad_fee_cents`, `application_fee_cents` (corrected to what Stripe collected) | `20261011_pricing_config.sql:392-425`; correction `Store/src/lib/payments/connect/fees.ts:51-100` |
| Our fee as collected / returned | `fee_ledger` (insert-only, signed, per currency, `stripe_application_fee_id`, `livemode`) | `20261011_pricing_config.sql:533-563`; writers `Store/src/lib/billing/fee-ledger.ts:73-95` |
| Full refunds | `orders.status = 'refunded'`, `refunded_at`, `refund_reason` | `Store/supabase/migrations/20261008_order_lifecycle.sql:395-427` |
| Per-line refunds | `order_line_refunds` (`amount_cents`, `created_at`, `line_id` null = first line) | `20261120_shopping_cart.sql:351-392`, `:445-558` |
| Disputes | `orders.status = 'disputed'` (set on `charge.dispute.created`) | `webhook.ts:252-277` |

Fee base: from 20261011 the platform fee is charged on the whole amount paid,
delivery included (`20261011_pricing_config.sql:416-417`, `:669-671`).

### 2.2 Which timestamp defines the quarter

- There is NO paid-at timestamp. `order_confirm_paid` flips `pending` to `paid`
  without stamping a time (`20261008_order_lifecycle.sql:226-260`); it was never
  redefined later (searched), and no `paid_at` column exists (`supabase.ts:1416-1470`).
- `orders.created_at` is when the checkout STARTED: the order is written first
  as `pending` with a 45-minute expiry (`Store/src/lib/orders/record.ts:180`,
  `:294-295`). A payment confirmed just after midnight on a quarter boundary is
  therefore attributed to the earlier quarter by `created_at`. The window is at
  most about 45 minutes, but it exists.
- Proxy: the `platform_fee` row in `fee_ledger` is written when the webhook
  settles the payment (`webhook.ts:208-213`, `fees.ts:99`), so its `created_at`
  is close to payment time. But no row is written when the fee is zero
  (`fee-ledger.ts:44`), which is every sale while fees are off or waived.
- Refund timing: `orders.refunded_at` (full) and `order_line_refunds.created_at`
  (lines); negative `fee_ledger` rows carry their own `created_at`.
- Fix proposed in section 7.6: add `orders.paid_at`.

### 2.3 How refunds are recorded, including partial

- Full refund from the order panel: Stripe first (`refund_application_fee: true`,
  idempotency key per order), then `order_apply_refund`
  (`Store/src/lib/orders/actions.ts:422-443`, `:459-501`). The amount is not
  stored; it is implied to be the whole `amount_cents` ("whatever of the payment
  is left", `actions.ts:463-465`).
- Per-line refund: Stripe partial refund of exactly the line's amount, then a
  row in `order_line_refunds` with the amount (`actions.ts:302-406`; amount from
  `order_line_refund_amount`, `20261120_shopping_cart.sql:396-443`). The last
  line standing takes the delivery with it (`:434-440`). When every line is
  refunded the order becomes `refunded` (`:539-555`).
- Partial refund made in Stripe's own dashboard: the webhook writes only our
  fee's return to `fee_ledger` and leaves the order `paid`
  (`webhook.ts:229-250`, note at `:239-242`). The AMOUNT returned to the buyer is
  stored nowhere in our DB. It can only be estimated from the fee refund ratio,
  and only when a fee was charged.
- Disputes: only `charge.dispute.created` is handled
  (`webhook.ts:42-48`, `:252-277`). A lost chargeback (money taken back from the
  seller) is not recorded; the order stays `disputed`.
- The shopping cart migration that adds `order_line_refunds` is committed
  (`a48b90e`) but, per an earlier session note, not applied to production as of
  2026-11-20 (not checked against production here).

### 2.4 Currency

- Each order is single-currency: `orders.currency` (text, default EUR, no CHECK,
  `prod-migrations.sql:301`), Stripe charge currency must match
  (`webhook.ts:73-83`), and `fee_ledger.currency` is copied from the order
  (`20261011_pricing_config.sql:605-618`).
- Products allow only EUR and USD today (`prod-migrations.sql:157`); the
  Czech-only beta's CZK will need that changed (other audits).
- No exchange rates are stored anywhere. Totals must be grouped by currency; any
  conversion (for example for the EUR 2,000 small-seller test) needs a rate
  source we do not have. Note that existing analytics are EUR-only on purpose
  (`20261011_pricing_config.sql:690`); a DAC7 query must not copy that filter.

### 2.5 Net or gross

- `amount_cents` is GROSS of our fee and INCLUDES delivery.
- Consideration net of our fees = `amount_cents` minus refunds minus our net fee
  (charged minus returned). Whether delivery belongs in consideration is an
  accountant question; `shipping_cents` lets us report either way (null on older
  orders).
- Taxes withheld by the platform: none (we withhold no tax; sellers set their own
  VAT-inclusive prices).

### 2.6 What only Stripe holds

- Stripe's processing fee on each charge: visible on the seller's balance
  transactions, which the Payments page reads live and never stores
  (`Store/src/lib/payments/connect/overview.ts:9-11`, `:118-133`, `:184-193`).
  Who bears it depends on the account's fee configuration (Audit A). It is not
  our fee, so probably not "fees withheld by the platform" (accountant).
- Payouts and their destination bank account (`overview.ts:18-20`, `:99-100`).
- The amount of dashboard-made partial refunds, and dispute outcomes (2.3).
- Payments that completed after their pending order was released: answered 200,
  alerted, and no row written (`webhook.ts:185-192`). Our DB undercounts these;
  a reconciliation against Stripe's balance transactions per account is needed.
- Live versus test: `orders` has no `livemode` column (`supabase.ts:1416-1470`).
  `payment_ref LIKE 'pi\_%'` identifies a Stripe payment
  (`Store/supabase/migrations/20261021_order_refund_provider_first.sql:13-17`,
  `:53`), and live mode can be inferred from `fee_ledger.livemode` or
  `seller_payment_accounts.livemode`, not from the order itself.

### 2.7 Rows that must be excluded

- Demo seller orders written by the in-database simulator
  (`Store/supabase/migrations/20260801_demo_sales_sim.sql:1-31`, insert at `:325`)
  and dev test-provider orders: neither has a `pi_` payment reference.
- Abandoned pending orders are deleted anyway (section 4.3).

### 2.8 Read-only SQL sketch (per seller, per currency, per quarter)

DRAFT, not run. Real table and column names. Quarter by `created_at` because no
paid-at exists; the time zone is a parameter for the accountant to confirm.
Refunds are attributed to the SALE's quarter here; attributing them to the
refund's quarter instead is a one-line change (use `refunded_at` /
`order_line_refunds.created_at`).

```sql
with params as (
  select 2027 as yr, 'Europe/Prague'::text as tz
),
sales as (
  select
    o.id                                              as order_id,
    o.seller_id,
    o.currency,
    extract(quarter from o.created_at at time zone p.tz)::int as quarter,
    o.status,
    o.amount_cents,                                   -- buyer paid: items after discounts + delivery
    coalesce(o.shipping_cents, 0)                     as delivery_cents,
    coalesce(o.application_fee_cents,
             o.platform_fee_cents + o.ad_fee_cents)   as fee_on_order_cents,
    1 + coalesce(x.lines, 0)                          as lines,
    o.quantity + coalesce(x.units, 0)                 as units
  from public.orders o
  cross join params p
  left join lateral (
    select count(*)::int as lines, sum(a.quantity)::int as units
      from public.order_add_ons a
     where a.order_id = o.id
  ) x on true
  where o.status in ('paid', 'refunded', 'disputed')
    and o.payment_ref like 'pi\_%'                    -- money Stripe took: no demo, simulator or test-provider rows
    and o.created_at >= make_timestamptz(p.yr,     1, 1, 0, 0, 0, p.tz)
    and o.created_at <  make_timestamptz(p.yr + 1, 1, 1, 0, 0, 0, p.tz)
),
refunds as (
  select s.order_id,
         case
           when s.status = 'refunded' then s.amount_cents          -- whole payment went back
           else coalesce((select sum(r.amount_cents)
                            from public.order_line_refunds r
                           where r.order_id = s.order_id), 0)     -- lines refunded on a still-paid order
         end as refunded_cents
    from sales s
),
fees as (
  select l.order_id,
         coalesce( sum(l.amount_cents) filter (where l.amount_cents > 0), 0) as fee_charged_cents,
         coalesce(-sum(l.amount_cents) filter (where l.amount_cents < 0), 0) as fee_returned_cents
    from public.fee_ledger l
   where l.livemode
     and l.order_id in (select order_id from sales)
   group by l.order_id
)
select
  s.seller_id,
  spa.stripe_account_id,
  s.currency,
  s.quarter,
  count(*)                                         as orders,
  count(*) filter (where s.status <> 'refunded')   as orders_not_fully_refunded,
  sum(s.lines)                                     as lines,
  sum(s.units)                                     as units,
  sum(s.amount_cents)                              as gross_paid_cents,
  sum(s.delivery_cents)                            as delivery_cents,
  sum(r.refunded_cents)                            as refunded_cents,
  sum(s.fee_on_order_cents)                        as fee_on_orders_cents,
  coalesce(sum(f.fee_charged_cents), 0)            as fee_ledger_charged_cents,
  coalesce(sum(f.fee_returned_cents), 0)           as fee_ledger_returned_cents,
  sum(s.amount_cents) - sum(r.refunded_cents)
    - (coalesce(sum(f.fee_charged_cents), 0) - coalesce(sum(f.fee_returned_cents), 0))
                                                   as consideration_net_cents
from sales s
join refunds r using (order_id)
left join fees f using (order_id)
left join public.seller_payment_accounts spa on spa.owner_id = s.seller_id
group by s.seller_id, spa.stripe_account_id, s.currency, s.quarter
order by s.seller_id, s.currency, s.quarter;
```

Small-seller screen (goods): wrap the above per year and flag sellers with
`sum(orders) < 30 and consideration <= EUR 2,000`, which needs a currency
conversion rule for non-EUR rows (accountant).

Known blind spots of this query: dashboard-made partial refunds (amount
unknown), lost chargebacks, payments with no order row, deleted sellers
(section 4), and the paid-at boundary effect (2.2).

---

## 3. Payout account identifier

- We store nothing about the seller's bank account, by design.
  `seller_payment_accounts` holds `owner_id`, `stripe_account_id`,
  `charges_enabled`, `payouts_enabled`, `details_submitted`, `livemode`,
  `created_at`, `updated_at` (`20261008_seller_payment_accounts.sql:33-49`).
  Service role only: RLS on, no policies, no grant to API roles (`:61-63`).
- The Payments page does not even read the bank account yet
  (`overview.ts:18-20`, `:99-100`). The page's types say "Last 4 digits only.
  Full numbers never exist in this app" (`Store/src/lib/payments/types.ts:62-75`);
  that is a type for the page, not a stored column.
- Stripe APIs that would give an identifier (named only, not called):
  - `GET /v1/accounts/{account}/external_accounts` (or the `external_accounts`
    list on the Account object): bank account objects with masked number (last4),
    bank name, country, currency and account holder name. Returned only when
    `controller.is_controller` is true (Stripe API reference, Account object).
  - `GET /v1/payouts` on the connected account (`Stripe-Account` header): each
    payout's `destination` names the external account used.
  - The Stripe account id itself (`acct_...`) as an "online account identifier"
    is what we do hold.
- Stripe Platform Tax Reporting has a `financial_accounts` field
  (`account_identifier`, `account_identifier_type`, `account_holder_name`) in its
  CSV schema; the docs do not say whether Stripe fills it automatically.
- Whether last4, the Stripe account id or a full IBAN is required, and whether
  "insofar as available" style wording applies, is an accountant question.

---

## 4. Retention conflict

### 4.1 What account deletion does today

Policy (`Store/src/lib/account-deletion/policy.ts`):
- 14-day grace after the request (`:17-18`).
- Holds while a parcel is owed, a payment is pending or disputed, and for 30 days
  after the later of the last sale and the last dispatch (`:20-28`, `:42`,
  `:76-103`).

Job (`Store/src/lib/account-deletion/run.ts`):
- Deletes products and storefronts with their files (`:296-297`), clears order
  download files (`:298-299`, `:262-265`), the avatar (`:300`), then
  `auth.admin.deleteUser` (`:318`), which "takes everything that hangs off it with
  it (profile, products, storefronts, orders, team, notifications)" (`:8-13`).
- Knowingly left behind: the seller's Stripe account at Stripe (`:38-39`).

Cascades confirmed in SQL:

| Data | FK | Fate on deletion |
|---|---|---|
| `profiles` (all trader identity, VAT ID, country) | `profiles.id references auth.users on delete cascade` (`prod-migrations.sql:32`) | DELETED |
| `orders` | `orders.seller_id references auth.users on delete cascade` (`prod-migrations.sql:293`) | DELETED |
| `order_add_ons` | `seller_id ... on delete cascade`, `order_id ... on delete cascade` (`Store/supabase/migrations/20261028_product_add_ons.sql:107-109`) | DELETED |
| `order_line_refunds` | `order_id` and `seller_id` cascade (`20261120_shopping_cart.sql:353-354`) | DELETED |
| `seller_payment_accounts` (the only link to the Stripe account) | `owner_id references profiles on delete cascade` (`20261008_seller_payment_accounts.sql:34`) | DELETED |
| `account_deletion_requests` | cascade (`Store/supabase/migrations/20261010_account_deletion_requests.sql:33`) | DELETED |
| `fee_ledger` | `order_id ... on delete set null`, `seller_id ... on delete set null` (`20261011_pricing_config.sql:535-536`; rationale "what Square Share collected is its own accounting record and outlives both", `:520-524`) | KEPT, anonymised: amount, currency, kind, `stripe_application_fee_id`, `livemode`, `created_at` |

### 4.2 The conflict, precisely

- The brief requires keeping DAC7 records for 10 years. After deletion we keep no
  seller identity, no order, no line, no refund amount and no Stripe account id.
  The surviving `fee_ledger` rows name nobody; the only way back to a seller is
  asking Stripe which account an application fee (`fee_...`) belonged to.
- Timing makes it worse than a long-tail problem: a seller who sells in Q1, stops,
  and asks for deletion is gone after 14 days plus 30 days of aftercare, i.e. well
  before the 31 January report that must include their Q1 sales.
- Home's privacy notice already promises "Financial and tax records ... For 10
  years" (`Home/src/content/legal/privacy.ts:413-414`) while saying buyer and
  order data is "deleted with that account unless a longer period is required by
  law" (`:409-410`). The code implements only the deletion half. An earlier legal
  review note flagged exactly this ("orders are deleted wholesale (accounting, VAT
  and DAC7 records must survive)", session note `account-deletion-architecture`).

What would need to be retained per reportable seller (for the accountant to
confirm the scope):
1. The identity used in the report: every DAC7 field, the individual/entity flag,
   all TINs with issuing country, residence country.
2. The quarterly totals as reported, and the order-level rows that substantiate
   them (amount, currency, delivery, fee, refunds, timestamps, payment reference).
   Buyer personal data on those rows (`buyer_email`, `ship_to`, `gift_message`)
   is probably not needed for DAC7 and could be anonymised (accountant/lawyer).
3. The Stripe account id and the payout identifier reported.
4. The due-diligence trail: when data was requested, the two reminders, what was
   received, any enforcement.
5. The submissions: what was filed, when, the authority's response.

### 4.3 Abandoned-order deletion

- Unpaid pending orders are deleted, not kept as cancelled
  (`20261008_order_lifecycle.sql:43-49`), by `order_release_pending` and the
  sweep `orders_release_expired` (current version with lines,
  `20261028_product_add_ons.sql:381`, `:400-420`), scheduled every 5 minutes with
  pg_cron (`20261008_order_lifecycle.sql:349-358`); expiry 45 minutes
  (`record.ts:180`).
- No money moved, so these are not sales and their deletion does not conflict
  with DAC7. The one edge: a payment completing after release leaves money at
  Stripe and no row here (`webhook.ts:185-192`). That is a reconciliation gap,
  not a retention one.
- The demo simulator prunes the demo seller's old orders
  (`20260801_demo_sales_sim.sql:395`): demo data only.

---

## 5. Privacy notice

### 5.1 What Home says today

`Home/src/content/legal/privacy.ts`:
- Payments are not live (`:15`).
- Trader details: required fields, optional VAT and country (`:99`); "That is
  **all** we do with them ... we do **not** sell, rent or share them with
  advertisers" (`:107`). DAC7 reporting is a further use that this note does not
  allow for.
- Whether you must provide data: payments will need "transaction and
  financial-record data ... to meet our legal (tax and accounting) obligations"
  (`:182`). No mention of tax IDs, date of birth or consequences of refusal.
- Purposes table: trader details published (`:243-244`); "Comply with tax,
  accounting and other legal obligations, applies when payments launch",
  "Transaction and financial records", Art. 6(1)(c) (`:287-289`).
- Recipients: Stripe as independent controller (`:321-323`); "public
  authorities ... where required by law" (`:353`), generic.
- Retention: financial and tax records 10 years (`:413-414`).
- DAC7, tax authority reporting, TINs, date or place of birth: not mentioned
  anywhere in the file (searched).

In-product copy at the point of collection says the trader details are used
"for that reason alone" and "never sell or share them"
(`Store/messages/en/settings.json:344`; the same in `cs` and `de` at line 344).

The seller Terms already reserve the right to collect and report under DAC7
(`Home/src/content/legal/terms/tos-2026-11-06.ts:288`; the published
`tos-2026-10-31.ts:288`), so the contractual hook exists; the privacy notice
does not follow it.

### 5.2 What a DRAFT addition would need to cover (not final text)

1. Who: sellers resident in the EU who sell through reportable surfaces, and the
   small-seller exclusion.
2. What: the identity fields (names, address, date of birth, TINs with issuing
   country, place of birth where no TIN, VAT ID, registration number), the
   quarterly figures, the payout account identifier.
3. Source: the seller, and Stripe (if Platform Tax Reporting or Stripe data is
   used); Stripe's role for this data (processor for us, or its own controller).
4. Purpose and basis: due diligence and reporting under the Czech law
   implementing DAC7, legal obligation (Art. 6(1)(c)).
5. Recipient: the Czech tax administration, which exchanges the data with the
   seller's Member State(s) of residence; any verification services (VIES,
   Stripe).
6. Retention: 10 years, and that it survives account deletion.
7. Consequence of not providing: two reminders, then account closure or payment
   withholding, not before 60 days from the request.
8. The seller's copy of what is reported (if required; accountant).
9. Amend the "That is all we do" note (`privacy.ts:107`) and the in-product copy
   (`settings.json:344` in every locale) so they no longer promise the opposite.
10. Czech specifics a lawyer should check, for example processing of the birth
    number (rodné číslo), which Stripe uses as the Czech individual tax ID
    (section 6).

---

## 6. Stripe Platform Tax Reporting (from the public docs)

Pages read on 2026-11-22: `docs.stripe.com/connect/platform-tax-reporting`,
`/get-started`, `/collection`, `/generate-reports`, `/modify`, and the API
reference for the Account object. Nothing about this project was sent in any
query.

### 6.1 What the docs say

- Status: "Platform tax reporting is in private preview." Access by request.
  Liability: "Stripe accepts no liability for the use of information collected
  or reports generated."
- Regimes: MRDP-based rules, "DAC-7, SERR, ITA Part XX"; regions EU, Canada, UK,
  Australia, New Zealand.
- EU coverage: the overview says "all EU countries with the exception of PL",
  while the get-started page lists Poland among supported states. The docs
  contradict each other on Poland; Czechia is listed on both.
- XML: "Report generation to AU, CA, NL (for EU), and UK XML schemas." For the
  EU, the platform information table is the Netherlands one (nexus RPONEX1..5).
  The CSV has a `transmitting_country` field ("where the report ... will be
  lodged"), but no Czech schema is mentioned anywhere.
- Filing: the platform registers with its authority and submits the generated
  file itself, then reports the authority's feedback back to Stripe.
- Identity collection: an `additional_verifications[tax_reporting]` setting on
  the Account (actions `collect`, `validate`, `verify`, `attempt_verify`;
  enforcement up front, by time, or by volume, disabling payouts or payouts and
  payments). "Connect interfaces include the Stripe Dashboard, Express
  Dashboard, and hosted onboarding." The examples create `type=custom` accounts.
- Czech fields: Individual / SPE: name, date of birth, address, birth number (RČ)
  as `individual.id_number`, VAT; Entity: name, address, IČO as
  `company.tax_id`, VAT. Verification for Czech IDs: "No" for both.
  Place of birth is not collected by onboarding; the CSV has birth place fields
  for manual import. Multiple TINs are supported in the CSV
  (`other_tins_and_issued_by_country_codes`).
- Money: "Stripe won't automatically provide monetary amounts." The platform
  exports balance transactions, Sigma or Dashboard reports, aggregates per seller
  per quarter, and imports a CSV (`sale_of_goods_consideration_q1..q4`,
  `_num_`, `_fees_`, `_tax_`, in whole units). "Imported values don't carry over
  from year-to-year."
- Sellers: PDF statements per seller, via Dashboard or API.

### 6.2 Fit with this platform

| Question | Answer from docs | Confidence |
|---|---|---|
| Works with direct charges? | Not mentioned. Since totals are imported by us, the charge type matters only for how WE derive totals (with direct charges the charges sit on each connected account, so Stripe-side aggregation means per-account balance transaction reads, which `overview.ts:143-148` already does for a page). | Medium |
| Works with Express (what the code creates today)? | Express Dashboard and hosted onboarding are named as collection interfaces. | Medium |
| Works with accounts where Stripe owns onboarding and the seller has the full Stripe Dashboard (the target configuration)? | The full Stripe Dashboard is named as an interface, but nothing says a platform may apply `additional_verifications` to such accounts. Related Stripe tax tools (W-8/W-9) exclude full-dashboard accounts; that is indirect evidence only. | Low, UNCONFIRMED |
| Czech filing format? | Only an NL schema for the EU is listed. Whether the Czech tax administration accepts it, or whether Stripe produces a Czech file, is not stated. | UNCONFIRMED |
| Removes the need for our own totals? | No. Monetary amounts must be imported. | High |
| Lets us store or read the identity data? | Data is viewable and exportable in Stripe's Dashboard (admins see unredacted TINs); the Account API returns only a subset for Stripe-collected accounts. 10-year availability at Stripe after an account is closed or disconnected: not stated. | Medium (on limits), UNCONFIRMED (on retention) |
| Verification for CZ? | Not supported for Czech IDs (collection and format validation only). | High |

### 6.3 Verdict

Usable as an identity-collection and report-building tool IF three things are
confirmed with Stripe: preview access is granted, `tax_reporting` additional
verification applies to the account configuration Audit A settles on, and the
EU output is acceptable to the Czech tax administration (or a Czech output
exists). Even then, we still need: our own per-seller quarterly totals (section
2), our own retention of what was reported (section 4), and the reminder trail
(the docs offer enforcement by disabling payouts, not a 2-reminder / 60-day
log). Recommendation: request preview access and ask Stripe those three
questions, and in parallel build the totals and retention pieces, which are
needed either way. Build our own identity capture (section 7) only if Stripe
cannot confirm the configuration or the Czech format.

---

## 7. PROPOSAL: our own `seller_tax_profile` capture

PROPOSAL ONLY. Every item here is a schema change and needs the owner's approval.
Nothing has been built.

### 7.1 Principles

- NOT on `profiles`. That row is owner-updatable over PostgREST
  (`prod-migrations.sql:102-108`), read by several service-role helpers, and some
  of its columns are published on product pages (`seller-identity.ts:148-161`).
  A tax column there is one careless select away from a public page.
- Service-role only, like `seller_payment_accounts`
  (`20261008_seller_payment_accounts.sql:61-63`) and `account_deletion_requests`
  (`20261010_account_deletion_requests.sql:54-56`). The seller reads and edits
  through server actions.
- Survives account deletion until `retain_until` (no cascading FK).
- Tax IDs are rows `{kind, value, issuing_country}`, never a single column.

### 7.2 Tables (sketch)

```sql
create type public.tax_seller_kind as enum ('individual', 'entity');
create type public.tax_id_kind as enum ('tin', 'vat', 'brn', 'other');

create table public.seller_tax_profiles (
  owner_id              uuid primary key,          -- = profiles.id while the account lives; NO cascading FK
  seller_kind           public.tax_seller_kind not null,
  -- individual
  first_name            text,
  middle_name           text,
  last_name             text,
  birth_date            date,
  birth_place_city      text,                      -- only needed when no TIN
  birth_place_country   char(2),
  -- entity
  legal_name            text,
  permanent_establishments char(2)[] not null default '{}',
  -- primary address, structured
  address_line1         text not null,
  address_line2         text,
  address_city          text not null,
  address_region        text,
  address_postal_code   text,
  address_country       char(2) not null,
  residence_countries   char(2)[] not null,        -- Member State(s) of residence
  -- link to the money, copied so it survives deletion
  stripe_account_id     text,
  -- declaration and checks
  declared_at           timestamptz not null,
  declared_by           uuid not null,             -- the owner who submitted it
  declaration_version   text not null,             -- which form/notice text they saw
  verified_at           timestamptz,
  verification_source   text,                      -- 'self' | 'vies' | 'stripe' | 'staff'
  -- lifecycle
  account_deleted_at    timestamptz,
  retain_until          date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint stp_individual check (seller_kind <> 'individual'
    or (first_name is not null and last_name is not null and birth_date is not null)),
  constraint stp_entity check (seller_kind <> 'entity' or legal_name is not null)
);

create table public.seller_tax_ids (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.seller_tax_profiles (owner_id) on delete cascade,
  kind              public.tax_id_kind not null,
  value_ciphertext  bytea not null,                -- see 7.4
  value_last4       text not null,                 -- for display
  value_hmac        bytea not null,                -- keyed hash: duplicate detection without decrypting
  issuing_country   char(2) not null,
  tin_unknown       boolean not null default false,
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (owner_id, kind, issuing_country, value_hmac)
);

-- The 2-reminder / 60-day trail. One row per message sent.
create table public.seller_tax_requests (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null,
  step          text not null check (step in ('request', 'reminder_1', 'reminder_2', 'enforced')),
  sent_at       timestamptz not null default now(),
  channel       text not null,                     -- 'email' | 'dashboard'
  message_ref   text,                              -- mail provider id
  satisfied_at  timestamptz,
  enforcement   text check (enforcement in ('payouts_disabled', 'account_closed'))
);
-- Enforcement may run only when both reminders exist AND now() >= the request's sent_at + 60 days.

-- Frozen quarterly figures, written by a job, immutable once frozen (fee_ledger precedent).
create table public.dac7_seller_quarters (
  owner_id                 uuid not null,
  year                     smallint not null,
  quarter                  smallint not null check (quarter between 1 and 4),
  currency                 char(3) not null,
  activities               integer not null,
  gross_paid_cents         bigint not null,
  delivery_cents           bigint not null,
  refunded_cents           bigint not null,
  fees_cents               bigint not null,
  consideration_net_cents  bigint not null,
  stripe_account_id        text,
  payout_identifier        text,                   -- whatever the report carries (encrypted if full)
  computed_at              timestamptz not null default now(),
  frozen_at                timestamptz,
  primary key (owner_id, year, quarter, currency)
);
```

All four: `alter table ... enable row level security;` no policies;
`revoke all ... from public, anon, authenticated; grant ... to service_role;`
(restate grants on every function too: a recreated function is re-granted to
anon in this project, see `20261021_order_refund_provider_first.sql:61-63`).

### 7.3 Who may read

- Service role only at the database level.
- The seller (store OWNER only, not team members; the business page already
  warns members it shows their own details, `business/page.tsx:35-49`): sees and
  edits their profile through a server action, TINs shown as last4, saves behind
  the same 2FA step-up as `saveTaxInfo` (`actions.ts:472-476`) and the same rate
  limit.
- Staff: Admin reads through the service role, every read written to
  `admin_audit_log` (table exists, `supabase.ts:45`).
- Never on any public or buyer-facing read; never in `SELLER_IDENTITY_SELECT`
  (`seller-identity.ts:55-56`).

### 7.4 Encryption and column protection

- TINs (a Czech birth number encodes date of birth and sex), date of birth and
  any full bank identifier deserve more than RLS. Options to weigh:
  application-level envelope encryption (AES-GCM with WebCrypto in the Worker,
  key in a Worker secret), with a keyed HMAC for duplicate detection; or a key
  held in Supabase Vault. Database-side column encryption features should be
  checked against Supabase's current guidance before choosing.
- Keep the backup and probe roles (session note `prod-ops-roles-and-secrets`)
  away from plaintext.
- Never log values; error messages carry codes only (the deletion job's pattern,
  `run.ts:79-88`).

### 7.5 Where the form sits, and what it reuses

- Form: a second card on Settings, Business & seller details
  (`/settings/business`, `business/page.tsx:50`), anchor for example
  `#tax-reporting`, plus a step before "Continue to Stripe" in the connect flow
  (`Store/src/components/payments/ConnectStripeModal.tsx`; action
  `startStripeOnboarding`, `connect/actions.ts:51-73`). Do NOT reuse
  `/settings/tax`: it is a permanent redirect to the business page
  (`Store/src/app/settings/tax/page.tsx:7-9`) and browsers cache it.
- A dashboard attention row when data is missing or a reminder is due (the
  existing attention mechanism, `Store/src/lib/dashboard/attention.ts`).
- Reuse, do not duplicate:
  - VAT ID: keep `profiles.tax_vat_id` as the one source (it is published and
    already validated), and have the DAC7 export read it, issuing country from
    its prefix. Do not add a second VAT column. (Alternatively move it into
    `seller_tax_ids` and have the product page read from there; one or the other,
    not both.)
  - Prefill only, not reuse: `tax_business_name` (legal name for entities, but a
    trading name is allowed there), `seller_address` (free text), `tax_country`
    (residence default). The DAC7 values must be confirmed as legal values.
  - `seller_payment_accounts.stripe_account_id`: copied into the profile and the
    quarterly snapshot so it survives deletion.
- Copy as i18n keys in every locale; route and storage names as constants
  (project rule).

### 7.6 Supporting changes

- `orders.paid_at timestamptz`, stamped by `order_confirm_paid`
  (`20261008_order_lifecycle.sql:238-241`) and by `order_place` when an order is
  written already paid; existing rows left null (fall back to `created_at`).
- Record the amount of every refund Stripe reports (from `charge.refunded`,
  `webhook.ts:229-250`), not only our fee's share, for example an
  `order_refunds` row per Stripe refund id.
- Handle `charge.dispute.closed` so a lost chargeback is recorded.
- Deletion: before `deleteUser` (`run.ts:318`), the job freezes the seller's
  quarterly snapshot and keeps the tax profile (sets `account_deleted_at`,
  `retain_until`). Separately decide whether order rows should outlive the
  account with buyer data anonymised (changing `orders.seller_id`'s cascade,
  `prod-migrations.sql:293`) or whether the snapshot plus a frozen order extract
  is enough (accountant).

### 7.7 Feature flag convention

The codebase has two switch patterns:
- Launch switch from the environment, server side, on under `next dev`, off in
  production until set: `cartLaunched()` reading `CART_ENABLED`
  (`Store/src/lib/cart/availability.ts:14-19`); public build-time variant for
  client-read switches, `NEXT_PUBLIC_STRIPE_CONNECT_ENABLED`
  (`Store/src/lib/payments/availability.ts:17-30`).
- Database switch row, turned on by a person, read failure reads as OFF:
  `billing_switches` read by `readBillingSwitches`
  (`Store/src/lib/billing/switches.ts:1-15`, `:28-44`).

Proposal: `TAX_REPORTING_ENABLED` read by a `taxReportingLaunched()` in a new
`lib/tax-reporting/availability.ts` (shows the form and the attention row), and
enforcement (disabling payouts after 2 reminders and 60 days) behind a separate
database switch in the `billing_switches` style, so it can be turned on only
after the accountant signs off. Read failure means "do not enforce".

### 7.8 How the aggregates are produced

- A SQL function, for example `dac7_seller_quarter_totals(p_year int, p_tz text)`,
  SECURITY INVOKER, granted to `service_role` only, implementing section 2.8 with
  `paid_at` once it exists.
- A cron route (existing pattern: `Store/src/app/api/cron/*` behind
  `cronAuthorized`, `Store/src/lib/ops/cron.ts:50`) that, after each quarter,
  writes `dac7_seller_quarters` and recomputes until the year is frozen at filing.
- A reconciliation step comparing those totals with each seller's Stripe balance
  transactions, to catch payments with no order row and dashboard refunds.
- Output: the CSV Stripe's importer expects (if Stripe PTR is used), or the input
  for whatever Czech filing format the accountant names.

---

## 8. Gap table and open questions

### 8.1 Gap table

| # | Requirement | Status | Evidence | Proposed fix |
|---|---|---|---|---|
| 1 | Individual vs entity flag | MISSING | No column (`supabase.ts:2040-2072`); Connect sends no business type (`account.ts:153-164`) | `seller_tax_profiles.seller_kind` (7.2) or Stripe PTR |
| 2 | Individual first and last name | PARTIAL | One free-text trader name (`prod-migrations.sql:257-258`, `settings.ts:125`) | Structured names in 7.2, prefilled |
| 3 | Primary address, structured, with country | PARTIAL | Free-text `seller_address` (`20260905...:37`); optional `tax_country` (`settings.ts:131-136`) | Structured address in 7.2 |
| 4 | TIN(s) with issuing country | MISSING | none | `seller_tax_ids` rows (7.2) |
| 5 | Place of birth when no TIN | MISSING | none | 7.2 birth place fields |
| 6 | Date of birth | MISSING | none | 7.2 `birth_date` |
| 7 | VAT ID (+ country) | PARTIAL | Optional, format-only, no VIES (`prod-migrations.sql:259-260,276-277`; `settings.ts:128-130`) | Keep as single source; add VIES check (accountant: needed?) |
| 8 | Entity legal name | PARTIAL | Same trader name, legal vs trading indistinguishable | 7.2 `legal_name` |
| 9 | Entity tax ID | MISSING | none | `seller_tax_ids` kind `tin` |
| 10 | Business registration number (IČO) | MISSING | none | `seller_tax_ids` kind `brn` |
| 11 | Consideration per quarter, net of our fees | PARTIAL | Derivable (2.8); blind to dashboard refunds, lost disputes, orphan payments | 7.6 refund and dispute recording, reconciliation (7.8) |
| 12 | Paid-at timestamp for the quarter | MISSING | `order_confirm_paid` stamps nothing (`20261008_order_lifecycle.sql:238-244`) | `orders.paid_at` (7.6) |
| 13 | Number of sales per quarter | EXISTS (definition open) | `orders` + `order_add_ons` + `order_lines` (`20261120_shopping_cart.sql:575-620`) | Accountant defines the unit (order, line, unit) |
| 14 | Fees withheld per quarter | EXISTS (with caveat) | `fee_ledger` + `fee_ledger_summary` (`20261011_pricing_config.sql:533-563,639-660`); empty while fees are off | None beyond `livemode` filter |
| 15 | Refunds incl. partial | PARTIAL | Full and line refunds recorded; dashboard partials only as fee rows (`webhook.ts:237-242`) | Record Stripe refund amounts (7.6) |
| 16 | Live vs test separation on orders | PARTIAL | No `orders.livemode`; inferred via `pi_` ref and account/ledger livemode | Optional `orders.livemode` |
| 17 | Payout account identifier | MISSING (by design) | `seller_payment_accounts.sql:33-49`; `overview.ts:18-20` | Read from Stripe at report time (section 3), store only what is reported |
| 18 | Account holder name if different | MISSING | none | Same as 17 |
| 19 | EU-residency filter | PARTIAL | `tax_country` optional and includes US/CA (`constants.ts:110-116`); Stripe account country not stored | `residence_countries` (7.2); store Stripe account country |
| 20 | Small-seller exclusion (fewer than 30 sales AND at most EUR 2,000) | PARTIAL | Annual totals derivable; no FX data (2.4) | FX rule from accountant; annual screen query |
| 21 | 2 reminders, 60 days, then close or withhold | MISSING | No tracking; with direct charges we hold no money to withhold | `seller_tax_requests` (7.2); enforcement via Stripe payout disabling (6.1) behind a switch |
| 22 | Sellers told data is collected and reported | MISSING / CONTRADICTED | `privacy.ts:107`, `:287-289`; `messages/en/settings.json:344` | Draft addition (5.2), fix both passages |
| 23 | Tax IDs store value + issuing country (EU-ready) | MISSING | none | `seller_tax_ids` (7.2) |
| 24 | 10-year retention | CONFLICT | Cascades in 4.1; only anonymised `fee_ledger` survives | Snapshot + retained profile before deletion; decide order-row retention (7.6) |
| 25 | Retain the Stripe account link after deletion | MISSING | `seller_payment_accounts.sql:34` cascades | Copy `stripe_account_id` into retained tables |
| 26 | XML report generation | MISSING | none | Stripe PTR (if Czech-acceptable) or own exporter |
| 27 | Copy of reported info to each seller | MISSING | none | Stripe PTR statements, or own PDF/email (accountant: required?) |
| 28 | Collab checkout per-seller split | N/A today | Orders are single-seller (writer resolves one seller); collab not built (searched) | Design per-line seller attribution when collab is built |
| 29 | Registration within 15 days, annual filing by 31 January | OUT OF ENGINEERING SCOPE | Brief | Accountant |

### 8.2 Open questions for the accountant

1. From which date and for which surfaces is Efficontrol a reporting platform
   operator: Stage 1 embed, the hosted storefront that already exists
   (`Store/src/app/(public)/s/[storefrontId]/page.tsx`), collab checkout,
   Stage 3? This starts the 15-day registration clock.
2. Quarter attribution: payment time or order time; which time zone; and is a
   refund netted in the sale's quarter or the refund's quarter?
3. Consideration: include delivery charges? Is Stripe's processing fee (charged
   to the seller by Stripe, not by us) relevant? Do plan subscription fees count
   as fees "charged" by the platform, or only the per-sale application fee? Ad
   fees (marketplace)?
4. Number of activities: per order, per line, or per unit? Do fully refunded
   sales count?
5. Currency: report each currency as paid (CZK, EUR, USD), or convert? Which
   rate and date for the EUR 2,000 small-seller test?
6. Payout account identifier: is the Stripe account id or last4 acceptable,
   given we never hold the IBAN? Is the account holder name needed when Stripe
   does not expose it?
7. Czech identifiers: for individuals, is the birth number (rodné číslo, Stripe's
   choice) the right TIN, or DIČ? For entities, DIČ or IČO as TIN, and is IČO the
   business registration number? Must TINs be verified (Stripe cannot verify
   Czech IDs)?
8. Filing format: does the Czech tax administration accept the Netherlands-schema
   XML Stripe produces, or is a Czech format and portal required?
9. Retention: 10 years from when? Does it cover order-level records, or only the
   reported figures and identity? May buyer personal data on retained orders be
   anonymised?
10. Non-cooperation: Square Share never holds sellers' money (direct charges).
    Is disabling payouts or charges at Stripe an acceptable form of
    "withholding payment", or must the account be closed?
11. Seller statements: must each seller get a copy of what was reported, and by
    when?
12. Non-EU sellers (US and Canada are in `OPERATING_COUNTRIES`): confirmed out of
    scope for now, as the brief says?
13. Disputes: is a lost chargeback treated like a refund for consideration?
14. Does our fee carry VAT now that Efficontrol's VAT registration has ended
    (session note `operating-regions-and-terms`), and does that change the "fees"
    figure?
15. Collab checkout: when one buyer payment covers several sellers, who is the
    reportable seller for each line, and how are shared fees split?

---

## Could not determine

- Production data: whether any `pi_` orders, live connected accounts or
  `fee_ledger` rows exist (no database access; Connect and fees are believed off,
  see Summary).
- Whether the cart migration (`order_line_refunds`, `order_lines` current
  version) is applied in production.
- Stripe Platform Tax Reporting: applicability to Stripe-owned-onboarding,
  full-dashboard accounts; Czech filing format; Stripe-side retention; whether
  `financial_accounts` is auto-filled; the Poland contradiction. All need
  Stripe's answer.
- Stripe processing-fee bearer for direct charges on the account configuration
  Audit A chooses.
- Exact Stripe API behaviour for masked bank details on full-dashboard accounts
  (named from the API reference, not exercised).
