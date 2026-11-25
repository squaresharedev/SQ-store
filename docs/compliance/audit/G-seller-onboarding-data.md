# Audit G: universal seller onboarding data capture

Date: 2026-11-22. Investigation only. Nothing in any repo was changed except this
file. No server, test, build, Stripe, Supabase, production URL or MCP tool was
used. Public documentation was read with a web fetch (VIES REST specification,
ARES OpenAPI and the Czech Ministry of Finance ARES conditions page, Stripe API
reference and Connect guides, an EU sanctions file mirror and the Commission's
older file-format help, Czech Wikipedia pages on IČO, DIČ and rodné číslo). No
query or URL carried anything about this project, its company or any person.

Not legal or tax advice. The specification (the owner's addendum, section 1B) is
audited as given. Points a lawyer or the tax adviser must settle are listed in
section 10.3 and 10.4.

Path convention: `Store/...`, `Admin/...`, `Home/...` are relative to
`C:\Squareshare\<repo>\`. Line numbers are as of HEAD `e43eedd` plus the working
tree on 2026-11-22. "Replica" means `Store/tests/db/prod-migrations.sql` (the
hand-kept production replay that holds the base `profiles` columns).

Builds on, and does not repeat: `audit/D-dac7-readiness.md` (D),
`inventory/01-store-sellers-accounts.md` (inv-01), `audit/C-seller-terms-p2b.md`
(C), `audit/B-moderation-dsa.md` (B), `inventory/05-database-layer.md` (inv-05).
Corrections to those reports are marked **Correction**.

---

## Summary

**Field-by-field (section 1, 35 rows: every seller field, declaration,
system-captured item and product-level GPSR field in the specification):
3 exist, 14 partial, 18 missing.**

| Area | Verdict |
|---|---|
| Identity | One free-text "business name" (`profiles.tax_business_name`) stands in for legal first and last name, legal company name AND trading name. No seller type, no trader status, no date or place of birth, no representative. |
| Contact | Address is one free-text box with no structured country. Email is the strongest field: required, quality-filtered, MX-checked and proven by an in-session code (proof only demanded when mail is on, and production mail is off). Phone is E.164 and SMS-proven but optional by design. No primary/public split, no returns address. |
| Tax and registration | VAT ID is format-checked only. No tax IDs, no registration number, no permanent establishments. No VIES, ARES or registry code anywhere. |
| Payments | `seller_payment_accounts.stripe_account_id` exists (Express today, cascades on deletion). No payout identifier. For the target Standard accounts Stripe documents that masked bank details are returned to the controlling platform (section 5), which is new relative to D. |
| Declarations | Terms acceptance is one overwritten version + timestamp on the owner-writable `profiles` row: no IP, no history, not a publish condition. No self-certification, no privacy acknowledgement, no categories, no website, no product-safety role. |
| System-captured | No verification log, no sanctions screening, no signup or billing country, no field change history. |
| Product GPSR | A real but optional block exists (`products.details.safety`): manufacturer, EU responsible person, identifier, warnings, shown in a mandatory product-page section and hidden for digital goods. Missing: required-for-physical rule, manufacturer country, website, identifier image, per-language warnings, seller-level defaults, display in the embed itself. |
| Security baseline | ONE sealing helper exists: AES-256-GCM with context binding under the Worker secret `MFA_PASSKEY_KEY` (`Store/src/lib/auth/passkey-crypto.ts`). It is technically able to seal tax IDs, DOB and bank identifiers, but is scoped to passkeys, has no key version or rotation. An HMAC helper pattern exists (`CONTACT_VERIFICATION_KEY`). No pgsodium, no pgcrypto column encryption; Supabase Vault is used only by Admin for two cron secrets. Staff READS of seller data are not logged. |
| Retention | Account deletion cascades everything after 14 days plus aftercare holds; the specification needs some fields for 10 years and others stored for 6 months after the relationship ends. Both directions conflict with today (section 6). |
| Gate | One choke point already exists (`missingTraderIdentity` / `buildTraderIdentityInput`) and is enforced on 5 write paths and 7 read paths, fail-closed. A `charges_enabled` requirement added to it would take every live listing offline today, since Connect is off in production (section 7). |
| VIES | A consultation number (`requestIdentifier`) is only returned when the requester's own VAT number is supplied. The operator's VAT registration has ended, so today we could store the date and result of a VIES check but not a consultation number (section 4.1). |

---

## 1. Field by field

Column key. **Stored**: table.column, type, constraint. **Capture**: form, schema,
required or optional. **Verified**: how, if at all. **Read**: who can read it.
**Write / bypass**: who writes it and whether a direct PostgREST write skips the
app's validation. **Buyers**: where a buyer sees it. **Other outputs**: logs,
analytics, URLs, export, email, MCP, third parties.

Recurring facts, cited once here:

- `profiles` RLS: select own row, update own row, for `authenticated` (Replica:93-108). No anon policy. Restrictive 2FA policy on top (`Store/supabase/migrations/20260923_two_factor_auth.sql:74-109`). Table-level grants were never revoked (inv-05 2.1), so the owner can PATCH any unguarded column over PostgREST.
- Guarded columns (service role only): `tax_business_name`, `seller_bio`, `shipping_policy` (`Store/supabase/migrations/20261012_auto_moderation.sql:735-777`); proofs `seller_*_verified_at` (`Store/supabase/migrations/20260926_contact_verification.sql:285-334`).
- Service-role readers of the trader identity: buyer pages through `getSellerIdentity` (`Store/src/lib/settings/seller-identity.ts:171-183`), gate reads with `TRADER_GATE_SELECT` (`:81-82`), Admin `fetchSellerFacts` (`Admin/src/lib/data/moderation.ts:947-964`, mapped `:1029-1035`), Stripe Billing customer creation (`Store/src/lib/billing/customer.ts:35-44`), data export (`Store/src/app/settings/export/route.ts:38-44`).
- Team members cannot read or write the owner's row; the business page warns them it shows their own details (`Store/src/app/settings/business/page.tsx:35-49`).
- The single write action is `saveTaxInfo` (`Store/src/lib/settings/actions.ts:446-580`): field whitelist `TAX_FIELDS` (`:436-443`), only sent keys written (`:455-470`), `taxSchema.partial()` (`Store/src/lib/validation/settings.ts:124-138`), 2FA step-up when enrolled (`actions.ts:475-476`), rate limit `settings_write` (`:478`), MX lookup (`:491-495`), trader name through the content classifier (`:517-520`), phone normalisation (`:527-534`), write (`:548`), codes issued for changed contact details (`:558-568`). Not reachable from MCP: classified `person(STEP_UP)` (`Store/tests/unit/agent/registry.test.ts:85`).

### 1A. Identity

| # | Field | Status | Stored | Capture | Verified | Read | Write / bypass | Buyers | Other outputs |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `seller_type` (individual / company) | MISSING | No column (`Store/src/types/supabase.ts:2041-2071`). Connect account creation sends no `business_type` (`Store/src/lib/payments/connect/account.ts:153-164`). | none | none | n/a | n/a | no | Stripe's own onboarding collects `business_type`, readable afterwards (section 5) |
| 2 | `trader_status` (trader / private) | MISSING | No column, no declaration (grep for private-seller or trader-status terms in `Store/src`: none; C-1). Every seller is treated as a trader: the gate demands a trader identity (`Store/src/lib/settings/trader-identity.ts:1-13`). | none | none | n/a | n/a | no (no trader line, no private-seller notice) | none |
| 3 | Legal first + last name (individual) | PARTIAL | `profiles.tax_business_name` text, CHECK 1..200 (Replica:257-258). One string, no first/last split. | `TaxSection.tsx:257-278` (required mark) and the welcome seller step (`Store/src/components/onboarding/WelcomeFlow.tsx:50-55`); `taxSchema.tax_business_name` optional 200 (`settings.ts:125`); required only by the publish gate (`trader-identity.ts:75-80`) | None as a legal name. Checked by the AI content classifier before save (`Store/src/lib/moderation/auto/seller-text.ts:72-74`, `Store/src/lib/moderation/auto/check.ts:569-578`) | owner; service-role readers above | Service role only (guard). `saveTaxInfo` writes it through `writeOwnProfile` (`seller-text.ts:87-131`). No REST bypass. | product page `SellerBlock.tsx:39`; checkout `CheckoutView.tsx:151`, `:188-196`; confirmation email `Store/src/lib/orders/emails.ts:96-97`; storefront and embed "Sold by" (`StorefrontPageView.tsx:33`, `EmbedFrameView.tsx:46`, `:95`) | export (`export/route.ts:41`); Stripe Billing customer name; text sent to the classifier provider; MCP previews carry it (`Store/src/lib/agent/preview/product-page-preview.ts:148`, `storefront-preview.ts:149`) |
| 4 | Legal company name (company) | PARTIAL | Same column; legal and trading names indistinguishable | Same | No register match (no ARES code) | Same | Same | Same | Same |
| 5 | Trading / shop name | PARTIAL | Same column; the privacy notice tells individuals to enter "their own full name" there (`Home/src/content/legal/privacy.ts:99`). Storefront name (`storefronts.name`, 1..80, Replica:337-344) is the buyer-facing fallback (`SellerBlock.tsx:39`). | Same | none | Same | Same | Same | Same |
| 6 | Date of birth (reject under 18) | MISSING | No column. Sign-up shows a notice only: "By creating an account you confirm you are 18 or over ..." (`Store/messages/en/auth.json:41`, rendered `Store/src/components/auth/LoginForm.tsx:303-321`); no checkbox, nothing recorded beyond the account itself (C section 5). | none | none | n/a | n/a | no | none |
| 7 | Place of birth | MISSING | none | none | none | n/a | n/a | no | none |
| 8 | Representative name + role (company) | MISSING | Terms acceptance is recorded against the account only (`profiles.legal_accepted_at`, `legal_accepted_version`, Replica:263-265). No person name, no role. The sign-in account has an email and a username, not a legal name (`handle_new_user` inserts id, username, avatar: `Store/supabase/migrations/20261021_reserved_usernames.sql:103-112`). | none | none | n/a | n/a | no | none |

### 1B. Contact and addresses

| # | Field | Status | Stored | Capture | Verified | Read | Write / bypass | Buyers | Other outputs |
|---|---|---|---|---|---|---|---|---|---|
| 9 | Primary / registered address (street, city, postcode, country) | PARTIAL | `profiles.seller_address` text 1..300 (`Store/supabase/migrations/20260905_seller_identity_on_profile.sql:36-43`). Free text, no structured parts, no country. | `TaxSection.tsx:279-300` (required mark); `publishedAddress()` placeholder/plausibility filter (`settings.ts:70-75`, `Store/src/lib/validation/address-quality.ts:48`); required to publish (`trader-identity.ts:81-86`) | Plausibility only | owner; service-role readers | Owner via action AND direct PostgREST (unguarded, inv-05 2.2); the gate re-runs the quality filter on read so a REST-written placeholder counts as missing (`seller-identity.ts:109-120`) | product page `SellerBlock.tsx:45-53`; checkout block; email `emails.ts:98` | export; Admin; MCP previews. It is today the PUBLIC address: there is no separate primary address. |
| 10 | Tax residence countries[] | PARTIAL | `profiles.tax_country` text, CHECK `^[A-Z]{2}$` (Replica:261-262). Single value, optional, meaning "where your business is based", not tax residence. | `TaxSection.tsx:361-372` (no required mark); `taxSchema.tax_country` in `OPERATING_COUNTRY_CODES` = EU 27 + US + CA, "" to null (`settings.ts:131-136`, `Store/src/lib/settings/constants.ts:110-116`) | none | owner; service-role readers; passed as Stripe account `country` (`Store/src/lib/payments/connect/actions.ts:59-66`) | Owner via action; REST accepts any two capital letters (inv-01 BP1) | country line `SellerBlock.tsx:55-63`; checkout "Sold by X, country" (`CheckoutView.tsx:152`, `:188`); email `emails.ts:101-102` | export; Admin; Stripe Connect and Billing |
| 11 | Email (required; verify) | EXISTS (proof dormant in production) | `profiles.seller_email` CHECK <=254 + shape (`20260905_seller_identity_on_profile.sql:44-48`); `seller_email_verified_at` (`20260926_contact_verification.sql:49-50`) | `TaxSection.tsx:301-328` (required); `publishedContactEmail()` format + placeholder/disposable filter (`settings.ts:106-115`, `Store/src/lib/validation/email-quality.ts:145`); DoH MX lookup, fail-open (`actions.ts:491-495`, `Store/src/lib/validation/email-domain.ts:24`, `:71`); required to publish (`trader-identity.ts:87-92`) | 8-digit code sent to the address and typed back in session (`Store/src/lib/contact-verification/service.ts:155-313`; HMAC storage `Store/src/lib/contact-verification/code.ts:82-95`). Proof is a publish condition only when mail is on (`Store/src/lib/contact-verification/availability.ts:24-27`, `Store/src/lib/email/send.ts:87-92`); production mail is off (C section 0). The specification says "verify via link"; a code is used instead. | owner; service-role readers | Owner via action or REST; the proof can only be set by the service role and is dropped when the value changes (`20260926_contact_verification.sql:285-334`) | product page, checkout, email (`emails.ts:103`) | export (with proof timestamp); Admin; MCP previews; used as Stripe Connect account email (`account.ts:159`) |
| 12 | Phone, E.164 (required) | PARTIAL | `profiles.seller_phone` CHECK 1..32 (`20260905_seller_identity_on_profile.sql:49-50`); `seller_phone_verified_at` | `TaxSection.tsx:373-392`; `normalizeSellerPhone`: libphonenumber full metadata, valid, textable, inside `SMS_REGIONS` = EU 27 + IS, LI, NO, CH, GB (`Store/src/lib/validation/phone.ts:49-74`, `Store/src/lib/contact-verification/policy.ts:48-55`). **Optional by design** (`trader-identity.ts:21-26`). | SMS code, only where SMS is enabled (`Store/src/lib/sms/send.ts:54-59`) | owner; service-role readers | Owner via action; a REST write skips E.164 normalisation (only the 1..32 CHECK applies) | shown ONLY once proven (`seller-identity.ts:156-158`, `SellerBlock.tsx:77-85`); not in the confirmation email (`emails.ts:96-104`) | export; Admin; MCP previews (formatted) |
| 13 | Public contact {address, email, phone} (defaults to primary, may differ) | PARTIAL | Rows 9, 11, 12 ARE the public block. There is no primary/public split, so a home-based trader cannot keep a private registered address and publish a business address. | as above | as above | as above | as above | as above | as above |
| 14 | Returns / complaints address (physical goods; at checkout) | MISSING | No column. Returns TERMS exist in `profiles.shipping_policy` jsonb: `returnsWindowDays`, `returnsPaidBy`, `returnsNotes`, `returnsText` (`Store/src/types/shipping-policy.ts:64-73`); column is service-role-write only (guard). No address key. | Settings › Shipping & returns, `shippingPolicySchema` (`Store/src/lib/validation/shipping-policy.ts:67-138`) | none | owner; buyers | service role via `saveShippingPolicy` | returns terms on product page and checkout trust lines (`ProductPageView.tsx:231-240`), no address | MCP `get_shipping_policy` (public data) |

### 1C. Tax and registration

| # | Field | Status | Stored | Capture | Verified | Read | Write / bypass | Buyers | Other outputs |
|---|---|---|---|---|---|---|---|---|---|
| 15 | `tax_ids[]` {number, issuing_country, type} | MISSING | No column or table (`supabase.ts:2041-2071`; inv-01 C5 grep for registration/company number, IČO, DIČ: none) | none | none | n/a | n/a | no | none |
| 16 | VAT ID {number, country} + VIES date and consultation number | PARTIAL | `profiles.tax_vat_id` CHECK `^[A-Za-z0-9 .-]{2,32}$` (Replica:259-260); column comment "not validated against VIES" (Replica:276-277). No country column (derivable from the prefix), no check date, no consultation number. | `TaxSection.tsx:330-360` (optional); `referenceCode` upper-cased (`settings.ts:128-130`); client-only advisory comparing prefix and country, never blocks (`TaxSection.tsx:346-359`, prefix map `:63-74`) | Format only. No VIES code in any repo (searched). | owner; service-role readers | Owner via action and REST | product page `SellerBlock.tsx:87-92`; email `emails.ts:443-445`; decides the "incl. VAT" note (`ProductPageView.tsx:165`) | export; Admin; Stripe Billing customer `tax_id_data` (`Store/src/lib/billing/stripe-provider.ts:160`) |
| 17 | Business registration {register, number, country} (+ ARES lookup and name match) | MISSING | none (inv-01 C5) | none | none | n/a | n/a | no | none |
| 18 | EU permanent establishments[] (company) | MISSING | none | none | none | n/a | n/a | no | none |

### 1D. Payments

| # | Field | Status | Stored | Capture | Verified | Read | Write / bypass | Buyers | Other outputs |
|---|---|---|---|---|---|---|---|---|---|
| 19 | `stripe_account_id` | EXISTS | `seller_payment_accounts.stripe_account_id` text unique `^acct_[A-Za-z0-9]{6,250}$`, plus `charges_enabled`, `payouts_enabled`, `details_submitted`, `livemode` (`Store/supabase/migrations/20261008_seller_payment_accounts.sql:33-49`). No country, no business type. FK `owner_id ... on delete cascade` (`:34`). | Created by `ensurePaymentAccount` as `type: "express"` (`account.ts:144-184`); owner with `billing.manage` only, never via MCP (inv-01 E1) | Stripe's own KYC | service role only (`20261008_seller_payment_accounts.sql:61-63`) | `ensurePaymentAccount`, `saveAccountFacts` (three booleans only, `account.ts:108-118`) | no | not exported; not in MCP |
| 20 | Payout account identifier (IBAN or last 4) + holder name if different | MISSING | Nothing stored, by design (`account.ts:11-15`). The Payments page type "Last 4 digits only" (`Store/src/lib/payments/types.ts:62-75`) is a view type, not a column; the page does not read the bank account yet (D section 3). | none | n/a | n/a | n/a | no | none. Readable from Stripe for Standard accounts per the docs (section 5). |

### 1E. Declarations (each to be a versioned record: document version, timestamp, IP, user)

| # | Field | Status | Stored | Capture | Verified | Read | Write / bypass | Buyers | Other outputs |
|---|---|---|---|---|---|---|---|---|---|
| 21 | Seller terms acceptance (P2B: who accepted which version) | PARTIAL | `profiles.legal_accepted_at` timestamptz, `legal_accepted_version` text <=32 (Replica:263-266). ONE value, overwritten on each acceptance; no IP, user agent, surface or locale (C 2.4). Notice history only in `terms_notice_sends` (`Store/supabase/migrations/20261031_terms_notices.sql:64-70`). | Welcome flow terms step, not skippable (`WelcomeFlow.tsx:65-69`), and Settings › Legal; `legalAcceptSchema` = literal `LEGAL_VERSION` (`settings.ts:161-164`); `acceptLegal` (`actions.ts:399-422`) | n/a | owner; Overview attention row (`Store/src/lib/dashboard/attention.ts:22`, `Store/src/lib/dashboard/queries.ts:613`) | Owner via action AND direct PostgREST: the two columns are not guarded (inv-05 2.2), so a version and timestamp can be written without the action. Not a publish condition (C X-2). | no | export (`export/route.ts:44`) |
| 22 | Self-certification "I only offer products/services that comply with applicable EU law" (shown to buyers) | MISSING | none (grep: no such declaration in `Store/src` or `Store/messages/en`) | none | n/a | n/a | n/a | no | none |
| 23 | Privacy notice acknowledgement incl. DAC7 reporting | MISSING | none. The privacy notice says nothing about DAC7 and promises trader details are used for display alone (D 5.1: `Home/src/content/legal/privacy.ts:107`; in-product `Store/messages/en/settings.json:344`). | none | n/a | n/a | n/a | n/a | n/a |
| 24 | Product categories[] + website URL | MISSING | Only `storefronts.brief` (creation answers incl. a category, for template suggestions; `Store/supabase/migrations/20260808_storefront_brief.sql:30-31`), not read by the app outside the export (B P2). No website column (`supabase.ts`, grep). | none | n/a | n/a | n/a | no | n/a |
| 25 | Product-safety role (manufacturer / importer / distributor) + default EU responsible person | MISSING | No seller-level field. The product form offers to copy the manufacturer and responsible-person contacts from the seller's most recent product (`Store/src/lib/predictions.ts:216-238`): a convenience, not a default on the profile. | none | n/a | n/a | n/a | no | n/a |

### 1F. Captured by the system

| # | Field | Status | Stored | Notes |
|---|---|---|---|---|
| 26 | Verification log {field, method, result, timestamp, reference} | MISSING | Only `seller_email_verified_at` / `seller_phone_verified_at` (the latest proof, cleared on change) and `contact_verifications` (at most one live row per account and channel, deleted on reissue: `20260926_contact_verification.sql:80-92`, `:170-177`). | No history, no method, no reference, no 36-month re-confirmation. |
| 27 | Sanctions screening {list + date, result, reviewer} | MISSING | none | "Sanctions" appears only as AUP wording in the Terms (B P1). |
| 28 | Signup IP country and billing country | MISSING | Sign-up writes no country (`handle_new_user`, `20261021_reserved_usernames.sql:103-112`). `security_events.ip_hash` is a SHA-256 of the IP, no country (`Store/src/lib/security/events.ts:109-124`, `:140-145`). Sign-in approvals use the request country transiently (`Store/src/lib/auth/sign-in-approval-actions.ts:108`). Plan checkout collects a billing address at Stripe (`Store/src/lib/billing/stripe-provider.ts:191-192`); `seller_billing` stores no country (`supabase.ts:2434-2451`). | The Cloudflare `cf-ipcountry` header is already read in three buyer paths (`Store/src/lib/cart/route.ts:47`, both checkout pages), so the signal is available at sign-up too. |
| 29 | Field change history (who / when / old to new) | MISSING | `profiles.updated_at` only. `SECURITY_EVENTS` has no seller-detail event (`events.ts:29-66`). Admin audit log is staff actions only. | Tax/registration edits cannot trigger re-verification because nothing records that they changed (contact fields are the exception: proof drops on change). |

### 1G. Product level (GPSR Art. 19, physical goods)

All in `products.details.safety` (jsonb inside `products.details`, object, <=16 KB: `Store/supabase/migrations/20260902_product_page.sql:18-36`, `:47-48`; type `Store/src/types/product.ts:332-347`, `:465-467`). Read: store members (products RLS) and buyers on the hosted product page. Write: owners and editors through the product actions and MCP `update_product`, and directly over PostgREST (`details` is writable by owners/editors, inv-05 2.2); `details` is a moderated column, so every write goes through the content wall and the classifier sees it (`20261012_auto_moderation.sql:155-168`). MCP `get_product` returns `details` (`Store/src/lib/agent/present.ts:43`). Not in the data export (`export/route.ts:46-48`).

| # | Field | Status | Evidence | What is missing |
|---|---|---|---|---|
| 30 | Manufacturer {name or trade name/trademark, postal address, email/website} | PARTIAL | `manufacturerName` <=120, `manufacturerAddress` 1..300, `manufacturerEmail` (`Store/src/lib/validation/product.ts:399-407`); form block optional as a whole, the three fields become required once any safety field is filled (`Store/src/components/products/SafetyFields.tsx:15-20`, `:32-35`); datapoint `required: false` (`Store/src/lib/products/form-datapoints.ts:85`) | Not required for a physical product to publish; email only (no website alternative); no manufacturer country (needed to decide whether an EU responsible person is required). |
| 31 | EU responsible person {name, postal address, email} if manufacturer outside EU; defaults from the seller profile | PARTIAL | `responsibleName/Address/Email` optional (`validation/product.ts:408-416`; `SafetyFields.tsx:108-119`) | No rule tying it to the manufacturer's country; no seller-level default (row 25). |
| 32 | Product identifier (type / batch / serial / barcode) + image | PARTIAL | `identifier` free text <=80 (`validation/product.ts:417`) | No identifier type, no barcode field, no identifier image. |
| 33 | Warnings / safety information in the buyer's language | PARTIAL | `warnings` <=2000, one text (`validation/product.ts:418`) | No per-language variants. |
| 34 | Shown on the product page and in the embed | PARTIAL | Product page section "Safety and compliance" is mandatory, cannot be hidden (`Store/src/lib/storefront/product-page.ts:39-53`; rendered `Store/src/components/product-page/ProductPageView.tsx:272-276`, `:378-418`). The embed frame shows tiles only; each tile links to the hosted product page (`Store/src/lib/storefront/storefront-page.ts:176-178`, `:316-320`). | Not in the embed itself; a cart quick-add from a tile (`Store/src/components/storefront-page/QuickAddTile.tsx`, cart dark behind `CART_ENABLED`) can add an item without the buyer opening the page. Checkout does not show it. |
| 35 | Not needed for digital goods | EXISTS | Form hides the block for digital (`form-datapoints.ts:428-432`); page skips it (`ProductPageView.tsx:380`) | none |

### 1H. Where existing seller details go today (logs, analytics, URLs, export, email, MCP)

| Output | Seller-detail values that reach it | Evidence |
|---|---|---|
| Server logs (Workers observability is on, `Store/wrangler.jsonc:14-16`) | No field values. Errors log codes and messages only (`seller-identity.ts:179`, `:259-263`; contact verification `service.ts:164-309`). One caveat: an SMTP failure's message is logged as-is (`Store/src/lib/email/send.ts:169-171`) and a relay may quote the recipient address in it (relay behaviour not verified). | as cited |
| Ops alerts | Ids only (`Store/src/lib/ops/alert.ts:21-23`; callers `Store/src/lib/payments/connect/webhook.ts:186-202`, `Store/src/lib/payments/connect/fees.ts:80`, `Store/src/lib/account-deletion/run.ts:336`) | as cited |
| Analytics | Funnel points carry seller id, store id, product id, referrer host, placement id (`Store/src/lib/analytics/funnel/record.ts:37`, `:73-75`). No profile fields. No third-party analytics or error tracker (grep for Sentry, PostHog, Amplitude and similar: none). | as cited |
| URLs | Settings anchors (`/settings/business#vat`) and the public `mailto:` on product pages. No identifiers in query strings. | `TaxSection.tsx:249-256`; `SellerBlock.tsx:70` |
| Data export | All six identity columns, both proofs, Terms acceptance (`export/route.ts:38-44`). Not `shipping_policy`, not product `details`. | as cited |
| Email | Buyer confirmation: name, address, country, email, VAT (`emails.ts:94-105`, `:441-445`). Codes go to the seller's own address or phone. | as cited |
| MCP | `get_store` returns missing field NAMES only (`Store/src/lib/agent/tools/store.ts:80`); `get_profile` returns username, bio, avatar, notification switches (`store.ts:94-106`); the two previews return the PUBLIC identity built by `buildSellerIdentity` (name, address, email, VAT, country, proven phone, bio: `product-page-preview.ts:148`, `storefront-preview.ts:149`); `saveTaxInfo`, `acceptLegal` and contact codes are not tools (`registry.test.ts:84-85`, `:91-92`). The present layer is field by field (`present.ts:6-11`). | as cited |
| Admin | `fetchSellerFacts` reads seven identity columns for the moderation seller card (`Admin/src/lib/data/moderation.ts:958-964`); the read is not logged (section 3.3). | as cited |
| Third parties | Stripe Connect: email + country (`account.ts:153-164`). Stripe Billing: name, country, VAT (`customer.ts:35-44`). Content classifier (Anthropic): trader name, bio, shipping text (`seller-text.ts:72-74`) and product `details` incl. safety. Brevo (mail transport), the SMS provider. | as cited |

Risk for the build: `buildSellerIdentity` copies fields one by one (`seller-identity.ts:134-161`), so new private fields cannot leak through it by accident, but anything added to it reaches buyers AND the MCP previews. New sensitive fields must never be added to `SELLER_IDENTITY_SELECT` / `TRADER_GATE_SELECT`, never be sent to the classifier, and never be selected by Admin's seller card without a logged reveal.

---

## 2. Existing mechanisms to reuse (do not duplicate)

| Mechanism | Where | What it does | How the build should reuse it | Caveat |
|---|---|---|---|---|
| Trader-identity predicate (the publish/sell gate) | `Store/src/lib/settings/trader-identity.ts:36-152`; `buildTraderIdentityInput`, `sellerMaySell`, `publishBlockedError` (`seller-identity.ts:109-132`, `:304-313`) | Pure predicate, field list with anchors and copy; fails closed on read errors | Make the specification's completion rules NEW members of `TraderIdentityField` (or a sibling "readiness" list) and feed them through `buildTraderIdentityInput`, so all 12 gate sites (section 7) change at once. Keep sensitive values out of the gate input: give it booleans only. | The input is built from one `profiles` row today. New facts live in other tables, so the read must join or read a precomputed readiness row (section 7.3). |
| Contact verification | `Store/src/lib/contact-verification/` (service, HMAC code, policy, availability); RPCs `issue_/redeem_contact_verification` (`20260926_contact_verification.sql`) | In-session 8-digit code bound to owner, channel and value; proof dropped when the value changes; budgets and cooldowns | Email and phone proof as is. Write each successful redeem into the new verification log (method `code`). | Spec says "link": an owner call (section 10.2). Proof only enforced when mail/SMS are on. |
| Email quality + MX | `email-quality.ts:145`, `email-domain.ts:71` (DoH, fail-open) | Refuses placeholders, disposable domains, domains with no MX | Reuse for public and primary emails | Fail-open by design |
| Phone E.164 | `phone.ts:49-74`, `SMS_REGIONS` | Normalises with libphonenumber (max metadata), textable types, region fence | Reuse as the phone validator; country default from the new primary address country instead of `tax_country` | Server only (bundle size) |
| VAT ID format + advisory | `settings.ts:128-130`; `TaxSection.tsx:63-113` (prefix map EL for GR) | Shape check, prefix/country advisory | Starting point for the CZ VAT validator; VIES call added server side | Map lives in a client component today; move it to the validator module |
| Address quality | `address-quality.ts:48` | Refuses placeholders and a town alone | Keep for the free-text public address; structured fields for the primary address | n/a |
| Structured address shape | buyer `ship_to` `{name, line1, line2, city, region, postalCode, country}` (inv-05 1.6) and its formatter (`Store/src/lib/orders/ship-to.ts`) | Structured address with per-country layout | Reuse the shape and formatter for the seller's primary, public and returns addresses | n/a |
| Terms acceptance + Terms notice system | `acceptLegal` (`actions.ts:399-422`); `Store/src/lib/legal/terms-versions.ts`; `terms_versions`, `terms_notice_sends` (`20261031_terms_notices.sql`); daily notice job (`Store/src/lib/legal/terms-notices.ts`) | Version id per document, 30-day notice machinery | Generalise into a `seller_declarations` insert-only table (document kind, version, accepted_at, ip_hash or IP, user id, surface, locale) written by `acceptLegal` and the new declaration actions; keep `profiles.legal_accepted_*` as a cache or retire it | Today's columns are REST-writable; the new table must be service-role only |
| Setup checklist (steps as data) | `Store/src/lib/onboarding/steps.ts:41-220` (derived, never stored); tour steps as data `Store/src/lib/onboarding/tour-steps.ts:6-47` | Pure derivation of what is left, from the gate's own answer | The onboarding form's progress and the "complete your profile" flow should be steps derived from the same readiness facts (one more step id or sub-steps under `seller-details`) | Do not store progress (the file explains why) |
| Welcome flow | `WelcomeFlow.tsx:42-76`, steps `"welcome" | "terms" | "seller"` (`:78`, `:107-112`) | Terms step (not skippable) and a skippable seller step posting through `saveTaxInfo` | Add the seller-type question first and route to the universal form; keep drafts unblocked | The seller step posts only three fields today |
| Settings page structure | `/settings/business` (`Store/src/app/settings/business/page.tsx:24-67`) renders `TaxSection`; `TRADER_IDENTITY_HREF` (`trader-identity.ts:57`); `/settings/tax` is a cached permanent redirect (D 7.5) | "Business & seller details" | The universal form lives here (sections: identity, addresses, tax and registration, declarations), with anchors used by the gate's deep links | Team members see their OWN row here |
| Dashboard attention rows | `attention.ts:15-30`, profile data `:60-68` | Overview "Needs attention" rows with deep links | Rows for missing fields, a pending re-verification, a sanctions hold, a DAC7 request with its deadline | `AttentionKey` is a closed union |
| 2FA step-up for sensitive saves | `requireStepUpState` (used at `actions.ts:475-476`); `StepUpField` in the form (`TaxSection.tsx:393`) | Recent second factor required when enrolled | Every save of tax IDs, DOB, addresses, bank-related fields | Only bites when 2FA is enrolled |
| Rate limiting | `rl_take` RPC (`Store/src/lib/rate-limit.ts:587`), `RATE_LIMITS.settingsWrite` | Postgres token buckets | Budgets for VIES/ARES calls per seller and per platform | n/a |
| Notifications | `createNotification` (`Store/src/lib/notifications/create.ts:49`), `NOTIFICATION_TYPES` (`Store/src/lib/notifications/types.ts:10`) | In-app bell + realtime | DAC7 request and reminders, re-verification prompt, sanctions hold | New types must be added to BOTH the TS list and the DB CHECK (memory note "notification type two lists") |
| Email | `sendEmail` (`email/send.ts:160-174`), Brevo SMTP | Transactional mail, gated by `TRANSACTIONAL_EMAIL_ENABLED` | Same reminders by email | Production mail is off |
| Scheduled jobs | GitHub Actions `Store/.github/workflows/scheduled.yml:31-186` calling `/api/cron/*` with `CRON_SECRET`; pg_cron jobs (`20260807_db_hygiene.sql:68`, `20261008_order_lifecycle.sql:352-355`) | Daily batch work with `"more":true` paging | DAC7 reminder ladder, yearly "confirm your details", sanctions re-screen on list update, retention purge, threshold counters | Workflow prints counts only (keep it that way) |
| Data export | `export/route.ts` (explicit columns, step-up, rate limit) | GDPR self-export | Add the new private fields for the owner (decrypted on the server, still step-up gated); note it currently omits `shipping_policy` and product `details` | The file leaves our custody: decide whether full tax IDs go in (likely yes, it is the data subject's own data) |
| Account deletion | `Store/src/lib/account-deletion/` (policy holds, bounded job) | 14-day grace, buyer holds, cascade delete | Add a "freeze and retain" step before `deleteUser` (section 6) | Cascades are the problem, not the job |
| Security events | `recordSecurityEvent` (`events.ts:126-150`), owner-select, service-role insert, IP hashed | Append-only per-user activity | Pattern (not the table) for field change history; or add events such as `seller.tax_id_changed` | Vocabulary is closed (`:29-66`) |
| MCP action registry test | `Store/tests/unit/agent/registry.test.ts` | Forces every server action to be classified | Every new onboarding action is classified `person(STEP_UP)`; nothing sensitive becomes a tool | n/a |
| Market config (planned) | `plan/P1a-app-enforcement-design.md` (COMPLIANCE_PROGRESS) | One market module for CZ rules | Per-country validators and "only CZ in the beta" hang off it | Not on disk yet |
| `pg_trgm` | Replica:1214 | Trigram similarity in Postgres | Fuzzy name pre-filter for sanctions screening | Pre-filter only; a person decides |

---

## 3. Security baseline

### 3.1 Field-level encryption or sealing

| Item | Finding | Evidence |
|---|---|---|
| Sealing helper | ONE: `seal(plaintext, context)` / `open(sealed, context)`. AES-256-GCM via WebCrypto, 96-bit random IV, the context bound as GCM additional data, output `base64url(iv || ciphertext)`. Key: `MFA_PASSKEY_KEY`, 32 random bytes base64, read from `process.env` (a Worker secret, `wrangler secret put MFA_PASSKEY_KEY`); never in the browser or the database. Missing key means null and every caller fails closed. | `Store/src/lib/auth/passkey-crypto.ts:1-15`, `:17`, `:37-54`, `:62-77`, `:81-100`; `Store/wrangler.jsonc:54`, `:89` |
| Where it is used | TOTP secrets behind passkeys (`mfa_passkeys.sealed_secret`), sign-in approval secrets, WebAuthn challenge slips and the passkey offer cookie | `Store/src/lib/auth/passkeys.ts:362-376`, `:194`, `:446`; `Store/src/lib/auth/sign-in-approval.ts:583`; `Store/src/lib/auth/passkey-offer.ts:33` |
| Can it seal tax IDs, DOB, bank identifiers? | Technically yes: any string, any context (for example `seller_tax_ids:<owner>:<id>`), so a ciphertext copied to another row fails to open. Gaps before reuse: (1) the key is named and scoped to passkeys, so rotating it for one purpose breaks the other; (2) no key id in the ciphertext, so no rotation or re-encryption path; (3) decryption is only possible in the Worker, so SQL (reports, the gap query, staff tools) cannot read the values, which is desirable but means DAC7 exports must be produced by app code; (4) no searchable form. | as above |
| Keyed hash (HMAC) pattern | HMAC-SHA-256 under `CONTACT_VERIFICATION_KEY` (Worker secret, 32 bytes), with a versioned context string. Same pattern gives a keyed fingerprint of a tax ID for duplicate detection and for recognising a re-registration without decrypting. | `Store/src/lib/contact-verification/code.ts:3-19`, `:44-53`, `:82-95` |
| Supabase Vault / pgsodium / pgcrypto | No pgsodium, no `pgp_sym_*`, no column encryption in any Store migration or the replica (grep). Vault is used only by Admin to hold two secrets for a pg_cron to pg_net push (`Admin/supabase/migrations/0006_admin_notifications.sql:130-166`). | grep of `Store/supabase/migrations`, Replica, `Admin/supabase/migrations` |
| Recommendation (for the design) | Generalise the helper into a field-sealing module with its own key (for example `FIELD_SEALING_KEY`), a key id prefix in every ciphertext, AAD = table, column, owner id; a separate HMAC key for fingerprints; store ciphertext in `text` columns (the helper emits base64url). **Correction to D 7.2:** D sketched `value_ciphertext bytea`; with this helper `text` avoids a conversion. | n/a |

### 3.2 Database access today

- `profiles` holds every seller detail and is owner-updatable over PostgREST for all unguarded columns (inv-05 2.2). New private data must not go there (D 7.1 agrees).
- Service-role-only precedent tables: `seller_payment_accounts` (`20261008_seller_payment_accounts.sql:61-63`), `account_deletion_requests`, `seller_billing`. New tables must restate revokes (auto-grant trap, `Store/supabase/migrations/20261021_order_refund_provider_first.sql:61-63` comment cited in D) and be listed in the RLS coverage test's policy-free list (inv-05 7.3).
- Backup and probe roles exist (`backup_reader`, `schema_probe`, memory note); with app-level sealing a dump holds ciphertext only.

### 3.3 Staff access logging (Admin)

| Item | Finding | Evidence |
|---|---|---|
| Table | `admin_audit_log (id, admin_user_id, action, target, meta jsonb, created_at)`; RLS select for staff, insert as self, no update/delete policies | `Admin/supabase/migrations/0001_admin_foundation.sql:16-23`, `:61-77` |
| Writer | `logAdminAction` inserts with the SERVICE ROLE (bypasses RLS) and swallows a failed insert ("must not take the admin action itself down") | `Admin/src/lib/auth/log-admin-action.ts:11-30` |
| What is logged | Mutations and exports only: content decisions, restores, appeals, dismissals, bans, unbans, emails, password resets, email confirms, deletes, plan CSV export, signup campaign and CSV export, notification device actions | grep of `logAdminAction(` in `Admin/src` (18 call sites) |
| What is NOT logged | Reads. `fetchSellerFacts` reads trader name, contact email, proof, address, phone, country, VAT ID for the seller card with no log row | `Admin/src/lib/data/moderation.ts:947-964` |
| Gap vs specification | "Admin-only access with access logging": needs a logged reveal for each private field (tax IDs, DOB, place of birth, bank identifier), an audit insert that is not swallowed for reveals (fail closed), and a tamper-resistant log (B L1 found the same weaknesses for decisions). | n/a |

### 3.4 Logs, alerts, error reports, analytics

Covered in 1H: no profile field values found in logs, alerts or analytics today; no third-party error or analytics service. Two things to guard in the build: the SMTP error message passthrough (`email/send.ts:169-171`), and the classifier (seller text is sent to the model provider, `seller-text.ts:72-74`, product `details` too): DOB, tax IDs, registration numbers and bank data must never be passed to `sellerTextRefusal` or into a moderated column.

---

## 4. Verification services (public documentation)

### 4.1 VIES (EU VAT number check)

| Question | Answer | Source |
|---|---|---|
| Interface | REST: `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number` (also `POST /check-vat-test-service` with the same schema), `GET /check-status` (per-country availability: Available, Unavailable, Monitoring Disabled). SOAP also exists (not read). | Commission OpenAPI file `ec.europa.eu/assets/taxud/vow-information/swagger_publicVAT.yaml` |
| Inputs | `countryCode`, `vatNumber`; optional `requesterMemberStateCode`, `requesterNumber`; optional trader fields for approximate matching (`traderName`, `traderStreet`, `traderPostalCode`, `traderCity`, `traderCompanyType`) | same |
| Output | `valid` (boolean), `requestDate` (date-time), `requestIdentifier`, `name`, `address`, and `*Match` values VALID / INVALID / NOT_PROCESSED for each trader field | same |
| Consultation number | The spec's only description: "In order to retrieve the requestIdentifier, the information about requesterMemberStateCode and requesterNumber have to be provided." Wikipedia: "The consultation number is only issued for queries that include the requester's own VAT identification number." | OpenAPI file; en.wikipedia.org "VAT Information Exchange System" |
| Consequence for us | The operator's VAT registration has ended (memory note `operating-regions-and-terms`). Without a valid requester VAT number VIES returns no consultation number. We can still store `requestDate`, `valid`, the returned name and address, the request we sent and a hash of the response as our own evidence, but not an official consultation number. Whether that is sufficient evidence, and whether the operator should hold some VAT identification to obtain consultation numbers, is a tax adviser question (10.4). The spec's error codes are not enumerated publicly (only an `error` string); third-party sources describe `MS_UNAVAILABLE`, `MS_MAX_CONCURRENT_REQ`, `GLOBAL_MAX_CONCURRENT_REQ` (unverified against official text). What VIES does with an invalid requester number was not determined. | as cited |
| Name/address returned | Depends on the member state: "It may also include additional information, such as the holder's name and address, if this is provided by the member state." Whether CZ returns them: not verified. | Wikipedia |
| Availability | Each answer comes from the issuing member state; an outage marks that country unavailable rather than numbers invalid. The design must treat "unavailable" as "retry later", never as "invalid". | Wikipedia; `check-status` in the OpenAPI file |
| Rate limits, terms of use | Not stated in the OpenAPI file. The Commission's VIES pages are a single-page app that could not be fetched as text, so the official disclaimer and any usage limits are (unverified against docs). | n/a |
| From a Cloudflare Worker | Plain HTTPS JSON, server to server: expected to work with `fetch` (not tested). | n/a |

### 4.2 ARES (Czech register of economic subjects)

| Question | Answer | Source |
|---|---|---|
| Interface | REST v3, base `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest`. `GET /ekonomicke-subjekty/{ico}` (IČO exactly 8 digits), `POST /ekonomicke-subjekty/vyhledat` (search, paged with `start`, `pocet`, `razeni`). | ARES OpenAPI document `ares.gov.cz/ekonomicke-subjekty-v-be/rest/v3/api-docs` |
| Output fields | `ico`, `obchodniJmeno` (business name), `sidlo` (registered office address object), `pravniForma` (3-digit legal form code), `dic`, `datumVzniku`, `datumZaniku`, `seznamRegistraci` (status per source register, e.g. ROS, VR, RES, RŽP, ISIR, CEÚ), `financniUrad`, `czNace`, `datumAktualizace` and others | same |
| Proof of a check | No request id. Evidence would be our stored response (`datumAktualizace`, the fields compared, a response hash, our timestamp). | same |
| Name match | We compare `obchodniJmeno` with the declared legal name (normalised: case, diacritics, legal-form suffixes). Fuzzy cases need a person. | n/a |
| Limits and terms | "Služby může využívat každý, pokud bude respektovat podmínky provozu" (anyone may use the services if they respect the operating conditions). Users sending "více než 500 dotazů za minutu" (more than 500 queries per minute), automated random searching, or many parallel queries from many IP addresses can be restricted or blocked. "Všechny informace zpřístupněné systémem ARES mají pouze informativní charakter" (all ARES information is informative only). Auth schemes are declared in the OpenAPI but which endpoints require them was not determined. Licence or charges not stated on the page. | Ministry of Finance page `mf.gov.cz/cs/ministerstvo/informacni-systemy/ares` |
| From a Cloudflare Worker | HTTPS JSON: expected to work (not tested). Whether ARES throttles shared cloud egress IPs: not determined. | n/a |
| Coverage | ARES aggregates registers including the trade licence register, so sole traders with an IČO are findable as well as companies (from `seznamRegistraci`). "Informative only" matters: the legal status of an ARES match as verification is a lawyer question. | as above |

### 4.3 EU Consolidated Financial Sanctions List (and OFAC later)

| Question | Answer | Source |
|---|---|---|
| Official source | Financial Sanctions Files (FSF), published by the Commission (DG FISMA). Download as XML, CSV, PDF. Automated download uses a URL carrying a personal token obtained after registering on the FSF site (`.../xmlFullSanctionsList_1_1/content?token=...`). The FSF site itself could not be fetched (redirect loop), so the exact current URLs and terms are (unverified against docs). | OpenSanctions dataset page for `eu_fsf`; search results citing the Commission user manual and a national authority |
| Size and frequency | About 6,195 targets (4,444 persons, 1,749 organisations) across 43 programmes; source XML about 25 MB, a simplified CSV about 2.6 MB; changes several times a month, last change 2026-11-20; mirrors refresh daily. Updates can lag the Official Journal publication. | OpenSanctions `eu_fsf` page (figures as of 2026-11-22) |
| Data per entry | Names and aliases (first, middle, last, whole name), birth dates (often partial, sometimes several), birth place and country, citizenship, identification documents, addresses, legal basis. Element names in the current v1.1 XML were not confirmed; the Commission's older format help lists Name, Address, Birth (Date, Place, Country), Passport, Citizen, with a sub-id per alias. | Commission help page `.../cfsp/sanctions/list/version4/global/help_online/process_data_structure.html` (older format) |
| Licence | The official list's reuse terms were not readable (FSF not fetchable). Third-party mirrors are licensed separately (OpenSanctions: CC BY-NC 4.0, commercial use needs a licence), so a production build should use the official file. | OpenSanctions page |
| How matching is usually done | Normalise names (case, diacritics, transliteration, word order, legal suffixes for companies); compare against every alias; score with token and trigram similarity (`pg_trgm` is installed, Replica:1214); raise the score when birth date (full or year-only) or country agrees and lower it when they conflict; companies match on name plus country plus registration number where the list has one. Screen at onboarding, on every name/DOB change, and re-screen the whole seller base on every list update (daily delta). | general practice |
| Why a human reviewer | Most individuals on the list have no unique identifier we hold; common names, transliterations and partial or multiple birth dates produce false positives; the effect of a positive (blocking a person from selling) is significant. So the system flags a "potential match" and a person records clear / confirmed with a reason; only confirmed blocks. The record keeps list version (file date), score, reviewer, decision, timestamp. GDPR automated-decision rules may also apply (lawyer). | n/a |
| From a Worker | Downloading and parsing 25 MB of XML inside a request is a poor fit (CPU, memory). Better: a scheduled GitHub Action or job that downloads the file, normalises it into a service-role table, and a Worker-side or SQL check against that table at save time. | n/a |
| OFAC (US expansion) | Not researched beyond noting it as a later, separate list. | n/a |

### 4.4 Czech identifier formats (all: to be verified with the tax adviser)

| Identifier | Publicly documented structure | Check | Source |
|---|---|---|---|
| IČO (business identification number) | 8 digits, shorter numbers padded with leading zeros; last digit is a check digit | `x = (11 - (8·n8 + 7·n7 + 6·n6 + 5·n5 + 4·n4 + 3·n3 + 2·n2) mod 11) mod 10`, so remainder 0 gives 1, remainder 1 gives 0, remainder 10 gives 1, remainders 2 to 9 give 9 to 2. Example 25596641. | cs.wikipedia "Identifikační číslo osoby". To be verified with the tax adviser. |
| DIČ (tax identification number) | `CZ` + 8 to 10 digits. Legal entity: CZ + IČO. Natural person: CZ + birth number, "or another general identifier where a special law provides"; where none is assigned, the tax administrator assigns its own (citing § 130(3) Act 280/2009 Coll.). ARES describes `dic` as CZ + 10 digits. | Shape only; the legal-entity form inherits the IČO check digit; the natural-person form inherits the birth-number check | cs.wikipedia "Daňové identifikační číslo"; ARES OpenAPI. To be verified with the tax adviser. |
| Rodné číslo (birth number) | `YYMMDD/XXXX` (10 digits); 9 digits (`YYMMDD/XXX`) for people born in 1953 or earlier, no check digit. Women: month + 50. From 2004 (Act 53/2004 Coll.), when a day's suffixes run out, month + 20 (women + 70). | 10-digit numbers are divisible by 11. Exception: when the first nine digits mod 11 = 10, the check digit is 0 and the number is NOT divisible by 11; about a thousand such numbers, issuance ended in 1985 (cannot be fully ruled out after). Date part must be a real date after removing +50/+20/+70. | cs.wikipedia "Rodné číslo". To be verified with the tax adviser. |
| Sensitivity | A birth number encodes date of birth and sex; Czech law limits its use (lawyer). Stripe uses it as the Czech individual `id_number` (D 6.1). | n/a | D |

Validator design implied by the specification ("adding a country = adding a validator"): one module per country exporting `taxIdTypes`, `validateTaxId(type, value)`, `validateVatId`, `validateRegistration`, `normalise`, plus optional async verifiers (VIES for all EU, ARES for CZ). The phone validator already works per region and the VAT prefix map already exists (section 2).

---

## 5. Stripe: what the platform can read for the target account type

Target: Standard (full Stripe Dashboard) accounts created by our platform via the API. Per Stripe's controller-properties guide, `type=standard` maps to `losses.payments: stripe`, `fees.payer: account`, `requirement_collection: stripe`, `stripe_dashboard.type: full`, and an account created this way by the platform comes back with `controller.type: "application"`, `controller.is_controller: true` (docs.stripe.com/connect/migrate-to-controller-properties). The Standard guide adds: "After you create an account link on a Standard account, you won't be able to read or write Know Your Customer (KYC) information. Prefill any KYC information before creating the first account link." (docs.stripe.com/connect/standard-accounts). The Account object reference says that after an Account Link or Account Session "only a subset" of `individual` and `company` is returned where `requirement_collection` is `stripe`, "which includes Standard and Express accounts" (docs.stripe.com/api/accounts/object).

| Specification field | Readable from Stripe? | Evidence | So |
|---|---|---|---|
| Seller type | Yes: top-level `business_type` (individual, company, non_profit, government_entity) | Account object | Cross-check only. We need the type BEFORE Stripe (the form branches on it, drafts exist before Stripe). Collect ourselves. |
| Legal first + last name (individual) | Yes: `individual.first_name`, `last_name` are marked "Also available for accounts where controller.requirement_collection is stripe" (also `email`, `full_name_aliases`, `relationship`) | Account object, `individual` | Cross-check (name match). Collect ourselves (needed before Stripe and for display). |
| Legal company name | Yes: `company.name` (and `company.structure`) marked "also available" | Account object, `company` | Cross-check. |
| Date of birth | No: `individual.dob` is not in the "also available" subset | Account object, `individual.dob` | Collect ourselves. Optionally PREFILL Stripe with it before the first Account Link so the seller types it once. |
| Primary address | No: `individual.address` / `company.address` not in the subset | Account object | Collect ourselves (and prefill). |
| Tax IDs, VAT ID, registration number | Values never: only booleans `individual.id_number_provided`, `company.tax_id_provided`, `company.vat_id_provided` exist, and they are not marked as part of the subset | Account object | Collect ourselves. Stripe does not verify Czech IDs (D 6.1). |
| Country | Yes: top-level `country` | Account object | Store it (R1 needs it; inv-01 BP5). |
| `charges_enabled`, `payouts_enabled`, `details_submitted`, `requirements`, `future_requirements`, `capabilities` | Yes | Account object | Already stored in part (three booleans). Store `country`, `requirements.disabled_reason`, `currently_due` for the gate and the dashboard (inv-01 E3: `requirementsDue` is always `[]` today). |
| Payout account identifier + holder | Documented yes: `external_accounts` "are only returned for requests where controller[is_controller] is true", and platform-created Standard accounts return `is_controller: true`. Bank account object: `last4`, `account_holder_name`, `account_holder_type`, `bank_name`, `country`, `currency`, `fingerprint`. Never the full IBAN. | Account object; External Bank Account object; migration guide | **Correction to D 1.4/3:** D left this open; the docs say it is available for our target configuration. Still UNCONFIRMED in practice: the "cannot read KYC after an Account Link" sentence may or may not cover external accounts. Test in Stripe test mode before relying on it. If available, last 4 + holder name + fingerprint can be read at report time instead of collected. If not, Platform Tax Reporting or own collection (D 6). |
| Representative, beneficial owners | Persons API exists; the specification forbids us storing beneficial owners and ID scans | rule | Do not read or store. The representative we need is OUR Terms acceptor (row 8), collected by us. |
| ID documents | `verification.document` fields are file ids of non-downloadable uploads | Account object | Never stored by us (rule satisfied today: nothing is stored). |
| Sanctions, VIES, ARES | Not exposed | n/a | Ours. |

Net: from Stripe we can satisfy country, charges/payout status, requirements, and (probably) the payout identifier; names are cross-check material. Everything DAC7 needs beyond that (DOB, place of birth, address, TINs, VAT, registration, residence countries) must be collected by us, or delegated to Stripe Platform Tax Reporting if Stripe confirms it works for this configuration (D 6.3). Prefilling Stripe from our form before the first Account Link avoids double entry, but sends the data to Stripe (privacy notice must say so).

---

## 6. Retention and deletion against the specification

### 6.1 What the specification asks

| Class | Fields | Rule in the specification |
|---|---|---|
| DAC7 | seller type; legal names; DOB; place of birth (where used); primary address; tax residence countries; tax IDs with issuing country; VAT ID; registration number; permanent establishments; payout identifier and holder; `stripe_account_id`; the verification log for these; the DAC7 request/reminder trail; per-seller period totals | 10 years from the end of the reporting year |
| DSA Art. 30 only | contact email and phone, public contact block, self-certification (and any other field held only for Art. 30) | delete 6 months after the seller relationship ends |
| Everything else | Terms and other declaration records, returns address, trader status, categories, sanctions screening records, signup IP country and billing country, change history | "per the privacy policy" |

Overlaps: name, address and registration number serve both DAC7 and Art. 30. For a reportable seller the longer DAC7 period governs them; for a seller who was never reportable (no consideration, or excluded) the 6-month rule may be the only one (tax adviser and lawyer, 10.3/10.4).

### 6.2 What happens today

| Mechanism | What it deletes | Evidence |
|---|---|---|
| Account deletion job (daily) | After a 14-day grace and holds (open parcels, pending/disputed payments, 30 days after the later of last sale and last dispatch), deletes files, then `auth.admin.deleteUser`, which cascades `profiles` (all trader identity, Terms acceptance), `orders`, `order_add_ons`, `order_line_refunds`, `seller_payment_accounts`, `contact_verifications`, moderation decisions and appeals. Only `fee_ledger` survives, anonymised. The Stripe account is left at Stripe. | `Store/src/lib/account-deletion/run.ts:8-13`, `:32-39`; D 4.1 table; B L1 |
| Abandoned-order sweep (pg_cron, 5 min) | Unpaid pending orders older than 45 minutes and their lines | D 4.3; `20261008_order_lifecycle.sql:352-355` |
| Others | `rate-limit-gc` (expired limiter keys), `carts-sweep` (pending migration), agent cleanup (expired tokens), demo simulator pruning (demo data only) | `20260807_db_hygiene.sql:68`; inv-05 section 5; `scheduled.yml:146-163` |
| Privacy notice | Promises seller data deleted with the account and "Financial and tax records ... For 10 years" | `Home/src/content/legal/privacy.ts:405-414` |

### 6.3 The conflict in the specification's terms

1. **DAC7 fields die too early.** Every DAC7 field the specification lists would, if stored on `profiles` or anything cascading from `auth.users`, be gone 14 to 44 days after a deletion request, well inside the 10 years. Today none of them exist yet, so the fix is a design rule, not a migration of data: DAC7 tables carry no cascading FK, are frozen (`account_deleted_at`, `retain_until = end of reporting year + 10 years`) by the deletion job before `deleteUser`, and are purged by a retention job afterwards (D 7.6 already proposed the freeze).
2. **Art. 30 data may die too early as well.** The specification (and, as worded, DSA Art. 30) has the information stored for six months after the relationship ends, then deleted. Today it is deleted at grace + holds, which can be sooner. Whether early deletion on the seller's request is allowed, or the six months must run, is a lawyer question (and whether Art. 30 applies to a micro operator at all, 10.3).
3. **Then it must actually be deleted.** No job deletes anything on a schedule after an account ends; a retention purge job is needed for both clocks.
4. **Re-registration prevention** (DAC7 non-cooperation) needs something to survive deletion that recognises the same seller: a keyed fingerprint (HMAC) of tax ID / email / IČO in a retained blocklist row, not the plaintext (lawful basis: lawyer).
5. **Evidence records** (Terms acceptance, sanctions screening, verification log) are deleted with the account today; their retention period is "per the privacy policy", which says nothing specific (lawyer).

---

## 7. The completion gate

### 7.1 What gates publishing and checkout today (every call site)

Write side (refuses a write that makes something buyer-visible), all via `publishBlockedError` (`seller-identity.ts:304-313`, uncached service-role read, fails closed):

| Path | Call site |
|---|---|
| Create product as active | `Store/src/lib/products/actions.ts:333-339` (`publishGate`), `:367` |
| Update product to active (also MCP `update_product`, `publish_products`) | `actions.ts:456` |
| Product card status | `Store/src/lib/products/card-actions.ts:66` |
| CSV import as active (also MCP `import_products`) | `Store/src/lib/products/import-actions.ts:166` |
| Embed switched on (also MCP `update_embed_settings`) | `Store/src/lib/storefront/actions.ts:511` |

Read side (refuses to show or sell; fail closed):

| Surface | Call site | Predicate |
|---|---|---|
| Product page, product checkout page, cart, cart page, discount check, quote at order placement | `Store/src/lib/products/purchasable.ts:322` | `sellerMaySell` |
| Hosted storefront page and embed frame | `Store/src/lib/storefront/storefront-page.ts:266` | `sellerMaySell` |
| Sitemap | `Store/src/lib/seo/sitemap.ts:158` | `sellerMaySell` |
| Embed widget JSON | `Store/src/app/api/embed/[key]/route.ts:68` | `isTraderIdentityComplete` directly |
| OG share image | `Store/src/app/api/og/p/[productId]/route.ts:96` | directly |
| MCP product page preview | `Store/src/lib/agent/preview/product-page-preview.ts:162` | directly |
| MCP storefront preview | `Store/src/lib/agent/preview/storefront-preview.ts:120` | directly |

Payment side (separate): `checkoutProviderFor` (`Store/src/lib/checkout/availability.ts:73-83`) offers `stripe` only when Connect is live, Turnstile and mail are configured (`:61-64`) and `canTakePayments` (`charges_enabled` and matching live mode, `account.ts:102-104`); re-checked when the Stripe session is created (inv-01 E8). The `test` provider exists only under `next dev` with `CHECKOUT_TEST_PAYMENTS=1` (`availability.ts:40-43`). Without a provider, the product page falls back to the seller's own purchase link or an enquiry email (B P3).

Known gaps from earlier reports: `saveStorefront` can switch the embed on without the gate (read side catches it, inv-01 BP2); Terms agreement is not a gate condition (C X-2); four read sites bypass `sellerMaySell` (inv-01 BP6), so a new rule must go into `missingTraderIdentity` / `buildTraderIdentityInput`, not into `sellerMaySell` alone.

### 7.2 What the specification's gate adds

| Condition | Today | Needed |
|---|---|---|
| Required fields by seller type (and "only if applicable") | 3 fields + email proof | The full required set per type (rows 1 to 25), evaluated by one function per seller type, CZ formats from the validator |
| VIES pass (if VAT ID given) | none | latest VIES result for the current VAT ID = valid (unavailable means pending, not fail) |
| ARES pass (CZ company, and CZ individual with an IČO) | none | latest ARES result = found, active (`datumZaniku` empty), name match accepted |
| Sanctions clear | none | latest screen for the current name/DOB = clear (or potential match reviewed as clear) |
| Current Terms (and declarations) agreed | not checked | agreement row for the current versions |
| Stripe `charges_enabled` | checkout only | specification puts it on publishing as well |
| Re-verification not overdue | none | data older than 36 months or a change pending re-verification blocks (or warns: owner decision) |

### 7.3 Shape of the change

- Keep ONE predicate. Feed it booleans from a service-role readiness source (for example a `seller_readiness` row maintained on every save and by the verification jobs, or a SECURITY DEFINER function returning booleans only). The 12 call sites already read the seller's profile with the service role; they would read the readiness row alongside (the sitemap reads a batch, `sitemap.ts:146-161`, so the source must support batch reads).
- Never pass sensitive values into the gate input (`TraderIdentityInput` is spread from `StorefrontSeller`, `trader-identity.ts:51-53`).
- E2E fixtures depend on the current gate (`PUBLISHABLE_SELLER`, `Store/tests/e2e/helpers.ts:498-506`); every new condition needs a fixture path.

### 7.4 What a `charges_enabled` requirement would do

- **Production today:** Stripe Connect is off (`STRIPE_CONNECT_AVAILABLE` from `NEXT_PUBLIC_STRIPE_CONNECT_ENABLED`, `Store/src/lib/payments/availability.ts:30`; commented out in `.env.production`, inv-01 headline 5) and there are 0 connected accounts. Every account would fail the gate: all 16 live products, every hosted product page, storefront page, embed and OG image would 404, the sitemap would empty, and every publish would be refused. Listings that sell through the seller's own purchase link or an enquiry email (which take no Stripe payment at all) would be blocked too (B P3).
- **Development and tests:** the `test` provider needs no connected account (`availability.ts:40-43`, `:75`); the e2e stack uses a Stripe stand-in (`Store/tests/e2e/stripe-mock.ts`). A gate reading `seller_payment_accounts.charges_enabled` would block every dev and e2e seller unless fixtures seed an account row or the gate accepts "the test provider is active" as satisfying the payment condition.
- **Ways to handle it (design):** split the gate into a PUBLISH gate (identity, verification, sanctions, declarations) and a CHECKOUT gate (adds `charges_enabled`), which matches how `checkoutProviderFor` already works; or make the payment condition a market-config switch that is off while Connect is off and on when the market launches payments; in either case treat "test provider active" as satisfied in development. Which listing types (own link, enquiry) remain publishable without Stripe is an owner decision.

---

## 8. Thresholds and counters

### 8.1 What counts sales today

| Counter | Window | Filters | Evidence |
|---|---|---|---|
| `billing_sales_30d(p_seller_id)` | last 30 days by `created_at` | `status = 'paid'`, `currency = 'EUR'` only; sums `amount_cents` split direct/marketplace, count, fees | `Store/supabase/migrations/20261011_pricing_config.sql:676-693` |
| `billing_sales_summary(p_seller_id)` | last 30 days | paid, EUR only | `Store/supabase/migrations/20261004_discounts.sql:349-364` |
| `analytics_aggregate`, `dashboard_orders_aggregate`, `product_sales_aggregate` | seller-chosen ranges | treat anything not USD as EUR | `Store/supabase/migrations/20261117_perf_indexes.sql:246`, `:344`; inv-05 section 3 |
| Plan limits | products and storefronts counts, not sales | n/a | inv-05 section 4 |
| `fee_ledger` | per order fee rows | empty while fees are off | D 2.1 |

Nothing counts per seller per calendar year or rolling 12 months for compliance, nothing counts buyers per US state, and every existing counter is EUR-only or EUR-assuming.

### 8.2 What the three counters would be computed from

| Counter | Source | Gaps to close first |
|---|---|---|
| Per seller, rolling 12 months, sales count + gross (US INFORM Act: 200 sales and USD 5,000; USD 20,000 for disclosure) | `orders` (+ `order_add_ons` / `order_lines` for lines), `status in ('paid','refunded','disputed')` per the definition chosen, `amount_cents`, `currency` | No `paid_at` (D 2.2); per-currency sums (no FX); what counts as "a sale" (order vs line) |
| Per seller, calendar year, sales count + amount (DAC7 small-seller exclusion: fewer than 30 sales AND at most EUR 2,000) | Same, plus refunds and fees for "consideration" (D 2.8 sketch) | Same, plus the FX rule for non-EUR (D 8.2 Q5) and dashboard-made refunds |
| Platform-wide buyer totals per US state | `orders.ship_to.region` where `country = 'US'` for physical goods | No buyer billing address is stored, so digital sales cannot be placed in a state (inv-05 headline 5) |

Build generically: one SQL function per counter, SECURITY INVOKER, service role only, parameterised by market config (thresholds, currency, window); a daily job writes snapshots and raises an attention row and a staff alert on crossing.

---

## 9. Existing-seller gap report (read-only SQL for the orchestrator)

SELECT only. Real table and column names. Output per account: seller id, handle, yes/no flags, non-personal counts, and the Terms version id (a document identifier, not personal data). Approximations: "present" means non-blank; the app's address and email quality filters (`address-quality.ts`, `email-quality.ts`) are not reproduced in SQL, so a placeholder value reads as present here. Remove the `demo` line if that schema is not readable by the role used.

```sql
-- Audit G, section 9: which fields capturable TODAY are missing, for every
-- account that owns a product, a storefront or an order. READ ONLY.
with sellers as (
  select owner_id as id from public.products
  union
  select owner_id from public.storefronts
  union
  select seller_id from public.orders
),
catalogue as (
  select p.owner_id,
         count(*)                                                     as products_total,
         count(*) filter (where p.status = 'active')                  as products_live,
         count(*) filter (where p.status = 'active'
                            and p.digital_file_key is null)           as physical_live,
         count(*) filter (where p.status = 'active'
                            and p.digital_file_key is null
                            and not (coalesce(p.details, '{}'::jsonb) ? 'safety'))
                                                                      as physical_live_without_gpsr
    from public.products p
   group by p.owner_id
),
sales as (
  select o.seller_id,
         count(*)                                              as orders_total,
         count(*) filter (where o.payment_ref like 'pi\_%')    as orders_paid_through_stripe
    from public.orders o
   group by o.seller_id
)
select
  s.id                                                                       as seller_id,
  pr.username                                                                as handle,
  (pr.id is not null)                                                        as has_profile_row,
  -- trader identity (publish gate fields)
  (nullif(btrim(pr.tax_business_name), '') is not null)                      as has_trader_name,
  (nullif(btrim(pr.seller_address), '') is not null)                         as has_address,
  (nullif(btrim(pr.seller_email), '') is not null)                           as has_contact_email,
  (pr.seller_email_verified_at is not null)                                  as contact_email_proven,
  -- country
  (pr.tax_country is not null)                                               as has_country,
  coalesce(pr.tax_country = 'CZ', false)                                     as country_is_cz,
  -- phone
  (nullif(btrim(pr.seller_phone), '') is not null)                           as has_phone,
  coalesce(pr.seller_phone ~ '^\+[1-9][0-9]{6,14}$', false)                  as phone_is_e164,
  (pr.seller_phone_verified_at is not null)                                  as phone_proven,
  -- VAT ID
  (nullif(btrim(pr.tax_vat_id), '') is not null)                             as has_vat_id,
  coalesce(upper(regexp_replace(pr.tax_vat_id, '[ .-]', '', 'g')) ~ '^CZ[0-9]{8,10}$', false)
                                                                             as vat_id_has_cz_shape,
  -- Terms
  (pr.legal_accepted_at is not null)                                         as terms_accepted_any,
  coalesce(pr.legal_accepted_version = 'tos-2026-11-06', false)              as terms_accepted_latest,
  pr.legal_accepted_version                                                  as terms_version,
  -- shipping and returns (profiles.shipping_policy jsonb)
  (pr.shipping_policy is not null)                                           as has_shipping_policy,
  case
    when jsonb_typeof(pr.shipping_policy -> 'destinations') = 'array' then exists (
      select 1
        from jsonb_array_elements(pr.shipping_policy -> 'destinations') d
       where jsonb_typeof(d -> 'rateCents') = 'number'
         and case when jsonb_typeof(d -> 'countries') = 'array'
                  then jsonb_array_length(d -> 'countries') > 0
                  else false end)
    else false
  end                                                                        as has_priced_delivery,
  coalesce(jsonb_typeof(pr.shipping_policy -> 'returnsWindowDays') = 'number'
           or nullif(btrim(pr.shipping_policy ->> 'returnsText'), '') is not null, false)
                                                                             as has_returns_info,
  -- context (counts, not personal data)
  coalesce(c.products_total, 0)                                              as products_total,
  coalesce(c.products_live, 0)                                               as products_live,
  coalesce(c.physical_live, 0)                                               as physical_live,
  coalesce(c.physical_live_without_gpsr, 0)                                  as physical_live_without_gpsr,
  coalesce(o.orders_total, 0)                                                as orders_total,
  coalesce(o.orders_paid_through_stripe, 0)                                  as orders_paid_through_stripe,
  (spa.owner_id is not null)                                                 as has_stripe_account,
  coalesce(spa.charges_enabled, false)                                       as stripe_charges_enabled,
  (pr.deletion_requested_at is not null)                                     as deletion_requested,
  exists (select 1 from demo.sales_sim d where d.seller_id = s.id)           as is_demo_seller
from sellers s
left join public.profiles pr                 on pr.id = s.id
left join catalogue c                        on c.owner_id = s.id
left join sales o                            on o.seller_id = s.id
left join public.seller_payment_accounts spa on spa.owner_id = s.id
order by pr.username nulls last, s.id;
```

Summary counts (same CTEs, no ids): wrap the select above as `with report as (...)` and run

```sql
select count(*)                                                as sellers,
       count(*) filter (where not has_trader_name)             as missing_trader_name,
       count(*) filter (where not has_address)                 as missing_address,
       count(*) filter (where not has_country)                 as missing_country,
       count(*) filter (where has_country and not country_is_cz) as country_not_cz,
       count(*) filter (where not has_contact_email)           as missing_contact_email,
       count(*) filter (where has_contact_email and not contact_email_proven) as email_unproven,
       count(*) filter (where not has_phone)                   as missing_phone,
       count(*) filter (where has_phone and not phone_proven)  as phone_unproven,
       count(*) filter (where not has_vat_id)                  as no_vat_id,
       count(*) filter (where not terms_accepted_any)          as no_terms,
       count(*) filter (where terms_accepted_any and not terms_accepted_latest) as terms_outdated,
       count(*) filter (where physical_live > 0 and not has_shipping_policy)    as physical_without_shipping,
       count(*) filter (where physical_live > 0 and not has_returns_info)       as physical_without_returns,
       count(*) filter (where physical_live_without_gpsr > 0)  as with_physical_live_without_gpsr
  from report;
```

Not checkable today because nothing stores them: seller type, trader status, legal names, DOB, place of birth, representative, structured address, residence countries, tax IDs, registration number, VIES/ARES results, sanctions, declarations, payout identifier, signup country (section 1).

---

## 10. Gap table, decisions, questions

### 10.1 Gap table (whole specification)

Size: S under a day, M a few days, L a week or more. Needs: owner decision, lawyer (texts or legal basis), tax adviser (formats), or nothing.

| # | Requirement | Status | Evidence | What is missing | Proposed approach (reuse) | Size | Needs |
|---|---|---|---|---|---|---|---|
| F1 | `seller_type` | MISSING | 1A row 1 | column, form branch | Service-role `seller_onboarding` table (D 7.2 `seller_tax_profiles`, renamed and widened); first question of the form and of the welcome seller step | S | nothing |
| F2 | `trader_status` + private-seller handling | MISSING | 1A row 2 | column, declaration record, buyer line, private notice | Column + declaration row; company forces trader; `ALLOW_PRIVATE_SELLERS` in market config; buyer line in `SellerBlock` and checkout | M | owner (`ALLOW_PRIVATE_SELLERS`), lawyer (notice text) |
| F3 | Legal first + last name | PARTIAL | 1A row 3 | split names, separate from trading name | Two columns in the private table; prefill from `tax_business_name`; public display of legal name for traders | S | nothing |
| F4 | Legal company name + register match | PARTIAL | 1A row 4 | column, ARES match | Column + ARES verifier (4.2) writing the verification log | M | nothing |
| F5 | Trading / shop name | PARTIAL | 1A row 5 | distinct required field | Keep `tax_business_name` as the published trading name (already guarded, moderated, shown everywhere); legal names move to the private table | S | nothing |
| F6 | Date of birth, reject under 18 | MISSING | 1A row 6 | field, age check, sealed storage | Sealed column (3.1), Zod age refine, prefill Stripe | S | lawyer (minimum age basis) |
| F7 | Place of birth (if no TIN) | MISSING | 1A row 7 | conditional field | Sealed columns city + country, shown only when the seller declares no TIN | S | tax adviser |
| F8 | Representative name + role | MISSING | 1A row 8 | fields, tie to the Terms record | Columns + included in the declaration row for company sellers | S | lawyer (authority evidence) |
| F9 | Primary address, structured | PARTIAL | 1B row 9 | structured parts, country | Private structured columns reusing the `ship_to` shape and formatter | S | nothing |
| F10 | Tax residence countries[] | PARTIAL | 1B row 10 | array, required | `char(2)[]` in the private table, default from the primary address country | S | tax adviser (multi-residence) |
| F11 | Email, verified | EXISTS (proof dormant) | 1B row 11 | proof on in production; "link" vs code | Keep; turn mail on; log proofs in the verification log | S | owner (code vs link) |
| F12 | Phone E.164, required | PARTIAL | 1B row 12 | required, SMS on, region fence vs CZ beta | Make required in the gate; require proof when SMS is on (same rule as email) | S | owner (required, SMS cost) |
| F13 | Public contact block (defaults to primary) | PARTIAL | 1B row 13 | primary/public split | Keep public fields on `profiles` (buyer read path unchanged), add structured public address; "same as primary" switch | M | lawyer (home address publication) |
| F14 | Returns / complaints address | MISSING | 1B row 14 | field, checkout display | Structured address inside `shipping_policy` (already service-role, already in the checkout data) or the public block; required when physical goods are live | S | nothing |
| F15 | `tax_ids[]` with per-country validators | MISSING | 1C row 15 | table, validators, sealing, fingerprint | `seller_tax_ids` (D 7.2) with sealed value, last4, HMAC fingerprint, type, issuing country; CZ validator (4.4) | M | tax adviser (which CZ identifiers) |
| F16 | VAT ID + VIES (date, consultation number) | PARTIAL | 1C row 16 | VIES call, result log | Keep `profiles.tax_vat_id` as the single published value (D 7.5); VIES verifier writes the log with `requestDate`, response hash, `requestIdentifier` when available | M | tax adviser (no consultation number) |
| F17 | Business registration + ARES | MISSING | 1C row 17 | fields, ARES, name match | Columns + IČO checksum + ARES verifier; required for companies, optional for individuals | M | nothing |
| F18 | EU permanent establishments | MISSING | 1C row 18 | field | `char(2)[]`, self-declared, companies | S | nothing |
| F19 | `stripe_account_id` | EXISTS | 1D row 19 | survives deletion; Standard type; country | Copy into the retained profile (D 7.6); store Stripe `country` and `requirements`; switch to Standard (A) | S | owner (account type approval) |
| F20 | Payout identifier + holder | MISSING | 1D row 20 | read or collect | Read `external_accounts` (last4, holder, fingerprint) at report time if test mode confirms (section 5); else Platform Tax Reporting | S to M | tax adviser (last4 enough?) |
| F21 | Terms acceptance as a versioned record | PARTIAL | 1E row 21 | history, IP, user, not REST-writable, gate | Insert-only `seller_declarations` written by `acceptLegal`; add to the gate (C X-2) | M | lawyer (IP retention) |
| F22 | Self-certification (shown to buyers) | MISSING | 1E row 22 | declaration + buyer line | Declaration row + line in the seller block | S | lawyer (text) |
| F23 | Privacy acknowledgement incl. DAC7 | MISSING | 1E row 23 | notice text, record | Privacy notice update (D 5.2) + declaration row | S (code) | lawyer |
| F24 | Categories[] + website URL | MISSING | 1E row 24 | fields, risk handling | Columns + list in constants (B P2); website `purchaseUrlSchema`-style validation (`validation/product.ts:432-439`) | S | owner (list, high-risk handling) |
| F25 | Product-safety role + default EU responsible person | MISSING | 1E row 25 | seller-level role and defaults | Columns on the seller profile; product form defaults from them (replacing the copy-from-last-product prediction as the source) | S | lawyer (role wording) |
| F26 | Verification log | MISSING | 1F row 26 | table | Insert-only `seller_verifications (field, method, result, reference, response_hash, verified_at, expires_at)`, written by code proofs, VIES, ARES, format checks, staff | M | nothing |
| F27 | Sanctions screening | MISSING | 1F row 27 | list ingest, matcher, review queue | Scheduled ingest of the official file into a service-role table, `pg_trgm` pre-filter, Admin review queue, `seller_sanctions_screens` log | L | owner (provider, reviewer), lawyer |
| F28 | Signup IP country + billing country | MISSING | 1F row 28 | capture | Store `cf-ipcountry` at sign-up (as the checkout pages already read it) and the plan checkout billing country from Stripe's snapshot | S | tax adviser (evidence rules) |
| F29 | Field change history | MISSING | 1F row 29 | table | Insert-only `seller_profile_changes (field, changed_by, changed_at, old_hash/new_hash or sealed values)`; triggers re-verification | M | nothing |
| F30 | GPSR manufacturer | PARTIAL | 1G row 30 | required for physical, website, country | Make the block required for live physical products (publish gate for that product); add country and website | S | nothing |
| F31 | GPSR EU responsible person | PARTIAL | 1G row 31 | rule + default | Required when manufacturer country is outside the EU; default from F25 | S | nothing |
| F32 | Product identifier + image | PARTIAL | 1G row 32 | type, barcode, image | Typed identifier + one image (reuse the gallery upload) | S | nothing |
| F33 | Warnings in the buyer's language | PARTIAL | 1G row 33 | per-language | Per-locale map (reuse the i18n locale list) | M | lawyer (language duty) |
| F34 | GPSR shown on page and embed | PARTIAL | 1G row 34 | embed display, quick add | Safety summary in the embed product view or block quick-add for physical items without it; also on checkout | S | lawyer (embed duty) |
| F35 | Not for digital | EXISTS | 1G row 35 | none | none | n/a | nothing |
| R1 | Completion gate | PARTIAL | section 7 | new conditions, readiness source | Extend the one predicate with booleans from a readiness source; split publish vs checkout | M | owner (`charges_enabled` scope) |
| R2 | DAC7 non-cooperation flow (request, 2 reminders, 60 days, block, no re-registration) | MISSING | D 8.1 #21 | trail, job, enforcement, blocklist | `seller_tax_requests` (D 7.2), daily job, notifications + email, enforcement behind a database switch, HMAC blocklist | M | lawyer, tax adviser |
| R3 | Re-verification (36 months, yearly prompt) | MISSING | none | job and prompt | `expires_at` in the verification log; yearly attention row + email; gate warns then blocks | S | owner (warn vs block) |
| R4 | Public seller info for traders everywhere | PARTIAL | 1H; C section 7 | storefront/embed show name only; email lacks phone; no register, self-cert, trader status | One "Seller info" component used by product page, checkout, storefront, embed and the email text builder | M | lawyer (private notice) |
| R5 | Field-level encryption | MISSING (helper exists) | 3.1 | module, key, rotation | Generalise `passkey-crypto.ts` with a new key and key id | M | owner (key custody) |
| R6 | Admin-only access with access logging | PARTIAL | 3.3 | logged reveals | Admin "reveal" action that logs (fail closed) before decrypting | M | nothing |
| R7 | Never in logs, analytics, URLs, MCP | PARTIAL | 1H | guards for new fields | Never in the gate input, `buildSellerIdentity`, classifier or present layer; a unit test asserting the private columns appear in no select outside the onboarding module | S | nothing |
| R8 | Retention jobs (10 years / 6 months) | MISSING (conflict) | section 6 | freeze, retain, purge | Freeze before `deleteUser`, no cascading FKs, purge job | M | lawyer, tax adviser |
| R9 | Self-service view, edit, export; re-verify on edit | PARTIAL | `export/route.ts`; `/settings/business` | new fields in export and form; re-verify | Extend both; change-history trigger raises re-verification | M | nothing |
| R10 | Threshold counters (generic, per market) | MISSING | section 8 | functions, snapshots, `paid_at` | SQL functions + daily job + attention row | M | tax adviser (definitions) |
| R11 | Pluggable per-country validators | MISSING | 4.4 | module | Market-config validator registry, CZ first | M | tax adviser |
| R12 | Existing sellers: report + "complete your profile" with deadlines, no deletion | PARTIAL | section 9; attention rows; checklist | deadlines, reminders | Gap query (section 9), attention row with a date, reminder emails | S | owner (deadline, grace for live listings) |
| R13 | Drafts before onboarding is complete | EXISTS | drafts never gated (`Store/src/lib/products/actions.ts:327-339`, inv-01 G1) | none | keep | n/a | nothing |
| R14 | No ID scans or beneficial owners stored by us | EXISTS | nothing stored (section 5) | none | keep; never read the Persons API into our DB | n/a | nothing |

### 10.2 Decisions the owner must make

1. `ALLOW_PRIVATE_SELLERS`: may private persons sell at all (in the beta and later)?
2. `charges_enabled`: publish gate or checkout gate only; and whether listings that sell through the seller's own link or an enquiry email stay publishable without Stripe (section 7.4).
3. Approve the switch to Standard accounts (Audit A), which decides what Stripe lets us read (section 5).
4. Collect DAC7 identity ourselves, request Stripe Platform Tax Reporting, or both (D 6.3); and whether to prefill Stripe from our form before the first Account Link.
5. Email proof by in-session code (today) instead of a link (specification).
6. Phone required, and turning SMS on in production (cost, region fence).
7. Deadline and grace period for existing sellers' "complete your profile", and whether existing live listings stay up during it.
8. Category list and how high-risk categories are handled (B P2).
9. Sanctions: official file ingest built in-house or a vendor; who reviews potential matches; re-screen frequency; OFAC timing.
10. Encryption key custody: new key, rotation policy, which staff may reveal private fields.
11. Re-verification overdue: warn or block.
12. Whether VIES or ARES being unavailable lets a seller publish pending verification (fail open) or holds them (fail closed).
13. Which markets enable which threshold counters.

### 10.3 Questions for the lawyer

1. Is Square Share an "online marketplace" for consumer law (trader/non-trader display) and an online platform under DSA Section 4? DSA Art. 29 appears to exclude providers that are micro or small enterprises from Arts. 30 to 32: does it, for this operator, and what remains of the Art. 30 duties (self-certification, 6-month storage) if so?
2. Text of the trader-status declaration, the private-seller notice ("consumer-protection rights do not apply"), the self-certification, the product-safety role choices, and the privacy acknowledgement.
3. Retention: may Art. 30 data be deleted before six months on the seller's request; retention period for Terms acceptance records (with IP), verification logs, sanctions screening records and change history; how the privacy notice must describe all of it.
4. Lawful basis and limits for processing the Czech birth number (rodné číslo), date of birth and place of birth; for keeping a fingerprint blocklist to prevent re-registration.
5. Sanctions screening of sellers: basis, and whether a block after a confirmed match is an automated decision needing safeguards (GDPR Art. 22).
6. Minimum age 18: is a DOB check required or is a declaration sufficient; consequences for existing accounts.
7. May a home-based trader publish a business address different from the registered address; what if they have none?
8. Does the embed have to show GPSR information itself, or is a link to the product page enough; must warnings be in the buyer's language?
9. Is an ARES match ("informative only") adequate verification of a registration number?
10. Representative authority: is a declaration enough, or is evidence needed?

### 10.4 Questions for the tax adviser

1. Czech TINs: individuals (birth number or DIČ), entities (DIČ or IČO), non-residents; the exact formats and checks in 4.4; whether any birth-number reform affects validation.
2. VIES without a consultation number (operator not VAT-registered): is our stored result evidence enough, or should the operator obtain a VAT identification so checks carry a consultation number?
3. DAC7 retention: 10 years from the end of which year, and does it apply to sellers who were never reportable (excluded small sellers, sellers with no consideration)?
4. Place-of-birth fallback: when exactly does a country "not issue" a TIN for this purpose?
5. Payout identifier: is last 4 + holder name (what Stripe returns) acceptable?
6. Signup IP country and billing country as evidence for VAT on our own fees, given the operator's VAT status.
7. Counter definitions: what is "a sale", which timestamp and time zone, currency conversion for the EUR 2,000 test (also D 8.2).
8. Multiple tax residences: how to capture and report.

### 10.5 What could not be determined

- Production switches: whether `SMS_ENABLED` and `TRANSACTIONAL_EMAIL_ENABLED` are set (C found mail off on disk; a dashboard-set variable would not show).
- VIES: official terms of use, rate limits, error code list, behaviour with an invalid requester number, whether CZ returns name and address (Commission pages are a single-page app; read the OpenAPI file and secondary sources only).
- ARES: numeric limits beyond 500 per minute, authentication needs per endpoint, licence, whether cloud egress IPs are throttled.
- EU sanctions file: exact current download URLs, token process and reuse licence, current v1.1 XML element names (the FSF site could not be fetched).
- Stripe: whether `external_accounts` are in practice returned for a platform-created Standard account after onboarding (the KYC-lock sentence vs the `is_controller` rule); whether Platform Tax Reporting applies to this configuration (D 6.2).
- Whether CZ applies any Czech-specific DAC7 retention period different from the specification's 10 years.
- Production data: the section 9 query is for the orchestrator to run.
