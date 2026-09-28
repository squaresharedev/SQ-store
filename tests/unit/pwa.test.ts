// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "@/i18n/locales";
import { MANIFEST_ICONS } from "@/lib/pwa/icons";
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

  it("only ever answers page loads", () => {
    expect(worker).toContain(
      'if (request.mode !== "navigate" || request.method !== "GET") return;',
    );
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
