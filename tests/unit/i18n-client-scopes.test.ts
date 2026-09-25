/**
 * Each route group ships only some of the message catalogue to the browser
 * (src/i18n/scopes.ts). This walks what every group can render on the client
 * and fails when a client component, or a server action's result, names a
 * namespace the group does not ship. That would show a raw key to a visitor,
 * and only in the languages and pages nobody clicked through.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_SCOPES, scopeNamespaces, type ClientScope } from "@/i18n/scopes";

const SRC = path.resolve(__dirname, "../../src");
const files = new Map<string, string>();
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) files.set(full.split(path.sep).join("/"), readFileSync(full, "utf8"));
  }
})(SRC);

const root = SRC.split(path.sep).join("/");
const resolveImport = (from: string, spec: string): string | null => {
  const base = spec.startsWith("@/") ? `${root}/${spec.slice(2)}` : spec.startsWith(".") ? path.posix.join(path.posix.dirname(from), spec) : null;
  if (!base) return null;
  return [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((c) => files.has(c)) ?? null;
};

const imports = new Map<string, string[]>();
for (const [file, source] of files) {
  const found = new Set<string>();
  for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const target = resolveImport(file, m[1]);
    if (target) found.add(target);
  }
  imports.set(file, [...found]);
}

function reachable(prefixes: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...files.keys()].filter((f) => prefixes.some((p) => f.startsWith(`${root}/${p}`)));
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...(imports.get(file) ?? []));
  }
  return [...seen];
}

const NAMESPACES = ["Common", "LocaleSwitcher", "Nav", "ErrorPage", "Errors", "Validation", "Auth", "Dashboard", "Onboarding", "Notifications", "Search", "Orders", "Analytics", "Payments", "Settings", "Products", "ProductPage", "Storefront"];
const KEY_LITERAL = new RegExp(`["'\`](${NAMESPACES.join("|")})[.][A-Za-z0-9_.]+`, "g");
const HOOK = /useTranslations\(\s*["']([A-Za-z]+)/g;

/** Namespaces the browser side of `file` can ask for. */
function clientNamespaces(file: string, source: string): string[] {
  const isClient = /^\s*["']use client["']/.test(source);
  const isAction = /\/actions?\.ts$|\/actions\//.test(file);
  const names = new Set<string>();
  if (isClient) for (const m of source.matchAll(HOOK)) names.add(m[1]);
  // Keys travel in a client file's props and in a server action's result.
  if (isClient || isAction) for (const m of source.matchAll(KEY_LITERAL)) names.add(m[1]);
  return [...names];
}

const GROUPS: Record<string, { scope: ClientScope; dirs: string[] }> = {
  public: { scope: "public", dirs: ["app/(public)"] },
  auth: { scope: "auth", dirs: ["app/(auth)"] },
  app: { scope: "app", dirs: ["app/(dashboard)", "app/settings"] },
};

describe("client message scopes", () => {
  for (const [name, { scope, dirs }] of Object.entries(GROUPS)) {
    it(`the ${name} pages only reach for namespaces they ship`, () => {
      const shipped = new Set(scopeNamespaces(scope));
      const missing: string[] = [];
      for (const file of reachable(dirs)) {
        for (const ns of clientNamespaces(file, files.get(file)!)) {
          if (!shipped.has(ns as never)) missing.push(`${ns} <- ${file.replace(`${root}/`, "")}`);
        }
      }
      expect(missing).toEqual([]);
    });
  }

  it("names only namespaces that exist", () => {
    for (const names of Object.values(CLIENT_SCOPES)) {
      for (const ns of names ?? []) expect(NAMESPACES).toContain(ns);
    }
  });
});
