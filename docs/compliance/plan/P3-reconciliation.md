# P3: reconciliation of the 1B designs (data side and application side)

For the build agents. Date: 2026-11-22. Nothing here has been built, applied or
run. Not legal or tax advice.

Inputs: `P3a-seller-data-model-design.md` (P3a, the data side),
`P3b-seller-onboarding-app-design.md` (P3b, the application side),
`../audit/G-seller-onboarding-data.md` (G), `../PLAN.md` (the 1A plan),
`P1a-app-enforcement-design.md` section 10 and `P1b-database-guards-design.md`
sections 3a, 6.2, 7 and 10. Code was read only to settle one point (which client
reads `TRADER_GATE_SELECT`: the service role, in every call site, including
`get_store` through `getAccountRow`).

**How to use this file.** Where this file and P3a or P3b disagree, this file
wins. Anything not mentioned here stands as written in P3a (database) and P3b
(application). Section 2 is the interface stated once; a build agent needs no
other source for the interface, but still reads P3a for the full DDL it amends
and P3b for the form, copy and component detail.

Rules applied, in this order, wherever the two designs disagreed: safer for
sellers' data; consistent with the owner's specification; simpler to build.
Decisions that only the owner, the lawyer or the tax adviser can make are
listed as decisions with a default both halves can build on.

Binding decisions from the orchestrator (not reopened here): a seller's country
is stored truthfully and only selling is refused (P1b guard (a) is not built);
the monitor class for "seller country outside the market" alerts only when such
a seller has something sellable; the Stripe account type and the refund fee
flag are not part of this build; everything is built on local branches, and
every migration, every change to who can sell and every deploy waits for the
owner; existing sellers are reported, never deleted or disabled by a migration.

---

## 1. Every difference, and how it is settled

Columns: the point; what P3a says; what P3b says; the resolution (and why);
the text that is superseded. "Silent" means the document does not address a
point the other needs.

### 1.1 Binding decisions

| # | Point | P3a | P3b | Resolution | Superseded |
|---|---|---|---|---|---|
| D1 | `profiles.tax_country` and P1b guard (a) | Keep guard (a); the mirror copies the primary country into `tax_country` only when it is a market country (note 9, note 11, 8.2, 11.1 #6) | Copies the primary country to `tax_country` (1.4 #1); silent on guard (a) | Guard (a) is not built (binding; PLAN section 3 already dropped it). The mirror copies the primary-address country whatever it is. Definition of the column in 2.3 | P3a note 9 (market-only clause), note 11 first item, 8.2 mirror comment and the four-line market filter, 9.4 test 64 ("a non-market primary country leaves `tax_country` unchanged"), 11.1 #6 |
| D2 | A country change refused while a Stripe account exists in another country | `country_locked` trigger on `seller_addresses`, "guard (a) logic moved onto the new column" (5.5 last paragraph; test 63) | Silent; `saveSellerProfile` inherits `saveTaxInfo`'s checks (2.1), which P1a `market/04` extends with a lock (P1a 4.7) | Not built. Saving a country is never refused. A mismatch with the Stripe account's country blocks selling through P1b's `account_country` reason (already in `seller_sell_block`) and P1a's market reason; the gate message can reuse P1a's `Settings.tax.countryLocked` wording. The `market/04` lock does not move into `saveSellerProfile`. The 1A lock itself is flagged in section 5 | P3a 5.5 last paragraph, 9.4 test 63 "the country-lock guard", 5.7 `ob_guard_missing` "country lock" |
| D3 | Monitor class `r1_seller_country` | Make it non-alerting (note 11, 11.1 #6) | Silent | Stays alerting, but counts only sellers who own an active product (P1b's `live_sellers` set), not every seller with an account, a draft or a payment row. Changed at source in `20261122_market_5_monitor.sql` and carried unchanged by the restatement in seller file 04 | P3a note 11 second item, 11.1 #6 third part; P1b 6.2 `r1_seller_country` branch (`from sellers` becomes `from live_sellers`) |
| D4 | Where the app reads the country of establishment | `establishmentCountryOf` switches to `seller_addresses` with file 06 (note 9; 5.5 step 4); P1a 10 item 1 agrees | An `establishment_country` column on the status row (6.4, 13.4 #1) | The TS accessor keeps reading `profiles.tax_country` (already in `TRADER_GATE_SELECT`, so the 12 gate sites need no new select), which from file 06 is an exact server-written copy. SQL reads the primary address through `market_seller_country` (P3a 5.5). No status column | P3a note 9 last sentence, 5.5 step 4; P3b 6.4 `establishment_country` row; P1a 10 item 1 (only the SQL half changes) |
| D5 | A closed country at step 0 | Store whatever country is declared (note 9) | Step 0 shows `NotOpenYet` and "the rest of the form is not offered" (2.2), silent on saving | Step 0 saves the declared country first (truthful record), then shows `NotOpenYet`; the rest of the form stays closed during the beta | P3b 2.2 row 0 (clarified) |
| D6 | Money flow | Payout table built, empty in stage 1 (10) | `seller/19-payout-identifier` and `seller/20-stripe-prefill` depend on Standard accounts (11.3); defaults "yes once approved" (13.1 #12, #13) | Not part of this build. Both branches wait for the owner's account-type decision (PLAN section 5 item 1); the tables exist and stay empty | P3b 13.1 #12 and #13 defaults read "after the owner's decision" |

### 1.2 Sealing and keys

| # | Point | P3a | P3b | Resolution | Superseded |
|---|---|---|---|---|---|
| D7 | Where sealed values live | One table `seller_vault.sealed_values` in a schema no API role can use; public rows hold a pointer `*_sealed_id` (2.1, 2.7) | Envelope columns in each table, `*_sealed` (1.4 storage, 2.8, 13.4 #4) | P3a. Safer: no `select *` can carry an envelope into a page, a tool output or a log, and every API read goes through one logging function | P3b 1.4 storage of #8, #9, #21, #33, #34; 1.1 `tables.ts` sealed suffix; 13.4 #4 (`_sealed`, `_hint`, `_fp` convention) |
| D8 | Envelope format | `ss1.<key_id>.<nonce16>.<ciphertext+tag>`, shape enforced by a CHECK (2.2, 2.7) | `sv1.<kid>.<iv+ciphertext+tag>` (2.8) | P3a (the database checks it) | P3b 2.8 `SEALED_PREFIX`, `SEALED_VALUE_PATTERN`, the `sealField` comment |
| D9 | Associated data | Binds field, seller, subject row, vault id and key id (2.2) | Binds table, column, owner, row (2.8) | P3a: also binds the vault row and the key id | P3b 2.8 `SealContext` and the AAD string |
| D10 | Sealing key secret | `SELLER_FIELD_KEYRING`, JSON `{"current":..,"keys":{..}}` (2.3) | `SELLER_SEALING_KEYS`, `"k2:..,k1:.."` (2.8) | P3a | P3b 2.8 `SEALING_KEYS_ENV`, 11.2 A1 "Needs", 11.6 #1 |
| D11 | Fingerprint key | `SELLER_FINGERPRINT_KEYRING` with key ids; blocklist rows match under every id still present (2.3, 2.5) | One key `SELLER_FINGERPRINT_KEY` (2.8) | P3a: rotation is possible and blocklist rows stay matchable | P3b 2.8 `FINGERPRINT_KEY_ENV` |
| D12 | Fingerprint input and kinds | HMAC over `ss-fp1`, kind, country and value, joined by a vertical bar; kinds tax_id, vat_id, registration, email, phone, payout, person (2.5) | Context string per kind; kinds `tax_id:<type>`, `ico`, `vat`, `email`, `phone`, `dob_full`, `dob_year` (2.8, 3.1) | P3a's format. Kinds: P3a's plus `name`, `dob`, `dob_year` (2.4). P3b's `ico` is `registration`, `vat` is `vat_id`, and the tax ID type is not part of the input (a duplicate across types is still a staff signal) | P3b 2.8 `fingerprint()` comment; 3.1 `fingerprintKind` values |
| D13 | Date-of-birth fingerprints for sanctions matching | None; stage-2 screening "adjusts by birth date ... (it alone can open the sealed DOB)" (6.2) | `dob_fp_full`, `dob_fp_year` beside the sealed DOB so screening never opens it (5.2, 13.4 #2) | P3b's need, P3a's naming: `dob_fingerprint`, `dob_year_fingerprint`, `dob_fingerprint_key_id` on `seller_identities`, written from the first save (file 02). Safer: routine screening never opens a sealed value, and no later mass unseal is needed to backfill them | P3a 6.2 list bullet, the sentence on the app opening the DOB |
| D14 | History trigger and the new fingerprint columns | `seller_capture_change` labels only columns named exactly `fingerprint` or `fingerprint_key_id` as fingerprints (1.4) | (needs D13) | The trigger labels every column whose name contains `fingerprint` as `value_kind = 'fingerprint'` | P3a 1.4 `seller_capture_change`, the `v_kind` case |
| D15 | Hints | 2 to 4 characters in `display_hint`; none for DOB and place of birth (2.6) | Tax ID "CZ ••• 641"; place of birth hint = country (1.4 #9, 2.8) | P3a. Tax IDs are displayed as `issuing_country` + `display_hint`; DOB and place of birth show "On file" | P3b 1.4 #9 "hint = country", 2.8 hints bullet (place of birth) |
| D16 | Unseal grants versus the logging RPC | `seller_sealed_get` logs, then returns envelopes; actor kinds seller, staff, system (2.7) | Three grant kinds (owner, staff, system) gate `openField` (2.8) | Both: `openField` takes only an envelope returned by `seller_sealed_get`, and each grant maps to fixed RPC arguments (2.4) | P3b 2.8 grants bullet (amended) |
| D17 | Who holds the key; how Admin reveals | Store Worker only, offline escrow; Admin reveals through a Store internal route (2.10, 11.1 #2, #3) | Default: both Workers hold the key, Admin has a copy of the module and a shared test vector; Store route as the alternative (9.1, 13.1 #9, A14) | P3a (binding check). One Worker can decrypt; Admin never holds the keyring | P3b 9.1 key custody bullet, A14 "sealing copy" and shared vector, 11.6 #1 (Admin part), 13.1 #9 (keys on Admin), 13.5 #4 |
| D18 | Reveal audit | The RPC writes `reveal_sealed` in the same transaction; Admin writes `view_private` rows through a fail-closed helper `withSellerAccessLog` (3.4) | `logAdminActionOrFail` writes an Admin audit row, then mints the grant (9.1) | P3a: the reveal log is written by the database and cannot be skipped. `logAdminActionOrFail` is not needed for reveals | P3b 9.1 reveal bullet (audit part) |
| D19 | Admin structural test | Every `.from("seller_` call goes through `withSellerAccessLog` (3.4) | No `select(` containing `_sealed` outside the reveal module (1.8, 9.1) | P3a's test, plus: Admin never names `seller_sealed_get`, `SELLER_FIELD_KEYRING` or a sealing module | P3b 1.8 last paragraph, 9.1 last bullet |
| D20 | MCP envelope detection | Silent | `findSecret` refuses any `sv1.` string (8.5) | `findSecret` refuses any string matching the `ss1.` envelope pattern (2.4); defence in depth, since envelopes never leave the vault except through the RPC | P3b 8.5 (a), 12.3 first bullet |
| D21 | Key rotation | `seller_sealed_rotation_batch` + compare-and-swap `seller_sealed_reseal`, same vault id (2.4) | A cron route re-seals rows whose kid is old (2.8) | P3a's functions; P3b's route name `/api/cron/seller-sealing-rotate` kept, stage 2 | P3b 2.8 rotation sentence (mechanism) |

### 1.3 Tables, columns and vocabularies

| # | Point | P3a | P3b | Resolution | Superseded |
|---|---|---|---|---|---|
| D22 | Table names | Real names (0, 1.7) | Placeholders behind `SELLER_TABLES` (preamble, 1.1) | P3a's names fill `SELLER_TABLES` (2.1) | P3b placeholder names (`seller_profiles`, `seller_completion_status`, ...) |
| D23 | Migration names used in P3b | Files 01 to 14 (9.1) | DA-core, DA-status, DA-guards, DA-sanctions, DA-dac7, DA-notify (11.1) | DA-core = files 01 to 03; DA-status = 04; DA-guards = 06 and 08; DA-sanctions = 03 (screen and review records, stage 1) and 11 (lists, stage 2); DA-dac7 = 10; DA-notify = added to 04 (D37) | P3b 11.1 DA list |
| D24 | One write RPC per save | None: service-role writes per table, sealed values through `seller_sealed_put`, history by trigger (note 1, note 2) | `seller_profile_apply(p_owner, p_changes)` writing rows and history in one transaction (13.4 #7) | No general save RPC. Simpler, and history is already atomic per statement because a trigger writes it. Ordering rule in 2.9 keeps a failed save on the safe side | P3b 13.4 #7; 2.7 "one write RPC"; 12.1 `actions.test.ts` "RPC payload" (reads "no write payload holds a plaintext sealed value") |
| D25 | What change history stores | Trigger-written; clear old and new values for clear fields, vault ids for sealed fields, the field's retention class (1.4, 6.3) | Fingerprints only, written by the save RPC (1.7) | P3a: the only version no write path can skip (a staff SQL fix or an Admin write included); it never outlives the data it describes, and sealed values never enter it in either design | P3b 1.7 change history row; 13.4 #7 (history part) |
| D26 | Who writes the published copies on `profiles` | The legacy mirror trigger only (file 06); file 08 refuses every other writer, service role included (note 6, 8.2, 8.3) | `saveSellerProfile` writes "published copies on profiles"; `acceptLegal` writes the declaration, then the profile cache (2.7) | P3a. After the 1B deploy, no action writes those seven columns; `acceptLegal` writes only the declaration and the mirror updates `legal_accepted_*` in the same transaction | P3b 2.7 `saveSellerProfile` "published copies on `profiles`", `acceptLegal` row; 1.2 `storage` role `"published"` (becomes the P3a table and column) |
| D27 | Guard on the published columns | File 08: only the table owner may write the seven columns (8.3) | Request: service-role-only guard on all published columns (13.4 #6) | P3a (stricter: the service role is refused too). `tax_business_name` keeps its existing service-role guard and is written by the mirror | P3b 13.4 #6 (satisfied) |
| D28 | A public email or phone different from the private one | Stage 2: the code proof binds to `profiles.seller_email` and `seller_phone`, which the mirror keeps equal to the public values; until new channels exist the form keeps public = primary (note 8) | Step 6's switch reveals public address, email and phone; a different public email is proven too (2.2 step 6, 1.4 #18, #19, 13.1 #2b) | Stage 1: the switch reveals only the public address. Public email and phone equal the primary ones until stage 2 adds proof channels (section 5, U3). `public_email` and `public_phone` stay null | P3b 2.2 step 6 (stage 1 shows one field group, not three), 1.4 #18 and #19 "code when it differs" (stage 2) |
| D29 | Tax residence and "no TIN issued" | Countries array on `seller_identities`; a `seller_tax_ids` row with `not_issued = true` per country (1.3, 1.5) | "Tax residence rows" with `no_tin_declared` (1.4 #20, #22) | P3a. A not-issued row uses `id_type = 'tin_not_issued'` | P3b 1.4 #20, #22 storage |
| D30 | Identifier vocabularies with dots | CHECKs allow `^[a-z0-9_]{2,40}$` (`id_type`, `register_code`) | `cz.rodne_cislo`, `cz.dic`, `generic.tin`, `cz.or`, `cz.zr`, `cz.other` (3.1, 3.2, 3.3) | Underscores: `cz_rodne_cislo`, `cz_dic`, `generic_tin`, `cz_or`, `cz_zr`, `cz_other`, `generic` | P3b 3.1 to 3.3 identifier spellings |
| D31 | Commercial register file reference | Silent (`register_name` "e.g. the court register and file") | Optional `fileReference` up to 80 characters (1.4 #24, 3.2) | Add `seller_registrations.file_reference` (2.2), mutable like `register_name` | P3a 1.5 `seller_registrations` (amended) |
| D32 | "Goods made outside the EU" answer | Silent | `goodsMadeOutsideEu` boolean, decides whether a default EU responsible person is required (1.4 #29) | Add `seller_trade_profiles.goods_made_outside_eu` (2.2) | P3a 1.5 (amended) |
| D33 | Returns address that follows the public address | `follows` may only be `'primary'` (1.5) | "Returns go to your public address" switch (1.4 #31, 2.2 step 9) | Widen the CHECK: a `returns` row may follow `'public'` (2.2) | P3a 1.5 `seller_addresses_follows` |
| D34 | "Show buyers the same details" switch | Derived: public address `follows = 'primary'`, `public_email` and `public_phone` null (1.3) | Column `public_same_as_primary` (1.4 #15) | Derived, no column | P3b 1.4 #15 storage |
| D35 | Representative snapshot in the authority declaration | Silent | The declaration carries a snapshot of the representative (1.5) | No column: the representative at acceptance time is read from `seller_field_changes`, which the trigger writes for every change of `representative_name` and `representative_role` | P3b 1.5 "representative snapshot" |
| D36 | Declaration kinds, surfaces, IP | Kinds and surfaces fixed by CHECK; full IP, IP country, user agent (1.6, 11.1 #16) | Document ids in camelCase; surfaces `welcome`, `settings`, `confirm`, `legacy`; IP "raw or hashed" (1.5) | P3a's columns and CHECKs; mapping in 2.11. Full IP by default pending the lawyer (P3a rejects hashing, 11.5); dropping it is one line | P3b 1.5 surface names and IP sentence |
| D37 | Notification type `compliance` | Silent | Needed in the notifications CHECK (13.4 #8) | Added to file 04 (one CHECK replace, matching `NOTIFICATION_TYPES`); stage-1 reminders use it | none (gap filled) |
| D38 | Declared sign-up country as evidence | `seller_location_evidence` kinds and sources lack it (1.6) | `signupDeclaredCountry` system field (1.4 #40) | Add kind `signup_declared_country` and source `seller_declared` to the file 03 CHECKs (written in stage 2) | P3a 1.6 CHECKs (amended) |
| D39 | Field keys stored in SQL | `missing_fields`, `requested_fields`, `subject` allow `^[a-z0-9_.]{1,48}$` | `SellerFieldKey` is camelCase (1.2) | SQL stores `snake_case(key)`; the TS list stays camelCase and derives the SQL key; no P3a CHECK changes | P3b 10.4 query reads snake_case keys |
| D40 | Product identifier types | `batch`, `serial`, `model`, `gtin`, `other` (1.8) | `type`, `model`, `batch`, `serial`, `barcode` (1.6) | P3b's list (the app owns it; the database has no CHECK on it in stage 1, and file 14 checks presence only) | P3a 1.8 identifier list |

### 1.4 The status row and the gate

| # | Point | P3a | P3b | Resolution | Superseded |
|---|---|---|---|---|---|
| D41 | Name, key, embedding from `profiles` | `seller_onboarding_status`, keyed `seller_id`, references `seller_records` only; no `seller_*` table may reference `profiles` (1.2, 5.2) | `seller_completion_status`, `owner_id` with a foreign key to `profiles(id)` so PostgREST embeds it into `TRADER_GATE_SELECT` (6.5, 13.4 #1) | P3a's name and key, plus a second foreign key to `profiles(id) on delete cascade`. This is the one exception to P3a's rule, and safe: the row is operational class (kept 0 months, P3a 4.1) and `seller_relationship_end` deletes it anyway. The database hard stop skips accounts without a profile (2.5) | P3a 1.2 first bullet (exception for this table), 5.6 `seller_status_hard_stop` (amended); P3b 13.4 #1 name |
| D42 | Columns | `blocking_reasons`, `missing_fields`, states, verification, sanctions, payments, due dates, `spec_version`, grace (5.2) | Per-purpose `sell_block_reason`, `checkout_block_reason`, `physical_block_reason`, `blocks_from`, `deferred_block_reason`, `establishment_country`, `public_info`, `rules_version`, `valid_until`, `stale_since`, `reasons` jsonb (6.4) | P3a's columns plus `physical_blocking_reasons`, `reasons_detail`, `public_info`, `valid_until`, `stale_since`; `spec_version` holds P3b's `STATUS_RULES_VERSION`. Dropped: the per-purpose reason columns, `blocks_from`, `deferred_block_reason`, `establishment_country`. DDL in 2.5 | P3b 6.4 column table; P3a 5.2 DDL (replaced by 2.5) |
| D43 | Where reason effects are applied | The app writes every reason that applies; SQL walks them in priority order and skips by market rules (payments, stale checks) and by grace (5.4) | The app writes the first effective reason per purpose; the guard reads those columns (6.2, 6.4) | P3a. The stored row does not depend on market switches or on grace, so changing a switch needs no rewrite of any row. TS applies the same walk in one pure function, drift-tested against SQL (2.6) | P3b 6.2 "DB" column, 6.4 per-purpose rows, 6.5 `buildSellerGateInput` field list |
| D44 | Exact-second deadlines | Grace is compared with `now()` in SQL (5.4) | `blocks_from` and `deferred_block_reason` make every deadline exact in the guard (0 #10, 6.4, 6.6) | Dropped. Grace stays exact (SQL compares `grace_until`). Other deadlines take effect at the next recompute: `valid_until` names the moment and the 15-minute sweep recomputes rows past it, so the lag is at most one sweep. DAC7 enforcement is an explicit event written atomically by the database (P3a 6.4) | P3b 0 #10 (exact-second clause), 6.4 `blocks_from` and `deferred_block_reason` rows, 6.6 third bullet, 7.7 "inherits `blocks_from`" (reads "inherits `grace_until`"), 13.5 #2 last clause |
| D45 | State vocabulary | `not_started`, `in_progress`, `awaiting_checks`, `complete`, `blocked` (5.2) | `incomplete`, `pending`, `ready`, `restricted` (6.4) | P3a's. Mapping: incomplete = not_started or in_progress; pending = awaiting_checks; ready = complete; restricted = blocked | P3b 6.4 `state` row |
| D46 | A row that is not complete but names no reason | Fails closed as `details_missing` (5.4) | (fail-open option needs "only checks outstanding, still selling") | P3a's rule, except that `awaiting_checks` with no blocking reason is allowed, so the owner's verification-outage choice (D63) stays a TS setting | P3a 5.4 last `if` (amended, 2.6) |
| D47 | Who may read the status row | The owner through RLS, agent JWTs included ("codes only", for `get_store`) (note 10, 3.1, 3.3, 5.2) | Read by server code with the service role (6.5); `get_store` reads through `getTraderIdentityStatus` | Service role only, no policy. Every reader already uses the service role (checked in code: all `TRADER_GATE_SELECT` sites, `getAccountRow`), and an owner-readable row would let a seller query their own sanctions state over the API (tipping off) | P3a note 10 exception, 1.7 status row, 3.1 last paragraph, 3.3 status sentence, 5.2 grants and both policies, 9.4 test 61 "(but the status row yes)", 11.1 #5 status part |
| D48 | Staleness | Monitor class `ob_status_stale` compares source changes with `computed_at` (5.7) | `stale_since` set by database triggers on every input table (6.4, 13.4 #5) | Both: one trigger function sets `stale_since` (2.5); `ob_status_stale` reads rows whose `stale_since` is older than one hour (the same threshold that turns the sweep red, P3b 6.4) | P3a 5.7 `ob_status_stale` definition |
| D49 | What the app writes in the notice stage | (report mode ignores 1B reasons in SQL) | Block columns written as null in the notice stage (6.9, 10.4 note) | The app always writes the truthful reasons; report mode makes SQL and TS ignore them. The gap report then reads `blocking_reasons` directly | P3b 6.9 notice row, 10.4 parenthesis |
| D50 | The stage switch | Per country: `market_countries.onboarding_gate` `report` or `enforce` (5.1) | One global code constant `SELLER_PROFILE_GATE` `"notice"` or `"enforce"` (0 #14, 1.1, 6.9) | Per country, in TS (`MARKET_ONBOARDING` in `src/lib/seller-profile/policy.ts`) mirrored by `market_countries`, drift-tested; values `report` and `enforce` (P3b's "notice" stage is `report`). Still a code constant: the deploy is the switch | P3b 0 #14, 1.1 `policy.ts` constants `SELLER_PROFILE_GATE`, `ALLOW_PRIVATE_SELLERS`, `PAYMENTS_REQUIRED_FOR` (become fields of `MARKET_ONBOARDING`), 6.9 |
| D51 | Order of the enforcement step | File 09 after the TS gate: "code first" (9.2) | One-line branch `seller/15-enforce`; grace written by a cron route at that moment (6.6, A18) | File 09 first (grace for every existing seller, CZ `enforce`, baseline), then `seller/15-enforce` deployed the same day. Migration first because the app reads grace from the row: code first would block existing sellers before their grace exists. The gap between the two is harmless only if no live seller has a non-graceable reason, which is a precondition the owner checks (section 3, step 39) | P3a 9.2 row 09; P3b A18 "grace backfill run" |
| D52 | Who sets grace | Migrations and staff only; the app's status writer never touches it (note 4, 5.8) | A one-off cron route writes `grace_until` on the profile row (6.6, 13.4 #1, A4) | P3a: the status writer can never extend or shorten a deadline. `/api/cron/seller-grace-backfill` is not built | P3b 6.6 second bullet, 13.4 #1 "`grace_until` on the profile row", A4 "the grace backfill route" |
| D53 | Grace length (owner decision, G 10.2 #7) | 60 days (5.8, 11.1 #7) | 30 days (6.6, 13.1 #7) | Default 30 days: the four accounts with content are internal or test, and buyer-facing seller information is complete sooner. One value in file 09 | P3a 5.8 row 09 "60 days", 11.1 #7 |
| D54 | `charges_enabled` | `market_countries.payments_required` false until Connect is live (5.1, 11.1 #8) | `PAYMENTS_REQUIRED_FOR` `"checkout"`, later `"publish_checkout_listings"` or `"publish_all"` (6.3) | Confirmed: neither blocks publishing while Connect is off. One mechanism: `paymentsRequiredFor` per market in TS; SQL `payments_required` is true only for `"publish_all"` (the own-link middle option is app-only); checkout keeps calling `checkoutProviderFor` live, which counts the dev test provider as ready (P1a 10.3) | P1a 10.3 constant name `SELLER_GATE_REQUIRES_PAYMENTS`; P3b 13.1 #4 wording (unchanged default) |
| D55 | Reasons that apply only to physical offers | Silent | `physical_block_reason` when every missing key is physical-only (6.2) | `physical_blocking_reasons text[]` (values `details_missing`, `details_invalid`). Enforced by the app per offer in stage 1; `seller_sell_block` ignores it; P3a's optional file 14 may add a database guard for physical products in stage 2. Consistent with P3a 1.8 (product safety is app-enforced in stage 1) | P3b 6.2 physical scope column (storage) |
| D56 | Hard stops written by the database | A confirmed match (and, stage 2, DAC7 enforcement) adds its reason atomically (5.6) | Staff decisions mark the row stale; the sweep recomputes (6.4) | Both, compatible: the hard stop writes the reason at once; the recompute derives the same reason from the review or event rows, so the two never fight | none |

### 1.5 The reason vocabulary

| # | Point | P3a | P3b | Resolution | Superseded |
|---|---|---|---|---|---|
| D57 | One list, one spelling | 14 codes (5.3) | 12 1B kinds plus P1a's `market` (6.1) | 13 stored codes, list and effects in 2.6. Renames on the P3b side: `sanctions_blocked` to `sanctions_confirmed`, `dac7_noncooperation` to `dac7_non_cooperation`, `declaration_missing` to `declarations_missing`, `reverification_due` to `verification_expired`. P1a's `market` stays first in TS and is never stored | P3b 6.1 kinds, 6.2 rows, 6.7 copy keys `SellerProfile.gate.<code>` |
| D58 | Sanctions codes | `sanctions_review` (never graceable) and `sanctions_not_screened` (graceable) (5.3) | One `sanctions_pending` with neutral copy, so the seller cannot learn whether a candidate exists (5.3) | One code, `sanctions_pending`, never graceable. Precondition of enforcement: every seller with content has a screen (both designs already require it). Safer: no surface distinguishes "not screened" from "possible match" | P3a 5.2 and 5.3 rows `sanctions_review`, `sanctions_not_screened` |
| D59 | Backfilled values awaiting confirmation | `details_to_confirm` (5.3, 8.1) | Structured fields start empty and the old text is shown as a hint (1.10) | Dropped. Copied values that the seller typed in the old form count as present; anything not copied is simply missing (`details_missing`) | P3a 5.3 row, 8.1 first paragraph "lists it under `details_to_confirm`" |
| D60 | Yearly confirmation overdue | `reconfirm_overdue`, skipped when `stale_checks = 'warn'` (5.3, 5.4) | The yearly prompt is a Needs attention row, never a block (4.6) | Dropped from the vocabulary; `reconfirm_due_at` stays for display | P3a 5.3 row, 5.4 skip line (now names only `verification_expired`) |
| D61 | Private seller where the market allows none | `trader_status_not_allowed` (5.3) | Silent (the form cannot offer it) | Kept: needed if a market's switch changes after sellers chose | P3b 6.1 gains the kind |
| D62 | Invalid stored value; unproven contact | Silent | `details_invalid`, `contact_unproven` (6.1) | Added, both graceable | P3a 5.2 and 5.3 gain them |
| D63 | VIES or ARES unavailable (owner decision, G 10.2 #12) | Fail closed for a new seller, retried; existing sellers covered by grace (11.1 #12) | Pending warns for 72 hours, then blocks (4.5, 13.1 #5) | Default fail closed (P3a): safer and simpler, and staff manual verification is a recorded method for a long outage. The 72-hour option stays one TS setting (D46 makes the database ready for it) | P3b 0 #7 and #15 (default), 4.5 recommendation, 13.1 #5 |
| D64 | Re-verification overdue (owner decision, G 10.2 #11) | `warn` in the beta (5.1 seed, 11.1 #9) | Warn 30 days, then block (4.6, 13.1 #6) | Default: block at expiry, after a 30-day Needs attention warning; the CZ row seeds `stale_checks = 'block'`. Nothing can expire before late 2029, so the beta is unaffected | P3a 5.1 seed value `'warn'`, 11.1 #9 |
| D65 | Display order | Priority order of the SQL list (5.3) | Market, sanctions, re-registration, then field-list order (6.2) | One order: the list in 2.6 (P1a's `market` before it in TS). The first reason is what the seller sees | P3b 6.2 "Order of reasons" |
| D66 | What a seller may see of a sanctions or blocklist block | Codes readable by the owner and agents (3.3) | Neutral copy (5.3), yet `get_store` returns the codes (6.5) and the export says "clear / under review" (8.2) | Until the lawyer answers (P3b 13.2 #5, P3a 11.2 #6): every seller-facing surface (screens, MCP `get_store`, publish refusals, error envelopes) shows `sanctions_confirmed` and `reregistration_blocked` as one neutral code `selling_paused` with "Selling is paused. Contact us."; `sanctions_pending` keeps its neutral wording; the export lists only the dates screenings ran. The raw `seller_blocked:<code>` text can still reach a seller who writes directly over PostgREST (section 5, U4) | P3b 6.5 `get_store` "reasons codes" (for these two), 8.2 screening line |

### 1.6 Verification, sanctions, DAC7

| # | Point | P3a | P3b | Resolution | Superseded |
|---|---|---|---|---|---|
| D67 | Verification result and subject vocabularies | Results `pass`, `fail`, `unavailable`, `mismatch`, `needs_review`, `revoked`; subject is free snake text; backfill uses `public_email`, `public_phone` (1.6, 8.1) | `valid`, `invalid`, `not_found`, `inactive`, `mismatch`, `near`, `unavailable` (4.1); subject = field key | P3a's results with the mapping in 2.11; subject = the snake_case field key (`email`, `phone`, `vat_id`, `business_registration`, `tax_ids`, `legal_company_name`, ...). File 05 writes `email` and `phone` | P3a 8.1 step 7 subjects; P3b 4.1 result names (stored form) |
| D68 | A name change must stop an ARES result counting | "A name change un-verifies the name" through the value fingerprint (6.1 layer 2) | ARES entry fingerprints "the value checked" (4.1), silent on names | The ARES row stores `subject_ref` = the registration row (a new number is a new row) and `subject_fingerprint` = fingerprint kind `name` of the normalised legal or company name, so either change un-verifies it | P3b 4.3 "Stored" line (adds the name fingerprint) |
| D69 | Sanctions in stage 1 (owner decision, G 10.2 #9) | Manual screen per seller by a named reviewer, recorded; monthly and on change; ingest in stage 2 (6.2, 10) | Ingest and automatic screen in stage A, manual as fallback (0 #8, 5.1, 5.6, A7) | Manual in stage 1 (P3a): no dependency on the list token, the parser or the list tables before the beta. P3b's ingest code may be built in stage 1 but is switched on with file 11 in stage 2. States, review and gate are the same either way | P3b 0 #8, 5.6 order of preference (option 1 becomes stage 2), A7 "Needs" (token moves to stage 2), 13.1 #8 and #19 |
| D70 | Screening state and decision vocabularies | Screen `clear`, `potential_match`, `error`; review `false_positive`, `confirmed_match`, `escalated`; status `not_screened`, `clear`, `in_review`, `confirmed_match`, `error` (1.6, 5.2) | `not_screened`, `clear`, `potential_match`, `cleared_by_review`, `confirmed_match`; reviewer "clear" or "confirmed"; `dismissed_dob_conflict` (5.2, 5.3) | P3a's, mapped in 2.11. A candidate dismissed for a conflicting birth date is kept in the screen's `candidates` jsonb with a flag; the screen is `clear` when every candidate is dismissed | P3b 5.3 state names (stored form) |
| D71 | Candidate search | `sanctions_candidates(p_names text[], p_threshold real, p_limit int)` over the list's own trigram index (6.2) | `sanctions_candidates(p_names text[], p_kind text)`; asks for normalised seller name columns or an index (5.2, 13.4 #2, #3) | P3a's signature; the result also returns `subject_type` so the app filters by person or entity. No seller-side name index is needed: seller names are the input, the index is on the list | P3b 5.2 RPC signature, 13.4 #2 second sentence, #3 (satisfied) |
| D72 | DAC7 request record (stage 2) | `seller_dac7_requests` + append-only `seller_dac7_events`; the database refuses enforcement before 60 days or without both reminders (6.4) | One record with `requested_at`, reminder dates, `block_from`, `resolved_at`, `paused_by` (6.8) | P3a's tables. P3b's ladder dates are computed by the app from the events (the database floor still applies). Pausing: add steps `paused` and `resumed` to the events CHECK, allowed only while the request is open, with no effect on `enforce_not_before` | P3b 6.8 "Record" bullet; P3a 6.4 step CHECK (amended in file 10) |

### 1.7 Access, Admin, MCP

| # | Point | P3a | P3b | Resolution | Superseded |
|---|---|---|---|---|---|
| D73 | Team members | Owner only; no team action covers seller details (3.2) | Screens and actions act on the signed-in person's own profile (2.7); Needs attention row owner-only (10.1); but the product form offers defaults "from the seller profile" (7.6) | Confirmed owner-only, with one fix: the "Use my details" suggestion in the product-safety fields is offered only to the store owner (team editors may not read the owner's trade profile, P3a 1.8); editors keep the "copy from your last product" suggestion. Reason titles shown to a team member carry no value | P3b 7.6 first two bullets (owner only) |
| D74 | Agent (MCP) tokens | Owner policies refuse agent JWTs, the status row excepted; no agent file names a `seller_` table other than the status row (3.3) | No tool returns a private or sealed value; `get_store` adds reason codes (8.5, 6.5) | No exception: no file under `src/lib/agent/` names any `seller_` table or calls a `seller_sealed_*` function; `get_store` gets codes through `getTraderIdentityStatus` (service role) | P3a 3.3 exception and test text |
| D75 | Admin views of private data | Every page selecting a private seller table writes a `view_private` row first, with a purpose, fail closed (3.4) | Seller panel shows every field by class, masked sealed values (9.1) | P3a: the panel opens on the public block and the status row; private sections load after a purpose is chosen and the log row is written | P3b 9.1 first bullet (gated behind a purpose) |
| D76 | The Store reveal route | "The application architect owns the route" (2.10) | Not designed (Admin-held key by default) | Built in `seller/11-masking-export`: `src/app/api/internal/seller-reveal/route.ts` (2.9). How Admin's staff session reaches it is open (section 5, U2) | none (gap filled) |

### 1.8 Retention and deletion

| # | Point | P3a | P3b | Resolution | Superseded |
|---|---|---|---|---|---|
| D77 | Retention class names | `dac7`, `dac7_no_sales`, `dsa`, `relationship`, `evidence`, `operational`, `blocklist`, `access_log` (4.1) | `dac7`, `dsa30`, `dac7_dsa30`, `privacy` (1.2, 1.4) | P3a's. A field's class is the class of the table (and address kind) it lands in, overlap going to the longer class (P3a 4.1); a unit test asserts it from the field list. The TS mirror of `seller_retention_rules` lives at `src/lib/seller-profile/retention.ts` | P3b 1.2 `RetentionClass`, 1.4 "Ret" column; P3a's path `src/lib/seller-data/retention.ts` |
| D78 | Deletion job step | `seller_relationship_end` before `deleteUser`, fail closed (4.9) | Requests it (13.4 #10); no branch carries it | New small branch `seller/05a-deletion-retain` (section 3, step 21) | none (gap filled) |
| D79 | Creating the anchor row | "App (anchor at sign-up / first touch)" (1.7) | Silent | Every 1B write path calls `ensureSellerRecord(ownerId)` (insert, on conflict do nothing) before its first `seller_*` write; file 05 creates anchors for existing profiles | none (gap filled) |

### 1.9 Build plan

| # | Point | P3a | P3b | Resolution | Superseded |
|---|---|---|---|---|---|
| D80 | Internal inconsistencies in P3b | | `TaxSection` deleted "in branch `seller/09`" (2.1) but in A8 `seller/08-form`; enforcement "`seller/13`" (6.9) but A18 `seller/15-enforce` | The branch table wins: `seller/08-form` retires `TaxSection` and `saveTaxInfo`; `seller/15-enforce` flips the gate | P3b 2.1, 6.9 branch names |
| D81 | Merged order with 1A | After P1b files 1 to 5 and the cart (9.1) | Prerequisites `market/03`, `04`, `09`, P2 B3, B6, B7 (11.1) | One sequence in section 3 | none |

**Count: 81 points** (D1 to D81).

---

## 2. The reconciled interface

### 2.1 Tables (P3a's, with the roles P3b uses)

Stage 1 unless marked. "Owner" = SELECT for the store owner through RLS, with the
restrictive two-factor policy and never for an agent JWT. Every write is the
service role (or a trigger or definer function), never a client.

| Table | Role in P3b's terms | Client read | Writer | Retention class |
|---|---|---|---|---|
| `seller_records` | anchor, retention clocks, retained Stripe id | none | `ensureSellerRecord`, `seller_relationship_end`, purge | until every class is purged |
| `seller_retention_rules` | retention periods (config) | none | migrations | config |
| `market_countries` | per-country onboarding switches (mirror of `MARKET_ONBOARDING`) | none | migrations | config |
| `seller_identities` | profile: type, trader status, legal names, representative, DOB and birthplace pointers, **DOB fingerprints (new)**, residence countries, permanent establishments | owner | profile actions; vault RPC (pointers) | dac7 |
| `seller_addresses` | addresses, kinds `primary`, `public`, `returns` | owner | profile actions | primary dac7, public dsa, returns relationship |
| `seller_contacts` | primary email and phone (public = primary in stage 1) | owner | profile actions | dsa |
| `seller_trade_profiles` | trading name, website, categories, safety role, **goods made outside the EU (new)**, default EU responsible person | owner | profile actions | relationship |
| `seller_tax_ids` | tax IDs (supersede-only; number sealed; fingerprint; hint; not-issued rows) | owner | profile actions | dac7 |
| `seller_vat_ids` | VAT ID (supersede-only) | owner | profile actions | dac7 |
| `seller_registrations` | business registration (supersede-only), **`file_reference` (new)** | owner | profile actions, ARES prefill | dac7 |
| `seller_payout_accounts` | payout identifier (sealed), holder (sealed); empty until stage 2 | owner | Stripe read (stage 2) | dac7 |
| `seller_vault.sealed_values` | every sealed value | none (schema invisible) | `seller_sealed_put`, `seller_sealed_reseal` | dac7 |
| `seller_declarations` | declarations (append-only) | owner | `acceptLegal`, `acceptSellerDeclarations`, `confirmSellerDetails`, backfill | evidence |
| `seller_verifications` | verification log (append-only) | owner | format checks, VIES, ARES, code redeem, staff | dac7 |
| `seller_field_changes` | change history (append-only, trigger only) | owner | trigger | the changed field's class |
| `seller_location_evidence` | sign-up and billing country evidence | none | sign-up path, plan checkout webhook, Stripe sync | evidence |
| `seller_sanctions_screens`, `seller_sanctions_reviews` | screening records and decisions (append-only) | none | screener, Admin | evidence |
| `seller_data_access_log` | staff and system access log (append-only, no FK) | none | Admin, Store reveal paths, vault RPC | access_log |
| `seller_onboarding_status` | the completion status row (2.5) | **none (changed)** | `recomputeSellerStatus`, hard-stop triggers, `seller_mark_status_stale`, migrations (grace) | operational |
| `seller_period_totals`, `seller_order_extracts`, `orders.paid_at` | frozen DAC7 money | none | compute and freeze functions, trigger | dac7 |
| Stage 2: `seller_dac7_requests`, `seller_dac7_events` | DAC7 request record | owner | DAC7 job, staff | dac7 |
| Stage 2: `seller_reregistration_blocks` | re-registration blocklist (fingerprints) | none | DAC7 enforcement trigger, app (contact fingerprints) | blocklist |
| Stage 2: `seller_retention_purges` | purge log | none | purge function | kept |
| Stage 2: `sanctions_list_versions`, `sanctions_list_entries`, `sanctions_list_names` | the public sanctions list | none | ingest route | superseded entries 30 days |
| Stage 2: `market_threshold_rules`, `seller_threshold_snapshots`, `market_fx_rates` | threshold counters | none | migrations, counters job, FX job | config / dac7 |

`SELLER_TABLES` in `src/lib/seller-profile/tables.ts` maps P3b's roles to these
names. Column conventions (for structural tests in both repos): sealed pointer
`*_sealed_id`; fingerprint `fingerprint` and `fingerprint_key_id` (or
`<field>_fingerprint` and `<field>_fingerprint_key_id`); hint `display_hint`.

### 2.2 Amendments to P3a's DDL

- **File 01.** In `seller_capture_change`, `v_kind` becomes
  `when v_key like '%fingerprint%' then 'fingerprint'` (replacing the exact-name
  test), before the `display_hint` and `else 'clear'` branches.
- **File 02.**
  - `seller_identities`: add `dob_fingerprint text`, `dob_year_fingerprint text`,
    `dob_fingerprint_key_id text` and

    ```sql
    constraint seller_identities_dob_fp check (
      (dob_fingerprint is null or dob_fingerprint ~ '^[0-9a-f]{64}$')
      and (dob_year_fingerprint is null or dob_year_fingerprint ~ '^[0-9a-f]{64}$')
      and ((dob_fingerprint is null) = (dob_year_fingerprint is null))
      and ((dob_fingerprint is null) = (dob_fingerprint_key_id is null))
      and (dob_fingerprint_key_id is null or dob_fingerprint_key_id ~ '^[a-z0-9]{1,16}$'))
    ```
  - `seller_trade_profiles`: add `goods_made_outside_eu boolean` (null = not answered).
  - `seller_registrations`: add `file_reference text` with
    `check (file_reference is null or char_length(file_reference) between 1 and 80)`,
    and add `file_reference` to the mutable list of `seller_registrations_value_guard`
    (beside `register_name`).
  - `seller_addresses`: replace `seller_addresses_follows` with
    `check (follows is null or (kind <> 'primary' and (follows = 'primary' or (follows = 'public' and kind = 'returns'))))`.
    `seller_addresses_follows_empty` stays as is.
  - Convention (no DDL): a not-issued tax ID row has `id_type = 'tin_not_issued'`.
- **File 03.** `seller_location_kind` adds `'signup_declared_country'`;
  `seller_location_source` adds `'seller_declared'`.
- **File 04.** Replace the status DDL with 2.5; the reason functions and
  `seller_sell_block` with 2.6; `seller_status_hard_stop` inserts only when a
  profile exists (2.5); no owner or agent policy on the status row; add
  `seller_mark_status_stale` and its triggers (2.5); seed CZ with
  `stale_checks = 'block'` (D64); do not create the `country_locked` trigger
  (D2); the monitor restatement carries the `r1_seller_country` fix (D3) and
  defines `ob_status_stale` as `stale_since < now() - interval '1 hour'`; the
  notifications type CHECK gains `'compliance'` together with
  `NOTIFICATION_TYPES` (the "two lists" rule).
- **File 05.** Verification subjects `email` and `phone` (not `public_email`,
  `public_phone`).
- **File 06.** In `seller_legacy_mirror`, delete the market filter (the comment
  and the `if v_country is not null and not public.market_allows(...)` block).
  The update statement is unchanged (`coalesce(v_country, p.tax_country)`).
- **File 09.** `grace_until = now() + interval '30 days'` (D53).
- **File 10 (stage 2).** `dac7_events_step` adds `'paused'`, `'resumed'`;
  `seller_dac7_event_guard` accepts them only while `r.state = 'open'` and never
  twice in a row; `seller_dac7_event_effect` does nothing for them.
- **File 11 (stage 2).** `sanctions_candidates` also returns `subject_type`.

### 2.3 What `profiles.tax_country` holds

- Before file 06: whatever the seller or `saveTaxInfo` wrote, as today.
- From file 06: a **server-written legacy copy of the primary address
  country**, whatever that country is (in the market or not). Only the mirror
  trigger writes it, in the same transaction as the `seller_addresses` write.
  A profile without a primary-address row keeps its old value, which
  `market_seller_country` uses as its fallback (file 05 creates a primary row
  for every profile that has a country or an address; re-run it right before
  the 1B deploy to catch late `saveTaxInfo` writes).
- From file 08: no client and no service-role write can change it; only the
  table owner (the mirror, migrations) can.
- No rule refuses or rewrites a truthful value: guard (a) is not built, the
  mirror copies any country, and there is no `country_locked` trigger. Selling
  is what gets refused, by `seller_sell_block` (`seller_country`,
  `account_country`) and P1a's market reason.
- Readers: the TS accessor `establishmentCountryOf` (unchanged, still in
  `TRADER_GATE_SELECT`); buyer pages' display country; Admin's seller card.
  SQL reads the primary address through `market_seller_country`.

### 2.4 Sealing, fingerprints, hints, grants

**Module.** `src/lib/crypto/field-sealing.ts` in Store only (server only).
P3b's API shape, P3a's format:

```
sealField(plaintext, { field, sellerId, subjectId, sealedId }) -> { envelope, keyId }   (throws SealingUnavailable: the save is refused, plaintext is never stored)
openField(envelope, { field, sellerId, subjectId, sealedId }, grant) -> string | null
fingerprint(kind, country, normalised) -> { value, keyId }
isSealedValue(text) -> boolean
```

**Envelope and associated data** (P3a 2.2, unchanged):

```
envelope := "ss1" "." key_id "." base64url(nonce 12 bytes) "." base64url(ciphertext || tag)
key_id   := [a-z0-9]{1,16}
AAD      := "ss1|" field "|" seller_id "|" subject_id "|" sealed_id "|" key_id
field    := tax_id | dob | birth_place | payout_identifier | payout_holder
pattern  := ^ss1\.[a-z0-9]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$   (findSecret uses it)
```

AES-256-GCM, random 96-bit nonce, 128-bit tag. The application generates
`sealed_id` before sealing and passes it to `seller_sealed_put`.

**Keys.** Store Worker secrets only, never on Admin, in Supabase, logs or the
browser:

```
SELLER_FIELD_KEYRING        {"current":"k2611a","keys":{"k2611a":"<32 random bytes, base64url>"}}
SELLER_FINGERPRINT_KEYRING  {"current":"f1","keys":{"f1":"<32 random bytes, base64url>"}}
```

Missing or malformed: every seal, open and fingerprint fails and callers
refuse (`serverError("sealingUnavailable")`). The deploy smoke check reports
`sealingConfigured: true` (booleans only, P3b 2.8).

**Fingerprints** (P3a 2.5 plus three kinds):

```
fingerprint := hex(HMAC-SHA-256(fp_key[key_id], "ss-fp1|" kind "|" country "|" normalised))
```

| Kind | `country` | `normalised` | Stored in |
|---|---|---|---|
| `tax_id` | issuing country | the country module's `normalise()` | `seller_tax_ids.fingerprint` |
| `vat_id` | VIES code (EL for Greece) | number without the prefix | `seller_vat_ids.fingerprint` |
| `registration` | register country | the number (IČO: 8 digits) | `seller_registrations.fingerprint` |
| `payout` | account country | IBAN without spaces | `seller_payout_accounts.fingerprint` (stage 2) |
| `email` | empty | lower-cased, trimmed | blocklist (stage 2), verification `subject_fingerprint` |
| `phone` | empty | E.164 | same |
| `name` | empty | `normaliseCompanyName(...).core`, or normalised first and last name | ARES verification `subject_fingerprint` |
| `dob` | empty | `YYYY-MM-DD` | `seller_identities.dob_fingerprint` |
| `dob_year` | empty | `YYYY` | `seller_identities.dob_year_fingerprint` |
| `person` | empty | the normalised (names, DOB, country) tuple screened | `seller_sanctions_screens.subject_fingerprint` |

Not bound to the seller (duplicate detection and the blocklist need equal
values to match across accounts). A new fingerprint key means recomputing;
blocklist rows are matched under every key id still present (P3a 2.5).

**Hints.** `display_hint`, 2 to 4 characters chosen by the country module (CZ
birth number and DIČ: last 3; payout: last 4). UI shows tax IDs as
`<issuing_country> ••• <hint>`; DOB and place of birth as "On file".

**Grants and the logging RPC.** `openField` accepts only an envelope returned
by `seller_sealed_get`, which writes the access-log row in the same transaction.
A structural test lists the only files that may call `seller_sealed_get` or
`openField(`.

| Grant (P3b 2.8) | Minted in | `p_actor_kind` | `p_purpose` | `p_surface` |
|---|---|---|---|---|
| `OwnerGrant` (export after step-up or a sign-in within ten minutes) | `src/lib/seller-profile/unseal.ts` | `seller` (`p_actor_id` = the owner) | `self_export` | `store` |
| `StaffRevealGrant` (one field, owner role, verified staff session, reason) | the Store reveal route only | `staff` | `dac7_reporting`, `sanctions_review`, `verification_review`, `seller_request`, `dsa_request`, `authority_request`, `fraud_investigation` or `support` | `admin` (with `request_id`) |
| `SystemGrant("dac7_report")` (stage 2) | a cron-secret route | `system` | `dac7_reporting` | `job` |
| key rotation (stage 2) | `/api/cron/seller-sealing-rotate` via `seller_sealed_rotation_batch` | `system` | `key_rotation` | `job` |

P3b's reveal reasons map to purposes: DAC7 report = `dac7_reporting`;
sanctions review = `sanctions_review`; data subject request = `seller_request`;
legal request = `authority_request`; fraud review = `fraud_investigation`.
Purposes other than the two review purposes need a note or ticket (P3a 3.4).

### 2.5 The status row

```sql
create table if not exists public.seller_onboarding_status (
  seller_id                 uuid primary key references public.seller_records (seller_id) on delete cascade,
  state                     text not null,
  blocking_reasons          text[] not null default '{}',  -- seller-wide reasons that apply, any order
  physical_blocking_reasons text[] not null default '{}',  -- reasons that apply only to physical offers (app-enforced in stage 1)
  missing_fields            text[] not null default '{}',  -- snake_case field keys from SELLER_FIELDS
  reasons_detail            jsonb not null default '[]'::jsonb,  -- per reason: code, field keys, check ids, channels, document ids, dates; never a value
  verification_state        text not null default 'none',
  sanctions_state           text not null default 'not_screened',
  payments_ready            boolean not null default false,
  payments_checked_at       timestamptz,
  reverify_due_at           timestamptz,
  reconfirm_due_at          timestamptz,
  public_info               jsonb not null default '{}'::jsonb,  -- buyer projection from buildSellerInfo: public slots only
  spec_version              text not null,                       -- STATUS_RULES_VERSION
  computed_at               timestamptz not null default now(),
  valid_until               timestamptz,                         -- earliest moment the verdict may change
  stale_since               timestamptz,                         -- set by triggers, cleared by the recompute
  complete_since            timestamptz,
  grace_until               timestamptz,                         -- migrations and staff only
  grace_reason              text,
  -- One-to-one embed from profiles (TRADER_GATE_SELECT). Safe: operational class, never retained.
  constraint seller_onboarding_status_profile_fkey
    foreign key (seller_id) references public.profiles (id) on delete cascade,
  -- P3a 5.2 constraints, unchanged: onboarding_state, onboarding_complete_clean,
  -- onboarding_missing_fields, onboarding_verification, onboarding_sanctions,
  -- onboarding_spec, onboarding_grace, seller_onboarding_status_reasons_known. Plus:
  constraint onboarding_physical_reasons check (
    physical_blocking_reasons <@ array['details_missing', 'details_invalid']::text[]),
  constraint onboarding_reasons_detail check (
    jsonb_typeof(reasons_detail) = 'array' and pg_column_size(reasons_detail) <= 8192),
  constraint onboarding_public_info check (
    jsonb_typeof(public_info) = 'object' and pg_column_size(public_info) <= 4096)
);
alter table public.seller_onboarding_status enable row level security;
revoke all on table public.seller_onboarding_status from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.seller_onboarding_status to service_role;
-- No policy: POLICY_FREE_BY_DESIGN, reason "Sellers' gate verdicts, including
-- sanctions state. A client that could read it could learn it is under review;
-- one that could write it could clear itself."
```

Vocabularies: `state` in (`not_started`, `in_progress`, `awaiting_checks`,
`complete`, `blocked`); `complete` means no seller-wide reason (physical-only
reasons do not change `state`); `verification_state` in (`none`, `pending`,
`verified`, `failed`, `expired`); `sanctions_state` in (`not_screened`, `clear`,
`in_review`, `confirmed_match`, `error`).

**Writers.** `recomputeSellerStatus(ownerId, cause)` upserts with an explicit
column list that never includes `grace_until` or `grace_reason` and sets
`stale_since = null`. `seller_status_hard_stop` (P3a 5.6) changes to
`insert ... select p_seller, 'blocked', array[p_reason], 'db_hard_stop', now() where exists (select 1 from public.profiles p where p.id = p_seller) on conflict ...`.
File 09 and staff write the grace pair (`existing_seller`, `staff_extension`).

**Staleness trigger** (file 04):

```sql
create or replace function public.seller_mark_status_stale()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_seller uuid;
begin
  if coalesce(current_setting('seller.retention_purge', true), '') = 'on' then return null; end if;
  v_seller := ((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> tg_argv[0])::uuid;
  update public.seller_onboarding_status s set stale_since = now()
   where s.seller_id = v_seller and s.stale_since is null;
  return null;
end $$;
-- revoked from public, anon, authenticated, service_role.
-- AFTER INSERT OR UPDATE OR DELETE, argument 'seller_id': the eight profile tables.
-- AFTER INSERT, argument 'seller_id': seller_declarations, seller_verifications,
--   seller_sanctions_screens, seller_sanctions_reviews.
-- AFTER INSERT OR UPDATE, argument 'owner_id': seller_payment_accounts.
```

**Embed** (P3b 6.5, names updated):
`seller_status:seller_onboarding_status(state, blocking_reasons, physical_blocking_reasons, grace_until, payments_ready, public_info, valid_until, spec_version)`
appended to `TRADER_GATE_SELECT`; `account-row.ts` changes in the same commit.

**Recompute triggers, sweep and read path:** as P3b 6.4, except that no
`blocks_from` exists (D44) and the read path schedules a recompute with
`after()` as soon as a row is past `valid_until`.

### 2.6 The reason vocabulary

One ordered list. TS: `SELLER_BLOCK_REASONS` and `GRACEABLE_BLOCK_REASONS` in
`src/lib/seller-profile/reasons.ts`, with `SELLER_REASON_EFFECTS`. SQL: the
literals in `seller_block_reason_codes()` (order = priority) and
`seller_block_reason_graceable()`. The P3b union `SellerGateReason` keeps
P1a's `market` kind first; its other kinds equal this list. Drift tests: P3a 5.3
(unit, replica's last definition, order included; db test 63) plus a unit test
that the union's kinds minus `market` equal the list, and P3b's copy test
(every code has `SellerProfile.gate.<code>.{title,sentence,action}`).

| # | Code (priority order) | Raised when | Publishing | Checkout | Existing-seller grace | Stored in |
|---|---|---|---|---|---|---|
| (TS) | `market` (P1a) | seller or Stripe country not allowed | blocks | blocks | no | never stored; SQL returns `seller_country` or `account_country` first |
| 1 | `sanctions_confirmed` | a reviewer confirmed a match | blocks | blocks | no | `blocking_reasons` (also written by the hard stop) |
| 2 | `reregistration_blocked` | an identifier fingerprint matches an active block (stage 2) | blocks | blocks | no | `blocking_reasons` |
| 3 | `dac7_non_cooperation` | a DAC7 request was enforced (stage 2; before that the request shows as a warning only) | blocks | blocks | no | `blocking_reasons` (hard stop at enforcement) |
| 4 | `sanctions_pending` | no screen for the current names and DOB, or a possible match awaiting review | blocks | blocks | no | `blocking_reasons` |
| 5 | `trader_status_not_allowed` | private seller where the market allows none | blocks | blocks | no | `blocking_reasons` |
| 6 | `verification_failed` | VIES invalid; ARES not found, inactive or mismatch | blocks | blocks | no | `blocking_reasons` |
| 7 | `details_missing` | a required field is absent | blocks | blocks | yes | `blocking_reasons`, or `physical_blocking_reasons` when every missing key is physical-only (blocks physical offers only) |
| 8 | `details_invalid` | a stored value today's validator refuses | blocks | blocks | yes | same as 7 |
| 9 | `contact_unproven` | email not proven (phone too when SMS is on) | blocks | blocks | yes | `blocking_reasons` |
| 10 | `declarations_missing` | a required declaration never accepted (an outdated Terms version warns only) | blocks | blocks | yes | `blocking_reasons` |
| 11 | `verification_pending` | a check has not answered | blocks (default); with the 72-hour option, warns for 72 hours then blocks | same as publishing | yes | `blocking_reasons` (with the 72-hour option, only once 72 hours have passed; `valid_until` marks the moment) |
| 12 | `verification_expired` | a required verification is older than 36 months | blocks when the market's `stale_checks` is `block` (default), warns when `warn` | same | yes | `blocking_reasons` (a Needs attention warning runs 30 days before) |
| 13 | `payments_not_ready` | `checkoutProviderFor(ownerId)` is null | blocks only when the market requires payments to publish (`publish_all`; the app alone handles `publish_checkout_listings`) | blocks always (checkout calls `checkoutProviderFor` live, as today) | n/a | `blocking_reasons`; SQL skips it unless `payments_required` |

Warn-only items (never stored as reasons): verification expiring within 30
days, the yearly "still right?" prompt, an outdated Terms version, an open DAC7
request before enforcement, an existing seller's grace deadline.

Seller-facing presentation: `sanctions_confirmed` and `reregistration_blocked`
are shown as the neutral code `selling_paused` (D66).

**`seller_sell_block`** (file 04; replaces P3a 5.4; signature unchanged so
P1b's guards, monitor and simulator call it as before):

```sql
create or replace function public.seller_sell_block(p_seller uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_country text := public.market_seller_country(p_seller);
  v_gate text; v_pay boolean; v_stale text;
  v_status public.seller_onboarding_status%rowtype;
  v_graced boolean; v_reason text;
begin
  -- P1b, unchanged.
  if v_country is null or not public.market_allows('seller_country', v_country) then
    return 'seller_country';
  end if;
  if exists (select 1 from public.seller_payment_accounts a
              where a.owner_id = p_seller and a.charges_enabled and a.country is distinct from v_country) then
    return 'account_country';
  end if;
  -- 1B. An allowed country without a market_countries row fails closed.
  select c.onboarding_gate, c.payments_required, c.stale_checks into v_gate, v_pay, v_stale
    from public.market_countries c where c.country_code = v_country;
  if not found then v_gate := 'enforce'; v_pay := false; v_stale := 'block'; end if;
  if v_gate = 'report' then return null; end if;
  select * into v_status from public.seller_onboarding_status s where s.seller_id = p_seller;
  if not found then return 'details_missing'; end if;
  v_graced := v_status.grace_until is not null and v_status.grace_until > now();
  foreach v_reason in array public.seller_block_reason_codes() loop
    continue when not (v_reason = any (v_status.blocking_reasons));
    continue when v_reason = 'payments_not_ready' and not v_pay;
    continue when v_reason = 'verification_expired' and v_stale = 'warn';
    continue when v_graced and public.seller_block_reason_graceable(v_reason);
    return v_reason;
  end loop;
  -- physical_blocking_reasons: enforced per offer by the application in stage 1.
  -- A row that names no reason yet is not complete is broken: fail closed,
  -- except awaiting_checks (checks outstanding inside their allowance, D46).
  if v_status.state in ('not_started', 'in_progress', 'blocked')
     and cardinality(v_status.blocking_reasons) = 0 then
    return 'details_missing';
  end if;
  return null;
end $$;
-- Grants restated: revoke from public, anon, authenticated; grant to service_role.
```

```sql
-- seller_block_reason_codes(): exactly this list, this order.
array['sanctions_confirmed', 'reregistration_blocked', 'dac7_non_cooperation', 'sanctions_pending',
      'trader_status_not_allowed', 'verification_failed', 'details_missing', 'details_invalid',
      'contact_unproven', 'declarations_missing', 'verification_pending', 'verification_expired',
      'payments_not_ready']::text[]
-- seller_block_reason_graceable(): exactly this list.
array['details_missing', 'details_invalid', 'contact_unproven', 'declarations_missing',
      'verification_pending', 'verification_expired']::text[]
```

**The TS mirror.** `sellerStatusBlock(row, onboarding, offer, now)` in
`reasons.ts` (pure) does the same walk with the same skips, adds
`physical_blocking_reasons` when `offer.physical`, applies `payments_not_ready`
to publishing per `paymentsRequiredFor`, and returns the first code.
`sellerGateReasons` calls it after P1a's `market` reason; `sellerMaySell(row,
offer)` and `publishBlockedError(accountId, offer)` pass the offer (P3b 6.5).
The same fixtures run against TS (unit) and SQL (db test 63).

### 2.7 Per-market onboarding switches

```ts
// src/lib/seller-profile/policy.ts
/** Per-country onboarding switches. Mirrored by public.market_countries (drift-tested). */
export const MARKET_ONBOARDING = {
  CZ: { gate: "report", privateSellersAllowed: false, paymentsRequiredFor: "checkout", staleChecks: "block" },
} as const satisfies Partial<Record<OperatingCountryCode, MarketOnboarding>>;
```

| TS field | SQL column (`market_countries`) | Default |
|---|---|---|
| `gate` (`report`, `enforce`) | `onboarding_gate` | `report` until enforcement day |
| `privateSellersAllowed` | `private_sellers_allowed` | false |
| `paymentsRequiredFor` (`checkout`, `publish_checkout_listings`, `publish_all`) | `payments_required` = (`publish_all`) | `checkout` |
| `staleChecks` (`warn`, `block`) | `stale_checks` | `block` |

Drift: the unit test reads the last canonical upsert (P3a 5.1); every
`market_countries` code must be in `market_rules.seller_countries`. The other
P3b policy constants (`VERIFICATION_PENDING_GRACE_HOURS`, `REVERIFY_*`,
`EXISTING_SELLER_GRACE_DAYS` for display only, `DAC7_LADDER`, ...) stay in
`policy.ts`; `VERIFICATION_PENDING_GRACE_HOURS = 0` means fail closed (D63).

### 2.8 Who reads and writes what

| Data | Store owner | Team member | MCP agent | Store server (service role) | Admin staff | Buyers |
|---|---|---|---|---|---|---|
| Profile tables (non-sealed values, hints, fingerprints) | read own rows (RLS, 2FA); writes only through the actions | nothing | nothing | read, write | read after a logged purpose (`view_private`, fail closed) | only `public_info` and the mirrored public copies |
| Sealed values | full value only in the export after step-up | nothing | nothing | through `seller_sealed_get` (logged) | one value at a time through the Store route, owner role, reason (logged by the database) | nothing |
| Declarations, verification log, change history | read own | nothing | nothing | read, insert | read, logged | the self-certification line only |
| Location evidence, sanctions records, access log | nothing | nothing | nothing | read, insert | read, logged; record screens and decisions | nothing |
| Status row | nothing directly; screens show reasons with neutral sanctions copy | reason titles, no values | `get_store` codes and missing keys (neutral sanctions code) | read, write | read (no log row needed: codes only) | through `public_info` |
| `profiles` published copies | read own; no direct write after file 08 | nothing (as today) | as today | read; no write after file 08 (mirror only) | read (public block, no log row) | through `buildSellerIdentity` |
| Config (`market_countries`, retention rules) | nothing | nothing | nothing | read | read | nothing |

### 2.9 Writers (server actions, routes, jobs, triggers)

| Writer | File | Writes | Notes |
|---|---|---|---|
| `saveSellerProfile` | `src/lib/seller-profile/actions.ts` | `ensureSellerRecord`; profile tables (`updated_by = user.id`, `updated_via = 'seller'`); sealed values through `seller_sealed_put`; DOB fingerprints; verification rows (format, VIES, ARES); recompute | P3b 2.7 checks (whitelist, step-up, budgets, MX, classifier on `trading_name` only, code issue). Ordering: supersede the old tax ID, VAT or registration row first, then insert the new one, then seal; write DOB fingerprints before `seller_sealed_put`. A failure part-way leaves a field missing, never a wrong value counted as verified. Blocklist check (stage 2) |
| `acceptSellerDeclarations` | same | `seller_declarations` | refuses a stale version; owner only |
| `confirmSellerDetails` | same | `details_confirmation` declaration; re-queues checks; recompute | step-up |
| `acceptLegal` | `src/lib/settings/actions.ts` | one `seller_terms` declaration (service role); the mirror updates `legal_accepted_*` | stops writing `profiles` directly (file 08 would refuse it) |
| Contact code redeem hook | `src/lib/contact-verification/service.ts` | `seller_verifications` (method `code`, subject `email` or `phone`); recompute | proof stays on `profiles` |
| Stripe `account.updated` | `src/lib/payments/connect/webhook.ts` | recompute (payout rows in stage 2) | |
| `recomputeSellerStatus` | `src/lib/seller-profile/status.ts` | the status row | never the grace pair |
| `/api/cron/seller-status` (every 15 minutes) | new | recompute stale, past `valid_until`, old `spec_version`, missing rows for accounts with content | answers 500 when a row is stale over one hour |
| `/api/cron/seller-verifications` | new | retries; verification rows | |
| `/api/cron/seller-profile-reminders` | new | notifications (type `compliance`) and email | the notification row records the reminder |
| `/api/internal/seller-reveal` | new, in `seller/11` | `seller_sealed_get` as `staff`; returns one value to Admin | owner role, verified staff session, purpose; U2 |
| `/settings/export` | existing | `seller_sealed_get` as `seller`, `self_export` | sealed values only with an owner grant; screening as dates only |
| Deletion job | `src/lib/account-deletion/run.ts` | `seller_relationship_end(p_seller, 'account_deleted', 'Europe/Prague')` before `deleteUser` | fail closed (P3a 4.9) |
| Admin | `Admin/src/...` | manual screens (`method = 'manual'`, `performed_by`), review decisions (database hard stop on a confirmed match), "re-verify" (`result = 'revoked'`), grace extension (the grace pair only, `staff_extension`), relationship end (`terminated`), `view_private` rows | all through `withSellerAccessLog` |
| Dev route | `src/app/api/dev/seller-status/route.dev.ts` | e2e seeding through the real recompute | dev only |
| Stage 2 | `/api/cron/sanctions-list`, `sanctions-rescreen`, `seller-dac7`, `seller-sealing-rotate`, `seller-retention` | lists, screens, DAC7 events, re-seals, purges | |
| Migrations | files 04, 05, 09 | `market_countries`, retention rules, backfill, grace | owner applies |
| Triggers | P3a and 2.5 | change history, legacy mirror, `stale_since`, hard stops, relationship start, `orders.paid_at` | |

### 2.10 Helpers shared with 1A

| Helper | Owner | What 1B does to it |
|---|---|---|
| `market_rules`, `market_allows(text, text)`, `market_refuse(...)` | P1b file 2, 6 | uses |
| `market_seller_country(uuid)` | P1b file 2 | body replaced in file 04 (primary address, fallback `tax_country`) |
| `seller_sell_block(uuid)`, `seller_may_sell(uuid)` | P1b file 2 | body replaced in file 04 (2.6); guards raise `seller_blocked:<code>` unchanged |
| `market_rule_classes()`, `market_rule_violation_rows()`, `market_rule_baseline_capture()` | P1b file 5 | restated in file 04 with the OB classes and the `r1_seller_country` fix; never re-run P1b file 2 or 5 after file 04 |
| `establishmentCountryOf`, `ESTABLISHMENT_COUNTRY_SELECT`, `readEstablishmentCountry` | P1a `market/04` | unchanged (read the mirror) |
| `sellerGateReasons`, `SellerGateReason`, `sellerMaySell`, `publishBlockedError`, `getTraderIdentityStatus`, `TRADER_GATE_SELECT` | P1a `market/04` | 1B kinds appended (2.6); offer-aware wrappers; the status embed |
| `checkoutProviderFor` | existing | read for `payments_ready` |
| `EstablishmentCountryField`, `CountryStep`, `NotOpenYet` | P1a `market/09`, P2 `market/waitlist` | step 0 of the form |
| `completeness.ts`, the `profile` Needs attention row | P2 `market/profile-attention` | items generated from the status reasons |

### 2.11 Vocabulary mappings

| P3b | Stored (P3a) |
|---|---|
| declaration `sellerTerms`, `selfCertification`, `privacyAcknowledgement`, `traderStatus`, `representativeAuthority`, `detailsConfirmation` | kind `seller_terms`, `dsa_self_certification`, `privacy_acknowledgement`, `trader_status` (choice in `statement_value`), `representative_authority` (`accepted_as = 'representative'`), `details_confirmation` |
| surface `welcome`, `settings`, `confirm`, `legacy` | `welcome`, `settings`, `reconfirm`, `backfill` |
| VIES or ARES `valid` | `pass` |
| `invalid`, `not_found`, `inactive` | `fail` (`evidence.outcome` says which) |
| `mismatch` | `mismatch` |
| `near` | `needs_review` until the seller picks; then `pass` with `evidence.kept_own_spelling` true or false |
| `unavailable` | `unavailable` |
| staff "re-verify" | `revoked` |
| screening `potential_match`; `cleared_by_review`; reviewer "clear"; reviewer "confirmed" | screen `potential_match`, status `in_review`; status `clear`; review `false_positive`; review `confirmed_match` |
| retention `dac7`, `dsa30`, `dac7_dsa30`, `privacy` | the table's class (2.1) |
| tax ID types, registers | `cz_rodne_cislo`, `cz_dic`, `generic_tin`, `tin_not_issued`; `cz_or`, `cz_zr`, `cz_other`, `generic` |

Field storage (P3b 1.4 numbering): #1 `seller_addresses` primary `.country`
(mirrored to `tax_country`); #2, #3, #4, #5, #6, #10, #11, #20, #25
`seller_identities`; #7, #26, #27, #28, #29, #30 `seller_trade_profiles`; #8
vault `dob` + `dob_sealed_id` + DOB fingerprints; #9 vault `birth_place`
(`{city, country}`) + `birth_place_sealed_id`; #12, #17, #31 `seller_addresses`
kinds `primary`, `public`, `returns`; #13, #14 `seller_contacts` primary
(mirrored to `seller_email`, `seller_phone`; proofs on `profiles`); #15
derived; #16 `seller_addresses.legacy_text`; #18, #19 `seller_contacts`
public (null in stage 1); #21, #22 `seller_tax_ids`; #23 `seller_vat_ids`
(mirrored to `tax_vat_id`); #24 `seller_registrations`; #32
`seller_payment_accounts` + `seller_records.stripe_account_id`; #33, #34
`seller_payout_accounts`; #35 to #38 and #41 `seller_declarations`; #39
sanctions tables; #40 `seller_location_evidence`; #42 `seller_verifications`,
`seller_field_changes`.

---

## 3. One order of work

Stage: **Beta** = needed before the Czech beta opens; **Soon** = follows
shortly after; **Off** = built but switched off (or waiting for a money-flow
decision). Every migration is applied by the owner in the SQL editor; every
deploy is the owner's; everything is built on local branches in worktrees.
"Depends on" means merged first, or for a migration, present in the replica.
1A items keep PLAN section 4's names; 1A migrations are
`20261122_market_N_*.sql`, 1B migrations `20261122_seller_NN_*.sql`.

| # | Item | Depends on | Stage | Waits for |
|---|---|---|---|---|
| 1 | Migration `20261120_shopping_cart.sql` (exists) | none | Beta | owner applies |
| 2 | `market/01-strict-currency` | none | Beta | owner deploys |
| 3 | `market/00-copy` | none | Beta | copy review |
| 4 | Migration `market_1_czk_currency` | 1 | Beta | owner applies |
| 5 | `market/02-czk-storable` | 2, 4 | Beta | owner deploys after 4 |
| 6 | Migration `market_2_rules_mirror` | 4 | Beta | owner applies |
| 7 | `market/03-market-root` | 5, 6 | Beta | owner deploys after 6 |
| 8 | Migration `market_3_columns` | 6 | Beta | owner applies |
| 9 | Migration `market_4_demo_sim` | 6 | Beta | owner applies; owner's simulator choice (PLAN 5 item 5) |
| 10 | Migration `market_5_monitor`, with `r1_seller_country` counting only sellers with an active product (D3) | 6 | Beta | owner applies (4, 6, 8, 9, 10 may be one bundle, P1b 7.1) |
| 11 | `seller/00-copy` (namespaces `SellerProfile`, `SellerInfo`, gate copy incl. `selling_paused`) | 3, P2 copy branches | Beta | lawyer drafts marked DRAFT; copy review; bulk translation |
| 12 | `seller/01-sealing` (P3a envelope, keyrings, grants, `findSecret` pattern) | none | Beta | keyring secrets before the deploy (step 37) |
| 13 | `seller/02-field-spec` (list, rules, declarations, `policy.ts` with `MARKET_ONBOARDING`, `reasons.ts`, `tables.ts`, `retention.ts`) | 11 | Beta | none |
| 14 | `seller/03-country-validators` (underscore ids) | 13 | Beta | tax adviser formats (ships `formatsStatus: "draft"`) |
| 15 | `lab/seller-profile`, `lab/seller-info` | 13 | Beta | owner's lab picks |
| 16 | `market/04-seller-gate` | 7, 8 | Beta | owner (changes who can sell) |
| 17 | `market/05`, `market/06`, `market/09`, `market/10`, `market/07` | per PLAN 4 | Beta | per PLAN 4 |
| 18 | Migrations `seller_01_foundation` to `seller_07_money_retention` as one bundle, with the amendments in 2.2 | 1, 10 | Beta | owner applies |
| 19 | `seller/04-status` (facts, status computation, recompute, sweep and workflow; no grace route) | 13, 14, 16, 18 | Beta | none to build |
| 20 | `seller/05-profile-actions` (actions, `acceptLegal` to declarations only, redeem hook, budgets, `ensureSellerRecord`) | 12, 19 | Beta | none |
| 21 | `seller/05a-deletion-retain` (`retain` step before `deleteUser`, deletion copy) | 18 | Beta | lawyer text for "what is kept" |
| 22 | `seller/06-verification` (VIES, ARES, name match, retries; fail closed default) | 20 | Beta | owner decision (default in code) |
| 23 | `seller/07-sanctions`: manual method, states, screen-on-change marking; ingest code and workflow built but disabled | 18, 19 | Beta (manual); ingest Off until 44 | none for stage 1 |
| 24 | `seller/08-form` (wizard and overview, step 0 saves the country, retires `TaxSection` and `saveTaxInfo`) | 20, 22, `market/09`, P2 `market/waitlist` and `market/welcome-country-step`, lab pick 15 | Beta | lab pick |
| 25 | `seller/09-seller-info` (component, placements, email lines; private-seller variant built Off) | 19, lab pick 15 | Beta | lawyer (self-certification line, trader wording) |
| 26 | `seller/10-product-safety` (owner-only "Use my details") | 13, 20 | Beta | lawyer (embed duty, warning languages) |
| 27 | `seller/11-masking-export` (MCP boundary, `get_store` codes with `selling_paused`, export, Store reveal route) | 20 | Beta | none |
| 28 | `seller/12-gate-read` (embed, `sellerStatusBlock`, offer-aware wrappers, four direct callers, e2e fixture route) | 19, 16 | Beta | none |
| 29 | `seller/13-existing-sellers` (completeness items, `profile` row, reminders) | 19, P2 `market/profile-attention`, 18 (notification type) | Beta | owner (what existing sellers are told) |
| 30 | `admin/seller-01-profile` (panel, `withSellerAccessLog`, reveal through the Store route; no key in Admin) | 18, 27 | Beta | owner: who may reveal (default owner role) |
| 31 | `admin/seller-02-sanctions` (record a manual screen; review queue and decisions) | 18, 23 | Beta | none |
| 32 | `admin/seller-03-report` (status rows only) | 19 | Beta | none |
| 33 | `market/11-e2e`, `seller/14-e2e` (specs 110, 111, 120 to 124) | 17, 24 to 29 | Beta | owner OK for a `ci/**` push |
| 34 | 1A deploy of `market/04`, `05`, `06` (and `07` when Connect is near), after the report-mode monitor read | 16, 17, 10 | Beta | owner signs off the list of what hides |
| 35 | Migration `market_6_guards` (without guard (a)) | 34 | Beta | owner applies, after the rehearsal |
| 36 | Re-run `seller_05_backfill` | 18 | Beta | owner, right before step 37 |
| 37 | 1B deploy in report mode (steps 11 to 32) | 18, 34, 36 | Beta | owner deploys; keyring secrets on the Store Worker |
| 38 | Migration `seller_08_legacy_guard` | 37, a grep of every writer of the seven columns (Store, Admin, App, e2e seeds, db test 26) | Beta | owner applies |
| 39 | Prerequisites of enforcement: production mail on; every seller with content screened and recorded; final declaration texts landed as version bumps; gap report read showing no live seller with a non-graceable reason | 37 | Beta | owner, lawyer |
| 40 | Migration `seller_09_enforce` (CZ `enforce`, 30-day grace, OB baseline), then `seller/15-enforce` deployed the same day | 35, 38, 39 | Beta | owner applies and deploys, after a rehearsal of 09 |
| 41 | Migration `market_7_billing_required` | 34 (with `market/07` verified in production) | Soon | owner applies |
| 42 | `market/08-czk-reporting` with migration `market_8_reporting_currency` | 5 | Soon | owner |
| 43 | Migration `seller_10_dac7_requests` (with `paused`, `resumed`); `seller/16-dac7`; `admin/seller-04-dac7` | 40 | Soon | lawyer and tax adviser (ladder, texts, blocklist basis); production mail |
| 44 | Migration `seller_11_sanctions_lists`; enable the ingest workflow and rescreen route | 23, 40 | Soon | `EU_FSF_TOKEN` repository secret |
| 45 | Migration `seller_12_retention_purge`; purge route in `scheduled.yml` | 18 | Soon | lawyer and tax adviser (periods) |
| 46 | Migration `seller_13_thresholds` (DAC7 small-seller counter, FX) | 18 | Soon | tax adviser (definitions, rate) |
| 47 | `seller/17-reverify` | 22 | Soon | none (default in code) |
| 48 | `seller/18-signup-evidence` | P2 sign-up branch | Soon | tax adviser (evidence rules) |
| 49 | Key rotation route `/api/cron/seller-sealing-rotate` | 12 | Soon | none |
| 50 | Public email or phone different from the primary one (new proof channels) | 20; a `contact_verifications` migration not yet designed (U3) | Soon | owner |
| 51 | Migration `seller_14_gpsr_guard` (optional) | 26 | Soon | owner applies |
| 52 | `seller/22-warnings-locales` | 26 | Soon | lawyer |
| 53 | `seller/19-payout-identifier` | 18 | Off | owner's account-type decision; one Stripe test-mode check |
| 54 | `seller/20-stripe-prefill` | 53's decision | Off | owner; lawyer (privacy notice line) |
| 55 | `seller/21-private-sellers` (switch on the variant from 25) | 25 | Off | owner; lawyer (notice) |
| 56 | Payments required to publish (`paymentsRequiredFor: "publish_all"` and the market row) | 40 | Off until Connect is live | owner |
| 57 | Stage 3: US counters and INFORM fields, OFAC, more country modules | 46, 44, 14 | Off | owner |

Stage-1 bundles for the owner: steps 4 to 10 (1A), step 18 (1B 01 to 07),
step 38 alone, step 40 alone. Never re-run P1b file 2 or 5 after step 18.

---

## 4. Things only the owner can do

Merged from P3b 11.6, P3a (sections 2.10, 6.2, 9.1, 11.1, 11.6), Audit G 10.2
and PLAN section 5 (1A items already listed there are not repeated). Each item
can be filed as a task as written.

1. **Create the two sealing secrets on the Store Worker and keep offline
   copies.** In the Store repo, for the production Worker:
   `wrangler secret put SELLER_FIELD_KEYRING` with the value
   `{"current":"k2611a","keys":{"k2611a":"<32 random bytes, base64url>"}}` and
   `wrangler secret put SELLER_FINGERPRINT_KEYRING` with
   `{"current":"f1","keys":{"f1":"<32 random bytes, base64url>"}}`. Generate each
   key separately, for example with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   Keep two offline copies of both values in separate places (a password
   manager entry and a second sealed copy held by another trusted person).
   Never put them on the Admin Worker, in Supabase, in the repo, in a ticket or
   in chat. Losing both copies loses every sealed tax ID, date of birth and
   payout identifier for good. Needed before the 1B deploy (section 3, step 37).
2. **Apply the 1B migrations in the Supabase SQL editor** (the connector
   declines writes): (a) `20261122_seller_01_foundation.sql` to
   `20261122_seller_07_money_retention.sql` as one `begin; ... commit;` bundle,
   after the cart migration and 1A files 1 to 5; (b) re-run
   `20261122_seller_05_backfill.sql` right before the 1B deploy; (c)
   `20261122_seller_08_legacy_guard.sql` alone, after the 1B deploy; (d)
   `20261122_seller_09_enforce.sql` alone on enforcement day, after a rehearsal
   (`begin; <file>; select * from public.market_rule_violations(); rollback;`);
   (e) stage-2 files 10 to 14 when their branches are ready. Before (c), run
   the read-only checks P3a 11.4 lists against production (the owner role is
   `postgres`; the live definitions of the `profiles` triggers,
   `seller_sell_block`, `market_seller_country` and the monitor).
3. **Approve the two 1B deploys**: report mode (step 37), then enforcement
   (step 40, the same day as file 09).
4. **Turn production transactional email on and decide SMS.** Check in the
   Cloudflare dashboard whether `TRANSACTIONAL_EMAIL_ENABLED` and
   `SMS_ENABLED` are already set on the Store Worker; turn email on (Brevo
   SMTP, memory note on mail). Without it, email proof cannot be enforced and
   reminders and DAC7 notices go in-app only. Decide whether phone proof needs
   SMS in production (cost, region).
5. **Act as the named sanctions reviewer in stage 1.** Before enforcement,
   screen every account that owns a product or a storefront (4 today) against
   the EU Financial Sanctions Files (the Commission's consolidated list file or
   its search), and record each in Admin under Compliance > Sanctions: the
   list's publication date as seen, what was searched (or the downloaded
   file's SHA-256), the result. A possible match needs a decision ("not the
   same person" or "confirmed") with a written reason; the date of birth is
   revealed through the logged reveal. Then repeat for every active seller
   monthly and whenever a seller changes a legal name or date of birth (file a
   recurring monthly task).
6. **Decide the 1B defaults** (each has a default in code; see PLAN section 7
   table): private sellers; charges enabled; email proof by code or link;
   phone required and SMS; existing sellers' grace (30 days) and what they are
   told; sanctions provider, reviewer and frequency; key custody and who may
   reveal (owner role); VIES or ARES outage (fail closed); re-verification
   overdue (block after 30 days' warning); product categories and high-risk
   handling; storing the full IP in declarations; DAC7 non-cooperation (block,
   no closure); whether a seller may download sealed values only through the
   export.
7. **Send the lawyer the 1B drafts and questions.** Draft texts (message keys
   marked DRAFT in `messages/en/sellerProfile.json` and
   `messages/en/sellerInfo.json` once `seller/00-copy` exists): the
   self-certification and its buyer line; the privacy acknowledgement including
   reporting to tax authorities; the trader and private-seller statements and
   the private-seller notice; the representative authority statement; the DAC7
   request, reminders and "blocked" texts; "Selling is paused"; the deletion
   copy on what is kept. Questions, merged from P3a 11.2, P3b 13.2 and G 10.3:
   retention periods (DSA 6 months even on request, evidence 3 years, access
   log, blocklist 10 years) and the privacy notice text including backups;
   lawful basis for the birth number, date and place of birth and the
   fingerprint blocklist; a Czech natural person's VAT number that contains the
   birth number, stored and shown in clear; whether DSA Art. 30 applies to a
   micro or small operator (Art. 29); storing the full IP in declarations, and
   for how long; sanctions (basis, Art. 22 GDPR, what a seller may be told
   during and after a review, reporting to the Czech Financial Analytical
   Office); whether staff access logs are disclosed on an access request;
   minimum age 18 (date-of-birth check or declaration); a home-based trader's
   published address; GPSR in the embed and warnings in the buyer's language;
   an ARES match as verification; representative authority (declaration or
   evidence); DAC7 non-cooperation as a selling block without closure;
   accepting "keep my spelling" on a near match; the representative's name kept
   10 years.
8. **Send the tax adviser the 1B formats and questions** (P3b 3.2 and 13.3,
   P3a 11.3, G 10.4): every Czech format and check (IČO including short input,
   DIČ including the `699` assigned form, the birth number including the
   remainder-10 numbers after 1985); which is the DAC7 tax number for a Czech
   individual (birth number or DIČ) and for a company (DIČ or IČO); a published
   specimen of a nine-digit birth number for tests; VIES results without a
   consultation number while the operator is not VAT-registered; when the 10
   years start and whether they apply to sellers who never sold; when a country
   "does not issue" a TIN; several tax residences; payout last 4 digits and
   holder; sign-up IP and billing country as evidence and their retention;
   period attribution (payment time, time zone, refunds in the sale's or the
   refund's quarter); "relevant activity" and consideration net of fees; the
   exchange rate for the EUR 2,000 test; frozen quarterly totals as
   substantiation; the DAC7 ladder timing.
9. **Pick in the two labs**: `/dev/seller-profile-lab` (form shell and step
   layout) and `/dev/seller-info-lab` (the Seller info block and its dialog),
   once `lab/seller-profile` and `lab/seller-info` are built (local `next dev`).
10. **Read the existing-seller gap report and choose enforcement day.** Admin
    Compliance > Sellers (or the read-only query in P3b 10.4, which reads
    `blocking_reasons`). Confirm every seller with content has a screen and no
    live seller has a non-graceable reason; then approve step 40.
11. **Approve the `ci/**` push for the 1B end-to-end specs** (120 to 124, with
    1A's 110 and 111). Needs a working GitHub sign-in on the dev PC (expired
    21 Nov, PLAN 5 item 7).
12. **Stage 2: register for the EU Financial Sanctions Files token** on the
    Commission's FSF service and store it as the GitHub repository secret
    `EU_FSF_TOKEN` on the Store repo (never in a file or log).
13. **Publish the updated privacy notice and deletion copy** on Home and in
    Store once the lawyer has written them: seller records outlive the account
    (DAC7 10 years after the last year with a sale, DSA data 6 months, evidence
    3 years), sealing, sanctions screening, VIES and ARES checks, backups.
14. **After the account-type decision (PLAN 5 item 1): one Stripe test-mode
    check** whether a platform-created Standard account returns
    `external_accounts` (last 4, holder name) after onboarding. Decides whether
    the payout identifier is read (`seller/19`). Uses the restricted test keys
    of PLAN 5 item 8.

---

## 5. Not reconciled, and why

- **U1. P1a's country lock on `saveTaxInfo`** (P1a 4.7, branch `market/04`)
  refuses a change of `tax_country` away from the stored Stripe country. That
  refuses a truthful country, which the binding decision forbids, but it is a
  1A design outside the two documents reconciled here. 1B does not carry it
  into `saveSellerProfile` and retires `saveTaxInfo` in `seller/08-form`.
  Recommended for 1A: save the country and answer with the
  `Settings.tax.countryLocked` wording as a warning, since `account_country` in
  `seller_sell_block` already blocks selling on a mismatch. In practice it
  cannot fire before 1B: there are 0 connected accounts and Connect is off.
- **U2. How Admin's staff session reaches the Store reveal route.** Neither
  design settles it (P3a 11.6 lists it as unknown; P3b designed an Admin-held
  key instead). Default for the build: Admin forwards the staff member's own
  Supabase access token as a bearer token; Store verifies it, requires aal2 and
  checks `admin_users.role = 'owner'`, rate-limits, and calls
  `seller_sealed_get` as `staff`. If that proves impossible in production, the
  fallback (Admin holding the keyring, P3a option B) widens exposure and needs
  the owner's explicit decision; it is not the default.
- **U3. A public email or phone different from the primary one.** Both designs
  defer it, and neither drafted the migration that widens
  `contact_verifications_channel` (today `email` and `phone` only) or the proof
  flow for a third channel. Stage 2, to be designed.
- **U4. A direct PostgREST write can reveal a sanctions block.** A seller who
  writes to `products` with their own token gets the raw database error
  `seller_blocked:sanctions_confirmed`. The app maps every refusal to neutral
  copy (D66), but the database message is not masked. Whether that matters is
  part of the lawyer's question on what a seller may be told; masking it would
  mean `seller_sell_block` returning a neutral code, which also hides the
  reason from the monitor detail.
- **U5. Brute-forcing low-entropy fingerprints.** A date of birth (about 36,500
  values), a birth year (about 100) or a birth number can be recovered from a
  fingerprint by anyone holding the fingerprint keyring and the database.
  Both designs accept it: the keyring has the same custody as the sealing key,
  and whoever holds both can open the vault anyway. Stated, not solved.
- **U6. Stage-1 screening is not continuous.** Manual screening covers
  onboarding, monthly re-screens and name or DOB changes; a list update between
  monthly runs is not caught until the next run. Any public statement must say
  "screened at onboarding and periodically" until step 44.
- **U7. A sanctions code in the reasons array is visible to staff with SQL
  access.** By design (staff are trusted and logged for private data); noted
  only because the status row is not covered by `view_private` logging (it
  holds codes, not personal data).
