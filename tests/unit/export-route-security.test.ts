// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SECURITY INVARIANTS for the data-export route.
 *
 * /settings/export is a GET that reads the caller's entire account and streams
 * it back as a file. Two properties make it safe, and both were once missing:
 *
 *   1. It takes from a rate-limit budget. Every other expensive surface in the
 *      app does; this one shipped without, making it the cheapest way to make
 *      the database do maximum work in a loop.
 *   2. It selects EXPLICIT columns. select("*") exported whatever the schema
 *      happened to contain, which by the time it was caught included R2 object
 *      paths and the storefront embed_key (a live secret). With explicit lists,
 *      a new column is NOT exported until someone decides it should be, which
 *      is the right default for a file that leaves our custody.
 *
 * These are source-level assertions in the style of
 * server-action-security.test.ts: route handlers sit outside that suite's
 * registry, so the invariants are pinned here.
 */

/** Strip // and block comments: the invariants are about CODE, and the module's
 *  own doc comment legitimately names the columns it excludes. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ROUTE = stripComments(
  readFileSync(
    join(process.cwd(), "src", "app", "settings", "export", "route.ts"),
    "utf8",
  ),
);

describe("export route security invariants", () => {
  it("takes from a rate-limit budget", () => {
    expect(ROUTE).toMatch(/rateLimit\(\s*"dataExport"/);
    // The budget must exist in the central registry, not be inlined ad hoc.
    expect(ROUTE).toContain("RATE_LIMITS.dataExport");
  });

  it("fails the request when the budget is exhausted", () => {
    // The 429 must be returned, not just computed.
    expect(ROUTE).toMatch(/status:\s*429/);
  });

  it("never selects * from any table", () => {
    expect(ROUTE).not.toMatch(/select\(\s*["'`]\s*\*/);
  });

  it("keeps infrastructure and secret columns out of the payload", () => {
    // R2 object paths and the embed credential must not appear anywhere in
    // this module; their absence from the column lists is the contract.
    for (const forbidden of ["image_key", "digital_file_key", "embed_key"]) {
      expect(ROUTE).not.toContain(forbidden);
    }
  });

  it("still authenticates before doing any work", () => {
    expect(ROUTE).toMatch(/status:\s*401/);
    expect(ROUTE).toContain("auth.getUser()");
  });
});

describe("security headers", () => {
  const CONFIG = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

  it("denies framing and MIME sniffing app-wide", () => {
    expect(CONFIG).toContain('"X-Frame-Options"');
    expect(CONFIG).toContain('"DENY"');
    expect(CONFIG).toContain('"X-Content-Type-Options"');
    expect(CONFIG).toContain('"nosniff"');
    expect(CONFIG).toContain('"Referrer-Policy"');
  });

  it("forces HTTPS across every subdomain", () => {
    // The session cookie is scoped to .squareshare.eu, so ONE sibling served
    // over plaintext is enough to leak it. includeSubDomains is the point.
    expect(CONFIG).toContain('"Strict-Transport-Security"');
    expect(CONFIG).toContain("includeSubDomains");
  });

  describe("content security policy", () => {
    it("ships the directives that do not need a nonce", () => {
      // A nonce is unavailable on this stack (Next 16 Proxy is Node-only,
      // OpenNext rejects Node middleware), so script-src/style-src must keep
      // 'unsafe-inline'. These five are what the policy is actually FOR, and
      // each closes a distinct hole: framing, base-tag injection, plugin
      // content, offsite form posts, and everything not otherwise named.
      expect(CONFIG).toContain("default-src 'self'");
      expect(CONFIG).toContain("frame-ancestors 'none'");
      expect(CONFIG).toContain("base-uri 'self'");
      expect(CONFIG).toContain("form-action 'self'");
      expect(CONFIG).toContain("object-src 'none'");
    });

    it("allows the Supabase realtime socket", () => {
      // connect-src is the directive most likely to break something real: the
      // notification bell holds a wss: Realtime subscription, and omitting the
      // scheme kills live notifications silently rather than loudly.
      expect(CONFIG).toMatch(/wss:/);
      expect(CONFIG).toContain("connect-src 'self'");
    });

    it("is still report-only", () => {
      // Deliberate: this policy has not yet run against real traffic. Flipping
      // to enforcement is a separate, considered step — when it happens, this
      // assertion should be inverted rather than deleted, so the change is
      // impossible to make by accident.
      expect(CONFIG).toContain('"Content-Security-Policy-Report-Only"');
    });

    it("never allows unsafe-eval in a production build", () => {
      // React needs it in dev only. A static 'unsafe-eval' would hand an
      // injected string a way to become code. Comments are stripped first:
      // the directive is legitimately NAMED in the prose explaining why it is
      // conditional, and counting that occurrence fails an honest config.
      const code = stripComments(CONFIG);
      expect(code).toMatch(/isDev\s*\?\s*" 'unsafe-eval'"\s*:\s*""/);
      expect(code.match(/'unsafe-eval'/g) ?? []).toHaveLength(1);
    });
  });
});
