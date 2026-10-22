// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  EMBED_KEY_PATTERN,
  EMBED_MAX_SITES,
  EMBED_SITE_PATTERN,
  EMBED_SITE_PATTERN_DEV,
  embedFramePolicy,
} from "@/lib/storefront/embed-frame";

/**
 * THE EMBED FRAME'S HEADER RULES, in both places they run.
 *
 * The rules in next.config.ts write path segments into `frame-ancestors`. They
 * are applied by two different pieces of code: Next's own router under
 * `next dev`, and the OpenNext worker's matcher in production, which
 * re-implements custom headers with path-to-regexp and, when that library
 * cannot compile a value, SENDS THE VALUE AS WRITTEN. So a policy that works on
 * every developer's machine can reach production as the literal text
 * "frame-ancestors :s1", which no browser matches: every embed goes blank and
 * nothing local notices.
 *
 * These tests load the real rules from next.config.ts and run them through
 * both, so that failure is caught here. They also hold the rules to the
 * patterns and policy the route itself reads (lib/storefront/embed-frame.ts):
 * the config cannot import app code, so it repeats them.
 */

// Loading the config in development would otherwise open a Cloudflare session.
vi.mock("@opennextjs/cloudflare", () => ({ initOpenNextCloudflareForDev: () => {} }));

const require = createRequire(import.meta.url);

type Rule = { source: string; has?: { type: string; value?: string }[]; headers: { key: string; value: string }[] };

const EMBED_HOST = "embed.squareshare.eu";

/** next.config.ts's header rules, as a build with this environment makes them. */
async function loadRules(env: { embedUrl: string; nodeEnv: "production" | "development" }): Promise<Rule[]> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_EMBED_URL", env.embedUrl);
  vi.stubEnv("NODE_ENV", env.nodeEnv);
  const config = (await import("../../next.config")).default;
  return (await config.headers!()) as Rule[];
}

const embedRules = (rules: Rule[]) => rules.filter((rule) => rule.source.startsWith("/e/"));
const policyOf = (rule: Rule) => rule.headers.find((header) => header.key === "Content-Security-Policy")!.value;

afterEach(() => vi.unstubAllEnvs());

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

/** Every policy a path is given, by every rule, in one runtime. */
function policies(rules: Rule[], path: string, run: typeof nextHeader): string[] {
  return embedRules(rules)
    .map((rule) => run(rule.source, policyOf(rule), path))
    .filter((value): value is string => value !== null);
}

const KEY = "3f2b6c1e-9a4d-4e8b-b1c2-0a1b2c3d4e5f";
const framePath = (...sites: string[]) => `/e/${KEY}/${sites.join("/")}`;
const prodRules = () => loadRules({ embedUrl: `https://${EMBED_HOST}`, nodeEnv: "production" });

describe("next.config.ts", () => {
  it("frames nothing at all while the embed has no host", async () => {
    expect(embedRules(await loadRules({ embedUrl: "", nodeEnv: "production" }))).toEqual([]);
  });

  it("writes one rule per number of sites, with the frame's own patterns and policy", async () => {
    const rules = embedRules(await prodRules());
    expect(rules).toHaveLength(EMBED_MAX_SITES);
    rules.forEach((rule, index) => {
      const params = Array.from({ length: index + 1 }, (_, n) => `s${n + 1}`);
      expect(rule.source).toBe(
        `/e/:key(${EMBED_KEY_PATTERN})/${params.map((param) => `:${param}(${EMBED_SITE_PATTERN})`).join("/")}`,
      );
      expect(policyOf(rule)).toBe(embedFramePolicy(params.map((param) => `:${param}`)));
    });
  });

  it("admits a port in development alone", async () => {
    const rules = embedRules(await loadRules({ embedUrl: "http://localhost:3100", nodeEnv: "development" }));
    expect(rules[0].source).toBe(`/e/:key(${EMBED_KEY_PATTERN})/:s1(${EMBED_SITE_PATTERN_DEV})`);
  });

  it("only on the embed's own host", async () => {
    for (const rule of embedRules(await prodRules())) {
      const [has] = rule.has ?? [];
      expect(has?.type).toBe("host");
      const host = new RegExp(`^${has!.value}$`);
      expect(host.test(EMBED_HOST)).toBe(true);
      for (const other of ["dashboard.squareshare.eu", "embedxsquareshare.eu", `${EMBED_HOST}.evil.com`]) {
        expect(host.test(other), other).toBe(false);
      }
    }
  });

  it("spells every header it shares with the global entry the same way", async () => {
    // The worker treats a differently cased name as a second header and sends
    // both, so a frame would get two Referrer-Policy values.
    const rules = await prodRules();
    const global = new Set(rules[0].headers.map((header) => header.key));
    const globalLower = new Map([...global].map((key) => [key.toLowerCase(), key]));
    for (const rule of embedRules(rules)) {
      for (const { key } of rule.headers) {
        const twin = globalLower.get(key.toLowerCase());
        if (twin) expect(key).toBe(twin);
      }
    }
  });
});

describe("the policy reaches the browser with the sites written in", () => {
  it("is still read by the worker's path-to-regexp 6", () => {
    // A major bump changes the syntax this whole file is about. Fail here so
    // someone re-reads it, rather than on a seller's website.
    expect(workerPathToRegexp().version).toMatch(/^6\./);
  });

  const lists = [
    ["www.example.com"],
    ["my-shop.example.co.uk"],
    ["xn--bcher-kva.example"],
    // Wix: the builder's frame for the site, then the site.
    ["www-example-com.filesusr.com", "www.example.com"],
    // Google Sites: two frames of its own above the embed.
    ["abc123-atari-embeds.googleusercontent.com", "www.gstatic.com", "example.com"],
    ["a.example", "b.example", "c.example", "d.example"],
  ];

  for (const sites of lists) {
    it(`for ${sites.join(" ")}, in development and in production alike`, async () => {
      const rules = await prodRules();
      const want = [embedFramePolicy(sites)];
      expect(policies(rules, framePath(...sites), nextHeader)).toEqual(want);
      expect(policies(rules, framePath(...sites), workerHeader)).toEqual(want);
    });
  }

  it("never as the unsubstituted text", async () => {
    // The failure this file exists for: a value the worker's compile() rejects
    // comes out as written. Proven against a value that DOES break it, so the
    // checks above are known to be able to fail.
    const [rule] = embedRules(await prodRules());
    const broken = "frame-ancestors https://:s1";
    expect(workerHeader(rule.source, broken, framePath("www.example.com"))).toBe(broken);
    for (const value of policies(await prodRules(), framePath("a.example", "b.example"), workerHeader)) {
      expect(value).not.toMatch(/:s\d/);
    }
  });

  it("for no more sites than the frame may name", async () => {
    const rules = await prodRules();
    const tooMany = framePath("a.example", "b.example", "c.example", "d.example", "e.example");
    expect(policies(rules, tooMany, nextHeader)).toEqual([]);
    expect(policies(rules, tooMany, workerHeader)).toEqual([]);
  });

  it("with a port, in development only", async () => {
    const path = framePath("shop.localhost:3100", "shop-localhost.filesusr.com:3100");
    const dev = await loadRules({ embedUrl: "http://localhost:3100", nodeEnv: "development" });
    expect(policies(dev, path, nextHeader)).toEqual([
      embedFramePolicy(["shop.localhost:3100", "shop-localhost.filesusr.com:3100"]),
    ]);
    expect(policies(await prodRules(), path, nextHeader)).toEqual([]);
    expect(policies(await prodRules(), path, workerHeader)).toEqual([]);
  });
});

describe("nothing but bare hosts can be written into the policy", () => {
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
    "www.example.com%2Fextra",
  ];

  for (const site of hostile) {
    it(`${JSON.stringify(site)}, wherever it stands in the list`, async () => {
      const prod = await prodRules();
      const dev = await loadRules({ embedUrl: "http://localhost:3100", nodeEnv: "development" });
      for (const path of [framePath(site), framePath("www.example.com", site), framePath(site, "www.example.com")]) {
        expect(policies(prod, path, nextHeader), path).toEqual([]);
        expect(policies(prod, path, workerHeader), path).toEqual([]);
        // The development pattern is looser by a port and nothing else.
        expect(policies(dev, path, nextHeader), path).toEqual([]);
      }
    });
  }

  it("and nothing but an embed key can stand before them", async () => {
    const rules = await prodRules();
    for (const key of ["not-a-key", "3f2b6c1e", `${KEY}x`, "../.."]) {
      const path = `/e/${key}/www.example.com`;
      expect(policies(rules, path, nextHeader), key).toEqual([]);
      expect(policies(rules, path, workerHeader), key).toEqual([]);
    }
  });
});
