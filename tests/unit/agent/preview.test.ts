// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontPreviewUrl } from "@/lib/agent/paths";
import {
  formatPreviewRegion,
  parsePreviewRegion,
  readMeasurements,
  regionBox,
  resolvedTracks,
} from "@/lib/agent/preview/targets";
import { mintPreviewToken, verifyPreviewToken } from "@/lib/agent/preview/token";
import { PUBLISH_CARD_VIEW_HTML } from "@/lib/agent/preview/publish-card";
import { PREVIEW_VIEWPORTS, croppedAsAsked, jpegSize, pictureScale, snapshotRequest } from "@/lib/agent/preview/snapshot";
import { PAGE_PREVIEW_VIEW_HTML } from "@/lib/agent/preview/view";
import { MCP_APP_MIME_TYPE } from "@/lib/agent/preview/view-kit";

const STOREFRONT = "11111111-1111-4111-8111-111111111111";
const GRANT = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.stubEnv("AGENT_JWT_SIGNING_KEY", JSON.stringify({ kty: "oct", k: Buffer.from("x".repeat(40)).toString("base64url") }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the key to one preview page", () => {
  it("opens the storefront it names, for the grant it names", async () => {
    const token = await mintPreviewToken({ kind: "storefront", id: STOREFRONT }, GRANT);
    expect(await verifyPreviewToken(token)).toMatchObject({ kind: "storefront", id: STOREFRONT, grantId: GRANT });
  });

  it("is refused once anything in it is changed", async () => {
    const token = await mintPreviewToken({ kind: "storefront", id: STOREFRONT }, GRANT);
    const [body, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, id: "33333333-3333-4333-8333-333333333333" })).toString("base64url");
    expect(await verifyPreviewToken(`${forged}.${signature}`)).toBeNull();
    expect(await verifyPreviewToken(`${body}.${"A".repeat(43)}`)).toBeNull();
    expect(await verifyPreviewToken("not a token")).toBeNull();
    expect(await verifyPreviewToken(undefined)).toBeNull();
  });

  it("runs out after two minutes", async () => {
    const token = await mintPreviewToken({ kind: "storefront", id: STOREFRONT }, GRANT);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 121_000);
    expect(await verifyPreviewToken(token)).toBeNull();
  });

  it("is signed by a key derived from the agent key: a different agent key refuses it", async () => {
    const token = await mintPreviewToken({ kind: "storefront", id: STOREFRONT }, GRANT);
    vi.stubEnv("AGENT_JWT_SIGNING_KEY", JSON.stringify({ kty: "oct", k: Buffer.from("y".repeat(40)).toString("base64url") }));
    expect(await verifyPreviewToken(token)).toBeNull();
  });
});

describe("what a preview page measured", () => {
  const page = (json: string) => `<html><body><main></main><script type="application/json" id="ss-preview-targets">${json}</script></body></html>`;

  it("is read back out of the rendered page", () => {
    const measured = { page: { width: 1280, height: 900 }, tiles: [{ productId: "p", title: "Lamp", status: "active", x: 1, y: 2, w: 3, h: 4 }] };
    expect(readMeasurements(page(JSON.stringify(measured)))).toEqual(measured);
  });

  it("keeps only well-formed tiles, and nothing at all from a page without them", () => {
    const measured = { page: { width: 10, height: 10 }, tiles: [{ productId: "p", title: "ok", status: "active", x: 0, y: 0, w: 1, h: 1 }, { productId: 1 }, { title: "no box" }] };
    expect(readMeasurements(page(JSON.stringify(measured)))?.tiles).toHaveLength(1);
    expect(readMeasurements("<html></html>")).toBeNull();
    expect(readMeasurements(page("{not json"))).toBeNull();
  });
});

describe("every view", () => {
  it.each([
    ["the page preview", PAGE_PREVIEW_VIEW_HTML],
    ["the publish card", PUBLISH_CARD_VIEW_HTML],
  ])("%s is an MCP App: the right type, the stable protocol revision, the handshake", (_name, html) => {
    expect(MCP_APP_MIME_TYPE).toBe("text/html;profile=mcp-app");
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('"2026-01-26"');
    for (const method of ["ui/initialize", "ui/notifications/initialized", "ui/notifications/tool-result", "ui/notifications/size-changed", "ui/open-link"]) {
      expect(html).toContain(method);
    }
    // The script is one piece that parses: the kit and the view stitched right.
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
    expect(() => new Function(script)).not.toThrow();
  });

  it.each([
    ["the page preview", PAGE_PREVIEW_VIEW_HTML],
    ["the publish card", PUBLISH_CARD_VIEW_HTML],
  ])("%s ships no script or stylesheet of its own from anywhere, and parses no markup into itself", (_name, html) => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe("the page preview view", () => {
  it("reads one thing, the live page it was handed, without a cookie", () => {
    const fetches = PAGE_PREVIEW_VIEW_HTML.match(/fetch\(/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(PAGE_PREVIEW_VIEW_HTML).toContain('fetch(url.href, { credentials: "omit", cache: "no-store" })');
    expect(PAGE_PREVIEW_VIEW_HTML).toContain("new URL(state.live.url)");
    expect(PAGE_PREVIEW_VIEW_HTML).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
    expect(PAGE_PREVIEW_VIEW_HTML).toContain("ui/update-model-context");
  });

  it("never parses markup into itself: the page is parsed apart and its scripts left behind", () => {
    expect(PAGE_PREVIEW_VIEW_HTML).toContain('new DOMParser().parseFromString(');
    expect(PAGE_PREVIEW_VIEW_HTML).toContain('for (const script of page.querySelectorAll("script")) script.remove();');
  });

  it("navigates nowhere: a click in the page is caught", () => {
    expect(PAGE_PREVIEW_VIEW_HTML).toContain("event.preventDefault();");
    expect(PAGE_PREVIEW_VIEW_HTML).toContain('inner.addEventListener("submit", (event) => event.preventDefault());');
  });
});

describe("the publish card", () => {
  it("reads nothing, and shows only https photos", () => {
    expect(PUBLISH_CARD_VIEW_HTML).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource/);
    expect(PUBLISH_CARD_VIEW_HTML).toContain("/^https:\\/\\//.test(item.imageUrl)");
  });
});

describe("the pictures a preview takes", () => {
  it("are drawn 800 wide on a desktop and at a phone's own width", () => {
    expect(PREVIEW_VIEWPORTS.desktop.width * pictureScale("desktop")).toBe(800);
    expect(PREVIEW_VIEWPORTS.mobile.width * pictureScale("mobile")).toBe(390);
  });

  it("are drawn at the page's own pixels at full resolution", () => {
    expect(PREVIEW_VIEWPORTS.desktop.width * pictureScale("desktop", "full")).toBe(1280);
    expect(PREVIEW_VIEWPORTS.mobile.width * pictureScale("mobile", "full")).toBe(390);
  });

  it("ask the browser for the whole page, full length, at the scale the resolution names", () => {
    const standard = snapshotRequest("https://app.test/p", "desktop");
    expect(standard).toMatchObject({
      viewport: { width: 1280, height: 800, deviceScaleFactor: 0.625 },
      waitForSelector: { selector: "html[data-preview-ready]" },
      screenshotOptions: { fullPage: true, type: "jpeg", quality: 60 },
    });
    expect(standard).not.toHaveProperty("selector");
    expect(snapshotRequest("https://app.test/p", "desktop", { resolution: "full" }).viewport.deviceScaleFactor).toBe(1);
  });

  it("ask for a region by the marker the page lays over it, at full resolution, not full length", () => {
    const region = snapshotRequest("https://app.test/p", "desktop", { region: true, resolution: "standard" });
    expect(region).toMatchObject({ selector: "#ss-preview-region", viewport: { deviceScaleFactor: 1 } });
    expect(region.screenshotOptions).toEqual({ type: "jpeg", quality: 60 });
  });
});

/** The first bytes of a baseline JPEG of this size (SOI, JFIF, SOF0), then padding. */
function fakeJpeg(width: number, height: number, padBytes = 64): string {
  const head = [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
  ];
  return Buffer.from([...head, ...new Array(padBytes).fill(0)]).toString("base64");
}

describe("a cropped picture", () => {
  it("is measured from its own frame header", () => {
    expect(jpegSize(fakeJpeg(388, 190))).toEqual({ width: 388, height: 190 });
    expect(jpegSize(fakeJpeg(1280, 4000, 200_000))).toEqual({ width: 1280, height: 4000 });
    expect(jpegSize(Buffer.from("not a jpeg at all").toString("base64"))).toBeNull();
    expect(jpegSize("@@@")).toBeNull();
  });

  it("counts as the region only at the region's size, give or take the browser's rounding", () => {
    const region = { x: 298, y: 200, w: 388, h: 190 };
    expect(croppedAsAsked(fakeJpeg(388, 190), region)).toBe(true);
    expect(croppedAsAsked(fakeJpeg(389, 191), region)).toBe(true);
    // A browser that ignored the crop hands back the screen.
    expect(croppedAsAsked(fakeJpeg(1280, 800), region)).toBe(false);
    expect(croppedAsAsked(fakeJpeg(388, 190), undefined)).toBe(false);
  });
});

describe("cells as page pixels", () => {
  const grid = { x: 100, y: 200, columns: [190, 190, 190, 190, 190, 190], rows: [190, 190, 190], columnGap: 8, rowGap: 8 };

  it("runs from the first cell's left edge to the last cell's right edge, gaps between", () => {
    expect(regionBox(grid, { x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 100, y: 200, w: 190, h: 190 });
    expect(regionBox(grid, { x: 1, y: 1, w: 2, h: 2 })).toEqual({ x: 298, y: 398, w: 388, h: 388 });
    expect(regionBox(grid, { x: 0, y: 0, w: 6, h: 3 })).toEqual({ x: 100, y: 200, w: 1180, h: 586 });
  });

  it("is nothing for cells the grid did not draw", () => {
    expect(regionBox(grid, { x: 5, y: 0, w: 2, h: 1 })).toBeNull();
    expect(regionBox(grid, { x: 0, y: 2, w: 1, h: 2 })).toBeNull();
  });

  it("reads a laid-out grid's tracks, and nothing else", () => {
    expect(resolvedTracks("190px 190.5px 190px")).toEqual([190, 190.5, 190]);
    expect(resolvedTracks("repeat(6, minmax(0, 1fr))")).toBeNull();
    expect(resolvedTracks("none")).toBeNull();
  });

  it("travels in the preview page's address as x,y,w,h, and junk is ignored", () => {
    expect(parsePreviewRegion(formatPreviewRegion({ x: 1, y: 2, w: 3, h: 4 }))).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    for (const junk of ["1,2,3", "1,2,0,1", "a,b,c,d", "1,2,3,4,5", "-1,0,1,1", undefined]) {
      expect(parsePreviewRegion(junk), String(junk)).toBeNull();
    }
    expect(storefrontPreviewUrl(STOREFRONT, "tok", { x: 1, y: 0, w: 2, h: 2 })).toMatch(/\?t=tok&region=1,0,2,2$/);
    expect(storefrontPreviewUrl(STOREFRONT, "tok")).toMatch(/\?t=tok$/);
  });

  it("comes back out of the page with the board's grid and the region's box", () => {
    const html = `<script type="application/json" id="ss-preview-targets">${JSON.stringify({
      page: { width: 1280, height: 900 },
      tiles: [],
      board: { x: 50, y: 120, w: 1180, h: 586, columns: 6, rows: 3 },
      region: { x: 298, y: 318, w: 388, h: 190 },
    })}</script>`;
    expect(readMeasurements(html)).toMatchObject({
      board: { columns: 6, rows: 3, w: 1180 },
      region: { x: 298, y: 318, w: 388, h: 190 },
    });
  });
});

describe("a product page's key", () => {
  it("opens the product page it names, and nothing of the other kind", async () => {
    const token = await mintPreviewToken({ kind: "product", id: STOREFRONT }, GRANT);
    expect(await verifyPreviewToken(token)).toMatchObject({ kind: "product", id: STOREFRONT });
    const [body, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    const other = Buffer.from(JSON.stringify({ ...claims, kind: "order" })).toString("base64url");
    expect(await verifyPreviewToken(`${other}.${signature}`)).toBeNull();
  });
});
