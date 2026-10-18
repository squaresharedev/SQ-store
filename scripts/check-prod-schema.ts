// Does production have the schema this build needs?
//
// The deploy gate for hand-applied migrations: scripts/lib/prod-schema.ts holds
// the list and the reasoning. This file only connects, asks, and reports.
//
//   pnpm check:schema
//
// READ-ONLY. One SELECT over pg_catalog. It needs no table privileges, so the
// right credential is a role that can log in and nothing else.
//
// TWO WAYS IN, whichever is configured:
//   SUPABASE_DB_URL        a Postgres connection URI (what CI should hold, for
//                          a read-only role).
//   SUPABASE_ACCESS_TOKEN  plus NEXT_PUBLIC_SUPABASE_URL: the Management API
//                          query endpoint in its read-only mode. Convenient on
//                          a laptop that already has the token; too powerful a
//                          credential to hand to CI.
//
// EXIT CODES. 0 = everything is there. 1 = asked, and something is missing
// (each object is named with the migration that adds it). 2 = could not ask at
// all. The caller decides what an unanswered question means; a deploy should
// not treat it as a yes.
//
// The code is SET, never forced with process.exit(): exiting while fetch still
// holds a socket aborts Node on Windows and replaces the code with its own.

import pg from "pg";
import {
  SCHEMA_REQUIREMENTS,
  buildProbeSql,
  describeRequirement,
  missingRequirements,
  type ProbeRow,
} from "./lib/prod-schema.ts";

const EXIT_MISSING = 1;
const EXIT_UNANSWERED = 2;

async function askPostgres(connectionString: string, sql: string): Promise<ProbeRow[]> {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const { rows } = await client.query<ProbeRow>(sql);
    return rows;
  } finally {
    await client.end().catch(() => {});
  }
}

async function askManagementApi(token: string, projectUrl: string, sql: string): Promise<ProbeRow[]> {
  const ref = new URL(projectUrl).hostname.split(".")[0];
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!response.ok) {
    throw new Error(`The Management API answered ${response.status}.`);
  }
  return (await response.json()) as ProbeRow[];
}

/** The probe's answer, or null when nothing is configured to ask with. */
async function ask(sql: string): Promise<ProbeRow[] | null> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) return askPostgres(dbUrl, sql);

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (token && projectUrl) return askManagementApi(token, projectUrl, sql);

  return null;
}

async function main(): Promise<number> {
  let rows: ProbeRow[] | null;
  try {
    rows = await ask(buildProbeSql());
  } catch (error) {
    console.error(
      `\n✖ Could not read the schema: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_UNANSWERED;
  }
  if (!rows) {
    console.error(
      "\n✖ No way to reach the database.\n" +
        "  Set SUPABASE_DB_URL (a read-only role's connection URI), or\n" +
        "  SUPABASE_ACCESS_TOKEN together with NEXT_PUBLIC_SUPABASE_URL.\n",
    );
    return EXIT_UNANSWERED;
  }

  const missing = missingRequirements(rows);
  if (missing.length === 0) {
    console.log(
      `\n✔ Production has all ${SCHEMA_REQUIREMENTS.length} schema objects this build needs.\n`,
    );
    return 0;
  }

  console.error(
    `\n✖ Production is missing ${missing.length} schema object(s) this build needs.` +
      "\n  Apply each migration BEFORE deploying, then record it in tests/db/prod-migrations.sql:",
  );
  for (const requirement of missing) {
    console.error(
      `    - ${describeRequirement(requirement)}\n      supabase/migrations/${requirement.migration}`,
    );
  }
  console.error("");
  return EXIT_MISSING;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT_UNANSWERED;
  },
);
