/**
 * Each route group ships only part of the message catalogue to the browser
 * (src/i18n/scopes.ts). This fails when something the browser will resolve is
 * not in the part its group ships, which would show a visitor a raw key (and
 * only in the pages nobody clicked through).
 *
 * What counts as "the browser will resolve it":
 *   - every key literal in a module that ends up in the CLIENT bundle: a
 *     "use client" file and everything it imports, however plain (the global
 *     search's registry is an ordinary module full of Storefront keys);
 *   - every key a server action returns, which the client renders;
 *   - a key a server component hands down as a MessageRef (`msg("...")` or a
 *     `key: "..."` field), which a client component resolves.
 *
 * Keys are checked whole, against whole namespaces or subtrees
 * ("Storefront.settings"), so a scope can stay as small as the page needs.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en";
import { CLIENT_SCOPES, scopeEntries, type ClientScope } from "@/i18n/scopes";

/** Prose in comments names namespaces ("the subtitle says Storefront") without using them. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SRC = path.resolve(__dirname, "../../src");
const root = SRC.split(path.sep).join("/");
const files = new Map<string, string>();
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) files.set(full.split(path.sep).join("/"), withoutComments(readFileSync(full, "utf8")));
  }
})(SRC);

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? `${root}/${spec.slice(2)}`
    : spec.startsWith(".")
      ? path.posix.join(path.posix.dirname(from), spec)
      : null;
  if (!base) return null;
  return [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((c) => files.has(c)) ?? null;
}

const imports = new Map<string, string[]>();
for (const [file, source] of files) {
  const found = new Set<string>();
  // Type-only imports never reach a bundle.
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\s)[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const target = resolveImport(file, m[1] ?? m[2]);
    if (target) found.add(target);
  }
  imports.set(file, [...found]);
}

function closure(start: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...(imports.get(file) ?? []));
  }
  return seen;
}

const NAMESPACES = Object.keys(messages);
const NS = NAMESPACES.join("|");
/** A key, or the fixed front of a template-literal key (which then ends in "."). */
const KEY = new RegExp("[\"'`]((?:" + NS + ")(?:[.][A-Za-z0-9_]+)*[.]?)(?=[\"'`$])", "g");
const HANDED_DOWN = new RegExp("(?:msg\\(\\s*|key:\\s*)[\"'`]((?:" + NS + ")(?:[.][A-Za-z0-9_]+)*[.]?)", "g");
const HOOK = /useTranslations\(\s*["']([A-Za-z0-9_.]+)["']/g;

const isClient = (source: string) => /^\s*["']use client["']/.test(source);
const isAction = (file: string, source: string) =>
  /^\s*["']use server["']/.test(source) || /\/actions?\.ts$|\/actions\//.test(file);

/** Everything the browser side of a route group can ask the catalogue for. */
function requiredKeys(dirs: string[]): Map<string, string> {
  const group = closure([...files.keys()].filter((f) => dirs.some((d) => f.startsWith(`${root}/${d}/`))));
  const clientBundle = closure([...group].filter((f) => isClient(files.get(f)!)));
  const needed = new Map<string, string>();
  const note = (key: string, file: string) => needed.has(key) || needed.set(key, file.replace(`${root}/`, ""));

  for (const file of group) {
    const source = files.get(file)!;
    if (clientBundle.has(file) || isAction(file, source)) {
      for (const m of source.matchAll(KEY)) note(m[1], file);
      if (isClient(source)) for (const m of source.matchAll(HOOK)) note(m[1], file);
    } else {
      for (const m of source.matchAll(HANDED_DOWN)) note(m[1], file);
    }
  }
  return needed;
}

function covered(key: string, entries: readonly string[] | null): boolean {
  if (entries === null) return true;
  const whole = key.endsWith(".") ? key.slice(0, -1) : key;
  return entries.some((entry) => whole === entry || whole.startsWith(`${entry}.`));
}

const GROUPS: Record<string, { scope: ClientScope; dirs: string[] }> = {
  public: { scope: "public", dirs: ["app/(public)"] },
  auth: { scope: "auth", dirs: ["app/(auth)"] },
  app: { scope: "app", dirs: ["app/(dashboard)", "app/settings"] },
};

describe("client message scopes", () => {
  for (const [name, { scope, dirs }] of Object.entries(GROUPS)) {
    it(`the ${name} pages only reach for messages they ship`, () => {
      const entries = scopeEntries(scope);
      const missing = [...requiredKeys(dirs)]
        .filter(([key]) => !covered(key, entries))
        .map(([key, file]) => `${key} <- ${file}`);
      expect(missing).toEqual([]);
    });
  }

  it("names only namespaces and subtrees that exist", () => {
    for (const entries of Object.values(CLIENT_SCOPES)) {
      for (const entry of entries ?? []) {
        const node = entry.split(".").reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], messages);
        expect(node, entry).toBeTypeOf("object");
      }
    }
  });
});
