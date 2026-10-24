// What production's schema must contain for this build to work, and the probe
// that asks production whether it does.
//
// WHY THIS EXISTS. Migrations here are applied by hand (the SQL editor, or the
// Management API query endpoint), and neither records a row in
// supabase_migrations.schema_migrations. So `pnpm check:migrations`, which
// reads that table, has seen nothing applied since 2026-09-18, and the only
// record of what production holds was a comment above each block in
// tests/db/prod-migrations.sql. Comments go stale in both directions: on
// 2026-10-07 seven blocks were headed "(pending)" and six of them were live.
// The app selects new columns on every order read, so the opposite mistake (a
// deploy ahead of its migration) takes the Orders page and every buyer order
// page down with it.
//
// So this asks the database itself. One sentinel or more per hand-applied
// migration: an object that exists only once that migration has run.
//
// ADDING A MIGRATION means adding its sentinel here.
// tests/unit/prod-schema.test.ts fails until every file in supabase/migrations
// from HAND_APPLIED_FROM on is named below (or excluded, with the reason).
//
// PURE ON PURPOSE. No database client and no environment in this file, so the
// list and the SQL it becomes can be asserted without a connection. The runner
// is scripts/check-prod-schema.ts.

/** One thing production must have, and the migration that adds it. */
export type SchemaRequirement =
  | { kind: "relation"; name: string; migration: string }
  | { kind: "column"; table: string; column: string; migration: string }
  // `signature` is the name and argument TYPES, as to_regprocedure reads them:
  // "order_mark_shipped(uuid,text,text)".
  | { kind: "function"; signature: string; migration: string }
  // A CHECK constraint that must accept `allows` (a widened vocabulary).
  | { kind: "check"; constraint: string; allows: string; migration: string }
  /** A function whose body says `includes`: for a migration that only
   *  replaces a function, where the signature alone proves nothing. */
  | { kind: "body"; signature: string; includes: string; migration: string };

/**
 * The first migration applied without a ledger row. Everything older is what
 * `pnpm check:migrations` already accounts for.
 */
export const HAND_APPLIED_FROM = "20260923";

/** Migrations with nothing to probe, and why. Never silently skipped. */
export const UNPROBED_MIGRATIONS: Record<string, string> = {
  "20260927_demo_sales_sim_fulfilment.sql":
    "Only replaces functions in the demo schema (the pg_cron sales simulator). The app never calls them.",
  "20261012_auto_moderation.sql":
    "Applied AFTER the deploy, never before: the build is inert without it (lib/moderation/auto), while the wall it installs hides every save until a deployed checker settles it. A sentinel here would demand the unsafe order.",
  "20261013_marketplace_moderation.sql":
    "Applied AFTER the deploy, for the same reason, and after SQ-app's: it makes collection names writable by the service role only and empties the public directory until each handle is approved. Nothing in this build reads anything it adds.",
};

export const SCHEMA_REQUIREMENTS: readonly SchemaRequirement[] = [
  { kind: "column", table: "products", column: "moderation_review_requested_at", migration: "20260923_moderation_pause.sql" },
  { kind: "relation", name: "mfa_recovery_codes", migration: "20260923_two_factor_auth.sql" },
  { kind: "function", signature: "mfa_session_ok()", migration: "20260923_two_factor_auth.sql" },
  { kind: "relation", name: "profile_directory", migration: "20260924_public_profiles_invoker.sql" },
  { kind: "relation", name: "mfa_passkeys", migration: "20260925_passkey_factors.sql" },
  { kind: "column", table: "profiles", column: "locale", migration: "20260925_profile_locale.sql" },
  { kind: "relation", name: "contact_verifications", migration: "20260926_contact_verification.sql" },
  { kind: "column", table: "profiles", column: "seller_phone_verified_at", migration: "20260926_contact_verification.sql" },
  { kind: "relation", name: "moderation_decisions", migration: "20260926_moderation_decisions_and_appeals.sql" },
  { kind: "relation", name: "moderation_appeals", migration: "20260926_moderation_decisions_and_appeals.sql" },
  { kind: "column", table: "orders", column: "fulfilment_status", migration: "20260927_order_fulfilment.sql" },
  { kind: "column", table: "orders", column: "checkout_session_id", migration: "20260927_order_fulfilment.sql" },
  { kind: "relation", name: "mfa_sign_in_approvals", migration: "20260927_sign_in_approvals.sql" },
  { kind: "column", table: "orders", column: "withdrawal_requested_at", migration: "20260928_checkout.sql" },
  { kind: "column", table: "orders", column: "digital_file_key", migration: "20260928_checkout.sql" },
  { kind: "column", table: "mfa_sign_in_approvals", column: "approval_code", migration: "20260929_approval_code.sql" },
  { kind: "relation", name: "billing_switches", migration: "20260930_seller_plans.sql" },
  { kind: "column", table: "orders", column: "platform_fee_bps", migration: "20260930_seller_plans.sql" },
  { kind: "relation", name: "mfa_verify_intents", migration: "20260930_two_factor_hardening.sql" },
  { kind: "function", signature: "mfa_access_token_gate(jsonb)", migration: "20260930_two_factor_hardening.sql" },
  { kind: "column", table: "orders", column: "tracking_carrier", migration: "20261001_order_tracking_carrier.sql" },
  { kind: "function", signature: "order_mark_shipped(uuid,text,text)", migration: "20261001_order_tracking_carrier.sql" },
  { kind: "check", constraint: "seller_funnel_events_source_check", allows: "orders_export", migration: "20261001_plan_perks.sql" },
  { kind: "check", constraint: "seller_funnel_events_source_check", allows: "product_limit", migration: "20261002_product_limits.sql" },
  { kind: "relation", name: "plan_cancellations", migration: "20261003_plan_cancellations.sql" },
  { kind: "relation", name: "discounts", migration: "20261004_discounts.sql" },
  { kind: "column", table: "orders", column: "discount_id", migration: "20261004_discounts.sql" },
  { kind: "function", signature: "discount_performance(uuid)", migration: "20261004_discounts.sql" },
  { kind: "check", constraint: "orders_channel_check", allows: "button", migration: "20261005_buy_button_channel.sql" },
  { kind: "check", constraint: "storefront_signals_channel_check", allows: "button", migration: "20261005_buy_button_channel.sql" },
  { kind: "function", signature: "analytics_weekday_products(uuid,date,date)", migration: "20261007_analytics_weekday_products.sql" },
  { kind: "column", table: "orders", column: "stock_reserved", migration: "20261008_order_lifecycle.sql" },
  { kind: "column", table: "orders", column: "confirmation_sent_at", migration: "20261008_order_lifecycle.sql" },
  { kind: "function", signature: "order_place(jsonb)", migration: "20261008_order_lifecycle.sql" },
  { kind: "function", signature: "order_refund(uuid,text,boolean)", migration: "20261008_order_lifecycle.sql" },
  { kind: "relation", name: "seller_payment_accounts", migration: "20261008_seller_payment_accounts.sql" },
  { kind: "column", table: "account_deletion_requests", column: "started_at", migration: "20261010_account_deletion_requests.sql" },
  { kind: "relation", name: "plan_prices", migration: "20261011_pricing_config.sql" },
  { kind: "relation", name: "plan_entitlements", migration: "20261011_pricing_config.sql" },
  { kind: "relation", name: "seller_fee_waivers", migration: "20261011_pricing_config.sql" },
  { kind: "relation", name: "fee_ledger", migration: "20261011_pricing_config.sql" },
  { kind: "column", table: "billing_switches", column: "fees_enabled", migration: "20261011_pricing_config.sql" },
  { kind: "column", table: "orders", column: "application_fee_cents", migration: "20261011_pricing_config.sql" },
  { kind: "relation", name: "storefront_funnel_daily", migration: "20261012_storefront_funnel_daily.sql" },
  { kind: "function", signature: "storefront_funnel_roll_day(date,jsonb)", migration: "20261012_storefront_funnel_daily.sql" },
  { kind: "function", signature: "storefront_funnel_aggregate(uuid,date,date)", migration: "20261012_storefront_funnel_daily.sql" },
  { kind: "body", signature: "enforce_plan_limit()", includes: "is distinct from 'removed'", migration: "20261019_removed_content_frees_plan_room.sql" },
  { kind: "relation", name: "plan_grants", migration: "20261019_plan_grants.sql" },
  { kind: "function", signature: "plan_grant_set(uuid[],text,timestamp with time zone,text,text,uuid)", migration: "20261019_plan_grants.sql" },
  { kind: "function", signature: "plan_grant_end(uuid[],uuid)", migration: "20261019_plan_grants.sql" },
  { kind: "body", signature: "rl_take(text,integer,integer)", includes: "retention_seconds", migration: "20261021_rl_take_keeps_history.sql" },
  { kind: "function", signature: "username_is_reserved(text)", migration: "20261021_reserved_usernames.sql" },
  { kind: "relation", name: "signup_intents", migration: "20261021_signup_intents.sql" },
  { kind: "function", signature: "signup_intent_gate(jsonb)", migration: "20261021_signup_intents.sql" },
  { kind: "function", signature: "guard_object_keys()", migration: "20261021_object_key_ownership.sql" },
  { kind: "body", signature: "order_refund(uuid,text,boolean)", includes: "o.payment_ref into owner_id, ref", migration: "20261021_order_refund_provider_first.sql" },
  { kind: "body", signature: "order_place(jsonb)", includes: "discount_exhausted", migration: "20261022_order_place_code_limit.sql" },
];

/** A SQL string literal. Every value below is a constant from this file, and
 *  is still quoted properly: this text is sent to a production database. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The boolean expression that is true when production has this requirement.
 *
 * Read from pg_catalog, not information_schema: information_schema only shows a
 * role the columns it has privileges on, so a minimal read-only role (the
 * right credential for CI) would see an empty schema and fail every check.
 */
function probeExpression(requirement: SchemaRequirement): string {
  switch (requirement.kind) {
    case "relation":
      return `to_regclass(${literal(`public.${requirement.name}`)}) is not null`;
    case "column":
      return (
        "exists (select 1 from pg_catalog.pg_attribute a " +
        `where a.attrelid = to_regclass(${literal(`public.${requirement.table}`)}) ` +
        `and a.attname = ${literal(requirement.column)} and not a.attisdropped)`
      );
    case "function":
      return `to_regprocedure(${literal(`public.${requirement.signature}`)}) is not null`;
    case "check":
      return (
        "exists (select 1 from pg_catalog.pg_constraint c " +
        "where c.connamespace = 'public'::regnamespace " +
        `and c.conname = ${literal(requirement.constraint)} ` +
        `and pg_get_constraintdef(c.oid) like ${literal(`%'${requirement.allows}'%`)})`
      );
    case "body":
      // strpos, not LIKE: the text is matched as written, wildcards and all.
      return (
        `coalesce(strpos(pg_catalog.pg_get_functiondef(to_regprocedure(${literal(`public.${requirement.signature}`)})), ` +
        `${literal(requirement.includes)}), 0) > 0`
      );
  }
}

/** One row per requirement, in list order: `position` and whether it is there. */
export type ProbeRow = { position: number; present: boolean };

/** The single read-only statement that answers for the whole list. */
export function buildProbeSql(
  requirements: readonly SchemaRequirement[] = SCHEMA_REQUIREMENTS,
): string {
  const rows = requirements.map(
    (requirement, position) => `(${position}, (${probeExpression(requirement)}))`,
  );
  return `select position, present from (values\n  ${rows.join(",\n  ")}\n) as probe(position, present) order by position`;
}

/** How a requirement reads in a failure message. */
export function describeRequirement(requirement: SchemaRequirement): string {
  switch (requirement.kind) {
    case "relation":
      return `table or view public.${requirement.name}`;
    case "column":
      return `column public.${requirement.table}.${requirement.column}`;
    case "function":
      return `function public.${requirement.signature}`;
    case "check":
      return `constraint ${requirement.constraint} accepting '${requirement.allows}'`;
    case "body":
      return `function public.${requirement.signature} containing "${requirement.includes}"`;
  }
}

/**
 * The requirements production does not meet.
 *
 * Throws when the answer does not line up with the question (a row missing, or
 * out of order): a probe that cannot be read must never pass as "all present".
 */
export function missingRequirements(
  rows: readonly ProbeRow[],
  requirements: readonly SchemaRequirement[] = SCHEMA_REQUIREMENTS,
): SchemaRequirement[] {
  if (rows.length !== requirements.length) {
    throw new Error(
      `The probe answered ${rows.length} rows for ${requirements.length} requirements.`,
    );
  }
  return requirements.filter((_, position) => {
    const row = rows[position];
    if (Number(row.position) !== position) {
      throw new Error(`The probe's rows are out of order at position ${position}.`);
    }
    return row.present !== true;
  });
}
