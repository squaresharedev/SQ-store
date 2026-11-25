# Audit F: refunds and application fees

Date: 2026-11-22. Scope: every refund path and what happens to Square Share's
application fee, measured against the owner's locked refund policy. This is
an investigation only: nothing in any repo was changed, no Stripe or Supabase
call was made, no test or server was run. Every proposed fix below changes
money flow and **needs Adrian's approval: money flow**.

Evidence standard: `file:line` with a repo prefix (Store, Admin, Home, Docs,
System). "(inferred)" marks anything not opened or not confirmed. Stripe
behaviour was checked against public docs.stripe.com pages (listed in
section 10); points those pages do not settle are marked "(unverified
against docs)".

---

## 0. Verdict in one screen

1. **There is exactly one Stripe refund call in all six repos**:
   Store `src/lib/orders/actions.ts:476-489`, and it hard-codes
   `refund_application_fee: true` (`:482`). Every seller-initiated refund
   (whole order, one line, "what is left", the MCP `refund_order` tool) goes
   through it. Today's behaviour **CONFLICTS** with the policy (keep the fee
   by default).
2. **No staff path exists**: the Admin repo has no refund, fee or Stripe code
   at all (grep for `refund|application_fee` in `Admin/src` and
   `Admin/supabase`: no matches). There is no way to refund the fee for the
   three exception cases.
3. **Disputes**: only `charge.dispute.created` is handled (it marks the order
   `disputed` and rings the bell). `charge.dispute.closed` is not subscribed,
   so a won or lost dispute is never recorded and nothing records disputes
   per seller.
4. **The fee ledger assumes the fee reverses** (comments, entry kinds, tests),
   but by construction it already gives the right numbers for a KEPT fee:
   when Stripe returns nothing, no negative row is written. There is no
   explicit "retained" record anywhere.
5. **The seller never sees a kept fee.** The refunded order's money ledger
   shows the fee line and "Refunded: {whole amount}", built on the comment
   "A refund sends the whole payment back, our fee included" (Store
   `src/components/orders/OrderDetail.tsx:195-196`).
6. **Where the policy is written**: the Docs pricing page promises the
   opposite ("A refund returns it", en and cs). The Terms defer to "the
   then-current fee policy shown in your Dashboard", which does not exist.
   Home's pricing section and Store's /plans page say nothing.
7. **Exposure today is nil (inferred)**: Stripe Connect is behind a build-time
   switch that the code says has never been set ("has never talked to the
   real one", Store `src/lib/payments/availability.ts:26-28`), and
   `billing_switches.fees_enabled` ships off (Store
   `supabase/migrations/20261011_pricing_config.sql:384`). Production values
   were not queried. So this can all be fixed before launch, with no
   historic refunds to migrate.

---

## 1. Every refund path, end to end

### 1.1 The one Stripe call: `refundWithProvider`

Store `src/lib/orders/actions.ts:459-501`.

```ts
// actions.ts:476-489
await stripeRequest<StripeRefund>(
  "POST",
  "/refunds",
  {
    payment_intent: paymentRef,
    // Our fee goes back in proportion with the part (Stripe works it out).
    refund_application_fee: true,
    ...(part ? { amount: part.amountCents } : {}),
  },
  {
    account: paymentAccount.stripeAccountId,
    idempotencyKey: part ? `refund_${orderId}_${part.lineKey}` : `refund_${orderId}`,
  },
);
```

- Endpoint: `POST /v1/refunds`, on the seller's connected account (the
  `Stripe-Account` header is set from `options.account`, Store
  `src/lib/billing/stripe-api.ts:240`). Correct for a direct charge.
- `refund_application_fee: true`, always. No `reverse_transfer` (correct:
  that is for destination charges). No `reason`, no `metadata`.
- Idempotency key: `refund_<orderId>` for "everything left", or
  `refund_<orderId>_<lineId|first>` for one line.
- Stated intent, `actions.ts:455-457`: "The whole payment, and our fee with
  it (`refund_application_fee`): a seller is not charged a fee on a sale that
  did not stand."
- A non-provider order (no `pi_` reference) never reaches Stripe:
  `if (!paymentRef || !isProviderPayment(paymentRef)) return true;`
  (`:468`). `PROVIDER_PAYMENT_PREFIX = "pi_"` (Store
  `src/lib/orders/queries.ts:173`).
- `charge_already_refunded` from Stripe is treated as success (`:494`); any
  other error returns false and nothing is recorded (`:495-499`).
- A seller with no connected-account row is refused (`:470-474`).

### 1.2 Seller refunds the whole order: `refundOrder`

Store `src/lib/orders/actions.ts:231-289`, called by the refund form
(`src/components/orders/OrderRefund.tsx:137`) and the MCP tool (1.5).

| Step | Evidence |
| --- | --- |
| Session, role `orders.refund` (owner only), rate limit 60/hour | `actions.ts:236-243`; owner list `src/lib/team/permissions.ts:49-60` (`"orders.refund"` at `:58`); comment "giving money back is the owner's decision" `:36-37`; budget `src/lib/rate-limit.ts:289` |
| 2FA | No per-action step-up (no `checkStepUp`/`requireStepUpState` in `actions.ts`). Session-level only: the pre-check reads `orders` through the seller's session, and `orders` carries the restrictive "Require two-factor when enrolled" policy (`supabase/migrations/20260923_two_factor_auth.sql:77-107`, `'orders'` at `:82`), so an aal1 session of an enrolled account reads nothing and gets "not found" |
| Pre-check: this store, status `paid`, payment ref | `actions.ts:256-266`; `if (preRow.status !== "paid") return failure(NOT_REFUNDABLE);` (`:265`) |
| Money first, then record | `refundWhatIsLeft` (`:268-274`, body `:422-443`): Stripe (1.1) first, then `order_apply_refund` via service role for a provider order, or the seller-callable `order_refund` RPC for a non-provider one (`:430-432`) |
| Fee ledger | Provider order: nothing here, the webhook writes it (`:438-441`). Non-provider: `reverseOrderFees` (`:441`) |
| Buyer email | `emailBuyerRefund` (`:284`, `:508-547`), `manual: !isProviderPayment(paymentRef)` (`:541`) |

Non-provider orders: the doc comment says it plainly, "UNTIL A PAYMENT
PROVIDER IS CONNECTED THIS RECORDS A REFUND; IT DOES NOT MAKE ONE. The seller
pays the buyer back themselves" (`actions.ts:226-229`). In a deployed build
the only non-provider order writer is the dev-only test provider
(`src/lib/checkout/provider.ts:9-11`, `:102`) and the dev simulator
(`src/lib/dev/simulated-sale.ts:139`), so in production every refundable
order is a `pi_` order once Connect is on (inferred).

### 1.3 Seller refunds one line: `refundOrderLine`

Store `src/lib/orders/actions.ts:302-406` (cart orders, add-on lines).

- Same authz as 1.2 (`:308-315`), same pre-check (`:327-336`).
- What the line gives back is the database's answer,
  `order_line_refund_amount` (`:341-349`; SQL
  `supabase/migrations/20261120_shopping_cart.sql:396-443`): the line's own
  amount, or "everything left, delivery too" for the last line standing
  (`:434-440`).
- Money first: `refundWithProvider(..., { amountCents: owed, lineKey })`
  (`actions.ts:352-357`), so a partial `POST /v1/refunds` with
  `amount` and `refund_application_fee: true`.
- Then `order_apply_line_refund` (service role, `actions.ts:359-365`; SQL
  `20261120_shopping_cart.sql:445-558`), which inserts into
  `order_line_refunds` and flips the order to `refunded` once every line is
  back.
- `rest` outcome (two lines refunded at once, delivery left behind): falls
  through to `refundWhatIsLeft`, with the comment "What is left goes back as
  the whole order's refund (which also gives back our fee)" (`:374-388`).
- Non-provider: `reverseOrderFees` or `reverseOrderFeesShare` (`:389-394`).
- Buyer is emailed only when the whole order ends refunded (`:399-401`).
- Note: per the project memory the `20261120` cart migration is not in
  production yet (unverified). Without it this path fails at the
  `order_line_refund_amount` RPC with a server error, before any money moves.

### 1.4 "Refund what is left": `refundWhatIsLeft`

Internal helper, `actions.ts:422-443`. Used by 1.2 and by the `rest` branch of
1.3. Stripe call has no `amount`, so Stripe refunds whatever remains on the
charge; key `refund_<orderId>`; `refund_application_fee: true`.

### 1.5 MCP tool `refund_order`

Store `src/lib/agent/tools/orders.ts:103-120`: scope `orders:refund`,
permission `orders.refund`, handler `unwrap(await refundOrder(id, reason,
restock))` (`:117`). The scope is opt-in ("Always starts unticked",
`src/lib/agent/scopes.ts:24-27`, `"orders:refund": {... optIn: true}`
`:82-87`). Agent JWTs are minted at `aal2` (`src/lib/agent/mint.ts:13-17`,
`:74`). There is no MCP tool for a line refund. Same Stripe request as 1.1.

### 1.6 The client-callable `order_refund` RPC

Store `supabase/migrations/20261021_order_refund_provider_first.sql:21-59`.
Self-gated (2FA bar `:35-37`, owner or `orders.refund` `:43-49`) and refuses
any provider order: `if ref like 'pi\_%' then return 'not_refundable';`
(`:53-55`). So a seller calling it through PostgREST can only mark a
non-provider order refunded. No money, no fee.

### 1.7 Webhook: `charge.refunded` (refunds made anywhere)

Store `src/lib/payments/connect/webhook.ts:229-250`. Subscribed types
`:42-48` (`checkout.session.completed`, `checkout.session.expired`,
`account.updated`, `charge.refunded`, `charge.dispute.created`).

- Order found by `payment_ref` AND the seller who owns the connected account
  (`:86-95`, contract `:10-15`).
- Fee: `const feeId = text(object.application_fee); if (feeId) await
  recordChargeFeeRefunds(order.id, feeId);` (`:237-238`), see section 3.
- Order: changes only on a full refund (`object.refunded !== true` returns
  "partial refund", `:242`), then `order_apply_refund` with reason `"other"`,
  no restock (`:243-247`). The return value is not checked: a `disputed`
  order refunded in Stripe answers `not_refundable` and the event is still
  closed as "refund recorded" (inferred from `:243-249` and
  `20261028_product_add_ons.sql:467-469`).
- The comment at `:234-236` claims "Our fee went back with the money, in the
  same proportion, whoever made the refund". Stripe's docs say the opposite
  for refunds made without the flag (section 7.5).

### 1.8 Buyer withdrawal (CRD art. 11a)

Store `src/app/api/orders/withdraw/route.ts:18-36`, `:74-82`. It **records
only**: sets `orders.withdrawal_requested_at` once, tells the seller (bell and
email) and acknowledges to the buyer. "What happens next (the return, the
refund) is between buyer and seller ... Square Share records the withdrawal
and delivers it, and is not a party to the sale" (`:33-35`). No refund, no
Stripe call. The order panel then shows "The buyer cancelled this purchase on
{date}. Arrange the return and issue the refund within 14 days." (Store
`messages/en/orders.json:125`). The seller refunds through 1.2/1.3, so the
fee policy applies to withdrawals too.

### 1.9 Order cancellation

There is no separate cancel path. "Cancelled before sending" is a refund
reason (`messages/en/orders.json:180`) on 1.2/1.3. An unpaid checkout the
buyer backs out of is expired, not refunded: Store
`src/app/api/checkout/cancel/route.ts:69-70` (`POST
/checkout/sessions/{id}/expire`, then `releasePendingOrder`).

### 1.10 Automatic refunds

None. Every mismatch alerts a person instead of refunding:

- Payment for no order, or for another store's order: `alertOps`, no refund
  (`webhook.ts:185-193`).
- Amount mismatch: `alertOps`, order left pending to expire (`:198-207`).
- Stock race: refused by the order writer before any charge (`record.ts`
  `reason: ... "sold_out"`, Store `src/lib/orders/record.ts:170-175`;
  `src/lib/checkout/stripe-provider.ts:85-86`).
- Pending hold (45 min) outlives the payment page (31 min), "so a payment can
  never land on an order already released" (`record.ts:177-180`,
  `stripe-provider.ts:55-58`).
- Failed fulfilment: no automatic refund anywhere (grep for `/refunds` across
  all repos finds only `actions.ts:478`).

### 1.11 Admin-initiated

None. Admin has moderation actions (`Admin/src/app/(app)/moderation/
[targetType]/[targetId]/actions.ts`, writing `moderation_decisions` at `:282`)
and plan grants, but no order, refund or fee action and no Stripe client.
Removing an illegal listing never touches its orders or their fees.

### 1.12 Summary of who can move money

| Path | Entry | Who | Stripe call | Recorded when |
| --- | --- | --- | --- | --- |
| Whole order | `refundOrder` | owner, session (2FA if enrolled), 60/h | 1.1, no amount | after Stripe succeeds |
| One line | `refundOrderLine` | same | 1.1, `amount` = line | after Stripe succeeds |
| What is left | `refundWhatIsLeft` | internal | 1.1, no amount | after Stripe succeeds |
| MCP | `refund_order` | owner's agent, opt-in scope, aal2 | 1.1 via `refundOrder` | same |
| PostgREST | `order_refund` | owner | none (refuses `pi_`) | at once |
| Elsewhere (Stripe/Express Dashboard) | `charge.refunded` | whoever refunded | none (reads fee) | on the event |
| Withdrawal | `/api/orders/withdraw` | buyer | none | records the request only |
| Admin | none | none | none | none |

---

## 2. `refund_application_fee` per path, and the verdict

| Path | Value today | Evidence |
| --- | --- | --- |
| Whole order (seller, MCP) | `true` | `actions.ts:427` -> `:482` |
| One line | `true` (proportional) | `actions.ts:354` -> `:482` |
| What is left (incl. `rest`) | `true` | `actions.ts:378-384`, `:427` -> `:482` |
| Non-provider (test provider, simulator) | no Stripe call; fee reversed in our ledger anyway (`reverseOrderFees`, `reverseOrderFeesShare`) | `actions.ts:389-394`, `:441` |
| Refund in Stripe's or the Express Dashboard | not ours to set; Stripe default is to keep the fee (section 7.5); our webhook records whatever fee refunds Stripe reports | `webhook.ts:237-238` |
| Staff fee refund | does not exist | section 1.11 |

**Verdict: today's behaviour does not match the locked policy.** Every refund
a seller makes from Square Share returns the fee in full or in proportion; the
policy wants it kept unless one of three exceptions applies, and none of the
three has a mechanism. It also contradicts itself: a seller who refunds from
the Express Dashboard instead of the order panel keeps paying the fee
(inferred from Stripe's default, see 7.5), so the outcome depends on which
button was pressed.

---

## 3. The fee ledger on a refund

### 3.1 Shape

Store `supabase/migrations/20261011_pricing_config.sql:533-555`. Insert-only,
one signed row per movement, idempotent on `entry_key`. Kinds
`platform_fee`, `ad_fee`, `platform_fee_refund`, `ad_fee_refund` (`:73`;
mirrored in Store `src/lib/pricing/enums.ts:44` and System
`packages/pricing/src/enums.ts:44`). Sign check:

```sql
-- 20261011_pricing_config.sql:548-550
constraint fee_ledger_amount_sign check (
  (kind in ('platform_fee', 'ad_fee') and amount_cents > 0)
  or (kind in ('platform_fee_refund', 'ad_fee_refund') and amount_cents < 0)),
```

Writes go only through `fee_ledger_record` (service role, seller and currency
taken from the order, `:589-625`). The store's team may read its own rows
(`:572-578`), so a seller-facing "fee kept" figure can be read from it.

### 3.2 Rows written on the sale

- Provider order: after the payment is confirmed, `settleOrderFees` reads
  Stripe's application fee OBJECT on the platform account (Store
  `src/lib/payments/connect/fees.ts:37-41`, `:51-100`), corrects the order if
  Stripe collected a different amount (`:79-97`: `alertOps`, then
  `platform_fee_cents`, `ad_fee_cents`, `application_fee_cents` set to what
  was collected, ad fee giving way first), then writes
  `<order>:platform_fee` / `<order>:ad_fee` with the `fee_...` id (`:99`;
  Store `src/lib/billing/fee-ledger.ts:73-78`).
- Non-provider order: `recordPaidOrder` writes the same rows from the order's
  own columns at once (Store `src/lib/orders/record.ts:274-282`).
- A zero part writes nothing: `if (amountCents === 0) return;`
  (`fee-ledger.ts:44`).

### 3.3 Rows written on a refund

- Provider order, from Stripe's `charge.refunded`: `recordChargeFeeRefunds`
  reads the fee object, returns early if nothing was refunded
  (`if (fee.amount_refunded <= 0) return 0;`, `fees.ts:109`), lists up to 100
  application fee refunds (`:112-116`) and writes each as negative rows keyed
  on Stripe's `fr_...` id (`:117-119`), split between platform and ad fee in
  the proportion charged (`splitFeeRefund`, Store
  `src/lib/pricing/fees.ts:140-151`; `fee-ledger.ts:85-95`). Amounts are
  Stripe's, signs negative.
- Non-provider order: `reverseOrderFees` writes `-standing` for each fee
  (`fee-ledger.ts:104-115`); `reverseOrderFeesShare` writes
  `-(charged x refunded / order amount)`, rounded DOWN in BigInt and capped at
  what is standing, keyed per line (`:125-142`). Both swallow errors
  ("Best-effort and never throws").
- The order's own fee columns are NOT changed by a refund:
  `recordChargeFeeRefunds` writes no order column. The order view keeps
  showing the charged fee (`platformFeeCents: Number(row.platform_fee_cents
  ?? 0)`, Store `src/lib/orders/queries.ts:86`).

### 3.4 Partial refunds

Stripe returns "a proportional amount of the application fee" when the flag is
true and the refund is partial, and the entire fee once the whole charge is
refunded (section 7.2). The ledger follows Stripe's `fr_` amounts. The e2e
suite pins this: half a EUR 28.50 payment refunded gives
`["platform_fee", 143], ["platform_fee_refund", -72]`, the rest gives a
second `-71` (Store `tests/e2e/87-stripe-connect.spec.ts:660-682`). Our own
non-provider share rounds down (`fee-ledger.ts:134`) while the simulated
Stripe rounds to nearest (`tests/e2e/stripe-mock.ts:210`); Stripe's real
rounding is (unverified against docs). Only dev orders use our share.

### 3.5 What the ledger looks like if the fee is KEPT

With `refund_application_fee: false`, Stripe's fee object keeps
`amount_refunded = 0`, so `recordChargeFeeRefunds` returns at `fees.ts:109`
and writes nothing. The ledger then holds only the positive
`<order>:platform_fee` row, which is the correct record of money Square Share
kept. Nothing needs to change for the numbers to be right.

What is missing is an explicit record that the fee was retained on a refund:

- No entry kind for it (four kinds, `enums.ts:44`), and the sign check plus
  `if (amountCents === 0) return;` rule out a zero or positive "refund" marker
  row.
- No order column (e.g. `fee_returned_cents` or `fee_kept_cents`).
- So "kept" can only be derived: order `refunded` (or line in
  `order_line_refunds`) AND ledger net for the order > 0.
- The assumption that the fee reverses is written into the header comments
  (`fees.ts:12-15`: "A REFUND returns our fee in the same proportion as the
  payment (`refund_application_fee: true`, wherever the refund was made)";
  `fee-ledger.ts:11-22`), the webhook (`webhook.ts:234-236`), the actions
  (`actions.ts:376-377`, `:438-440`, `:455-457`), the order panel
  (`OrderDetail.tsx:195-196`), test names (`87-stripe-connect.spec.ts:410`,
  `:654`), and the build log (Store `docs/pricing-build-status.md:78-79`,
  `:86-88`).

### 3.6 Seller net figures across the product

| Surface | How it treats a refund today | Under KEEP |
| --- | --- | --- |
| Order panel money ledger | Fee line, then "Refunded: {whole amount}" for a refunded order; "You receive" = amount - fee for a paid one, ignoring line refunds (`OrderDetail.tsx:198`, `:455-482`) | Silent about the kept fee; seller's real outcome is -fee (before Stripe's processing fee) |
| Orders CSV | `platform_fee`, `after_platform_fee` = amount - fee, `status`; no refunded amount or fee-returned column (Store `src/lib/orders/csv.ts:37-61`, `:77-80`) | Ambiguous: a refunded row still says `after_platform_fee` = amount - fee |
| Account data export | `platform_fee_cents, ..., refunded_at, refund_reason`, no ledger rows (Store `src/app/settings/export/route.ts:61-66`; gap noted in `docs/pricing-build-status.md:91-94`) | Kept fee derivable only by the reader |
| Analytics | `fees_cents` = sum of `platform_fee_cents` over PAID orders; refunded orders excluded from revenue and fees; line refunds reduce revenue but not fees (`20261120_shopping_cart.sql:837-880`; net = revenue - fees, Store `src/lib/analytics/queries.ts:285-286`) | A kept fee on a refunded order is a real cost the analytics never show |
| Payments, "Fees this month" | Ledger net per month (`fee-ledger.ts:184-206`, SQL `20261011_pricing_config.sql:639-660`), hint "Square Share's cut of your sales, after refunds" (Store `messages/en/payments.json:25`) | Correct figure by construction; the hint implies refunds reduce it |
| Payments, balance and history | Stripe balance transactions on the connected account; type map has no `application_fee` entries, anything unknown becomes "adjustment" (Store `src/lib/payments/connect/overview.ts:108-124`) | Which types Stripe puts on the connected account for a kept or refunded fee: (unverified against docs) |
| Upgrade hint (`billing_sales_30d`) | PAID orders only (`20261011_pricing_config.sql:676-693`) | Kept fees on refunded orders not counted (minor) |
| Admin revenue | `sum(o.platform_fee_cents)` where `status = 'paid'` (Admin `supabase/migrations/0008_plans_revenue.sql:46-53`) | Undercounts Square Share's revenue by every kept fee. Side finding: the live-only filter is `checkout_session_id like 'cs\_live\_%'` (`:53`) but Connect orders carry ids minted as `cs_ss_...` (Store `src/lib/checkout/stripe-provider.ts:53`, `:62-64`), so "live only" would count no Connect sale at all |

---

## 4. What the seller and the buyer see

### 4.1 Refund form

Component: Store `src/components/orders/OrderRefund.tsx:48-218`. Namespace
`Orders.refund` in `messages/<locale>/orders.json` (10 locales: en, cs, de,
es, fr, it, nl, pl, pt-PT, sk).

- First line of the form, kept on screen (`:171-177`): `itemHow` for one line,
  else `viaProvider` or `manual`.
  - `viaProvider`: "Refunds the whole order, {amount}, to the buyer's card
    through Stripe. This can't be undone." (`messages/en/orders.json:177`)
  - `itemHow`: "Gives back what this item cost. The last item left takes the
    delivery back with it." (`:171`)
  - `manual`: "This payment didn't go through Square Share. Pay the buyer back
    the whole {amount} yourself, then record it here." (`:176`)
- Buttons: `confirmProvider` "Refund {amount}", `confirm` "Record refund of
  {amount}", `confirmItem` "Refund this item" (`:173`, `:185-186`;
  component `:199-202`).
- Toasts: "Refund sent." / "Refund recorded." / "Item refunded" (`:174`,
  `:187-188`; component `:142`).
- Refusal: "Stripe couldn't make this refund." / "Nothing was changed. Try
  again in a moment, or make the refund from your Stripe dashboard." (Store
  `messages/en/errors.json:665-667`).

**Nothing in the form mentions Square Share's fee**, in either direction.

### 4.2 Order panel money ledger

Store `src/components/orders/OrderDetail.tsx:422-484`.

```tsx
// OrderDetail.tsx:195-198
// A refund sends the whole payment back, our fee included, so a refunded
// order's last line is what went back, not money the seller still has.
const refunded = order.status === "refunded";
const youReceiveCents = order.amountCents - order.platformFeeCents;
```

Lines: `detail.amount` "Amount", optional discount, `detail.platformFeeRate`
"Platform fee ({rate})" or `detail.platformFee` "Platform fee", then either
`status.refunded` "Refunded" with the whole amount (`:468-471`) or
`detail.youReceive` "You receive" with hint `detail.youReceiveHint` "Before
Stripe's card fee" (`:475-481`). Keys: `messages/en/orders.json:87-90`,
`:142`, `:13`. A line refunded on its own gets a "Refunded" badge
(`RefundedMark`, `:516-524`, key `refund.lineRefunded`) but the money ledger
does not change.

**A kept fee is shown nowhere**: not in the panel, the form, the toast, the
CSV, the export or analytics. Only the Payments "Fees this month" tile would
silently include it.

### 4.3 What the buyer sees

- Refund email (`email.refund`, `messages/en/orders.json:268-273`): "Refunded:
  {amount}" with the order's whole amount (`actions.ts:538`), and "It goes back
  the way you paid, which usually takes 5 to 10 days." A single line's refund
  sends no email (`actions.ts:399-401`).
- Order page: "Refunded", "{seller} refunded this order on {date}." (Store
  `messages/en/productPage.json:348-350`).
- The buyer never sees the fee. That is correct under either policy: with
  `refund_application_fee: false` the buyer still receives the full refund
  amount; only the seller's balance absorbs the kept fee (Stripe:
  "the connected account ... loses that amount", section 7.2).

---

## 5. Disputes

- **Handled**: `charge.dispute.created` only (`webhook.ts:42-48`,
  `:252-277`): order `paid` -> `disputed`, one bell notification
  (`Notifications.messages.payment.dispute.*`). The panel then says "The
  buyer's bank opened a dispute. Answer it in your Stripe dashboard before its
  deadline, or the buyer gets the money back." (`messages/en/orders.json:159`;
  `src/components/orders/OrderActions.tsx:40-41`, `:64`, `:76-93`).
- **Not handled**: `charge.dispute.closed`, `charge.dispute.updated`,
  `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`. A
  dispute won or lost leaves the order `disputed` forever. A disputed order
  cannot be refunded from the panel (`status !== "paid"`, `actions.ts:265`).
- **Per-seller record**: none. No dispute table in any migration (grep
  `dispute` in Store `supabase/migrations`: only analytics counts and demo
  data); only `orders.status = 'disputed'` and the analytics
  `disputed_count`.
- **Who bears what under direct charges** (verified against docs):
  - Disputed amount: "Stripe always attempts to debit disputed amounts from
    the connected account's balance. However, if Stripe can't debit the
    amount, ultimate responsibility depends on whether Stripe or the platform
    is responsible for negative balances."
  - Application fee: "Regardless of a dispute's outcome, Stripe doesn't
    automatically refund the application fee to the connected account. To
    return some or all of the application fee on a disputed charge, refund it
    from your platform account."
  - Dispute fee: for legacy Express accounts (`controller.fees.payer =
    application_express`) the payer is the connected account.
  - Accounts here are created as legacy Express: `type: "express"` (Store
    `src/lib/payments/connect/account.ts:153-163`). For legacy Express the
    platform is normally liable for negative balances (inferred: the
    risk-management page explains how to read `controller.losses.payments`
    but I did not find a sentence naming legacy Express; read it off a test
    account).
- **Side finding (decision for Adrian)**: Stripe's fee-payer page says of
  `application_express` "We don't recommend using direct charges with this
  legacy setting. Use destination charges instead." This integration is
  exactly that combination. It decides who pays dispute fees and who carries
  a seller's negative balance, which is where "a dispute lost because of us"
  would bite.
- **Terms**: "Chargebacks, disputes, reversals, related fees, and any
  resulting negative balance are the Seller's responsibility ... Square Share
  does not fund refunds or chargebacks" (Home
  `src/content/legal/terms/tos-2026-11-06.ts:427`).

---

## 6. Fee waivers and switches

- `fees_enabled` ships off and a read failure reads as all off (Store
  `src/lib/billing/switches.ts:2-15`, `:26`, `:35`, `:41-43`). Off, the sale
  fee is `noSaleFee(plan)` (`src/lib/billing/sale-fee.ts:53-67`), "the order
  then says truthfully that it was charged 0".
- A waived seller gets all zeros from `computeFees` (Store
  `src/lib/pricing/fees.ts:83-92`).
- With a zero fee the checkout omits `application_fee_amount`: "Left out when
  nothing is owed (a waived seller, fees switched off): Stripe then creates no
  fee object at all" (`src/lib/checkout/stripe-provider.ts:157-159`). The
  webhook then finds no `application_fee` on the charge and writes no ledger
  rows (`webhook.ts:237-238`; `fees.ts:73-75`, `:99`).
- On refund today, `refund_application_fee: true` is still sent for such a
  charge; whether Stripe ignores or rejects the flag on a charge with no
  application fee is (unverified against docs). The e2e mock does not model
  it.
- Under KEEP there is nothing to keep: the panel must hide a "fee kept" line
  when the order's fee is 0.
- The fee is snapshotted at checkout (`sale-fee.ts:1-15`), so a waiver added
  later does not change an earlier sale: that sale still has a fee to keep
  (inferred from the snapshot design).

---

## 7. Edge cases the policy change creates

### 7.1 Fee base includes delivery; line refunds do not

"The base is the whole amount the buyer pays, delivery included" (Store
`src/lib/pricing/fees.ts:18`). A line refund gives back the line's amount,
and only the last line takes delivery (`20261120_shopping_cart.sql:420-440`).
Under KEEP the seller keeps paying the fee on delivery even when the whole
order is refunded. For staff exceptions on one line, the fee share would be
`refundedFeeCents(fee, orderAmount, lineAmount)` (`pricing/fees.ts:127-133`),
or Stripe's own figure if done through `refund_application_fee`.

### 7.2 Stripe's partial-refund semantics (verified against docs)

- "Application fees aren't automatically refunded when issuing a refund. Your
  platform must explicitly refund the application fee or the connected
  account (...) loses that amount."
- With the flag true: "If the refund results in the entire charge being
  refunded, the entire application fee is refunded. Otherwise, a proportional
  amount of the application fee is refunded." Example from the SaaS guide:
  "refunding 40 USD of a 100 USD payment with a 5 USD application fee returns
  2 USD of the application fee."
- With the flag false (or omitted): the platform keeps 100% of the fee on a
  partial or full refund, and can "refund the application fee separately".
- So KEEP is Stripe's default; the change is to stop asking for the refund.

### 7.3 Idempotency if a refund is retried with a different flag (verified)

Stripe "compares incoming parameters to those of the original request and
errors if they're not the same", and keys may be pruned "after they're at
least 24 hours old". Today's keys (`refund_<order>`, `refund_<order>_<line>`)
carry no flag. A retry that crosses the deploy within 24 hours with the same
key and a different `refund_application_fee` gets an idempotency error, which
`refundWithProvider` maps to a refusal (`actions.ts:495-499`): safe (nothing
recorded) but confusing. Since Connect has never been live (inferred), there
are no old keys in production; still, putting the policy into the key (e.g.
`refund_keep_<order>`) makes the two impossible to confuse.

Pre-existing, not caused by the policy: if Stripe refunded a line and
`order_apply_line_refund` then failed (`actions.ts:366-369`), a retry more
than 24 hours later finds no `order_line_refunds` row, gets the same amount
from `order_line_refund_amount`, and Stripe (key pruned) may refund that
line a second time (inferred).

### 7.4 Panel and webhook race (pre-existing)

Logged in Store `docs/pricing-build-status.md:178-180` and still present: if
`charge.refunded` lands first, `order_apply_refund` records reason `other`,
and the panel's own `order_apply_refund` answers `not_refundable`
(`actions.ts:275-278`), so the seller is told "This order can't be refunded"
though the money went back.

### 7.5 Refunds made in the Express Dashboard

Express accounts can issue refunds in the Express Dashboard (SaaS guide:
"Connected accounts with access to the Express Dashboard can issue refunds and
respond to disputes there"). Stripe's stated default keeps the fee, so those
refunds would already follow the policy (whether the Express Dashboard offers
a "refund fee" option is (unverified against docs)). Our webhook comment
claims otherwise (`webhook.ts:234-236`), and the e2e simulator refunds the fee
on every dashboard refund: `applyRefund(session, amountCents ?? null, true)`
(Store `tests/e2e/stripe-mock.ts:523-528`), so the suite encodes an
assumption that is probably wrong.

### 7.6 The three exceptions, and the mechanism staff would need

| Exception | What exists | What it needs |
| --- | --- | --- |
| (1) Illegal or fraudulent sale, removed | Moderation decisions in Admin (`moderation_decisions`, Store `supabase/migrations/20260926_moderation_decisions_and_appeals.sql:40`) with no link to orders or fees | Staff fee refund tied to a decision id |
| (2) Our fault (bug, double charge, broken checkout) | Double charge is guarded by checkout idempotency (`checkout_<id>`, `stripe-provider.ts:167`); amount mismatch alerts (`webhook.ts:198-207`) | Same staff action, reason "platform fault", free text and ops alert link |
| (3) Dispute lost because of us | Nothing records the outcome (section 5) | `charge.dispute.closed` handling, then the staff action with reason "dispute lost, platform fault" |

**Stripe mechanism (verified)**: Create an application fee refund,
`POST /v1/application_fees/{fee_id}/refunds`, optional `amount` and
`metadata`. "You can optionally refund only part of an application fee. You
can do so multiple times, until the entire fee has been refunded." It "will
raise an error when called on an already-refunded application fee, or when
trying to refund more money than is left". It is made "with your platform's
secret key with `application_fee_write` permission on the platform account,
without the `Stripe-Account` header". Funds "will be refunded to the Stripe
account from which the fee was originally collected" (the seller's).

How it would reach our books: the fee id is already stored per ledger row
(`stripe_application_fee_id`, `20261011_pricing_config.sql:541-543`). A
standalone fee refund does not fire `charge.refunded`; it would be a platform
event (`application_fee.refunded`, inferred), which the Connect webhook drops
("platform event, not a sale", `webhook.ts:126`) and Billing's webhook does
not handle (Store `src/lib/billing/webhook.ts:90` only rejects Connect events;
handled types not listed here). So the staff action must write the ledger
itself from the returned `fr_...` object via `recordFeeRefund(orderId, fr.id,
amount, source)`, which is idempotent on the `fr_` id; a later
`charge.refunded` for the same fee would list it again and write nothing twice
(`fees.ts:112-119`).

### 7.7 Does the platform need a balance?

A fee refund is made on the platform account and returns money already
collected, so it comes out of the platform's Stripe balance (inferred from
"refunded to the Stripe account from which the fee was originally collected"
and "on the platform account"). What happens with an insufficient platform
balance (pending, negative balance, or error) is (unverified against docs).
The key permissions listed for the platform key mention "Accounts, Account
Links, Checkout Sessions and Refunds on connected accounts" only (Store
`src/lib/payments/connect/config.ts:11-16`); a restricted key would also need
application fee read (already used by `fees.ts:39-41`) and, for staff
refunds, `application_fee_write`.

### 7.8 Other edges

- A disputed order cannot be refunded by the seller (`actions.ts:265`), but
  exception (3) must be able to refund the fee on a `disputed` order.
- Express Dashboard refunds after a staff fee refund: `recordChargeFeeRefunds`
  lists all fee refunds and would record both, once each.
- `charge.refunded` reads only the first 100 fee refunds (`fees.ts:34-35`,
  `:112-116`): fine in practice.

---

## 8. Where the policy is (and is not) stated

| Place | What it says | Status |
| --- | --- | --- |
| Seller Terms, all three versions | "**Fee on refund.** Where a sale is refunded, the platform fee is handled in accordance with the then-current fee policy shown in your Dashboard." (Home `src/content/legal/terms/tos-2026-11-06.ts:426`; same at `tos-2026-10-31.ts:426`, `tos-2026-10-11.ts:311`). Section 9 opens "Card payments, paid plans and per-sale fees are not switched on yet" (`tos-2026-11-06.ts:340`); fee "collected automatically as a Stripe Connect application fee at the time of sale" (`:387`) | Partial: defers to a Dashboard policy that does not exist. Versions in force are tracked in Store `src/lib/legal/terms-versions.ts:28-34`. A change means a NEW version (Store `docs/changing-the-terms.md`, CLAUDE.md "Changing the Terms of Service") |
| Home pricing section | "The fee is taken from what the buyer pays, delivery included. Card processing by Stripe is charged separately." (Home `src/components/PricingSection.tsx:91-93`); figures in `src/content/pricing.ts:40-58` | Missing |
| Store /plans | FAQ "What is the per-sale fee charged on?" "On everything the buyer pays for each sale made through Square Share checkout, delivery included. Stripe's own card processing fees are separate." (Store `messages/en/billing.json:138-141`); nothing on refunds | Missing |
| Docs pricing (en) | "**A refund returns it.** Refund a checkout sale and SquareShare's share goes back too: all of it for a full refund, the same proportion for a partial one." (Docs `content/docs/en/pricing/index.mdx:80`) | **CONFLICTS** |
| Docs pricing (cs) | "Při vrácení peněz se vrací. Když vrátíte peníze za prodej přes pokladnu, vrátí se i podíl SquareShare..." (Docs `content/docs/cs/ceny/index.mdx:81`) | **CONFLICTS** |
| Docs refunds (en, cs) | "Confirm. The whole order is refunded to the buyer's card through Stripe" and "Refunds will cover the whole order." (Docs `content/docs/en/payments-and-payouts/refunds.mdx:36`, `:40`); nothing on the fee | Missing, and stale on line refunds |
| Docs payments | Fee and Stripe fee, nothing on refunds (Docs `content/docs/en/payments-and-payouts/index.mdx:20-28`) | Missing |
| Store refund form | No fee wording (section 4.1) | Missing |

Prices match the policy: seed rows Free 0 + 500 bps, Starter 1200 + 200 bps,
Pro 3900 + 50 bps (Store `supabase/migrations/20261011_pricing_config.sql:
288-290`). Not in the policy but in the code: marketplace rates 800/700/600
bps and an ad fee, both unbuilt surfaces (`:288-290`;
`docs/pricing-build-status.md:128-140`).

---

## 9. Gap table, change set, questions

Every row: **needs Adrian's approval: money flow**.

| # | Requirement | Status | Evidence | Proposed fix (smallest reviewable change) |
| --- | --- | --- | --- | --- |
| G1 | Keep the fee by default on every seller refund | **CONFLICTS** | `actions.ts:482`, comments `:376-377`, `:438-441`, `:455-457`; non-provider reversal `:389-394`, `:441` | Pass `refund_application_fee: false` explicitly; key `refund_keep_<order>[_<line>]`; drop the two non-provider reversals so dev mirrors prod; reword comments in `actions.ts`, `fees.ts:12-15`, `fee-ledger.ts:11-22`, `webhook.ts:234-236`. Tests: `tests/e2e/87-stripe-connect.spec.ts:410-460` (expects `true` and `-143`), `:654-692`; `tests/e2e/stripe-mock.ts:201-216`, `:346-362`, `:523-528` (dashboard refund keeps the fee); `tests/component/order-detail-ledger.test.tsx:7-9`, `:37-40`; `docs/pricing-build-status.md:78-79`, `:86-88` |
| G2 | Show the kept fee on the refund line | Missing | `OrderDetail.tsx:195-198`, `:455-482` | Add `feeReturnedCents` (or `feeStandingCents`) to `OrderView`, read from `fee_ledger` (seller RLS allows it, `20261011:572-578`); in the refunded branch show "Platform fee, not refunded {fee}" and "Refunded to the buyer {amount}"; hide when the fee is 0. New keys under `Orders.detail` in 10 `messages/*/orders.json`. Tests: `order-detail-ledger.test.tsx`, `tests/setup/order-view.ts`, `order-seller-flow.test.tsx` |
| G3 | Refund form tells the seller before they press | Missing | `OrderRefund.tsx:171-177`; keys `orders.json:171`, `:177` | One sentence key, e.g. `Orders.refund.feeKept` "Square Share's {fee} fee is not refunded.", shown when the fee > 0 |
| G4 | Ledger records retention explicitly | Partial (implicit) | `fees.ts:109`; kinds `enums.ts:44`; sign check `20261011:548-550` | No ledger schema change: derive "kept" as order refunded and ledger net > 0. Optional SQL view `order_fee_standing` for UI, CSV and Admin |
| G5 | Admin action: refund the fee on an illegal sale | Missing | Admin has no Stripe or order code (1.11) | New staff action calling `POST /v1/application_fees/{fee}/refunds` on the platform key, reason code + required `moderation_decisions.id`, writes `recordFeeRefund` with the `fr_` id and an audit row |
| G6 | Exception: our fault | Missing | none | Same action, reason `platform_fault`, free-text note |
| G7 | Exception: dispute lost because of us | Missing | `webhook.ts:42-48` (no `charge.dispute.closed`) | Subscribe `charge.dispute.closed`, record outcome (won returns order to `paid`, lost keeps it out of sales), then same staff action with reason `dispute_lost_platform_fault` |
| G8 | Dispute record per seller | Missing | section 5 | Small `order_disputes` table written by the webhook (id, order, seller, status, reason, amount, opened/closed) |
| G9 | Terms state the policy | Partial | `tos-2026-11-06.ts:426` | New Terms version on Home naming the rule and the three exceptions, plus a `terms-versions.ts` entry (never edit a published version) |
| G10 | Pricing page states it | Missing | Home `PricingSection.tsx:91-93` | One sentence under the cards |
| G11 | Store /plans states it | Missing | Store `messages/en/billing.json:138-141` | New FAQ item "Is the fee refunded when I refund a buyer?" in 10 locales; this is also the "fee policy shown in your Dashboard" the Terms point to |
| G12 | Docs agree | **CONFLICTS** | Docs `en/pricing/index.mdx:80`, `cs/ceny/index.mdx:81`; `en/payments-and-payouts/refunds.mdx:36`, `:40` | Rewrite the bullet in both locales; add the fee sentence and line refunds to the refunds page |
| G13 | Seller figures reflect kept fees | Partial | section 3.6 (analytics, CSV, export, Payments hint, Admin revenue) | CSV: append `refunded_amount`, `platform_fee_returned` at the end (data contract, `tests/unit/orders-csv.test.ts`); analytics: count kept fees on refunded orders as a cost (SQL migration to the aggregate); Payments hint reword; Admin revenue read the ledger |
| G14 | Dashboard refunds modelled as Stripe does | **CONFLICTS** (test only) | `stripe-mock.ts:526` | Default `withFee` false in the simulator |
| G15 | Platform key can refund fees | Missing (config) | `config.ts:11-16` | Document `application_fee_read` and `application_fee_write`; if Admin calls Stripe, a separate restricted key with only those |
| G16 | (Pre-existing) retry after 24 h can double-refund a line; panel/webhook race | Exists | 7.3, 7.4 | Write a "refund requested" row before the Stripe call, or look up the line's existing Stripe refund by metadata before refunding |
| G17 | (Side) direct charges on legacy Express | Decision | `account.ts:157`; Stripe advice in section 5 | Decide before launch: decides dispute fees and negative-balance liability |

### Proposed change set (three small steps, each its own review)

1. **Keep the fee by default (Store only, no migration).** `actions.ts`:
   `refund_application_fee: false`, new key prefix, no non-provider fee
   reversal, comments; `fees.ts`, `fee-ledger.ts`, `webhook.ts` comments;
   simulator default and the two e2e tests (G1, G14); build log. The ledger
   needs no change: the positive fee row stands. Ship together with step 2's
   form sentence so no seller refunds without being told.
2. **Show it.** `OrderView` gains the returned or standing fee from
   `fee_ledger`; the refunded money ledger and the refund form say the fee is
   kept; CSV appends two columns; Payments hint reworded; 10 locales. Then,
   separately, the analytics aggregate migration (G13) if Adrian wants kept
   fees counted as a cost.
3. **Staff can give the fee back, with a reason.** Migration: a
   `fee_refund_decisions` table (order, `fee_` id, amount, reason enum
   `illegal_sale_removed | platform_fault | dispute_lost_platform_fault`,
   nullable FK to `moderation_decisions` that is required for the first
   reason, staff id, Stripe `fr_` id unique, created_at), service-role writes
   only. A server function that calls `POST /v1/application_fees/{id}/refunds`
   (platform account, idempotency key from the decision id, metadata with
   order and decision), then `recordFeeRefund` and the decision row, then
   tells the seller. Admin UI on the order or seller page, logged in the Admin
   audit log. Plus `charge.dispute.closed` handling and the dispute table
   (G7, G8). Copy and legal (G9 to G12) follow in Home and Docs, Terms only by
   a new version.

### Questions the owner must answer first

1. Keep the whole fee on every seller refund, including a cancellation before
   anything shipped, a statutory withdrawal, and partial or single-line
   refunds? (Stripe's default keeps 100% even on a partial refund.)
2. The fee includes the share on delivery. Keep that too?
3. Illegal sale: always refund the full fee, or only the share the buyer got
   back? Must a moderation decision exist before staff can do it?
4. Our fault: who decides, on what evidence, any cap or second approver? Do we
   also compensate Stripe's processing fee or a dispute fee (a fee refund
   cannot return Stripe's own fees; that would be a separate transfer)?
5. Dispute lost because of us: what qualifies, and who records it?
6. Where does Stripe access for staff live: a restricted key in the Admin
   Worker, or a staff-only endpoint in Store that already holds the key?
7. Stay on legacy Express with direct charges (Stripe advises against it), or
   change the charge or account type before launch?
8. Should refunds carry Stripe `metadata` (order, line, reason) and Stripe's
   `reason` value?
9. Should seller analytics count a kept fee on a refunded order as a cost?
10. Terms: a new version before launch, and is a lawyer's pass wanted on the
    fee-on-refund clause (the plans page "applies" over the Terms table,
    `tos-2026-11-06.ts:388`, so the /plans FAQ wording becomes binding too)?

---

## 10. What I could not verify, and sources

Not verified:

- Production values of `NEXT_PUBLIC_STRIPE_CONNECT_ENABLED` and
  `billing_switches.fees_enabled` (not queried). The Docs page's own note
  says on 2026-11-14 "every billing_switches row was off, checkout was off"
  (Docs `content/docs/en/pricing/index.mdx:16`).
- Whether `20261120_shopping_cart.sql` (line refunds) is in production
  (project memory says not).
- Stripe's answer to `refund_application_fee=true` on a charge with no
  application fee.
- Whether the Express Dashboard can refund an application fee.
- Negative-balance responsibility for these legacy Express accounts
  (`controller.losses.payments`).
- What a fee refund does with an insufficient platform balance.
- Stripe's exact rounding of a proportional fee refund.
- Which balance transaction types appear on the connected account for
  application fees and their refunds.
- No test was run (house rule for this audit); every behaviour above is read
  from code.

Stripe documentation read (public pages, no project data sent):

- https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=stripe-hosted (Issue refunds; Collect fees)
- https://docs.stripe.com/connect/saas/tasks/refunds-disputes.md
- https://docs.stripe.com/api/refunds/create.md
- https://docs.stripe.com/api/fee_refunds/create.md
- https://docs.stripe.com/connect/disputes.md
- https://docs.stripe.com/connect/direct-charges-fee-payer-behavior.md
- https://docs.stripe.com/connect/risk-management.md
- https://docs.stripe.com/api/idempotent_requests.md
