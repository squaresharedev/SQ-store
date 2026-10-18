import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMBED_FRAME_MAX_HEIGHT,
  EMBED_FRAME_PREFIX,
  EMBED_FRAME_TITLE_MAX,
  EMBED_MESSAGE_SOURCE,
} from "@/lib/storefront/embed-frame";
import { EMBED_LOADER_PATH } from "@/lib/storefront/embed-snippet";

/**
 * THE LOADER a seller pastes into their own site (public/widget.js).
 *
 * It runs on other people's websites, for their visitors, and is never bundled
 * or type-checked: this is the only thing that reads it before a browser does.
 * Two things are held here. That it does the one thing it says (a sandboxed
 * frame at the right address, sized only by its own frame's say-so), and that
 * the handful of values it repeats from the app are still the app's.
 */

const SOURCE = readFileSync(join(process.cwd(), "public", EMBED_LOADER_PATH), "utf8");
const ORIGIN = "https://embed.test";
const KEY = "3f2b6c1e-9a4d-4e8b-b1c2-0a1b2c3d4e5f";

/** Run the loader as a page would: with a script tag that points at it.
 *  `tag: false` runs it as code nobody can trace to a file (pasted inline). */
function load({ tag = true }: { tag?: boolean } = {}) {
  let script: HTMLScriptElement | null = null;
  if (tag) {
    script = document.createElement("script");
    script.src = `${ORIGIN}${EMBED_LOADER_PATH}`;
    document.head.appendChild(script);
  }
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => script });
  new Function(SOURCE)();
}

function slot(key: string): HTMLElement {
  const node = document.createElement("div");
  node.setAttribute("data-squareshare-storefront", key);
  document.body.appendChild(node);
  return node;
}

const frames = () => [...document.querySelectorAll("iframe")];

/** A message as a browser would deliver it from a given window and origin. */
function post(data: unknown, from: { source: unknown; origin: string }) {
  window.dispatchEvent(new MessageEvent("message", { data, origin: from.origin, source: from.source as Window }));
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  // jsdom has no IntersectionObserver: the loader then makes its frame at
  // once, which is the path these tests want.
  vi.stubGlobal("IntersectionObserver", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the loader repeats the app's own values", () => {
  it("for the frame's address, its one message and its limits", () => {
    expect(SOURCE).toContain(`var FRAME_PREFIX = "${EMBED_FRAME_PREFIX}";`);
    expect(SOURCE).toContain(`var MESSAGE_SOURCE = "${EMBED_MESSAGE_SOURCE}";`);
    expect(SOURCE).toContain(`var MAX_HEIGHT = ${EMBED_FRAME_MAX_HEIGHT};`);
    expect(SOURCE).toContain(`var TITLE_MAX = ${EMBED_FRAME_TITLE_MAX};`);
  });

  it("and keeps to what it promises a seller: no storage, no cookie, nothing else loaded", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "indexedDB", "fetch(", "XMLHttpRequest", "eval(", "innerHTML", "document.write"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the frame it makes", () => {
  it("is addressed to this storefront, on the loader's own origin, naming this site", () => {
    slot(KEY);
    load();
    const [frame] = frames();
    expect(frame.src).toBe(`${ORIGIN}${EMBED_FRAME_PREFIX}${KEY}/${window.location.host}`);
  });

  it("may run its own script and open a link in a new tab, and nothing more", () => {
    slot(KEY);
    load();
    const [frame] = frames();
    const sandbox = (frame.getAttribute("sandbox") ?? "").split(" ").sort();
    expect(sandbox).toEqual(
      ["allow-popups", "allow-popups-to-escape-sandbox", "allow-same-origin", "allow-scripts"].sort(),
    );
    // Not these, by name: each is a way for a frame to act on the page around it.
    for (const never of ["allow-top-navigation", "allow-forms", "allow-modals", "allow-downloads"]) {
      expect(frame.getAttribute("sandbox"), never).not.toContain(never);
    }
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("allow")).toBe("");
  });

  it("has a name, and starts with no height so a refused one leaves no box", () => {
    slot(KEY);
    load();
    const [frame] = frames();
    expect(frame.title).not.toBe("");
    expect(frame.style.height).toMatch(/^0(px)?$/);
    expect(frame.style.width).toBe("100%");
  });

  it("is made once per place, however many times the tag is pasted", () => {
    slot(KEY);
    slot(KEY);
    load();
    load();
    expect(frames()).toHaveLength(2);
  });

  it("is not made for anything that is not an embed key", () => {
    for (const bad of ["", "not-a-key", `${KEY}/../x`, `${KEY}?x=1`, "javascript:alert(1)", `"><script>`]) slot(bad);
    load();
    expect(frames()).toHaveLength(0);
  });

  it("is not made at all when the loader cannot tell where it came from", () => {
    slot(KEY);
    load({ tag: false });
    expect(frames()).toHaveLength(0);
  });
});

describe("what the frame may tell the page", () => {
  function mounted() {
    slot(KEY);
    load();
    const [frame] = frames();
    return frame;
  }
  const height = (frame: HTMLIFrameElement) => frame.style.height;
  const message = (over: Record<string, unknown> = {}) => ({ source: EMBED_MESSAGE_SOURCE, height: 640, title: "What Studio sells", ...over });

  it("its height and its title, when it is this frame, from our origin", () => {
    const frame = mounted();
    post(message(), { source: frame.contentWindow, origin: ORIGIN });
    expect(height(frame)).toBe("640px");
    expect(frame.title).toBe("What Studio sells");
  });

  it("nothing from another window, even one that knows the words", () => {
    const frame = mounted();
    post(message(), { source: window, origin: ORIGIN });
    post(message(), { source: null, origin: ORIGIN });
    expect(height(frame)).toMatch(/^0(px)?$/);
  });

  it("nothing from another origin, even in this frame", () => {
    const frame = mounted();
    post(message(), { source: frame.contentWindow, origin: "https://evil.example" });
    expect(height(frame)).toMatch(/^0(px)?$/);
  });

  it("nothing that is not its one message", () => {
    const frame = mounted();
    for (const data of [null, "640", { height: 640 }, message({ source: "someone-else" }), message({ height: "640" }), message({ height: -5 }), message({ height: Number.NaN })]) {
      post(data, { source: frame.contentWindow, origin: ORIGIN });
    }
    expect(height(frame)).toMatch(/^0(px)?$/);
  });

  it("no more than a page's worth of height, and no more than a line of title", () => {
    const frame = mounted();
    post(message({ height: 9_999_999, title: "x".repeat(500) }), { source: frame.contentWindow, origin: ORIGIN });
    expect(height(frame)).toBe(`${EMBED_FRAME_MAX_HEIGHT}px`);
    expect(frame.title).toHaveLength(EMBED_FRAME_TITLE_MAX);
  });

  it("a title only ever as text", () => {
    const frame = mounted();
    post(message({ title: '"><img src=x onerror=alert(1)>' }), { source: frame.contentWindow, origin: ORIGIN });
    expect(frame.getAttribute("title")).toBe('"><img src=x onerror=alert(1)>');
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("a storefront that never shows", () => {
  it("is explained once, in the console, to whoever is setting it up", () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    slot(KEY);
    load();
    vi.advanceTimersByTime(11_000);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toMatch(/allowed domains/i);
    info.mockRestore();
  });

  it("and not mentioned when it did show", () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    slot(KEY);
    load();
    const [frame] = frames();
    post({ source: EMBED_MESSAGE_SOURCE, height: 300, title: "Shop" }, { source: frame.contentWindow, origin: ORIGIN });
    vi.advanceTimersByTime(11_000);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
