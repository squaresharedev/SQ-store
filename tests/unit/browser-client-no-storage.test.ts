// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The browser must never hold a session token.
 *
 * auth-js's default home for a session is localStorage, which every script on
 * the origin can read — one XSS and a long-lived refresh token walks out. This
 * app keeps the session in an HttpOnly cookie written server-side, so the
 * browser client has no business persisting anything, and these tests pin that
 * down at the point where it could silently regress: the options object.
 *
 * `cookieOptions.httpOnly` does NOT achieve this on its own. JavaScript cannot
 * set an HttpOnly cookie, so a browser-side write would quietly downgrade to a
 * script-readable one. persistSession:false is the actual guarantee.
 */

type BrowserClientOptions = {
  cookieOptions?: Record<string, unknown>;
  auth?: Record<string, unknown>;
};

/** Typed so `mock.calls[0]` destructures without a cast. */
const createBrowserClientMock =
  vi.fn<(url: string, key: string, options: BrowserClientOptions) => unknown>();

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (url: string, key: string, options: BrowserClientOptions) =>
    createBrowserClientMock(url, key, options),
}));

import { createClient } from "@/lib/supabase/client";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("browser Supabase client", () => {
  it("never persists a session", () => {
    createClient();
    const [, , options] = createBrowserClientMock.mock.calls[0];
    expect(options.auth?.persistSession).toBe(false);
  });

  it("does not auto-refresh, which would need a stored refresh token", () => {
    createClient();
    const [, , options] = createBrowserClientMock.mock.calls[0];
    expect(options.auth?.autoRefreshToken).toBe(false);
  });

  it("does not start a session from a code in the URL", () => {
    // OAuth and recovery codes are exchanged server-side in /auth/callback.
    createClient();
    const [, , options] = createBrowserClientMock.mock.calls[0];
    expect(options.auth?.detectSessionInUrl).toBe(false);
  });

  it("is given the anon key, never the service-role key", () => {
    createClient();
    const [, key] = createBrowserClientMock.mock.calls[0];
    expect(key).toBe("anon-key");
  });
});

describe("no client module reaches for web storage", () => {
  const SRC = join(process.cwd(), "src");

  it("keeps localStorage and sessionStorage out of the Supabase layer", () => {
    // A `storage:` override or a hand-rolled localStorage write here would
    // undo the whole arrangement, so the whole slice is checked, not just
    // client.ts.
    for (const file of ["client.ts", "server.ts", "admin.ts", "cookie-options.ts"]) {
      const source = readFileSync(join(SRC, "lib/supabase", file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""); // strip comments
      expect(code, file).not.toMatch(/localStorage|sessionStorage/);
    }
  });

  it("keeps the service-role key out of anything the browser can import", () => {
    const browserClient = readFileSync(join(SRC, "lib/supabase/client.ts"), "utf8");
    expect(browserClient).not.toMatch(/SERVICE_ROLE/);
  });
});
