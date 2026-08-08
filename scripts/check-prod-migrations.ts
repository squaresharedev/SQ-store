// Does tests/db/prod-migrations.sql still reflect production?
//
// WHY THIS EXISTS. The DB integration suite and the E2E stack build their whole
// database from tests/db/prod-migrations.sql. Anything applied in prod but
// absent there is a table, policy or constraint the tests CANNOT see — they
// pass while the real schema is untested. That is not hypothetical: this
// project's Supabase instance is shared with SQ-app, and its
// `sq_app_likes_follows_reports` migration (artifact_likes, follows, reports)
// sat in production for four weeks with no test replica and no review, despite
// being reachable with the same publishable anon key this dashboard ships.
//
// WHY IT CHECKS RATHER THAN GENERATES. The replica is deliberately hand-curated
// — demo_sales_sim is excluded because it needs pg_cron, which embedded-Postgres
// does not ship, and replaying it fails the suite at setup. A blind dump would
// undo that every time it ran. So this reports what to add and leaves the
// judgement to a human.
//
// The triage table below is the point. A migration nobody has classified is
// reported as UNREVIEWED, which is the honest default: the tool does not know
// whether it matters, so it refuses to stay quiet about it.
//
//   SUPABASE_DB_URL="postgresql://..." pnpm check:migrations
//
// The connection string is the Supabase project's direct Postgres URL
// (Dashboard -> Project Settings -> Database -> Connection string -> URI).
// Read-only: this script only SELECTs from supabase_migrations.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

/** Print a reason and exit non-zero. */
function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/**
 * How each applied migration is accounted for in the replica.
 *
 *   replayed  — present, under the marker name given (which often differs from
 *               the prod migration name, because several were folded together
 *               when the replica was first assembled).
 *   excluded  — deliberately absent, with the reason. Never silently skipped.
 *
 * A prod migration missing from this table is UNREVIEWED and fails the check.
 */
type Disposition =
  | { kind: "replayed"; marker: string }
  | { kind: "excluded"; reason: string };

const TRIAGE: Record<string, Disposition> = {
  "20260706081542": { kind: "replayed", marker: "create_profiles_with_rls" },
  "20260706081558": { kind: "replayed", marker: "harden_profile_trigger_functions" },
  "20260706081613": { kind: "replayed", marker: "profile_trigger_map_oauth_metadata" },
  "20260706081631": { kind: "replayed", marker: "create_products" },
  "20260706081644": { kind: "replayed", marker: "harden_rls_auto_enable_execute" },
  "20260706081700": { kind: "replayed", marker: "create_storefronts" },
  "20260706081724": { kind: "replayed", marker: "settings_profile_fields" },
  "20260706081743": { kind: "replayed", marker: "create_orders" },
  "20260706081759": { kind: "replayed", marker: "storefronts_multiple_per_owner" },
  "20260706081821": { kind: "replayed", marker: "add_product_stock_tracking" },
  "20260706122746": { kind: "replayed", marker: "create_team_members_with_rls" },
  "20260706125014": { kind: "replayed", marker: "team_lock_down_trigger_functions" },
  "20260706130657": { kind: "replayed", marker: "team_accept_invite_rpc" },
  "20260706140056": { kind: "replayed", marker: "create_notifications_with_rls_realtime" },
  "20260706152026": { kind: "replayed", marker: "user_id_by_email_resolver" },
  "20260706153749": { kind: "replayed", marker: "add_display_name_uniqueness" },
  "20260706153835": { kind: "replayed", marker: "revoke_anon_display_name_available" },
  "20260706154640": { kind: "replayed", marker: "team_store_access_rls" },
  "20260706174216": { kind: "replayed", marker: "avatars_storage_and_rate_limits" },
  "20260706175405": { kind: "replayed", marker: "avatars_drop_listing_policy" },
  "20260707102615": { kind: "replayed", marker: "admin_foundation" },
  "20260707102622": { kind: "replayed", marker: "seed_first_owner" },
  "20260707102628": { kind: "replayed", marker: "waitlist_signups" },
  "20260707102636": { kind: "replayed", marker: "admin_user_directory_view" },
  "20260707121316": { kind: "replayed", marker: "waitlist_signups_unique_email" },
  "20260711170947": { kind: "replayed", marker: "curation_foundation" },
  // Was triaged as folded into curation_foundation. It was not — the replica
  // kept is_public defaulting to TRUE while production defaulted to FALSE, so
  // every visibility test ran against the opposite privacy posture. A marker
  // that names the migration is what makes that checkable.
  "20260711171820": {
    kind: "replayed",
    marker: "sq_app_profiles_private_by_default",
  },
  "20260711195645": { kind: "replayed", marker: "sq_app_likes_follows_reports" },
  "20260720164802": { kind: "replayed", marker: "cost_audit_indexes" },
  "20260720164901": { kind: "replayed", marker: "cost_audit_buyer_email_trgm" },
  "20260720165012": { kind: "replayed", marker: "cost_audit_bound_pending_invites" },
  "20260721172234": { kind: "replayed", marker: "sliding_window_rate_limits" },
  "20260722104903": { kind: "replayed", marker: "team_roster_avatar" },
  "20260801140113": {
    kind: "excluded",
    reason:
      "demo_sales_sim needs pg_cron; embedded-Postgres does not ship it, so replaying it fails the suite at setup. The demo schema is not exposed over PostgREST and gates no security invariant.",
  },
  "20260801140742": {
    kind: "excluded",
    reason: "demo_sales_sim_reconcile — same pg_cron dependency as above.",
  },
  "20260801201249": { kind: "replayed", marker: "storefront_embed_key" },
  "20260801203913": { kind: "replayed", marker: "analytics_sql_aggregates" },
  "20260804093004": { kind: "replayed", marker: "username_sign_in" },
  // Folded into the username_sign_in section of the replica.
  "20260804093343": { kind: "replayed", marker: "username_sign_in" },
  "20260806161543": { kind: "replayed", marker: "universal_search_indexes" },
  "20260806170229": { kind: "replayed", marker: "merge_display_name_into_username" },
  // Both lock-downs live inside the merge_display_name_into_username section.
  "20260806171411": { kind: "replayed", marker: "merge_display_name_into_username" },
  "20260806171458": { kind: "replayed", marker: "merge_display_name_into_username" },
  "20260807085951": { kind: "replayed", marker: "password_security" },
  "20260807094359": { kind: "replayed", marker: "password_security" },
  "20260807172906": { kind: "replayed", marker: "scope_sq_app_social_reads" },
  // The replica replays only the parts of this that can exist there: the demo
  // schema is excluded (pg_cron) and cron.schedule has no equivalent, so the
  // waitlist policy is what the marker names.
  "20260807172926": { kind: "replayed", marker: "20260807 db_hygiene" },
  // Folded into the replica's analytics_sql_aggregates section: it only
  // recreates dashboard_orders_aggregate, which is defined there.
  "20260808104219": { kind: "replayed", marker: "recent_orders_id" },
};

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    fail(
      "SUPABASE_DB_URL is not set.\n" +
        "  Supabase exposes supabase_migrations only over Postgres, not PostgREST, so this\n" +
        "  needs the direct connection URI (Dashboard -> Project Settings -> Database).\n" +
        "  It contains the database password: put it in .env.local, never in git.",
    );
  }

  const replicaPath = join(process.cwd(), "tests", "db", "prod-migrations.sql");
  let replica: string;
  try {
    replica = readFileSync(replicaPath, "utf8");
  } catch {
    fail(`Could not read ${replicaPath}.`);
  }

  const client = new pg.Client({ connectionString });
  let applied: { version: string; name: string }[];
  try {
    await client.connect();
    const { rows } = await client.query<{ version: string; name: string }>(
      "select version, name from supabase_migrations.schema_migrations order by version",
    );
    applied = rows;
  } catch (error) {
    fail(
      `Could not read supabase_migrations.schema_migrations: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    await client.end().catch(() => {});
  }

  const unreviewed: { version: string; name: string }[] = [];
  const absent: { version: string; name: string; marker: string }[] = [];
  const excluded: { version: string; name: string; reason: string }[] = [];

  for (const row of applied) {
    const disposition = TRIAGE[row.version];
    if (!disposition) {
      unreviewed.push(row);
      continue;
    }
    if (disposition.kind === "excluded") {
      excluded.push({ ...row, reason: disposition.reason });
      continue;
    }
    // The marker is the identifying name in the replica's `-- ===== ` banners.
    if (!replica.includes(disposition.marker)) {
      absent.push({ ...row, marker: disposition.marker });
    }
  }

  console.log(
    `Checked ${applied.length} applied migrations against tests/db/prod-migrations.sql`,
  );
  if (excluded.length > 0) {
    console.log(`\n  ${excluded.length} deliberately excluded:`);
    for (const row of excluded) {
      console.log(`    - ${row.version} ${row.name}\n      ${row.reason}`);
    }
  }

  if (unreviewed.length === 0 && absent.length === 0) {
    console.log("\n✔ The test replica reflects production.\n");
    return;
  }

  if (unreviewed.length > 0) {
    console.error(
      `\n✖ ${unreviewed.length} migration(s) applied in prod but not triaged here.` +
        "\n  Read each one, add it to tests/db/prod-migrations.sql if it touches anything" +
        "\n  the tests should see, then record it in the TRIAGE table in this script:",
    );
    for (const row of unreviewed) {
      console.error(`    - ${row.version} ${row.name}`);
    }
  }

  if (absent.length > 0) {
    console.error(
      `\n✖ ${absent.length} migration(s) triaged as replayed but their marker is not in the replica:`,
    );
    for (const row of absent) {
      console.error(`    - ${row.version} ${row.name} (expected marker "${row.marker}")`);
    }
  }

  console.error("");
  process.exit(1);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
