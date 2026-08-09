// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * HARDENING INVARIANTS for the search surfaces.
 *
 * There are four boxes a search term can be typed into (the ⌘K palette, the
 * orders toolbar, the storefront designer's product picker, and the orders
 * `?q=` URL param, which nobody types into but anyone can edit), and they were
 * built at different times. The gates each one needs are the same, so they are
 * asserted here once rather than being remembered four times — the same
 * reasoning as `server-action-security.test.ts` and `validation-primitives`.
 *
 * The three properties:
 *
 *   SQL — every term reaching Postgres goes through `escapeIlike`. The value is
 *   parameterised by PostgREST regardless, so this is not what stops injection;
 *   what it stops is a term whose `%`/`_` silently change the match, and it is
 *   also where the length backstop lives. What WOULD be injection-shaped is
 *   PostgREST's `or=` filter, which takes a parsed expression — so no search
 *   path may build one from user text.
 *
 *   XSS — no sink. Results are React text nodes, and every href is built from
 *   an id or a URLSearchParams, never concatenated from the query.
 *
 *   LIMITS — every input declares a maxLength AND clamps in its handler, and
 *   every server entry point re-clamps, because a client bound is an
 *   affordance and never a gate.
 */

const SRC = join(process.cwd(), "src");

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL_SOURCES = walk(SRC).map((file) => ({
  path: file.slice(SRC.length + 1).replace(/\\/g, "/"),
  source: readFileSync(file, "utf8"),
}));

/** The files that own a search input, and the constant each one bounds by. */
const SEARCH_INPUTS = [
  {
    path: "components/search/SearchOverlay.tsx",
    limit: "MAX_QUERY_LENGTH",
  },
  {
    path: "components/orders/OrdersToolbar.tsx",
    limit: "ORDERS_SEARCH_MAX_LENGTH",
  },
  {
    path: "components/storefront/ProductPicker.tsx",
    limit: "PICKER_SEARCH_MAX_LENGTH",
  },
] as const;

describe("search inputs — the character limit", () => {
  it.each(SEARCH_INPUTS)(
    "$path declares maxLength from a named constant",
    ({ path, limit }) => {
      // A literal here would drift from the server's own cap the first time
      // either moved, and the drift is invisible until someone types past it.
      expect(read(path)).toContain(`maxLength={${limit}}`);
    },
  );

  it.each(SEARCH_INPUTS)(
    "$path also clamps the value it stores",
    ({ path, limit }) => {
      // maxLength is not applied to every path that can set a value (an IME
      // composition commits past it in some browsers, and programmatic sets
      // ignore it entirely), and the stored value is what the request is
      // built from.
      expect(read(path)).toContain(`slice(0, ${limit})`);
    },
  );

  it("the palette's cap is the same number the server enforces", () => {
    // The route 400s past MAX_QUERY_LENGTH and the client maps that to "can't
    // reach the server", so a client cap even one character looser reports a
    // network failure for a request that arrived perfectly.
    const types = read("lib/search/types.ts");
    const max = Number(types.match(/MAX_QUERY_LENGTH = (\d+)/)?.[1]);
    expect(max).toBeGreaterThan(0);
    // Same constant, imported — not a second literal that happens to agree.
    expect(read("components/search/SearchOverlay.tsx")).toMatch(
      /import \{[\s\S]*?MAX_QUERY_LENGTH[\s\S]*?\} from "@\/lib\/search\/types"/,
    );
    expect(read("lib/validation/search.ts")).toContain("MAX_QUERY_LENGTH");
  });

  it("the server re-clamps every term regardless of what the client sent", () => {
    // Three independent server-side bounds, because three different clients
    // reach them: the route's schema, the picker action's slice, and the
    // backstop inside escapeIlike that catches anything either missed.
    expect(read("lib/validation/search.ts")).toContain("max: MAX_QUERY_LENGTH");
    expect(read("lib/products/picker-actions.ts")).toContain(
      "slice(0, PICKER_SEARCH_MAX_LENGTH)",
    );
    expect(read("lib/supabase/ilike.ts")).toContain("MAX_ILIKE_TERM_LENGTH");
  });

  it("the orders ?q= param is bounded at the parse boundary", () => {
    // The only search term that reaches a query without passing an input.
    const page = read("app/(dashboard)/orders/page.tsx");
    expect(page).toContain("slice(0, ORDERS_SEARCH_MAX_LENGTH)");
  });
});

/**
 * Strip comments before scanning for CODE. Several of these modules explain
 * the very construct being banned ("TWO queries, not one `.or()`"), so a naive
 * scan reports the explanation as the offence.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/([^:])\/\/.*$/gm, "$1");
}

describe("search — the SQL surface", () => {
  it("finds the ilike call sites (guards against a broken scan)", () => {
    // Without this, a regex that stopped matching would make every assertion
    // below pass by finding nothing at all.
    const calls = ALL_SOURCES.flatMap(
      ({ source }) => code(source).match(/\.ilike\(\s*[^,]+,\s*[^)]*\)/g) ?? [],
    );
    expect(calls.length).toBeGreaterThanOrEqual(6);
  });

  it("every ilike pattern is built from an escaped term", () => {
    // A raw ilike("col", `%${term}%`) would let a typed % or _ change the
    // match, and would sidestep the length backstop that lives in the escape.
    // The pattern argument is either an inline template or a variable, so the
    // variable is resolved back to its assignment rather than trusted.
    const offenders: string[] = [];
    for (const { path, source } of ALL_SOURCES) {
      const body = code(source);
      for (const call of body.match(/\.ilike\(\s*[^,]+,\s*[^)]*\)/g) ?? []) {
        const argument = call.slice(call.indexOf(",") + 1, -1).trim();
        if (argument.includes("escapeIlike")) continue;
        // Otherwise the term arrived through a variable — either the whole
        // argument (`pattern`) or one interpolated into it (`%${escaped}%`).
        // Resolve each back to its assignment and check THAT for the escape.
        const referenced = [
          ...(argument.match(/^[A-Za-z_$][\w$]*$/) ?? []),
          ...Array.from(
            argument.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g),
            (m) => m[1],
          ),
        ];
        const escaped = referenced.some((identifier) =>
          body
            .match(new RegExp(`\\b${identifier}\\s*=\\s*[^;\\n]*`))?.[0]
            ?.includes("escapeIlike"),
        );
        if (escaped) continue;
        offenders.push(`${path}: ${call.replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the escaped value is what gets wrapped, not wrapped then escaped", () => {
    // `%${escapeIlike(term)}%` is right; `escapeIlike(`%${term}%`)` escapes the
    // caller's OWN wildcards and turns a contains match into an equality one.
    for (const { path, source } of ALL_SOURCES) {
      expect(code(source), path).not.toMatch(/escapeIlike\(\s*`%/);
    }
  });

  it("no search path builds a PostgREST or= filter from user text", () => {
    // `or=` takes a PARSED expression, so a comma, period or parenthesis in
    // the term corrupts it — the one place in this stack where user text
    // really does reach a query language. /api/search runs two ilike queries
    // instead, and this is what keeps it that way.
    const offenders = ALL_SOURCES.filter(
      ({ path, source }) =>
        /\/(search|orders|products)\//.test(`/${path}`) &&
        /\.or\(/.test(code(source)),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

describe("search — the XSS surface", () => {
  it("the app has no HTML-injection sink at all", () => {
    // The CSP in next.config.ts is report-only and cannot use a nonce on this
    // stack (see the comment there), so "there is no sink" is doing the actual
    // work rather than being a nice-to-have on top of a strict policy.
    const offenders = ALL_SOURCES.filter(({ source }) =>
      /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/.test(
        source,
      ),
    ).map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("no search result href is concatenated from the query", () => {
    // Result hrefs go to router.push. Every one is built from an id or through
    // URLSearchParams (which percent-encodes); interpolating the raw term
    // would be the one way to get a caller-shaped string into a navigation.
    const hrefs = read("lib/search/hrefs.ts");
    expect(hrefs).toContain("URLSearchParams");
    expect(hrefs).not.toMatch(/href.*\$\{.*(query|term|search)/i);
  });
});

describe("search — rate limits", () => {
  const limiter = read("lib/rate-limit.ts");

  /** Every search entry point, and the budget it must spend. */
  const GATED = [
    { path: "app/api/search/route.ts", budget: "searchQuery" },
    { path: "app/api/search/snapshot/route.ts", budget: "searchSnapshot" },
    { path: "lib/products/picker-actions.ts", budget: "pickerSearch" },
  ] as const;

  it.each(GATED)("$path spends the $budget budget", ({ path, budget }) => {
    const source = read(path);
    expect(source).toContain(`RATE_LIMITS.${budget}`);
    expect(source).toMatch(/rateLimit\(/);
    // Declared, not a typo resolving to undefined — which would make max and
    // window undefined and the limit silently meaningless.
    expect(limiter).toMatch(new RegExp(`^\\s{2}${budget}:\\s*\\{\\s*max:`, "m"));
  });

  it("both search routes take the budget BEFORE they query", () => {
    // A limiter spent after the work is a counter, not a limit.
    for (const path of [
      "app/api/search/route.ts",
      "app/api/search/snapshot/route.ts",
    ]) {
      const source = read(path);
      expect(source.indexOf("rateLimit("), path).toBeLessThan(
        source.indexOf(".from("),
      );
    }
  });
});
