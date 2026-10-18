// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  EMBED_FRAME_CSP,
  EMBED_KEY_PATTERN,
  EMBED_SITE_PATTERN,
  EMBED_SITE_PATTERN_DEV,
} from "@/lib/storefront/embed-frame";

/**
 * THE EMBED FRAME'S HEADER RULE, in both places it runs.
 *
 * The rule in next.config.ts writes a path segment into `frame-ancestors`. It
 * is applied by two different pieces of code: Next's own router under
 * `next dev`, and the OpenNext worker's matcher in production, which
 * re-implements custom headers with path-to-regexp and, when that library
 * cannot compile a value, SENDS THE VALUE AS WRITTEN. So a policy that works on
 * every developer's machine can reach production as the literal text
 * "frame-ancestors :site", which no browser matches: every embed goes blank
 * and nothing local notices.
 *
 * These tests run the rule through both, so that failure is caught here. They
 * also hold the literals in next.config.ts to the ones the route itself reads
 * (lib/storefront/embed-frame.ts): the config cannot import app code.
 */

const require = createRequire(import.meta.url);
const CONFIG = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

type PathToRegexp = {
  match: (source: string) => (path: string) => { params: Record<string, string> } | false;
  compile: (value: string) => (params: Record<string, string>) => string;
};

/** The copy of path-to-regexp the deployed worker's matcher imports: a
 *  dependency of @opennextjs/aws, which sits beside the cloudflare adapter. */
function workerPathToRegexp(): { lib: PathToRegexp; version: string } {
  const adapter = realpathSync(join(process.cwd(), "node_modules/@opennextjs/cloudflare"));
  const fromAws = createRequire(join(realpathSync(join(adapter, "../aws")), "package.json"));
  return { lib: fromAws("path-to-regexp"), version: fromAws("path-to-regexp/package.json").version };
}

/**
 * What the worker sends for one header, the same steps in the same order as
 * getNextConfigHeaders in @opennextjs/aws (core/routing/matcher.js): match the
 * source for its params, compile the value with them, and on any throw fall
 * back to the raw value.
 */
function workerHeader(source: string, value: string, path: string): string | null {
  const { lib } = workerPathToRegexp();
  const matched = lib.match(source)(path);
  if (!matched) return null;
  try {
    return Object.keys(matched.params).length > 0 ? lib.compile(value)(matched.params) : value;
  } catch {
    return value;
  }
}

/** The same header as Next's own router computes it. */
function nextHeader(source: string, value: string, path: string): string | null {
  const { pathToRegexp } = require("next/dist/compiled/path-to-regexp");
  const { compileNonPath } = require("next/dist/shared/lib/router/utils/prepare-destination");
  const keys: { name: string }[] = [];
  const matched = pathToRegexp(source, keys, { strict: true, sensitive: false, delimiter: "/" }).exec(path);
  if (!matched) return null;
  const params: Record<string, string> = {};
  keys.forEach((key, index) => {
    params[key.name] = matched[index + 1];
  });
  return compileNonPath(value, params);
}

const KEY = "3f2b6c1e-9a4d-4e8b-b1c2-0a1b2c3d4e5f";
const SOURCE = `/e/:key(${EMBED_KEY_PATTERN})/:site(${EMBED_SITE_PATTERN})`;
const SOURCE_DEV = `/e/:key(${EMBED_KEY_PATTERN})/:site(${EMBED_SITE_PATTERN_DEV})`;
const policyFor = (site: string) => EMBED_FRAME_CSP.replace(":site", site);

describe("next.config.ts repeats the frame's own rules", () => {
  it("matches the path with the same two patterns", () => {
    expect(CONFIG).toContain(`/e/:key(${EMBED_KEY_PATTERN})/:site(`);
    expect(CONFIG).toContain(`"${EMBED_SITE_PATTERN}"`);
    expect(CONFIG).toContain(`"${EMBED_SITE_PATTERN_DEV}"`);
  });

  it("sends the same policy", () => {
    expect(CONFIG).toContain(`"${EMBED_FRAME_CSP}"`);
  });

  it("only on the embed's own host, and only when there is one", () => {
    expect(CONFIG).toMatch(/has:\s*\[\{\s*type:\s*"host"/);
    expect(CONFIG).toMatch(/\.\.\.\(embedHost\s*\?/);
  });
});

describe("the policy reaches the browser with the site written in", () => {
  it("is still read by the worker's path-to-regexp 6", () => {
    // A major bump changes the syntax this whole file is about. Fail here so
    // someone re-reads it, rather than on a seller's website.
    expect(workerPathToRegexp().version).toMatch(/^6\./);
  });

  for (const site of ["www.example.com", "example.com", "my-shop.example.co.uk", "xn--bcher-kva.example"]) {
    it(`for ${site}, in development and in production alike`, () => {
      const path = `/e/${KEY}/${site}`;
      expect(nextHeader(SOURCE, EMBED_FRAME_CSP, path)).toBe(policyFor(site));
      expect(workerHeader(SOURCE, EMBED_FRAME_CSP, path)).toBe(policyFor(site));
    });
  }

  it("never as the unsubstituted text", () => {
    // The failure this file exists for: a value the worker's compile() rejects
    // comes out as written. Proven against a value that DOES break it, so the
    // check below is known to be able to fail.
    const broken = "frame-ancestors https://:site";
    expect(workerHeader(SOURCE, broken, `/e/${KEY}/www.example.com`)).toBe(broken);
    expect(workerHeader(SOURCE, EMBED_FRAME_CSP, `/e/${KEY}/www.example.com`)).not.toContain(":site");
  });

  it("with a port, in development only", () => {
    const path = `/e/${KEY}/shop.localhost:3100`;
    expect(nextHeader(SOURCE_DEV, EMBED_FRAME_CSP, path)).toBe(policyFor("shop.localhost:3100"));
    expect(nextHeader(SOURCE, EMBED_FRAME_CSP, path)).toBeNull();
    expect(workerHeader(SOURCE, EMBED_FRAME_CSP, path)).toBeNull();
  });
});

describe("nothing but a bare host can be written into the policy", () => {
  // Each of these would end the directive, add a source or name a scheme if it
  // were let through. No match means no enforced policy at all, which leaves
  // the response under X-Frame-Options: DENY.
  const hostile = [
    "evil.com;script-src",
    "evil.com%3Bscript-src",
    "evil.com%20https:",
    "evil.com%0Aset-cookie",
    "https:",
    "data:",
    "*",
    "'none'",
    "www.example.com/extra",
    "www.example.com%2Fextra",
  ];

  for (const site of hostile) {
    it(JSON.stringify(site), () => {
      const path = `/e/${KEY}/${site}`;
      expect(nextHeader(SOURCE, EMBED_FRAME_CSP, path)).toBeNull();
      expect(workerHeader(SOURCE, EMBED_FRAME_CSP, path)).toBeNull();
      // The development pattern is looser by a port and nothing else.
      expect(nextHeader(SOURCE_DEV, EMBED_FRAME_CSP, path)).toBeNull();
    });
  }

  it("and nothing but an embed key can stand before it", () => {
    for (const key of ["not-a-key", "3f2b6c1e", `${KEY}x`, "../.."]) {
      const path = `/e/${key}/www.example.com`;
      expect(nextHeader(SOURCE, EMBED_FRAME_CSP, path), key).toBeNull();
      expect(workerHeader(SOURCE, EMBED_FRAME_CSP, path), key).toBeNull();
    }
  });
});
