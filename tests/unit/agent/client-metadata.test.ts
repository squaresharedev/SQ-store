// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How Claude actually connects: its client_id is the URL of a metadata document.
 *
 * Production is a Cloudflare Worker and these tests run on Node, which disagree
 * about fetch. The first version asked for `redirect: "error"`, which Node takes
 * and a Worker throws on, so every Claude connection read as "unknown app" while
 * every test passed. The fetch below refuses what workerd refuses, in its words.
 */

const stored = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => ({ data: stored.get(filters.id) ?? null, error: null }),
        upsert: async (row: Record<string, string>) => {
          stored.set(row.id, row);
          return { error: null };
        },
      };
      return builder;
    },
  }),
}));

const { resolveClient } = await import("@/lib/agent/oauth/clients");

const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
/** The real document, as Claude served it on 2026-10-31. */
const CLAUDE_DOCUMENT = {
  client_id: CLAUDE,
  client_name: "Claude",
  client_uri: "https://claude.ai",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

type Answer = { status?: number; body?: unknown; headers?: Record<string, string> };

/** fetch as a Worker has it: redirect "error" throws, whatever the URL. */
function workerFetch(answer: Answer) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.redirect === "error") {
      throw new TypeError(
        'Invalid redirect value, must be one of "follow" or "manual" ("error" won\'t be implemented since it does not make sense at the edge; use "manual" and check the response status code).',
      );
    }
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: answer.headers,
    });
  });
}

beforeEach(() => {
  stored.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an app known by its metadata document", () => {
  it("connects Claude from the document it really serves", async () => {
    vi.stubGlobal("fetch", workerFetch({ body: CLAUDE_DOCUMENT }));
    const client = await resolveClient(CLAUDE);
    expect(client).toEqual({
      id: CLAUDE,
      name: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      applicationType: "web",
    });
    expect(stored.get(CLAUDE)).toMatchObject({ kind: "metadata", name: "Claude" });
  });

  it("does not follow a redirect: a document answers at the URL that names it", async () => {
    vi.stubGlobal("fetch", workerFetch({ status: 302, headers: { location: "https://evil.example/doc" } }));
    expect(await resolveClient(CLAUDE)).toBeNull();
  });

  it("refuses a document naming a different client", async () => {
    vi.stubGlobal("fetch", workerFetch({ body: { ...CLAUDE_DOCUMENT, client_id: "https://evil.example/doc" } }));
    expect(await resolveClient(CLAUDE)).toBeNull();
  });

  it("leaves a trace when the fetch fails, because the seller only sees 'unknown app'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));
    expect(await resolveClient(CLAUDE)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(CLAUDE), "network down");
  });

  it("keeps working from its stored copy if the document cannot be read again", async () => {
    stored.set(CLAUDE, {
      id: CLAUDE,
      name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      application_type: "web",
      fetched_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    vi.stubGlobal("fetch", workerFetch({ status: 500 }));
    expect((await resolveClient(CLAUDE))?.name).toBe("Claude");
  });

  it("does not fetch at all for a URL that would reach inward", async () => {
    const fetcher = workerFetch({ body: CLAUDE_DOCUMENT });
    vi.stubGlobal("fetch", fetcher);
    expect(await resolveClient("https://169.254.169.254/latest/meta-data")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("the code a Worker runs", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry) ? [path] : [];
    });
  }

  it('never asks fetch for redirect: "error", which only Node accepts', () => {
    const offenders = sources(join(process.cwd(), "src")).filter((path) =>
      /redirect:\s*["']error["']/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
