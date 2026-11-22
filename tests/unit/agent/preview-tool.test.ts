// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

/**
 * preview_storefront's request and answer, with the browser stood in for.
 *
 * The real picture comes from Cloudflare Browser Run through the Worker's
 * binding, which nothing on a laptop can reach. What CAN be pinned is
 * everything this server decides around it: which page it opens (with the
 * region in its address), what it asks the browser for (scale, full length or
 * a crop by selector), and what it tells the model about a picture that came
 * back too big, or not cropped as asked. The browser here is the same seam the
 * e2e stack uses (AGENT_PREVIEW_TEST_SNAPSHOT_URL), answered by a stub.
 */

const STOREFRONT = "11111111-1111-4111-8111-111111111111";
const GRANT = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_URL = "http://snapshot.test/__test/snapshot";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/storefront/queries", () => ({
  getStorefront: vi.fn(async (id: string) =>
    id === STOREFRONT ? { id, name: "Fireside", version: "v1", config: DEFAULT_STOREFRONT_CONFIG } : null,
  ),
}));
vi.mock("@/lib/agent/preview/storefront-preview", () => ({
  storefrontPreview: vi.fn(async () => ({
    page: {},
    targets: [],
    notes: { notPublic: [], hiddenFromBuyers: [], noPhoto: [] },
  })),
}));
const limiter = vi.hoisted(() => ({ allow: true, spent: 0 }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimitKey: vi.fn(async () => {
    limiter.spent += 1;
    return limiter.allow;
  }),
}));
vi.mock("@/lib/agent/preview/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/preview/token")>()),
  mintPreviewToken: vi.fn(async () => "tok"),
}));

const { previewTools } = await import("@/lib/agent/tools/previews");
const { ToolMedia, ToolFailure } = await import("@/lib/agent/tool");
const previewStorefront = previewTools.find((tool) => tool.name === "preview_storefront")!;
const call = { account: { accountId: GRANT, userId: GRANT, role: "owner", isOwner: true }, grantId: GRANT } as never;

/** A baseline JPEG's header of this size, padded to `padBytes`. */
function fakeJpeg(width: number, height: number, padBytes = 64): string {
  const head = [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
  ];
  return Buffer.from([...head, ...new Array(padBytes).fill(0)]).toString("base64");
}

/** The page the stub browser "rendered", carrying what the probe measured. */
function renderedPage(measured: Record<string, unknown>): string {
  return `<html><body><script type="application/json" id="ss-preview-targets">${JSON.stringify({
    page: { width: 1280, height: 1400 },
    tiles: [],
    board: { x: 50, y: 120, w: 1180, h: 1180, columns: 6, rows: 6 },
    ...measured,
  })}</script></body></html>`;
}

type Answer = { screenshot: string; content: string };
let answer: (request: Record<string, unknown>) => Answer;
let requests: Record<string, unknown>[];

beforeEach(() => {
  vi.stubEnv("AGENT_PREVIEW_TEST_SNAPSHOT_URL", SNAPSHOT_URL);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  limiter.allow = true;
  limiter.spent = 0;
  requests = [];
  answer = () => ({ screenshot: fakeJpeg(800, 900), content: renderedPage({}) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      expect(url).toBe(SNAPSHOT_URL);
      const request = JSON.parse(init.body) as Record<string, unknown>;
      requests.push(request);
      return Response.json({ success: true, result: answer(request) });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function preview(input: Record<string, unknown>) {
  const result = await previewStorefront.handler({ id: STOREFRONT, ...input } as never, call);
  expect(result).toBeInstanceOf(ToolMedia);
  return result as InstanceType<typeof ToolMedia> & { data: Record<string, unknown> };
}

describe("preview_storefront at full resolution", () => {
  it("photographs the desktop at its own pixels, full length, and says the scale", async () => {
    const result = await preview({ viewport: "desktop", resolution: "full" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `https://app.test/agent-preview/storefront/${STOREFRONT}?t=tok`,
      viewport: { width: 1280, deviceScaleFactor: 1 },
      screenshotOptions: { fullPage: true },
    });
    expect(result.data).toMatchObject({ resolution: "full", pictures: ["desktop"], pictureScale: { desktop: 1 } });
    expect(result.images).toHaveLength(1);
  });

  it("leaves out a picture too large to send, and says how to see it instead", async () => {
    answer = () => ({ screenshot: fakeJpeg(1280, 6000, 120_000), content: renderedPage({}) });
    const result = await preview({ viewport: "desktop", resolution: "full" });
    expect(result.images).toHaveLength(0);
    expect(result.data).toMatchObject({ pictures: [], picturesTooLargeToSend: ["desktop"] });
    expect(String((result.data.pictureNotes as string[])[0])).toMatch(/region of cells/);
  });

  it("still takes the standard picture as before when nothing is asked", async () => {
    const result = await preview({});
    expect(requests.map((request) => (request.viewport as { deviceScaleFactor: number }).deviceScaleFactor)).toEqual([0.625, 1]);
    expect(result.data).toMatchObject({ resolution: "standard", pictures: ["desktop", "mobile"] });
  });
});

describe("preview_storefront of a region", () => {
  it("opens the page with the region, crops by the marker, and places the crop on the page", async () => {
    const lamp = { productId: "p", title: "Lamp", status: "active", x: 248, y: 318, w: 388, h: 388 };
    const far = { productId: "q", title: "Far", status: "active", x: 900, y: 900, w: 100, h: 100 };
    answer = () => ({
      screenshot: fakeJpeg(388, 388),
      content: renderedPage({ region: { x: 248, y: 318, w: 388, h: 388 }, tiles: [lamp, far] }),
    });
    const result = await preview({ region: { x: 1, y: 1, w: 2, h: 2 } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `https://app.test/agent-preview/storefront/${STOREFRONT}?t=tok&region=1,1,2,2`,
      selector: "#ss-preview-region",
      viewport: { width: 1280, deviceScaleFactor: 1 },
    });
    expect(requests[0].screenshotOptions).not.toHaveProperty("fullPage");
    expect(result.data).toMatchObject({
      pictures: ["desktop"],
      region: { cells: { x: 1, y: 1, w: 2, h: 2 }, page: { x: 248, y: 318, w: 388, h: 388 } },
      pictureScale: { desktop: 1 },
    });
    expect(result.images).toHaveLength(1);
    // The view's fallback picture is the crop, so its tile targets are in the crop's pixels.
    expect((result.view as { viewports: Record<string, unknown> }).viewports.desktop).toMatchObject({
      page: { width: 388, height: 388 },
      tiles: [{ ...lamp, x: 0, y: 0 }],
    });
    expect((result.view as { viewports: { desktop: { tiles: unknown[] } } }).viewports.desktop.tiles).toHaveLength(1);
  });

  it("never passes off an uncropped picture as the region", async () => {
    // A browser that ignored the selector photographs the screen.
    answer = () => ({ screenshot: fakeJpeg(1280, 800), content: renderedPage({ region: { x: 248, y: 318, w: 388, h: 388 } }) });
    const result = await preview({ region: { x: 1, y: 1, w: 2, h: 2 } });
    expect(result.images).toHaveLength(0);
    expect(result.data).toMatchObject({ pictures: [], regionNotCropped: true });
    expect(result.data).not.toHaveProperty("picturesMissing");
  });

  it("refuses a region off the board, or on the phone, before spending a preview", async () => {
    await expect(previewStorefront.handler({ id: STOREFRONT, region: { x: 5, y: 0, w: 2, h: 1 } } as never, call)).rejects.toBeInstanceOf(
      ToolFailure,
    );
    await expect(
      previewStorefront.handler({ id: STOREFRONT, viewport: "mobile", region: { x: 0, y: 0, w: 1, h: 1 } } as never, call),
    ).rejects.toBeInstanceOf(ToolFailure);
    expect(limiter.spent).toBe(0);
    expect(requests).toHaveLength(0);
  });

  it("accepts only whole cells, as the input schema says", () => {
    expect(previewStorefront.input.safeParse({ id: STOREFRONT, region: { x: 0.5, y: 0, w: 1, h: 1 } }).success).toBe(false);
    expect(previewStorefront.input.safeParse({ id: STOREFRONT, region: { x: 0, y: 0, w: 0, h: 1 } }).success).toBe(false);
    expect(previewStorefront.input.safeParse({ id: STOREFRONT, resolution: "full" }).success).toBe(true);
  });
});
