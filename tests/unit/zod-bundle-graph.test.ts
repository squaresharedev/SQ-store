/**
 * Graph tests for the buyer-page bundle.
 *
 * 1. zod must not appear in the client import closure of the root layout or
 *    any public route page. The root layout's service worker registrar is the
 *    biggest historic offender: it imported PUBLIC_PAGES_PREFIX which pulled in
 *    uuidField -> zod, adding ~40 KB gz to every page on the app.
 *
 *    Walk strategy:
 *      PHASE 1 (server graph): Walk from each entry file through all imports.
 *        - Stop at "use client" files: they are client bundle entries, not
 *          traversed further from the server side.
 *        - Stop at "use server" modules (actions): their exports reach the
 *          browser as opaque references, not evaluated module code.
 *        - Ignore type-only imports (never reach a bundle).
 *      PHASE 2 (client graph): Walk from every "use client" boundary found in
 *        Phase 1, again skipping "use server" modules.
 *      ASSERTION: no file in the Phase 2 closure imports "zod".
 *
 * 2. isUuid from predicates.ts must agree with z.uuid().safeParse on a
 *    representative sample. The predicate is a copy of zod's internal regex;
 *    this keeps them from drifting.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { isUuid } from "@/lib/validation/predicates";
import { uuidField } from "@/lib/validation/inputs";

// ── File index ─────────────────────────────────────────────────────────────

const SRC = path.resolve(__dirname, "../../src");
const root = SRC.split(path.sep).join("/");
const files = new Map<string, string>();
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) {
      files.set(full.split(path.sep).join("/"), readFileSync(full, "utf8"));
    }
  }
})(SRC);

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? `${root}/${spec.slice(2)}`
    : spec.startsWith(".")
      ? path.posix.join(path.posix.dirname(from), spec)
      : null;
  if (!base) return null;
  return (
    [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((c) =>
      files.has(c),
    ) ?? null
  );
}

/** All non-type, non-external imports from a source file. */
function directImports(source: string, from: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(?!type\s)[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g,
  )) {
    const target = resolveImport(from, m[1] ?? m[2]);
    if (target) found.add(target);
  }
  return [...found];
}

const isClientModule = (source: string) => /^\s*["']use client["']/.test(source);
const isServerModule = (source: string, file: string) =>
  /^\s*["']use server["']/.test(source) || /\/actions?\.ts$|\/actions\//.test(file);

/**
 * Returns the client-side module closure reachable from the given entry
 * files (which are typically server components like layout.tsx or page.tsx).
 *
 * Phase 1: walk from entries through non-"use client" imports, collecting
 *   "use client" files as client bundle entry points (not traversed further
 *   from the server side).
 * Phase 2: walk from each client entry point through non-"use server" imports.
 *   The resulting set is the client bundle.
 */
function clientBundleOf(entryPaths: string[]): Set<string> {
  // Phase 1: server-side walk to find client entry points
  const serverSeen = new Set<string>();
  const clientEntries = new Set<string>();
  const serverStack = entryPaths.filter((f) => files.has(f));

  while (serverStack.length) {
    const file = serverStack.pop()!;
    if (serverSeen.has(file) || clientEntries.has(file)) continue;
    const source = files.get(file);
    if (!source) continue;

    if (isServerModule(source, file)) continue;

    if (isClientModule(source)) {
      // Client boundary: record but do not traverse from the server side.
      clientEntries.add(file);
      continue;
    }

    serverSeen.add(file);
    for (const imp of directImports(source, file)) {
      serverStack.push(imp);
    }
  }

  // Phase 2: client-side walk from each client entry
  const clientSeen = new Set<string>();
  const clientStack = [...clientEntries];

  while (clientStack.length) {
    const file = clientStack.pop()!;
    if (clientSeen.has(file)) continue;
    const source = files.get(file);
    if (!source) continue;
    if (isServerModule(source, file)) continue; // "use server" is a server action boundary

    clientSeen.add(file);
    for (const imp of directImports(source, file)) {
      clientStack.push(imp);
    }
  }

  return clientSeen;
}

/** True when any non-comment line in source does `import ... from "zod"`. */
function importsZod(source: string): boolean {
  // Strip comments first so a "// import ... from 'zod'" note does not trip it.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return /(?:^|\n)\s*import\s+(?!type\s)[^;]+from\s*["']zod["']/.test(stripped);
}

function zodModulesIn(closure: Set<string>): string[] {
  return [...closure]
    .filter((f) => {
      const src = files.get(f);
      return src && importsZod(src);
    })
    .map((f) => f.replace(`${root}/`, ""));
}

function routeFiles(dir: string): string[] {
  const dirFull = `${root}/${dir}`;
  return [...files.keys()].filter(
    (f) => f.startsWith(`${dirFull}/`) && /\/(page|layout)\.(tsx|ts)$/.test(f),
  );
}

// ── Test 1: no zod in buyer-page client closures ───────────────────────────

describe("zod-free buyer-page bundles", () => {
  it("root layout client bundle contains no zod", () => {
    const layoutFile = `${root}/app/layout.tsx`;
    const bundle = clientBundleOf([layoutFile]);
    const zoddedModules = zodModulesIn(bundle);
    expect(zoddedModules, "these modules import zod and are in the root layout client bundle").toEqual([]);
  });

  it("public route pages client bundle contains no zod", () => {
    const entries = [
      `${root}/app/layout.tsx`,
      ...routeFiles("app/(public)"),
    ];
    const bundle = clientBundleOf(entries);
    const zoddedModules = zodModulesIn(bundle);
    expect(zoddedModules, "these modules import zod and are in the public route-pages client bundle").toEqual([]);
  });
});

// ── Test 2b: auth route pages (noted as future work) ──────────────────────

// LoginForm imports auth-constants.ts (zod-free), but its sibling import of
// lib/resilient-action.ts drags in lib/errors.ts -> lib/billing/plans.ts ->
// lib/pricing/enums.ts (z.enum top-level), which pulls zod back in through
// that chain. Fixing requires splitting errors.ts or plans.ts.
//
// Chain: LoginForm -> lib/resilient-action.ts -> lib/errors.ts
//     -> lib/billing/plans.ts -> lib/pricing/enums.ts (z.enum top-level)
it.todo("app/(auth) route pages client bundle contains no zod");

// ── Test 3: editor and designer code excluded from buyer-page bundles ─────

/** True when the bundle includes a file whose basename matches the given
 *  partial path. Using a partial path rather than a full one keeps the test
 *  readable when the failing module is renamed. */
function bundleIncludes(bundle: Set<string>, partial: string): boolean {
  const needle = partial.split("/").join(path.sep === "\\" ? "/" : path.sep);
  for (const f of bundle) {
    if (f.includes(needle)) return true;
  }
  return false;
}

describe("editor modules absent from buyer-page bundles", () => {
  // Guard the STOREFRONT and PRODUCT-PAGE view entries specifically: the
  // in-place editors belong to the designer canvas, not to the read-only
  // buyer view. The checkout and order pages are intentionally excluded here
  // because the checkout DOES legitimately load PlainTextEditor for its
  // editable delivery fields; that is a separate surface with different rules.
  const buyerViewEntries = [
    `${root}/app/layout.tsx`,
    `${root}/app/(public)/layout.tsx`,
    // Storefront listing
    `${root}/app/(public)/s/[storefrontId]/page.tsx`,
    // Product detail page
    `${root}/app/(public)/s/[storefrontId]/p/[productId]/page.tsx`,
    // Embed frame
    `${root}/app/(public)/e/[key]/[...sites]/page.tsx`,
  ];
  // Computed once; each assertion reads from this shared set.
  let bundle: Set<string>;
  beforeAll(() => {
    bundle = clientBundleOf(buyerViewEntries);
  });

  it("InlineTextEditor is not in the storefront/product-page buyer bundle", () => {
    expect(
      bundleIncludes(bundle, "components/storefront/InlineTextEditor"),
      "InlineTextEditor reached buyer pages",
    ).toBe(false);
  });

  it("MastheadLineEditor is not in the storefront/product-page buyer bundle", () => {
    expect(
      bundleIncludes(bundle, "components/storefront/MastheadLineEditor"),
      "MastheadLineEditor reached buyer pages",
    ).toBe(false);
  });

  it("PlainTextEditor is not in the storefront/product-page buyer bundle", () => {
    // The checkout page uses PlainTextEditor (EditableText), but the product
    // detail page and storefront listing must not pull it in.
    expect(
      bundleIncludes(bundle, "components/storefront/PlainTextEditor"),
      "PlainTextEditor reached buyer pages",
    ).toBe(false);
  });

  it("BadgeDrag is not in the storefront/product-page buyer bundle", () => {
    expect(
      bundleIncludes(bundle, "components/product-page/BadgeDrag"),
      "BadgeDrag reached buyer pages",
    ).toBe(false);
  });

  it("config-maps is not reachable from CustomFontFace alone", () => {
    // CustomFontFace is on the buyer-page critical path (embedded in
    // StorefrontBoard). After the custom-font.ts split it must not drag in
    // config-maps, which carries all designer font-class definitions.
    const customFontBundle = clientBundleOf([
      `${root}/components/storefront/CustomFontFace.tsx`,
    ]);
    expect(
      bundleIncludes(customFontBundle, "components/storefront/config-maps"),
      "config-maps was reachable from CustomFontFace",
    ).toBe(false);
  });
});

// ── Test 2: isUuid parity with z.uuid() ───────────────────────────────────

const schema = uuidField();

function zodAccepts(value: string): boolean {
  return schema.safeParse(value).success;
}

describe("isUuid parity with uuidField()", () => {
  const cases: [string, string][] = [
    // Valid UUIDs
    ["v4 lowercase", "550e8400-e29b-41d4-a716-446655440000"],
    ["v4 uppercase", "550E8400-E29B-41D4-A716-446655440000"],
    ["v4 mixed case", "550E8400-e29b-41D4-A716-446655440000"],
    ["v7", "01932c01-4a2b-7001-b6e8-4d1234567890"],
    ["nil UUID (all zeros)", "00000000-0000-0000-0000-000000000000"],
    ["max UUID (all f)", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
    // Invalid
    ["with leading whitespace", " 550e8400-e29b-41d4-a716-446655440000"],
    ["with trailing whitespace", "550e8400-e29b-41d4-a716-446655440000 "],
    ["brace-wrapped", "{550e8400-e29b-41d4-a716-446655440000}"],
    ["wrong version digit (0)", "550e8400-e29b-01d4-a716-446655440000"],
    ["not a UUID", "not-a-uuid"],
    ["empty string", ""],
    ["too short", "550e8400-e29b-41d4-a716"],
    ["no hyphens", "550e8400e29b41d4a716446655440000"],
  ];

  for (const [label, value] of cases) {
    it(`agrees on "${label}"`, () => {
      expect(isUuid(value)).toBe(zodAccepts(value));
    });
  }
});
