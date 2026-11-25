## 7. 1B, universal seller onboarding data

Designs: `P3a-seller-data-model-design.md` (database),
`P3b-seller-onboarding-app-design.md` (app) and `P3-reconciliation.md`, which
settles the 81 points where they differed. Nothing is built; every migration,
every change to who can sell and every deploy waits for you.

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
- Open for the build: how Admin's staff sign-in reaches Store for a reveal;
  and a 1A rule that refuses a country change differing from the Stripe
  account's country (recommended: save and warn).
