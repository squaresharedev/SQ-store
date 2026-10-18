// The deploy gate's list is only worth having if it cannot fall behind the
// migrations it stands for. These tests are what makes "add a migration" mean
// "add its sentinel": a new file in supabase/migrations that nothing in
// scripts/lib/prod-schema.ts names fails here, before it can deploy unchecked.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HAND_APPLIED_FROM,
  SCHEMA_REQUIREMENTS,
  UNPROBED_MIGRATIONS,
  buildProbeSql,
  describeRequirement,
  missingRequirements,
  type SchemaRequirement,
} from "../../scripts/lib/prod-schema.ts";

const migrationFiles = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((file) =>
  file.endsWith(".sql"),
);

describe("the production schema requirements", () => {
  it("name every hand-applied migration, or say why not", () => {
    const named = new Set(SCHEMA_REQUIREMENTS.map((requirement) => requirement.migration));
    const unaccounted = migrationFiles.filter(
      (file) =>
        file.slice(0, HAND_APPLIED_FROM.length) >= HAND_APPLIED_FROM &&
        !named.has(file) &&
        !(file in UNPROBED_MIGRATIONS),
    );
    expect(unaccounted).toEqual([]);
  });

  it("only name migrations that exist", () => {
    const known = new Set(migrationFiles);
    const stray = [
      ...SCHEMA_REQUIREMENTS.map((requirement) => requirement.migration),
      ...Object.keys(UNPROBED_MIGRATIONS),
    ].filter((file) => !known.has(file));
    expect(stray).toEqual([]);
  });
});

describe("the probe", () => {
  const requirements: SchemaRequirement[] = [
    { kind: "relation", name: "discounts", migration: "a.sql" },
    { kind: "column", table: "orders", column: "tracking_carrier", migration: "b.sql" },
    { kind: "function", signature: "order_mark_shipped(uuid,text,text)", migration: "b.sql" },
    { kind: "check", constraint: "orders_channel_check", allows: "button", migration: "c.sql" },
  ];

  it("asks one question per requirement, in order", () => {
    const sql = buildProbeSql(requirements);
    expect(sql).toContain("(0, (to_regclass('public.discounts') is not null))");
    expect(sql).toContain("a.attname = 'tracking_carrier'");
    expect(sql).toContain("to_regprocedure('public.order_mark_shipped(uuid,text,text)')");
    expect(sql).toContain("like '%''button''%'");
    expect(sql.match(/\(\d+, \(/g)).toHaveLength(requirements.length);
  });

  it("reads the catalog, which a role with no table privileges can still see", () => {
    expect(buildProbeSql()).not.toContain("information_schema");
  });

  it("reports exactly what is absent", () => {
    const rows = [
      { position: 0, present: true },
      { position: 1, present: false },
      { position: 2, present: true },
      { position: 3, present: false },
    ];
    expect(missingRequirements(rows, requirements).map(describeRequirement)).toEqual([
      "column public.orders.tracking_carrier",
      "constraint orders_channel_check accepting 'button'",
    ]);
  });

  it("never reads an answer it cannot line up as a pass", () => {
    expect(() => missingRequirements([], requirements)).toThrow();
    expect(() =>
      missingRequirements(
        [
          { position: 1, present: true },
          { position: 0, present: true },
          { position: 2, present: true },
          { position: 3, present: true },
        ],
        requirements,
      ),
    ).toThrow();
  });
});
