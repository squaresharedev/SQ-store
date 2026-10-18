# Pricing and ads build plan: status

Status of the "Square Share pricing and ads: build plan" (locked 10 Oct 2026),
as of the same day. Phases 0 to 2 are built as far as the codebase allows;
Phases 3 and 4 wait for the marketplace, as the plan says.

Nothing is live. Every part ships behind a switch that is off, the database
change has not been applied to production, and nothing has been committed or
deployed.

## How it landed

The plan was written as if for an empty codebase. Most of Phases 1 and 2
already existed here in another shape (plans, Stripe Billing, Connect direct
charges, the webhook idempotency table), so the work was to move the existing
code onto the plan's rules rather than build a second money layer beside it.

| The plan said | What was built | Why |
| --- | --- | --- |
| Migrations in `@squaresharedev/db` | `supabase/migrations/20261011_pricing_config.sql` in SQ-store | That package holds Supabase client factories, not migrations. Every migration for this database lives here. |
| `orders.origin` (new column) | `orders.channel`, mapped to the plan's origins in `src/lib/billing/origin.ts` | The column already says embed, button, direct or marketplace. A second column saying the same thing would be a second thing to keep true. |
| `orders.plan_id_at_checkout` | The existing `orders.seller_plan` | Same fact, already snapshotted. |
| `seller_billing.fee_waiver` | A table, `seller_fee_waivers` | A `seller_billing` row means "has a Stripe customer", and the admin panel reads a non-live row as a test account. A waiver for a seller who never went to checkout would have made every beta seller look like one. |
| `plan_prices.stripe_price_id` | `plan_prices.stripe_lookup_key` | A lookup key is the same in Stripe's test and live modes; a price id is not, so one row could not serve both. |
| Origin set by which route was called | Origin from the order's channel | All three direct origins reach one hosted checkout route here. They pay the same fee, so which one a link claims is attribution only. `marketplace`, the one origin with a different fee, cannot be claimed by a request at all (tested). |
| `billing_status` enum | The existing `seller_billing.status` | It already holds Stripe's own statuses, a superset of the plan's five. |
| Billing page at `/billing` | The existing `/plans` and Settings, Plan and billing | Same pages, already linked from everywhere. |
| Cancel through the Customer Portal | The existing in-app cancel | An earlier decision: the seller can say why. The portal still handles card, invoices and plan switches. |
| A monthly job for the upgrade hint | Worked out on each visit | The saving is one query on the last 30 days. A job would only make it stale. |

Two things were added that the plan did not ask for: `plan_prices.list_price_cents`
(keeps the existing "launch price" strike-through, now data instead of code,
and null on every seeded row), and a public price list endpoint
(`GET /api/billing/plan-prices`) so the homepage can read the same numbers.

## Checklist

### Phase 0: pricing package and config

- [x] Migration written, with RLS on every new table: `plans`, `plan_prices`,
  `plan_entitlements`, `seller_fee_waivers`, `fee_ledger`, new columns on
  `orders` and `billing_switches`. 23 database tests.
- [x] Seed rows match the pricing table: Free 5%, Starter EUR 12 + 2%, Pro
  EUR 39 + 0.5%; marketplace 8% / 7% / 6%. A test compares the SQL seed with
  the code's fixture copy.
- [x] Enums are strict Zod enums mirrored in Postgres (`plan_id`,
  `fee_entry_kind`, `feature_key`), compared by a test.
- [x] `computeFees`, `getActivePlanPrice`, `cheapestPlanFor`: integer maths,
  round half up, 30% cap. Every worked example in the plan is a unit test,
  plus 1-cent orders, the cap, a zero amount (throws) and an unknown origin
  (Zod rejects).
- [x] `@squaresharedev/pricing` created in SQ-system (`packages/pricing`),
  builds, 23 tests pass.
- [ ] **Not done: migration applied to production.** It is additive and inert
  with the switches off, but applying it is a person's call.
- [ ] **Not done: package published.** Needs a version bump and a tag push in
  SQ-system. SQ-store runs a working copy (`src/lib/pricing`) meanwhile,
  because it still cannot install from GitHub Packages (needs a classic PAT).
- [ ] **Not done: consumed by SQ-app.** Nothing there prices a sale yet.
- [ ] **Not built: `promotions`, `promotion_clicks`, the ad rate range config,
  `interaction_events` columns.** Phase 4 tables, left for Phase 4.

### Phase 1: fees on direct sales

- [x] Fee decided by the server at checkout creation from the database: plan,
  price row in force, waiver, switch, origin (`src/lib/billing/sale-fee.ts`).
  A checkout that cannot read them is refused, never charged a guess.
- [x] Fee base is the whole amount the buyer pays, delivery included (it was
  items only). Copy updated in all 10 languages.
- [x] `application_fee_amount` set on the Connect direct charge; the session's
  metadata carries origin, plan and rate.
- [x] Fee snapshot on the order: plan, rate, platform fee, ad fee, application
  fee, capped flag.
- [x] Connect webhook writes the order's fee and the ledger from Stripe's own
  application fee object, not our arithmetic. A difference corrects the order
  and alerts ops.
- [x] Webhooks idempotent (`stripe_events`) and signature-verified. Existed.
- [x] Refunds use `refund_application_fee: true`; `charge.refunded` writes
  negative ledger rows, in full and in proportion for a partial refund.
- [x] Dashboard: the fee under each order's amount, and "Fees this month" on
  Payments.
- [x] Global switch `billing_switches.fees_enabled`, off. Off, every sale pays
  nothing.
- [x] Fee waiver: the migration waives every seller who has a storefront or a
  product on the day it runs.
- [x] Checked against the simulated Stripe: a EUR 28.50 sale on Free carries a
  EUR 1.43 fee, the order and ledger agree, a full refund returns it, half a
  refund returns half, a waived seller pays nothing.
- [ ] **Not done: the same in real Stripe test mode.** Connect has still never
  talked to real Stripe. This is the plan's own "done when" for Phase 1.
- [ ] **Not done: fee ledger in the account data export.** Orders, with the
  fee each paid, are in it; the ledger's rows (refunds of fees) are not. The
  export fails whole when any read fails, so this is for after the migration
  is in production.
- [ ] **Not done: revenue reports read the ledger.** The admin panel still
  sums `orders.platform_fee_cents` (SQ-admin, a separate repo).

### Phase 2: Starter and Pro subscriptions

- [x] Plans page and billing settings show the three tiers, current plan and
  next invoice date, with every price and fee read from `plan_prices`.
- [x] Upgrade through Checkout, switch and card through the Customer Portal,
  cancel in the app. Existed; now charges the price row in force.
- [x] Subscription webhooks update `seller_billing`. Existed.
- [x] Failed renewal: past due, 7 days of grace, a banner, then Free. Existed.
- [x] Dropping to Free never takes anything down. Existed.
- [x] Upgrade hint with the saving at the seller's own last 30 days of direct
  sales. Starter pays for itself above EUR 400 a month, as the plan expects.
- [x] `hasFeature(sellerId, featureKey)` reading `plan_entitlements`, behind
  `billing_switches.entitlements_enforced` (off).
- [x] Homepage pricing section reads its numbers from `plan_prices` through
  the dashboard's public price list, and falls back to the locked numbers.
- [x] Annual billing is not offered. It starts the day yearly rows are added,
  with no code change.
- [ ] **Not done: features actually locked.** `hasFeature` gates nothing yet.
  See "Decisions needed".
- [ ] **Not done: downgrade from Pro to Starter at period end.** It switches
  at once through the portal, with Stripe's proration. Cancelling to Free is
  at period end.
- [ ] **Not done: Stripe objects.** No Products, Prices (lookup keys
  `starter_month_eur_v1`, `pro_month_eur_v1`), Stripe Tax or Portal
  configuration exist yet.
- [ ] **Not done: homepage pricing live.** It stays hidden behind the
  homepage's own launch switch.
- [ ] **Not verified: the homepage build.** A dev server was running in that
  folder, so `npm run build` was not run; lint and typecheck pass.

### Phase 3: marketplace fee

- [ ] **Not built.** Waits for the discovery feed. Ready for it: the
  marketplace rate per plan is in `plan_prices`, `computeFees` already charges
  it, and a `marketplace` channel already maps to that origin. Still to
  build: the signed `via` token, the per-product listing toggle, the origin
  badge and monthly split, showing the fee before opt-in.

### Phase 4: promoted listings

- [ ] **Not built.** `computeFees` already works out an ad fee and the order
  and ledger already have a place for it. Everything else is to build:
  promotions, placement, labelling, attribution, reports, terms.

## To switch it on

1. Apply `20261011_pricing_config.sql` to production, before deploying the app.
2. Check the waiver list it created (`seller_fee_waivers`) is who it should be.
3. Run one sale end to end in real Stripe test mode.
4. Create the Stripe Products and Prices under the two lookup keys, at the
   amounts in `plan_prices`. The app refuses a checkout whose Stripe price
   does not match the row.
5. `update public.billing_switches set fees_enabled = true;`

To change a price or a fee later:
`select public.plan_price_change('starter', 1200, 150, 700);`
(plan, price in cents, direct fee bps, marketplace fee bps). It closes the
current row and opens the next. A new price needs its Stripe Price created
first, under the lookup key the function returns.

## Decisions needed

- **The entitlement split.** As seeded, Free would lose things it has today:
  the freeform editor, custom fonts, discount codes, analytics, and all but
  one storefront (Free's limit is 3 now). Confirm before any gate is wired.
- **"Remove Square Share badge".** Dropped once already, because the badge is
  part of what keeps Square Share off merchant of record. It is seeded as a
  feature and wired to nothing.
- **Terms.** The legal pages say the fee is on "the gross sale price of each
  Artifact". Charging it on delivery too needs that sentence changed, with
  the lawyer's pass the pages are waiting for anyway.
- The plan's own open decisions stand: marketplace fee per tier, ad model and
  range, VAT display, billing entity.

## Found on the way

- A new catch-all page, `src/app/(public)/s/[...missing]/page.tsx`
  (uncommitted, from other work in progress), answers the hosted checkout
  page with a 404 on the dev stack. Two Connect tests fail with it present
  and pass without it. Not part of this work and left as it is.
- A refund from the order panel and Stripe's `charge.refunded` event can race.
  If the event wins, the order is refunded with reason "other" and the panel
  reports "not refundable" though the money went back. Older than this work.
