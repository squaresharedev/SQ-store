// The reserved-handle list lives twice: RESERVED_USERNAMES for the form, and
// public.username_is_reserved for every other writer (the owner's direct
// PostgREST update, handle_new_user at signup). This keeps the SQL copy from
// drifting: a name added to one and not the other fails here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_USERNAMES } from "@/lib/validation/auth";

const MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261021_reserved_usernames.sql",
);

function sqlReservedList(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = sql.match(
    /function public\.username_is_reserved[\s\S]*?any \(array\[([\s\S]*?)\]\)/,
  );
  if (!body) throw new Error("username_is_reserved array not found in the migration");
  return [...body[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("reserved usernames in SQL", () => {
  it("match RESERVED_USERNAMES exactly", () => {
    expect([...sqlReservedList()].sort()).toEqual([...RESERVED_USERNAMES].sort());
  });

  it("are written in lower case, the form the check compares", () => {
    for (const name of sqlReservedList()) expect(name).toBe(name.toLowerCase());
  });
});
