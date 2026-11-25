# P3a: universal seller onboarding data (1B), the data side (design)

Design only. Nothing here has been built or applied, and no migration file has
been created: every piece of SQL below is a DRAFT inside this document. Every
schema change is ADDITIVE and non-destructive, and every one **needs the owner's
approval before it is applied to production**. Nothing deletes or rewrites
existing seller data; the existing columns on `profiles` stay until a later,
separately approved cleanup. Stripe does the identity checks: no ID document
scan and no beneficial owner is ever stored by us.

Not legal or tax advice. Where the specification leaves a point to the lawyer
or the tax adviser, the answer is a configuration row or a text, and the
question is listed in section 11.

Written 2026-11-22 from the SQL and code on disk. Path prefixes `Store/`,
`Admin/` are `C:\Squareshare\<repo>\`. "Replica" is
`Store/tests/db/prod-migrations.sql`. "P1b" is
`Store/docs/compliance/plan/P1b-database-guards-design.md` (designed, not on
disk yet: its objects are cited by section and line of that document). "G" is
`audit/G-seller-onboarding-data.md`, "D" is `audit/D-dac7-readiness.md`. SQL is
ASCII (the embedded test database is WIN1252 on Windows).

Contents: 0 the design in one page; 1 data model; 2 encryption; 3 access;
4 retention and deletion; 5 completion status and the gates; 6 verification
log, sanctions, change history; 7 threshold counters; 8 backfill and
coexistence; 9 migration plan and tests; 10 staging; 11 decisions, questions,
risks, rejected alternatives, unknowns.

---

## 0. The design in one page

**Two worlds.** Everything that hangs off `auth.users` dies with the account
(today: profile, orders, payment account; `Store/src/lib/account-deletion/run.ts:8-13`).
Every new `seller_*` table instead hangs off ONE anchor, `seller_records`,
keyed by the seller's user id with **no foreign key to `auth.users` or
`profiles`**. Deleting the auth user therefore cannot cascade any of it away;
only the retention purge, which knows each row's clock, deletes it.

**Tables (stage 1 unless marked).**

| Group | Tables |
|---|---|
| Anchor and config | `seller_records`, `seller_retention_rules`, `market_countries` |
| Profile (current values) | `seller_identities`, `seller_addresses` (primary, public, returns), `seller_contacts`, `seller_trade_profiles`, `seller_tax_ids`, `seller_vat_ids`, `seller_registrations`, `seller_payout_accounts` |
| Sealed values | `seller_vault.sealed_values` (a schema PostgREST does not expose) |
| Evidence (append-only) | `seller_declarations`, `seller_verifications`, `seller_field_changes`, `seller_location_evidence`, `seller_sanctions_screens`, `seller_sanctions_reviews`, `seller_data_access_log` |
| Gate | `seller_onboarding_status` |
| Money retained for DAC7 | `seller_period_totals`, `seller_order_extracts`, plus `orders.paid_at` |
| Stage 2 | `seller_dac7_requests`, `seller_dac7_events`, `seller_reregistration_blocks`, `seller_retention_purges`, `sanctions_list_versions`, `sanctions_list_entries`, `sanctions_list_names`, `market_threshold_rules`, `seller_threshold_snapshots`, `market_fx_rates` |

**Sealed, and how.** Tax ID numbers, date of birth, place of birth, the payout
identifier and the payout holder name are sealed by the APPLICATION
(AES-256-GCM, a new keyring Worker secret) before they reach the database.
The envelopes live in one table, `seller_vault.sealed_values`, in a schema no
API role can even see. The public tables hold only a pointer (`*_sealed_id`),
a keyed fingerprint (HMAC under a second secret) and a 2 to 4 character hint.
The only way to reach an envelope through the API is a SECURITY DEFINER RPC
that writes the access-log row in the same transaction, so a reveal without a
log row is impossible.

**Who reads what.** The seller (store OWNER only; no team role covers seller
details) reads their own non-sealed rows through RLS SELECT, with the
two-factor restrictive policy, and never through an agent (MCP) JWT. Sealed
values reach the owner only through a server action after the 2FA step-up,
which calls the logging RPC. Staff read through Admin with the service role;
every view of private data writes `seller_data_access_log`, and every sealed
reveal is logged by the database itself. No client role can write any
`seller_*` table.

**What account deletion keeps.** Before `deleteUser` the job calls
`seller_relationship_end()`: it freezes per-seller per-quarter totals and an
order extract (no buyer data) while the orders still exist, copies the Stripe
account id, stamps the end of the relationship and the last sale year. Then:
the DAC7 set (identity, sealed IDs, addresses, VAT, registration, payout,
verification log, DAC7 trail, totals) is kept until 10 years after the end of
the last reporting year with a sale; the DSA Art. 30 set (contacts, public
address) 6 months after the end; trade profile and returns address 6 months;
evidence (declarations with IP, sanctions, change history, location evidence)
3 years. All periods are rows in `seller_retention_rules` for the lawyer and
the tax adviser to set.

**How the gate reads completion.** The application computes completeness and
writes ONE `seller_onboarding_status` row (state, `blocking_reasons`,
`missing_fields`, verification, sanctions, payments, grace). P1b's
`seller_sell_block()` gains one block: it reads that row and the market's
`market_countries` row, walks the canonical reason list in priority order, and
returns the first reason that is not skipped (payments not required, stale
checks set to warn, or a graceable reason during an existing seller's grace).
SQL never re-implements a field rule. `market_seller_country()` switches to the
structured primary address country with a fallback that makes the switch safe
at any moment.

**Migration order.** After P1b files 1 to 5 (and the cart migration): seller
01 foundation, 02 profile, 03 evidence, 04 status and gate (market rule
"report"), 05 backfill, 06 legacy mirror, 07 money retention; then the
TypeScript deploy; then 08 legacy-column guard (closes direct PostgREST writes
of `legal_accepted_*` and the identity columns), 09 enforce (CZ "enforce",
grace for existing sellers, baseline capture). Stage 2 files 10 to 14.

**Staging.** Stage 1 (Czech beta opens): everything the gate needs, with
sanctions screened MANUALLY by a named staff reviewer and recorded per seller.
Stage 2: DAC7 request ladder and re-registration block, automated EU list
ingest and re-screen, retention purge job, DAC7 small-seller counter, payout
identifier, access-log hash chain. Stage 3: US counters, OFAC, buyer totals per
US state, more country validators (generic already).

### Interface notes for the application architect (read these first)

1. **Sealed values go through RPCs, not columns.** Write: create the public row
   (pointer null), generate the sealed row id yourself (it is part of the AAD),
   seal, call `seller_sealed_put(...)`, which stores the envelope, supersedes the
   previous one and sets the pointer in one transaction. Read:
   `seller_sealed_get(...)` (logs, then returns envelopes). Rotation:
   `seller_sealed_rotation_batch` + `seller_sealed_reseal`. Section 2.7.
2. **Every write to a mutable `seller_*` row sets `updated_by` and
   `updated_via`** (`seller`, `staff`, `system`, `backfill`); the change-history
   trigger reads them. A write that forgets records the previous actor.
3. **Tax IDs, VAT IDs, registrations and payout rows are supersede-only.**
   Their value columns are immutable per row (a guard trigger refuses an
   edit): a change is a new row plus `superseded_at` on the old one. This is
   what makes earlier verifications stop applying, together with the value
   fingerprint stored in each verification row.
4. **Status row.** Write it with an explicit column list that never includes
   `grace_until` / `grace_reason` (owned by migrations and staff). Storage order
   of `blocking_reasons` does not matter: SQL evaluates them in the canonical
   priority order. Two database triggers may also write it: a confirmed
   sanctions match and (stage 2) an enforced DAC7 closure prepend their hard-stop
   reason atomically (section 5.6). No status row reads as `details_missing`.
5. **Reason vocabulary.** You own the canonical TypeScript list; the SQL mirror
   is the literal in `seller_block_reason_codes()` (order = priority) and
   `seller_block_reason_graceable()`, drift-tested (section 5.3). My proposed
   list is in 5.3; change it there and in TS together.
6. **Legacy columns.** After file 06 the new tables are the source; a trigger
   mirrors trading name, public address, primary country, public email and
   phone, the shown VAT ID and the Terms acceptance into `profiles`, so code
   that has not moved keeps reading correct values. After file 08 nobody but
   that mirror (and the table owner) may write those columns: move every
   writer first (`saveTaxInfo`, `acceptLegal`, the welcome step, e2e seeds).
7. **Content check before writing the trading name.** `tax_business_name` is
   checked by the classifier before save today
   (`Store/src/lib/settings/actions.ts:517-520`). The check moves to the
   `seller_trade_profiles.trading_name` write; the mirror then copies it.
8. **Contact proofs stay on `profiles`.** The code machinery binds a code to
   `profiles.seller_email` / `seller_phone`
   (`Store/supabase/migrations/20260926_contact_verification.sql:94`, `:162`,
   `:250-251`), which the mirror keeps equal to the PUBLIC email and phone. A
   primary email or phone that differs from the public one needs new channels
   (`contact_verifications_channel` allows only `email`, `phone`, `:94`):
   stage 2. Until then the form keeps public = primary for email and phone,
   and every redeem is ALSO logged in `seller_verifications` (method `code`).
9. **Country of establishment.** Store whatever country the seller declares
   (the universal form; P1a 4.4 agrees). The gate blocks a non-market country.
   The mirror copies the primary country into `profiles.tax_country` only when
   it is a market country, because P1b guard (a) refuses anything else there
   (section 8.2). `establishmentCountryOf` (P1a 4.1) switches to
   `seller_addresses` (kind `primary`) in the same release as file 06.
10. **Agent JWTs see none of it.** Owner policies exclude any JWT carrying
    `agent_grant_id` (`Store/src/lib/agent/mint.ts:65-80`), except the status
    row (codes only, no personal data), so `get_store` can keep listing missing
    fields. No MCP tool may read the other tables through the service role
    either (registry test, section 3.3).
11. **P1b deviations I recommend** (flagged, not silently made): keep guard (a)
    but mirror only market countries into `tax_country`; turn P1b class
    `r1_seller_country` non-alerting (an outside-market seller with drafts is
    legitimate under the universal form; `r1_live_seller_blocked` keeps
    alerting); file 04 restates P1b's monitor bodies with the 1B classes added.
12. **Config tables use P1b's `market_` family** (`market_countries`,
    `market_threshold_rules`, `market_fx_rates`) and the public reference list
    uses `sanctions_list_*`: they hold no seller data. Every table holding
    seller data has the `seller_` prefix as agreed.
13. **`orders.paid_at`** is stamped by a trigger, not by redefining
    `order_confirm_paid` or `order_place` (section 4.5).

---

## 1. The data model

### 1.1 Diagram

```
 CASCADE WORLD (dies with the account)          RETAINED WORLD (no FK to auth.users)
 ------------------------------------          --------------------------------------------------
 auth.users                                     seller_records  (anchor: clocks, end, stripe id)
   profiles  <-- legacy mirror (file 06) ----+     |-- seller_identities --ptr--+
     tax_business_name, seller_address,      |     |-- seller_addresses (primary|public|returns)
     tax_country, tax_vat_id, seller_email,  |     |-- seller_contacts
     seller_phone, legal_accepted_*          |     |-- seller_trade_profiles
   seller_payment_accounts                   |     |-- seller_tax_ids --------ptr--+--> seller_vault.sealed_values
   orders (+ paid_at) -- freeze at end -----+|     |-- seller_vat_ids                    (envelopes; schema not
   order_add_ons, order_line_refunds        ||     |-- seller_registrations              exposed; RPC only)
                                            ||     |-- seller_payout_accounts --ptr--+
                                            ||     |-- seller_declarations      (append-only)
                                            ||     |-- seller_verifications     (append-only)
                                            ||     |-- seller_field_changes     (append-only, trigger-written)
                                            ||     |-- seller_location_evidence (append-only)
                                            ||     |-- seller_sanctions_screens -- seller_sanctions_reviews (append-only)
                                            ||     |-- seller_onboarding_status  <-- read by seller_sell_block()
                                            |+---->|-- seller_period_totals, seller_order_extracts (frozen)
                                            |      |-- seller_dac7_requests -- seller_dac7_events (stage 2)
                                            |      |-- seller_threshold_snapshots (stage 2)
                                            |
                                            +-- mirror reads from the retained world, writes profiles
 No FK at all (outlive everything): seller_data_access_log, seller_reregistration_blocks, seller_retention_purges
 Reference/config: seller_retention_rules, market_countries, market_threshold_rules, market_fx_rates,
                   sanctions_list_versions -- sanctions_list_entries -- sanctions_list_names
```

### 1.2 Conventions for every `seller_*` table

* `seller_id uuid not null references public.seller_records (seller_id) on
  delete cascade`. The cascade is from the ANCHOR, which only the retention
  purge can delete (section 4.8). Never a reference to `auth.users` or
  `profiles`.
* Mutable tables carry `created_at`, `updated_at`, `updated_by uuid`,
  `updated_via text` (`seller`, `staff`, `system`, `backfill`), an AFTER
  trigger `seller_capture_change()` (history) and, from file 06, the AFTER
  trigger `seller_legacy_mirror()` where a legacy column exists.
* Append-only tables: `revoke update, delete, truncate` from every API role,
  BEFORE UPDATE OR DELETE and BEFORE TRUNCATE triggers calling
  `seller_append_only_guard()`, which binds every role including the service
  role and the owner, except the purge (section 1.4).
* RLS on everywhere. Owner-readable tables get a SELECT policy plus the
  restrictive "Require two-factor when enrolled" policy; service-role-only
  tables get no policy and an entry in `POLICY_FREE_BY_DESIGN`
  (`Store/tests/integration/19-rls-coverage.test.ts:28-139`). Explicit
  `revoke all ... from public, anon, authenticated, service_role` then the
  exact grants, on every table and function (the PostgREST auto-grant trap,
  `Store/tests/db/shim.sql:189-193` copies the default privileges).
* Every text column bounded by a CHECK, every array bounded and
  shape-checked, every jsonb object-typed and size-capped.
* Every SECURITY DEFINER function: `set search_path = ''`, revoked from
  `public, anon, authenticated` (so the definer-function pin test,
  `Store/tests/integration/22-two-factor-rls.test.ts:357-386`, is unchanged).

### 1.3 Where each specification field lands

| Specification field | Table.column | Sealed | Shown to buyers | Retention class |
|---|---|---|---|---|
| seller_type | `seller_identities.seller_type` | no | no | dac7 |
| trader_status | `seller_identities.trader_status` (+ declaration `trader_status`) | no | yes | dac7 |
| legal first + last name | `seller_identities.legal_first_name`, `legal_last_name` | no | yes, traders | dac7 |
| legal company name | `seller_identities.legal_company_name` | no | yes | dac7 |
| trading / shop name | `seller_trade_profiles.trading_name` (mirrored to `profiles.tax_business_name`) | no | yes | relationship |
| date of birth | `seller_vault.sealed_values` field `dob`, pointer `seller_identities.dob_sealed_id` | YES | no | dac7 |
| place of birth (only if no TIN) | vault field `birth_place` (JSON `{city, country}`), pointer `birth_place_sealed_id` | YES | no | dac7 |
| representative name + role | `seller_identities.representative_name`, `representative_role` | no | no | dac7 (lawyer) |
| primary / registered address | `seller_addresses` kind `primary` | no | via public | dac7 |
| tax residence countries[] | `seller_identities.tax_residence_countries` | no | no | dac7 |
| email (verified) | `seller_contacts.primary_email` (+ `seller_verifications` method `code`) | no | via public | dsa |
| phone E.164 | `seller_contacts.primary_phone` | no | via public | dsa |
| public contact {address, email, phone} | `seller_addresses` kind `public` (`follows = 'primary'` by default), `seller_contacts.public_email` / `public_phone` (null = same as primary) | no | yes | dsa |
| returns / complaints address | `seller_addresses` kind `returns` | no | yes, at checkout | relationship |
| tax_ids[] {number, issuing country, type} | `seller_tax_ids` (number sealed in the vault; `not_issued` rows for a country that issues none) | YES (number) | no | dac7 |
| VAT ID + VIES date and consultation number | `seller_vat_ids` + `seller_verifications` method `vies` (`reference` = consultation number) | no (see 2.8) | yes (the shown one) | dac7 |
| business registration {register, number, country} + ARES | `seller_registrations` + `seller_verifications` method `ares` | no | yes | dac7 |
| EU permanent establishments[] | `seller_identities.eu_permanent_establishments` | no | no | dac7 |
| stripe_account_id | live: `seller_payment_accounts` (cascade, unchanged); retained copy `seller_records.stripe_account_id` and on each frozen total | no | no | dac7 |
| payout identifier + holder if different | `seller_payout_accounts` (identifier and holder sealed; `display_hint` = last 4) | YES | no | dac7 |
| seller terms acceptance | `seller_declarations` kind `seller_terms` (mirrored to `profiles.legal_accepted_*`) | no | no | evidence |
| DSA self-certification | `seller_declarations` kind `dsa_self_certification` | no | yes | evidence |
| privacy acknowledgement incl. tax reporting | `seller_declarations` kind `privacy_acknowledgement` | no | no | evidence |
| product categories[] + website URL | `seller_trade_profiles.product_categories`, `website_url` | no | no (website: owner choice) | relationship |
| product-safety role + default EU responsible person | `seller_trade_profiles.product_safety_role`, `eu_rp_name`, `eu_rp_address`, `eu_rp_email` (+ declaration `product_safety_role`) | no | via products | relationship |
| verification log | `seller_verifications` | no | no | dac7 |
| sanctions screening | `seller_sanctions_screens`, `seller_sanctions_reviews` | no | no | evidence |
| signup IP country, billing country | `seller_location_evidence` | no | no | evidence |
| field change history | `seller_field_changes` | sealed values never (vault ids only) | no | the class of the changed field |
| DAC7 request + reminders | `seller_dac7_requests`, `seller_dac7_events` (stage 2) | no | no | dac7 |
| completion status | `seller_onboarding_status` | no | no | operational |
| re-registration block | `seller_reregistration_blocks` (fingerprints only) | n/a | no | blocklist |
| threshold counters | `market_threshold_rules`, `seller_threshold_snapshots` (stage 2) | no | no | dac7 (the DAC7 one) |
| product-level GPSR | `products.details.safety` (existing jsonb, extended keys; section 1.8) | no | yes | with the product |

### 1.4 File 01, foundation (anchor, retention rules, guards, history)

```sql
-- =============================================================================
-- 1B FOUNDATION. The seller record anchor, the retention rules mirror, the
-- append-only guard and the field change history. (The vault and the access
-- log are in this file too: section 2.7 and 3.4.)
--
-- RETAINED WORLD. Nothing here references auth.users or profiles, so deleting
-- an account cascades none of it. Only seller_retention_purge() deletes, and
-- only rows whose clock has run out.
--
-- Needs the owner's approval before it is applied to production.
-- =============================================================================

create table if not exists public.seller_records (
  seller_id               uuid primary key,  -- the auth user id while the account lives; NO foreign key on purpose
  created_at              timestamptz not null default now(),
  relationship_started_at timestamptz,       -- first seller-terms acceptance or first content (set once)
  relationship_ended_at   timestamptz,       -- set once, by seller_relationship_end()
  end_reason              text,
  account_deleted_at      timestamptz,
  last_sale_year          smallint,          -- reporting year of the last paid sale, stamped at the end
  stripe_account_id       text,              -- copied so it outlives seller_payment_accounts
  legal_hold_until        timestamptz,       -- an authority request or a claim: the purge skips the seller
  legal_hold_reason       text,
  updated_at              timestamptz not null default now(),
  constraint seller_records_end_reason check (
    end_reason is null or end_reason in ('account_deleted', 'terminated', 'dac7_closure')),
  constraint seller_records_end_pair check ((relationship_ended_at is null) = (end_reason is null)),
  constraint seller_records_stripe_shape check (
    stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]{6,250}$'),
  constraint seller_records_sale_year check (last_sale_year is null or last_sale_year between 2020 and 2200),
  constraint seller_records_hold check (
    (legal_hold_until is null) = (legal_hold_reason is null)
    and (legal_hold_reason is null or char_length(legal_hold_reason) between 3 and 300))
);

comment on table public.seller_records is
  'One row per seller: the anchor every seller_* table hangs off, and the clocks of retention. No foreign key to auth.users: deleting an account does not delete it; seller_retention_purge() does, when every class has run out. Service role only.';

-- Set-once columns, and no deletion outside the purge.
create or replace function public.seller_records_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('seller.retention_purge', true), '') = 'on'
       and current_user not in ('anon', 'authenticated', 'service_role', 'authenticator') then
      return old;
    end if;
    raise exception 'seller_records:delete' using errcode = '42501';
  end if;
  if new.seller_id is distinct from old.seller_id then
    raise exception 'seller_records:seller_id' using errcode = '42501';
  end if;
  if old.relationship_started_at is not null
     and new.relationship_started_at is distinct from old.relationship_started_at then
    raise exception 'seller_records:relationship_started_at' using errcode = '42501';
  end if;
  if old.relationship_ended_at is not null
     and (new.relationship_ended_at is distinct from old.relationship_ended_at
          or new.end_reason is distinct from old.end_reason
          or new.last_sale_year is distinct from old.last_sale_year) then
    raise exception 'seller_records:ended' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function public.seller_records_guard() from public, anon, authenticated, service_role;

drop trigger if exists seller_records_guard_update on public.seller_records;
create trigger seller_records_guard_update
  before update on public.seller_records
  for each row execute function public.seller_records_guard();
drop trigger if exists seller_records_guard_delete on public.seller_records;
create trigger seller_records_guard_delete
  before delete on public.seller_records
  for each row execute function public.seller_records_guard();

alter table public.seller_records enable row level security;
revoke all on table public.seller_records from public, anon, authenticated, service_role;
grant select, insert, update on table public.seller_records to service_role;

-- ---- Retention rules (mirror of src/lib/seller-data/retention.ts) -------------------
-- CANONICAL FORM: every migration that changes a period contains exactly one
-- statement of the form below, all rows, in this order. The unit drift test
-- reads the LAST one in the replica. Values are the lawyer's and the tax
-- adviser's (section 4.11); the defaults below follow the specification.
create table if not exists public.seller_retention_rules (
  class       text primary key,
  basis       text not null,
  keep_months integer not null,
  year_tz     text,
  updated_at  timestamptz not null default now(),
  constraint seller_retention_rules_class check (class in
    ('dac7', 'dac7_no_sales', 'dsa', 'relationship', 'evidence', 'operational', 'blocklist', 'access_log')),
  constraint seller_retention_rules_basis check (basis in ('reporting_year_end', 'relationship_end', 'row_created')),
  constraint seller_retention_rules_months check (keep_months between 0 and 240),
  constraint seller_retention_rules_tz check (year_tz is null or char_length(year_tz) between 3 and 64)
);

insert into public.seller_retention_rules as r (class, basis, keep_months, year_tz)
values
  ('dac7',          'reporting_year_end', 120, 'Europe/Prague'),
  ('dac7_no_sales', 'relationship_end',     6, null),
  ('dsa',           'relationship_end',     6, null),
  ('relationship',  'relationship_end',     6, null),
  ('evidence',      'relationship_end',    36, null),
  ('operational',   'relationship_end',     0, null),
  ('blocklist',     'row_created',        120, null),
  ('access_log',    'row_created',         36, null)
on conflict (class) do update
   set basis = excluded.basis, keep_months = excluded.keep_months,
       year_tz = excluded.year_tz, updated_at = now();

alter table public.seller_retention_rules enable row level security;
revoke all on table public.seller_retention_rules from public, anon, authenticated, service_role;
grant select on table public.seller_retention_rules to service_role;

-- ---- The append-only guard ----------------------------------------------------------
-- Binds EVERY role: anon, authenticated, the service role, and the owner
-- outside the purge. The single way out is seller_retention_purge(), an
-- owner-run SECURITY DEFINER function that sets seller.retention_purge for its
-- transaction and deletes only rows past their deadline. A client or the
-- service role can set the setting too, but its current_user is an API role,
-- so the guard still refuses it. SECURITY INVOKER on purpose: as a definer it
-- would always see its owner.
create or replace function public.seller_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and coalesce(current_setting('seller.retention_purge', true), '') = 'on'
     and current_user not in ('anon', 'authenticated', 'service_role', 'authenticator') then
    return old;
  end if;
  raise exception 'append_only:%', tg_table_name using errcode = '42501';
end
$$;
revoke execute on function public.seller_append_only_guard() from public, anon, authenticated, service_role;

-- ---- Supersede-only rows (tax IDs, VAT IDs, registrations, payout) -----------------
-- tg_argv[0]: columns that may change; tg_argv[1]: columns that may be set
-- once from null. Everything else is the VALUE and is immutable: a change is a
-- new row. Deletion only by the purge.
create or replace function public.seller_value_row_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable text[] := string_to_array(tg_argv[0], ',');
  v_once    text[] := string_to_array(coalesce(tg_argv[1], ''), ',');
  v_old     jsonb;
  v_new     jsonb;
  v_key     text;
  v_purge   boolean := coalesce(current_setting('seller.retention_purge', true), '') = 'on'
                       and current_user not in ('anon', 'authenticated', 'service_role', 'authenticator');
begin
  if v_purge then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'seller_value_row:delete:%', tg_table_name using errcode = '42501';
  end if;
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  for v_key in select k from jsonb_object_keys(v_new) as k loop
    continue when (v_old -> v_key) is not distinct from (v_new -> v_key);
    continue when v_key = any (v_mutable);
    continue when v_key = any (v_once) and (v_old -> v_key) = 'null'::jsonb;
    raise exception 'seller_value_row:immutable:%.%', tg_table_name, v_key using errcode = '42501';
  end loop;
  return new;
end
$$;
revoke execute on function public.seller_value_row_guard() from public, anon, authenticated, service_role;

-- ---- Field change history -----------------------------------------------------------
-- Written ONLY by the trigger below, never by the application, so no write can
-- skip it. Sealed values never appear: a sealed field is a pointer column
-- (*_sealed_id), so old and new are vault row ids (section 6.3).
create table if not exists public.seller_field_changes (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references public.seller_records (seller_id) on delete cascade,
  changed_at      timestamptz not null default now(),
  table_name      text not null,
  row_ref         text not null,
  field           text not null,
  change_kind     text not null,
  value_kind      text not null,
  old_value       text,
  new_value       text,
  actor_id        uuid,
  actor_kind      text not null,
  db_role         text not null default current_user,
  retention_class text not null,
  constraint seller_field_changes_table check (table_name ~ '^seller_[a-z_]{2,40}$'),
  constraint seller_field_changes_ref check (char_length(row_ref) between 1 and 100),
  constraint seller_field_changes_field check (field ~ '^[a-z0-9_]{1,64}$'),
  constraint seller_field_changes_kind check (change_kind in ('insert', 'update', 'delete')),
  constraint seller_field_changes_value_kind check (value_kind in ('clear', 'sealed_ref', 'fingerprint', 'hint')),
  constraint seller_field_changes_values check (
    (old_value is null or char_length(old_value) <= 2000) and (new_value is null or char_length(new_value) <= 2000)),
  constraint seller_field_changes_actor check (actor_kind in ('seller', 'staff', 'system', 'backfill', 'unknown')),
  constraint seller_field_changes_class check (retention_class in ('dac7', 'dsa', 'relationship', 'evidence'))
);
create index if not exists seller_field_changes_seller_idx
  on public.seller_field_changes (seller_id, changed_at desc);

create or replace function public.seller_capture_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old   jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new   jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_row   jsonb;
  v_class text := tg_argv[0];
  v_key   text;
  v_kind  text;
begin
  -- A retention purge leaves no history of what it removed (the purge log does).
  if coalesce(current_setting('seller.retention_purge', true), '') = 'on' then
    return null;
  end if;
  v_row := case when tg_op = 'DELETE' then v_old else v_new end;
  if tg_table_name = 'seller_addresses' then
    v_class := case v_row ->> 'kind' when 'primary' then 'dac7' when 'public' then 'dsa' else 'relationship' end;
  end if;
  for v_key in
    select k from jsonb_object_keys(v_old || v_new) as k
     where k not in ('seller_id', 'id', 'created_at', 'updated_at', 'updated_by', 'updated_via')
       -- an absent key and a JSON null are the same "no value": no row for null to null
       and coalesce(v_old -> k, 'null'::jsonb) is distinct from coalesce(v_new -> k, 'null'::jsonb)
  loop
    v_kind := case
      when v_key like '%\_sealed\_id' then 'sealed_ref'
      when v_key = 'fingerprint' or v_key = 'fingerprint_key_id' then 'fingerprint'
      when v_key = 'display_hint' then 'hint'
      else 'clear' end;
    insert into public.seller_field_changes
      (seller_id, table_name, row_ref, field, change_kind, value_kind,
       old_value, new_value, actor_id, actor_kind, retention_class)
    values
      ((v_row ->> 'seller_id')::uuid, tg_table_name,
       coalesce(v_row ->> 'id', (v_row ->> 'seller_id') || coalesce(':' || (v_row ->> 'kind'), '')),
       v_key, lower(tg_op), v_kind,
       left(v_old ->> v_key, 2000), left(v_new ->> v_key, 2000),
       nullif(v_row ->> 'updated_by', '')::uuid,
       coalesce(v_row ->> 'updated_via', 'unknown'),
       v_class);
  end loop;
  return null;
end
$$;
revoke execute on function public.seller_capture_change() from public, anon, authenticated, service_role;

alter table public.seller_field_changes enable row level security;
revoke all on table public.seller_field_changes from public, anon, authenticated, service_role;
grant select on table public.seller_field_changes to authenticated;          -- owner policy (section 3.1)
grant select, insert on table public.seller_field_changes to service_role;
drop trigger if exists seller_field_changes_append_only on public.seller_field_changes;
create trigger seller_field_changes_append_only
  before update or delete on public.seller_field_changes
  for each row execute function public.seller_append_only_guard();
drop trigger if exists seller_field_changes_no_truncate on public.seller_field_changes;
create trigger seller_field_changes_no_truncate
  before truncate on public.seller_field_changes
  for each statement execute function public.seller_append_only_guard();
```

Why `seller_capture_change` is INVOKER: its writers are the service role
(granted INSERT) and owner-run definers (the vault RPC, the mirror, the
purge). `actor_kind` comes from the row's own `updated_via` (interface note 2).

### 1.5 File 02, the profile tables

The vault table (section 2.7) is created in file 01 before these, because the
pointer columns reference it.

```sql
-- =============================================================================
-- 1B PROFILE: the seller's current values. Service role writes; the owner
-- reads through RLS. Sealed values are pointers into seller_vault.
-- Needs the owner's approval before it is applied to production.
-- =============================================================================

create table if not exists public.seller_identities (
  seller_id                   uuid primary key references public.seller_records (seller_id) on delete cascade,
  seller_type                 text,
  trader_status               text,
  legal_first_name            text,
  legal_last_name             text,
  legal_company_name          text,
  company_legal_form          text,   -- register's code (e.g. ARES pravniForma), optional
  representative_name         text,
  representative_role         text,
  dob_sealed_id               uuid references seller_vault.sealed_values (id) on delete set null,
  birth_place_sealed_id       uuid references seller_vault.sealed_values (id) on delete set null,
  tax_residence_countries     text[] not null default '{}',
  eu_permanent_establishments text[] not null default '{}',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid,
  updated_via                 text not null default 'system',
  constraint seller_identities_type check (seller_type is null or seller_type in ('individual', 'company')),
  constraint seller_identities_trader check (trader_status is null or trader_status in ('trader', 'private')),
  -- The specification: a company is always a trader.
  constraint seller_identities_company_trader check (
    seller_type is distinct from 'company' or trader_status is distinct from 'private'),
  constraint seller_identities_names check (
    (legal_first_name is null or char_length(legal_first_name) between 1 and 100)
    and (legal_last_name is null or char_length(legal_last_name) between 1 and 100)
    and (legal_company_name is null or char_length(legal_company_name) between 1 and 200)
    and (company_legal_form is null or company_legal_form ~ '^[A-Za-z0-9_.-]{1,20}$')
    and (representative_name is null or char_length(representative_name) between 1 and 200)
    and (representative_role is null or char_length(representative_role) between 1 and 100)),
  constraint seller_identities_residence check (
    cardinality(tax_residence_countries) <= 10
    and array_position(tax_residence_countries, null) is null
    and array_to_string(tax_residence_countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  constraint seller_identities_pe check (
    cardinality(eu_permanent_establishments) <= 30
    and array_position(eu_permanent_establishments, null) is null
    and array_to_string(eu_permanent_establishments, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  constraint seller_identities_via check (updated_via in ('seller', 'staff', 'system', 'backfill'))
);

create table if not exists public.seller_addresses (
  seller_id    uuid not null references public.seller_records (seller_id) on delete cascade,
  kind         text not null,
  follows      text,          -- 'primary': this address IS the primary one (the default for public and returns)
  recipient    text,          -- returns: the name on the parcel
  line1        text,
  line2        text,
  city         text,
  region       text,
  postal_code  text,
  country      text,
  legacy_text  text,          -- backfill: the old free-text address, one unconfirmed line
  source       text not null default 'form',
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  updated_via  text not null default 'system',
  primary key (seller_id, kind),
  constraint seller_addresses_kind check (kind in ('primary', 'public', 'returns')),
  constraint seller_addresses_follows check (follows is null or (follows = 'primary' and kind <> 'primary')),
  constraint seller_addresses_follows_empty check (
    follows is null
    or (recipient is null and line1 is null and line2 is null and city is null and region is null
        and postal_code is null and country is null and legacy_text is null)),
  constraint seller_addresses_lengths check (
    (recipient is null or char_length(recipient) between 1 and 200)
    and (line1 is null or char_length(line1) between 1 and 200)
    and (line2 is null or char_length(line2) between 1 and 200)
    and (city is null or char_length(city) between 1 and 100)
    and (region is null or char_length(region) between 1 and 100)
    and (postal_code is null or postal_code ~ '^[A-Za-z0-9 -]{1,20}$')
    and (country is null or country ~ '^[A-Z]{2}$')
    and (legacy_text is null or char_length(legacy_text) between 1 and 300)),
  constraint seller_addresses_source check (source in ('form', 'backfill', 'staff')),
  constraint seller_addresses_via check (updated_via in ('seller', 'staff', 'system', 'backfill'))
);
-- No completeness CHECK on purpose: what is "complete" is the application's
-- field rule (interface 4). The table only refuses malformed values.

create table if not exists public.seller_contacts (
  seller_id     uuid primary key references public.seller_records (seller_id) on delete cascade,
  primary_email text,
  primary_phone text,
  public_email  text,   -- null: the public email is the primary one
  public_phone  text,   -- null: the public phone is the primary one
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  updated_via   text not null default 'system',
  -- Same shape as profiles_seller_email_shape (20260905_seller_identity_on_profile.sql:44-48).
  constraint seller_contacts_emails check (
    (primary_email is null or (char_length(primary_email) <= 254
       and primary_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
    and (public_email is null or (char_length(public_email) <= 254
       and public_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))),
  constraint seller_contacts_phones check (
    (primary_phone is null or primary_phone ~ '^\+[1-9][0-9]{6,14}$')
    and (public_phone is null or public_phone ~ '^\+[1-9][0-9]{6,14}$')),
  constraint seller_contacts_via check (updated_via in ('seller', 'staff', 'system', 'backfill'))
);

create table if not exists public.seller_trade_profiles (
  seller_id           uuid primary key references public.seller_records (seller_id) on delete cascade,
  trading_name        text,
  website_url         text,
  product_categories  text[] not null default '{}',
  product_safety_role text,
  eu_rp_name          text,    -- default EU responsible person, copied into each product's safety block
  eu_rp_address       text,
  eu_rp_email         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_via         text not null default 'system',
  constraint seller_trade_profiles_name check (trading_name is null or char_length(trading_name) between 1 and 200),
  constraint seller_trade_profiles_website check (
    website_url is null or (char_length(website_url) <= 2048 and website_url ~ '^https?://[^[:space:]]+$')),
  constraint seller_trade_profiles_categories check (
    cardinality(product_categories) <= 20
    and array_position(product_categories, null) is null
    and array_to_string(product_categories, ',') ~ '^([a-z0-9_]{2,40}(,[a-z0-9_]{2,40})*)?$'),
  constraint seller_trade_profiles_role check (
    product_safety_role is null
    or product_safety_role in ('manufacturer', 'importer', 'distributor', 'not_applicable')),
  -- Limits of the product block's responsible* fields (Store/src/lib/validation/product.ts:408-416).
  constraint seller_trade_profiles_rp check (
    (eu_rp_name is null or char_length(eu_rp_name) between 1 and 120)
    and (eu_rp_address is null or char_length(eu_rp_address) between 1 and 300)
    and (eu_rp_email is null or (char_length(eu_rp_email) <= 254
         and eu_rp_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))),
  constraint seller_trade_profiles_via check (updated_via in ('seller', 'staff', 'system', 'backfill'))
);

create table if not exists public.seller_tax_ids (
  id                 uuid primary key default gen_random_uuid(),
  seller_id          uuid not null references public.seller_records (seller_id) on delete cascade,
  issuing_country    text not null,
  id_type            text not null,       -- validator vocabulary, e.g. cz_rodne_cislo, cz_dic (list in the app only)
  not_issued         boolean not null default false,  -- the country issues no TIN to this seller
  value_sealed_id    uuid references seller_vault.sealed_values (id) on delete set null,
  fingerprint        text,
  fingerprint_key_id text,
  display_hint       text,
  valid_from         timestamptz not null default now(),
  superseded_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  updated_via        text not null default 'system',
  constraint seller_tax_ids_country check (issuing_country ~ '^[A-Z]{2}$'),
  constraint seller_tax_ids_type check (id_type ~ '^[a-z0-9_]{2,40}$'),
  constraint seller_tax_ids_value check (
    (not_issued and value_sealed_id is null and fingerprint is null and display_hint is null)
    or (not not_issued and fingerprint is not null and display_hint is not null)),
  constraint seller_tax_ids_fp check (
    (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$')
    and ((fingerprint is null) = (fingerprint_key_id is null))
    and (fingerprint_key_id is null or fingerprint_key_id ~ '^[a-z0-9]{1,16}$')),
  constraint seller_tax_ids_hint check (display_hint is null or char_length(display_hint) between 2 and 4),
  constraint seller_tax_ids_via check (updated_via in ('seller', 'staff', 'system', 'backfill'))
);
create unique index if not exists seller_tax_ids_current_uq
  on public.seller_tax_ids (seller_id, issuing_country, id_type) where superseded_at is null;
create index if not exists seller_tax_ids_fingerprint_idx
  on public.seller_tax_ids (fingerprint) where superseded_at is null and fingerprint is not null;

create table if not exists public.seller_vat_ids (
  id                 uuid primary key default gen_random_uuid(),
  seller_id          uuid not null references public.seller_records (seller_id) on delete cascade,
  country            text not null,   -- VIES member-state code (EL for Greece)
  number             text not null,   -- normalised, without the prefix
  shown_to_buyers    boolean not null default false,
  fingerprint        text,            -- null only for backfilled rows until the app computes it
  fingerprint_key_id text,
  valid_from         timestamptz not null default now(),
  superseded_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  updated_via        text not null default 'system',
  constraint seller_vat_ids_country check (country ~ '^[A-Z]{2}$'),
  constraint seller_vat_ids_number check (number ~ '^[A-Z0-9]{2,14}$'),
  constraint seller_vat_ids_fp check (
    (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$')
    and ((fingerprint is null) = (fingerprint_key_id is null))),
  constraint seller_vat_ids_via check (updated_via in ('seller', 'staff', 'system', 'backfill'))
);
create unique index if not exists seller_vat_ids_current_uq
  on public.seller_vat_ids (seller_id, country) where superseded_at is null;
create unique index if not exists seller_vat_ids_shown_uq
  on public.seller_vat_ids (seller_id) where shown_to_buyers and superseded_at is null;

create table if not exists public.seller_registrations (
  id                 uuid primary key default gen_random_uuid(),
  seller_id          uuid not null references public.seller_records (seller_id) on delete cascade,
  register_country   text not null,
  register_code      text not null,   -- app vocabulary, e.g. cz_ares
  register_name      text not null,   -- as shown to buyers, e.g. the court register and file
  number             text not null,   -- e.g. the ICO (8 digits)
  fingerprint        text,
  fingerprint_key_id text,
  valid_from         timestamptz not null default now(),
  superseded_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  updated_via        text not null default 'system',
  constraint seller_registrations_country check (register_country ~ '^[A-Z]{2}$'),
  constraint seller_registrations_code check (register_code ~ '^[a-z0-9_]{2,40}$'),
  constraint seller_registrations_name check (char_length(register_name) between 1 and 200),
  constraint seller_registrations_number check (number ~ '^[A-Za-z0-9 ./-]{1,40}$'),
  constraint seller_registrations_fp check (
    (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$')
    and ((fingerprint is null) = (fingerprint_key_id is null))),
  constraint seller_registrations_via check (updated_via in ('seller', 'staff', 'system', 'backfill'))
);
create unique index if not exists seller_registrations_current_uq
  on public.seller_registrations (seller_id, register_country, register_code) where superseded_at is null;

create table if not exists public.seller_payout_accounts (
  id                   uuid primary key default gen_random_uuid(),
  seller_id            uuid not null references public.seller_records (seller_id) on delete cascade,
  source               text not null,   -- 'stripe': read from the connected account; 'seller': typed in
  identifier_type      text not null,
  identifier_sealed_id uuid references seller_vault.sealed_values (id) on delete set null,
  display_hint         text not null,   -- last 4
  holder_differs       boolean not null default false,
  holder_sealed_id     uuid references seller_vault.sealed_values (id) on delete set null,
  fingerprint          text,
  fingerprint_key_id   text,
  stripe_account_id    text,
  observed_at          timestamptz not null default now(),
  superseded_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  updated_via          text not null default 'system',
  constraint seller_payout_source check (source in ('stripe', 'seller')),
  constraint seller_payout_type check (identifier_type in ('iban', 'last4', 'account_number')),
  constraint seller_payout_hint check (display_hint ~ '^[A-Za-z0-9]{2,4}$'),
  constraint seller_payout_holder check (holder_differs or holder_sealed_id is null),
  constraint seller_payout_fp check (
    (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$')
    and ((fingerprint is null) = (fingerprint_key_id is null))),
  constraint seller_payout_stripe check (
    stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]{6,250}$'),
  constraint seller_payout_via check (updated_via in ('seller', 'staff', 'system', 'backfill'))
);
create unique index if not exists seller_payout_current_uq
  on public.seller_payout_accounts (seller_id) where superseded_at is null;

-- History triggers (the argument is the table's retention class).
do $$
declare
  t record;
begin
  for t in select * from (values
      ('seller_identities', 'dac7'), ('seller_addresses', 'dac7'), ('seller_contacts', 'dsa'),
      ('seller_trade_profiles', 'relationship'), ('seller_tax_ids', 'dac7'), ('seller_vat_ids', 'dac7'),
      ('seller_registrations', 'dac7'), ('seller_payout_accounts', 'dac7')) as v(tbl, cls)
  loop
    execute format('drop trigger if exists %I on public.%I', t.tbl || '_history', t.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I '
                   'for each row execute function public.seller_capture_change(%L)',
                   t.tbl || '_history', t.tbl, t.cls);
  end loop;
end
$$;

-- Supersede-only guards (mutable columns, set-once columns).
drop trigger if exists seller_tax_ids_value_guard on public.seller_tax_ids;
create trigger seller_tax_ids_value_guard before update or delete on public.seller_tax_ids
  for each row execute function public.seller_value_row_guard(
    'fingerprint,fingerprint_key_id,updated_at,updated_by,updated_via', 'value_sealed_id,superseded_at');
drop trigger if exists seller_vat_ids_value_guard on public.seller_vat_ids;
create trigger seller_vat_ids_value_guard before update or delete on public.seller_vat_ids
  for each row execute function public.seller_value_row_guard(
    'shown_to_buyers,fingerprint,fingerprint_key_id,updated_at,updated_by,updated_via', 'superseded_at');
drop trigger if exists seller_registrations_value_guard on public.seller_registrations;
create trigger seller_registrations_value_guard before update or delete on public.seller_registrations
  for each row execute function public.seller_value_row_guard(
    'register_name,fingerprint,fingerprint_key_id,updated_at,updated_by,updated_via', 'superseded_at');
drop trigger if exists seller_payout_value_guard on public.seller_payout_accounts;
create trigger seller_payout_value_guard before update or delete on public.seller_payout_accounts
  for each row execute function public.seller_value_row_guard(
    'fingerprint,fingerprint_key_id,updated_at,updated_by,updated_via',
    'identifier_sealed_id,holder_sealed_id,superseded_at');
```

Grants and policies for these eight tables: section 3.1 (one loop).

### 1.6 File 03, evidence tables

```sql
-- =============================================================================
-- 1B EVIDENCE: declarations, the verification log, location evidence and the
-- sanctions screening record. Append-only for every role (the purge aside).
-- Needs the owner's approval before it is applied to production.
-- =============================================================================

create table if not exists public.seller_declarations (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null references public.seller_records (seller_id) on delete cascade,
  kind             text not null,
  document_version text not null,
  statement_value  text,             -- e.g. 'trader', 'importer'; null for a plain acceptance
  accepted_at      timestamptz not null default now(),
  accepted_by      uuid not null,    -- the signed-in user who clicked (auth user id)
  accepted_as      text not null default 'owner',
  ip_address       inet,
  ip_country       text,
  user_agent       text,
  surface          text not null,
  locale           text,
  evidence_quality text not null default 'captured',
  constraint seller_declarations_kind check (kind in (
    'seller_terms', 'dsa_self_certification', 'privacy_acknowledgement', 'trader_status',
    'product_safety_role', 'details_confirmation', 'representative_authority')),
  -- <= 32 because the mirror copies seller_terms into profiles.legal_accepted_version (Replica:264-265).
  constraint seller_declarations_version check (document_version ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  constraint seller_declarations_value check (statement_value is null or statement_value ~ '^[a-z0-9_]{1,40}$'),
  constraint seller_declarations_as check (accepted_as in ('owner', 'representative')),
  constraint seller_declarations_ip_country check (ip_country is null or ip_country ~ '^[A-Z][A-Z0-9]$'),
  constraint seller_declarations_ua check (user_agent is null or char_length(user_agent) <= 512),
  constraint seller_declarations_surface check (surface in (
    'welcome', 'settings', 'onboarding', 'reconfirm', 'payments', 'backfill')),
  constraint seller_declarations_locale check (locale is null or locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint seller_declarations_quality check (evidence_quality in ('captured', 'backfilled_from_profile'))
);
create index if not exists seller_declarations_seller_idx
  on public.seller_declarations (seller_id, kind, accepted_at desc);

-- The first seller-terms acceptance starts the seller relationship (the P2B contract).
create or replace function public.seller_declarations_start_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'seller_terms' then
    update public.seller_records r
       set relationship_started_at = new.accepted_at
     where r.seller_id = new.seller_id and r.relationship_started_at is null;
  end if;
  return null;
end
$$;
revoke execute on function public.seller_declarations_start_relationship() from public, anon, authenticated, service_role;
drop trigger if exists seller_declarations_start on public.seller_declarations;
create trigger seller_declarations_start after insert on public.seller_declarations
  for each row execute function public.seller_declarations_start_relationship();

create table if not exists public.seller_verifications (
  id                  uuid primary key default gen_random_uuid(),
  seller_id           uuid not null references public.seller_records (seller_id) on delete cascade,
  subject             text not null,   -- app vocabulary: legal_name, company_name, tax_id, vat_id, registration, primary_email, ...
  subject_ref         uuid,            -- the row verified (seller_tax_ids.id, seller_vat_ids.id, seller_registrations.id)
  subject_fingerprint text,            -- HMAC of the value verified: a later value with another fingerprint is NOT verified
  method              text not null,
  result              text not null,
  reference           text,            -- per method, section 6.1
  evidence            jsonb not null default '{}'::jsonb,
  checked_at          timestamptz not null default now(),
  expires_at          timestamptz,     -- checked_at + 36 months (the app's REVERIFY_MONTHS)
  performed_by        uuid,
  performed_by_kind   text not null default 'system',
  constraint seller_verifications_subject check (subject ~ '^[a-z0-9_]{2,40}$'),
  constraint seller_verifications_fp check (subject_fingerprint is null or subject_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint seller_verifications_method check (method in ('vies', 'ares', 'format', 'code', 'manual', 'stripe')),
  constraint seller_verifications_result check (result in
    ('pass', 'fail', 'unavailable', 'mismatch', 'needs_review', 'revoked')),
  constraint seller_verifications_reference check (reference is null or char_length(reference) <= 200),
  constraint seller_verifications_evidence check (
    jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 4096),
  constraint seller_verifications_expiry check (
    expires_at is null or (expires_at > checked_at and expires_at <= checked_at + interval '120 months')),
  constraint seller_verifications_by check (performed_by_kind in ('system', 'staff', 'seller', 'backfill'))
);
create index if not exists seller_verifications_seller_idx
  on public.seller_verifications (seller_id, subject, checked_at desc);

create table if not exists public.seller_location_evidence (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.seller_records (seller_id) on delete cascade,
  kind        text not null,
  country     text not null,
  observed_at timestamptz not null default now(),
  source      text not null,
  constraint seller_location_kind check (kind in (
    'signup_ip_country', 'onboarding_ip_country', 'billing_country', 'stripe_account_country')),
  -- Cloudflare's cf-ipcountry also sends XX (unknown) and T1 (Tor).
  constraint seller_location_country check (country ~ '^[A-Z][A-Z0-9]$'),
  constraint seller_location_source check (source in ('cf_ipcountry', 'stripe_checkout', 'stripe_account'))
);
create index if not exists seller_location_seller_idx on public.seller_location_evidence (seller_id, kind, observed_at desc);

create table if not exists public.seller_sanctions_screens (
  id                  uuid primary key default gen_random_uuid(),
  seller_id           uuid not null references public.seller_records (seller_id) on delete cascade,
  screened_at         timestamptz not null default now(),
  list_code           text not null,
  list_version_id     uuid,          -- sanctions_list_versions.id when automated; no FK (lists are pruned sooner)
  list_published_at   timestamptz,   -- the list's own date, as seen
  list_reference      text,          -- file sha256, or what a manual screen searched
  method              text not null,
  trigger_kind        text not null,
  subject_fingerprint text not null, -- HMAC of the normalised (names, birth date, country) tuple screened
  result              text not null,
  best_score          numeric(4, 3),
  candidates          jsonb not null default '[]'::jsonb,  -- list entry refs and scores; never seller data
  performed_by        uuid,          -- staff, for a manual screen
  note                text,
  constraint seller_screens_list check (list_code in ('eu_fsf', 'ofac_sdn', 'un_sc')),
  constraint seller_screens_ref check (list_reference is null or char_length(list_reference) <= 200),
  constraint seller_screens_method check (method in ('automated', 'manual')),
  constraint seller_screens_trigger check (trigger_kind in
    ('onboarding', 'details_changed', 'list_updated', 'periodic', 'staff')),
  constraint seller_screens_fp check (subject_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint seller_screens_result check (result in ('clear', 'potential_match', 'error')),
  constraint seller_screens_score check (best_score is null or best_score between 0 and 1),
  constraint seller_screens_candidates check (
    jsonb_typeof(candidates) = 'array' and pg_column_size(candidates) <= 8192),
  constraint seller_screens_manual check (method <> 'manual' or performed_by is not null),
  constraint seller_screens_note check (note is null or char_length(note) <= 500)
);
create index if not exists seller_screens_seller_idx on public.seller_sanctions_screens (seller_id, screened_at desc);

create table if not exists public.seller_sanctions_reviews (
  id                uuid primary key default gen_random_uuid(),
  screen_id         uuid not null references public.seller_sanctions_screens (id) on delete cascade,
  seller_id         uuid not null references public.seller_records (seller_id) on delete cascade,
  decided_at        timestamptz not null default now(),
  reviewer_id       uuid not null,
  decision          text not null,
  reason            text not null,
  matched_entry_ref text,
  constraint seller_reviews_decision check (decision in ('false_positive', 'confirmed_match', 'escalated')),
  constraint seller_reviews_reason check (char_length(reason) between 3 and 1000),
  constraint seller_reviews_entry check (matched_entry_ref is null or char_length(matched_entry_ref) <= 100)
);
create index if not exists seller_reviews_screen_idx on public.seller_sanctions_reviews (screen_id, decided_at desc);

-- Append-only, every one of them.
do $$
declare
  t text;
begin
  foreach t in array array['seller_declarations', 'seller_verifications', 'seller_location_evidence',
                           'seller_sanctions_screens', 'seller_sanctions_reviews'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I '
                   'for each row execute function public.seller_append_only_guard()', t || '_append_only', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I '
                   'for each statement execute function public.seller_append_only_guard()', t || '_no_truncate', t);
  end loop;
end
$$;
```

### 1.7 Table register

"Owner" = owner SELECT through RLS (+ two-factor restrictive policy, minus
agent JWTs). Every write is the service role unless noted.

| Table | RLS / client grant | Service-role grant | Writer | Readers | Retention class |
|---|---|---|---|---|---|
| `seller_records` | none (policy-free) | select, insert, update | app (anchor at sign-up / first touch), `seller_relationship_end`, purge | server, Admin (logged) | until every class is purged |
| `seller_retention_rules` | none | select | migrations only | purge, end function | config |
| `seller_identities` | owner select | all but truncate | onboarding server actions, vault RPC (pointers) | owner, server, Admin (logged) | dac7 |
| `seller_addresses` | owner select | all but truncate | same | owner, server, Admin; public kind on buyer pages via mirror | primary dac7, public dsa, returns relationship |
| `seller_contacts` | owner select | all but truncate | same | owner, server, Admin; public via mirror | dsa |
| `seller_trade_profiles` | owner select | all but truncate | same | owner, server, Admin | relationship |
| `seller_tax_ids` | owner select (hints only exist here) | select, insert, update (guarded) | same | owner, server, Admin | dac7 |
| `seller_vat_ids` | owner select | select, insert, update (guarded) | same | owner, server, Admin, buyers via mirror | dac7 |
| `seller_registrations` | owner select | select, insert, update (guarded) | same, ARES flow | owner, server, Admin, buyers (display) | dac7 |
| `seller_payout_accounts` | owner select | select, insert, update (guarded) | Stripe read job / form | owner, server, Admin | dac7 |
| `seller_vault.sealed_values` | schema invisible to every API role | none (RPC only) | `seller_sealed_put`, `seller_sealed_reseal` | `seller_sealed_get` (logs) | dac7 |
| `seller_declarations` | owner select | select, insert | `acceptLegal` and declaration actions | owner, server, Admin | evidence |
| `seller_verifications` | owner select | select, insert | verifiers (VIES, ARES, format, code redeem), staff | owner, server, Admin | dac7 |
| `seller_field_changes` | owner select | select, insert | trigger only | owner, Admin (logged) | class of the field |
| `seller_location_evidence` | none | select, insert | sign-up action, plan checkout webhook, Stripe sync | server, Admin (logged) | evidence |
| `seller_sanctions_screens` / `_reviews` | none | select, insert | screening job / staff | Admin (logged), server | evidence |
| `seller_data_access_log` | none | select, insert | Admin, Store reveal paths, vault RPC | staff (Admin), owner on request | access_log |
| `seller_onboarding_status` | owner select (agent JWT allowed) | all but truncate | app status writer, hard-stop triggers, migrations (grace) | `seller_sell_block`, owner, server, monitor | operational |
| `market_countries` | none | select | migrations only | `seller_sell_block`, monitor | config |
| `seller_period_totals` / `seller_order_extracts` | none | select, insert, update (frozen rows refused) | compute / freeze functions | DAC7 report job, Admin (logged) | dac7 |
| `seller_dac7_requests` / `_events` (stage 2) | owner select | select, insert (request state changes only through the event trigger; events append-only) | DAC7 job, staff | owner, server, Admin | dac7 |
| `seller_reregistration_blocks` (stage 2) | none | select, insert, update (lift only) | enforcement trigger, app | onboarding check (service role) | blocklist |
| `seller_retention_purges` (stage 2) | none | select | purge function only | Admin | kept |
| `sanctions_list_*` (stage 2) | none | select, insert (loading version only) | ingest job | matcher | superseded entries 30 days |
| `market_threshold_rules`, `market_fx_rates` (stage 2) | none | select (fx: insert) | migrations / FX job | counters | config |
| `seller_threshold_snapshots` (stage 2) | none | select, insert | counters job | Admin, server | dac7 for the DAC7 rule, else operational |

### 1.8 Product-level product-safety data (`products.details.safety`)

The existing optional block (`Store/supabase/migrations/20260902_product_page.sql:18-36`,
type `Store/src/types/product.ts:332-347`) is extended, not duplicated. New
keys, all inside the same 16 KB `details` object: `manufacturerCountry`
(ISO-2), `manufacturerWebsite`, `responsible*` (now defaulted by the app from
`seller_trade_profiles.eu_rp_*`, copied into the product, never linked: a
product must keep its own label if the default changes, and team editors may
not read the owner-only trade profile), `identifierType`
(`batch|serial|model|gtin|other`), `identifierImageKey` (an object key: the
existing key-ownership guard already walks every key-shaped string in the row,
`20261105_object_keys_anywhere.sql:52-128`), `warningsByLocale` (`{cs: "...",
en: "..."}`).

What the database guarantees: nothing new in stage 1 (the app validates the
whole block at publish and the content wall already sees `details`). Stage 2,
optional file 14: a presence-only guard, fired like P1b's products guard only
when a PHYSICAL product (`digital_file_key is null`) becomes active, refusing
`product_blocked:safety_missing` unless `details.safety` is an object with a
non-blank `manufacturerName`, `manufacturerAddress` and one of
`manufacturerEmail` / `manufacturerWebsite`. Rule details (EU responsible
person required when the manufacturer is outside the EU, warnings in the
buyer's language) stay in the application. The two live physical products
without the block are not touched: the guard fires on transitions only.
Monitor class `gpsr_live_physical_without_safety` (advisory) counts them.

---

## 2. Encryption

### 2.1 What is sealed, where, and by whom

Sealed by the APPLICATION, before the database sees them: tax ID numbers, date
of birth, place of birth, payout identifier (IBAN or account number; a
Stripe-reported last 4 is only a hint and is not sealed), payout holder name.
Stored in ONE table, `seller_vault.sealed_values`, in a schema PostgREST does
not expose and no API role has USAGE on. Public rows point at it
(`*_sealed_id`). Why one vault table instead of envelope columns on each
table: the application can never `select *` an envelope into a page, an MCP
output or a log by accident; the generated `public` types never contain one;
rotation and backup reasoning concern one table; and every API read goes
through one logging RPC.

### 2.2 Envelope format and associated data

```
envelope := "ss1" "." key_id "." base64url(nonce, 12 bytes = 16 chars) "." base64url(ciphertext || tag)
key_id   := [a-z0-9]{1,16}        e.g. "k2611a"
AAD      := "ss1|" field "|" seller_id "|" subject_id "|" sealed_id "|" key_id     (UTF-8, uuids lower-case)
plaintext:= UTF-8; dob "YYYY-MM-DD"; birth_place JSON {"city":..,"country":"CZ"};
            tax_id the normalised number (validator's normalise()); payout identifier normalised (IBAN without spaces)
```

* AES-256-GCM (WebCrypto, as `Store/src/lib/auth/passkey-crypto.ts:62-77`),
  96-bit random nonce per seal, 128-bit tag.
* The AAD binds a value to its seller, its field, the row it belongs to, its
  own vault id and the key id: an envelope copied to another seller, another
  field, another row or another vault row fails to open; a swapped key id
  fails too. The application generates `sealed_id` (`crypto.randomUUID()`)
  before sealing and passes it to `seller_sealed_put`.
* The database checks only the shape and that the key id inside the envelope
  equals the `key_id` column (CHECK in 2.7).

### 2.3 Keys and key ids

* New Worker secret `SELLER_FIELD_KEYRING` (never reuse `MFA_PASSKEY_KEY`,
  `Store/src/lib/auth/passkey-crypto.ts:17`, whose scope is passkeys):
  JSON `{"current":"k2611a","keys":{"k2611a":"<base64url 32 bytes>"}}`.
  Seal with `current`; open with the key named in the envelope. Missing or
  malformed keyring: every seal and open returns null and callers fail closed
  (the existing helper's discipline, `passkey-crypto.ts:36-54`).
* New Worker secret `SELLER_FINGERPRINT_KEYRING`, same JSON shape, separate
  keys, ids `f1`, `f2`, ...
* Neither key ever reaches the database, Supabase Vault, logs, the browser or
  Admin's Worker (2.10).

### 2.4 Rotation

1. Add the new key to the keyring, set `current` to it, deploy. New seals use
   it; old envelopes still open.
2. A cron route (stage 2) loops: `seller_sealed_rotation_batch(p_current_key,
   50)` returns envelopes under any other key (and logs one `rotate` row);
   the app opens each with its old key, re-seals with the new key and a
   rebuilt AAD (same field, seller, subject, sealed id; new key id), and calls
   `seller_sealed_reseal(id, old_key_id, new_envelope, new_key_id)`, a
   compare-and-swap on the old key id. Same vault id, so pointers and history
   are untouched.
3. Monitor class `ob_sealed_old_keys` (stage 2) shows the count per key id
   through `seller_vault_key_census()`; at zero, remove the old key from the
   secret.
4. Compromise: same steps, urgently; plus rotate the fingerprint key (2.5).

### 2.5 Fingerprints (keyed, for equality without decrypting)

```
fingerprint := hex(HMAC-SHA-256(fp_key[id], "ss-fp1|" kind "|" country "|" normalised_value))
kind        := tax_id | vat_id | registration | email | phone | payout | person (name + dob tuple, sanctions)
```

* Not bound to the seller on purpose: the same TIN on two accounts must give
  the same fingerprint (duplicate detection, the re-registration block).
* Bound to the kind and country, so the same digits as a phone and as a TIN do
  not collide.
* `fingerprint_key_id` is stored with each fingerprint. Rotating the
  fingerprint key means recomputing every fingerprint (open sealed values,
  normalise clear ones). Blocklist rows cannot be recomputed (their source is
  gone), so the application matches against fingerprints under EVERY key id
  still present in `seller_reregistration_blocks`; a fingerprint key is retired
  only when no blocklist row uses it.
* Low-entropy values (a birth number has a few hundred million possibilities)
  are brute-forceable ONLY with the fingerprint key, which is why it is a
  secret like the sealing key and lives in the same custody.

### 2.6 Display hints

Last 2 to 4 characters, chosen by the country validator (for a Czech birth
number the last 3 are enough to recognise it, and say nothing about the date
or sex encoded in its first 6). Never more than 4 (CHECK).

### 2.7 The vault and its RPCs (file 01)

```sql
-- =============================================================================
-- THE VAULT. Sealed values as the application sealed them (AES-256-GCM under
-- SELLER_FIELD_KEYRING, a Worker secret the database never sees). The schema is
-- not exposed by PostgREST and no API role has USAGE on it: the only way in is
-- the definer RPCs below, and the read RPC logs before it returns.
-- =============================================================================
create schema if not exists seller_vault;
revoke all on schema seller_vault from public;
revoke all on schema seller_vault from anon, authenticated, service_role;

create table if not exists seller_vault.sealed_values (
  id            uuid primary key,  -- chosen by the application BEFORE sealing: it is in the AAD
  seller_id     uuid not null references public.seller_records (seller_id) on delete cascade,
  field         text not null,
  subject_id    uuid not null,     -- the public row: seller_id for dob/birth_place, else the row id
  envelope      text not null,
  key_id        text not null,
  created_at    timestamptz not null default now(),
  resealed_at   timestamptz,
  superseded_at timestamptz,
  constraint sealed_values_field check (field in
    ('tax_id', 'dob', 'birth_place', 'payout_identifier', 'payout_holder')),
  constraint sealed_values_key check (key_id ~ '^[a-z0-9]{1,16}$'),
  constraint sealed_values_envelope check (
    char_length(envelope) between 40 and 2048
    and envelope ~ '^ss1\.[a-z0-9]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'
    and split_part(envelope, '.', 2) = key_id)
);
create index if not exists sealed_values_current_idx
  on seller_vault.sealed_values (seller_id, field, subject_id) where superseded_at is null;
create index if not exists sealed_values_key_idx on seller_vault.sealed_values (key_id);
alter table seller_vault.sealed_values enable row level security;
revoke all on table seller_vault.sealed_values from public, anon, authenticated, service_role;

-- Only the envelope may be re-keyed, and superseded once. Deleted only by the purge.
create or replace function seller_vault.sealed_values_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('seller.retention_purge', true), '') = 'on'
       and current_user not in ('anon', 'authenticated', 'service_role', 'authenticator') then
      return old;
    end if;
    raise exception 'sealed_values:delete' using errcode = '42501';
  end if;
  if new.id <> old.id or new.seller_id <> old.seller_id or new.field <> old.field
     or new.subject_id <> old.subject_id or new.created_at <> old.created_at
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'sealed_values:immutable' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function seller_vault.sealed_values_guard() from public, anon, authenticated, service_role;
drop trigger if exists sealed_values_guard on seller_vault.sealed_values;
create trigger sealed_values_guard before update or delete on seller_vault.sealed_values
  for each row execute function seller_vault.sealed_values_guard();

-- PUT: store, supersede the previous value, point the public row at it. One transaction.
create or replace function public.seller_sealed_put(
  p_id uuid, p_seller uuid, p_field text, p_subject uuid,
  p_envelope text, p_key_id text, p_actor_id uuid, p_actor_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_kind not in ('seller', 'staff', 'system') then
    raise exception 'seller_sealed_put:actor' using errcode = '22023';
  end if;
  if p_field in ('dob', 'birth_place') then
    if p_subject <> p_seller or not exists (select 1 from public.seller_identities i where i.seller_id = p_seller) then
      raise exception 'seller_sealed_put:subject' using errcode = '23503';
    end if;
  elsif p_field = 'tax_id' then
    if not exists (select 1 from public.seller_tax_ids t
                    where t.id = p_subject and t.seller_id = p_seller and t.superseded_at is null
                      and not t.not_issued and t.value_sealed_id is null) then
      raise exception 'seller_sealed_put:subject' using errcode = '23503';
    end if;
  elsif p_field in ('payout_identifier', 'payout_holder') then
    if not exists (select 1 from public.seller_payout_accounts a
                    where a.id = p_subject and a.seller_id = p_seller and a.superseded_at is null) then
      raise exception 'seller_sealed_put:subject' using errcode = '23503';
    end if;
  else
    raise exception 'seller_sealed_put:field' using errcode = '22023';
  end if;

  update seller_vault.sealed_values v
     set superseded_at = now()
   where v.seller_id = p_seller and v.field = p_field and v.subject_id = p_subject and v.superseded_at is null;
  insert into seller_vault.sealed_values (id, seller_id, field, subject_id, envelope, key_id)
  values (p_id, p_seller, p_field, p_subject, p_envelope, p_key_id);

  if p_field = 'dob' then
    update public.seller_identities set dob_sealed_id = p_id, updated_by = p_actor_id,
           updated_via = p_actor_kind, updated_at = now() where seller_id = p_seller;
  elsif p_field = 'birth_place' then
    update public.seller_identities set birth_place_sealed_id = p_id, updated_by = p_actor_id,
           updated_via = p_actor_kind, updated_at = now() where seller_id = p_seller;
  elsif p_field = 'tax_id' then
    update public.seller_tax_ids set value_sealed_id = p_id, updated_by = p_actor_id,
           updated_via = p_actor_kind, updated_at = now() where id = p_subject;
  elsif p_field = 'payout_identifier' then
    update public.seller_payout_accounts set identifier_sealed_id = p_id, updated_by = p_actor_id,
           updated_via = p_actor_kind, updated_at = now() where id = p_subject;
  else
    update public.seller_payout_accounts set holder_sealed_id = p_id, updated_by = p_actor_id,
           updated_via = p_actor_kind, updated_at = now() where id = p_subject;
  end if;
end
$$;

-- CLEAR: a value that no longer applies (place of birth once a TIN exists).
-- Only dob and birth_place: the other fields are supersede-only rows.
create or replace function public.seller_sealed_clear(p_seller uuid, p_field text, p_actor_id uuid, p_actor_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_field not in ('dob', 'birth_place') then
    raise exception 'seller_sealed_clear:field' using errcode = '22023';
  end if;
  update seller_vault.sealed_values v set superseded_at = now()
   where v.seller_id = p_seller and v.field = p_field and v.superseded_at is null;
  if p_field = 'dob' then
    update public.seller_identities set dob_sealed_id = null, updated_by = p_actor_id,
           updated_via = p_actor_kind, updated_at = now() where seller_id = p_seller;
  else
    update public.seller_identities set birth_place_sealed_id = null, updated_by = p_actor_id,
           updated_via = p_actor_kind, updated_at = now() where seller_id = p_seller;
  end if;
end
$$;

-- GET: log first, then return. A reveal without a log row cannot happen
-- through the API: both are one transaction.
create or replace function public.seller_sealed_get(
  p_seller uuid, p_fields text[], p_include_superseded boolean,
  p_actor_kind text, p_actor_id uuid, p_purpose text,
  p_reason_note text, p_ticket_ref text, p_surface text)
returns table (id uuid, field text, subject_id uuid, envelope text, key_id text,
               created_at timestamptz, superseded_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_actor_kind = 'seller' and p_actor_id is distinct from p_seller then
    raise exception 'seller_sealed_get:not_owner' using errcode = '42501';
  end if;
  if p_actor_kind = 'staff' and (p_actor_id is null or p_purpose is null) then
    raise exception 'seller_sealed_get:staff_needs_reason' using errcode = '42501';
  end if;
  insert into public.seller_data_access_log
    (actor_kind, actor_id, seller_id, action, field_classes, purpose, reason_note, ticket_ref, surface, record_count)
  values
    (p_actor_kind, p_actor_id, p_seller, 'reveal_sealed', p_fields, p_purpose, p_reason_note, p_ticket_ref, p_surface,
     (select count(*) from seller_vault.sealed_values v
       where v.seller_id = p_seller and v.field = any (p_fields)
         and (p_include_superseded or v.superseded_at is null)));
  return query
    select v.id, v.field, v.subject_id, v.envelope, v.key_id, v.created_at, v.superseded_at
      from seller_vault.sealed_values v
     where v.seller_id = p_seller and v.field = any (p_fields)
       and (p_include_superseded or v.superseded_at is null)
     order by v.created_at;
end
$$;

-- ROTATION (stage 2 route; the functions exist from day one).
create or replace function public.seller_sealed_rotation_batch(p_current_key text, p_limit integer)
returns table (id uuid, seller_id uuid, field text, subject_id uuid, envelope text, key_id text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  insert into public.seller_data_access_log
    (actor_kind, seller_id, action, field_classes, purpose, surface, record_count)
  values ('system', null, 'rotate', array['tax_id', 'dob', 'birth_place', 'payout_identifier', 'payout_holder'],
          'key_rotation', 'job', least(greatest(p_limit, 0), 500));
  return query
    select v.id, v.seller_id, v.field, v.subject_id, v.envelope, v.key_id
      from seller_vault.sealed_values v
     where v.key_id <> p_current_key
     order by v.created_at
     limit least(greatest(p_limit, 0), 500);
end
$$;

create or replace function public.seller_sealed_reseal(p_id uuid, p_old_key text, p_envelope text, p_key_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update seller_vault.sealed_values v
     set envelope = p_envelope, key_id = p_key_id, resealed_at = now()
   where v.id = p_id and v.key_id = p_old_key;
  return found;
end
$$;

-- Counts only, for the monitor.
create or replace function public.seller_vault_key_census()
returns table (key_id text, field text, current_count bigint, superseded_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select v.key_id, v.field,
         count(*) filter (where v.superseded_at is null),
         count(*) filter (where v.superseded_at is not null)
    from seller_vault.sealed_values v
   group by v.key_id, v.field
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.seller_sealed_put(uuid, uuid, text, uuid, text, text, uuid, text)',
    'public.seller_sealed_clear(uuid, text, uuid, text)',
    'public.seller_sealed_get(uuid, text[], boolean, text, uuid, text, text, text, text)',
    'public.seller_sealed_rotation_batch(text, integer)',
    'public.seller_sealed_reseal(uuid, text, text, text)',
    'public.seller_vault_key_census()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
```

Cross-schema foreign keys (`seller_identities.dob_sealed_id` to
`seller_vault.sealed_values`) need no privilege for the service role: the
referential check runs as the table owner. If the replica's ownership makes
that check fail, fall back to a plain uuid plus the monitor class
`ob_sealed_pointer_missing`.

### 2.8 What is deliberately NOT sealed, and why

| Value | Why clear |
|---|---|
| Legal names, company name, representative | Shown to buyers for traders (consumer law, DSA); needed in clear for the sanctions name pre-filter in SQL, the ARES name match and the DAC7 file. Protected by owner-only RLS and logged staff access. |
| Primary, public, returns addresses | Not in the specification's sealed list; the public one is published; formatting and DAC7 output need them. Same protection. |
| Emails, phones | The code proof binds to the stored value in SQL (`20260926_contact_verification.sql:162`, `:250-251`); the public ones are published. |
| VAT IDs | Public by nature (VIES, invoices, the product page). **Caveat for the lawyer:** a Czech natural person's VAT number can contain the birth number, so a clear VAT row can reveal a sealed TIN (section 11.3). |
| Registration numbers (ICO) | Public registers; shown to buyers. |
| Countries, seller type, trader status, categories, website, product-safety role | Not sensitive; the gate and the monitor read some of them. |
| Declarations with IP | Evidence must be producible without a key ceremony; the IP's retention is a lawyer question (evidence class). |
| Verification evidence | Non-sensitive by construction: VIES flags and dates, ARES public register data, validator ids, response hashes; never a sealed value. |
| Fingerprints, hints | Keyed (not reversible without the fingerprint key) and 2 to 4 characters. |
| Stripe account id | Stripe's identifier, matched against webhook events; not a secret. |

### 2.9 Backups and the read-only backup role

* Supabase backups and point-in-time recovery contain the vault as
  ciphertext and everything else in clear, exactly like the live database.
  Purged rows survive in backups until the backup window rolls over: the
  privacy notice must say so (lawyer).
* `backup_reader` holds `pg_read_all_data` (memory note
  `prod-ops-roles-and-secrets`; inventory 05 section 7.6), which includes
  USAGE on every schema, so it can read the vault's envelopes. Harmless
  without the keyring; accepted and stated. `schema_probe` reads catalogs only.
* The repo's manual `backup.yml` (no schedule, refuses on a public repo) would
  produce a dump with the same properties; such an artifact must stay private.

### 2.10 Key custody: options for the owner

| Option | Custody | Pros | Cons |
|---|---|---|---|
| **A (recommended)**: Store Worker secrets only, plus an offline escrow copy (password manager entry held by the owner, a second sealed copy with Adrian) | Cloudflare (runtime) + owner (escrow) | No new service; one Worker can decrypt; Admin reveals call a Store internal endpoint | Losing both copies loses every sealed TIN, DOB and IBAN (the DAC7 record): the escrow is mandatory, not optional |
| B: Cloudflare Secrets Store shared by Store and Admin | Cloudflare account | Admin could decrypt itself | Two Workers can decrypt; larger blast radius |
| C: External KMS (AWS KMS / GCP KMS) wrapping per-row data keys | Cloud provider | Strong separation; KMS audit log; rotation managed | New dependency and latency on every reveal; cost; more to build |
| D: Supabase Vault / pgsodium | The same database | Built in | Rejected: the key sits next to the data, and Supabase marks pgsodium "pending deprecation" with Vault's internals still moving off it ([pgsodium docs](https://supabase.com/docs/guides/database/extensions/pgsodium)) |

Recommended Admin path with option A: Admin never holds the keyring; a staff
reveal calls a Store internal route (staff session at aal2, the same shared
session Admin already relies on) that calls `seller_sealed_get` with
`p_actor_kind = 'staff'`, then decrypts and returns the value to that staff
page only. The application architect owns the route.

### 2.11 Threat table

| Who / what | Sees | Cannot see |
|---|---|---|
| Database dump or backup leaked (incl. `backup_reader`) | All clear seller data (names, addresses, contacts, VAT, registrations, declarations with IP, history of clear fields, status); envelopes; fingerprints; hints | Any sealed plaintext (no keyring); fingerprinted values (no fingerprint key) |
| A seller's own JWT | Own non-sealed rows in the owner-readable tables, own status | Any envelope (no schema USAGE, RPCs revoked); other sellers' rows; service-only tables (screens, location evidence, access log, totals) |
| Another seller's JWT | Nothing of this seller | Everything |
| A team member (editor, viewer) | Nothing: owner-only policies; no team action covers seller details (`Store/src/lib/team/permissions.ts:22-70`, mirror `20261008_order_lifecycle.sql:365-377`) | Everything; the status row too |
| A staff account (Admin) | Private non-sealed data through the service role, each view logged by Admin code; sealed values only through the reveal route, logged by the database | Nothing unlogged through the reveal path; a staff member with SQL editor access sees ciphertext only |
| MCP agent token | Tool outputs only; through the minted JWT, the status row (codes). Owner policies refuse JWTs with `agent_grant_id` | Every private table, every envelope, even if a tool were wrongly pointed at them under the minted JWT |
| A log line (Postgres, PostgREST, Worker) | At worst an envelope (RPC body), ids, codes | Plaintext of sealed values: the database never receives it. Worker logs are the app's discipline (G 1H) |
| An SQL function (any, definer included) | Envelopes | Plaintext: no key exists in the database, so no function can decrypt |
| Leaked service-role key | All clear data; envelopes via the RPC (logged, with whatever actor the attacker claims) | Sealed plaintext without the Worker keyring |
| Compromised Store Worker (code execution) | Everything (keyring + service role) | Nothing at the database level; only the access log and rotation limit the damage |

---

## 3. Access

### 3.1 RLS policies and grants (the same loop in each file, over that file's tables)

Each file runs the loop below over the owner-readable tables IT creates:
file 01 `seller_field_changes`; file 02 the eight profile tables; file 03
`seller_declarations`, `seller_verifications`; file 10 `seller_dac7_requests`,
`seller_dac7_events`. Shown here with the file 02 list. The loop revokes first,
so the service-role grants that follow it in each file are the last word.

```sql
-- Owner-readable tables: SELECT for the owner, never for an agent JWT, never
-- at aal1 for a 2FA account; every write is the service role's.
do $$
declare
  t text;
begin
  foreach t in array array[
    'seller_identities', 'seller_addresses', 'seller_contacts', 'seller_trade_profiles',
    'seller_tax_ids', 'seller_vat_ids', 'seller_registrations', 'seller_payout_accounts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using ((select auth.uid()) = seller_id and (select auth.jwt() ->> ''agent_grant_id'') is null)',
      t || '_owner_read', t);
    execute format('drop policy if exists "Require two-factor when enrolled" on public.%I', t);
    execute format(
      'create policy "Require two-factor when enrolled" on public.%I '
      'as restrictive for all to authenticated '
      'using ((select public.mfa_session_ok())) with check ((select public.mfa_session_ok()))', t);
  end loop;
end
$$;

-- Service-role grants, by kind (each statement in the file that creates the tables).
grant select, insert, update, delete on table
  public.seller_identities, public.seller_addresses, public.seller_contacts, public.seller_trade_profiles
  to service_role;                                   -- file 02
grant select, insert, update on table
  public.seller_tax_ids, public.seller_vat_ids, public.seller_registrations, public.seller_payout_accounts
  to service_role;                                   -- file 02; updates limited by seller_value_row_guard
grant select, insert on table public.seller_field_changes to service_role;   -- file 01, append-only
grant select, insert on table
  public.seller_declarations, public.seller_verifications,
  public.seller_location_evidence, public.seller_sanctions_screens, public.seller_sanctions_reviews
  to service_role;                                   -- file 03, append-only

-- Service-role-only tables (file 03): RLS on, no policy.
do $$
declare
  t text;
begin
  foreach t in array array['seller_location_evidence', 'seller_sanctions_screens', 'seller_sanctions_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end
$$;
```

The status row (file 04) uses the same owner policy WITHOUT the agent clause,
plus the restrictive policy. The pattern of the restrictive policy is
`Store/supabase/migrations/20260923_two_factor_auth.sql:100-106`; the "every
table a client can read carries a two-factor rule" test
(`22-two-factor-rls.test.ts:232-251`) then covers the new tables by itself.

### 3.2 The team-member question

There is no team action for seller details or settings: `TEAM_ACTIONS` is
`team.*`, `store.read`, `products.write`, `storefront.write`, `orders.fulfil`,
`orders.refund`, `billing.manage` (`Store/src/lib/team/permissions.ts:22-43`),
mirrored by `team_role_can` (`Store/supabase/migrations/20261008_order_lifecycle.sql:365-377`).
Team members already cannot read the owner's `profiles` row
(`Replica:95-100`), and the business page tells them it shows their own
details (G, `Store/src/app/settings/business/page.tsx:35-49`). So: **owner
only**. If the owner later wants an editor to manage seller details, that is
a new action (for example `seller_details.read`) added to both maps together,
and it would still never reach sealed values or the reveal route.

### 3.3 Agent JWTs

The minted agent JWT carries `agent_grant_id` (`Store/src/lib/agent/mint.ts:79`).
The owner policies refuse it, so even a tool that wrongly selected a private
table under the minted JWT gets nothing. The status row stays readable (codes
only) for `get_store`'s missing-field list. A unit test (extend
`Store/tests/unit/agent/registry.test.ts`) asserts that no file under
`src/lib/agent/` names a `seller_` table other than `seller_onboarding_status`
or calls a `seller_sealed_*` RPC.

### 3.4 The staff access log

```sql
create table if not exists public.seller_data_access_log (
  id            uuid primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),
  actor_kind    text not null,
  actor_id      uuid,              -- staff or seller auth user id; null for system
  staff_role    text,              -- admin_users.role at the time ('owner'|'staff')
  seller_id     uuid,              -- null only for a cross-seller system action (rotation)
  action        text not null,
  field_classes text[] not null,
  purpose       text not null,
  reason_note   text,
  ticket_ref    text,
  surface       text not null,
  request_id    text,
  record_count  integer,
  constraint access_log_actor check (actor_kind in ('staff', 'seller', 'system')),
  constraint access_log_actor_id check (actor_kind = 'system' or actor_id is not null),
  constraint access_log_role check (staff_role is null or staff_role in ('owner', 'staff')),
  constraint access_log_seller check (seller_id is not null or action = 'rotate'),
  constraint access_log_action check (action in (
    'view_private', 'reveal_sealed', 'export', 'edit', 'verify_manual', 'sanctions_review',
    'dac7_report', 'rotate')),
  constraint access_log_classes check (
    cardinality(field_classes) between 1 and 20
    and field_classes <@ array[
      'identity', 'addresses', 'contacts', 'trade_profile', 'tax_id', 'dob', 'birth_place',
      'payout_identifier', 'payout_holder', 'vat', 'registration', 'declarations', 'verifications',
      'sanctions', 'change_history', 'location_evidence', 'period_totals', 'dac7']::text[]),
  constraint access_log_purpose check (purpose in (
    'seller_request', 'support', 'dac7_reporting', 'authority_request', 'sanctions_review',
    'verification_review', 'fraud_investigation', 'dsa_request', 'self_view', 'self_export', 'key_rotation')),
  constraint access_log_note check (reason_note is null or char_length(reason_note) <= 500),
  constraint access_log_ticket check (ticket_ref is null or char_length(ticket_ref) <= 100),
  constraint access_log_surface check (surface in ('admin', 'store', 'job', 'sql')),
  constraint access_log_request check (request_id is null or char_length(request_id) <= 100),
  constraint access_log_count check (record_count is null or record_count >= 0)
);
create index if not exists access_log_seller_idx on public.seller_data_access_log (seller_id, occurred_at desc);
create index if not exists access_log_actor_idx on public.seller_data_access_log (actor_id, occurred_at desc);

alter table public.seller_data_access_log enable row level security;
revoke all on table public.seller_data_access_log from public, anon, authenticated, service_role;
grant select, insert on table public.seller_data_access_log to service_role;
drop trigger if exists access_log_append_only on public.seller_data_access_log;
create trigger access_log_append_only before update or delete on public.seller_data_access_log
  for each row execute function public.seller_append_only_guard();
drop trigger if exists access_log_no_truncate on public.seller_data_access_log;
create trigger access_log_no_truncate before truncate on public.seller_data_access_log
  for each statement execute function public.seller_append_only_guard();
```

No foreign keys: the log outlives staff accounts, sellers and the anchor.

**What Admin must write on every read of private data** (Admin code; the
Admin repo needs no migration because the table is in the shared database):

* Before rendering any page or API response that selects from
  `seller_identities`, `seller_addresses` (primary, or public when it differs),
  `seller_contacts` (primary), `seller_tax_ids`, `seller_payout_accounts`,
  `seller_declarations`, `seller_verifications`, `seller_field_changes`,
  `seller_location_evidence`, `seller_sanctions_*`, `seller_period_totals` or
  `seller_order_extracts`: insert one `view_private` row (actor, staff role,
  seller, field classes shown, purpose, optional note/ticket, request id).
  **Fail closed**: an insert error shows "access log unavailable" instead of
  the data. One shared helper (for example `withSellerAccessLog`) and an
  Admin unit test that every `.from("seller_` call goes through it. This must
  NOT reuse `logAdminAction`, which swallows a failed insert
  (`Admin/src/lib/auth/log-admin-action.ts:11-30`).
* The PUBLIC block already printed on product pages (trading name, public
  address, public email, proven phone, shown VAT, country), which
  `fetchSellerFacts` reads today (`Admin/src/lib/data/moderation.ts:947-964`),
  needs no log row.
* **A reveal of a sealed value** is a `seller_sealed_get` call with
  `p_actor_kind = 'staff'`, a purpose from the list and (for anything but
  `sanctions_review` / `verification_review`) a note or ticket: the database
  writes the `reveal_sealed` row in the same transaction, so it cannot be
  skipped. The Store reveal route records the request id.
* Staff edits of seller data write an `edit` row (and the change history
  captures the values by itself).

**Protection of the log, learning from B L1** (`moderation_decisions` and
`admin_audit_log` are "append-only" by comment or RLS only; the service role
can edit both, Admin deletes a decision on failure, and a cascade erases
decisions with the account):

1. The service role holds SELECT and INSERT only; UPDATE, DELETE, TRUNCATE
   revoked from every API role.
2. A BEFORE UPDATE/DELETE trigger and a BEFORE TRUNCATE trigger refuse every
   role, the owner included, except the owner-run purge past the retention
   period.
3. No foreign keys, so no cascade can reach it.
4. Inserts are never swallowed (above).
5. Stage 2 (file 12): a hash chain, `seq bigint generated always as identity`,
   `prev_hash bytea`, `row_hash bytea = sha256(prev_hash || canonical row
   text)` computed by a BEFORE INSERT trigger under
   `pg_advisory_xact_lock(<constant>)` (`sha256(bytea)` is built in since
   PostgreSQL 11, no extension), a verify function returning the first broken
   `seq`, and the daily scheduled job printing the head `seq` and hash (not
   personal data) into the workflow log as an external anchor. A purge records
   a checkpoint (first remaining `seq` and its `prev_hash`) so verification can
   restart there.

### 3.5 RLS coverage test entries

`Store/tests/integration/19-rls-coverage.test.ts:28-139`, `POLICY_FREE_BY_DESIGN`
additions, each with its reason:

| Table | Reason (comment text) |
|---|---|
| `seller_records` | The anchor and retention clocks of every seller. A client that could write it could end its own relationship, move its clocks or lift a legal hold. |
| `seller_retention_rules` | Retention periods, written by migrations only. A client that could write them could shorten what must be kept. |
| `seller_location_evidence` | Sign-up and billing country evidence. Staff and server only; a client that could write it could forge its own evidence. |
| `seller_sanctions_screens`, `seller_sanctions_reviews` | Sanctions screening and its review. A client that could read them could learn it is under review; one that could write them could clear itself. |
| `seller_data_access_log` | Who read which seller's private data. A client that could write it could forge or bury an access. |
| `market_countries` | The per-country onboarding rules the gate reads. A client that could write them could switch its own gate to report-only. |
| `seller_period_totals`, `seller_order_extracts` | Frozen DAC7 figures. A client that could write them could change what is reported. |
| stage 2: `seller_reregistration_blocks`, `seller_retention_purges`, `sanctions_list_versions`, `sanctions_list_entries`, `sanctions_list_names`, `market_threshold_rules`, `market_fx_rates`, `seller_threshold_snapshots` | Same reasoning per table (block evasion, hiding a purge, editing the list, changing a threshold or a rate). |

`Store/tests/integration/00-harness.test.ts:32-157` (exhaustive sorted table
list) gains every new `public` table with a one-line comment. A new test
asserts the vault is invisible: `has_schema_privilege(r, 'seller_vault',
'USAGE')` is false for `anon`, `authenticated`, `service_role`, and a select
from `seller_vault.sealed_values` as the service role fails with permission
denied. The grants assertion of `19-rls-coverage.test.ts:227-246` is
repeated for every service-only table (no row in
`information_schema.role_table_grants` for `anon` / `authenticated`) and, for
owner-readable tables, exactly `SELECT` for `authenticated`.

---

## 4. Retention and deletion

### 4.1 Classes (rows of `seller_retention_rules`)

| Class | Default | Clock | Tables | To confirm |
|---|---|---|---|---|
| `dac7` | 120 months | from 1 January after the seller's LAST reporting year with a paid sale (`last_sale_year`, in `year_tz`) | `seller_identities`, `seller_addresses` primary, `seller_tax_ids`, `seller_vat_ids`, `seller_registrations`, `seller_payout_accounts`, vault, `seller_verifications`, `seller_dac7_*`, `seller_period_totals`, `seller_order_extracts`, DAC7 snapshots, history of these fields | tax adviser: which year, CZ-specific period |
| `dac7_no_sales` | 6 months | from the relationship end, for the `dac7` tables of a seller who never had a paid sale | as `dac7` | tax adviser: does DAC7 retention apply to never-reportable sellers |
| `dsa` | 6 months | from the relationship end | `seller_contacts`, `seller_addresses` public, their history | lawyer: Art. 29 micro exemption; may it be shorter on the seller's request |
| `relationship` | 6 months | from the relationship end | `seller_trade_profiles`, `seller_addresses` returns, their history | lawyer (privacy policy) |
| `evidence` | 36 months | from the relationship end | `seller_declarations`, `seller_sanctions_*`, `seller_location_evidence` | lawyer: limitation period, IP retention, sanctions records; tax adviser for billing-country evidence (VAT on our own fees) |
| `operational` | 0 | at the relationship end | `seller_onboarding_status` | none |
| `blocklist` | 120 months | from the block's creation | `seller_reregistration_blocks` | lawyer: lawful basis and period |
| `access_log` | 36 months | from the row's creation | `seller_data_access_log` | lawyer |

Overlap rule: a value held for two reasons sits in the table of the longer
class (legal names and the primary address are DAC7 and DSA: they live in
`dac7` tables).

Per-row clocks while the relationship is still active (stage 2 purge):
frozen totals and order extracts of a period older than `dac7` months from
that period's year end, superseded tax IDs / VAT / registrations / payout rows
and their sealed values superseded more than `dac7` months ago, verification
rows for superseded values older than that, and access-log rows older than
`access_log` months are purged even though the seller is still active.

### 4.2 When "the seller relationship ends", in data

`seller_records.relationship_ended_at` + `end_reason`, set once by
`seller_relationship_end()` when: the account is deleted (`account_deleted`,
called by the deletion job); the platform terminates the seller agreement
(`terminated`, a staff action in Admin); or the account is closed for DAC7
non-cooperation (`dac7_closure`). Dormancy alone does not end it (owner
decision; a dormancy rule would be one more caller). A seller who stops
selling but keeps the account remains in the relationship. A relationship
starts at the first seller-terms acceptance (trigger in 1.6) or first content.

### 4.3 What account deletion keeps, and where

| Kept | Where | Until |
|---|---|---|
| Identity, sealed DOB / place of birth, primary address, residence countries, permanent establishments, tax IDs (sealed), VAT IDs, registrations, payout identifiers (sealed), verification log, DAC7 trail, frozen quarterly totals, order extracts, Stripe account id | `dac7` tables (no FK to `auth.users`) | 10 years from the end of the last reporting year with a paid sale; 6 months after the end if there was never one |
| Contacts, public address | `dsa` tables | 6 months after the end |
| Trading name, categories, website, product-safety role and default EU RP, returns address | `relationship` tables | 6 months after the end |
| Declarations (with IP), sanctions screens and reviews, location evidence | `evidence` tables | 36 months after the end |
| Fingerprints of a blocked seller | `seller_reregistration_blocks` | `block_until` |
| Access log | `seller_data_access_log` | 36 months per row |
| NOT kept | `seller_onboarding_status`; everything in the cascade world (profile, products, storefronts, orders WITH buyer data, payment account row, team, notifications) | deleted as today |

### 4.4 `orders.paid_at` (file 07): needed, and why

Needed: DAC7 attributes consideration to the quarter in which it was paid or
credited, the counters count sales in windows, and `created_at` is when the
checkout STARTED (a pending order written up to 45 minutes before payment, D
2.2). `order_confirm_paid` (latest and only definition:
`Store/supabase/migrations/20261008_order_lifecycle.sql:226-263`) stamps no
time. A trigger, not a redefinition, so it also binds the demo simulator and
every direct writer, and does not collide with P1b file 3, which redefines
`order_place`:

```sql
alter table public.orders add column if not exists paid_at timestamptz;
comment on column public.orders.paid_at is
  'When the payment was confirmed: stamped when status becomes paid (or, for an order written already paid, its created_at). Null on orders paid before this column existed: readers use coalesce(paid_at, created_at).';

create or replace function public.orders_stamp_paid_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.paid_at := coalesce(new.created_at, now());   -- written already paid: paid when created (the simulator backdates created_at)
  else
    new.paid_at := now();
  end if;
  return new;
end
$$;
revoke execute on function public.orders_stamp_paid_at() from public, anon, authenticated, service_role;

drop trigger if exists orders_stamp_paid_at_insert on public.orders;
create trigger orders_stamp_paid_at_insert before insert on public.orders
  for each row when (new.status = 'paid' and new.paid_at is null)
  execute function public.orders_stamp_paid_at();
drop trigger if exists orders_stamp_paid_at_update on public.orders;
create trigger orders_stamp_paid_at_update before update of status on public.orders
  for each row when (new.status = 'paid' and old.status is distinct from 'paid' and new.paid_at is null)
  execute function public.orders_stamp_paid_at();

create index if not exists orders_seller_paid_at_idx
  on public.orders (seller_id, paid_at) where status in ('paid', 'refunded', 'disputed');
```

No backfill (no real payment has ever happened; readers coalesce). Routine
updates (refund, ship, review reminders, the expiry sweep) never satisfy the
`WHEN` clause, so they do not call the function.

### 4.5 Frozen per-seller per-period totals and the order extract (file 07)

Supersedes D 7.2's `dac7_seller_quarters`. Built on D 2.8 with `paid_at`.

```sql
create table if not exists public.seller_period_totals (
  seller_id               uuid not null references public.seller_records (seller_id) on delete cascade,
  period_year             smallint not null,
  period_quarter          smallint not null,
  currency                text not null,
  orders                  integer not null,
  orders_not_refunded     integer not null,
  lines                   integer not null,
  units                   integer not null,
  gross_cents             bigint not null,
  delivery_cents          bigint not null,
  refunded_cents          bigint not null,
  fee_on_orders_cents     bigint not null,
  fee_charged_cents       bigint not null,
  fee_returned_cents      bigint not null,
  consideration_net_cents bigint not null,
  stripe_account_id       text,
  time_zone               text not null,
  computed_at             timestamptz not null default now(),
  frozen_at               timestamptz,
  primary key (seller_id, period_year, period_quarter, currency),
  constraint seller_period_quarter check (period_quarter between 1 and 4),
  constraint seller_period_year check (period_year between 2020 and 2200),
  constraint seller_period_currency check (currency ~ '^[A-Z]{3}$')
);

create table if not exists public.seller_order_extracts (
  order_id          uuid primary key,   -- no FK: outlives the order
  seller_id         uuid not null references public.seller_records (seller_id) on delete cascade,
  paid_at           timestamptz not null,
  currency          text not null,
  status            text not null,
  channel           text,
  amount_cents      bigint not null,
  delivery_cents    bigint not null,
  discount_cents    bigint not null,
  refunded_cents    bigint not null,
  fee_cents         bigint not null,
  lines             integer not null,
  units             integer not null,
  payment_ref       text,               -- Stripe's pi_ id; no buyer data is copied (no email, no address)
  stripe_account_id text,
  captured_at       timestamptz not null default now(),
  frozen_at         timestamptz,
  constraint seller_extract_currency check (currency ~ '^[A-Z]{3}$')
);
create index if not exists seller_extract_seller_idx on public.seller_order_extracts (seller_id, paid_at);

-- Frozen rows are immutable; deletion only by the purge.
create or replace function public.seller_frozen_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('seller.retention_purge', true), '') = 'on'
     and current_user not in ('anon', 'authenticated', 'service_role', 'authenticator') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'frozen:delete:%', tg_table_name using errcode = '42501';
  end if;
  if old.frozen_at is not null then
    raise exception 'frozen:%', tg_table_name using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function public.seller_frozen_guard() from public, anon, authenticated, service_role;
-- triggers: before update or delete on both tables, for each row.

create or replace function public.seller_period_totals_compute(p_seller uuid, p_year integer, p_tz text)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with sales as (
    select o.id as order_id, o.seller_id, o.currency, o.status,
           extract(year from coalesce(o.paid_at, o.created_at) at time zone p_tz)::int    as yr,
           extract(quarter from coalesce(o.paid_at, o.created_at) at time zone p_tz)::int as qtr,
           o.amount_cents::bigint                                                          as amount_cents,
           coalesce(o.shipping_cents, 0)::bigint                                           as delivery_cents,
           coalesce(o.application_fee_cents, o.platform_fee_cents + coalesce(o.ad_fee_cents, 0))::bigint as fee_cents,
           1 + coalesce(x.lines, 0)                                                        as lines,
           o.quantity + coalesce(x.units, 0)                                               as units
      from public.orders o
      left join lateral (
        select count(*)::int as lines, sum(a.quantity)::int as units
          from public.order_add_ons a where a.order_id = o.id) x on true
     where o.seller_id = p_seller
       and o.status in ('paid', 'refunded', 'disputed')
       and o.payment_ref like 'pi\_%'          -- money Stripe took: no demo, simulator or test-provider rows
       and (p_year is null
            or extract(year from coalesce(o.paid_at, o.created_at) at time zone p_tz) = p_year)
  ),
  refunds as (
    select s.order_id,
           case when s.status = 'refunded' then s.amount_cents
                else coalesce((select sum(r.amount_cents) from public.order_line_refunds r
                                where r.order_id = s.order_id), 0) end as refunded_cents
      from sales s
  ),
  fees as (
    select l.order_id,
           coalesce(sum(l.amount_cents) filter (where l.amount_cents > 0), 0)  as charged,
           coalesce(-sum(l.amount_cents) filter (where l.amount_cents < 0), 0) as returned
      from public.fee_ledger l
     where l.livemode and l.order_id in (select order_id from sales)
     group by l.order_id
  ),
  agg as (
    select s.seller_id, s.yr, s.qtr, s.currency,
           count(*)::int                                       as orders,
           count(*) filter (where s.status <> 'refunded')::int as orders_not_refunded,
           sum(s.lines)::int as lines, sum(s.units)::int as units,
           sum(s.amount_cents) as gross, sum(s.delivery_cents) as delivery,
           sum(r.refunded_cents) as refunded, sum(s.fee_cents) as fee_on_orders,
           coalesce(sum(f.charged), 0) as charged, coalesce(sum(f.returned), 0) as returned
      from sales s
      join refunds r using (order_id)
      left join fees f using (order_id)
     group by s.seller_id, s.yr, s.qtr, s.currency
  ),
  up as (
    insert into public.seller_period_totals as t
      (seller_id, period_year, period_quarter, currency, orders, orders_not_refunded, lines, units,
       gross_cents, delivery_cents, refunded_cents, fee_on_orders_cents, fee_charged_cents,
       fee_returned_cents, consideration_net_cents, stripe_account_id, time_zone, computed_at)
    select a.seller_id, a.yr, a.qtr, a.currency, a.orders, a.orders_not_refunded, a.lines, a.units,
           a.gross, a.delivery, a.refunded, a.fee_on_orders, a.charged, a.returned,
           a.gross - a.refunded - (a.charged - a.returned),
           (select p.stripe_account_id from public.seller_payment_accounts p where p.owner_id = a.seller_id),
           p_tz, now()
      from agg a
    on conflict (seller_id, period_year, period_quarter, currency) do update
       set orders = excluded.orders, orders_not_refunded = excluded.orders_not_refunded,
           lines = excluded.lines, units = excluded.units, gross_cents = excluded.gross_cents,
           delivery_cents = excluded.delivery_cents, refunded_cents = excluded.refunded_cents,
           fee_on_orders_cents = excluded.fee_on_orders_cents, fee_charged_cents = excluded.fee_charged_cents,
           fee_returned_cents = excluded.fee_returned_cents,
           consideration_net_cents = excluded.consideration_net_cents,
           stripe_account_id = coalesce(excluded.stripe_account_id, t.stripe_account_id),
           time_zone = excluded.time_zone, computed_at = now()
     where t.frozen_at is null
    returning 1
  )
  select count(*)::int from up
$$;
```

`seller_order_extracts_capture(p_seller, p_year, p_tz)` inserts one row per
order of the same `sales` set (amount, delivery, discount, refunded, fee,
lines, units, `payment_ref`, Stripe account id; `on conflict (order_id) do
update ... where frozen_at is null`). `seller_period_freeze(p_seller, p_year,
p_tz)` sets `frozen_at` on both tables (all years when `p_year` is null). All
three: SECURITY INVOKER, `service_role` only, explicit revokes. Refunds are
attributed to the sale's quarter (D 2.8), a one-line change if the tax adviser
says otherwise. Known blind spots stay those of D 2.8 (dashboard partial
refunds, lost chargebacks).

### 4.6 `seller_relationship_end()` (file 07)

```sql
create or replace function public.seller_relationship_end(p_seller uuid, p_reason text, p_tz text default 'Europe/Prague')
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_rec      public.seller_records%rowtype;
  v_has_sale boolean;
begin
  if p_reason not in ('account_deleted', 'terminated', 'dac7_closure') then
    raise exception 'seller_relationship_end:reason' using errcode = '22023';
  end if;
  select exists (select 1 from public.orders o
                  where o.seller_id = p_seller and o.status in ('paid', 'refunded', 'disputed')
                    and o.payment_ref like 'pi\_%')
    into v_has_sale;
  -- A seller with sales always gets an anchor, even if the app never made one.
  insert into public.seller_records (seller_id, relationship_started_at)
  values (p_seller, case when v_has_sale then now() end)
  on conflict (seller_id) do nothing;
  select * into v_rec from public.seller_records r where r.seller_id = p_seller for update;
  if v_rec.relationship_ended_at is not null then
    return jsonb_build_object('already', true);   -- idempotent: a retried deletion run calls it again
  end if;
  if v_has_sale then
    perform public.seller_period_totals_compute(p_seller, null, p_tz);
    perform public.seller_order_extracts_capture(p_seller, null, p_tz);
    perform public.seller_period_freeze(p_seller, null, p_tz);
  end if;
  update public.seller_records r
     set relationship_ended_at = now(),
         end_reason            = p_reason,
         account_deleted_at    = case when p_reason = 'account_deleted' then now() end,
         last_sale_year        = (select max(extract(year from coalesce(o.paid_at, o.created_at) at time zone p_tz))::smallint
                                    from public.orders o
                                   where o.seller_id = p_seller and o.status in ('paid', 'refunded', 'disputed')
                                     and o.payment_ref like 'pi\_%'),
         stripe_account_id     = coalesce((select a.stripe_account_id from public.seller_payment_accounts a
                                            where a.owner_id = p_seller), r.stripe_account_id)
   where r.seller_id = p_seller;
  delete from public.seller_onboarding_status s where s.seller_id = p_seller;   -- operational class
  return jsonb_build_object('already', false, 'had_sales', v_has_sale);
end
$$;
revoke execute on function public.seller_relationship_end(uuid, text, text) from public, anon, authenticated;
grant execute on function public.seller_relationship_end(uuid, text, text) to service_role;

-- Deadlines are computed on read from the facts and the rules, so a rule the
-- lawyer changes later applies to everyone without rewriting any row.
create or replace function public.seller_retention_deadline(p_seller uuid, p_class text)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when s.relationship_ended_at is null then null
    when s.relationship_started_at is null then s.relationship_ended_at        -- never sold: nothing to keep
    when p_class = 'dac7' and s.last_sale_year is not null then
      make_timestamptz(s.last_sale_year + 1, 1, 1, 0, 0, 0, coalesce(d.year_tz, 'UTC'))
        + make_interval(months => d.keep_months)
    when p_class = 'dac7' then s.relationship_ended_at + make_interval(months => n.keep_months)
    else s.relationship_ended_at + make_interval(months => r.keep_months)
  end
  from public.seller_records s
  left join public.seller_retention_rules d on d.class = 'dac7'
  left join public.seller_retention_rules n on n.class = 'dac7_no_sales'
  left join public.seller_retention_rules r on r.class = p_class
  where s.seller_id = p_seller
$$;
```

(`seller_retention_deadline` revoked from client roles, granted to the service
role.) Called before the deletion job's `deleteUser`, while orders still
exist; the whole freeze is one transaction.

### 4.7 The retention job (stage 2, file 12)

`seller_retention_purge(p_limit integer default 25)`: SECURITY DEFINER owned by
the table owner, granted to the service role (the cron route calls it), with
**no parameter that chooses what to delete**: a compromised service key can
only make it purge what is already past its deadline.

1. `set_config('seller.retention_purge', 'on', true)` (transaction-local).
2. For up to `p_limit` (seller, class) pairs with `relationship_ended_at` set,
   no live `legal_hold_until`, `seller_retention_deadline(...) <= now()` and
   no purge row yet: delete that class's rows table by table (list in 4.1;
   for `seller_addresses` by kind; for `seller_field_changes` by
   `retention_class`; vault rows with the `dac7` class), each as
   `with d as (delete ... returning *) select count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(d)::text, '' order by to_jsonb(d)::text), ''), 'UTF8')), 'hex') from d`.
3. Insert one `seller_retention_purges` row per (seller, class): `seller_id`,
   `class`, `deadline`, `purged_at`, `row_counts jsonb` (table to count),
   `rows_digest` (SHA-256 of the deleted rows' canonical JSON). The digest
   proves which content existed and was deleted without keeping it (it cannot
   be inverted: each row includes random uuids and timestamps).
4. When all four seller classes are purged, delete the anchor (the cascade
   removes any remainder, with the setting still on) and record a final
   `anchor` purge row.
5. Per-row clocks of 4.1 (old periods, superseded values, old access-log rows,
   expired blocks, superseded sanctions-list entries after 30 days).
6. Returns counts only (`{"purged": n, "more": bool}`), printed by the
   workflow like the other scheduled jobs.

`seller_retention_purges` is append-only (the same guard), service-role select
only, kept indefinitely (a pseudonymous uuid, a class, counts and a digest;
owner decision). Monitor class `ob_retention_overdue` (deadline passed more
than 7 days ago, rows still present, no hold) alerts if the job stops.
Scheduled as job `seller-retention` in `Store/.github/workflows/scheduled.yml`
after `account-deletions`.

### 4.8 The re-registration block (stage 2, file 10)

```sql
create table if not exists public.seller_reregistration_blocks (
  id                 uuid primary key default gen_random_uuid(),
  fingerprint        text not null,
  fingerprint_key_id text not null,
  kind               text not null,
  reason             text not null,
  source_seller_id   uuid,             -- no FK: outlives the seller and the anchor
  created_at         timestamptz not null default now(),
  block_until        timestamptz not null,
  lifted_at          timestamptz,
  lifted_by          uuid,
  lift_reason        text,
  constraint rereg_fp check (fingerprint ~ '^[0-9a-f]{64}$' and fingerprint_key_id ~ '^[a-z0-9]{1,16}$'),
  constraint rereg_kind check (kind in ('tax_id', 'vat_id', 'registration', 'email', 'phone', 'payout')),
  constraint rereg_reason check (reason in ('dac7_non_cooperation', 'sanctions_confirmed')),
  constraint rereg_lift check ((lifted_at is null) = (lifted_by is null) and (lifted_at is null) = (lift_reason is null)),
  unique (fingerprint, kind, reason, source_seller_id)
);
create index if not exists rereg_active_idx on public.seller_reregistration_blocks (fingerprint) where lifted_at is null;
```

Written by the DAC7 enforcement trigger (copies the stored fingerprints of the
seller's current tax IDs, VAT IDs, registrations and payout rows; `block_until
= now() + blocklist months`), and by the application for contact
fingerprints (email, phone) which the database cannot compute. Only
`lifted_*` may change, once; deletion only by the purge after `block_until`.
Read by `seller_reregistration_match(p_fingerprints text[])` (INVOKER, service
role) at every onboarding save; a match makes the app write
`reregistration_blocked`. Holds only HMACs: the identifiers themselves are
purged with their classes.

### 4.9 Changes to the existing deletion job

| Where | Change |
|---|---|
| `Store/src/lib/account-deletion/run.ts:300-318` (between `removeAvatar` and `admin.auth.admin.deleteUser`) | New step: `await admin.rpc("seller_relationship_end", { p_seller: userId, p_reason: "account_deleted", p_tz: DAC7_PERIOD_TZ })`; on error throw `new DeletionStepError("retain", ...)`. Fail closed: `recordFailure` (`:329-337`) stores the step and alerts once; the account rests and is retried (`policy.ts:36`). Never call `deleteUser` without it. Idempotent, so a retried run is safe. |
| `run.ts:8-13` | Header: the sign-in account takes the CASCADE world with it; seller records in `seller_*` are retained per class and purged by the retention job. |
| `run.ts:32-39` "WHAT IS LEFT BEHIND" | Add the retained seller records, frozen totals and order extracts. |
| `Store/src/lib/account-deletion/policy.ts:20-28` holds | No new hold: the freeze makes waiting unnecessary. (An open sanctions review or DAC7 request does not hold a deletion; its evidence is retained.) |
| `Store/src/lib/account-deletion/emails.ts` and the Settings outlook | Copy: what is kept and for how long (lawyer's text). |
| Memory rule "a new table that hangs off a user must cascade from auth.users" (account-deletion note) | Deliberate exception for `seller_*`: the retention job, not the cascade, removes them. |

### 4.10 What happens to the 15 legacy profiles' old columns

Untouched by any 1B file: `profiles` keeps cascading at deletion as today. The
backfilled copies in `seller_*` follow their classes.

### 4.11 Values the lawyer and the tax adviser set (all configuration)

`seller_retention_rules` rows (4.1); `year_tz` of `dac7` and `p_tz` of the
period functions (tax adviser); whether refunds go to the sale's or the
refund's quarter (one line in 4.5); `market_threshold_rules` parameters
(section 7); the app's `REVERIFY_MONTHS` (36) and `RECONFIRM_MONTHS` (12);
`seller_dac7_wait_days()` (60); declaration texts and versions; whether the
IP address is stored in declarations at all (drop `ip_address`, keep
`ip_country`, is a one-line app change).

---

## 5. Completion status and the gates

### 5.1 `market_countries` (file 04): per-country onboarding rules

P1b 10.4 suggested exactly this second table. Mirror of the TypeScript market
module (`MARKET.countries` or similar), written by migrations only.

```sql
create table if not exists public.market_countries (
  country_code            text primary key,
  onboarding_gate         text not null,      -- 'report': seller_sell_block ignores 1B reasons; 'enforce'
  private_sellers_allowed boolean not null,   -- ALLOW_PRIVATE_SELLERS (owner)
  payments_required       boolean not null,   -- charges_enabled needed to publish (owner; false while Connect is off)
  stale_checks            text not null,      -- expired verification / overdue reconfirmation: 'warn' or 'block'
  updated_at              timestamptz not null default now(),
  constraint market_countries_code check (country_code ~ '^[A-Z]{2}$'),
  constraint market_countries_gate check (onboarding_gate in ('report', 'enforce')),
  constraint market_countries_stale check (stale_checks in ('warn', 'block'))
);
-- CANONICAL FORM: one statement per migration, all rows, this column order.
insert into public.market_countries as m
  (country_code, onboarding_gate, private_sellers_allowed, payments_required, stale_checks)
values ('CZ', 'report', false, false, 'warn')
on conflict (country_code) do update
   set onboarding_gate = excluded.onboarding_gate,
       private_sellers_allowed = excluded.private_sellers_allowed,
       payments_required = excluded.payments_required,
       stale_checks = excluded.stale_checks,
       updated_at = now();
alter table public.market_countries enable row level security;
revoke all on table public.market_countries from public, anon, authenticated, service_role;
grant select on table public.market_countries to service_role;
```

Drift: the unit test reads the LAST canonical upsert and compares with the TS
module; the db test reads the table; a third assertion requires every
`market_countries` code to be in P1b's `market_rules.seller_countries`.

### 5.2 `seller_onboarding_status` (file 04)

```sql
create table if not exists public.seller_onboarding_status (
  seller_id           uuid primary key references public.seller_records (seller_id) on delete cascade,
  state               text not null,
  blocking_reasons    text[] not null default '{}',
  missing_fields      text[] not null default '{}',  -- the app's field ids, for the UI; shape only (list lives in the app)
  verification_state  text not null default 'none',
  sanctions_state     text not null default 'not_screened',
  payments_ready      boolean not null default false,
  payments_checked_at timestamptz,
  reverify_due_at     timestamptz,
  reconfirm_due_at    timestamptz,
  spec_version        text not null,                 -- which field specification computed the row
  computed_at         timestamptz not null default now(),
  complete_since      timestamptz,
  grace_until         timestamptz,                   -- existing-seller deadline; owned by migrations and staff
  grace_reason        text,
  constraint onboarding_state check (state in ('not_started', 'in_progress', 'awaiting_checks', 'complete', 'blocked')),
  constraint onboarding_complete_clean check (state <> 'complete' or cardinality(blocking_reasons) = 0),
  constraint onboarding_missing_fields check (
    cardinality(missing_fields) <= 64
    and array_position(missing_fields, null) is null
    and array_to_string(missing_fields, ',') ~ '^([a-z0-9_.]{1,48}(,[a-z0-9_.]{1,48})*)?$'),
  constraint onboarding_verification check (verification_state in ('none', 'pending', 'verified', 'failed', 'expired')),
  constraint onboarding_sanctions check (sanctions_state in
    ('not_screened', 'clear', 'in_review', 'confirmed_match', 'error')),
  constraint onboarding_spec check (spec_version ~ '^[a-z0-9_.@-]{1,40}$'),
  constraint onboarding_grace check (
    (grace_until is null) = (grace_reason is null)
    and (grace_reason is null or grace_reason in ('existing_seller', 'staff_extension')))
);

-- The reason vocabulary: a literal list (order = priority), used by the CHECK
-- and by seller_sell_block. MIRROR of the app's SELLER_BLOCK_REASONS: edit both.
create or replace function public.seller_block_reason_codes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'sanctions_confirmed',
    'reregistration_blocked',
    'dac7_non_cooperation',
    'sanctions_review',
    'trader_status_not_allowed',
    'verification_failed',
    'sanctions_not_screened',
    'details_missing',
    'details_to_confirm',
    'declarations_missing',
    'verification_pending',
    'verification_expired',
    'reconfirm_overdue',
    'payments_not_ready'
  ]::text[]
$$;

-- Reasons an existing seller's grace period covers. MIRROR of GRACEABLE_BLOCK_REASONS.
create or replace function public.seller_block_reason_graceable(p_reason text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_reason = any (array[
    'sanctions_not_screened',
    'details_missing',
    'details_to_confirm',
    'declarations_missing',
    'verification_pending',
    'verification_expired',
    'reconfirm_overdue'
  ]::text[])
$$;

-- A CHECK calls functions with the WRITER's privileges (the username_is_reserved
-- precedent, 20261021_reserved_usernames.sql:60-72).
revoke execute on function public.seller_block_reason_codes() from public, anon, authenticated;
grant execute on function public.seller_block_reason_codes() to service_role;
revoke execute on function public.seller_block_reason_graceable(text) from public, anon, authenticated, service_role;

alter table public.seller_onboarding_status
  drop constraint if exists seller_onboarding_status_reasons_known;
alter table public.seller_onboarding_status
  add constraint seller_onboarding_status_reasons_known
  check (blocking_reasons <@ public.seller_block_reason_codes());

alter table public.seller_onboarding_status enable row level security;
revoke all on table public.seller_onboarding_status from public, anon, authenticated, service_role;
grant select on table public.seller_onboarding_status to authenticated;
grant select, insert, update, delete on table public.seller_onboarding_status to service_role;
create policy seller_onboarding_status_owner_read on public.seller_onboarding_status
  for select to authenticated using ((select auth.uid()) = seller_id);   -- agent JWTs allowed: codes only
create policy "Require two-factor when enrolled" on public.seller_onboarding_status
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok())) with check ((select public.mfa_session_ok()));
```

### 5.3 The reason vocabulary and its drift test

| Code (priority order) | Meaning | Graceable | Skipped when |
|---|---|---|---|
| `sanctions_confirmed` | a reviewer confirmed a match | never | never |
| `reregistration_blocked` | fingerprints match a blocked seller | never | never |
| `dac7_non_cooperation` | DAC7 closure enforced | never | never |
| `sanctions_review` | potential match awaiting a reviewer | never | never |
| `trader_status_not_allowed` | private seller where the market allows none | never | never |
| `verification_failed` | VIES invalid, ARES not found / name mismatch rejected | never | never |
| `sanctions_not_screened` | no screen for the current name / DOB | yes | grace |
| `details_missing` | a required field is absent (also: no status row) | yes | grace |
| `details_to_confirm` | backfilled values not yet confirmed | yes | grace |
| `declarations_missing` | a current declaration version not accepted | yes | grace |
| `verification_pending` | a check not yet done or unavailable | yes | grace |
| `verification_expired` | a verification older than 36 months | yes | grace, or `stale_checks = 'warn'` |
| `reconfirm_overdue` | yearly "confirm your details" not done | yes | grace, or `stale_checks = 'warn'` |
| `payments_not_ready` | `checkoutProviderFor` finds no provider | n/a | `payments_required = false` |

The application architect owns the canonical list; this is my proposal.
**Drift test** (unit, `Store/tests/unit/seller-gate-reasons-sql.test.ts`, the
`RESERVED_USERNAMES` / `ORDER_CHANNELS` pattern of
`Store/tests/unit/order-channel.test.ts:82-102`): read the replica, take the
LAST `create or replace function public.seller_block_reason_codes()` body,
extract the `'...'` literals in order, `toEqual` the TS list (order is
priority); same for `seller_block_reason_graceable`; second assertion that the
last definitions across `supabase/migrations/*.sql` equal the replica's; and
a db test (`63-seller-gate`) that `select public.seller_block_reason_codes()`
equals the TS list. Same pattern for `sanctions_state` and
`verification_state` vocabularies.

### 5.4 The new body of `seller_sell_block` (file 04)

Replaces P1b's (P1b 1.3, P1b lines 284-310) with its two checks unchanged and
one 1B block added. Same signature, so P1b's guards and monitor call it
unchanged and raise `seller_blocked:<reason>`.

```sql
create or replace function public.seller_sell_block(p_seller uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_country text := public.market_seller_country(p_seller);
  v_gate    text;
  v_pay     boolean;
  v_stale   text;
  v_status  public.seller_onboarding_status%rowtype;
  v_graced  boolean;
  v_reason  text;
begin
  -- P1b, unchanged: established in an allowed country; an enabled account in that country.
  if v_country is null or not public.market_allows('seller_country', v_country) then
    return 'seller_country';
  end if;
  if exists (select 1 from public.seller_payment_accounts a
              where a.owner_id = p_seller and a.charges_enabled and a.country is distinct from v_country) then
    return 'account_country';
  end if;

  -- 1B: the market's onboarding rule. An allowed country with no row fails closed.
  select c.onboarding_gate, c.payments_required, c.stale_checks
    into v_gate, v_pay, v_stale
    from public.market_countries c where c.country_code = v_country;
  if not found then
    v_gate := 'enforce'; v_pay := false; v_stale := 'warn';
  end if;
  if v_gate = 'report' then
    return null;
  end if;

  -- The application's verdict, read as data. SQL implements no field rule.
  select * into v_status from public.seller_onboarding_status s where s.seller_id = p_seller;
  if not found then
    return 'details_missing';
  end if;
  v_graced := v_status.grace_until is not null and v_status.grace_until > now();
  foreach v_reason in array public.seller_block_reason_codes() loop
    continue when not (v_reason = any (v_status.blocking_reasons));
    continue when v_reason = 'payments_not_ready' and not v_pay;
    continue when v_reason in ('verification_expired', 'reconfirm_overdue') and v_stale = 'warn';
    continue when v_graced and public.seller_block_reason_graceable(v_reason);
    return v_reason;
  end loop;
  -- Not complete, yet no reason named: a broken row, fail closed.
  if v_status.state <> 'complete' and cardinality(v_status.blocking_reasons) = 0 then
    return 'details_missing';
  end if;
  return null;
end
$$;
-- Grants restated (P1b 1.3): revoke from public, anon, authenticated; grant to service_role.
```

### 5.5 The switch of `market_seller_country` (file 04)

```sql
-- THE seller's country of establishment. A seller with a primary-address row
-- is established where that row says (even null: no fallback for them, so a
-- REST-written tax_country cannot stand in). A seller without one (an account
-- that has never used the new form) falls back to profiles.tax_country, which
-- the backfill also copied into the primary row. The fallback is removed by the
-- later, separately approved cleanup.
create or replace function public.market_seller_country(p_seller uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.seller_addresses a where a.seller_id = p_seller and a.kind = 'primary')
      then (select a.country from public.seller_addresses a where a.seller_id = p_seller and a.kind = 'primary')
    else (select p.tax_country from public.profiles p where p.id = p_seller)
  end
$$;
-- Grants restated: revoke from public, anon, authenticated; grant to service_role.
```

Order without a window where a seller has no country:

1. File 04 installs the body above. At that moment no primary row exists, so
   every seller resolves exactly as before (fallback). No window.
2. File 05 (backfill) creates a primary row for every profile with a
   `tax_country` or `seller_address`, copying `tax_country` into `country`.
   Each seller resolves to the same country before and after their row
   appears. Profiles with neither keep resolving through the fallback (null
   today, as before).
3. File 06 mirrors the primary country back into `tax_country` (market
   countries only, 8.2), so the TypeScript accessor (still reading
   `tax_country` until it switches, P1a 10.1) agrees with the database.
4. The TS release switches `establishmentCountryOf` to the primary row.
5. Cleanup (separate approval): drop the fallback branch.

P1b's guard (e) and monitor reach the new source automatically: both call
`market_seller_country` (P1b 3e, 6.2).

Also in file 04 (with the guard (a) logic moved onto the new column): a
`country_locked` guard on `seller_addresses` (BEFORE INSERT WHEN `kind =
'primary'`; BEFORE UPDATE OF country WHEN `kind = 'primary' and old.country is
distinct from new.country`): a charges-enabled payment account in another
country refuses the change with `market_rule:country_locked`
(`market_refuse`, P1b 3.0). No `seller_country` refusal on save (interface
note 9).

### 5.6 Hard stops written by the database (file 04, extended in 10)

```sql
create or replace function public.seller_status_hard_stop(p_seller uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.seller_onboarding_status (seller_id, state, blocking_reasons, spec_version, computed_at)
  values (p_seller, 'blocked', array[p_reason], 'db_hard_stop', now())
  on conflict (seller_id) do update
     set state = 'blocked',
         blocking_reasons = array_append(array_remove(public.seller_onboarding_status.blocking_reasons, p_reason), p_reason),
         complete_since = null,
         computed_at = now()
$$;
revoke execute on function public.seller_status_hard_stop(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.seller_sanctions_review_effect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.decision = 'confirmed_match' then
    perform public.seller_status_hard_stop(new.seller_id, 'sanctions_confirmed');
  end if;
  return null;
end
$$;
revoke execute on function public.seller_sanctions_review_effect() from public, anon, authenticated, service_role;
create trigger seller_sanctions_review_effect after insert on public.seller_sanctions_reviews
  for each row execute function public.seller_sanctions_review_effect();
```

Why the database writes the app's row here: a confirmed match and an enforced
DAC7 closure are legal actions that must take effect atomically with the
record of them. The application's next recompute writes the same reason (it
reads the same facts), so the two never fight. Stage 2 file 10 adds the DAC7
`enforced` event trigger (section 6.4).

### 5.7 Monitor classes added to P1b's catalogue

File 04 restates `market_rule_classes()` and `market_rule_violation_rows()`
(P1b 6.2: "adding a class is one catalogue row plus one union branch, same
signatures, CREATE OR REPLACE") with these rows and branches; ids and codes
only, never personal data.

| Rule | Class | Alerts | Sort | Detects (detail) |
|---|---|---|---|---|
| OB | `ob_complete_but_missing` | true | 70 | status says complete while an obviously required column is empty (detail = which presence check) |
| OB | `ob_status_missing` | true | 71 | a seller with live products and no status row |
| OB | `ob_status_stale` | true | 72 | a source table changed more than 15 minutes after `computed_at` (detail = table) |
| OB | `ob_sanctions_waiting` | true | 73 | a potential match without a decisive review for more than 2 days |
| OB | `ob_hard_stop_missing` | true | 74 | a confirmed match (stage 2: an enforced DAC7 closure) whose status lacks the reason |
| OB | `ob_sealed_pointer_missing` | false | 75 | a current tax-ID row (not `not_issued`) without a sealed value after 1 hour |
| OB | `ob_guard_missing` | true | 76 | one of 1B's guard triggers missing or disabled (append-only, value guards, legacy guard after 08, country lock) |
| stage 2 | `ob_dac7_overdue`, `ob_retention_overdue`, `ob_sealed_old_keys` (false), `gpsr_live_physical_without_safety` (false) | | 77-80 | |

The cheap sanity check, as a branch of `market_rule_violation_rows()`:

```sql
  union all
  select 'ob_complete_but_missing', s.seller_id::text, m.code
    from public.seller_onboarding_status s
    left join public.seller_identities i on i.seller_id = s.seller_id
    left join public.seller_contacts c on c.seller_id = s.seller_id
    left join public.seller_addresses a on a.seller_id = s.seller_id and a.kind = 'primary'
    left join public.market_countries mc on mc.country_code = a.country
    cross join lateral (values
      ('identity_row',    i.seller_id is null),
      ('seller_type',     i.seller_type is null),
      ('trader_status',   i.trader_status is null),
      ('legal_name',      i.seller_type = 'individual' and (i.legal_first_name is null or i.legal_last_name is null)),
      ('dob',             i.seller_type = 'individual' and i.dob_sealed_id is null),
      ('company_name',    i.seller_type = 'company' and i.legal_company_name is null),
      ('registration',    i.seller_type = 'company' and not exists (
                            select 1 from public.seller_registrations r
                             where r.seller_id = s.seller_id and r.superseded_at is null)),
      ('primary_address', a.seller_id is null or a.line1 is null or a.city is null),
      ('primary_country', a.country is null),
      ('email',           c.primary_email is null),
      ('phone',           c.primary_phone is null),
      ('tax_id',          not exists (select 1 from public.seller_tax_ids t
                                       where t.seller_id = s.seller_id and t.superseded_at is null)),
      ('terms',           not exists (select 1 from public.seller_declarations d
                                       where d.seller_id = s.seller_id and d.kind = 'seller_terms')),
      ('private_not_allowed', i.trader_status = 'private' and coalesce(mc.private_sellers_allowed, false) = false),
      ('sanctions',       s.sanctions_state <> 'clear'),
      ('verification',    s.verification_state <> 'verified')
    ) as m(code, missing)
   where s.state = 'complete' and m.missing
```

(A null `missing` from a missing identity row is filtered; `identity_row`
reports it.) It is a presence check on columns, not a second implementation of
the field rules: it cannot tell a malformed TIN from a good one, only that
"complete" was claimed with a hole.

Rollout: file 09 captures the OB classes' existing rows as legacy with
`market_rule_baseline_capture(array['ob_status_missing', ...])` (P1b 6.2) after
the rehearsal shows the expected counts; `r1_live_seller_blocked` keys on the
reason (P1b 10.3), so new 1B reasons on an existing live seller show as new
until that capture.

### 5.8 What each file does to the four existing accounts on the day

Facts (2026-11-22): 15 profiles, 4 own content (apparently internal or test),
none with a proven contact, 3 with no Terms, 2 with live physical products
without a safety block; countries CZ 2, IE 1, null 12 across all profiles.

| File | On the day | Afterwards |
|---|---|---|
| 01 to 03 | new empty tables, no row touched | nothing changes for anyone |
| 04 | `market_countries` CZ = `report`; `seller_sell_block` returns the same answers as before (1B block returns null in report mode); `market_seller_country` resolves through the fallback exactly as before | sellers outside the market or without a country stay blocked by P1b's `seller_country`; nobody gains or loses anything |
| 05 | anchors for all 15 profiles; copies of trading name, address text + country, contacts, VAT, Terms acceptances; status rows `in_progress` / `details_missing`; nothing on `profiles` changes | still report mode: no effect on selling |
| 06 | mirror installed; it fires only on later writes and writes only differing values | old-form saves keep working until the TS deploy |
| 07 | `orders.paid_at` column (null on all 1,239 orders), totals tables empty | new paid orders get `paid_at`; deletions freeze totals (none of the 4 has a Stripe payment) |
| 08 (after the TS deploy) | client REST writes of the seven legacy columns refused | the new form and the mirror are the only writers |
| 09 enforce | CZ = `enforce`; `grace_until = now() + 60 days` (owner's decision) for every seller with content whose status is not complete; baseline capture | during grace the graceable reasons are skipped, so the CZ sellers keep publishing and selling exactly as today; sellers already blocked by `seller_country` stay blocked. After the deadline, publish and new orders are refused by the database for anyone still incomplete; live listings stay `active` in the database (nothing disabled or deleted); the TS read side hides them and the monitor reports them. Whether the app then moves them to draft is an owner decision. |

The existing-seller grace period is data: `grace_until` + `grace_reason =
'existing_seller'`, set by file 09 (or staff for an extension), never by the
app's status writer. The app honours it in its own gate (same graceable list),
in the attention row ("complete your profile by <date>"), and in reminders.

The existing-seller gap report becomes a read-only query over the status rows
(seller id, handle, state, reasons, `missing_fields`, `grace_until`): no
personal data.

---

## 6. Verification log, sanctions screening, change history

### 6.1 The verification log: references, expiry, invalidation

DDL in 1.6. What `reference` and `evidence` hold per method:

| Method | `reference` | `evidence` (never a sealed value) |
|---|---|---|
| `vies` | the consultation number (`requestIdentifier`) when the request carried our own VAT number; null today (the operator is not VAT-registered, G 4.1) | `requestDate`, `valid`, country code, number (public), `traderNameMatch` / `traderAddressMatch` flags, returned name and address if any, `response_sha256` |
| `ares` | `ares:<ICO>:<datumAktualizace>` | `obchodniJmeno`, `pravniForma`, `datumZaniku` (null = active), name match score and outcome, `response_sha256` |
| `format` | validator id and version, e.g. `cz.rodne_cislo@1` | which checks ran (`length`, `checksum`, `date`) |
| `code` | `code:<channel>:<issued_at>` (the code row itself is deleted on reissue, `20260926_contact_verification.sql:170-177`, so its id is not durable) | channel |
| `manual` | staff id + ticket | what was seen (e.g. "trade licence extract"), never a copy of a document (no ID scans) |
| `stripe` | `acct_...` + requirement status | `business_type`, name cross-check outcome |

**Expiry as data:** `expires_at = checked_at + REVERIFY_MONTHS` (36),
written by the app; `seller_onboarding_status.reverify_due_at` is the earliest
expiry among required verifications; `reconfirm_due_at` = last
`details_confirmation` declaration + 12 months. A staff "doubt" is a new row
with `result = 'revoked'`, which supersedes earlier passes for that subject.

**How a change invalidates earlier verification, three layers:**

1. Supersede-only rows: a changed tax ID, VAT ID or registration is a new row
   with a new id; verifications name the old `subject_ref`, so they do not
   apply to the new row. The value guard (1.4) refuses editing a value in
   place, so this cannot be bypassed.
2. Value fingerprint: every verification stores `subject_fingerprint` (HMAC of
   the value verified). The app counts a verification only if it equals the
   current value's fingerprint, so a name change (identity rows are mutable)
   un-verifies the name without any update to the log.
3. The change trigger records the change; the app recomputes the status
   (`verification_pending`), and monitor `ob_status_stale` catches a forgotten
   recompute.

### 6.2 Sanctions screening

* **Results** live in `seller_sanctions_screens` and decisions in
  `seller_sanctions_reviews` (1.6), both append-only, service-role only.
  Current state = latest screen whose `subject_fingerprint` equals the current
  (names, DOB, country) tuple; if `potential_match`, the latest decisive
  review. A changed name or DOB has a new fingerprint, so it reads
  `not_screened` until re-screened.
* **The review queue** is a query: potential-match screens with no
  `false_positive` / `confirmed_match` review, oldest first. Admin shows it
  with a logged `sanctions_review` access; a decision inserts a review row;
  `confirmed_match` fires the hard stop (5.6) and, in stage 2, a blocklist row.
  `ob_sanctions_waiting` alerts after 2 days.
* **The list itself (stage 2, file 11)** is ingested, not queried live:

```sql
create table if not exists public.sanctions_list_versions (
  id           uuid primary key default gen_random_uuid(),
  list_code    text not null check (list_code in ('eu_fsf', 'ofac_sdn', 'un_sc')),
  published_at timestamptz,
  fetched_at   timestamptz not null default now(),
  file_sha256  text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  entry_count  integer check (entry_count >= 0),
  status       text not null default 'loading' check (status in ('loading', 'active', 'superseded', 'failed')),
  activated_at timestamptz,
  superseded_at timestamptz
);
create unique index if not exists sanctions_list_active_uq on public.sanctions_list_versions (list_code) where status = 'active';

create table if not exists public.sanctions_list_entries (
  id           bigint generated always as identity primary key,
  version_id   uuid not null references public.sanctions_list_versions (id) on delete cascade,
  entry_ref    text not null check (char_length(entry_ref) between 1 and 100),   -- EU logical id
  subject_type text not null check (subject_type in ('person', 'entity')),
  birth_dates  text[] not null default '{}',   -- 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD'
  countries    text[] not null default '{}',
  programmes   text[] not null default '{}',
  unique (version_id, entry_ref)
);

create table if not exists public.sanctions_list_names (
  entry_id        bigint not null references public.sanctions_list_entries (id) on delete cascade,
  version_id      uuid not null,
  name_normalized text not null check (char_length(name_normalized) between 1 and 300),
  is_primary      boolean not null default false
);
create index if not exists sanctions_names_trgm_idx on public.sanctions_list_names using gin (name_normalized gin_trgm_ops);
```

  A scheduled GitHub Action downloads the official FSF file (token as a repo
  secret, never logged), normalises it and posts batches to a cron route that
  writes a `loading` version; `sanctions_list_activate(version)` flips it to
  `active` and the previous one to `superseded` in one transaction; then a
  re-screen job screens every active seller against the new version. Matching:
  `sanctions_candidates(p_names text[], p_threshold real, p_limit int)`
  (INVOKER, service role) returns entry refs and trigram scores from the active
  version; the APP adjusts by birth date and country (it alone can open the
  sealed DOB) and writes the screen row. `pg_trgm` is installed
  (`Replica:1214`); its schema in production (public or extensions) must be
  read live, and the function uses `set search_path = pg_catalog, public,
  extensions` (a fixed list; a missing schema is ignored). Superseded entries
  are deleted 30 days after supersession; version rows (hash, dates) are kept as
  evidence for the screens that cite them.
* **Minimum honest stage 1:** a MANUAL screen per seller by a named staff
  reviewer, before the gate lets the seller publish, against the official EU
  Financial Sanctions Files (the Commission's consolidated list download or its
  search), recorded as a screen row with `method = 'manual'`, `list_code =
  'eu_fsf'`, the list's publication date as seen, `list_reference` (the file's
  sha256 if downloaded, or what was searched), the result and `performed_by`.
  A potential match follows the same review path. Re-screen: every active
  seller monthly and on every name / DOB change (manual), tracked as a recurring
  owner task. This is "screened at onboarding and periodically", not
  "continuously"; say so in any statement made about it. With a handful of
  beta sellers it is feasible; past roughly 20 sellers stage 2 is due.

### 6.3 Change history: what it stores, and why never a sealed value

Written only by `seller_capture_change()` (1.4), so no write can skip it. Per
changed column: who (`updated_by` / `updated_via` of the row, plus the database
role), when, table, row, field, insert/update/delete, and:

* clear fields: old and new values in clear (as personal as the field itself;
  the row's `retention_class` is the field's class, so history never outlives
  the data it describes);
* sealed fields: the field IS a pointer, so old and new are VAULT IDS. The old
  value stays revealable (logged) for as long as its vault row is retained
  (superseded, not deleted), and the plaintext never enters the history table,
  a log or a backup;
* fingerprints and hints are recorded as such (`value_kind`), which also shows
  whether a re-seal changed the value (same fingerprint) or not.

### 6.4 The DAC7 non-cooperation record (stage 2, file 10)

The specification: a request, reminder 1, reminder 2; not before 60 days after
the request, block selling and prevent re-registration. The database holds the
trail and refuses an enforcement that comes too early or without both
reminders, whoever asks (the service role included).

```sql
-- MIRROR of the app's DAC7_ENFORCE_AFTER_DAYS (lawyer / tax adviser); drift-tested.
create or replace function public.seller_dac7_wait_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 60 $$;
revoke execute on function public.seller_dac7_wait_days() from public, anon, authenticated, service_role;

create table if not exists public.seller_dac7_requests (
  id                 uuid primary key default gen_random_uuid(),
  seller_id          uuid not null references public.seller_records (seller_id) on delete cascade,
  opened_at          timestamptz not null default now(),
  reason             text not null,
  requested_fields   text[] not null,
  enforce_not_before timestamptz not null,
  state              text not null default 'open',
  closed_at          timestamptz,
  constraint dac7_requests_reason check (reason in ('missing', 'invalid', 'reverification')),
  constraint dac7_requests_fields check (
    cardinality(requested_fields) between 1 and 30
    and array_position(requested_fields, null) is null
    and array_to_string(requested_fields, ',') ~ '^[a-z0-9_.]{1,48}(,[a-z0-9_.]{1,48})*$'),
  constraint dac7_requests_state check (state in ('open', 'satisfied', 'enforced', 'withdrawn', 'lifted'))
);
create unique index if not exists dac7_requests_open_uq on public.seller_dac7_requests (seller_id) where state = 'open';

-- The server's clock and the configured wait, whatever the caller sent.
-- SECURITY DEFINER so it may call seller_dac7_wait_days(), which no API role can.
create or replace function public.seller_dac7_request_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.opened_at := now();
  new.enforce_not_before := new.opened_at + make_interval(days => public.seller_dac7_wait_days());
  new.state := 'open';
  new.closed_at := null;
  return new;
end
$$;
revoke execute on function public.seller_dac7_request_stamp() from public, anon, authenticated, service_role;
create trigger seller_dac7_request_stamp before insert on public.seller_dac7_requests
  for each row execute function public.seller_dac7_request_stamp();

create table if not exists public.seller_dac7_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.seller_dac7_requests (id) on delete cascade,
  seller_id   uuid not null references public.seller_records (seller_id) on delete cascade,
  step        text not null,
  occurred_at timestamptz not null default now(),
  channel     text not null,
  message_ref text,           -- the mail provider's id; never the message text
  actor_kind  text not null,
  actor_id    uuid,
  note        text,
  constraint dac7_events_step check (step in
    ('request', 'reminder_1', 'reminder_2', 'satisfied', 'enforced', 'withdrawn', 'lifted')),
  constraint dac7_events_channel check (channel in ('email', 'dashboard', 'email_and_dashboard', 'none')),
  constraint dac7_events_ref check (message_ref is null or char_length(message_ref) <= 200),
  constraint dac7_events_actor check (actor_kind in ('system', 'staff') and (actor_kind = 'system' or actor_id is not null)),
  constraint dac7_events_note check (note is null or char_length(note) <= 500)
);
create index if not exists dac7_events_request_idx on public.seller_dac7_events (request_id, occurred_at);

create or replace function public.seller_dac7_event_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.seller_dac7_requests%rowtype;
  v_has text[];
begin
  select * into r from public.seller_dac7_requests q where q.id = new.request_id for update;
  if not found or r.seller_id <> new.seller_id then
    raise exception 'dac7:request' using errcode = '23503';
  end if;
  new.occurred_at := now();
  select coalesce(array_agg(e.step), '{}') into v_has from public.seller_dac7_events e where e.request_id = r.id;
  if new.step = any (v_has) then
    raise exception 'dac7:repeated:%', new.step using errcode = '23514';
  end if;
  if new.step = 'request' then
    if cardinality(v_has) > 0 then raise exception 'dac7:order' using errcode = '23514'; end if;
  elsif new.step = 'lifted' then
    if r.state <> 'enforced' then raise exception 'dac7:not_enforced' using errcode = '23514'; end if;
  elsif r.state <> 'open' then
    raise exception 'dac7:closed' using errcode = '23514';
  elsif new.step = 'reminder_1' and not ('request' = any (v_has)) then
    raise exception 'dac7:order' using errcode = '23514';
  elsif new.step = 'reminder_2' and not ('reminder_1' = any (v_has)) then
    raise exception 'dac7:order' using errcode = '23514';
  elsif new.step = 'enforced'
        and (not ('reminder_2' = any (v_has)) or now() < r.enforce_not_before) then
    raise exception 'dac7:not_yet' using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function public.seller_dac7_event_effect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.step in ('satisfied', 'enforced', 'withdrawn', 'lifted') then
    update public.seller_dac7_requests q
       set state = new.step, closed_at = coalesce(q.closed_at, now())
     where q.id = new.request_id;
  end if;
  if new.step = 'enforced' then
    perform public.seller_status_hard_stop(new.seller_id, 'dac7_non_cooperation');
    insert into public.seller_reregistration_blocks
      (fingerprint, fingerprint_key_id, kind, reason, source_seller_id, block_until)
    select f.fp, f.key_id, f.kind, 'dac7_non_cooperation', new.seller_id,
           now() + make_interval(months => (select r.keep_months from public.seller_retention_rules r
                                             where r.class = 'blocklist'))
      from (
        select t.fingerprint as fp, t.fingerprint_key_id as key_id, 'tax_id' as kind
          from public.seller_tax_ids t where t.seller_id = new.seller_id and t.superseded_at is null and t.fingerprint is not null
        union all
        select v.fingerprint, v.fingerprint_key_id, 'vat_id'
          from public.seller_vat_ids v where v.seller_id = new.seller_id and v.superseded_at is null and v.fingerprint is not null
        union all
        select g.fingerprint, g.fingerprint_key_id, 'registration'
          from public.seller_registrations g where g.seller_id = new.seller_id and g.superseded_at is null and g.fingerprint is not null
        union all
        select p.fingerprint, p.fingerprint_key_id, 'payout'
          from public.seller_payout_accounts p where p.seller_id = new.seller_id and p.superseded_at is null and p.fingerprint is not null
      ) f
    on conflict do nothing;
  elsif new.step = 'lifted' then
    update public.seller_reregistration_blocks b
       set lifted_at = now(), lifted_by = new.actor_id, lift_reason = 'dac7_lifted'
     where b.source_seller_id = new.seller_id and b.reason = 'dac7_non_cooperation' and b.lifted_at is null;
  end if;
  return null;
end
$$;
-- Both functions revoked from public, anon, authenticated, service_role.
create trigger seller_dac7_event_guard before insert on public.seller_dac7_events
  for each row execute function public.seller_dac7_event_guard();
create trigger seller_dac7_event_effect after insert on public.seller_dac7_events
  for each row execute function public.seller_dac7_event_effect();
-- seller_dac7_events: append-only triggers (1.2). seller_dac7_requests: the
-- service role holds select and insert only, so its state moves only through
-- the effect trigger (a definer). Both owner-readable (3.1 loop).
```

Notes. A `lifted` step requires a staff actor with a note (the app enforces
the reason; the check above enforces an actor). The application writes the
contact fingerprints (email, phone) into the blocklist at enforcement, and
recomputes the status after `satisfied` or `lifted` (dropping the hard-stop
reason). Whether enforcement also CLOSES the account (then staff calls
`seller_relationship_end(seller, 'dac7_closure')`) or only blocks selling is
an owner and lawyer decision; the record supports both. Monitor class
`ob_dac7_overdue` (advisory): an open request past `enforce_not_before` with
both reminders sent and no enforcement or satisfaction.

---

## 7. Threshold counters (stage 2, file 13)

Generic: one rules table mirrored from the application config, per-market
enablement through `applies_to` and `active`, counts computed on read from
`orders` (with `paid_at`), and a daily snapshot. **Not incremental**: an
incremental counter drifts with refunds, deletions, the expiry sweep and late
webhooks; on read is exact and cheap at this volume (index 4.4).

```sql
create table if not exists public.market_threshold_rules (
  id                     text primary key check (id ~ '^[a-z0-9_]{3,48}$'),
  scope                  text not null check (scope in ('seller', 'platform')),
  applies_to             text[] not null,       -- seller countries (seller scope) or buyer countries (platform)
  window_kind            text not null check (window_kind in ('rolling_12_months', 'calendar_year')),
  count_threshold        integer check (count_threshold > 0),
  amount_threshold_minor bigint check (amount_threshold_minor > 0),
  threshold_currency     text check (threshold_currency ~ '^[A-Z]{3}$'),
  crossing               text not null check (crossing in
                           ('count_and_amount_at_least', 'amount_at_least', 'excluded_if_count_below_and_amount_at_most', 'report_only')),
  sale_unit              text not null check (sale_unit in ('order', 'line')),
  statuses               text[] not null default array['paid', 'refunded', 'disputed'],
  net_of_refunds         boolean not null default false,
  dimension              text check (dimension in ('buyer_region')),
  time_basis             text not null default 'paid_at' check (time_basis in ('paid_at', 'created_at')),
  tz                     text not null default 'UTC',
  fx_basis               text not null default 'none' check (fx_basis in ('none', 'period_end_rate', 'transaction_date_rate')),
  active                 boolean not null default false,
  updated_at             timestamptz not null default now()
);
-- CANONICAL FORM (mirror of the app's THRESHOLD_RULES).
insert into public.market_threshold_rules as r
  (id, scope, applies_to, window_kind, count_threshold, amount_threshold_minor, threshold_currency,
   crossing, sale_unit, net_of_refunds, dimension, tz, fx_basis, active)
values
  ('dac7_small_seller',     'seller',   array['CZ'], 'calendar_year',      30,  200000,  'EUR',
   'excluded_if_count_below_and_amount_at_most', 'order', true,  null, 'Europe/Prague', 'period_end_rate', true),
  ('us_inform_high_volume', 'seller',   array['US'], 'rolling_12_months', 200,  500000,  'USD',
   'count_and_amount_at_least', 'order', false, null, 'UTC', 'none', false),
  ('us_inform_disclosure',  'seller',   array['US'], 'rolling_12_months', null, 2000000, 'USD',
   'amount_at_least', 'order', false, null, 'UTC', 'none', false),
  ('us_state_buyer_totals', 'platform', array['US'], 'calendar_year',     null, null,     null,
   'report_only', 'order', false, 'buyer_region', 'UTC', 'none', false)
on conflict (id) do update set
  scope = excluded.scope, applies_to = excluded.applies_to, window_kind = excluded.window_kind,
  count_threshold = excluded.count_threshold, amount_threshold_minor = excluded.amount_threshold_minor,
  threshold_currency = excluded.threshold_currency, crossing = excluded.crossing, sale_unit = excluded.sale_unit,
  net_of_refunds = excluded.net_of_refunds, dimension = excluded.dimension, tz = excluded.tz,
  fx_basis = excluded.fx_basis, active = excluded.active, updated_at = now();

create table if not exists public.seller_threshold_snapshots (
  id           uuid primary key default gen_random_uuid(),
  rule_id      text not null,
  seller_id    uuid references public.seller_records (seller_id) on delete cascade,  -- null for platform scope
  dimension    text,                       -- e.g. 'US-CA' for the platform rule
  window_start timestamptz not null,
  window_end   timestamptz not null,
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  sales_count  bigint not null,
  gross_minor  bigint not null,
  outcome      text not null check (outcome in ('below', 'crossed', 'excluded', 'not_excluded', 'needs_fx', 'report')),
  computed_at  timestamptz not null default now()
);

create table if not exists public.market_fx_rates (
  rate_date  date not null,
  base       text not null check (base ~ '^[A-Z]{3}$'),
  quote      text not null check (quote ~ '^[A-Z]{3}$'),
  rate       numeric(18, 8) not null check (rate > 0),
  source     text not null check (source in ('ecb', 'cnb', 'manual')),
  fetched_at timestamptz not null default now(),
  primary key (rate_date, base, quote, source)
);
```

`seller_threshold_compute(p_rule text, p_as_of timestamptz)` (INVOKER, service
role) returns per seller and currency `(sales_count, gross_minor, window_start,
window_end)` for active seller-scope rules: window from `window_kind` and `tz`;
orders with `status = any(statuses)`, `payment_ref like 'pi\_%'`,
`coalesce(paid_at, created_at)` in the window (or `created_at` if
`time_basis` says so), count of orders or lines per `sale_unit`, gross net of
refunds when asked; sellers filtered by `market_seller_country(seller) =
any(applies_to)` after grouping. The platform rule groups `ship_to ->>
'region'` where `ship_to ->> 'country' = any(applies_to)` (physical goods only:
no buyer billing address exists for downloads, G 8.2). The daily job (TS)
evaluates `crossing` with the FX rule (a CZK seller against the EUR 2,000 test
needs a rate; without one the outcome is `needs_fx`, never a guess), writes
snapshots, and raises an attention row and a staff alert on a crossing. The
three specification counters are the first three rows; the two US ones and the
platform one are inactive until the US market exists. Questions for the tax
adviser (all parameters above): what is "a sale" (order or line), which
timestamp and time zone, net or gross, the FX basis and rate source.

---

## 8. Backfill and coexistence

### 8.1 The backfill (file 05): additive, idempotent, re-runnable

Nothing is invented: a free-text address is carried as one unconfirmed line; a
business name is not split into legal names; a phone that is not E.164 or a
VAT ID that does not parse is NOT copied (it stays readable on `profiles`, and
the app lists it under `details_to_confirm`). Re-running refreshes only rows
still marked as backfill and unconfirmed, so the window between this file and
the TypeScript deploy (when the OLD form still writes `profiles`) is closed by
re-running it right before the deploy.

```sql
-- 1. Anchors for every profile (15 rows): cheap, and every later write needs one.
insert into public.seller_records (seller_id, created_at, relationship_started_at)
select p.id, p.created_at,
       (select min(t) from (
          select p.legal_accepted_at as t
          union all select min(x.created_at) from public.products x where x.owner_id = p.id
          union all select min(x.created_at) from public.storefronts x where x.owner_id = p.id
          union all select min(x.created_at) from public.orders x where x.seller_id = p.id) m)
  from public.profiles p
on conflict (seller_id) do nothing;

-- 2. Trading name, as published today.
insert into public.seller_trade_profiles (seller_id, trading_name, updated_via)
select p.id, p.tax_business_name, 'backfill'
  from public.profiles p
 where nullif(btrim(p.tax_business_name), '') is not null
on conflict (seller_id) do update
   set trading_name = excluded.trading_name, updated_at = now()
 where public.seller_trade_profiles.updated_via = 'backfill';

-- 3. Primary address: the free text as ONE unconfirmed line, with the declared country.
insert into public.seller_addresses (seller_id, kind, legacy_text, country, source, updated_via)
select p.id, 'primary', nullif(btrim(p.seller_address), ''), p.tax_country, 'backfill', 'backfill'
  from public.profiles p
 where nullif(btrim(p.seller_address), '') is not null or p.tax_country is not null
on conflict (seller_id, kind) do update
   set legacy_text = excluded.legacy_text, country = excluded.country, updated_at = now()
 where public.seller_addresses.source = 'backfill' and public.seller_addresses.confirmed_at is null;

-- The public address follows the primary one (what buyers see today).
insert into public.seller_addresses (seller_id, kind, follows, source, updated_via)
select a.seller_id, 'public', 'primary', 'backfill', 'backfill'
  from public.seller_addresses a where a.kind = 'primary'
on conflict (seller_id, kind) do nothing;

-- 4. Contacts that already pass the new shapes.
insert into public.seller_contacts (seller_id, primary_email, primary_phone, updated_via)
select p.id,
       case when char_length(p.seller_email) <= 254
             and p.seller_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then p.seller_email end,
       case when p.seller_phone ~ '^\+[1-9][0-9]{6,14}$' then p.seller_phone end,
       'backfill'
  from public.profiles p
 where p.seller_email is not null or p.seller_phone is not null
on conflict (seller_id) do update
   set primary_email = excluded.primary_email, primary_phone = excluded.primary_phone, updated_at = now()
 where public.seller_contacts.updated_via = 'backfill';

-- 5. VAT IDs that parse as prefix + number; unverified; fingerprint computed later by the app.
insert into public.seller_vat_ids (seller_id, country, number, shown_to_buyers, updated_via)
select p.id, substr(n.v, 1, 2), substr(n.v, 3), true, 'backfill'
  from public.profiles p
  cross join lateral (select upper(regexp_replace(p.tax_vat_id, '[ .-]', '', 'g')) as v) n
 where n.v ~ '^[A-Z]{2}[A-Z0-9]{2,12}$'
   and not exists (select 1 from public.seller_vat_ids x where x.seller_id = p.id and x.superseded_at is null);

-- 6. Terms acceptances on file, as backfilled declarations (no IP: never captured).
insert into public.seller_declarations
  (seller_id, kind, document_version, accepted_at, accepted_by, surface, evidence_quality)
select p.id, 'seller_terms', p.legal_accepted_version, p.legal_accepted_at, p.id, 'backfill', 'backfilled_from_profile'
  from public.profiles p
 where p.legal_accepted_version ~ '^[a-z0-9][a-z0-9._-]{2,31}$' and p.legal_accepted_at is not null
   and not exists (select 1 from public.seller_declarations d
                    where d.seller_id = p.id and d.kind = 'seller_terms'
                      and d.document_version = p.legal_accepted_version and d.accepted_at = p.legal_accepted_at);

-- 7. Contact proofs on file (none in production today), as code verifications.
insert into public.seller_verifications
  (seller_id, subject, method, result, reference, checked_at, expires_at, performed_by_kind)
select p.id, 'public_email', 'code', 'pass', 'backfill:profiles.seller_email_verified_at',
       p.seller_email_verified_at, p.seller_email_verified_at + interval '36 months', 'backfill'
  from public.profiles p
 where p.seller_email_verified_at is not null
   and not exists (select 1 from public.seller_verifications v
                    where v.seller_id = p.id and v.reference = 'backfill:profiles.seller_email_verified_at'
                      and v.checked_at = p.seller_email_verified_at);
-- (same statement for seller_phone_verified_at, subject 'public_phone')

-- 8. A placeholder status row per anchor. 'details_missing' is not a field rule
-- computed in SQL: no account has a seller type yet, so it is true for all.
-- The application recomputes on the first read or save.
insert into public.seller_onboarding_status (seller_id, state, blocking_reasons, spec_version)
select r.seller_id,
       case when r.relationship_started_at is null then 'not_started' else 'in_progress' end,
       array['details_missing'], 'backfill'
  from public.seller_records r
on conflict (seller_id) do nothing;
```

The Stripe account id (0 rows in production) is copied by
`seller_relationship_end` and by the app on account creation. Backfilled
verifications have no fingerprint; the app accepts them only while the
`profiles` proof column is still set (the existing guard drops it when the
value changes, `20260926_contact_verification.sql:315-322`).

### 8.2 The legacy mirror (file 06): old columns stay correct for code that has not moved

```sql
create or replace function public.seller_address_line(p_seller uuid, p_kind text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.seller_addresses%rowtype;
begin
  select * into a from public.seller_addresses x where x.seller_id = p_seller and x.kind = p_kind;
  if found and a.follows = 'primary' then
    select * into a from public.seller_addresses x where x.seller_id = p_seller and x.kind = 'primary';
  end if;
  if not found then
    return null;
  end if;
  if a.line1 is not null then
    -- The country is printed separately on buyer pages (from tax_country), as today.
    return left(concat_ws(', ', a.line1, a.line2, nullif(concat_ws(' ', a.postal_code, a.city), ''), a.region), 300);
  end if;
  return a.legacy_text;
end
$$;

create or replace function public.seller_legacy_mirror()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller  uuid;
  v_country text;
  v_text    text;
  v_email   text;
  v_phone   text;
  v_vat     text;
begin
  if coalesce(current_setting('seller.retention_purge', true), '') = 'on' then
    return null;          -- a purge never rewrites a profile (the account is long gone)
  end if;
  v_seller := case when tg_op = 'DELETE' then old.seller_id else new.seller_id end;

  if tg_table_name = 'seller_addresses' then
    select a.country into v_country from public.seller_addresses a
     where a.seller_id = v_seller and a.kind = 'primary';
    -- P1b guard (a) admits market countries only in tax_country. A seller
    -- outside the market keeps the old value there; the gate blocks them anyway,
    -- so no buyer page prints it.
    if v_country is not null and not public.market_allows('seller_country', v_country) then
      v_country := null;
    end if;
    v_text := public.seller_address_line(v_seller, 'public');
    update public.profiles p
       set tax_country    = coalesce(v_country, p.tax_country),
           seller_address = coalesce(v_text, p.seller_address)
     where p.id = v_seller
       and (p.tax_country is distinct from coalesce(v_country, p.tax_country)
            or p.seller_address is distinct from coalesce(v_text, p.seller_address));

  elsif tg_table_name = 'seller_contacts' then
    select coalesce(c.public_email, c.primary_email), coalesce(c.public_phone, c.primary_phone)
      into v_email, v_phone
      from public.seller_contacts c where c.seller_id = v_seller;
    update public.profiles p
       set seller_email = coalesce(v_email, p.seller_email),
           seller_phone = coalesce(v_phone, p.seller_phone)
     where p.id = v_seller
       and (p.seller_email is distinct from coalesce(v_email, p.seller_email)
            or p.seller_phone is distinct from coalesce(v_phone, p.seller_phone));

  elsif tg_table_name = 'seller_trade_profiles' then
    update public.profiles p
       set tax_business_name = t.trading_name
      from public.seller_trade_profiles t
     where t.seller_id = v_seller and p.id = v_seller
       and t.trading_name is not null and p.tax_business_name is distinct from t.trading_name;

  elsif tg_table_name = 'seller_vat_ids' then
    select v.country || v.number into v_vat from public.seller_vat_ids v
     where v.seller_id = v_seller and v.shown_to_buyers and v.superseded_at is null;
    update public.profiles p set tax_vat_id = v_vat
     where p.id = v_seller and p.tax_vat_id is distinct from v_vat;   -- a removed VAT ID stops showing

  elsif tg_table_name = 'seller_declarations' and new.kind = 'seller_terms' then
    update public.profiles p
       set legal_accepted_at = new.accepted_at, legal_accepted_version = new.document_version
     where p.id = v_seller
       and (p.legal_accepted_at is null or p.legal_accepted_at <= new.accepted_at)
       and (p.legal_accepted_at is distinct from new.accepted_at
            or p.legal_accepted_version is distinct from new.document_version);
  end if;
  return null;
end
$$;
revoke execute on function public.seller_address_line(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.seller_legacy_mirror() from public, anon, authenticated, service_role;
-- AFTER INSERT OR UPDATE OR DELETE triggers on seller_addresses, seller_contacts,
-- seller_trade_profiles, seller_vat_ids; AFTER INSERT on seller_declarations.
```

Properties: it writes only values that differ (so a re-run backfill does not
churn, and an unchanged email keeps its proof); it never clears a value the new
tables lack (except the VAT ID, whose removal must reach buyers); as a definer
owned by the table owner, the existing profile guards see a trusted
`current_user` (`guard_seller_text`,
`Store/supabase/migrations/20261012_auto_moderation.sql:735-777`;
`guard_contact_proof`, `20260926_contact_verification.sql:285-334`), and the
latter still drops a proof when the mirrored email or phone changes, which is
the right semantics. The Terms notice system keeps reading
`legal_accepted_version` (`Store/src/lib/legal/terms-notices.ts:215-228`), as
do the settings layout (`Store/src/app/settings/layout.tsx:72`), the dashboard
(`Store/src/app/(dashboard)/dashboard/page.tsx:205`,
`Store/src/lib/dashboard/queries.ts:613`, `:623`, `:642`) and the export
(`Store/src/app/settings/export/route.ts:44`).

### 8.3 Closing the direct writes (file 08, after the TypeScript deploy)

Today a seller can PATCH `legal_accepted_at` / `legal_accepted_version`
directly (G 1E row 21; inventory 05 section 2.2), and `acceptLegal` itself
writes them through the user's client (`Store/src/lib/settings/actions.ts:413-416`,
via `writeOwnProfile`, `Store/src/lib/moderation/auto/seller-text.ts:96-131`).
After the deploy, `acceptLegal` inserts a `seller_declarations` row with the
service role (version, time, IP, user agent, surface, locale) and the mirror
updates `profiles`; then:

```sql
create or replace function public.guard_seller_legacy_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- Only the table owner (the mirror and migrations run as it). NOT the service
  -- role: after 1B the seller_* tables are the source, and a service-role write
  -- here would split the two.
  trusted boolean := current_user in ('postgres', 'supabase_admin');
begin
  if trusted then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.tax_country is not null or new.tax_vat_id is not null or new.seller_address is not null
       or new.seller_email is not null or new.seller_phone is not null
       or new.legal_accepted_at is not null or new.legal_accepted_version is not null then
      raise exception 'Seller details are saved through the seller details form, not set directly.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.tax_country is distinct from old.tax_country
     or new.tax_vat_id is distinct from old.tax_vat_id
     or new.seller_address is distinct from old.seller_address
     or new.seller_email is distinct from old.seller_email
     or new.seller_phone is distinct from old.seller_phone
     or new.legal_accepted_at is distinct from old.legal_accepted_at
     or new.legal_accepted_version is distinct from old.legal_accepted_version then
    raise exception 'Seller details are saved through the seller details form, not set directly.'
      using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function public.guard_seller_legacy_columns() from public, anon, authenticated, service_role;
drop trigger if exists profiles_guard_seller_legacy on public.profiles;
create trigger profiles_guard_seller_legacy
  before insert or update on public.profiles
  for each row execute function public.guard_seller_legacy_columns();
```

`handle_new_user` inserts these columns as null (inventory 05 section 3), so
sign-up is unaffected. Before applying: grep Store, Admin and App for any
writer of the seven columns (the e2e seed `seedSellerIdentity` writes them
with the service role, `Store/tests/e2e/helpers.ts:539-545`, and must move to
the new tables; db test 26 updates `seller_email` as the owner,
`Store/tests/integration/26-contact-verification.test.ts:112`, `:153`, `:288`,
and must move). If `acceptLegal` moves earlier than the form, a first version
of this function covering only the two legal columns can be applied on its
own.

### 8.4 Readers that have not moved

They keep working on the mirrored columns: buyer pages through
`getSellerIdentity` / `buildSellerIdentity`, the gate's `TRADER_GATE_SELECT`
(until P1a/1B switch it), Admin's seller card, Stripe Billing customer
creation, the export, the Terms notice job. The later cleanup (separate
approval) moves each to the new tables, then drops the fallback in
`market_seller_country`, then (much later) the columns.

---

## 9. Migration plan and tests

### 9.1 Files, in order of application

Names follow the repo's `YYYYMMDD_name.sql`; zero-padded numbers keep
alphabetical order equal to application order, and `seller_` sorts after P1b's
`market_` files. If built on a later date, keep the relative order. Every file:
**needs the owner's approval before it is applied to production**; ASCII; after
`20261120_shopping_cart.sql` (unapplied, already a deploy prerequisite,
`Replica:13838`) and after P1b files 1 to 5.

| # | File | Contains | Depends on | Sentinel (`Store/scripts/lib/prod-schema.ts`; the probe prefixes `public.`) |
|---|---|---|---|---|
| 01 | `20261122_seller_01_foundation.sql` | 1.4, 2.7, 3.4 | P1b 2 | `relation seller_records`, `relation seller_data_access_log`, `relation seller_field_changes`, `function seller_sealed_get(uuid,text[],boolean,text,uuid,text,text,text,text)` |
| 02 | `20261122_seller_02_profile.sql` | 1.5, 3.1 | 01 | `relation seller_identities`, `seller_addresses`, `seller_tax_ids`, `seller_payout_accounts` |
| 03 | `20261122_seller_03_evidence.sql` | 1.6 | 01 | `relation seller_declarations`, `seller_verifications`, `seller_sanctions_screens` |
| 04 | `20261122_seller_04_status_gate.sql` | 5.1 to 5.7 (CZ `report`) | 02, 03, P1b 5 | `relation seller_onboarding_status`, `relation market_countries`, `body seller_sell_block(uuid)` includes `seller_onboarding_status`, `body market_seller_country(uuid)` includes `seller_addresses`, `body market_rule_violation_rows()` includes `ob_complete_but_missing` |
| 05 | `20261122_seller_05_backfill.sql` | 8.1 | 04 | `UNPROBED_MIGRATIONS`: "Data only (copies of profile values into seller_* tables), re-runnable; the schema probe reads catalogs only." |
| 06 | `20261122_seller_06_legacy_mirror.sql` | 8.2 | 05 | `function seller_legacy_mirror()` |
| 07 | `20261122_seller_07_money_retention.sql` | 4.4 to 4.6 | 20261120, 01 | `column orders.paid_at`, `relation seller_period_totals`, `function seller_relationship_end(uuid,text,text)` |
| | **TypeScript deploy** | new form and validators, sealing module, status writer, gate reasons, `acceptLegal` to declarations, deletion `retain` step, Admin access logging, reveal route | 01 to 07 | |
| 08 | `20261122_seller_08_legacy_guard.sql` | 8.3 | TS deploy | `UNPROBED` while unapplied ("applied AFTER the deploy that stops writing these columns from the user's client; a sentinel would demand the unsafe order", the 20261012 reasoning, `prod-schema.ts:49-50`); then `function guard_seller_legacy_columns()` |
| 09 | `20261122_seller_09_enforce.sql` | CZ `enforce` (canonical upsert), grace for existing sellers, OB baseline capture | 08, TS gate live | `UNPROBED` ("data and a mirror row; the drift tests cover it") |
| 10 | `20261122_seller_10_dac7_requests.sql` (stage 2) | 6.4, 4.8 | 04 | `relation seller_dac7_events`, `relation seller_reregistration_blocks` |
| 11 | `20261122_seller_11_sanctions_lists.sql` (stage 2) | 6.2 list tables, activate, candidates | 03 | `relation sanctions_list_names`, `function sanctions_candidates(text[],real,integer)` |
| 12 | `20261122_seller_12_retention_purge.sql` (stage 2) | 4.7, access-log hash chain | 07 | `relation seller_retention_purges`, `function seller_retention_purge(integer)` |
| 13 | `20261122_seller_13_thresholds.sql` (stage 2) | 7 | 07 | `relation market_threshold_rules`, `function seller_threshold_compute(text,timestamptz)` |
| 14 | `20261122_seller_14_gpsr_guard.sql` (stage 2, optional) | 1.8 presence guard | TS publish rule | `UNPROBED` until applied (same reasoning as 08) |

Bundles: 01 to 07 can be applied as one `begin; ... commit;` (the owner pastes
it into the SQL editor; the Supabase connector declines writes, memory note
`supabase-connector-writes-declined`). 08 alone. 09 alone, after a rehearsal
(`begin; <09>; select * from public.market_rule_violations(); rollback;`).

Relative to the 1A migrations: P1b files 1 to 5 must precede seller 01 to 07
(the helpers, the monitor); P1b file 6 (guards) can come before or after; the
mirror's market check needs only `market_allows` (P1b 2). P1b file 3 redefines
`order_place`; seller 07 does not touch it (the `paid_at` trigger is
independent).

### 9.2 Code versus migration, per file

| File | If the migration lands first | If the code ships first |
|---|---|---|
| 01 to 04 | harmless: new objects; gate in report mode | the new form's writes fail (missing tables); the deploy gate's sentinels prevent it |
| 05, 06 | harmless; re-run 05 right before the deploy | n/a |
| 07 | harmless; new paid orders get `paid_at` | the deletion `retain` step fails closed, so every deletion rests: migration first (sentinel) |
| 08 | the OLD form's saves of the seven columns and the old `acceptLegal` fail with 42501: code first | intended order |
| 09 | the TS gate disagrees with the database for incomplete sellers: code first | intended order |

### 9.3 Replay blocks and sentinel rules

Append each replayed file to `Store/tests/db/prod-migrations.sql` after the
P1b blocks, verbatim, headed `-- ===== 20261122_seller_NN_<name> (pending)
=====...`; drop "(pending)" when production has it (the schema probe, not the
header, is the truth, `prod-schema.ts:4-24`). Body sentinels quote text inside
the function, never a comment (memory note `speed-cost-pass-2026-11`).
`Store/tests/integration/50-prod-schema-probe.test.ts` must pass. Never re-run
P1b file 2 or 5 after file 04: it would restore the old `seller_sell_block`,
`market_seller_country` or monitor bodies (the body sentinels catch it at the
next deploy).

Test helpers in `Store/tests/db/client.ts`: `createSellerRecord(user)`,
`asPurge(fn)` (a superuser transaction that sets `seller.retention_purge` as
the owner role, to prove the purge path), `asAgent(user)` (claims with
`agent_grant_id`).

### 9.4 Tests (db project, 60 onward; P1b uses 51 onward)

* **60-seller-foundation-vault:** anchor guard (no delete outside purge,
  set-once columns); vault invisible to `anon`, `authenticated`,
  `service_role` (USAGE false, direct select denied); `seller_sealed_put`
  supersedes and sets the pointer in one call; a put for another seller's row
  is refused; envelope shape and key-id mismatch refused by the CHECK;
  `seller_sealed_get` writes exactly one access-log row and returns envelopes;
  refused for `authenticated`; `p_actor_kind = 'seller'` with another id
  refused; staff without purpose refused; rotation batch + reseal
  compare-and-swap; census counts.
* **61-seller-profile-rls:** for each owner-readable table: the owner reads its
  own row; another seller reads nothing; `anon` nothing; an agent JWT nothing
  (but the status row yes); an aal1 token of a 2FA account nothing;
  `authenticated` INSERT/UPDATE/DELETE fail with permission denied; grants
  equal exactly `SELECT` for `authenticated` and nothing for `anon`;
  service-only tables have no grant to either; company + private refused;
  array shapes refused.
* **62-seller-append-only:** for every append-only table and for
  `seller_records`, the vault, frozen totals: UPDATE and DELETE refused as
  `authenticated`, `service_role` and the superuser; TRUNCATE refused; a
  service-role session that sets `seller.retention_purge = on` itself is still
  refused; `asPurge` deletes; the supersede guards refuse an in-place value
  edit and accept a supersede; the change trigger records clear old/new,
  vault ids for sealed fields, the actor from `updated_via`, the class by
  address kind, and nothing during a purge.
* **63-seller-gate:** CZ `report`: `seller_sell_block` null for an incomplete
  CZ seller; `enforce`: no status row gives `details_missing`; reasons return
  in canonical priority whatever the stored order; grace skips graceable and
  never skips `sanctions_confirmed`; `payments_not_ready` skipped unless
  `payments_required`; `verification_expired` skipped when `warn`; a broken
  row (not complete, no reasons) fails closed; P1b's products guard refuses
  draft to active with `seller_blocked:details_missing`, and `order_place`
  refuses likewise; the CHECK refuses an unknown reason and a complete row with
  reasons; a confirmed sanctions review prepends `sanctions_confirmed`;
  `market_seller_country` uses the fallback without a primary row, the primary
  row (even null) when one exists; the country-lock guard; vocabulary equals
  the TS list.
* **64-seller-mirror-guards:** each mirrored column follows its source; an
  unchanged email keeps its proof, a changed one drops it; a non-market
  primary country leaves `tax_country` unchanged and does not trip P1b guard
  (a); the backfill run twice changes nothing; after file 08 an owner PATCH of
  each of the seven columns is refused (42501), the service role too, the
  mirror still writes; `handle_new_user` still works.
* **65-seller-money-retention:** `paid_at` stamped on pending to paid, from
  `created_at` on an insert as paid, untouched by refund, ship and the expiry
  sweep; totals and extracts computed per quarter and currency, excluding
  non-`pi_` rows; frozen rows refuse updates; `seller_relationship_end`
  freezes, stamps, deletes only the status row and is idempotent; **deleting
  the auth user leaves every `seller_*` row in place** (the decisive test);
  deadlines per class from the rules table.
* **66 to 69 (stage 2):** DAC7 `enforced` refused before 60 days or without
  both reminders, accepted after, writes the hard stop and the blocklist;
  list activation flips exactly one active version; candidates by trigram;
  purge deletes exactly the expired classes, writes counts and a digest,
  respects legal holds, deletes the anchor last; access-log hash chain
  verifies and detects an edit made with the trigger disabled; threshold
  compute per window and currency, inactive rules skipped.
* **Unit:** `seller-gate-reasons-sql.test.ts`, `market-countries-sql.test.ts`,
  `seller-retention-rules-sql.test.ts`, `threshold-rules-sql.test.ts`
  (canonical-upsert parsers, the P1b 1.4 pattern); the agent registry
  assertion (3.3); `prod-schema.test.ts` (every file named or unprobed).
* **Coverage lists:** `00-harness` and `19-rls-coverage` additions (3.5); the
  definer pin list of test 22 stays unchanged (every new definer function is
  revoked from `authenticated`), which that test proves by itself.
* **Existing tests to update:** 26-contact-verification (owner writes of
  `seller_email`), 14-data-integrity (profile column writes, if not as
  superuser), e2e `seedSellerIdentity` and `PUBLISHABLE_SELLER`
  (`Store/tests/e2e/helpers.ts:498-545`: a publishable seller now needs a
  complete status row or the CZ gate in `report` for the e2e stack), specs 50,
  60, 102 (terms, onboarding, publish gate).

---

## 10. Staging

**Stage 1: what must exist for the Czech beta to open.** Files 01 to 09 and
the TypeScript that writes them. Reasoning: the gate needs the status row and
its inputs (identity, addresses, contacts, tax IDs, VAT, registration,
declarations, verification log, sanctions record); sealed fields must be
sealed from the first value ever stored (retrofitting encryption means
plaintext once existed); the deletion freeze and `paid_at` must exist before
the first real payment, or a seller who sells and deletes is lost to DAC7; the
access log must exist before staff can see private data; the legacy guard
closes a hole that exists today. Sanctions: the minimum honest stage 1 is the
manual screen in 6.2, recorded per seller by a named reviewer, at onboarding
and monthly; the gate holds a new seller until it is recorded `clear`.
Payout identifier table exists but stays empty; `payments_required` stays false
until Connect goes live.

**Stage 2: shortly after (before the first DAC7 reporting cycle and before the
seller count makes manual screening impractical).** DAC7 request and reminder
ladder with the 60-day enforcement guard and the re-registration block (file
10; the form demands everything up front, so requests are needed only for
invalid or re-verified data); automated EU list ingest and re-screen on every
list update (11); retention purge, purge log and access-log hash chain (12;
nothing reaches a deadline before 6 months after the first relationship end);
the DAC7 small-seller counter and FX rates (13; needed for the first report);
the payout identifier read from Stripe at report time (if test mode confirms
`external_accounts` is readable, G 5); key-rotation route; primary-contact
verification channels; GPSR presence guard (14).

**Stage 3: built generic, inactive.** US INFORM counters and buyer totals per
US state (rows exist with `active = false`), OFAC list (`list_code` already
allows it), more countries' validators and `market_countries` rows (the
tables are country-agnostic), private sellers where a market allows them.

---

## 11. Decisions, questions, risks, alternatives, unknowns

### 11.1 Decisions for the owner (with the default that unblocks the build)

| # | Decision | Default |
|---|---|---|
| 1 | Sealed values in a non-exposed vault schema behind a logging RPC (instead of envelope columns on each table) | Yes |
| 2 | Key custody | Option A: Store Worker secrets only, offline escrow copy with the owner and a second sealed copy with Adrian |
| 3 | How Admin reveals | A Store internal route; Admin never holds the keyring |
| 4 | Team members and seller details | Owner only |
| 5 | Agent (MCP) JWTs and private tables | Excluded; the status row allowed |
| 6 | Universal form stores non-market countries; P1b guard (a) kept for the mirror only; `r1_seller_country` non-alerting | Yes |
| 7 | Existing sellers' grace | 60 days from file 09; graceable list as in 5.3 |
| 8 | `payments_required` (charges_enabled to publish, G 10.2 #2) | False until Connect is live, then true per market |
| 9 | Expired checks / overdue yearly confirmation | `warn` in the beta |
| 10 | `ALLOW_PRIVATE_SELLERS` | False for CZ in the beta |
| 11 | Database hard stops write the status row (sanctions confirmed, DAC7 enforced) | Yes |
| 12 | VIES / ARES unavailable (G 10.2 #12) | Fail closed with an automatic retry job: `verification_pending` blocks a NEW seller until a retry passes; existing sellers are covered by grace |
| 13 | Who reviews potential sanctions matches; stage 1 manual screening | The owner (rootlabs) as named reviewer; monthly re-screen as a recurring task |
| 14 | Retention defaults (4.1) | As in the canonical upsert, pending the lawyer and the tax adviser |
| 15 | Keep the purge log (uuid, class, counts, digest) indefinitely | Yes |
| 16 | Store the declaration IP address in full | Yes, evidence class, pending the lawyer (else `ip_country` only) |
| 17 | Optional GPSR presence guard in the database | Yes, stage 2, after the app enforces it |
| 18 | After grace, move incomplete sellers' live listings to draft | No: hidden by the read side, reported by the monitor, owner acts case by case |
| 19 | Dormancy as an end of the relationship | No |
| 20 | Approval of each file and of the order in 9.1 | Required |

### 11.2 Questions for the lawyer

1. Retention: the six periods in 4.1 (DSA 6 months even on the seller's own
   deletion request; evidence 36 months; access log; blocklist 10 years),
   and the privacy-notice text that seller records now outlive the account
   (today it says seller data is deleted with the account, G 6.2), including
   backups.
2. Lawful basis and limits for processing the Czech birth number, date and
   place of birth; whether a fingerprint blocklist that survives the account is
   lawful, and for how long.
3. **VAT IDs of natural persons:** a Czech individual's VAT number can contain
   the birth number; we store and display VAT IDs in clear. Is displaying it
   (and keeping it in clear) acceptable, or should natural persons' VAT numbers
   be sealed and shown only on the seller's choice?
4. Whether Art. 30 DSA applies to the operator at all (Art. 29 micro / small
   exemption), which changes the `dsa` class.
5. Storing the full IP address in each declaration; how long.
6. Sanctions screening: basis; whether a block after a confirmed match needs
   Art. 22 GDPR safeguards (our design: a human confirms every block); whether
   a seller under review may be told.
7. Whether staff access logs must be disclosed to the seller on an access
   request.
8. Representative name and role: retained with the DAC7 set (10 years)
   acceptable?
9. Texts: trader status, private-seller notice, self-certification,
   product-safety roles, privacy acknowledgement (versioned declaration rows).

### 11.3 Questions for the tax adviser

1. DAC7 retention: 10 years from the end of WHICH year (the last reportable
   period with consideration?), any CZ-specific period, and whether it applies
   to sellers who never had consideration (`dac7_no_sales`).
2. Period attribution: payment time (`paid_at`) in which time zone; refunds in
   the sale's quarter or the refund's.
3. "Relevant activity": order or line; consideration net of our fees; delivery
   included or not.
4. FX for the EUR 2,000 small-seller test with CZK sales: which rate (ECB, CNB),
   which date.
5. Is the stored VIES result without a consultation number sufficient while
   the operator is not VAT-registered?
6. Payout identifier: is last 4 + holder name (what Stripe returns) enough?
7. Are the frozen quarterly totals plus the order extract (no buyer data)
   adequate substantiation after the orders are deleted?
8. Signup IP country and billing country as evidence for VAT on our own fees:
   retention (possibly 10 years, longer than `evidence`).
9. Place-of-birth fallback: when does a country "not issue" a TIN; multiple
   residences.

### 11.4 Risks

* **Breadth.** About 22 tables in stage 1. Mitigated by one convention set
  (1.2), loops for grants and triggers, and the tests in 9.4; the alternative
  (fewer, wider tables) makes retention a column-nulling exercise (11.5).
* **Key loss = DAC7 data loss.** The escrow copy is not optional.
* **Actor attribution depends on the app** setting `updated_by` / `updated_via`
  on every write (interface note 2); a forgotten field records the previous
  actor. A unit test in the app's write module should assert it.
* **Trust assumptions to verify in the replica:** that referential cascades and
  set-null actions run as the table owner (the purge and pointer paths rely on
  it), that the owner role is `postgres` in production and in the replay (the
  legacy guard and the append-only guard name roles), and that a cross-schema
  foreign key works for service-role inserts. Each has a test in 9.4.
* **Production differs from the repo** (SQ-app migrations, memory note
  `test-db-isolation`): read the live definitions of `profiles` triggers,
  `seller_sell_block`, `market_seller_country` and the monitor before applying.
* **P1b coupling.** Files 04 and 10 restate P1b's monitor bodies; re-running a
  P1b file afterwards silently reverts them (body sentinels catch it).
* **Status staleness** between a change and the app's recompute; bounded by
  `ob_status_stale`.
* **`pg_trgm` schema** may differ between the replica (public) and production.
* **The baseline blesses what exists at capture** (P1b's own risk): rehearse
  file 09 first.
* **Stage 1 sanctions is manual**: a list update between monthly re-screens is
  not caught until the next one.

### 11.5 Alternatives rejected

* **Columns on `profiles`:** owner-writable over PostgREST, cascades at
  deletion, read by many helpers (the interface already excludes it).
* **Copying into retained tables at deletion** (keep `auth.users` cascades, copy
  in the job): one forgotten table or a failed copy loses data; never-cascading
  tables cannot be lost by a cascade at all.
* **One wide seller profile with per-column retention:** the purge would null
  columns instead of deleting rows, which is harder to prove and fights
  constraints; one jsonb blob loses every constraint and per-field class.
* **Envelope columns in public tables:** one careless `select *` away from a
  page or a tool output; no database-enforced reveal log.
* **pgsodium Transparent Column Encryption / Supabase Vault for the data key:**
  key next to the data; pgsodium pending deprecation
  ([Supabase docs](https://supabase.com/docs/guides/database/extensions/pgsodium)).
* **pgcrypto with the key passed per query:** the key would appear in
  statements and could reach logs.
* **Hashing IP addresses:** an unkeyed IPv4 hash is brute-forced in minutes
  and a keyed one is not evidence.
* **Seller-bound fingerprints:** would defeat duplicate detection and the
  re-registration block.
* **SQL computing completeness:** forbidden by the interface; also two
  implementations would drift. The monitor's presence check is not one.
* **Redefining `order_confirm_paid` / `order_place` for `paid_at`:** misses the
  simulator and direct writers, collides with P1b file 3 and the cart migration.
* **Incremental counters:** drift with refunds, deletions and late webhooks.
* **Soft-delete flags instead of a purge:** the data would still exist.
* **Refusing a non-market country on save in the new table** (P1b 3a's
  semantics carried over): contradicts the universal form and P1a 4.4.

### 11.6 What I could not determine

* Whether referential actions run as the table owner in this exact PostgreSQL
  17 build and in the embedded replica (assumed, tested in 9.4).
* Whether Supabase grants anything by default on a newly created non-public
  schema in production (the design revokes explicitly either way).
* The schema of `pg_trgm` in production.
* Whether Admin can reach a Store internal route with the staff session in
  production (the application architect's design; the shared cookie is
  documented in the two-factor memory note).
* The live definitions of the objects 1B replaces (P1b's are designed, not
  applied; SQ-app may have altered `profiles` triggers).
* Whether Stripe returns `external_accounts` for platform-created Standard
  accounts after onboarding (G 5).
* The exact EU FSF download URL, token process and reuse licence (G 4.3).

Sources read for this design (public documentation, no project data in any
query): [Supabase pgsodium (pending deprecation)](https://supabase.com/docs/guides/database/extensions/pgsodium),
[Supabase column encryption page](https://supabase.com/docs/guides/database/column-encryption).
