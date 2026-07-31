/**
 * Vitest global setup for the "db" project.
 *
 * Boots a REAL PostgreSQL 17 server (embedded-postgres, binaries vendored via
 * npm — no Docker, no admin rights), then replays the Supabase shim + the
 * exact production migration history onto it. Every integration test runs
 * against this hermetic instance; production/dev Supabase is never touched.
 *
 * Why not a Supabase branch? Branching requires the Pro plan and the free org
 * is at its 2-project cap, so this embedded replica (same PG major, same DDL,
 * same roles/claims model PostgREST uses) is the isolation mechanism.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

const PORT = 55_432 + Math.floor(Math.random() * 500);
const DB_NAME = "sqstore_test";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const dataDir = mkdtempSync(join(tmpdir(), "sqstore-pg-"));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);

  const url = `postgres://postgres:postgres@localhost:${PORT}/${DB_NAME}`;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const here = join(__dirname);
    const shim = readFileSync(join(here, "shim.sql"), "utf8");
    const migrations = readFileSync(join(here, "prod-migrations.sql"), "utf8");
    await client.query(shim);
    await client.query(migrations);
  } finally {
    await client.end();
  }

  project.provide("dbUrl", url);

  return async () => {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}
