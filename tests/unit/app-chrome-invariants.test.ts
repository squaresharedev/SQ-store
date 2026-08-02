// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * CHROME INVARIANTS for the App Router.
 *
 * A `loading.tsx` renders in place of the PAGE, inside that segment's LAYOUT.
 * So wherever the dashboard chrome comes from decides whether a skeleton
 * appears inside the app or instead of it:
 *
 *   - chrome in the LAYOUT  -> the sidebar stays on screen, the skeleton fills
 *                              the content column, nothing moves when data lands;
 *   - chrome in the PAGE    -> the skeleton renders bare. The left menu vanishes
 *                              for the length of the query and the placeholders
 *                              stretch across where it had been, then everything
 *                              jumps sideways when the page resolves.
 *
 * /storefront shipped in the second shape: the page rendered <DashboardShell>
 * itself while its loading.tsx did not. It was fixed by moving the shell into
 * a (list) route-group layout. These tests state the rule so the next route
 * cannot quietly reintroduce it.
 */

const APP_DIR = join(process.cwd(), "src", "app");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(APP_DIR);
const rel = (file: string) => relative(APP_DIR, file).split(sep).join("/");
const basename = (file: string) => file.split(sep).pop() ?? "";

describe("dashboard chrome placement", () => {
  it("is rendered only by layouts, never by a page", () => {
    // A page that renders the shell cannot share it with its own loading.tsx,
    // because the fallback replaces the page. Layouts persist across the swap.
    const offenders = files
      .filter((file) => /^(page|loading|template)\.tsx$/.test(basename(file)))
      .filter((file) => readFileSync(file, "utf8").includes("<DashboardShell"))
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it("gives every dashboard-chromed section its shell above the loading state", () => {
    // For each loading.tsx, walk up to the app root looking for a layout that
    // supplies the shell. If some ancestor layout has it, the skeleton is
    // wrapped. If none does, that route's skeleton renders bare, which is only
    // acceptable for routes that are intentionally full-screen or unauthed.
    const CHROMELESS_BY_DESIGN = new Set<string>([
      // Add a route here only if it genuinely renders without the sidebar.
      // The storefront EDITOR is full-screen: no sidebar exists on the real
      // page, so its skeleton must not pretend otherwise.
      "storefront/[id]/loading.tsx",
    ]);

    const unwrapped: string[] = [];
    for (const file of files.filter((f) => basename(f) === "loading.tsx")) {
      let dir = join(file, "..");
      let wrapped = false;
      while (dir.startsWith(APP_DIR)) {
        const layout = join(dir, "layout.tsx");
        if (
          files.includes(layout) &&
          readFileSync(layout, "utf8").includes("<DashboardShell")
        ) {
          wrapped = true;
          break;
        }
        dir = join(dir, "..");
      }
      if (!wrapped && !CHROMELESS_BY_DESIGN.has(rel(file))) unwrapped.push(rel(file));
    }

    expect(unwrapped).toEqual([]);
  });
});
