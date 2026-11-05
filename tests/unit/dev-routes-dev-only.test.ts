import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

// /dev/* has to be absent from a production build, not just answer 404 there.
// next.config.ts only teaches `next dev` the .dev extension, so the whole
// guarantee rests on every harness route carrying it: one plain page.tsx under
// src/app/dev would quietly ship.

const HARNESS = join("src", "app", "dev");
const ROUTE_FILE = /^(page|route|layout|loading|error|not-found|template|default)\.(tsx|ts|jsx|js)$/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("the /dev harness only exists under next dev", () => {
  const files = filesUnder(HARNESS);

  it("names no harness route in a way a production build would pick up", () => {
    expect(files.filter((file) => ROUTE_FILE.test(basename(file)))).toEqual([]);
  });

  it("still has harness routes for this to be about", () => {
    expect(files.some((file) => basename(file) === "page.dev.tsx")).toBe(true);
  });

  it("only adds the dev extension on a development server", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toMatch(
      /pageExtensions: isDev \? \[\.\.\.DEV_ONLY_PAGE_EXTENSIONS, \.\.\.PAGE_EXTENSIONS\] : PAGE_EXTENSIONS/,
    );
    expect(config).toMatch(/const isDev = process\.env\.NODE_ENV === "development"/);
  });
});
