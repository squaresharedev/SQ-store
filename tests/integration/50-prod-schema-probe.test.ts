/**
 * The production schema gate (scripts/check-prod-schema.ts) against the
 * replayed schema.
 *
 * tests/db/prod-migrations.sql mirrors what production runs, so every
 * requirement in SCHEMA_REQUIREMENTS must hold here too. A requirement that
 * fails against the replica can never pass against production either, and
 * holds every deploy at "Check production has this build's schema" even after
 * the migration is applied: that happened on 2026-11-18, when a `body`
 * sentinel quoted text from the migration's header comment instead of from
 * the function itself. This runs the exact probe CI runs, so a sentinel that
 * does not match the code it names fails here first.
 */
import { afterAll, describe, expect, it } from "vitest";
import { asSuper, closePool } from "../db/client";
import {
  SCHEMA_REQUIREMENTS,
  buildProbeSql,
  describeRequirement,
  missingRequirements,
  type ProbeRow,
} from "../../scripts/lib/prod-schema";

afterAll(closePool);

describe("production schema gate, against the replica", () => {
  it("finds every requirement in the replayed schema", async () => {
    const { rows } = await asSuper((q) => q.query<ProbeRow>(buildProbeSql()));
    const missing = missingRequirements(rows).map(describeRequirement);
    expect(missing).toEqual([]);
    expect(rows).toHaveLength(SCHEMA_REQUIREMENTS.length);
  });
});
