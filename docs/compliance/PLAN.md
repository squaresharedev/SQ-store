# Compliance plan

For: Adrian. Date: 2026-11-22. This is the build plan that goes with
`GAP_REPORT.md`. It joins three design documents into one order of work and
says what is waiting for you. Nothing here is legal advice, and every legal
text mentioned is a draft for lawyer review.

Designs this plan is built from (all in `docs/compliance/plan/`):

- `P1a-app-enforcement-design.md`: the market config module, the validators,
  CZK support, the seller gate, checkout, Stripe country handling.
- `P1b-database-guards-design.md`: the database mirror of the config, the
  guards no write path can skip, the new columns, the monitoring check.
- `P2-messaging-waitlist-czech-design.md`: public messaging, the sign-up
  country step and waitlist, Czech legal texts, the new Terms version.

## 1. What is being built

Two builds, side by side:

- **1A, the Czech-only beta.** Sellers established in CZ, prices in CZK,
  delivery to CZ, enforced on the server at every write path and at checkout,
  from one config so that adding an EU country is a config change, new copy and
  a review.
- **1B, universal seller onboarding data** (your addendum). One form for every
  seller, verification, a completion gate, public seller info, encryption,
  retention. Audit G is running; its design follows. Section 7 holds the place.

## 2. How 1A works, in one page

**One config, two kinds of list.** `src/lib/market/market.ts` exports `MARKET`
with four lists: seller countries, shipping countries, billing countries,
currencies (each `["CZ"]` or `["CZK"]` today). It is separate from the lists of
what the code can store and read (EUR, USD and CZK; 29 countries). Existing
EUR rows and stored shipping policies keep working; only what may be offered
and sold narrows. The compiler refuses a market value that cannot be stored.

**The database holds a mirror.** A one-row table, `market_rules`, seeded by a
migration and read by the database guards and the monitor. A test fails when
the TypeScript config and the SQL seed differ.

**Enforcement sits at choke points, with the database as the backstop.**

| Rule | In the app | In the database |
|---|---|---|
| R1 seller in CZ | One seller gate with named reasons, used at every publish and on every buyer page; Stripe accounts created with an allowed country, Stripe's country stored and re-checked on `account.updated` | A product cannot become sellable, and an order cannot be inserted, while the seller is blocked; a connected account cannot be charges-enabled with a country that is not allowed or differs from the seller's |
| R2 CZK only | Product, import, discount and shipping writes; every buyer page offers only market-currency products; the quote refuses anything else | Triggers on products and discounts (insert, currency change, becoming sellable); orders insert |
| R3 delivery to CZ | Shipping policy save; the quote; order placement | Orders insert: ship-to country must be allowed |
| R4 billing country | A billing country field for download orders, checked before payment; Stripe asked for the billing address; Stripe's billing country and the card country recorded as evidence; a mismatch alerts ops and never refuses or refunds | Orders insert: a download needs an allowed billing country |
| R5 collab | The placement check already takes a list of sellers; one seller is the only caller today | Every order line's product must belong to the order's seller |
| R6 server-side | There is one order pipeline; all of the above sit in it | The orders guard binds every writer, the service role included |

**Guards never trip on old rows.** Each fires only on insert, or when the
guarded value actually changes, or when a row is made sellable. Routine sweeps
(expired orders, moderation re-checks, stock) do not write those columns.

**Monitoring.** A daily job calls a database function that returns one row per
violation class. Rows that already existed when the guards were switched on
are recorded once as a baseline, so the daily count is zero in the steady
state and anything new raises an alert.

**No runtime off switch.** A switch that turns a compliance rule off is the
hole the rules exist to close. The rollout is staged by order instead: code
first, then the guards migration, each needing your OK.

## 3. Where the designs disagreed, and what I chose

| Question | Choice | Why |
|---|---|---|
| Should a non-CZ country be refused when a seller saves it? | No. Store the true country; refuse selling | Refusing pushes people to lie or leave it empty, and the waitlist and the 1B tax data need the truth. The database guard on the country column is dropped in favour of the "cannot become sellable" and "cannot insert an order" guards |
| Is `tax_country` the business address country? | Yes, for now, read through one accessor in TypeScript and one helper in SQL | 1B adds a structured address; only those two places change |
| Who writes the waitlist row for a blocked sign-up? | A Store server action | Store already has the bot check, rate limiter and throwaway-email check. Home's own form can gain a country select later |
| Legacy-currency products on buyer pages | Hidden entirely | Keeping the page would still show the seller's own buy link, which is an offer made on our page |
| The catch-all `"*"` delivery row | Means "everywhere the market allows" | It can then never admit a country outside the config |
| A third evidence column for Stripe's own billing country | Added, beside the buyer's declaration and the card country | The buyer's declaration and Stripe's record are different facts |
| R4 scope in the beta | Downloads only | No "service" product kind exists; adding one is a separate change |

These are design choices, not approvals. Say so if you want any of them the
other way; none is expensive to change before its branch is built.

## 4. Order of work for 1A

Twelve application branches and eight migration files. "Gated" means the
branch contains something that waits for you before it is merged or deployed.

| # | Branch | What it does | Gated |
|---|---|---|---|
| 01 | `market/01-strict-currency` | Removes the helper that turns any unknown currency into EUR. No behaviour change for EUR or USD | No. **Being built now** |
| 00 | `market/00-copy` | Every new message key, 10 locales | Copy review |
| 02 | `market/02-czk-storable` | CZK becomes storable and correct: per-currency minimum charge (CZK 15), caps, formatting, CSV notation | Migration 1 |
| 03 | `market/03-market-root` | The config module, validators, drift tests, the coverage test that lists every write path | Migration 2 |
| 04 | `market/04-seller-gate` | R1: the seller gate, Stripe country at creation, storing and re-checking it | Migration 3; changes who can sell |
| 05 | `market/05-catalogue-currency` | R2 on every product, import and discount write; buyer pages offer market currency only | Hides the 16 live EUR products |
| 06 | `market/06-shipping-terms` | R2 and R3 on the shipping policy save | Low |
| 07 | `market/07-checkout` | R3, R4, R5, R6 in the quote and at placement; the billing country field; Stripe session parameter; webhook evidence | Migration 3; checkout behaviour |
| 08 | `market/08-czk-reporting` | Analytics, dashboard and plan calculator stop treating everything as euros | Migration 8 |
| 09 | `market/09-seller-ui` | Settings, welcome flow, product and discount forms, pickers | No |
| 10 | `market/10-buyer-ui` | Checkout country picker, delivery line | No |
| 11 | `market/11-e2e` | New end-to-end specs; the Stripe stand-in records what it is sent | Needs a `ci/**` push |

Migrations, in the order they are applied (all additive, all after the
shopping cart migration that is already waiting):

1. Widen the currency CHECKs to allow CZK (products, price history, discounts), and add one on orders.
2. The `market_rules` mirror and its helper functions.
3. New columns: Stripe's country on the connected account; billing country, Stripe billing country and card country on orders; country on the waitlist. `order_place` carries the billing country.
4. The demo simulator follows the mirror.
5. The monitor, report only.
6. (after the app deploy) The guards, the baseline snapshot and the switch-on timestamp, in one transaction.
7. (later) A billing country becomes required for downloads.
8. (later) Reporting functions grouped by currency.

**Deploy order changed by the first code review.** Branch 02 makes CZK
storable, and the dashboard and analytics database functions still count
every currency except USD as euros. A 1 299 Kč sale would show as €1,299. So
branch 08 (reporting by currency) is built next, ahead of 05, and branch 02 is
never deployed without it. Migration 1 is applied only after branch 01's code
is live, because the old code would charge a CZK product in euros.

**Still open after the first bypass hunt.** A payment page opened while the
seller was in the market can be paid for up to 31 minutes after the seller
leaves it. The order stays paid and ops are alerted; nothing is refunded
automatically. Whether such an order should be refunded is yours to decide.

**After the first round of fixes (commit `ed69649`, local only).** Two things
changed that you should know before any deploy:

- *One migration must now go in before its code.* Buyer pages now also check
  the seller's Stripe account country, read in the same database request as
  the seller's details. That column is added by migration 3 (the connected
  account's country). If the code went live before that migration, every
  product page would answer "not found". The deploy's own schema check refuses
  such a deploy, and the migration says so at the top. Order: migration 3
  first, then the seller gate code.
- *New storefronts keep working as they do today.* A new seller makes a
  storefront before their details are in, and its pages open by themselves
  once the details are complete. That stays. Only a seller the market refuses
  (a country outside it, or a Stripe account in another country) gets a new
  storefront with its buyer pages, cart and embed switched off.

**Second review round and the reporting branch (commit `0b93f0e`, local
only).** The second independent bypass hunt found no way around the seller
rule. The second code review found no blocker; its small fixes are being
applied now. Reporting by currency is built: Overview, Analytics, the
product cards and the assistant show one named currency (the store's most
recent sale's, or CZK for a store with no sales) and say so in one line
when a store also has sales in another currency. Nothing is shown as euros
unless it is euros.

The order in which things would go to production, as it stands now:

1. Deploy the strict-currency code (branch 01).
2. Apply four migrations: the shopping cart one that is already waiting,
   then the market rules mirror, the reporting functions and the Stripe
   account country.
3. Apply the migration that makes CZK storable.
4. Deploy the rest straight after.

Step 3 is never done on its own: without the reporting functions and their
code, every CZK sale would be reported as euros. The deploy's schema check
refuses a deploy whose migrations are missing.

Messaging, waitlist and Czech texts (design P2) run beside this: 11 small
branches in Store, 1 lab for the "not open in your country yet" block, 1 in
Admin, 5 in Home and 2 in Docs. The message catalogues are the contested
files, so those branches land one at a time.

## 5. What waits for you

Money flow (I will not write this code until you say so):

1. **Connected account type.** The code creates Express accounts. Your locked
   decision is Standard, or the full-Dashboard controller setup. I recommend
   plain `type: "standard"`, the conservative reading of Stripe's platform
   terms. There are 0 accounts in production, so nobody is stranded.
2. **Refunds and the application fee.** One flag makes every refund return the
   fee. The change is small; the edge cases are yours to decide (delivery
   portion, partial and single-line refunds, statutory withdrawals, who issues
   a staff fee refund).

Czech-only beta:

3. **Applying each migration to production**, in the order above. The Supabase
   connector declines schema changes here, so each is pasted into the SQL
   editor by you.
4. **The day the seller rule goes live.** It hides the three listings of the
   one account whose country is IE, and stops the 12 profiles with no country
   from publishing. The four accounts that own content all look internal or
   test. Recommended: set countries and re-price the internal catalogues in
   CZK first, read the report-only monitor, then deploy.
5. **The demo sales simulator.** It is on in production and writes EUR orders
   to EU addresses every 20 minutes. Recommended: re-price its seller's
   products in CZK so it keeps working under the rules. The alternative is to
   pause it.
6. **Plan prices.** Plans are priced in EUR and sales will be in CZK. Until you
   and the accountant decide, the plan calculator shows no sales-based figure
   for CZK sellers instead of a false zero.
7. **End-to-end tests.** They cannot run on this machine. They run on GitHub
   when a `ci/**` branch is pushed, which needs your OK and a working GitHub
   sign-in on the dev PC (it expired on 21 Nov).
8. **Stripe test mode.** Nothing here has ever run against real Stripe. One
   test-mode run needs restricted test keys and test connected accounts in CZ
   and one other country.

Legal and tax (not mine to settle):

9. **The Czech-beta Terms.** Two accounts have agreed to `tos-2026-11-06`, so
   it cannot be quietly replaced. A new version queues behind it unless the
   lawyer accepts a "superseded" marker. The draft lives in
   `docs/compliance/legal-drafts/`, never in Home's versions folder.
   Publishing starts emails to every seller and is yours alone.
10. **Czech legal texts.** Home's Terms, Privacy Policy, Cookie Policy and
    imprint exist only in English.
11. **VAT wording and DAC7.** For the accountant; the question lists are in the
    gap report.

## 6. Verification, and its limits

- Unit tests and database tests run locally and prove the validators and the
  guards, including "an old EUR row survives a multi-row sweep" and "the
  service role is bound".
- A coverage test lists every write path from `WRITE_PATH_INVENTORY.md` and
  fails while any is unenforced.
- End-to-end flows (CZ seller, CZK, CZ address succeeds; each single violation
  is refused; the embed on a foreign site still works) are written as specs
  but run only on GitHub (item 7 above).
- Collab checkout does not exist, so R5 is proven by unit tests on the
  multi-seller check and by the database rule, not end to end.
- Stripe behaviour is proven against a stand-in until item 8 happens.

## 7. 1B, universal seller onboarding data

Designs: `P3a-seller-data-model-design.md` (database),
`P3b-seller-onboarding-app-design.md` (app) and `P3-reconciliation.md`, which
settles the 81 points where they differed. Nothing of 1B is built yet; every
migration, every change to who can sell and every deploy waits for you.

**How it works**

*One field list.* Every seller field is written down once in the code: who it
applies to (person or company), when it is required, whether buyers see it,
whether it is sealed, how long it is kept, how it is checked. The form, the
"may this seller sell" check, the public seller info, the data export and the
masking in logs and the AI connector all read that list. A new field is one
entry, its wording and one database column.

*One form.* Settings > Business becomes a step-by-step form for new sellers
and editable cards afterwards. Step one asks the country; a seller outside the
beta market has the true country saved and is told selling is not open yet.
Every step saves a draft, and a draft never lets anyone sell. Czech numbers
(IČO, DIČ, birth number) have their own checks.

*What is sealed, and who can read it.* Tax ID numbers, date of birth, place of
birth and the payout account are encrypted by the Store app before they reach
the database, with a key that exists only as a Store secret plus two offline
copies you keep. Reading one always writes an access-log entry. The seller
sees a hint ("CZ ••• 641") and gets the full values in the data export after
signing in again. Staff reveal one value at a time in Admin, owner role only,
with a reason; Admin never holds the key. Team members and the AI connector
see no seller details.

*Checks.* VAT numbers go to the EU's VIES service, Czech business numbers to
the ARES register, email and phone are proven with the existing code.
"Pending" means a check has not answered yet (a service was down, or a person
has not looked); by default it holds a new seller, with automatic retries. In
the beta you screen each seller by hand against the EU sanctions list and
record it in Admin; selling waits for "clear".

*The gate.* After every change the app writes one status row per seller
saying what still blocks them. Buyer pages, every publish and the 1A database
guards read it, so a write that skips the app is still refused. A possible
sanctions match always blocks; the seller only sees "we are checking your
details".

*Account deletion.* Seller records live outside the account, so deleting it
cannot wipe them; quarterly sales totals are frozen first. Tax (DAC7) records
are kept 10 years after the last year with a sale (6 months if it never sold),
contact details and the public address 6 months, declarations and screening
records 3 years. All periods are settings for the lawyer and the tax adviser.

*Existing sellers.* No migration deletes or switches anyone off. On
enforcement day every seller with products or a storefront gets 30 days, with
listings live and reminders. After that their listings are hidden from buyers,
not deleted, until the profile is complete. The grace does not cover sanctions
or failed checks, so every existing seller is screened first.

*Payments.* Stripe's "charges enabled" does not block publishing until Connect
is live; checkout already needs a ready payment account.

| Stage | What |
|---|---|
| Before the beta opens | the tables, sealing, the form, VIES and ARES, manual sanctions screening, the status row and gate, seller info on every buyer page and in the order email, product-safety details required for physical goods, export and masking, the Admin seller panel and screening queue, the deletion freeze; then enforcement |
| Shortly after | DAC7 requests and reminders with a block on re-registering, automatic sanctions screening, the retention clean-up job, the DAC7 small-seller counter, 36-month re-checks, sign-up evidence, key rotation, a public email or phone different from the private one |
| Built but switched off | private (non-trader) sellers, payments required to publish, payout account read from Stripe, prefilling Stripe, US rules, the US sanctions list |

**Your decisions, and the defaults the build uses meanwhile**

| Decision | Default | If you choose otherwise |
|---|---|---|
| Private sellers | Not allowed in the beta | Lawyer's notice, then one setting |
| Charges enabled | Checkout only until Connect is live | Publishing also waits for Stripe: one setting |
| Stripe account type | Outside this build | Payout read and Stripe prefill follow it |
| Email proof | Code typed in the same session | A link carrying the code: small change |
| Phone | Required; proven only where SMS is on | Optional: one rule |
| Existing sellers' grace | 30 days, listings live | Any length: one value |
| Sanctions | You by hand now, automatic import shortly; a match blocks until reviewed | A vendor: one adapter plus a processor agreement |
| Keys and reveals | Store secret only; owner role reveals | Admin holding the key: wider exposure |
| VIES or ARES down | New seller waits; retried | Sell for 72 hours meanwhile: one setting |
| Re-check overdue (36 months) | Warn 30 days, then block | Warn only: one setting |
| Product categories | Draft list; risky ones reviewed before first publish | Your list |
| IP in declarations | Kept in full, pending the lawyer | Country only: one line |
| DAC7 non-cooperation | Block selling and re-registering; keep the account | Close the account: supported |

**What waits for you**

1. Create the two Store secrets (sealing and fingerprint keys) and keep two
   offline copies. Losing both loses every sealed value.
2. Apply the migrations in the SQL editor in four goes (order in the
   reconciliation, section 4).
3. Approve two deploys: the gate reporting only, then enforcement.
4. Turn production email on and decide SMS.
5. Screen every seller with content by hand, then monthly.
6. Pick in two labs: the form layout and the seller info block.
7. Read the gap report and choose enforcement day.
8. Approve the GitHub push for the end-to-end tests.
9. Later: the EU sanctions file token as a GitHub secret, the updated privacy
   notice, one Stripe test-mode check after the account-type decision.

*For the lawyer:* every declaration text; retention periods and the privacy
notice; the basis for keeping birth numbers and the re-registration blocklist;
the full IP; what a sanctioned seller may be told; whether the DSA seller
duties apply to a micro operator; minimum age; home addresses; product safety
in the embed.

*For the tax adviser:* Czech number formats and which is the DAC7 tax number;
VIES without a consultation number; when the 10 years start; payout last 4
digits; the small-seller counting rules and exchange rate.

**Honest limits**

- End-to-end tests run only on GitHub, against stand-ins for VIES, ARES,
  Stripe and the sanctions list. Reading the payout account from Stripe is
  unproven until a test-mode check.
- With the VAT registration ended, VIES checks carry no consultation number.
- Manual screening covers sign-up and monthly checks, not every list update.
- Email proof is enforced only once production email is on; the Czech formats
  are drafts until the tax adviser signs them off.
- Encryption protects against a leaked database or backup, not a compromised
  Store app.
- Still open for the build: how Admin's staff sign-in reaches Store for a
  reveal.

One point the reconciliation raised is settled: a seller changing their
country to one that differs from their Stripe account's country is saved, not
refused. Selling and payments then pause, the seller is told why, and ops are
alerted.

## 8. How to expand to another EU country

The short version of `P1a` section 9 and `P1b` section 1.5:

1. Edit `MARKET` in `src/lib/market/market.ts` (add the country, and the
   currency if it is new to the market).
2. Add one migration that updates the `market_rules` row. The drift test fails
   until both say the same.
3. Rewrite the hand-written sentences that name the territory. Czech and
   Slovak decline country names, so these cannot be assembled from a list.
   The keys so far (all ten languages each): `errors.json`
   `marketRestricted.sellerCountry.message`; `dashboard.json`
   `attention.sellerCountry.missing.description` and
   `attention.sellerCountry.notOpen.description`; `settings.json`
   `sellerDetails.fields.country.why` and `tax.fields.country.hint`. Czech
   only: two address placeholders and the VAT tip (`onboarding.json`
   `welcome.seller.addressPlaceholder`, `settings.json`
   `tax.fields.address.placeholder` and `tax.fields.vatId.tipBody`). The
   later branches add theirs to this list. The test that fails until these
   are rewritten is not built yet; it comes with the copy branch.
4. Add the country's identifier validator (1B) and review the legal texts.
5. Review, deploy the app, apply the migration.

No other code changes.
