# P3b: Universal seller onboarding data (1B), application design (Store and Admin)

Design document, 2026-11-22. Scope: the application side of the owner's P0 build "1B: universal seller onboarding data" in the Store repo, plus the small Admin parts. The data side (tables, encryption at rest, retention, DDL) is the sibling data architect's design; the interface between the two is fixed in the brief and restated where it is used, and every point where this design needs something from the data side, or thinks the interface is wrong, is listed in 13.4.

Nothing here has been built or run. Every `file:line` was read on disk at `main` / `e43eedd` plus the working tree on 2026-11-22, except lines marked "(from G)", "(from P1a)", "(from P2)" or "(from inv-01)", which come from those documents and were not re-opened. No server, test, build, Stripe, Supabase, production URL, registry or MCP tool was used; VIES and ARES facts come from Audit G section 4 (which read the public OpenAPI files).

**Not legal or tax advice.** Every legal wording below (the private-seller notice, the self-certification, the privacy acknowledgement, the trader-status statements, the representative statement, the DAC7 request) is a DRAFT for the lawyer, held as a message key plus a version so it can change without code changes. Every Czech identifier format is "to be verified with the tax adviser" and lives in one table per country (section 3), so a correction is an edit to that table and its tests.

Inputs: `docs/compliance/audit/G-seller-onboarding-data.md` (G), `plan/P1a-app-enforcement-design.md` (P1a, sections 4 and 10), `plan/P2-messaging-waitlist-czech-design.md` (P2, sections 3, 4, 8), `plan/P1b-database-guards-design.md` (P1b, sections 1 and 10), `inventory/01-store-sellers-accounts.md` (inv-01), `audit/B-moderation-dsa.md` (B), `docs/styles.md`, `~/.claude/lab.md`, the memory notes named in the brief, and the code cited below.

Naming used here for the data architect's tables (by role, the brief's list): profile, addresses, tax residence, tax IDs, VAT ID, registration, permanent establishments, payout identifier, declarations, verification log, sanctions screening, change history, signup evidence, the completion status row, the DAC7 request record, the re-registration blocklist. Code sketches use placeholder table names (`seller_profiles`, `seller_completion_status`, ...) through ONE constant map, `SELLER_TABLES` in `src/lib/seller-profile/tables.ts`, so the real names land as one edit.

---

## 0. Decisions in one page

1. **One list drives everything.** `SELLER_FIELDS` in `src/lib/seller-profile/fields.ts` is a typed, pure, client-safe table: one entry per field with its section, who it applies to, a requiredness rule ("only if applicable" is a named rule id), sensitivity (public / private / sealed), buyer display, retention class, validator key, verification methods, declaration and storage role. The form, the completeness computation, the Seller info projection, the data export, the masking and the MCP leak guard all iterate it. Adding a field is one entry, its copy keys and one column from the data architect.
2. **One universal form, two shells.** The same step components render as a linear wizard for a new seller and as section cards for editing, both at `/settings/business` (the existing `TRADER_IDENTITY_HREF`, `src/lib/settings/trader-identity.ts:57`). Step 0 is P2's `CountryStep`. Country changes validation only, never which steps exist. "Business & seller details" (`TaxSection.tsx`) is retired and replaced by the overview shell; `saveTaxInfo` is retired with it.
3. **Every step saves a draft.** One server action, `saveSellerProfile`, takes a `section` and writes only that section's fields. Invalid values are refused; missing values are allowed. A draft can never satisfy the gate because completeness is computed from the field list, not stored as progress.
4. **Pluggable country modules.** `src/lib/seller-profile/countries/` holds a `CountryModule` interface and `CZ_MODULE` (IČO mod 11, DIČ, rodné číslo with offsets and the pre-1954 and check-digit exceptions, postcode, phone region, registers, VIES and ARES). A country with no module gets `genericCountryModule(code)`: shape checks, free register name, VIES for EU VAT. During the beta step 0 makes it unreachable.
5. **Sealing is ours, at the edge.** A new `src/lib/crypto/field-sealing.ts` generalises `passkey-crypto.ts` (`:62-100`) with its own keys (`SELLER_SEALING_KEYS` with key ids, `SELLER_FINGERPRINT_KEY`), a versioned envelope `sv1.<kid>.<payload>`, AAD bound to table, column and owner, and an `openField` that demands an unseal grant object only three code paths can mint (owner after step-up, logged staff reveal, the later DAC7 report job).
6. **Sanctions DOB matching without unsealing.** The DOB is stored sealed plus two keyed fingerprints (full date, year). The screener fingerprints the list's (often partial) birth dates with the same key and compares, so screening never opens a sealed value (request to the data architect, 13.4).
7. **VIES and ARES are synchronous with a short timeout, then retried.** "Unavailable" is pending, never invalid. Recommended policy (owner's decision): pending does not block for 72 hours, then blocks. ARES name match is normalise, then match / near match / mismatch, with "use the register's spelling" for a near match. For CZ companies the identity step asks the IČO first and prefills the name and registered office from ARES, so most companies never see a near match.
8. **Sanctions list refresh runs on GitHub Actions**, which parses the 25 MB official XML on the runner and posts normalised entries to a cron-secret route in chunks. Seller data never leaves the Worker and the database. Matching is exact and normalised first, trigram candidates second, a person decides every candidate. Minimum honest beta: a recorded screening result for every seller, by the automatic screen or by a staff search recorded in Admin.
9. **The gate extends P1a's `sellerGateReasons`** with named 1B reasons (`details_missing` widened, `details_invalid`, `contact_unproven`, `declaration_missing`, `verification_pending`, `verification_failed`, `sanctions_pending`, `sanctions_blocked`, `payments_not_ready`, `reverification_due`, `dac7_noncooperation`, `reregistration_blocked`), each with an effect on publishing and on checkout, a scope (seller or physical offers only) and whether a grace period may soften it.
10. **One status row per seller, recomputed by our code, read everywhere in the same query.** The row is embedded into `TRADER_GATE_SELECT` (`seller-identity.ts:81-82`), so all 12 gate sites (G 7.1) get it with no new round trip. It carries effective block reasons, `blocks_from` (so a deadline takes effect at the exact second, also in the DB guard), the buyer-facing `public_info` projection, and `stale_since` set by database triggers so a missed recompute is visible, swept and alerted, never silent.
11. **Seller info**: one component and one text builder fed only by `public_info`, used on the product page foot, the checkout disclosure, a dialog from the hosted storefront footer and from the embed frame's "Sold by" line, and the order confirmation email. P2's delivery line stays separate.
12. **Product safety extends `products.details.safety`** with manufacturer country, website as an alternative to email, an identifier type, an identifier image and per-language warnings; an EU responsible person is required when the manufacturer is outside the EU and defaults from the seller profile; a complete block is required to publish a physical product.
13. **Nothing sensitive reaches MCP.** No new tool, no action becomes a tool, `findSecret` (`src/lib/agent/secrets.ts:25-42`) learns the sealed envelope and every non-public field key from the field list, and a leak test feeds sentinel values through every read tool.
14. **Staged rollout without a runtime switch** (consistent with P1a 7.3): a code constant `SELLER_PROFILE_GATE = "notice" | "enforce"`; notice computes and shows everything and blocks nothing; enforce is a one-line branch the owner approves after reading the gap report. Existing sellers get a per-seller deadline (default 30 days after enforcement); nothing is deleted; at the deadline selling stops.
15. **Defaults so the build is not blocked** (13.1): private sellers off in the beta; email proof stays an in-session code; phone required; `charges_enabled` blocks checkout only until Connect is live, then publishing too; verification fail-open for 72 hours; re-verification warns 30 days then blocks; in-house official sanctions list with the owner as reviewer.

---

## 1. The field specification as data

### 1.1 Module layout

All new Store code for 1B lives under `src/lib/seller-profile/` (the home P2 4.3 already proposed for `completeness.ts`), `src/lib/crypto/` and `src/components/seller-profile/`. No barrel `index.ts` (P1a 1.1 notes the codebase imports by path).

| File | Contents | Client-safe |
|---|---|---|
| `src/lib/seller-profile/fields.ts` | THE LIST: `SELLER_FIELDS`, `SellerFieldKey`, `SellerFieldSpec`, the section order `SELLER_SECTIONS` | yes |
| `src/lib/seller-profile/rules.ts` | `SELLER_RULES` (named "only if applicable" predicates over `SellerFormFacts`), `appliesTo`, `isAsked`, `isRequired` | yes |
| `src/lib/seller-profile/declarations.ts` | `DECLARATION_DOCUMENTS` (id, current version, text key, who signs) and `declarationCurrent` | yes |
| `src/lib/seller-profile/product-safety-fields.ts` | `PRODUCT_SAFETY_FIELDS` (same entry type, `scope: "product"`) | yes |
| `src/lib/seller-profile/policy.ts` | Every 1B policy constant, each with a one-line doc comment: `SELLER_PROFILE_GATE`, `ALLOW_PRIVATE_SELLERS`, `PAYMENTS_REQUIRED_FOR`, `VERIFICATION_PENDING_GRACE_HOURS`, `VERIFICATION_RETRY_MINUTES`, `REVERIFY_AFTER_MONTHS`, `REVERIFY_WARN_DAYS`, `CONFIRM_DETAILS_EVERY_MONTHS`, `EXISTING_SELLER_GRACE_DAYS`, `DAC7_LADDER`, `MIN_SELLER_AGE_YEARS`, `STATUS_RULES_VERSION` | yes |
| `src/lib/seller-profile/reasons.ts` | `SELLER_REASON_EFFECTS` (publish / checkout / scope / graceable per reason), reason copy keys and fix destinations | yes |
| `src/lib/seller-profile/masking.ts` | `maskHint(kind, value)` (computed once at seal time), `SEALED_FIELD_KEYS`, `NON_PUBLIC_FIELD_KEYS` (derived from the list) | yes |
| `src/lib/seller-profile/display.ts` | `buildSellerInfo(values, facts)`: the buyer projection, reading only entries with `buyers.show` | yes |
| `src/lib/seller-profile/completeness.ts` | P2's module (P2 B7 creates it with the `country` item); 1B derives its items from the status reasons and the list | yes |
| `src/lib/seller-profile/tables.ts` | `SELLER_TABLES`: role to table name; sealed / hint / fingerprint column suffixes (13.4 item 4) | yes |
| `src/lib/seller-profile/schemas.ts` | `sectionSchema(section, module, facts)`: Zod schemas built from the list and the country module | yes |
| `src/lib/seller-profile/facts.ts` | SERVER ONLY. `readSellerFacts(ownerId)`: one service-role read across the seller tables returning `SellerFacts` (presence flags, booleans, codes, dates, hints; never a sealed value) | no |
| `src/lib/seller-profile/status.ts` | Pure `computeSellerStatus(facts, now)`; SERVER `recomputeSellerStatus(ownerId, cause)` writes the status row | split: pure part client-safe |
| `src/lib/seller-profile/actions.ts` | `"use server"`: `saveSellerProfile`, `acceptSellerDeclarations`, `confirmSellerDetails` | no |
| `src/lib/seller-profile/unseal.ts` | SERVER ONLY. `ownerUnsealGrant()`, the only Store mint of an owner grant | no |
| `src/lib/seller-profile/export.ts` | SERVER ONLY. `buildSellerDataExport(ownerId, grant)` (grant may be null) | no |
| `src/lib/seller-profile/countries/{types,registry,cz,generic,checksums,vat-prefixes}.ts` | Section 3 | yes |
| `src/lib/seller-profile/verification/{vies,ares,name-match,log,retry}.ts` | Section 4 (name-match pure; clients server only) | split |
| `src/lib/seller-profile/sanctions/{normalise,match,screen,ingest}.ts` | Section 5 (normalise and match pure) | split |
| `src/lib/seller-profile/dac7.ts` | Section 6.8 ladder (pure schedule + server runner) | split |
| `src/lib/crypto/field-sealing.ts` | SERVER ONLY. Section 2.8 | no |
| `src/components/seller-profile/*` | The step components, the two shells, `SellerInfo`, `DateOfBirthField`, `StructuredAddressFields` | client |

### 1.2 The entry type

```ts
// src/lib/seller-profile/fields.ts
import type { MessageKey } from "@/i18n/types";
import type { OperatingCountryCode } from "@/lib/format/country";

export type SellerType = "individual" | "company";
export type TraderStatus = "trader" | "private";

/** The form's sections, in order. One step (or a few) per section in the wizard,
 *  one card per section in Settings. */
export const SELLER_SECTIONS = ["market", "identity", "contact", "public", "tax", "registration", "selling", "declarations", "payments", "system"] as const;
export type SellerSectionId = (typeof SELLER_SECTIONS)[number];

export type AppliesTo = "individual" | "company" | "both";

/** When a field blocks the gate. "Only if applicable" is always a named rule. */
export type Requiredness =
  | { kind: "required" }                          // for everyone it applies to
  | { kind: "requiredWhen"; rule: SellerRuleId }  // only while the rule holds
  | { kind: "optional" }                          // asked, never blocks
  | { kind: "system" };                           // never asked: captured or read from Stripe

/** public: may be shown to buyers and returned to MCP (only through the
 *  buyer projection). private: owner, staff and our server code only.
 *  sealed: stored only as an `sv1.` envelope, opened only with a grant. */
export type Sensitivity = "public" | "private" | "sealed";

/** Where a buyer sees it: a slot in the Seller info block, and for whom. */
export type BuyerDisplay =
  | { show: false }
  | { show: true; when: "always" | "trader"; slot: SellerInfoSlot };

export type SellerInfoSlot =
  | "legalName" | "tradingName" | "traderStatus" | "address" | "email" | "phone"
  | "registration" | "vatId" | "country" | "selfCertification" | "returnsAddress";

/** The data architect's retention class (G 6.1). */
export type RetentionClass = "dac7" | "dsa30" | "dac7_dsa30" | "privacy";

export type VerificationMethod = "format" | "code" | "vies" | "ares" | "sanctions" | "stripe" | "manual";

export type SellerFieldSpec = {
  key: SellerFieldKey;
  section: SellerSectionId;
  appliesTo: AppliesTo;
  /** Asked only while this holds (absent: always asked of those it applies to). */
  askWhen?: SellerRuleId;
  required: Requiredness;
  sensitivity: Sensitivity;
  buyers: BuyerDisplay;
  retention: RetentionClass;
  /** Key into the validator table (schemas.ts), which consults the country module. */
  validator: ValidatorKey | null;
  verification: readonly VerificationMethod[];
  /** The versioned declaration this field is recorded under, if any. */
  declaration?: DeclarationDocId;
  /** Re-verify when the value changes, and the maximum age of a check. */
  reverify?: { onChange: true; maxAgeMonths?: number };
  /** Where the value lives, by role. "published" = the existing profiles column
   *  kept as the published copy (13.4 item 6). "computed" = derived, not stored. */
  storage:
    | { role: SellerTableRole; column: string }
    | { role: "published"; column: "tax_business_name" | "seller_address" | "seller_email" | "seller_phone" | "tax_vat_id" | "tax_country" }
    | { role: "computed" };
  label: MessageKey;
  /** One caveat sentence behind the "?" (styles.md 8.13). */
  tip?: MessageKey;
  /** The id on the field wrapper: deep links, the gate's "fix" link, universal search. */
  anchor: string;
  /** Markets where the field exists at all (absent: every market). US INFORM fields carry ["US"]. */
  markets?: readonly OperatingCountryCode[];
};
```

Derived, never hand-written per field: the export policy (public and private export as values; sealed only with an owner grant, else the hint), the MCP policy (public only through `public_info`; private and sealed never), the Admin policy (sealed only through the logged reveal), the log policy (no value of any field is ever logged: section 8.6).

### 1.3 Requiredness and applicability rules

`SELLER_RULES: Record<SellerRuleId, (facts: SellerFormFacts) => boolean>` in `rules.ts`. `SellerFormFacts` holds only answers and booleans (seller type, trader status, establishment country, which residence countries declared "no TIN", yes/no answers, whether any product is physical), never a sealed value, so the same predicates run in the browser (to show or hide a question) and on the server (to decide the gate).

| Rule id | Holds when |
|---|---|
| `isIndividual` / `isCompany` | `sellerType` is that value |
| `privateSellersAllowed` | `ALLOW_PRIVATE_SELLERS` (policy.ts) is true for the establishment country's market |
| `noTinForSomeResidence` | individual, and at least one tax residence country is declared "this country did not issue me a tax number" (allowed only where the country module says `tinMayBeAbsent.individual`) |
| `tinRequiredForEachResidence` | for each residence country without a "no TIN" declaration, one tax ID of a `dac7Tin` type from that country's module |
| `publicContactDiffers` | the "show buyers the same details" switch is off |
| `hasVatId` | answered "yes, VAT registered" |
| `hasRegistration` | company, or an individual who answered "yes, I have a trade licence or business number" |
| `hasPermanentEstablishments` | company and answered yes |
| `sellsPhysical` | a chosen product category is physical (category list carries the flag), or the account owns any product without a download file (`digital_file_key is null`, the test Audit G section 9 uses) |
| `goodsMadeOutsideEu` | `sellsPhysical` and answered "some of my goods are made outside the EU" |
| `returnsDiffer` | `sellsPhysical` and the "returns go to my public address" switch is off |

### 1.4 The full seller-level field table

Columns: Sec = section; Applies = individual (I), company (C), both (B); Req = requiredness (rule ids from 1.3); Sens = public / private / sealed; Buyers = slot and condition; Ret = retention class; Validator = key in `schemas.ts` (section 3 for country-specific ones); Verif = verification methods; Decl = declaration document; Storage = data architect role (placeholder column).

| # | Key | Sec | Applies | Req | Sens | Buyers | Ret | Validator | Verif | Decl | Storage |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `establishmentCountry` | market | B | required | public | `country`, always | dac7_dsa30 | `establishmentCountry` (storable seller country; the market check is the gate's, P1a 4.4) | stripe (account country must match, P1a 4.7) | | addresses: primary `country` (also copied to `profiles.tax_country`, published) |
| 2 | `sellerType` | identity | B | required | private | no | dac7 | `choice` | stripe (cross-check `business_type`, G 5) | | profile `seller_type` |
| 3 | `traderStatus` | identity | B | required (company: fixed `trader`; individual: choice only when `privateSellersAllowed`, else the trader statement) | public | `traderStatus`, always | privacy | `choice` | | `traderStatus` | profile `trader_status` |
| 4 | `legalFirstName` | identity | I | required | private | `legalName`, trader | dac7_dsa30 | `personName` | sanctions, stripe (cross-check) | | profile `legal_first_name` |
| 5 | `legalLastName` | identity | I | required | private | `legalName`, trader | dac7_dsa30 | `personName` | sanctions, stripe | | profile `legal_last_name` |
| 6 | `legalCompanyName` | identity | C | required | public | `legalName`, always | dac7_dsa30 | `companyName` | ares (module), sanctions, stripe | | profile `legal_company_name` |
| 7 | `tradingName` | identity | B | required | public | `tradingName`, always | dsa30 | `tradingName` (content classifier, `sellerTextRefusal`, G 1A row 3) | | | published `tax_business_name` (already service-role only, G 1 recurring facts) |
| 8 | `dateOfBirth` | identity | I | required | sealed | no | dac7 | `dateOfBirth` (real date, not future, at least `MIN_SELLER_AGE_YEARS` = 18) | format, sanctions (fingerprint) | | profile `dob_sealed`, `dob_fp_full`, `dob_fp_year` (13.4 item 2) |
| 9 | `placeOfBirth` (city, country) | tax | I | requiredWhen `noTinForSomeResidence` (askWhen same) | sealed | no | dac7 | `placeOfBirth` | format | | profile `birthplace_sealed`, hint = country |
| 10 | `representativeName` | identity | C | required | private | no | privacy | `personName` | | `representativeAuthority` (snapshot) | profile `representative_name` |
| 11 | `representativeRole` | identity | C | required | private | no | privacy | `shortText` | | `representativeAuthority` (snapshot) | profile `representative_role` |
| 12 | `primaryAddress` (street, postcode, city; country = #1) | contact | B | required | private | no (buyers see #17) | dac7_dsa30 | `postalAddress` (postcode from module) | ares (compare with registered office, informative) | | addresses: role `primary` |
| 13 | `email` | contact | B | required | private | no (buyers see #18) | dsa30 | `contactEmail` (format, quality, MX: `settings.ts:106-115`, `actions.ts:491-495`) | code | | published `seller_email` + its proof (`20260926_contact_verification.sql`, from G) |
| 14 | `phone` | contact | B | required (owner decision 13.1 #3) | private | no (buyers see #19) | dsa30 | `phone` (`normalizeSellerPhone`, region from #1, G 1B row 12) | code (when SMS is on) | | published `seller_phone` + its proof |
| 15 | `publicContactSameAsPrimary` | public | B | required (default on) | private | no | dsa30 | `boolean` | | | profile `public_same_as_primary` |
| 16 | (reserved: legacy free-text public address shown as a hint while an existing seller structures it) | | | | | | | | | | read-only from published `seller_address` |
| 17 | `publicAddress` | public | B | required (equals #12 while #15 is on) | public | `address`, always | dsa30 | `postalAddress` | | | addresses: role `public`; formatted copy to published `seller_address` |
| 18 | `publicEmail` | public | B | required (equals #13 while #15 is on) | public | `email`, always | dsa30 | `contactEmail` | code when it differs (owner 13.1 #2b) | | profile `public_email` |
| 19 | `publicPhone` | public | B | required (equals #14 while #15 is on) | public | `phone`, always (shown only once proven, as today: `seller-identity.ts:156-158`) | dsa30 | `phone` | code | | profile `public_phone` |
| 20 | `taxResidenceCountries` | tax | B | required (default [#1]) | private | no | dac7 | `countryList` (storable list) | | | tax residence rows |
| 21 | `taxIds[]` {number, issuingCountry, type} | tax | B | requiredWhen `tinRequiredForEachResidence` | sealed (number); type and country private | no | dac7 | `taxId` (module type) | format | | tax IDs: `number_sealed`, `number_hint`, `number_fp`, `type`, `issuing_country` |
| 22 | `noTinDeclarations[]` (per residence country) | tax | I | optional (askWhen the module allows it) | private | no | dac7 | `countryList` | | | tax residence rows `no_tin_declared` |
| 23 | `vatId` {number, country} | tax | B | optional (askWhen `hasVatId`) | public | `vatId`, always | dac7 | `vatId` (module) | format, vies | | VAT ID row; copy to published `tax_vat_id` |
| 24 | `businessRegistration` {register, number, country, fileReference?} | registration | C required; I optional (askWhen `hasRegistration`) | (as left) | public | `registration`, trader | dac7_dsa30 | `registration` (module) | format, ares (module) | | registration row |
| 25 | `permanentEstablishments[]` | registration | C | optional (askWhen `hasPermanentEstablishments`) | private | no | dac7 | `countryList` (EU codes) | | | permanent establishment rows |
| 26 | `productCategories[]` | selling | B | required | private | no | privacy | `categoryList` (owner's list, 13.1 #10) | | | profile `categories` |
| 27 | `websiteUrl` | selling | B | optional | private | no | privacy | `url` (same rules as `purchaseUrlSchema`, `validation/product.ts:432-444`) | | | profile `website_url` |
| 28 | `productSafetyRole` | selling | B | requiredWhen `sellsPhysical` (askWhen same) | private | no | privacy | `choice` (manufacturer, importer, distributor) | | | profile `safety_role` |
| 29 | `goodsMadeOutsideEu` | selling | B | requiredWhen `sellsPhysical` | private | no | privacy | `boolean` | | | profile `goods_outside_eu` |
| 30 | `defaultResponsiblePerson` {name, address, email} | selling | B | requiredWhen `goodsMadeOutsideEu` | private (public once copied onto a product) | no | privacy | `responsiblePerson` | | | profile `default_rp_*` |
| 31 | `returnsAddress` | selling | B | requiredWhen `sellsPhysical` (equals #17 unless `returnsDiffer`) | public | `returnsAddress`, always (checkout) | privacy | `postalAddress` | | | addresses: role `returns` |
| 32 | `stripeAccount` | payments | B | system (feeds `payments_not_ready` only) | private | no | dac7 | | stripe | | `seller_payment_accounts` (existing, G 1D row 19) |
| 33 | `payoutIdentifier` | payments | B | system, never blocks ("where available") | sealed | no | dac7 | | stripe | | payout identifier row `identifier_sealed`, hint last 4 |
| 34 | `payoutHolderName` | payments | B | system, never blocks | sealed | no | dac7 | | stripe | | payout identifier row `holder_sealed` |
| 35 | `sellerTerms` | declarations | B | required (any version blocks when absent; an outdated version warns, 13.1 #14) | private | no | privacy | | | `sellerTerms` | declarations (+ `profiles.legal_accepted_*` cache kept in sync, interface item 6) |
| 36 | `selfCertification` | declarations | B | required | public | `selfCertification`, always | dsa30 | | | `selfCertification` | declarations |
| 37 | `privacyAcknowledgement` | declarations | B | required | private | no | privacy | | | `privacyAcknowledgement` | declarations |
| 38 | `representativeAuthority` | declarations | C | required | private | no | privacy | | | `representativeAuthority` | declarations |
| 39 | `sanctionsScreening` | system | B | system (feeds `sanctions_*`) | private | no | privacy | | sanctions, manual | | sanctions screening rows |
| 40 | `signupIpCountry`, `signupDeclaredCountry`, `billingCountry` | system | B | system, never blocks | private | no | privacy | | | | signup evidence row |
| 41 | `detailsConfirmedAt` | system | B | system (feeds `reverification_due`) | private | no | privacy | | | `detailsConfirmation` | declarations |
| 42 | (verification log, change history) | system | B | system | private | no | per field | | | | verification log, change history |

Count against the specification: identity 8 items (2 to 11), contact and addresses 6 (1, 12 to 19, 31), tax and registration 5 (20 to 25, 9), payments 2 (32 to 34), declarations 5 (3, 26 to 30, 35 to 38), system 6 (39 to 42 plus the logs). The specification's "email (req; verify via link)" is #13 with its proof (section 2.9).

### 1.5 Declarations as data

```ts
// src/lib/seller-profile/declarations.ts
export const DECLARATION_DOCUMENTS = {
  /** The Terms of Service: version from the Terms register, text on Home. */
  sellerTerms: { version: LEGAL_VERSION, text: { kind: "link" }, signedBy: "account" },
  /** DSA Art. 30(1)(e) self-certification. DRAFT text for the lawyer. */
  selfCertification: { version: "selfcert-draft-1", text: { kind: "key", key: "SellerProfile.declarations.selfCertification.text" }, signedBy: "account" },
  /** Privacy notice read, incl. reporting to tax authorities (DAC7). DRAFT. */
  privacyAcknowledgement: { version: "privacyack-draft-1", text: { kind: "key", key: "SellerProfile.declarations.privacyAcknowledgement.text" }, signedBy: "account" },
  /** Trader or private person. DRAFT, two texts, one chosen. */
  traderStatus: { version: "traderstatus-draft-1", text: { kind: "choice", keys: { trader: "SellerProfile.declarations.traderStatus.trader", private: "SellerProfile.declarations.traderStatus.private" } }, signedBy: "account" },
  /** Company only: authority to accept on the company's behalf. DRAFT. */
  representativeAuthority: { version: "repauth-draft-1", text: { kind: "key", key: "SellerProfile.declarations.representativeAuthority.text" }, signedBy: "representative" },
  /** The yearly "these details are still right". */
  detailsConfirmation: { version: "confirm-1", text: { kind: "key", key: "SellerProfile.declarations.detailsConfirmation.text" }, signedBy: "account" },
} as const satisfies Record<string, DeclarationDocument>;
export type DeclarationDocId = keyof typeof DECLARATION_DOCUMENTS;
```

Each acceptance writes one append-only declaration record: document id, version, the chosen option (trader status), the representative snapshot (company), `accepted_at`, the request IP (`cf-connecting-ip`, raw or hashed per the data architect and the lawyer, G 10.3 Q3), the user id (the signed-in person, which for a team member acting on the owner's store is still refused: declarations are the owner's own act, as `saveTaxInfo` is today, `actions.ts:446-451`), the surface (`welcome`, `settings`, `confirm`) and the locale.

A unit test (`tests/unit/seller-profile/declarations.test.ts`) pins a SHA-256 of each English text per version, so editing a draft text without bumping its version fails the suite. The lawyer's final text is then a version bump plus the new text, nothing else.

### 1.6 Product-level fields

`PRODUCT_SAFETY_FIELDS` uses the same entry type with `scope: "product"` and storage `{ role: "product_details", column: "safety.<key>" }`. All public (shown on the product page), retention "product" (lives and dies with the product).

| Key | Req (physical products only) | Validator | Change vs today (`validation/product.ts:399-420`) |
|---|---|---|---|
| `manufacturerName` | required | `singleLineText` 120 | none |
| `manufacturerAddress` | required | `multiLineText` 300 | none |
| `manufacturerCountry` | required | storable country code (ISO) | NEW: decides whether an EU responsible person is needed |
| `manufacturerEmail` | one of email or website required | `emailAddress` | becomes optional on its own |
| `manufacturerWebsite` | (as above) | `url` | NEW (GPSR allows "electronic address") |
| `responsibleName`, `responsibleAddress`, `responsibleEmail` | requiredWhen manufacturer country is outside `EU_COUNTRY_CODES` (`constants.ts:102`) | as today | rule NEW; defaults from seller #30 |
| `identifierType` | required | `choice`: type, model, batch, serial, barcode | NEW |
| `identifier` | required | `singleLineText` 80 | today optional |
| `identifierImageKey` | optional (the product photo already shows the product) | object key, same ownership checks as gallery keys | NEW; withheld from MCP by `withholdObjectKeys` (`present.ts:43`) |
| `warnings` | optional | `multiLineText` 2000 | none (the default language) |
| `warningsByLocale` | optional | map of `Locale` to `multiLineText` 2000 | NEW (buyer's language, lawyer 13.2 #8) |

### 1.7 System-captured records (not form fields)

| Record | Written by | When |
|---|---|---|
| Verification log entry {field key, value fingerprint, method, result, reference, evidence hash, at, expires_at} | `verification/log.ts` | every format check that passes on save, every contact code redeemed (hook in `redeemContactCode`, `src/lib/contact-verification/service.ts:278`), every VIES and ARES answer, every staff manual verification |
| Sanctions screening {list version, method, result, candidates (ids only), reviewer, decision, reason, at} | `sanctions/screen.ts`; Admin review | completion, name or DOB change, list change, staff decision |
| Change history {field key, action set / changed / cleared, old_fp, new_fp, actor, source, at} | the save RPC (13.4 item 7) | every save that changes a value. Fingerprints, not values: the row proves a change happened and triggers re-verification without copying personal data |
| Signup evidence {ip country from `cf-ipcountry`, declared country, billing country} | sign-up branch of `authenticate` (inv-01 2A, same place P2 B4 edits) and the auth callback; billing country from the plan checkout webhook | once each |
| DAC7 request record | `dac7.ts` | section 6.8 |
| Re-registration blocklist entry {fingerprint kind, fingerprint, reason, source owner, at} | `dac7.ts` when a DAC7 block takes effect; staff | section 6.8 |

### 1.8 One list, every reader

```ts
// form (components/seller-profile/SectionStep.tsx)
const fields = SELLER_FIELDS.filter((f) => f.section === section && appliesTo(f, facts) && isAsked(f, facts));

// completeness (status.ts, pure)
const missing = SELLER_FIELDS.filter((f) => appliesTo(f, facts) && isRequired(f, facts) && !facts.present[f.key]).map((f) => f.key);

// buyer projection (display.ts, pure; the ONLY builder of public_info)
for (const f of SELLER_FIELDS) if (f.buyers.show && f.sensitivity !== "sealed" && shownFor(f.buyers, facts)) info[f.buyers.slot] = format(f, values[f.key]);

// export (export.ts, server)
for (const f of SELLER_FIELDS) out[f.key] = f.sensitivity === "sealed" ? (grant ? await openField(...) : hint) : value;

// masking and the MCP guard (masking.ts -> lib/agent/secrets.ts)
export const NON_PUBLIC_FIELD_KEYS = SELLER_FIELDS.filter((f) => f.sensitivity !== "public").flatMap((f) => [f.key, snakeCase(f.key)]);
```

Admin cannot import Store modules. It applies the same classes structurally: sealed columns carry the `_sealed` suffix (13.4 item 4), and an Admin unit test refuses any `select(` string containing `_sealed` outside the reveal module (section 9.1).

### 1.9 Adding a field (the whole checklist)

1. One entry in `SELLER_FIELDS` (or `PRODUCT_SAFETY_FIELDS`), with a rule id if it is "only if applicable" (and the predicate in `rules.ts` if the rule is new).
2. Its label and tip keys in `messages/en/sellerProfile.json` (then the bulk translation recipe for the other nine locales).
3. A validator key that exists (or a new validator in `schemas.ts` plus tests).
4. The column from the data architect (the db drift test, 12.5, fails until `storage` resolves).
Nothing else: the step renders it, the gate requires it, the export includes it, the masking classifies it, the walk test (12.2) covers it.

### 1.10 Mapping from today's profile columns

| Today (`profiles`) | Becomes | Existing sellers |
|---|---|---|
| `tax_business_name` | `tradingName` (stays in the same column, the published copy) | kept; the identity step suggests it as the legal name with a `SameAsChip` (`src/components/ui/SameAsChip.tsx:13-37`), never fills it silently |
| `seller_address` (free text) | `publicAddress` (structured), formatted back into the column | shown as "You wrote: ..." above the empty structured fields; no parsing |
| `seller_email` + proof | `email` (column and proof unchanged) | kept, proof kept |
| `seller_phone` + proof | `phone` | kept |
| `tax_vat_id` | `vatId` (VAT ID row; column kept as published copy) | prefilled; VIES runs on first save |
| `tax_country` | `establishmentCountry` (primary address country; column kept as published copy, P1b's `market_seller_country` swaps source, P1b 10.1) | prefilled into step 0 |
| `legal_accepted_at`, `legal_accepted_version` | `sellerTerms` declaration (cache kept in sync) | one backfilled declaration per account with `surface = "legacy"` and no IP (data architect migration or a one-off cron route) |

---

## 2. The universal form

### 2.1 Where it lives

| Surface | Today | After |
|---|---|---|
| `/settings/business` (`src/app/settings/business/page.tsx:24-67`) | `TaxSection` card, one form, `saveTaxInfo` | Same route and constant (`TRADER_IDENTITY_HREF`). A seller with no profile started sees the **wizard** shell (`SellerProfileWizard`); everyone else sees the **overview** shell (`SellerProfileOverview`): one `SettingsCard` per section with a one-line summary ("Company · Example s.r.o.", "Address in Praha, email confirmed", "DIČ ••• 641 · checked 3 Nov") and an Edit button that opens that section's step inline, one section open at a time. The team-member note (`page.tsx:38-49`) stays. |
| Welcome flow (`src/components/onboarding/WelcomeFlow.tsx`, steps `welcome / terms / seller`, `:78`, `:107-112`) | seller step posts three fields through `saveTaxInfo` | Terms step unchanged except that `acceptLegal` now also writes a declaration record. The seller step becomes P2's country step (P2 8.7) followed by one "Who is selling?" screen, then a closing button "Finish your seller profile" that lands on the wizard at the identity step. The modal stays light; the long part happens on a page that keeps drafts. |
| `TaxSection.tsx` | 470 lines, one card | Deleted in branch `seller/09`. `ContactVerification` (the code box) and `StepUpField` are reused inside the contact step. The VAT prefix map (`TaxSection.tsx:63-74`) and `vatAdvisory` (`:85`) move into `countries/vat-prefixes.ts`. P1a `market/09` and P2 B5 should keep their `TaxSection` edits minimal (anchor id, country field): 1B replaces the file and reuses their `EstablishmentCountryField` / `CountryStep`. |
| `saveTaxInfo` (`src/lib/settings/actions.ts:446-580`) | the one trader write | Retired in `seller/09` with its registry entry (`tests/unit/agent/registry.test.ts:85`). Its checks move into `saveSellerProfile` unchanged (field whitelist, partial write rule `:455-470`, step-up `:475-476`, `settingsWrite` budget `:478`, MX `:491-495`, classifier `:517-520`, phone normalisation `:527-534`, code issue `:558-568`). |
| Anchors | `#business-name`, `#address`, `#contact-email`, `#vat`, `#country`, `#phone`, `#confirm-contact` (`TaxSection.tsx:257-393`, `trader-identity.ts:60`, `:69-99`) | Each field's `anchor` in the list. The old ids stay as aliases on the new wrappers (universal search `src/lib/search/registry.ts` and `nav-constants.ts` link to them), so no link breaks. |

### 2.2 The steps, in order

Each step is one screen with one question group, at most four fields visible, one primary button ("Save and continue"), a ghost "Back", and the step's hints behind `InfoTip`. Fields whose rule does not hold are not rendered at all.

| # | Step (title, five words or fewer) | Asks | Individual vs company | Only if applicable |
|---|---|---|---|---|
| 0 | "Where are you based?" | `establishmentCountry` via P2's `CountryStep` (`components/market/CountryStep.tsx`, P2 3.4), prefilled from `signup_country` metadata or the stored country | same | a closed country shows `NotOpenYet` with source `store-profile-expansion` (P2 8.1); the rest of the form is not offered |
| 1 | "Who is selling?" | `sellerType` as two `ChoiceCards` tiles (`src/components/ui/ChoiceCards.tsx:95`, `variant="tiles"`, icons for a person and a building) | individual: then `traderStatus`; company: one line "Companies sell as traders" | trader status as two cards only when `privateSellersAllowed`; otherwise one checkbox carrying the trader statement (declaration `traderStatus`, option `trader`) |
| 2 | "Your legal name" | individual: first name, last name, date of birth (`DateOfBirthField`: day, month, year boxes) | company with a registry module that prefills (CZ, ARES): **registration number first**, then "Is this your company?" showing the register's name and registered office, one button "Yes, use these" (fills `legalCompanyName`, `primaryAddress`, `businessRegistration`), ghost "No, type it"; company elsewhere: legal company name | company: representative name and role on the same screen (two fields) |
| 3 | "Your shop name" | `tradingName`, with a `SameAsChip` "Same as {legal name}" | same | |
| 4 | "Your address" | `primaryAddress`: street, postcode, city; the country shows as a chip from step 0 ("Czechia · Change" goes back to step 0) | company: prefilled from ARES when step 2 used it | |
| 5 | "How we reach you" | `email` and `phone`; after save, the existing code box (`ContactVerification`) for each changed detail | same | phone proof only when SMS is available (`contactChannelAvailable`, `src/lib/contact-verification/availability.ts:30`) |
| 6 | "What buyers see" | one `ui/switch` "Show buyers these details" (default on) and a live preview of the Seller info block (a picture instead of a paragraph) | same | switch off: public address, email, phone (three fields, the preview updates) |
| 7 | "Tax residence" | residence countries (default [step 0]), then per country: tax ID type (`ui/select`, options from the country module for the seller type) and number | individual: "This country did not give me a tax number" link where allowed, which reveals place of birth (city, country) | VAT: "Are you VAT registered?" yes / no, then the VAT ID (VIES result shows inline after save) |
| 8 | "Business registration" | company: register and number (skipped when step 2 filled it), optional file reference; individual: "Do you have a trade licence or business number?" yes / no then the number (ARES result inline) | company: "Permanent establishment in another EU country?" yes / no then countries | |
| 9 | "What you sell" | categories (chips from the owner's list), website (optional) | same | physical: product-safety role (three tiles), "Any goods made outside the EU?" yes / no then the default EU responsible person (name, address, email); "Returns go to your public address" switch (default on), off reveals the returns address |
| 10 | "Agreements" | Terms (the existing summary scroll and agreement from the welcome terms step, shown as done when current), self-certification checkbox, privacy acknowledgement checkbox (link to the notice) | company: representative authority checkbox naming the company and the representative | one primary button "Agree" posts `acceptSellerDeclarations` |
| 11 | "Your selling status" | read-only: each check with a plain word (Confirmed, Checking, Needs a fix), pending checks with when we try again, then the next step ("Connect Stripe" when Connect is available) | same | |

### 2.3 Drafts and resume

- Every "Save and continue" posts `saveSellerProfile` with that step's `section`. Format errors refuse the save (inline, beside the field, styles.md 8.12); missing values are accepted. Nothing records "progress": the wizard opens on the first section whose required fields are missing, computed from the status reasons (the same rule `src/lib/onboarding/steps.ts:10-13` explains for the checklist).
- A seller can leave at any step. Products and storefronts can be created as drafts at any time; drafts are never gated (G 10.1 R13, `src/lib/products/actions.ts:327-339`, from G).
- Partial saves can never satisfy the gate: `computeSellerStatus` asks the list, not the steps.

### 2.4 Components reused and new

| Need | Existing (reuse) | New (built from primitives) |
|---|---|---|
| Inputs, labels, selects | `ui/input`, `ui/label`, `ui/select` (`src/components/ui/select.tsx`; its value rides in a hidden input, as `TaxSection.tsx:183-186` explains), `ui/textarea`, `ui/switch`, `RequiredMark`, `InfoTip` | |
| Choices | `ui/ChoiceCards` (native radios, keyboard and screen reader safe), `ui/SegmentedControl` | |
| "Same as" | `ui/SameAsChip` | |
| Country | P2 `CountryStep`, `NotOpenYet`; P1a `EstablishmentCountryField` | |
| Contact proof | `components/settings/ContactVerification.tsx`, `components/auth/StepUp` (`StepUpField`) | |
| Cards and folding | `components/settings/SettingsCard`, `ui/CollapsibleSection`, `ui/Disclosure` | |
| Dialogs (embed Seller info, overview confirmations) | `ui/modal.tsx` (`Modal`, `ModalActions`), `ui/HeroMark` | |
| Save feedback | `useActionStateToast`, `useSaveResult` (`TaxSection.tsx:7`, `:179-181`), `SaveButton` | |
| Date of birth | `ui/DatePicker` is a calendar (`src/components/ui/DatePicker.tsx:56`), wrong for a birth date decades back | `DateOfBirthField`: a `fieldset` with legend and three labelled `ui/input`s (`inputMode="numeric"`, `autocomplete` `bday-day` / `bday-month` / `bday-year`) |
| Structured address | `ShipTo` shape and `formatShipTo` / `shipToLines` (`src/lib/orders/ship-to.ts:37`, `:90`, `:112`) for formatting | `StructuredAddressFields` (street, postcode, city; the country is a prop) |
| Machine-readable form state | the product form's snapshot pattern (memory note form-datapoints) | `buildSellerProfileSnapshot()`: section states and `requiredMissing` KEYS only, never values; `data-seller-section`, `data-seller-field` on wrappers (the `Select` and `SegmentedControl` drop `data-*`, so on wrappers) |

### 2.5 Little visible at once

From styles.md 8.14 and the scannable-dialogs note: one question group per screen; the explanation is a picture where one carries it (step 6 preview, step 11 status marks), never a paragraph; one short hint per control at most, behind the "?" when it is a caveat; a blocked state shows one sentence and its fix. Security and legal copy is shortened, never hidden: the declaration texts are shown in full beside their checkboxes. Target: under 40 visible words per step except step 10.

### 2.6 Accessibility

- Each step is a `<form>` with an `h2` that receives focus when the step arrives (as the welcome flow does, `WelcomeFlow.tsx:71-72`); progress is `role="progressbar"` with "Step N of M".
- Grouped inputs (date of birth, address, yes / no) are `fieldset` + `legend`. Errors sit beside their field and are linked with `aria-describedby`; the first invalid field receives focus after a failed save.
- `autocomplete` tokens on every personal field (`given-name`, `family-name`, `organization`, `street-address`, `postal-code`, `address-level2`, `email`, `tel`, `bday-*`).
- No time limits. Works at phone width with no horizontal scroll (the device sweep spec's rule). Inputs at 16px (styles.md 10, iOS zoom guard).
- `InfoTip` labels never reuse the control's own words (form-datapoints note: tip labels are accessible names and collide).

### 2.7 Server actions

All in `src/lib/seller-profile/actions.ts` (`"use server"`). None is an MCP tool. Every one acts on the signed-in person's OWN seller profile (`user.id`), never the active account, exactly as `saveTaxInfo` does today (inv-01 C1).

| Action | Does | Step-up | Budget | Registry (`tests/unit/agent/registry.test.ts`) |
|---|---|---|---|---|
| `saveSellerProfile(prev, formData)` | parse `section`; whitelist = that section's field names from the list + `STEP_UP_FIELDS` (`src/lib/auth/mfa.ts:231`) + `section`; `sectionSchema(...)` (partial); step-up; budget; async checks (MX, VIES, ARES under their budgets); classifier for `tradingName`; seal and fingerprint; blocklist check; one write RPC (13.4 item 7); published copies on `profiles`; issue contact codes for changed email or phone (`issueContactCode`, `service.ts:155`); sanctions screen when a name or the DOB changed; `recomputeSellerStatus(user.id, "profile_save")`; `revalidatePath(TRADER_IDENTITY_HREF)` and the overview path | `requireStepUpState(formData)` (`mfa.ts:360-370`) for every section: the identity buyers see, the tax data, and sealed values are all "what a stolen session should not rewrite" | `settingsWrite` (`src/lib/rate-limit.ts:293`, same meaning as today); `registryCheck` per user and `aresPlatform` / `viesPlatform` platform-wide for the outbound calls (new, 4.5) | `person(STEP_UP)` |
| `acceptSellerDeclarations(prev, formData)` | posted `documents[]` each with the version it showed; each must equal `DECLARATION_DOCUMENTS[id].version` (refused otherwise, as `legalAcceptSchema` does, `src/lib/validation/settings.ts:162-164`); inserts one record each; recompute | none (as `acceptLegal`) | `settingsWrite` | `person("Accepting terms binds the person: a decision, not an operation.")` (the existing wording, `registry.test.ts:84`) |
| `confirmSellerDetails(prev, formData)` | the yearly "still right": inserts `detailsConfirmation`, re-queues VIES and ARES checks older than 12 months, re-screens; recompute | `requireStepUpState` | `settingsWrite` | `person(STEP_UP)` |
| `acceptLegal` (existing, `actions.ts:399-422`) | additionally inserts a `sellerTerms` declaration BEFORE the profile cache write (the record is the truth; a failed cache write returns `SAVE_FAILED` and a retry appends a harmless duplicate) | unchanged | unchanged | unchanged |

Step-up note: `checkStepUp` refuses any agent context (`mfa.ts:266`) and passes accounts without 2FA (`:270`). That is the house rule for every sensitive save and is kept. Unsealing (2.8, 8.2) is stricter.

### 2.8 Sealing and fingerprints

```ts
// src/lib/crypto/field-sealing.ts   SERVER ONLY ("server-only" import)
import { base64UrlDecode, base64UrlEncode } from "@/lib/auth/passkey-crypto"; // helpers only (:19-32), never its key

/** "k2:<base64url 32 bytes>,k1:<...>": the FIRST is current (seals), the rest open only. */
const SEALING_KEYS_ENV = "SELLER_SEALING_KEYS";
/** 32 bytes, base64url. Fingerprints do NOT include the owner, so equal values match across accounts. */
const FINGERPRINT_KEY_ENV = "SELLER_FINGERPRINT_KEY";
/** Envelope version. A format change is sv2, never a silent reinterpretation. */
export const SEALED_PREFIX = "sv1";
export const SEALED_VALUE_PATTERN = /^sv1\.[a-z0-9]{1,8}\.[A-Za-z0-9_-]{24,}$/;

export type SealContext = { table: SellerTableRole; column: string; ownerId: string; rowId?: string };
export class SealingUnavailable extends Error {}

/** "sv1.<kid>.<base64url(iv12 || ciphertext+tag)>", AES-256-GCM, AAD =
 *  "squareshare:seller-field:v1:<table>:<column>:<ownerId>:<rowId|>". Throws
 *  SealingUnavailable when the key is missing or malformed: the caller refuses
 *  the save; plaintext is never stored instead. */
export async function sealField(plaintext: string, ctx: SealContext): Promise<string>;

/** The plaintext, or null (wrong context, tampered, unknown kid). Never throws.
 *  Requires a grant (unseal.ts): an owner grant must name ctx.ownerId. */
export async function openField(sealed: string, ctx: SealContext, grant: UnsealGrant): Promise<string | null>;

/** HMAC-SHA-256 hex of the NORMALISED value under the fingerprint key, context
 *  "squareshare:seller-fingerprint:v1:<kind>". Kinds: tax_id:<type>, ico, vat,
 *  email, phone, dob_full, dob_year. */
export async function fingerprint(kind: FingerprintKind, normalised: string): Promise<string>;

export function isSealedValue(text: string): boolean;
```

- **Grants.** `type UnsealGrant = OwnerGrant | StaffRevealGrant | SystemGrant`, each a branded object with a private symbol so it cannot be built by a literal. `ownerUnsealGrant()` (`src/lib/seller-profile/unseal.ts`) is the only Store mint for owners: it refuses an agent context, requires a signed-in session, and then requires `secondFactorIsFresh(assurance, STEP_UP_WINDOW_SECONDS)` when 2FA is enrolled (`src/lib/auth/assurance.ts:86`, `:279`) or `signedInRecently(assurance, RECENT_SIGN_IN_SECONDS)` when it is not (`:107`, `:312-320`, the bar already used for turning 2FA on). So an account without 2FA must have signed in within ten minutes ("Sign in again" resets it). `StaffRevealGrant` exists only in Admin (9.1). `SystemGrant("dac7_report")` is minted only inside a cron-secret route for the later DAC7 report run. A structural unit test lists the only files allowed to call `openField(`.
- **Where sealing is called.** `saveSellerProfile` (tax ID numbers, DOB, place of birth); the Stripe `account.updated` handler (`src/lib/payments/connect/webhook.ts:165-175`) for the payout last 4 and holder name if section 13.1 #13 confirms Stripe returns them; the key rotation job (`/api/cron/seller-sealing-rotate`: re-seals rows whose kid is not current, bounded, `more: true`).
- **Fingerprints** are written beside: tax IDs (per type, normalised), IČO, VAT ID, email, phone, DOB full and DOB year. Uses: duplicate detection across accounts (staff signal, never a refusal by itself), the re-registration blocklist, the DOB comparison in sanctions screening (5.2).
- **Hints** (`maskHint`, stored beside, non-sealed): tax ID: issuing country + last 3 characters ("CZ ••• 641"); DOB: none (the UI says "On file"); place of birth: country only; payout: last 4. Every code path other than the three grants sees hints only.
- **Failure:** missing key means the save refuses with `serverError("sealingUnavailable")` and the log line `[sealing] unavailable: <reason code>`, never a value. Deploy sentinel: `scripts/check-prod-schema.ts` cannot see Worker secrets, so the deploy workflow adds a smoke call to a dev-excluded health check that reports `sealingConfigured: true` (booleans only).

### 2.9 Email proof: in-session code or link (owner's decision)

The specification says "verify via link"; the product proves by an 8-digit code typed back in the same session (`service.ts:155-313`, HMAC storage `code.ts:82-95`). **Recommendation: keep the code.** It already exists, is bound to the owner, channel and value, drops when the value changes, has budgets and cooldowns, and is not consumed by mail scanners that prefetch links (a link token can be spent by a corporate scanner before the person clicks). It meets the specification's intent: proof that the person controls the inbox. Optional hybrid if the owner wants a link: the email carries a link that opens `/settings/business#confirm-contact` with the code prefilled, still redeemed by the signed-in session. Default if not decided: code only. Note the proof is enforced only when mail is on (`availability.ts:24-27`), and production mail is off (G 1B row 11): turning mail on is a prerequisite of enforcement (13.1 #2).

### 2.10 What goes through a /dev lab

| Part | Lab | Why |
|---|---|---|
| The form's shell and step layout (wizard: centred card with progress bar vs left step rail vs single page with one open section; the overview: section cards vs a two-column summary), the seller-type chooser visual (tiles with icons vs showcase tiles with pictures), the step 6 preview size and position | **`/dev/seller-profile-lab`** (`page.dev.tsx`, lab-kit controls, `LabLazy` tiles, about 15 to 20 hand-curated presets, a shortlist first; placements: desktop page, phone frame, welcome-flow hand-over) | picked by eye (lab.md) |
| The Seller info block: labelled rows like today's `SellerBlock` vs a definition list vs a compact card with a trader badge; its dialog variant; placements: product page foot, checkout disclosure, storefront footer dialog, embed frame dialog, email text | **`/dev/seller-info-lab`** | picked by eye |
| Not lab: validation, the step order, the copy, the gate | | lab.md: "not for logic, forms or copy" |

Also: each new dialog (embed and storefront Seller info, "Is this your company?" if it becomes a dialog) gets an entry in `/dev/modals` (styles.md 8.14), and the welcome-flow hand-over cases go into `src/app/dev/onboarding/OnboardingGallery.tsx` (as P2 3.10 does for the country step).

---

## 3. Pluggable per-country validators

### 3.1 The registry interface

```ts
// src/lib/seller-profile/countries/types.ts
export type CountryCheck = { ok: true; normalised: string; hint: string } | { ok: false; problem: MessageKey };

export type TaxIdType = {
  /** Namespaced: "cz.rodne_cislo", "cz.dic", "generic.tin". */
  id: string;
  label: MessageKey;
  for: readonly SellerType[];
  /** Counts as the TIN for DAC7 reporting (tax adviser to confirm per type). */
  dac7Tin: boolean;
  validate(raw: string, ctx: TaxIdContext): CountryCheck;     // shape + checksum
  fingerprintKind: FingerprintKind;
};

export type RegisterOption = { id: string; label: MessageKey; for: readonly SellerType[]; numberLabel: MessageKey; hasFileReference: boolean };

export type CountryModule = {
  country: OperatingCountryCode;
  /** "draft" until the tax adviser signs off the formats; shown in Admin, never to sellers. */
  formatsStatus: "draft" | "adviser-verified";
  taxIdTypes: readonly TaxIdType[];
  /** May a resident declare that the country issued them no TIN (then place of birth). */
  tinMayBeAbsent: { individual: boolean; company: boolean };
  registers: readonly RegisterOption[];
  validateRegistration(registerId: string, raw: string): CountryCheck;
  /** Shape only; VIES decides validity. */
  validateVatId(raw: string): CountryCheck;
  /** VIES country code ("EL" for Greece), null outside the EU. */
  vatPrefix: string | null;
  postcode: { pattern: RegExp; normalise(raw: string): string; example: MessageKey };
  /** libphonenumber default region for numbers typed without a country code. */
  phoneRegion: string;
  external: { vat: "vies" | null; registry: { id: "ares"; prefillsCompany: boolean } | null };
  /** Consistency between fields (e.g. DIČ = CZ + IČO; birth number date = DOB). */
  crossChecks(facts: CountryCrossCheckFacts): readonly CrossCheckProblem[];
};

// src/lib/seller-profile/countries/registry.ts
export const COUNTRY_MODULES: Partial<Record<OperatingCountryCode, CountryModule>> = { CZ: CZ_MODULE };
export function countryModule(code: OperatingCountryCode): CountryModule {
  return COUNTRY_MODULES[code] ?? genericCountryModule(code);
}
```

Adding a country is one file (`countries/sk.ts`), one registry line and its tests; the form and the gate do not change.

### 3.2 The CZ module (every format: to be verified with the tax adviser)

Source of the rules: G 4.4 (cs.wikipedia pages on IČO, DIČ and rodné číslo; ARES OpenAPI). The module file opens with a comment block saying so and `formatsStatus: "draft"`.

**IČO (identifikační číslo osoby).**
- Input normalised by removing spaces; 1 to 8 digits accepted and left-padded with zeros to 8 (shorter numbers are padded, G 4.4; whether short input should be accepted at all: adviser).
- Check: with digits `n1..n8`, `sum = 8·n1 + 7·n2 + 6·n3 + 5·n4 + 4·n5 + 3·n6 + 2·n7`; `check = (11 − (sum mod 11)) mod 10`; valid when `check = n8`. So remainder 0 gives 1, remainder 1 gives 0, remainder 10 gives 1.

```ts
export function icoProblem(raw: string): MessageKey | null {
  const digits = raw.replace(/\s/g, "");
  if (!/^\d{1,8}$/.test(digits)) return "Validation.sellerProfile.cz.ico.format";
  const ico = digits.padStart(8, "0");
  const sum = [8, 7, 6, 5, 4, 3, 2].reduce((total, weight, i) => total + weight * Number(ico[i]), 0);
  return (11 - (sum % 11)) % 10 === Number(ico[7]) ? null : "Validation.sellerProfile.cz.ico.checksum";
}
```

**Rodné číslo (birth number).**
- Normalised by removing spaces and the slash. Ten digits `YYMMDDXXXC`, or nine digits `YYMMDDXXX` for people born in 1953 or earlier (no check digit).
- Month: 01 to 12 (men), 51 to 62 (women, month + 50); from 2004, when a day's suffixes run out, month + 20 (21 to 32, men) and month + 70 (71 to 82, women). Any other month value is refused; the +20 and +70 forms are refused for birth years before 2004.
- Year: nine digits means 1900 + YY and YY must be 53 or less; ten digits means 1900 + YY when YY is 54 or more, else 2000 + YY.
- Check (ten digits): `r = (first nine digits as a number) mod 11`; the check digit must equal `r`, except that `r = 10` requires check digit 0 (the roughly one thousand numbers that are therefore not divisible by 11; issuance of these ended in 1985 but cannot be ruled out after, so the validator accepts them for any year).
- The date after removing the offset must be a real calendar date, not in the future (`today` is a parameter, for tests).
- Cross-check: the decoded birth date must equal the `dateOfBirth` the seller typed (refused otherwise: "This birth number does not match your date of birth").
- Sensitivity: sealed; the hint is the last 3 digits. A birth number encodes date of birth and sex; lawful basis and limits are a lawyer question (13.2 #4).

**DIČ (daňové identifikační číslo).**
- `CZ` + 8 to 10 digits, case-insensitive input, spaces removed.
- Company: exactly 8 digits after `CZ`, which must pass the IČO check and equal the company's IČO (cross-check).
- Individual: 9 or 10 digits that pass the birth-number rules (and match the DOB), OR a number assigned by the tax administrator to a person without a birth number (publicly described as starting `699`; accepted on shape only and flagged `assigned` in Admin; adviser to confirm the prefix and length).
- The CZ VAT ID is the DIČ of a VAT payer: `validateVatId` uses the same shape; VIES decides.

**Tax ID types for CZ.** `cz.rodne_cislo` (individual, `dac7Tin: true`), `cz.dic` (individual and company, `dac7Tin: true`). Which of the two is THE DAC7 TIN for a Czech individual, and whether a company may give the IČO instead of the DIČ, are adviser questions (13.3 #1); the `dac7Tin` flags are the one place to change.

**`tinMayBeAbsent`.** `{ individual: false, company: false }` for CZ residents (every resident person has a birth number or an assigned number; adviser to confirm). For a non-CZ residence country on a CZ seller's profile, the generic module answers `true` for individuals, which reveals place of birth.

**Registers and the number.** `cz.or` "Commercial register (obchodní rejstřík)", for companies, number = IČO, optional file reference (spisová značka, free text up to 80 characters, e.g. the court and file number); `cz.zr` "Trade licence register (živnostenský rejstřík)", for individuals, number = IČO; `cz.other` "Another public register", both. `validateRegistration` runs the IČO check for all three.

**Postcode.** 5 digits, normalised to `NNN NN` (`/^\d{3} ?\d{2}$/`). **Phone region.** `CZ` (+420, nine digits) through the existing `normalizeSellerPhone` (G 1B row 12). **External checks.** `vat: "vies"`, `registry: { id: "ares", prefillsCompany: true }`.

**Cross-checks (CZ).** Company DIČ digits equal the IČO; individual DIČ or birth number date equals the DOB; a VAT ID, when given, equals the DIČ (warn, since a seller might type them differently); ARES `dic` (when returned) equals the declared DIČ (near match in Admin, never a hard refusal).

### 3.3 A country with no module

`genericCountryModule(code)`: one tax ID type `generic.tin` ("Tax identification number", both seller types, `dac7Tin: true`) accepting 4 to 30 letters and digits after removing spaces, dots and dashes; `tinMayBeAbsent: { individual: true, company: false }`; one register option "Business register" with a free-text register name and a number of 2 to 40 characters; VAT: VIES prefix from `vat-prefixes.ts` for EU countries (the map moved from `TaxSection.tsx:63-74`, including `EL` for Greece), shape `^[A-Z0-9]{2,14}$` after the prefix, else none; postcode: 2 to 12 characters; phone region = the country code; external: VIES for EU countries, no registry. `formatsStatus: "draft"` always, and Admin shows "no country module" on such a seller.

During the beta this path cannot be reached: step 0 sends a non-market country to `NotOpenYet`, and the gate's `market` reason refuses selling anyway. The design is universal because the form and the gate only ever call `countryModule(code)`.

### 3.4 Unit tests (synthetic vectors only)

`tests/unit/seller-profile/countries/cz.test.ts`, `generic.test.ts`, `registry.test.ts`. No test calls a registry. No vector is a real person's identifier:

- **IČO**: vectors derived from the rule, not looked up: `12345679` (remainder 2), `10000071` (remainder 0, check 1), `10000020` (remainder 1, check 0), `10000011` (remainder 10, check 1); each with its last digit changed is refused; 9 digits and letters are refused; `"1234567 9"` normalises. (An IČO can belong to a sole trader; these were computed, never checked against ARES, and no test sends them anywhere.)
- **Birth number**: every acceptance vector is dated in 2052 or 2053 and the validator's `today` is injected as 2080-01-01, so no vector can belong to a person born before the test was written: `5201010001` (man, 2052-01-01), `5251010006` (woman, month + 50), `5326150005` (man, + 20, 2053-06-15), `5376150010` (woman, + 70), `5376150000` (the remainder-10 exception, check digit 0), `5202290000`-style leap-day cases computed in the test (2052 is a leap year, 2053 is not). Refusals: wrong check digit (`5201010002`), month 13 and 40, + 20 with a year before 2004 (built in the test from the rule), 9 digits with YY 54 or more, a future date (today injected as 2050-01-01). The 9-digit acceptance path (born 1953 or earlier) needs a specimen: ask the tax adviser for a published specimen number; until then the test builds one at run time and never commits it as a literal.
- **DIČ**: `CZ12345679` (company, equals the IČO vector), `CZ5201010001` (individual), lower-case input normalised, `CZ1234567` refused; the `699` assigned form tested with a value built at run time.
- **Cross-checks**: company DIČ against a different IČO refused; birth number against a different DOB refused.
- **Generic**: TIN shape, VAT with and without prefix, `EL` for GR.
- **Registry**: `countryModule("CZ") === CZ_MODULE`; every storable seller country resolves to a module; every module's message keys exist in `messages/en/sellerProfile.json`.

---

## 4. Verification

### 4.1 The common shape

```ts
export type VerificationCheckId = "vies" | "ares";
export type VerificationResult =
  | { state: "valid"; reference: string | null; evidence: Record<string, string> }
  | { state: "invalid" | "not_found" | "inactive"; evidence: Record<string, string> }
  | { state: "mismatch" | "near"; registerName: string; evidence: Record<string, string> }
  | { state: "unavailable"; reason: string };
```

Every answer becomes one verification log entry: the field key, the FINGERPRINT of the value checked (so a later edit makes the entry stale without comparing plaintext), method, result, reference, a SHA-256 of the canonical response body (our evidence), `checked_at`, and `expires_at = checked_at + REVERIFY_AFTER_MONTHS`. The status computation trusts only an entry whose value fingerprint equals the current value's fingerprint and that has not expired.

### 4.2 VIES client (`verification/vies.ts`)

- Endpoint (G 4.1): `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`, JSON body `{ countryCode, vatNumber, requesterMemberStateCode?, requesterNumber? }`. The base URL is a named constant `VIES_REST_BASE`; tests point it at a stub.
- Inputs: `countryCode` from the country module's `vatPrefix` (EL for Greece), `vatNumber` without the prefix. Requester fields from `OPERATOR_VAT_ID` (a new constant beside the operator's identity in `src/lib/legal/`, null today because the operator's VAT registration has ended, G 4.1).
- Timeout 8 seconds (`AbortSignal.timeout`), one retry after 500 to 1500 ms jitter on network errors, 5xx, and the error strings G lists as concurrency or availability problems (`MS_UNAVAILABLE`, `MS_MAX_CONCURRENT_REQ`, `GLOBAL_MAX_CONCURRENT_REQ`, unverified); anything else is not retried.
- Mapping: `valid: true` gives `valid` with `reference = requestIdentifier ?? null` and evidence `{ requestDate, nameReturned: present|absent, responseSha256 }`; `valid: false` gives `invalid`; availability errors give `unavailable` (never invalid, G 4.1).
- **Consultation number upgrade.** When `OPERATOR_VAT_ID` is set, the client sends `requesterMemberStateCode` and `requesterNumber`, VIES returns `requestIdentifier`, and the same log column fills. No other change; a one-off job can re-check every stored VAT ID to obtain numbers for them. If VIES returns a name, it is compared with the legal name by the same normaliser as ARES and the outcome is recorded for Admin (informative, never blocking, since member states vary).
- Outbound budget: `viesPlatform` (`{ max: 60, windowSeconds: 60 }`, key `platform`; VIES limits are undocumented) and the per-user `registryCheck` (`{ max: 20, windowSeconds: 3600 }`).

### 4.3 ARES client and the name match (`verification/ares.ts`, `name-match.ts`)

- Endpoint (G 4.2): `GET https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}` (IČO exactly 8 digits), `Accept: application/json`; base URL constant `ARES_REST_BASE`.
- Timeout 8 seconds, one retry with jitter on network errors and 5xx; 404 is `not_found` (not retried).
- Platform budget `aresPlatform` (`{ max: 300, windowSeconds: 60 }`, key `platform`), safely under the "more than 500 queries a minute" block (G 4.2). Whether Cloudflare egress IPs are throttled is unknown (13.6).
- Stored: method `ares`, reference `ico + ":" + datumAktualizace`, evidence `{ obchodniJmeno, pravniForma, datumZaniku: present|absent, dic: present|absent, responseSha256 }`. The registered office (`sidlo`) is used for the prefill and compared with the primary address (informative).
- **Inactive**: `datumZaniku` present gives `inactive`.
- **Name normalisation** (pure, `normaliseCompanyName(name, legalForms)`): Unicode NFKD and strip combining marks; lower case; `&` to ` a `; punctuation (`. , ; : " ' ’ ( ) / -`) to spaces; collapse spaces; strip ONE trailing legal form, longest first, from the module's list (CZ, draft: `spolecnost s rucenim omezenym`, `spol s r o`, `s r o`, `sro`, `akciova spolecnost`, `a s`, `verejna obchodni spolecnost`, `v o s`, `komanditni spolecnost`, `k s`, `zapsany spolek`, `z s`, `obecne prospesna spolecnost`, `o p s`, `zapsany ustav`, `z u`, `druzstvo`, `se`); result `{ core, tokens, form }`.
- **Classification** (company): `match` when the cores are equal and the forms are equal or one side has none; `near` when the cores are equal but the forms differ, or the token sets are equal in another order, or the Sørensen-Dice bigram similarity of the cores is 0.85 or more; otherwise `mismatch`.
- **Individuals with a trade licence**: ARES `obchodniJmeno` is typically the person's name, sometimes with a trade suffix. `match` when both the first and last name tokens appear in the register's tokens; `near` when exactly one does; otherwise `mismatch`.

### 4.4 What the seller sees (DRAFT copy, `SellerProfile.verification.*`)

| Result | Inline, beside the field | Gate |
|---|---|---|
| ARES match | check mark, "Found in the business register." | verified |
| ARES near | "The register spells it {registerName}." Primary "Use this spelling" (posts the same section with the register's name), ghost "Keep mine" | verified once the seller picks either; "kept mine" is flagged on the Admin report |
| ARES mismatch | "This number belongs to {registerName}. Check the number or your company name." | `verification_failed` |
| ARES not found | "We could not find this number in the business register." | `verification_failed` |
| ARES inactive | "The register shows this business as closed." | `verification_failed` |
| VIES valid | "VAT number confirmed with the EU on {date}." | verified |
| VIES invalid | "The EU VAT system does not recognise this number. Check it, or remove it if you are not VAT registered." | `verification_failed` (a published VAT number buyers cannot rely on) |
| Unavailable (either) | "The {register} is not answering. We will check again shortly." | `verification_pending` |

The register's name is public data from the register; nothing the seller typed is echoed back in an error.

### 4.5 When a service is down (owner's decision)

**Recommendation: pending with retry and a bounded grace, fail open inside the grace.** "Unavailable" writes a pending entry; the retry job (`/api/cron/seller-verifications`, every 15 minutes, 6.4) retries on `VERIFICATION_RETRY_MINUTES = [5, 30, 120, 720, 1440]` and then daily. While pending and younger than `VERIFICATION_PENDING_GRACE_HOURS = 72`, `verification_pending` only warns; after that it blocks publishing and checkout. Invalid, not found, inactive and mismatch block at once (fail closed: those are answers, not outages). Alternative for the owner: fail closed from the start (no publishing until the first answer), which is stricter but makes a VIES outage a seller outage. Either is one constant.

### 4.6 Re-verification

- **On change**: a changed tax ID, VAT ID or registration number gets a new fingerprint; the old log entry stops counting; the save triggers the check at once (4.2, 4.3); the change history row records old and new fingerprints.
- **After 36 months**: every entry carries `expires_at`. `REVERIFY_WARN_DAYS = 30` before expiry the status gains `reverification_due` (warn); at expiry it blocks (owner decision 13.1 #6). VIES and ARES re-run automatically before expiry (the retry job also re-checks entries within 45 days of expiry), so most sellers never see the warning; only fields that need the seller (contact proofs, declarations, names) do.
- **The yearly prompt**: `CONFIRM_DETAILS_EVERY_MONTHS = 12` after the last `detailsConfirmation` (or completion), the Needs attention row says "Check your seller details"; the overview shell shows a "Still right?" banner with one primary button "Yes, these are right" (`confirmSellerDetails`). It re-runs automatic checks and re-screens. Not confirming for 36 months is what `reverification_due` catches.
- **Reason to doubt**: staff can mark a seller "re-verify" in Admin (writes a verification log entry `manual: reopen` for the named fields), which turns them pending.

---

## 5. Sanctions screening as a process

### 5.1 Where the list comes from and how it is refreshed

- Source: the Commission's EU Financial Sanctions Files (FSF), full XML (about 25 MB, about 6,200 targets, changes several times a month, G 4.3). Download needs a registration token (owner act: register and put the token in the repository secret `EU_FSF_TOKEN`, 11.6). The production build uses the official file, not a mirror (mirror licences differ, G 4.3).
- **Runtime choice: GitHub Actions** (`.github/workflows/sanctions-list.yml`, daily plus manual).

| Option | Fit |
|---|---|
| Worker request | no: parsing 25 MB of XML exceeds a request's CPU and memory (G 4.3) |
| pg_cron with pg_net | no: the token would live in the database, and parsing 25 MB of XML in PL/pgSQL is a poor fit |
| A small ops Worker (like `ops/uptime`) on a Cron Trigger | possible but tight: the same CPU model, a new deploy target and secret set to maintain |
| **GitHub Actions** (chosen) | the existing pattern (`scheduled.yml:31-186`, `moderation-sweep.yml`, `CRON_SECRET`), no CPU limit that matters, the token stays a repository secret, and **seller data never reaches the runner**: the runner sees only the public list |

- The job runs `scripts/sanctions/ingest-eu-fsf.ts`: download with the token, stream-parse (a dev dependency for a streaming XML parser is needed: none is installed, `package.json`), normalise every entry into `{ entryId, kind: person|entity, names[] (whole name and every alias, normalised as 5.2), birthDates[] (full or partial: year, year-month, date), countries[], programme, listedAt }`, compute the list version (the file's generation date plus SHA-256). It asks `GET /api/cron/sanctions-list` for the stored version and stops if unchanged; otherwise it posts chunks of 500 entries to `POST /api/cron/sanctions-list` (CRON_SECRET, `cronAuthorized`, `src/lib/ops/cron.ts:50`), then a final `commit` call that swaps the active version atomically and marks a re-screen as due.
- The repository is public (`backup.yml:9-14`): the job uploads no artifact and prints counts only (entries, version, changed or not), the rule `moderation-sweep.yml` already states.
- Staleness: the status sweep alerts ops (`alertOps`, `src/lib/ops/alert.ts:21`) when the active list version is older than 7 days.

### 5.2 Matching

- Who is screened: individuals by legal first and last name plus DOB; companies by legal company name (normalised with the legal form stripped) plus establishment country; and the company representative as an individual by name only (no DOB is collected for them).
- **Stage 1, candidates (SQL)**: an RPC from the data architect, service role only, `sanctions_candidates(p_names text[], p_kind text)` using exact equality on the normalised whole name, then `pg_trgm` similarity (installed, G 2) on normalised aliases at 0.6 or more, top 20.
- **Stage 2, scoring (TypeScript, `sanctions/match.ts`, pure)**: token-set equality of names (order-free, diacritics stripped, transliteration-insensitive by the same normaliser); DOB comparison by fingerprints: for each candidate birth date the screener computes `fingerprint("dob_full", date)` or `fingerprint("dob_year", year)` and compares with the seller's stored `dob_fp_full` / `dob_fp_year` (13.4 item 2), so no sealed value is opened; country agreement raises the score; a conflicting full birth date lowers it.
- Outcome rules (conservative; the lawyer and owner may tighten): any candidate whose name matches on tokens or scores 0.85 or more and whose birth date does not conflict is a **potential match**; a candidate with a conflicting full birth date is recorded as `dismissed_dob_conflict` (visible to the reviewer, not queued); otherwise **clear**. The system never confirms a match by itself (G 4.3, and GDPR automated-decision rules, 13.2 #5).

### 5.3 States

`not_screened` (no result yet), `clear`, `potential_match` (awaiting review), `cleared_by_review` (a person decided not the same), `confirmed_match`. The gate maps `not_screened` and `potential_match` to ONE reason, `sanctions_pending`, with neutral copy ("We're checking your details. This usually takes a working day."), so the seller cannot learn whether a candidate exists; `confirmed_match` maps to `sanctions_blocked` ("Selling is paused on this account. Contact us.", no reason given; what may be said is a lawyer question, 13.2 #5).

### 5.4 Admin review (section 9.2 has the screen)

The reviewer records: decision (`clear` or `confirmed`), a reason (required, free text up to 1000 characters), which candidate entries were compared, the list version, and their staff id; the decision is append-only (a later different decision is a new row). Reviewing may need the DOB: the reviewer uses the logged reveal (9.1).

### 5.5 Re-screening

- On completion (the status recompute screens a seller with no result), on every change of a legal name, the DOB, the company name or the representative name (in `saveSellerProfile`), and on every list version change: the commit call sets `rescreen_due_version`; `/api/cron/sanctions-rescreen` (in the 15-minute workflow, bounded, `more: true`) screens every seller whose last screen used an older version. Small CPU per seller (one RPC plus a few HMACs).
- Every screen writes a row, also when clear (the evidence that it ran).

### 5.6 The minimum honest version for the Czech beta

The gate needs a result for every seller who wants to sell. In order of preference:
1. The ingest (5.1) and the automatic screen are live; potential matches go to the owner in Admin.
2. If the ingest is not ready when the beta opens: **manual screening by staff**, recorded in Admin with method `manual` (the reviewer searches the official list for the seller's name, records the list date, the result and their id). With a handful of sellers this is honest and auditable. The state machine and the gate are the same; only the method differs.
3. Never: opening the gate with `not_screened` treated as clear.

### 5.7 Alternative: a vendor (owner's decision)

A screening vendor (an API taking a name and DOB) removes the ingest and the matcher but sends seller names and DOBs to a third party (a processor agreement and a privacy notice line) and costs per check. The design isolates the source behind `sanctions/screen.ts`, so a vendor adapter replaces stages 1 and 2 and keeps the states, the review and the log. Recommendation for the beta: the official file in-house (free, no new processor); revisit at OFAC time (the US list is another file and another normaliser, the same adapter shape).

---

## 6. The completion gate

### 6.1 The reason vocabulary (extends P1a 4.2)

P1a puts the union in `src/lib/settings/trader-identity.ts`, the module that holds "exactly one answer to is this seller allowed to sell" (`:14-18`). 1B appends to it; the per-reason metadata lives in `src/lib/seller-profile/reasons.ts` (pure), which `trader-identity.ts` imports (the header's "no imports beyond the shared types" rule, `:14-18`, is updated to "beyond shared types and the pure seller-profile rule tables").

```ts
export type SellerGateReason =
  | { kind: "market"; problem: SellerMarketProblem }                                   // P1a
  | { kind: "details_missing"; missing: SellerFieldKey[] }                              // P1a, widened from TraderIdentityField[]
  | { kind: "details_invalid"; invalid: SellerFieldKey[] }                              // a stored value today's validator refuses (e.g. under 18)
  | { kind: "contact_unproven"; channels: ContactChannel[] }                            // was the emailVerified "field"
  | { kind: "declaration_missing"; documents: DeclarationDocId[] }
  | { kind: "verification_pending"; checks: VerificationCheckId[]; graceUntil: string }
  | { kind: "verification_failed"; checks: VerificationCheckId[] }
  | { kind: "sanctions_pending" }
  | { kind: "sanctions_blocked" }
  | { kind: "payments_not_ready" }                                                      // P1a 10.3 seam
  | { kind: "reverification_due"; dueAt: string }
  | { kind: "dac7_noncooperation"; blockFrom: string }
  | { kind: "reregistration_blocked" };

/** The stable snake_case code each reason is stored and raised as (P1b guards
 *  raise `seller_blocked:<code>`, P1b 10.1). Equal to `kind`. */
export type SellerGateCode = SellerGateReason["kind"];
```

Compatibility: `TraderIdentityField` stays as a type alias for the legacy keys during the notice stage, mapped `businessName -> tradingName`, `address -> publicAddress`, `country -> establishmentCountry`, `email -> email`, `emailVerified -> contact_unproven(["email"])`. `traderIdentityFix` (`trader-identity.ts:174-186`) and its ICU selects stay for the legacy path; the 1B copy is per reason (6.7) and never enumerates field combinations.

### 6.2 Effects

| Code | Publishing | Checkout | Scope | Softened by grace | DB (status row column) |
|---|---|---|---|---|---|
| `market` | block | block | seller | no | P1b's own `seller_country` / `account_country` |
| `details_missing` | block | block | seller, or physical when every missing key is physical-only (#28 to #31) | yes | `sell_block_reason` / `physical_block_reason` |
| `details_invalid` | block | block | as above | yes | same |
| `contact_unproven` | block (email; phone when SMS is on) | block | seller | yes | `sell_block_reason` |
| `declaration_missing` | block | block | seller | yes (not for new sellers: no grace exists for them) | `sell_block_reason` |
| `verification_pending` | warn until `graceUntil`, then block | same | seller | n/a (has its own clock) | `blocks_from = graceUntil` |
| `verification_failed` | block | block | seller | no | `sell_block_reason` |
| `sanctions_pending` | block | block | seller | no | `sell_block_reason` |
| `sanctions_blocked` | block | block | seller | no | `sell_block_reason` |
| `payments_not_ready` | per `PAYMENTS_REQUIRED_FOR` (6.3) | block | seller | no | `checkout_block_reason` (and `sell_block_reason` when publish-wide) |
| `reverification_due` | warn until `dueAt`, then block | same | seller | n/a | `blocks_from = dueAt` |
| `dac7_noncooperation` | warn until `blockFrom`, then block | same | seller | n/a | `blocks_from = blockFrom` |
| `reregistration_blocked` | block | block | seller | no | `sell_block_reason` |

Order of reasons: `market` first (P1a), then sanctions, then `reregistration_blocked`, then the rest in field-list order, so the first reason is the most useful single fix.

### 6.3 The `charges_enabled` reason

- P1a's seam: `payments_not_ready`, fed by `checkoutProviderFor(ownerId) !== null` (`src/lib/checkout/availability.ts:73-83`), which already counts the development test provider as ready (`:41-43`, `:75`), and the Stripe stand-in's connected account in the connect e2e run (P1a 10.3).
- 1B's switch, in `policy.ts`: `PAYMENTS_REQUIRED_FOR: "checkout" | "publish_checkout_listings" | "publish_all"`.
  - `"checkout"` (default now): no Pay button without a ready provider (today's behaviour). Publishing is not affected, so the 16 live listings and own-link or enquiry listings stay up while Connect is off (G 7.4).
  - `"publish_checkout_listings"`: a listing whose buy path would be our checkout cannot be published until ready; listings that sell through the seller's own link or an enquiry email stay publishable.
  - `"publish_all"`: the specification as written; every listing waits for `charges_enabled`.
- Recommendation: `"checkout"` until Connect is live in the market; then `"publish_all"` per the specification, unless the owner decides own-link and enquiry listings should survive (then `"publish_checkout_listings"`). The deploy is the switch (P1a 7.3). The status row computes `payments_ready` for the read side; the write side re-reads it uncached in `publishBlockedError`.

### 6.4 The status row: what is written, when, and why it cannot go stale silently

**Written by** `recomputeSellerStatus(ownerId, cause)` (server), which calls `readSellerFacts` then the pure `computeSellerStatus(facts, now)` and upserts ONE row (service role). Columns this code writes (13.4 items 1 and 3):

| Column | Meaning |
|---|---|
| `state` | `incomplete`, `pending` (only checks outstanding), `ready`, `restricted` (sanctions, DAC7, blocklist) |
| `reasons` jsonb | the full `SellerGateReason[]` (codes, field KEYS, dates; never values) |
| `sell_block_reason`, `checkout_block_reason`, `physical_block_reason` | the first EFFECTIVE blocking code for each purpose, or null (what the DB guard and the read path use) |
| `blocks_from` | the earliest future moment a warning becomes a block (grace end, `graceUntil`, `dueAt`, `blockFrom`), or null; the guard treats `now() >= blocks_from` as blocked with `deferred_block_reason` |
| `deferred_block_reason` | the code that takes effect at `blocks_from` |
| `grace_until` | the existing seller's deadline (6.6), echoed for display |
| `verification_state` jsonb, `sanctions_state`, `payments_ready` | for Admin and the dashboard |
| `establishment_country` | the structured primary address country, so the guard has the market input in the same row (P1b 10.1) |
| `public_info` jsonb | the buyer projection from `buildSellerInfo` (7.1); only public slots, by construction |
| `rules_version` | `STATUS_RULES_VERSION` (a constant bumped with any change to the list, the rules or the effects) |
| `computed_at`, `valid_until` | `valid_until` = the earliest of `blocks_from`, the next Terms version's effective date, the next verification expiry, and `computed_at + 24h` |
| `stale_since` | set by DATABASE triggers on every seller input table (and on `seller_payment_accounts`, the declarations, the screening rows) when they change; cleared by the recompute |

**Recompute triggers** (each calls `recomputeSellerStatus` in the same request, after its own write):

| Trigger | Where |
|---|---|
| Profile save, declarations, yearly confirm | the three actions in 2.7; `acceptLegal` (`actions.ts:399-422`) |
| A contact code redeemed | `redeemContactCode` (`src/lib/contact-verification/service.ts:278`) after success |
| A verification result | VIES / ARES inside the save, and the retry job |
| A sanctions result or a staff decision | the screener; staff decisions are written by Admin, so the trigger marks `stale_since` and the sweep recomputes within 15 minutes (a pending match stays blocked meanwhile: the safe direction) |
| Stripe `account.updated` | `applyAccountFacts` path in `src/lib/payments/connect/webhook.ts:165-175` |
| A Terms version taking effect | `valid_until` already expires at its effective date; the sweep picks the row up |
| A deadline passing (grace, verification grace, re-verification, DAC7) | exact through `blocks_from` (guard and read path), normalised by the sweep |
| A rules change (deploy) | the sweep recomputes every row whose `rules_version` differs |
| Product changes | none needed: physical-scope reasons are stored separately and applied per offer |

**Never stale silently:**
1. `stale_since` is set by triggers, so even a write that bypasses our code (a staff SQL fix, Admin) is visible.
2. The sweep, `POST /api/cron/seller-status` (CRON_SECRET), runs every 15 minutes from a new workflow `.github/workflows/seller-profile.yml` (the moderation-sweep pattern: `*/15`, counts only), recomputes rows that are stale, past `valid_until`, on an old `rules_version`, or missing for an account that owns a product or storefront, bounded per call with `more: true`.
3. The sweep answers 500 (the workflow turns red, a person notices: the terms-notices route's rule, `src/app/api/cron/terms-notices/route.ts:17-31`) when any row has been stale for more than an hour or any selling account has no row.
4. The read path, on a row past `valid_until` by more than an hour, logs `[seller-status] stale row` with the owner id only and schedules a recompute with `after()` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`; already used by the public pages, e.g. `src/app/(public)/s/[storefrontId]/page.tsx:5`).
5. Enforce stage: an account with no row is blocked (fail closed), the same discipline as `publishBlockedError` today (`seller-identity.ts:304-313`).

### 6.5 How the 12 gate sites read it

- `TRADER_GATE_SELECT` (`seller-identity.ts:81-82`) gains the embedded status row: `` `${SELLER_IDENTITY_SELECT}, seller_email_verified_at, seller_status:${SELLER_TABLES.status}(${SELLER_STATUS_GATE_COLUMNS})` ``. PostgREST embeds a row keyed by `owner_id` referencing `profiles.id` exactly as `account-row.ts` embeds `seller_billing` and `plan_grants` (`src/lib/settings/account-row.ts:6-9`, `:49-53`). Every gate read already selects this constant: `purchasable.ts:290`, `storefront-page.ts:248`, `sitemap.ts:149` (batch `.in("id", ids)` keeps working), embed route `:61`, OG route `:86`, previews `product-page-preview.ts:112`, `storefront-preview.ts:95`, and `readTraderGateUncached` (`seller-identity.ts:255`). `account-row.ts:37-38` hand-copies the column list and must change in the same commit; a new unit test asserts its string contains every column of `TRADER_GATE_SELECT`.
- `buildTraderIdentityInput` (`:109-120`) becomes `buildSellerGateInput(row)`: the legacy identity booleans, `establishmentCountry`, and from the embed only `{ sellBlock, checkoutBlock, physicalBlock, blocksFrom, deferredBlock, reasons }`. No value of any private or sealed field enters the gate input (G 1H risk note).
- `sellerGateReasons(input, { offer, stage, market })` returns P1a's reasons plus, in the enforce stage, the 1B reasons from the row; `offer: { physical: boolean; checkout: boolean } | null` decides whether physical-scope and checkout reasons apply. `sellerMaySell(row, offer)` (`:128-132`) and `publishBlockedError(accountId, offer)` (`:304-313`) pass it. The four direct callers that bypass `sellerMaySell` today (inv-01 BP6) move onto it in branch `seller/12`.
- `getTraderIdentityStatus` (`:216-233`) returns `{ ok: true; missing; reasons; state }`; `get_store` (`src/lib/agent/tools/store.ts:80`) adds `sellerGate: reasons` codes and missing keys (P1a 6.2 already adds the market part).

### 6.6 The grace period for existing sellers

- Who: every account that owns a product or a storefront on the day `SELLER_PROFILE_GATE` flips to `"enforce"`.
- Deadline: `grace_until = enforcement date + EXISTING_SELLER_GRACE_DAYS` (default 30), written once per seller by a one-off cron route (`/api/cron/seller-grace-backfill`, idempotent) into the profile row (13.4 item 1). New sellers have no grace.
- During grace: graceable reasons (6.2) warn; everything stays live; reminders go out (10.2). `blocks_from = grace_until`.
- At the deadline: the guard and every read path block at that second (`blocks_from`); the sweep normalises the row. Nothing is deleted, unpublished in the database or hidden from the seller; status stays `active`; filling the missing items brings listings back at the next recompute.
- Non-graceable reasons (sanctions, a failed verification, `market`, the blocklist) block at once, also during grace.

### 6.7 Seller-facing copy and where each reason sends the seller

Keys under `SellerProfile.gate.<code>.{title,sentence,action}` (titles of five words or fewer, one sentence, styles.md 8.14). DRAFT English:

| Code | Title | Sentence | Destination |
|---|---|---|---|
| `details_missing` | "Finish your seller profile" | "{count, plural, one {One detail is} other {# details are}} still missing." | `sellerProfileHref(firstMissingKey)`: `/settings/business#<anchor>` |
| `details_invalid` | "Check your seller details" | "{field} needs a fix." | the field's anchor |
| `contact_unproven` | "Confirm your contact details" | "Type the code we sent to {channel}." | `#confirm-contact` (`CONFIRM_CONTACT_ANCHOR`, `trader-identity.ts:60`) |
| `declaration_missing` | "Agree to the seller terms" | "Selling starts once you have agreed." | `#declarations` |
| `verification_pending` | "Checking your details" | "We will try again shortly. Selling continues until {date}." | `#tax` (status only) |
| `verification_failed` | "We could not confirm this" | "{check} did not confirm your {field}." | the field's anchor |
| `sanctions_pending` | "Checking your details" | "This usually takes a working day." | none (no fix to offer) |
| `sanctions_blocked` | "Selling is paused" | "Contact us about this account." | the support contact (`LEGAL_LINKS`) |
| `payments_not_ready` | "Connect your payment account" | "Buyers can pay once Stripe has approved it." | `PAYMENTS_PATH` |
| `reverification_due` | "Check your seller details" | "Confirm they are still right by {date}." | `#confirm` |
| `dac7_noncooperation` | "Tax details needed" | "Add them by {date} to keep selling." | `#tax` |
| `reregistration_blocked` | "Selling is not available" | "Contact us about this account." | support |

These render in the existing places: the chrome banner (`SellerDetailsNotice.tsx`, for blocking reasons), the setup checklist's seller step (`steps.ts:43-50`), the Needs attention row (section 10), refusals from publish writes (an `ActionError` built by one factory `sellerGateRefusal(reason)` in `src/lib/errors.ts`, the house rule P1a cites), and MCP error envelopes (`toEnvelope`, `src/lib/agent/dispatch.ts:67`). A unit test asserts every code has every key in `messages/en/sellerProfile.json`.

### 6.8 The DAC7 non-cooperation flow

- **Record**: one DAC7 request record per request (data architect): requested fields (keys), `requested_at`, `reminder1_at`, `reminder2_at`, `block_from`, `resolved_at`, `paused_by` (staff).
- **Who gets a request**: a seller whose status has DAC7-class fields (`retention` dac7 or dac7_dsa30 in the list) missing or unverified once they are reportable (the threshold counter, inactive until enabled, 11.4) or before the first reporting deadline; or a seller staff select in Admin.
- **Ladder** (`DAC7_LADDER` in policy.ts, owner and adviser to confirm): request at day 0; reminder 1 at day 20; reminder 2 at day 40; `block_from = max(requested_at + 60 days, reminder2_at + 14 days)`. The 60-day floor is a hard minimum enforced in `dac7.ts` and its test, whatever the constants say.
- **Channels**: a notification (new type `compliance`, needs the DB CHECK too: memory note "notification type two lists", 13.4 item 8) and an email through `sendEmail` (G 2, Brevo, needs production mail on). Copy: `SellerProfile.dac7.request.*`, `.reminder1.*`, `.reminder2.*`, `.blocked.*`; DRAFT for the adviser and the lawyer (P2 5.1 #28). Emails name the missing fields by label, never a value.
- **Job**: `/api/cron/seller-dac7` in `scheduled.yml` (daily), bounded, `more: true`, prints counts.
- **The block**: at `block_from` the status gains `dac7_noncooperation` (blocking). Selling stops; the account, its data and its listings are kept. Withholding payouts is not in our hands with direct charges (owner and lawyer, 13.2 #11).
- **Re-registration**: when the block takes effect, `dac7.ts` writes blocklist entries with the fingerprints of the seller's tax IDs, IČO, VAT ID, email and phone (retained after deletion, lawful basis: lawyer, G 10.3 Q4). Every later save of any of those identifiers by any account computes the fingerprint and checks the blocklist; a hit sets `reregistration_blocked` and alerts staff for review (a shared company phone can produce false hits). Sign-up itself does not refuse: the email alone is weak evidence and a refusal at sign-up would be an oracle (recommended; owner decision 13.1 #16).
- **Resolution**: when the requested fields are complete and verified, the recompute sets `resolved_at` and the reason disappears.

### 6.9 Rollout stages

| Stage | `SELLER_PROFILE_GATE` | What sellers see | What is blocked |
|---|---|---|---|
| Today | (absent) | today's gate | today's gate (`trader-identity.ts:115-144`) |
| Notice | `"notice"` | the form, the status, the Needs attention row, reminders without deadlines | today's gate only; status rows computed and shown; P1b guards see no 1B reason (`sell_block_reason` written as null in notice) |
| Enforce | `"enforce"` (one-line branch `seller/13`, owner's approval after the gap report) | deadlines appear for existing sellers | everything in 6.2; existing sellers after their deadline |

---

## 7. Public seller info and product safety

### 7.1 The Seller info block

Built by `buildSellerInfo(values, facts)` (display.ts) from list entries with `buyers.show`, stored as `public_info` on the status row, read by every buyer surface through the embed (6.5). `StorefrontSeller` (`src/types/storefront.ts:1243-1251`) gains optional `legalName`, `traderStatus`, `registration`, `selfCertified`, `returnsAddress`; `buildSellerIdentity` (`seller-identity.ts:148-161`) reads `public_info` when present (enforce stage) and today's columns otherwise, still field by field.

Content, in order (traders):
1. Legal name (company name, or first and last name), then the trading name on its own line when it differs.
2. Trader status line: "Trader" (`SellerInfo.traderStatus.trader`).
3. Public address (structured, formatted with `shipToLines`), country.
4. Email (mailto), phone (only once proven).
5. Register and number: "{register}: {number}" plus the file reference when given (e.g. "Commercial register: 12345678, C 123456 at the Municipal Court in Prague"); VAT ID as today.
6. Self-certification line (DRAFT): "The seller confirms they only offer products and services that comply with EU law."

Labels live in a new small namespace `SellerInfo` (shipped in the public client scope, `src/i18n/scopes.ts`, memory note i18n-client-message-scopes) rather than the heavy `ProductPage` namespace.

### 7.2 The private-seller variant (inactive while `ALLOW_PRIVATE_SELLERS` is false)

- Shows the trading name only (legal names of a private person are private), the trader status line "Private seller", the contact the seller chose to publish, and the notice `SellerInfo.privateSellerNotice` (DRAFT for the lawyer, P2 5.1 #22): "This seller is a private person, not a trader. EU consumer protection rights, such as the 14-day right of withdrawal, do not apply to this purchase."
- Consequences in code: `mayOweEuRights` and `orderOwesEuRights` (`src/lib/storefront/product-page.ts:180-196`) gain the trader status and return false for a private seller (the EU rights statements are replaced by the notice); the order page's withdrawal button follows. Built and tested, unreachable until the switch.

### 7.3 Placements

| Surface | Where | Variant |
|---|---|---|
| Product page foot | replaces `SellerBlock` in the seller section (`src/components/product-page/ProductPageView.tsx:775-787`; `sellerShown` `:251-259` reads `hasSellerDetails`, which gains the new fields) | full |
| Product page header | "Sold by {seller}" (`:602-606`) unchanged | one line |
| Checkout | the legal row disclosure (`src/components/checkout/CheckoutView.tsx:183-196`): summary "Sold by {seller}, {country}" unchanged (`:151-152`, `:187-189`), body = Seller info full plus the returns address (physical orders) | full + returns |
| Hosted storefront | `PoweredByFooter` (`src/components/product-page/PoweredByFooter.tsx:90-111`, seller name `:144`, used by `StorefrontPageView.tsx:33`, `:68`): a "Seller info" button opening a `Modal` with the full block | dialog |
| Embed frame | the "Sold by" span (`src/components/storefront-page/EmbedFrameView.tsx:95`) becomes a button "Seller info" opening a `Modal` inside the frame (the frame is ours; the seller's page is untouched) | dialog |
| Order confirmation email | `sellerLines` (`src/lib/orders/emails.ts:96-105`) is replaced by `sellerInfoLines(info, t)`, adding the phone, the register and number, the trader status and the self-certification | text |
| Cart page and quick add | where a seller line exists, the same "Seller info" dialog | dialog |

### 7.4 Relation to "Sold by" and P2's delivery line

"Sold by {seller}" stays the one-line summary everywhere it is today; Seller info is the full disclosure one tap away (never behind more than one disclosure, the rule the product page already states, `ProductPageView.tsx:251-258`). P2's `ProductPage.trust.deliveryArea` line stays in the trust list, the checkout's delivery fieldset, the cart summary and the embed footer (P2 0.4); it is never placed inside Seller info, and Seller info takes exactly the positions P2 8.6 reserved.

### 7.5 Product safety fields in the product form

- Schema (`src/lib/validation/product.ts:399-420`): add `manufacturerCountry`, `manufacturerWebsite`, `identifierType`, `identifierImageKey`, `warningsByLocale`; make `manufacturerEmail` optional with a refine "email or website"; a refine requiring the three responsible-person fields when `manufacturerCountry` is outside `EU_COUNTRY_CODES`. `ProductSafety` (`src/types/product.ts:337-347`) follows. Old stored blocks still parse (all new keys optional in storage; the publish rule decides).
- Form (`src/components/products/SafetyFields.tsx:21-124`): the country select after the address; the website field beside the email with one line "Email or website"; the responsible-person group appears only when the country is outside the EU (one option at a time); identifier type as a `ui/select` before the identifier; the identifier image through the existing gallery upload; warnings with a `SegmentedControl` of locales the seller adds (default: the seller's locale). The form datapoints (`form-datapoints.ts:85`, from G) mark the block required for physical products.

### 7.6 Defaults from the seller profile

- `productSafetyRole = manufacturer`: the manufacturer fields default to the seller's legal or trading name, public address, country and public email.
- `goodsMadeOutsideEu` with a default EU responsible person: the responsible-person fields default to it.
- Defaults are offered as a `SameAsChip`-style suggestion ("Use my details") with undo, never filled silently (the predictions rule). The existing "copy from your last product" prediction (`src/lib/predictions.ts:216-238`) stays as the second suggestion.

### 7.7 Required at publish (physical goods)

- `productSafetyProblem(details, isDigital)` (new, `src/lib/products/safety.ts`, pure, reading `PRODUCT_SAFETY_FIELDS`) returns missing keys. Called by every publish write after the seller gate: `publishGate` in `src/lib/products/actions.ts:333-339` and `:456`, `card-actions.ts:66`, `import-actions.ts:166` (call sites from G 7.1), and so by MCP `create_product`, `update_product`, `publish_products`, `import_products` through those actions. Refusal: `Products.safety.publishBlocked` with the missing labels and a link to `#product-section-safety`.
- Read side: a live physical product without a complete block is hidden from buyers only after the existing seller's grace (it inherits `blocks_from`), in `gatePurchasableLines` (`purchasable.ts`, inv-01 CP5). Digital goods: never (`ProductPageView.tsx:380`, `form-datapoints.ts:428-432`, from G).
- In production 2 live physical products have no safety block (brief facts): they fall under the grace.

### 7.8 Product page and embed display

- Product page: the mandatory "Safety and compliance" section (`ProductPageView.tsx:378-418`) adds the manufacturer country, the website, the identifier type label and the identifier image, and shows the warnings in the buyer's locale when present, else the default text.
- Embed: tiles link to the product page today (G 1G row 34). The quick-add sheet (cart, dark behind `CART_ENABLED`) gets a "Product safety" disclosure with the manufacturer and the warnings, so a physical item cannot be added without the information one tap away. Whether the embed must show it in full is a lawyer question (13.2 #8); the disclosure is the default.
- Checkout: the line summary links each physical line's safety section.

---

## 8. Seller self-service, export, masking and data flows

### 8.1 Viewing and editing

The overview shell (2.1) is the view: every field's value for public and private fields; sealed fields show their hint ("CZ ••• 641", "Date of birth on file"). Editing a sealed field means typing the whole new value (no reveal in the page). Edits to tax, VAT and registration fields trigger re-verification (4.6). There is no in-page reveal: the export is the one place a sealed value is shown to its owner (recommended; owner decision 13.1 #15).

### 8.2 The export

`src/app/settings/export/route.ts` gains a `seller_profile` section from `buildSellerDataExport(ownerId, grant)`:
- public and private fields as values (the list decides; `PROFILE_COLUMNS`, `:38-44`, keeps the legacy columns for now);
- sealed fields opened only when `ownerUnsealGrant()` succeeds (2.8); otherwise the hint plus `sealed_withheld: true` and a `how_to_include` sentence ("Sign in again, then download again"), so the file is honest about what it left out (the `truncated` discipline, `:213-218`);
- declaration history (document, version, time, surface; the IP is included: it is the person's own data), the verification log (method, result, date, reference), screening records as "screened on {date}: clear / under review" without candidate details (what may be disclosed during a review is a lawyer question, 13.2 #5), change history (field, action, date, who), signup evidence, DAC7 requests.
- The existing step-up rule (`:106-111`) and budget (`dataExport`, `:115`, `rate-limit.ts:358`) stay; the export of sealed values additionally needs the grant.

### 8.3 Masking rules

- Sealed values exist in plaintext only inside `saveSellerProfile` (before sealing), inside `openField` callers holding a grant (export, Admin reveal, DAC7 report job) and in the HTTP request that carried them.
- Private values are read only by: the owner (RLS read of their own non-sealed rows, interface item 3), our server code that needs them (status, screening, Admin), never by buyer surfaces (only `public_info`), never by MCP.
- Hints are private too (never in MCP, analytics or URLs).

### 8.4 Every place seller data flows today, and after

| Output | Today (G 1H) | After this change |
|---|---|---|
| Buyer pages (product page, checkout, storefront, embed, OG image, sitemap) | the public identity via `buildSellerIdentity` | `public_info` only (public slots), same read |
| Buyer confirmation email | name, address, country, email, VAT (`emails.ts:94-105`) | Seller info text lines (public slots) |
| Seller emails (new order, codes, reminders, DAC7) | codes to the seller's own address | field LABELS only; never a value, never a hint |
| MCP `get_store` | missing field names (`store.ts:80`) | reason codes, missing keys, state, deadlines (dates) |
| MCP `get_profile` | username, bio, avatar, switches (`store.ts:94-106`) | unchanged |
| MCP previews | public identity (`product-page-preview.ts:148`, `storefront-preview.ts:149`, from G) | `public_info` (exactly what buyers see) |
| MCP present layer | field by field (`present.ts:6-11`); product `details` incl. safety (`:43`) | unchanged; safety fields are public; the identifier image key is withheld by `withholdObjectKeys` |
| Server logs | codes and messages only; SMTP message passthrough caveat (`email/send.ts:169-171`, from G) | unchanged rule, enforced by the sentinel test (8.6); seller-profile modules log owner ids and codes only |
| Ops alerts | ids only (`alert.ts:21-23`, from G) | unchanged (sanctions alerts carry the owner id and a count) |
| Analytics (funnel) | seller id, store id, product id (`record.ts:37`, from G) | unchanged; no seller-profile event carries a field |
| URLs | settings anchors, public `mailto:` | anchors only; every form posts through a server action body |
| Admin seller card | seven identity columns, unlogged (`Admin/src/lib/data/moderation.ts:958-964`) | unchanged for the published copies; the new seller panel masks by default and reveals sealed values only through the logged action (9.1) |
| Data export | identity columns, proofs, Terms | 8.2 |
| Stripe Connect | email + country (`account.ts:153-164`, from G) | plus, if the owner approves prefill (13.1 #12), names, DOB and address before the first Account Link (the privacy notice must say so) |
| Stripe Billing | name, country, VAT (`customer.ts:35-44`, from G) | unchanged |
| Content classifier (Anthropic) | trading name, bio, shipping text, product `details` | trading name only from 1B; never a legal name, DOB, tax ID, registration number or address (a test asserts `sellerTextRefusal` is called with `tradingName` only) |
| VIES / ARES | none | the VAT number to VIES, the IČO to ARES: identifiers only, no names |
| GitHub Actions | none | the public sanctions list only; never seller data |
| Backups | plaintext columns | ciphertext for sealed fields |

### 8.5 The MCP rule and its tests

- Rule: a tool may return public fields only through `public_info` (previews) and status metadata (reason codes, field keys, dates, state). No tool returns a private or sealed value or a hint. No new tool is added and no 1B action becomes one (2.7).
- Guard: `findSecret` (`src/lib/agent/secrets.ts:25-42`, called on every result by `dispatch.ts:115`, which refuses and logs) gains (a) `isSealedValue(string)` so an `sv1.` envelope anywhere is refused, and (b) `NON_PUBLIC_FIELD_KEYS` from the list added to `FORBIDDEN_FIELDS` (`:12-22`) in both spellings. Public keys (`tradingName`, `vatId`, ...) are not forbidden, so previews keep working.
- Tests (12.3): `tests/unit/agent/seller-data-boundary.test.ts` and the `findSecret` additions in `tests/unit/agent/secrets.test.ts`.

### 8.6 Logs, analytics, URLs and emails

- A sentinel test per action (`tests/unit/seller-profile/no-leak.test.ts`): every field filled with a unique sentinel string, every failure path forced in turn (validator, step-up, budget, VIES down, ARES down, RPC error, sealing key missing), `console.*` spied: no sentinel in any call; the returned `ActionState` contains no sentinel except the echo of public fields the form shows back.
- `sendEmail` callers in 1B pass labels, never values; the DAC7 and reminder templates are unit-tested for the absence of sentinels.
- A structural test: no file under `src/lib/agent/` imports `@/lib/seller-profile/facts`, `@/lib/seller-profile/export` or `@/lib/crypto/field-sealing`.

---

## 9. Admin

Admin is English-only, server-rendered, staff-gated (`requireStaff`, `Admin/src/lib/auth/require-staff.ts:52`, roles `owner` and `staff`, `:9`). Separate Admin branches (11.2).

### 9.1 The seller detail view and the logged reveal

- Where: a "Seller profile" panel on `Admin/src/app/(app)/users/[id]/page.tsx`, read with the service role from the seller tables: every field by class (public, private, sealed hint), the status row (state, reasons, deadlines), verification log, screening history, declarations, change history (fingerprint-level), DAC7 requests.
- Masked by default: Admin selects only `_hint` columns for sealed fields.
- Reveal: a server action `revealSellerField(ownerId, fieldKey, reason)`: requires the staff role allowed to reveal (default `owner` only, 13.1 #9), a verified staff session (`staffSessionVerified`, `Admin/src/lib/auth/assurance.ts:30`), a reason (enum: DAC7 report, sanctions review, data subject request, legal request, fraud review; plus free text); writes the audit row FIRST through a new `logAdminActionOrFail` that throws when the insert fails (today's `logAdminAction` swallows failures, `Admin/src/lib/auth/log-admin-action.ts:25-29`), then mints a `StaffRevealGrant` bound to that audit id and opens the one field. The value is shown once, not cached.
- Key custody: Admin needs `SELLER_SEALING_KEYS` as its own Worker secret and a copy of the sealing module (`Admin/src/lib/crypto/field-sealing.ts`) with a shared test vector in both repos that pins format compatibility. Alternative (owner decision 13.1 #9): Admin calls a Store route that reveals and logs, so only Store holds the key, at the cost of a cross-app channel. Default: both Workers hold the key; only Admin's reveal path and Store's three grants open values.
- Structural test (Admin): no `select(` string outside `revealSellerField` contains `_sealed`.

### 9.2 The sanctions review queue

`Admin/src/app/(app)/compliance/sanctions/page.tsx`: potential matches oldest first, each showing the seller (username, legal name, country, establishment date), the candidate entries (list names and aliases, birth dates, programme, legal basis, list version), the score and why. Actions: "Not the same person" and "Confirmed match", each requiring the reason text, writing an append-only screening decision and an audit row. A confirmed match also creates an ops alert and a to-do for the owner (lawyer question: reporting to the Czech Financial Analytical Office, 13.2 #5). A banner shows the list version and age (red over 7 days).

### 9.3 The existing-seller completeness report

`Admin/src/app/(app)/compliance/sellers/page.tsx`: one row per account that owns a product, storefront or order: state, the reason codes, the missing keys (labels), `grace_until`, live listing counts, last screened, last verified. Filters by reason. CSV export logged through `logAdminAction` (as the plan CSV export is today, G 3.3). Reads status rows only (no plaintext beyond what the row holds).

### 9.4 DAC7 controls

On the seller panel: "Send DAC7 request" (choose fields, logged), the ladder dates, "Pause ladder" with a reason (logged; pausing never moves `block_from` earlier), and "Mark for re-verification" (4.6). No "unblock" control: a block ends when the data is complete, or by a staff decision recorded with a reason (a new declaration-like staff record), never by editing the status row.

---

## 10. Existing sellers

### 10.1 The "complete your profile" flow

- P2's `completeness.ts` (P2 4.3) gains items generated from the status reasons and the list: one item per missing required field (grouped by section, so the row says "3 tax details" rather than three rows), per missing declaration, per pending or failed check, plus deadlines from `grace_until`, `verification_pending.graceUntil`, `reverification_due.dueAt`, `dac7_noncooperation.blockFrom`.
- ONE Needs attention row, key `profile` (P2 adds it to `AttentionKey`, `src/lib/dashboard/attention.ts:15-30`), labelled by the most pressing item ("Finish your seller profile", "and N more"), the soonest deadline in its description, `urgent` (`:52`) when a deadline is within 7 days or anything blocks. It stands down while the setup checklist shows (as 2FA and Stripe do, `:244`, `:262`). Owner-only (profile rows are owner-only, `:274-278`).
- The setup checklist's `seller-details` step (`steps.ts:43-50`) reads the blocking subset, so a new seller meets it once.
- The chrome banner (`SellerDetailsNotice.tsx`) only for blocking reasons.
- Destination: `/settings/business` opened on the first incomplete section (the wizard for sellers with no profile row, the overview with that section open otherwise).

### 10.2 Deadlines and reminders

`/api/cron/seller-profile-reminders` (in `scheduled.yml`, daily, bounded, counts only) sends, for sellers in grace with blocking items: a notification and an email at the start of enforcement, at 14, 7 and 1 days before `grace_until`, and on the day selling pauses ("Selling is paused until your profile is complete"). Each reminder is recorded (a reminder record or the notification row itself) so a resend never doubles. Copy `SellerProfile.reminders.*` (DRAFT; lawyer review when a deadline has legal consequences, P2 5.1 #27). Email needs production mail on; without it, in-app only.

### 10.3 What stays live during the grace period

Everything: products, storefronts, embeds, checkout (subject to today's rules and P1a's market rules). Only non-graceable reasons (sanctions, failed verification, market, blocklist) stop selling during grace.

### 10.4 The gap report for the owner

Before the data architect's tables exist: Audit G section 9's read-only query (fields capturable today). After `seller/04` runs in the notice stage, the status rows answer everything (placeholder table name):

```sql
-- READ ONLY. Who would be blocked if enforcement started today, and why.
select s.state,
       count(*)                                                     as sellers,
       count(*) filter (where s.sell_block_reason is not null)      as would_be_blocked,
       count(*) filter (where s.sanctions_state <> 'clear')         as not_screened_clear
  from public.seller_completion_status s
 group by s.state
 order by sellers desc;

-- Which missing fields are most common (keys, not values).
select key, count(*) as sellers
  from public.seller_completion_status s,
       jsonb_array_elements(s.reasons) r,
       jsonb_array_elements_text(r -> 'missing') key
 where r ->> 'kind' = 'details_missing'
 group by key
 order by sellers desc;
```

(In notice stage `sell_block_reason` is written null by design, 6.9; the report reads `reasons` for "would block": the dashboard query in Admin 9.3 computes it from `reasons` with `SELLER_REASON_EFFECTS` mirrored as a SQL `case`, or the owner reads 9.3.)

---

## 11. The build, as small reviewable branches

Every Store branch is cut from `main` in its own git worktree (the main tree is shared with live sessions; memory notes "committing in a shared tree" and "never git stash a live repo"). Server side first, UI second. "DA" names a data architect migration by role; applying it to production is the owner's act and a schema sentinel (`scripts/check-prod-schema.ts`, P1a 1.7) makes a DB-coupled deploy refuse until it is applied.

### 11.1 Prerequisites

- 1A (P1a): `market/03-market-root` (the `MARKET` root), `market/04-seller-gate` (`sellerGateReasons`, `establishmentCountryOf`, the Stripe country), `market/09-seller-ui` (`EstablishmentCountryField`). 1B does not need `market/01-02`, `05-08`, `10-11` except through ordering of shared files (`trader-identity.ts`, `seller-identity.ts`, `tests/e2e/helpers.ts`).
- P2: B3 (`CountryStep`, `NotOpenYet`), B6 (welcome-flow country step), B7 (`completeness.ts`, the `profile` attention row).
- DA migrations (names theirs): **DA-core** (profile, addresses, tax residence, tax IDs, VAT ID, registration, permanent establishments, payout identifier, declarations, verification log, change history, signup evidence, the save RPC), **DA-status** (the status row with its triggers and the guard's reading of it, P1b's `seller_sell_block` body), **DA-guards** (service-role-only guard on the published `profiles` columns, 13.4 item 6), **DA-sanctions** (screening rows, list entries and versions, the candidates RPC), **DA-dac7** (request record, blocklist), **DA-notify** (`compliance` in the notifications CHECK).

### 11.2 Stage A: must ship before the Czech beta opens

| # | Branch | Purpose | Main files | Tests | Depends on | Needs |
|---|---|---|---|---|---|---|
| A0 | `seller/00-copy` | every new key in new namespaces `SellerProfile` and `SellerInfo` (10 locales) and the few keys in `Errors`, `Products`, `Dashboard`, `Notifications`; register the namespaces in each `messages/<locale>/index.ts` and `src/i18n/scopes.ts` | `messages/*/{sellerProfile,sellerInfo}.json` (new files, low conflict), `messages/*/index.ts`, small edits to `errors.json`, `products.json`, `dashboard.json`, `notifications.json` | `i18n-messages`, `i18n-client-scopes` | P1a `market/00` and P2 copy branches landed first (rebase) | lawyer DRAFT texts marked; bulk translation recipe |
| A1 | `seller/01-sealing` | field sealing, grants, fingerprints, hints; Worker secret docs; health boolean | `src/lib/crypto/field-sealing.ts`, `src/lib/seller-profile/unseal.ts`, `src/lib/seller-profile/masking.ts`, `wrangler.jsonc` (secret names documented) | sealing round trip, AAD mismatch, unknown kid, rotation, missing key fails closed, grant rules, structural `openField` allowlist | none | **owner**: create `SELLER_SEALING_KEYS`, `SELLER_FINGERPRINT_KEY` on the Store Worker (and Admin later); key backup outside Cloudflare |
| A2 | `seller/02-field-spec` | the list, rules, declarations registry, policy constants, tables map, schemas skeleton, reasons metadata | `src/lib/seller-profile/{fields,rules,declarations,policy,tables,reasons,schemas,display}.ts` | list well-formed (unique keys, anchors, copy keys exist, storage roles valid), declarations text hash, rules truth tables, `buildSellerInfo` keys only public | A0 | lawyer DRAFT texts referenced |
| A3 | `seller/03-country-validators` | registry, CZ, generic, checksums, VAT prefixes (moved) | `src/lib/seller-profile/countries/*` | 3.4 | A2 | **tax adviser** formats (ships `formatsStatus: "draft"`) |
| A4 | `seller/04-status` | `readSellerFacts`, `computeSellerStatus`, `recomputeSellerStatus`, the 1B reasons appended to P1a's union, `SELLER_PROFILE_GATE = "notice"`, the sweep route and `.github/workflows/seller-profile.yml`, the grace backfill route | `src/lib/seller-profile/{facts,status}.ts`, `src/lib/settings/trader-identity.ts` (union, header), `src/app/api/cron/seller-status/route.ts`, `seller-grace-backfill/route.ts`, `.github/workflows/seller-profile.yml`, `scripts/lib/prod-schema.ts` (sentinels) | status computation per reason, effects, `blocks_from`, `valid_until`, stale handling (unit); status write and trigger behaviour (db project) | A2, A3, `market/04`, **DA-core**, **DA-status** | **owner** applies DA migrations |
| A5 | `seller/05-profile-actions` | `saveSellerProfile`, `acceptSellerDeclarations`, `confirmSellerDetails`; `acceptLegal` writes declarations; published copies; contact-code hook; registry entries | `src/lib/seller-profile/actions.ts`, `src/lib/settings/actions.ts` (`acceptLegal`), `src/lib/contact-verification/service.ts` (recompute hook), `src/lib/rate-limit.ts` (`registryCheck`, `aresPlatform`, `viesPlatform`), `tests/unit/agent/registry.test.ts` | action matrix (whitelist, partial, step-up, budget, sealing called, no plaintext stored, recompute called), sentinel no-leak | A1, A4 | none |
| A6 | `seller/06-verification` | VIES and ARES clients, name match, log, retry route, ARES prefill for companies | `src/lib/seller-profile/verification/*`, `src/app/api/cron/seller-verifications/route.ts`, workflow step | clients with stubbed fetch (valid, invalid, unavailable, timeout, retry, 404, inactive), name-match table, retry schedule, grace | A5 | owner decision 13.1 #5 (default in code) |
| A7 | `seller/07-sanctions` | normaliser, matcher, screen on save and on completion, list ingest routes, `scripts/sanctions/ingest-eu-fsf.ts`, `.github/workflows/sanctions-list.yml`, rescreen route; manual method | `src/lib/seller-profile/sanctions/*`, `src/app/api/cron/sanctions-list/route.ts`, `sanctions-rescreen/route.ts`, `scripts/sanctions/*`, workflow, `package.json` (streaming XML parser, dev dependency) | normaliser cases, scoring with a synthetic list, DOB fingerprint comparison, states mapping, ingest chunk validation and atomic commit (db project) | A4, **DA-sanctions** | **owner**: FSF registration token as repo secret; in-house vs vendor (13.1 #8) |
| L1 | `lab/seller-profile` | the form shell lab | `src/app/dev/seller-profile-lab/*` (dev-only) | Playwright drive of the lab (lab.md) | A2 | **owner's pick** |
| L2 | `lab/seller-info` | the Seller info lab | `src/app/dev/seller-info-lab/*` | same | A2 | **owner's pick** |
| A8 | `seller/08-form` | wizard and overview shells, step components, `DateOfBirthField`, `StructuredAddressFields`, welcome-flow hand-over, `TaxSection` and `saveTaxInfo` retired, anchor aliases, search registry entries, `/dev/modals` and `/dev/onboarding` entries | `src/components/seller-profile/*`, `src/app/settings/business/page.tsx`, `src/components/onboarding/WelcomeFlow.tsx`, `src/components/settings/TaxSection.tsx` (deleted), `src/lib/settings/actions.ts` (`saveTaxInfo` removed), `src/lib/search/registry.ts`, `tests/unit/agent/registry.test.ts` | component tests per step (rules show and hide, seller type branches, near-match flow, datapoints), welcome-flow tests updated | A5, A6, P2 B3 and B6, L1 pick | none |
| A9 | `seller/09-seller-info` | `SellerInfo` component, text lines, placements, `StorefrontSeller` widening, `buildSellerIdentity` from `public_info` | `src/components/seller-info/*`, `ProductPageView.tsx`, `SellerBlock.tsx` (replaced), `CheckoutView.tsx`, `PoweredByFooter.tsx`, `EmbedFrameView.tsx`, `src/lib/orders/emails.ts`, `src/types/storefront.ts`, `src/lib/settings/seller-identity.ts` | component tests, email text test, projection keys test | A4, L2 pick | **lawyer** (self-certification line, trader status wording) |
| A10 | `seller/10-product-safety` | schema extension, form fields, defaults, product page and quick-add display, publish rule | `src/lib/validation/product.ts`, `src/types/product.ts`, `src/components/products/SafetyFields.tsx`, `src/lib/products/safety.ts`, `src/lib/products/{actions,card-actions,import-actions}.ts`, `ProductPageView.tsx`, `QuickAddTile.tsx` (or its sheet), `form-datapoints.ts` | schema refines, publish refusal matrix, defaults, display | A2, A5 | **lawyer** (embed duty, warning languages) |
| A11 | `seller/11-masking-export` | `findSecret` extension, MCP boundary test, `get_store` reasons, export section | `src/lib/agent/secrets.ts`, `src/lib/agent/tools/store.ts`, `src/app/settings/export/route.ts`, `src/lib/seller-profile/export.ts` | 12.3 | A5 | none |
| A12 | `seller/12-gate-read` | embed the status row in `TRADER_GATE_SELECT`, `buildSellerGateInput`, offer-aware `sellerMaySell` / `publishBlockedError`, the four direct callers onto the wrapper, `account-row.ts`, e2e fixture helper (`seedCompleteSellerProfile` through a `route.dev.ts` that runs the real recompute) | `src/lib/settings/{seller-identity,account-row}.ts`, `src/app/api/embed/[key]/route.ts`, `src/app/api/og/p/[productId]/route.ts`, `src/lib/agent/preview/*.ts`, `src/lib/seo/sitemap.ts`, `src/lib/products/purchasable.ts`, `src/lib/storefront/storefront-page.ts`, `src/app/api/dev/seller-status/route.dev.ts`, `tests/e2e/helpers.ts` | gate reads per offer, missing row in notice vs enforce, select-string test | A4, `market/04` | none (notice stage changes nothing for buyers) |
| A13 | `seller/13-existing-sellers` | completeness items from the list, the `profile` row content, reminders route | `src/lib/seller-profile/completeness.ts`, `src/lib/dashboard/attention.ts`, `src/app/api/cron/seller-profile-reminders/route.ts`, `scheduled.yml` | completeness items, row urgency, reminder schedule idempotence | A4, P2 B7, **DA-notify** | **owner** (what existing sellers are told; deadline length) |
| A14 | `admin/seller-01-profile` | Admin seller panel, logged reveal, `logAdminActionOrFail`, sealing copy | `Admin/src/app/(app)/users/[id]/*`, `Admin/src/lib/crypto/field-sealing.ts`, `Admin/src/lib/auth/log-admin-action.ts` | Admin unit tests, shared vector, `_sealed` select test | A1, DA-core | **owner**: key on the Admin Worker; who may reveal |
| A15 | `admin/seller-02-sanctions` | review queue | `Admin/src/app/(app)/compliance/sanctions/*` | Admin unit tests | A7 | owner as reviewer |
| A16 | `admin/seller-03-report` | completeness report, CSV | `Admin/src/app/(app)/compliance/sellers/*` | Admin unit tests | A4 | none |
| A17 | `seller/14-e2e` | specs (12.6), `e2e.yml` steps | `tests/e2e/*` | 12.6 | A8 to A13 | **owner OK** to push a `ci/**` branch |
| A18 | `seller/15-enforce` | `SELLER_PROFILE_GATE = "enforce"`, grace backfill run | `src/lib/seller-profile/policy.ts` | gate tests flip | all of Stage A, production mail on, sanctions results for every seller | **owner approval** after the gap report |

### 11.3 Stage B: after the beta opens

| Branch | Purpose | Depends on | Needs |
|---|---|---|---|
| `seller/16-dac7` | DAC7 ladder, notifications and emails, blocklist writes and checks, Admin DAC7 controls (`admin/seller-04-dac7`) | A4, A5, DA-dac7, DA-notify | adviser (ladder, scope), lawyer (texts, blocklist basis) |
| `seller/17-reverify` | 36-month expiry warnings and blocks, yearly confirm prompt, pre-expiry automatic re-checks | A6 | owner (warn vs block) |
| `seller/18-signup-evidence` | `cf-ipcountry` at sign-up and callback, billing country from the plan webhook | P2 B4 (same files) | adviser (evidence rules) |
| `seller/19-payout-identifier` | read last 4 and holder from Stripe `external_accounts`, seal | owner's Standard accounts decision, a Stripe test-mode check | owner |
| `seller/20-stripe-prefill` | prefill Stripe with names, DOB and address before the first Account Link | Standard accounts, privacy notice line | owner, lawyer |
| `seller/21-private-sellers` | the private-seller variant switched on | `ALLOW_PRIVATE_SELLERS` | owner, lawyer (notice) |
| `seller/22-warnings-locales` | per-language warnings UI polish, checkout safety links | A10 | lawyer |

### 11.4 Stage C: built generic, inactive

- **Threshold counters** (`src/lib/seller-profile/thresholds.ts`): `THRESHOLD_RULES` (DAC7 small-seller exclusion: fewer than 30 sales and at most EUR 2,000 per calendar year; US INFORM: 200 sales and USD 5,000 rolling 12 months, USD 20,000 for disclosure), each with `markets: []` (empty means off); SQL counter functions are the data architect's (G 8.2); a daily job writes snapshots and raises attention rows and staff alerts on crossing. Off until a market is listed.
- **US rules**: list entries with `markets: ["US"]` (US TIN types through a future `countries/us.ts`, INFORM disclosures), unreachable until US is in `MARKET.sellerCountries`.
- **OFAC**: a second ingest adapter behind the same `sanctions/screen.ts` interface.

### 11.5 Hot files and parallelism

- Hot: `messages/*/index.ts` and the small edits in `errors.json`, `products.json`, `dashboard.json`, `notifications.json` (all 10 locales; A0 carries them once; land message branches one at a time and apply translations with the CRLF-preserving helper, memory notes bulk-translation and line-endings); `src/lib/settings/trader-identity.ts` (P1a `market/04`, then A4); `src/lib/settings/seller-identity.ts` and `account-row.ts` (P1a `market/04`, then A12); `WelcomeFlow.tsx` (P2 B6, then A8); `attention.ts` (P2 B7, then A13); `tests/unit/agent/registry.test.ts` (A5, A8); `tests/e2e/helpers.ts` (P1a `market/04`, then A12); `ProductPageView.tsx` and `CheckoutView.tsx` (P2 B2, then A9, A10); `src/lib/orders/emails.ts` (A9); `src/i18n/scopes.ts` (P2, A0).
- Parallel after A2: A1, A3, L1, L2 together; after A5: A6, A7, A10, A11 together; A14 to A16 in Admin in parallel with Store UI.
- Sequential: A2 then A4 then A5; A12 after `market/04`; A8 after the L1 pick; A18 last.

### 11.6 Things only the owner can do (for the orchestrator to put in the tracker)

1. Create the Worker secrets `SELLER_SEALING_KEYS` (format `k1:<32 random bytes, base64url>`) and `SELLER_FINGERPRINT_KEY` (32 random bytes, base64url) on the Store Worker (`wrangler secret put`), and the same sealing key on the Admin Worker; keep an offline copy (losing the key loses every sealed value).
2. Register on the Commission's Financial Sanctions Files site and store the download token as the repository secret `EU_FSF_TOKEN`.
3. Apply each DA migration in production when its branch is ready (the Supabase connector declines writes here, memory note).
4. Turn production transactional email on (prerequisite of email proof enforcement, reminders and DAC7 notices) and decide SMS.
5. Decide the open items in 13.1 (each has a default in code).
6. Send the lawyer the DRAFT texts listed in 13.2 and the tax adviser the formats in 3.2 and questions in 13.3.
7. Pick in the two labs (L1, L2).
8. Approve the `ci/**` push for the e2e specs and, after the gap report, the enforce switch.

---

## 12. The test plan

Local reality: Vitest `unit` and `db` projects run locally, targeted files only, one at a time with no Playwright alongside (CLAUDE.md, machine resources); Playwright runs on GitHub when a `ci/**` branch is pushed with the owner's OK.

### 12.1 Unit (`tests/unit/seller-profile/`)

| File | Covers |
|---|---|
| `fields.test.ts` | unique keys and anchors; every label and tip key exists in `messages/en/sellerProfile.json`; every `validator` key exists; every `requiredWhen` / `askWhen` rule exists; sealed fields never have `buyers.show`; every `buyers.slot` is rendered by `SellerInfo` |
| `rules.test.ts` | each predicate's truth table |
| `declarations.test.ts` | text hash per version; versions unique; acceptance refuses a stale version |
| `countries/cz.test.ts`, `generic.test.ts`, `registry.test.ts` | 3.4 |
| `schemas.test.ts` | per section: partial accepted, invalid refused, cross-checks (Zod 4 refine-after-failure gotcha: format first, as `settings.ts:95-115` does) |
| `status.test.ts` | each reason produced from facts; effects per offer; grace softening; `blocks_from` and `deferred_block_reason`; `valid_until`; notice stage writes null block columns; ordering |
| `gate-reasons.test.ts` | `sellerGateReasons` with the status embed: offer kinds, missing row in notice and enforce, legacy mapping |
| `walk.test.ts` | 12.2 |
| `vies.test.ts`, `ares.test.ts`, `name-match.test.ts`, `retry.test.ts` | 4.2 to 4.5 with stubbed `fetch` |
| `sanctions-normalise.test.ts`, `sanctions-match.test.ts` | synthetic list entries only (invented names), DOB fingerprint comparison, conflict dismissal, states mapping |
| `dac7.test.ts` | ladder dates, the 60-day floor whatever the constants say, resolution, blocklist hit sets the reason |
| `display.test.ts` | `buildSellerInfo` keys are a subset of public slots; trader vs private; formatting |
| `export.test.ts` | sealed withheld without a grant, opened with one, honest flags |
| `actions.test.ts` | the action matrix (mocked boundaries, the pattern of `tests/unit/product-card-actions.test.ts`, P1a 8.2): whitelist, partial write, step-up called, budget, classifier gets `tradingName` only, sealing called before the RPC, RPC payload holds no plaintext sealed value, recompute called, contact codes issued for changed details |
| `no-leak.test.ts` | 8.6 sentinel test |
| `sealing.test.ts` (`tests/unit/crypto/`) | 2.8 |
| `account-row-select.test.ts` (`tests/unit/settings/`) | `account-row.ts` contains every `TRADER_GATE_SELECT` column |
| `reason-copy.test.ts` | every gate code has title, sentence and action keys; every destination resolves to a real route or anchor |

### 12.2 The walk test (every required field blocks)

`tests/unit/seller-profile/walk.test.ts`: for each seller type and trader status (and with `sellsPhysical`, `goodsMadeOutsideEu`, `noTinForSomeResidence`, `hasVatId`, `hasRegistration` each toggled), build a COMPLETE facts fixture from the list itself (every field present, every check valid, declarations current, sanctions clear, payments ready); assert `computeSellerStatus` is `ready` with no blocking reason; then for every entry with `isRequired(entry, facts)` true, remove just that field and assert the first blocking reason is `details_missing` (or `details_invalid` / `contact_unproven` / `declaration_missing` for those kinds) naming exactly that key; and for every entry not required in that variant, removing it changes nothing. The fixture is generated, so a new field is covered the day it is added.

### 12.3 Masking and MCP leak tests

- `tests/unit/agent/secrets.test.ts` (extended): an `sv1.` envelope anywhere is found; every `NON_PUBLIC_FIELD_KEYS` entry is found as a key in both spellings; public keys are not.
- `tests/unit/agent/seller-data-boundary.test.ts` (new): mock the admin client so every seller table, the status row, and `profiles` return rows whose every non-public field holds a unique sentinel (generated from the list) and every sealed column holds a sentinel envelope; run the handlers of every READ tool in `AGENT_TOOLS` (at least `get_store`, `get_profile`, `preview_product_page`, `preview_storefront`, `get_checkout_page`, `get_product_page`, `get_cart_page`) and `JSON.stringify` the results: no sentinel appears; `findSecret` on each result is null.
- Structural: no `src/lib/agent/**` import of facts, export or sealing (8.6); no `openField(` outside the allowlist (2.8); Admin's `_sealed` select test (9.1).

### 12.4 Component tests (`tests/component/`)

`seller-profile-wizard.test.tsx` (step order; individual vs company branches; private-seller cards hidden while the switch is off; "only if applicable" fields appear and disappear; focus moves to each step heading; errors linked by `aria-describedby`), `seller-profile-overview.test.tsx` (one section open at a time; hints for sealed fields; no value of a sealed field in the DOM), `date-of-birth-field.test.tsx`, `structured-address-fields.test.tsx`, `registration-near-match.test.tsx` ("Use this spelling" posts the register's name), `seller-info.test.tsx` (trader and private variants; dialog in embed and storefront), `safety-fields.test.tsx` (EU vs non-EU manufacturer; email or website), `welcome-flow.test.tsx` (updated hand-over), `seller-profile-datapoints.test.tsx` (snapshot holds keys, never values). jsdom stubs per the memory notes (IntersectionObserver, `scrollIntoView`).

### 12.5 DB project (`tests/integration/`, embedded replica)

`6x-seller-status.test.ts` (the recompute writes the row; triggers set `stale_since`; the guard blocks on `sell_block_reason` and at `blocks_from`; notice stage writes null), `6x-seller-fields-storage.test.ts` (every `storage` role and column in the list exists in the schema: the drift test that makes "adding a field" fail until the column exists), `6x-sanctions-candidates.test.ts` (the RPC returns trigram candidates from a synthetic list; ingest commit is atomic), `6x-seller-tables-grants.test.ts` (no anon or authenticated write; the auto-grant trap, memory note).

### 12.6 E2E specs (GitHub, `ci/**`)

| Spec | Proves |
|---|---|
| `120-seller-profile-cz-individual.spec.ts` | a new CZ individual: welcome terms, country step, who is selling, legal name and DOB, shop name, address, contact (code from the e2e mailbox), what buyers see (preview), tax with a synthetic birth number, agreements; status shows sanctions pending; staff clears via the dev route; publish succeeds; product page shows Seller info with the self-certification; the export after step-up holds the birth number, without it only the hint |
| `121-seller-profile-cz-company.spec.ts` | IČO first with a stubbed ARES (the e2e stack routes `ARES_REST_BASE` to a stand-in like `tests/e2e/stripe-mock.ts`): prefill, "Use this spelling" on a near match, a mismatch refused, DIČ cross-check, representative authority; VIES stand-in valid and unavailable (pending, then grace); publish blocked until complete |
| `122-seller-gate-enforce.spec.ts` (enforce config) | each blocking reason refuses publishing with its message and link; buyer pages hide; a physical product without a safety block is refused while a digital one publishes; an existing seller in grace keeps live pages, after the deadline (clock moved by seeding `grace_until` in the past) pages hide and come back once complete |
| `123-seller-info-placements.spec.ts` | Seller info on the product page foot, the checkout disclosure, the storefront footer dialog, the embed frame dialog (through `/dev/embed-host`), and the confirmation email text in the outbox harness |
| `124-seller-data-boundary.spec.ts` | the MCP endpoint on the e2e stack: `get_store` returns reason codes and missing keys, no private value; previews show only public info |

`e2e.yml`: one step "Seller onboarding" running 120 to 124 (under nine minutes per step, the laptop-sleep note applies to CI batch sizing too). Fixtures: `PUBLISHABLE_SELLER` (`tests/e2e/helpers.ts:498-506`, from G) gains a complete seller profile seeded through `seedCompleteSellerProfile` (A12), using a test sealing key in the e2e environment, and the real recompute through the dev route.

---

## 13. Open decisions, questions, risks and unknowns

### 13.1 Decisions for the owner (default in code so nothing waits)

| # | Decision | Default | Why |
|---|---|---|---|
| 1 | `ALLOW_PRIVATE_SELLERS` | **false** in the beta | needs the lawyer's notice and changes buyer-rights statements; the variant is built inactive (7.2) |
| 2 | Email proof by in-session code or by link; (b) proof of a different public email | **code**; (b) public email proven too (same mechanism, a third channel) once built, quality and MX checks until then | 2.9 |
| 3 | Phone required, and SMS in production | **required**; proof required only where SMS is on | the specification requires it; today it is optional by design (`trader-identity.ts:21-26`) |
| 4 | `PAYMENTS_REQUIRED_FOR` | **"checkout"** until Connect is live, then **"publish_all"** | 6.3; G 7.4 |
| 5 | VIES / ARES unavailable | **pending, 72 hours fail-open, then block**; answers that say invalid block at once | 4.5 |
| 6 | Re-verification overdue | **warn 30 days, then block** | 4.6 |
| 7 | Existing sellers' deadline | **30 days** after enforcement; listings stay live during it | 6.6 |
| 8 | Sanctions: in-house or vendor; reviewer; potential match blocks | **in-house official file**, the owner reviews, a potential match **blocks** until reviewed (one working day target), re-screen on every list update | 5 |
| 9 | Key custody and who may reveal | new keys on Store and Admin; **reveal by staff role `owner` only**; rotate yearly | 2.8, 9.1 |
| 10 | Category list and high-risk handling | a DRAFT list aligned with Stripe's restricted businesses; high-risk categories need staff review before the first publish (B P2) | |
| 11 | Representative authority evidence | **declaration only** | lawyer #10 |
| 12 | Prefill Stripe from our form | **yes** once Standard accounts are approved (avoids double entry) | G 5 |
| 13 | Payout identifier | **read from Stripe** if a test-mode check confirms; otherwise not collected (DAC7 "where available") | G 5 |
| 14 | Terms: no acceptance vs an outdated one | **no acceptance blocks**; an outdated one warns (the notice system makes new Terms take effect by themselves) | |
| 15 | In-page reveal of sealed values for the owner | **none**; the export is the view | 8.1 |
| 16 | Re-registration check | at every identifier save; a hit blocks and alerts staff; **no refusal at sign-up** | 6.8 |
| 17 | DAC7 block | **block selling and re-registration**; no account closure; payouts not in our hands | 6.8 |
| 18 | Notification type for compliance messages | new type **`compliance`** | 13.4 #8 |
| 19 | Minimum sanctions version at beta open | automatic if the ingest is ready, else **manual staff screening recorded in Admin** | 5.6 |
| 20 | Near match "Keep mine" | **accepted**, flagged on the Admin report | 4.4 |

### 13.2 Questions for the lawyer

1. Final texts (EN and CS) for: the self-certification (and its buyer line), the privacy acknowledgement incl. DAC7, the trader and private statements, the private-seller notice, the representative authority statement, the DAC7 request and reminders, the "selling paused" messages. Each is a key plus a version (1.5).
2. Does DSA Art. 29's micro and small enterprise exclusion remove the Art. 30 duties for this operator, and what remains (G 10.3 Q1)?
3. Declaration records: may we store the raw IP, and for how long (G 10.3 Q3)?
4. Lawful basis and limits for processing the birth number, the DOB and the place of birth, and for the fingerprint blocklist (G 10.3 Q4).
5. Sanctions: legal basis; whether a block after a confirmed match is an automated decision (it is not by design: a person confirms); what we may tell the seller during a review and after a confirmation; reporting duty to the Czech Financial Analytical Office.
6. Minimum age 18: is a DOB check required or a declaration enough; what about existing accounts (G 10.3 Q6)?
7. May a home-based trader publish a business address that differs from the registered one; what if they have none (G 10.3 Q7)?
8. Must the embed show GPSR information itself, or is a one-tap disclosure or link enough; must warnings be in the buyer's language (G 10.3 Q8)?
9. Is an ARES match ("informative only") adequate verification of a registration number (G 10.3 Q9)?
10. Representative authority: declaration or evidence (G 10.3 Q10)?
11. DAC7 non-cooperation: is blocking selling (without closing the account) a correct implementation; payouts under direct charges.
12. Is "Keep mine" on a near match acceptable, or must the legal name equal the register's?

### 13.3 Questions for the tax adviser

1. Czech TINs: for individuals, birth number or DIČ (which is the DAC7 TIN); for entities, DIČ or IČO; non-residents; every format and check in 3.2, including short IČO input, the `699` assigned DIČ form and length, and the post-1985 remainder-10 birth numbers (G 10.4 Q1).
2. A published specimen birth number in the 9-digit (pre-1954) form for tests.
3. VIES without a consultation number: is our stored result enough, or should the operator obtain a VAT identification (G 10.4 Q2)?
4. When exactly does a country "not issue" a TIN (place-of-birth fallback); companies without a TIN (G 10.4 Q4).
5. DAC7 retention start and scope for never-reportable sellers (G 10.4 Q3).
6. Payout identifier: are last 4 and holder name enough (G 10.4 Q5)?
7. Signup IP country and billing country as evidence (G 10.4 Q6).
8. Counter definitions and the ladder timing (G 10.4 Q7; 6.8).
9. Multiple tax residences: capture and reporting (G 10.4 Q8).

### 13.4 Requests and flags for the data architect (interface)

1. **The status row must be embeddable**: keyed by `owner_id` with a foreign key to `profiles(id)` so PostgREST can embed it into `TRADER_GATE_SELECT` (one query for all 12 gate sites, as `seller_billing` is embedded today, `account-row.ts:6-9`). Columns per 6.4, including `blocks_from`, `deferred_block_reason`, separate `sell_block_reason` / `checkout_block_reason` / `physical_block_reason`, `establishment_country`, `public_info`, `rules_version`, `valid_until`, `stale_since`; plus `grace_until` on the profile row. P1b's guards call one `seller_sell_block(seller)` for both products and orders (P1b 1.3): the orders guard also needs the checkout reason and the products guard the physical reason (a parameter or a sibling function). **Flag**: the interface says the guard reads "only that row plus the market rule"; that holds, but the row needs these three purpose-specific columns.
2. **DOB fingerprints** `dob_fp_full` and `dob_fp_year` (HMAC under `SELLER_FINGERPRINT_KEY`, computed by our code) beside `dob_sealed`, so sanctions screening never unseals (5.2). And normalised name columns (or an expression index) for the trigram candidate search.
3. **The sanctions LIST tables** (entries and versions) and the `sanctions_candidates` RPC are not in the interface's list (which names only the screening records). They hold public data, not seller data; naming is the data architect's.
4. **Column naming convention**: sealed columns end `_sealed`, hints `_hint`, fingerprints `_fp`, so structural tests in both repos can find them.
5. **Triggers** on every seller input table, `seller_payment_accounts`, declarations and screening rows that set `stale_since` on the status row (6.4).
6. **Published copies stay on `profiles`**: the existing `tax_business_name`, `seller_address`, `seller_email`, `seller_phone`, `tax_vat_id`, `tax_country`, `legal_accepted_*` remain (no new columns, interface item 1) as the copies legacy readers use (Admin seller card, Stripe Billing customer, export, the Terms notice system). They are owner-writable over PostgREST today except `tax_business_name` and the proofs (G 1 recurring facts); **request** a service-role-only guard on all of them, so the published copy cannot diverge from the structured truth.
7. **One write RPC per save** (`seller_profile_apply(p_owner, p_changes jsonb)` or per section) that writes the rows and the change history in one transaction; our code passes already-sealed values and fingerprints only.
8. **Notification type `compliance`** in the notifications CHECK, matching `NOTIFICATION_TYPES` (`src/lib/notifications/types.ts:10-33`).
9. **Backfill**: one `sellerTerms` declaration per account from `legal_accepted_*` with `surface = "legacy"` and no IP.
10. **Retention**: this design never deletes; the freeze-and-purge jobs are the data architect's, but the account deletion job (`src/lib/account-deletion/`) must call their freeze step before `deleteUser` (G 6.3).

### 13.5 Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Enforcement hides live listings of existing sellers (all 4 content owners are incomplete, brief facts) | notice stage first; gap report; 30-day grace; nothing deleted; reversible by completing |
| 2 | A missed recompute leaves a wrong decision | triggers set `stale_since`; 15-minute sweep; red workflow; `after()` recompute on stale reads; `blocks_from` makes deadlines exact without jobs |
| 3 | Sealing key lost | offline copy (11.6 #1); rotation keeps old kids for opening |
| 4 | Admin holding the key widens exposure | owner-only reveal, fail-closed audit, or the Store-side reveal alternative |
| 5 | DOB-year fingerprint is brute-forceable if the fingerprint key leaks (about 100 values) | separate key from sealing; Worker secret only; acceptable residual (the year alone is low sensitivity) |
| 6 | ARES throttles Cloudflare egress or VIES is down for days | platform budgets; pending with grace; manual verification by staff as a recorded method |
| 7 | Sanctions false positives on common names | human review, one-working-day target, neutral copy, DOB conflict dismissal |
| 8 | Hot files collide with P1a and P2 branches | landing order in 11.5; new message namespaces instead of `settings.json` |
| 9 | Draft legal texts ship as if final | every text is a versioned key marked DRAFT in Admin and in the declarations registry; enforcement waits for the lawyer |
| 10 | Unverified Czech formats refuse valid numbers | `formatsStatus: "draft"`; adviser sign-off before enforcement; a staff override (manual verification) for an edge case |
| 11 | The e2e specs cannot run locally | unit and db coverage carries the logic; e2e on GitHub with the owner's OK |
| 12 | Mail is off in production, so email proof, reminders and DAC7 notices are dormant | turning mail on is a listed prerequisite of A18 |
| 13 | The specification's `charges_enabled` publish rule would take everything offline while Connect is off | `PAYMENTS_REQUIRED_FOR = "checkout"` until Connect is live |

### 13.6 Could not determine

- VIES official limits, error code list, behaviour with an invalid requester number, whether CZ returns name and address (G 10.5).
- ARES limits beyond 500 a minute, per-endpoint authentication, whether Cloudflare egress is throttled; the separate commercial-register endpoint for the file reference (spisová značka) was not read, so the file reference is a seller-typed optional field.
- The FSF download URL, token process, reuse licence and current XML element names (G 4.3); the ingest's parser mapping is written against the Commission's documentation once the token is available.
- Whether Stripe returns `external_accounts` for platform-created Standard accounts after onboarding (G 5).
- The data architect's table and column names, the save RPC's shape, and P1b's final guard signatures; this design states what it needs (13.4).
- Whether production `SMS_ENABLED` and `TRANSACTIONAL_EMAIL_ENABLED` are set (G 10.5).
- Whether Admin runs as a Cloudflare Worker with its own secret store (assumed; affects key custody only).
