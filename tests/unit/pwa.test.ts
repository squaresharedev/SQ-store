// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "@/i18n/locales";
import { MANIFEST_ICONS } from "@/lib/pwa/icons";
import { RETRY_DELAYS_MS } from "@/lib/resilient-action";
import {
  OFFLINE_LOCALE_MESSAGE,
  OFFLINE_PATH,
  SERVICE_WORKER_PATH,
} from "@/lib/pwa/paths";

/**
 * THE INSTALLABLE APP: the manifest, the icons it points at, the service
 * worker and the offline page it keeps.
 *
 * Most of what can go wrong here is silent. A manifest missing one field, or
 * an icon whose file is the wrong size, simply stops the browser offering
 * "Install", with no error anywhere a person would look. And public/sw.js
 * cannot import the app's constants, so its copies can drift unnoticed. These
 * tests state each of those as a rule.
 */

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts));

/** The width and height a PNG declares in its IHDR chunk. */
function pngSize(data: Buffer): { width: number; height: number } {
  expect(data.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const intl = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { loadMessages } = await import("@/i18n/messages");
  return {
    getLocale: async () => intl.locale,
    getTranslations: async (namespace: never) =>
      createTranslator({
        locale: intl.locale,
        messages: await loadMessages(intl.locale),
        namespace,
        timeZone: "UTC",
      }),
  };
});

beforeEach(() => {
  intl.locale = "en";
});

describe("service worker", () => {
  const worker = read("public", SERVICE_WORKER_PATH).toString("utf8");

  it("is served from the root, so it can control every page", () => {
    expect(SERVICE_WORKER_PATH).toMatch(/^\/[^/]+\.js$/);
  });

  it("mirrors the offline path and message the app uses", () => {
    expect(worker).toContain(`const OFFLINE_URL = "${OFFLINE_PATH}";`);
    expect(worker).toContain(`const LOCALE_MESSAGE = "${OFFLINE_LOCALE_MESSAGE}";`);
  });

  it("stores nothing but the offline page", () => {
    // The dashboard is private and per-account: a stored page would replay
    // stale data, or another account's, to whoever opens the app next.
    expect(worker).not.toMatch(/\.put\(|\.addAll\(/);
    expect(worker.match(/cache\.add\(/g)).toHaveLength(1);
    expect(worker).toContain("cache.add(new Request(OFFLINE_URL");
  });

});

describe("service worker: a Worker stopped at its CPU limit", () => {
  const worker = read("public", SERVICE_WORKER_PATH).toString("utf8");
  const ORIGIN = "https://dashboard.squareshare.eu";
  /** The answer Cloudflare gives in place of the Worker's (Error 1102). */
  const limitPage = () =>
    new Response(
      "<!DOCTYPE html><title>Worker exceeded resource limits | dashboard.squareshare.eu | Cloudflare</title>" +
        '<span class="inline-block">Error</span><span class="code-label">Error code 1102</span>',
      { status: 503, headers: { "Content-Type": "text/html" } },
    );
  const page = () => new Response("<!doctype html><h1>Orders</h1>", { status: 200 });
  const offlinePage = new Response("<!doctype html><h1>You're offline</h1>");

  type FakeRequest = { url: string; method: string; mode: string; headers: Headers };
  const pageLoad = (path = "/orders"): FakeRequest => ({
    url: ORIGIN + path, method: "GET", mode: "navigate", headers: new Headers(),
  });
  const pageChange = (headers: Record<string, string> = {}): FakeRequest => ({
    url: `${ORIGIN}/orders?_rsc=abc`, method: "GET", mode: "cors", headers: new Headers({ rsc: "1", ...headers }),
  });

  /**
   * Runs public/sw.js as the browser would, against a network that gives the
   * answers listed (an Error is a network failure), and dispatches one fetch.
   * Returns what the worker answered (undefined when it let the request be).
   */
  async function dispatch(
    request: FakeRequest,
    answers: Array<Response | Error>,
    preload?: Response,
  ) {
    const listeners: Record<string, (event: unknown) => void> = {};
    const fetched: FakeRequest[] = [];
    const waits: number[] = [];
    const network = async (r: FakeRequest) => {
      fetched.push(r);
      const next = answers.shift();
      if (!next || next instanceof Error) throw next ?? new Error("no answer left");
      return next;
    };
    const self = {
      location: new URL(ORIGIN),
      addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn),
    };
    const caches = { match: async () => offlinePage.clone() };
    // The waits between tries are recorded, not slept.
    const wait = (fn: () => void, ms: number) => (waits.push(ms), fn());
    new Function("self", "caches", "fetch", "setTimeout", worker)(self, caches, network, wait);

    let answered: Promise<Response> | undefined;
    listeners.fetch({
      request,
      preloadResponse: Promise.resolve(preload),
      respondWith: (p: Promise<Response>) => (answered = p),
    });
    return { response: answered && (await answered), fetched, waits };
  }

  it("waits on the same schedule as the sign-in screens' actions", () => {
    // One schedule for "Cloudflare stopped the Worker": a page load riding it
    // out here, an action riding it out in src/lib/resilient-action.ts.
    expect(worker).toContain(`const LIMIT_RETRY_DELAYS_MS = [${RETRY_DELAYS_MS.join(", ")}];`);
  });

  it("asks again after a moment, and serves the page once it comes", async () => {
    const { response, fetched, waits } = await dispatch(pageLoad(), [limitPage(), limitPage(), page()]);
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain("Orders");
    expect(fetched).toHaveLength(3);
    expect(waits).toEqual(RETRY_DELAYS_MS.slice(0, 2));
  });

  it("keeps asking, spread out, through a stop that lasts several seconds", async () => {
    // Production, 2026-10-28: a phone's page loads were stopped for 5 to 35 s
    // at a time. Three seconds of tries showed the error page for most.
    const stopped = RETRY_DELAYS_MS.length;
    const { response, fetched, waits } = await dispatch(pageLoad(), [
      ...Array.from({ length: stopped }, limitPage),
      page(),
    ]);
    expect(response?.status).toBe(200);
    expect(fetched).toHaveLength(stopped + 1);
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(10_000);
    // Each wait at least as long as the one before: no burst at the end.
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
  });

  it("counts the browser's preloaded answer as the first try", async () => {
    const { response, fetched } = await dispatch(pageLoad(), [page()], limitPage());
    expect(response?.status).toBe(200);
    expect(fetched).toHaveLength(1);
  });

  it("gives up once the schedule runs out and shows the page Cloudflare sent", async () => {
    const tries = RETRY_DELAYS_MS.length + 1;
    const { response, fetched } = await dispatch(pageLoad(), Array.from({ length: tries + 2 }, limitPage));
    expect(fetched).toHaveLength(tries);
    expect(response?.status).toBe(503);
    expect(await response?.text()).toContain("Worker exceeded resource limits");
  });

  it("passes any other server error straight back, untried", async () => {
    const busy = new Response('{"error":"database unavailable"}', { status: 503 });
    const { response, fetched } = await dispatch(pageLoad(), [busy, page()]);
    expect(response?.status).toBe(503);
    expect(fetched).toHaveLength(1);
  });

  it("retries the router's fetch of the next page the same way", async () => {
    const { response, fetched } = await dispatch(pageChange(), [limitPage(), page()]);
    expect(response?.status).toBe(200);
    expect(fetched).toHaveLength(2);
  });

  it("never touches a prefetch, a server action, or another site's request", async () => {
    const prefetch = await dispatch(pageChange({ "next-router-prefetch": "1" }), [limitPage()]);
    const action: FakeRequest = { ...pageLoad(), method: "POST", headers: new Headers({ "next-action": "x" }) };
    const elsewhere: FakeRequest = { ...pageChange(), url: "https://example.com/?_rsc=abc" };
    const data: FakeRequest = { ...pageChange(), headers: new Headers() };
    for (const run of [prefetch, await dispatch(action, []), await dispatch(elsewhere, []), await dispatch(data, [])]) {
      expect(run.response).toBeUndefined();
      expect(run.fetched).toHaveLength(0);
    }
  });

  it("shows the offline page when the network itself is gone", async () => {
    const load = await dispatch(pageLoad(), [new Error("offline")]);
    expect(await load.response?.text()).toContain("offline");
    // A page change fails as it would without the worker: the router then
    // loads the page in full, which comes back here as a page load.
    const change = await dispatch(pageChange(), [new Error("offline")]);
    expect(change.response?.type).toBe("error");
  });
});

describe("manifest", () => {
  async function manifest() {
    const { default: build } = await import("@/app/manifest");
    return build();
  }

  it("carries everything Chrome needs to offer Install", async () => {
    const m = await manifest();
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toMatch(/^\//);
    const sizes = m.icons?.filter((i) => i.purpose === "any").map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("keeps its id fixed, so existing installs stay the same app", async () => {
    expect((await manifest()).id).toBe("/");
  });

  it("opens and links only inside its own scope", async () => {
    const m = await manifest();
    const scope = m.scope ?? "/";
    expect(m.start_url?.startsWith(scope)).toBe(true);
    for (const shortcut of m.shortcuts ?? []) {
      expect(shortcut.url.startsWith(scope), shortcut.url).toBe(true);
    }
  });

  it("speaks the seller's language", async () => {
    const english = await manifest();
    intl.locale = "cs";
    const czech = await manifest();
    expect(czech.lang).toBe("cs");
    expect(czech.description).not.toBe(english.description);
    expect(czech.shortcuts?.[0].name).not.toBe(english.shortcuts?.[0].name);
  });

  it.each(MANIFEST_ICONS)("$src exists at $size px", ({ src, size }) => {
    expect(pngSize(read("public", src))).toEqual({ width: size, height: size });
  });
});

describe("icons Next.js links by file name", () => {
  it("app/apple-icon.png is the 180 px iOS home-screen icon", () => {
    expect(pngSize(read("src/app/apple-icon.png"))).toEqual({ width: 180, height: 180 });
  });

  it("app/favicon.ico holds the three tab sizes", () => {
    const ico = read("src/app/favicon.ico");
    expect(ico.readUInt16LE(2)).toBe(1); // an icon, not a cursor
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + i * 16));
    expect(sizes).toEqual([16, 32, 48]);
  });
});

describe("buyer-facing pages", () => {
  it("switch off the install prompt the dashboard offers", () => {
    // A buyer offered "Install Square Share" would land on a sign-in page.
    const layout = read("src/app/(public)/layout.tsx").toString("utf8");
    expect(layout).toContain("manifest: null");
    expect(layout).toContain("appleWebApp: null");
    expect(existsSync(join(ROOT, "src/app/(public)/manifest.ts"))).toBe(false);
  });
});

describe("GET /offline", () => {
  async function offline() {
    const { GET } = await import("@/app/offline/route");
    return GET();
  }

  it("is a whole document that needs no second request", async () => {
    const res = await offline();
    expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toMatch(/^<!doctype html>/);
    // Nothing that would have to load from the network once offline.
    expect(html).not.toMatch(/<link\b|<img\b|src=|\/_next\//);
  });

  it("is in the request's language and says which", async () => {
    intl.locale = "de";
    const res = await offline();
    expect(res.headers.get("Content-Language")).toBe("de");
    const html = await res.text();
    expect(html).toContain('<html lang="de">');
    expect(html).toContain("<h1>Du bist offline</h1>");
  });

  it("escapes its copy", async () => {
    // The English title carries an apostrophe.
    const html = await (await offline()).text();
    expect(html).toContain("<h1>You&#39;re offline</h1>");
  });

  it("retries the page that failed, not /offline", async () => {
    // The worker serves this document IN PLACE of the failed page, so the
    // empty URL is that page.
    expect(await (await offline()).text()).toContain('<a href="">');
  });
});
